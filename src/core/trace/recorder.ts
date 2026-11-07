/**
 * JARVIS Core — Traza de una tarea (Fase 7; PLAN_CONTEXT 7).
 *
 * La traza queda FUERA del contexto: depende de él (se suscribe a `change`) y de los bordes del motor (`CaptureSink`: las
 * consultas a los modelos y las llamadas a herramientas), no al revés. Si se borra `trace/`, el motor compila y funciona igual.
 *
 * Qué reúne, por tarea (`traceEnabled`, `tracePath`):
 * - `models`: entrada y salida crudas de cada consulta a un modelo, con su etapa, `n` (versión del contexto al empezar), el
 *   paso en curso y a qué quedó enlazada: la llamada que se registró después (`route`, `tool`, `args`, `review`) o a la que
 *   se verificó (`verify`); el plan (`plan`); el hecho de la respuesta (`question`) o `result` (`final`).
 * - `tools`: por llamada a una herramienta, el intervalo de ejecución, los argumentos resueltos y el resultado crudo. Con
 *   `ref` el resultado no se copia: se guarda la referencia (el contenido vive en el archivo de la ref).
 * - `waits`: las esperas del usuario (plan, aprobación, pregunta) con su intervalo: explican los huecos entre etapas.
 * - `snapshot`: el contexto completo al terminar (5.4 y 4).
 *
 * Al terminar escribe una carpeta por tarea, `<dir de tracePath>/<nombre sin extensión>/AAAAMMDD-HHMMSS_<id>/` (con el valor por
 * defecto, `jarvis-traces/…`; ver `format.ts`):
 * - `summary.md`: lo que se lee o se pega a un agente.
 * - `trace.json`: la traza liviana (contexto, consultas con la salida interpretada, herramientas con un fragmento).
 * - `full.json.gz`: lo reunido arriba, completo y comprimido (entradas y salidas crudas).
 * y una línea en `index.jsonl` de esa carpeta base. El archivo único de la versión 2 (`jarvis-traces.jsonl`) ya no se escribe.
 * Los resultados grandes no se copian: viven en las refs (`data/refs`) y la traza guarda id, tamaño y un fragmento.
 *
 * El enlace con la llamada se hace al registrarse (`change` con `add calls`): lo anterior sin dueño es de ese intento. Una
 * consulta o ejecución que no llegó a registrar llamada (cancelación, cierre) queda con enlace `null`. Un fallo al escribir
 * la traza nunca afecta a la tarea.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { ConfigManager } from "../config.ts";
import type { ChangeEvent, TaskContext } from "../ctx/index.ts";
import { NULL_SINK } from "../engine/sink.ts";
import type { CaptureSink, LlmCapture, ToolCapture } from "../engine/sink.ts";
import type { Waiting } from "../engine/runtime.ts";
import type { ModelLink, ModelRecord, ToolRecord, WaitRecord } from "./types.ts";
import type { StageId } from "../types.ts";
import { errorMessage } from "../utils.ts";
import { TRACE_FORMAT_VERSION, buildMeta, buildSummary, folderName, indexEntry, refInfos, slimQuery, slimTool } from "./format.ts";
import type { SummaryInput } from "./format.ts";

export { TRACE_FORMAT_VERSION };
export type { ModelRecord, ToolRecord, WaitRecord } from "./types.ts";

/** Tope del resultado crudo de una herramienta sin ref; `resultChars` conserva el tamaño original. */
const MAX_TOOL_RESULT_CHARS = 20_000;

const noLink = (): ModelLink => ({ call: null, plan: null, fact: null, result: false });

export class TaskTraceRecorder {
  /** Receptor para `EngineDeps.sink`; vacío si la traza está desactivada. */
  readonly sink: CaptureSink;

  private readonly models: ModelRecord[] = [];
  private readonly tools: ToolRecord[] = [];
  private readonly waits: WaitRecord[] = [];
  private openWait: { kind: Waiting["kind"]; n: number; startedAt: number } | null = null;
  private readonly refSizes = new Map<string, number>();
  private pendingModels: ModelRecord[] = [];
  private pendingTools: ToolRecord[] = [];
  private currentStep: string | null = null;
  private lastCall: { id: string; tool: string; status: string } | null = null;
  private readonly unsubscribe: () => void;
  private finished = false;
  private readonly enabled: boolean;

  constructor(private readonly ctx: TaskContext) {
    this.enabled = ConfigManager.getConfig().traceEnabled;
    if (!this.enabled) {
      this.sink = NULL_SINK;
      this.unsubscribe = () => undefined;
      return;
    }
    this.sink = { llm: (event) => this.onModel(event), tool: (event) => this.onTool(event) };
    this.unsubscribe = ctx.on("change", (event) => this.onChange(event));
  }

  // ─────────── Bordes: modelos y herramientas ───────────

  private onModel(event: LlmCapture): void {
    const record: ModelRecord = {
      seq: this.models.length + 1,
      stage: event.stage,
      step: event.stage === "plan" || event.stage === "final" || event.stage === "pending" ? null : this.currentStep,
      n: event.n,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      input: event.input,
      output: event.output,
      error: event.error,
      link: noLink(),
    };
    this.models.push(record);
    // La verificación llega después de registrar la llamada: es de la última llamada.
    if (event.stage === "verify" && this.lastCall !== null) record.link.call = this.lastCall.id;
    else this.pendingModels.push(record);
  }

  private onTool(event: ToolCapture): void {
    const raw = event.result === null ? null : JSON.stringify(event.result);
    const record: ToolRecord = {
      call: null,
      mcp: event.mcp,
      tool: event.tool,
      args: event.args,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      result: raw === null ? null : raw.slice(0, MAX_TOOL_RESULT_CHARS),
      resultChars: raw === null ? null : raw.length,
      ref: null,
      refSize: null,
      error: event.error,
    };
    this.tools.push(record);
    // Una herramienta cancelada en vuelo responde después de que su llamada `interrupted` ya se registró.
    const last = this.lastCall;
    if (last !== null && last.status === "interrupted" && last.tool === event.tool && !this.tools.some((t) => t.call === last.id)) {
      record.call = last.id;
    } else {
      this.pendingTools.push(record);
    }
  }

  // ─────────── Esperas del usuario ───────────

  /** Lo que espera la tarea del usuario cambió (`null` = nada). Una espera dura hasta el siguiente cambio. */
  onWaiting(waiting: Waiting | null): void {
    if (!this.enabled || this.finished) return;
    const kind = waiting?.kind ?? null;
    if (this.openWait !== null && this.openWait.kind === kind) return;
    this.closeWait();
    if (kind !== null) this.openWait = { kind, n: this.ctx.n, startedAt: Date.now() };
  }

  private closeWait(): void {
    if (this.openWait === null) return;
    this.waits.push({ ...this.openWait, endedAt: Date.now() });
    this.openWait = null;
  }

  // ─────────── Contexto: `change` ───────────

  private onChange(event: ChangeEvent): void {
    for (const op of event.ops) {
      if (op.op === "add" && op.target === "refs") {
        this.refSizes.set(op.value.id, op.value.size);
      } else if (op.op === "add" && op.target === "steps" && op.value.planId === null) {
        this.currentStep = op.value.id; // reactivo: el paso nace `running`
      } else if (op.op === "update" && "state" in op.value && op.value.state === "running") {
        this.currentStep = op.target;
      } else if (op.op === "add" && op.target === "calls") {
        const call = op.value;
        this.lastCall = { id: call.id, tool: call.tool, status: call.status };
        for (const model of this.pendingModels) model.link.call = call.id;
        for (const tool of this.pendingTools) {
          tool.call = call.id;
          if (call.ref !== null) {
            tool.ref = call.ref;
            tool.refSize = this.refSizes.get(call.ref) ?? null;
            tool.result = null; // con ref, la traza guarda la referencia y no el contenido
          }
        }
        this.pendingModels = [];
        this.pendingTools = [];
      } else if (op.op === "set" && op.target.startsWith("facts.answer_")) {
        for (const model of this.pendingModels) model.link.fact = op.target.slice("facts.".length);
        this.pendingModels = [];
      } else if (op.op === "add" && op.target === "plans") {
        for (const model of this.pendingModels) model.link.plan = op.value.id;
        this.pendingModels = [];
      } else if (op.op === "set" && op.target === "result") {
        for (const model of this.pendingModels) model.link.result = true;
        this.pendingModels = [];
      }
    }
  }

  // ─────────── Cierre ───────────

  /** Escribe la línea de la tarea (una sola vez) y deja de escuchar. Un fallo se ignora. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.unsubscribe();
    if (!this.enabled) return;
    this.closeWait();
    try {
      const config = ConfigManager.getConfig();
      const snapshot = this.ctx.snapshot();
      const startedAt = snapshot.task.startedAt;
      const endedAt = Date.now();
      const input: SummaryInput = {
        snapshot,
        startedAt,
        endedAt,
        meta: buildMeta(this.models, config.qwenModel, config.decisionModel),
        queries: this.models.map(slimQuery),
        tools: this.tools,
        waits: this.waits,
        refs: refInfos(snapshot.refs),
      };
      const file = path.resolve(process.cwd(), config.tracePath);
      const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
      const folder = folderName(startedAt, snapshot.task.id);
      const dir = path.join(base, folder);
      fs.mkdirSync(dir, { recursive: true });

      const header = { v: TRACE_FORMAT_VERSION, taskId: snapshot.task.id, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString() };
      fs.writeFileSync(path.join(dir, "summary.md"), buildSummary(input), "utf-8");
      fs.writeFileSync(
        path.join(dir, "trace.json"),
        JSON.stringify(
          { ...header, kind: "slim", durationMs: endedAt - startedAt, meta: input.meta, snapshot, queries: input.queries, tools: this.tools.map(slimTool), waits: this.waits, refs: input.refs }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(dir, "full.json.gz"),
        zlib.gzipSync(Buffer.from(JSON.stringify({ ...header, kind: "full", snapshot, models: this.models, tools: this.tools, waits: this.waits }), "utf-8"), { level: 6 }),
      );
      fs.appendFileSync(path.join(base, "index.jsonl"), `${JSON.stringify(indexEntry(input, folder))}
`, "utf-8");
    } catch (error) {
      console.warn("[TaskTrace] No se pudo registrar la traza:", errorMessage(error));
    }
  }
}