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
 * Al terminar (`finish`) toma lo reunido al instante y escribe, en segundo plano y sin bloquear el servidor, una carpeta por tarea, `<dir de tracePath>/<nombre sin extensión>/AAAAMMDD-HHMMSS_<id>/` (con el valor por
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

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

import type { ConfigSource } from "../config.ts";
import type { ChangeEvent, TaskContext } from "../ctx/index.ts";
import { NULL_SINK } from "./sink.ts";
import type { CaptureSink, LlmCapture, ToolCapture } from "./sink.ts";
import type { Waiting } from "../engine/runtime.ts";
import type { MCPCallResult } from "../types.ts";
import type { ModelLink, ModelRecord, ToolRecord, WaitRecord } from "./types.ts";
import { errorMessage } from "../utils.ts";
import { TRACE_FORMAT_VERSION, buildMeta, buildSummary, folderName, indexEntry, refInfos, slimQuery, slimTool } from "./format.ts";
import type { SummaryInput } from "./format.ts";

export { TRACE_FORMAT_VERSION };
export type { ModelRecord, ToolRecord, WaitRecord } from "./types.ts";

const gzip = promisify(zlib.gzip);

/** Cede el hilo al resto del servidor: entre dos trabajos pesados de la escritura de la traza, el servidor atiende lo demás. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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
  /** La escritura de la traza en curso (o ya hecha): `finish` es idempotente y devuelve siempre la misma. */
  private done: Promise<void> | null = null;
  private readonly enabled: boolean;
  /** Resultados crudos aún sin serializar: `JSON.stringify` de un resultado grande no corre dentro del flujo de la tarea, sino al escribir la traza. */
  private readonly rawResults = new Map<ToolRecord, MCPCallResult>();
  /** Herramientas cuya traza guarda la ref y no el texto (el resultado se serializa igual, para registrar su largo). */
  private readonly textDropped = new Set<ToolRecord>();

  constructor(private readonly ctx: TaskContext, private readonly getConfig: ConfigSource) {
    this.enabled = getConfig().traceEnabled;
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
    const record: ToolRecord = {
      call: null,
      mcp: event.mcp,
      tool: event.tool,
      args: event.args,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      result: null,
      resultChars: null,
      ref: null,
      refSize: null,
      error: event.error,
    };
    this.tools.push(record);
    if (event.result !== null) this.rawResults.set(record, event.result);
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
            this.textDropped.add(tool); // con ref, la traza guarda la referencia y no el contenido
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

  /**
   * Cierra la traza de la tarea: deja de escuchar, toma de inmediato lo que hay (síncrono, barato) y escribe la carpeta en segundo plano,
   * sin bloquear el servidor ni la tarea (que ya entregó su respuesta). Idempotente: devuelve siempre la misma promesa, que nunca rechaza
   * (un fallo al escribir se informa y se ignora). Quien necesite esperar a que quede en disco (el cierre del servidor) la espera.
   */
  finish(): Promise<void> {
    if (this.done !== null) return this.done;
    this.finished = true;
    this.unsubscribe();
    if (!this.enabled) return (this.done = Promise.resolve());
    this.closeWait();
    const captured = this.capture();
    // Lo capturado es lo único que la escritura necesita: la tarea sigue retenida en memoria y no debe cargar con lo crudo.
    this.release();
    this.done = this.write(captured).catch((error: unknown) => console.warn("[TaskTrace] No se pudo registrar la traza:", errorMessage(error)));
    return this.done;
  }

  /** Copia de lo reunido y del contexto al terminar. */
  private capture(): Captured {
    return {
      config: this.getConfig(),
      snapshot: this.ctx.snapshot(),
      models: [...this.models],
      tools: [...this.tools],
      waits: [...this.waits],
      raw: new Map(this.rawResults),
      dropped: new Set(this.textDropped),
    };
  }

  private release(): void {
    this.models.length = 0;
    this.tools.length = 0;
    this.waits.length = 0;
    this.pendingModels = [];
    this.pendingTools = [];
    this.refSizes.clear();
    this.rawResults.clear();
    this.textDropped.clear();
  }

  /** Escribe la carpeta de la tarea y su línea en `index.jsonl`. Cede el hilo entre los trabajos pesados (serializar, comprimir). */
  private async write(c: Captured): Promise<void> {
    const { config, snapshot, models, tools, waits } = c;
    const startedAt = snapshot.task.startedAt;
    const endedAt = Date.now();

    // Resultados crudos: se serializan recién ahora, y solo el fragmento (o nada, con ref) queda en la traza.
    for (const [record, raw] of c.raw) {
      const text = JSON.stringify(raw);
      record.resultChars = text.length;
      record.result = c.dropped.has(record) ? null : text.slice(0, MAX_TOOL_RESULT_CHARS);
    }
    await yieldToLoop();

    const input: SummaryInput = {
      snapshot,
      startedAt,
      endedAt,
      meta: buildMeta(models, config.qwenModel, config.decisionModel),
      queries: models.map(slimQuery),
      tools,
      waits,
      refs: refInfos(snapshot.refs),
    };
    const file = path.resolve(process.cwd(), config.tracePath);
    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    const folder = folderName(startedAt, snapshot.task.id);
    const dir = path.join(base, folder);
    await fs.mkdir(dir, { recursive: true });

    const header = { v: TRACE_FORMAT_VERSION, taskId: snapshot.task.id, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString() };
    await fs.writeFile(path.join(dir, "summary.md"), buildSummary(input), "utf-8");
    await yieldToLoop();
    await fs.writeFile(
      path.join(dir, "trace.json"),
      JSON.stringify({ ...header, kind: "slim", durationMs: endedAt - startedAt, meta: input.meta, snapshot, queries: input.queries, tools: tools.map(slimTool), waits, refs: input.refs }),
      "utf-8",
    );
    await yieldToLoop();
    const full = Buffer.from(JSON.stringify({ ...header, kind: "full", snapshot, models, tools, waits }), "utf-8");
    await yieldToLoop();
    await fs.writeFile(path.join(dir, "full.json.gz"), await gzip(full, { level: 6 }));
    await fs.appendFile(path.join(base, "index.jsonl"), `${JSON.stringify(indexEntry(input, folder))}\n`, "utf-8");
  }
}

/** Lo que `finish` toma de la tarea para escribir después. */
interface Captured {
  readonly config: ReturnType<ConfigSource>;
  readonly snapshot: ReturnType<TaskContext["snapshot"]>;
  readonly models: ModelRecord[];
  readonly tools: ToolRecord[];
  readonly waits: WaitRecord[];
  readonly raw: Map<ToolRecord, MCPCallResult>;
  readonly dropped: Set<ToolRecord>;
}
