/**
 * JARVIS Core — Traza de una tarea (Fase 7; PLAN_CONTEXT 7).
 *
 * La traza queda FUERA del contexto: depende de él (se suscribe a `change`) y de los bordes del motor (`CaptureSink`: las
 * consultas a los modelos y las llamadas a herramientas), no al revés. Si se borra `trace/`, el motor compila y funciona igual.
 *
 * Qué guarda, por tarea y en una sola línea JSON al terminar (`traceEnabled`, `tracePath`):
 * - `models`: entrada y salida crudas de cada consulta a un modelo, con su etapa, `n` (versión del contexto al empezar), el
 *   paso en curso y a qué quedó enlazada: la llamada que se registró después (`route`, `tool`, `args`, `review`) o a la que
 *   se verificó (`verify`); el plan (`plan`); el hecho de la respuesta (`question`) o `result` (`final`).
 * - `tools`: por llamada a una herramienta, el intervalo de ejecución, los argumentos resueltos y el resultado crudo. Con
 *   `ref` el resultado no se copia: se guarda la referencia (el contenido vive en el archivo de la ref).
 * - `waits`: las esperas del usuario (plan, aprobación, pregunta) con su intervalo: explican los huecos entre etapas.
 * - `snapshot`: el contexto completo al terminar (5.4 y 4).
 *
 * El enlace con la llamada se hace al registrarse (`change` con `add calls`): lo anterior sin dueño es de ese intento. Una
 * consulta o ejecución que no llegó a registrar llamada (cancelación, cierre) queda con enlace `null`. Un fallo al escribir
 * la traza nunca afecta a la tarea.
 */

import fs from "node:fs";
import path from "node:path";

import { ConfigManager } from "../config.ts";
import type { ChangeEvent, TaskContext } from "../ctx/index.ts";
import { NULL_SINK } from "../engine/capture.ts";
import type { CaptureSink, CaptureStage, LlmCapture, ToolCapture } from "../engine/capture.ts";
import type { Waiting } from "../engine/runtime.ts";
import { errorMessage } from "../utils.ts";

/** Versión del formato de la línea de traza: quien la consume (lab/) la usa para interpretarla. */
export const TRACE_FORMAT_VERSION = 2;

/** Tope del resultado crudo de una herramienta sin ref; `resultChars` conserva el tamaño original. */
const MAX_TOOL_RESULT_CHARS = 20_000;

/** A qué quedó enlazada una consulta: como máximo una de las claves. */
interface ModelLink {
  call: string | null;
  plan: string | null;
  fact: string | null;
  result: boolean;
}

export interface ModelRecord {
  /** Orden de la consulta en la tarea (por el inicio de cada una). */
  seq: number;
  stage: CaptureStage;
  /** Paso en curso cuando empezó la consulta; `null` en el plan y la respuesta final. */
  step: string | null;
  /** Versión del contexto al empezar la consulta. */
  n: number;
  startedAt: number;
  durationMs: number;
  input: string | null;
  output: string | null;
  error: string | null;
  link: ModelLink;
}

export interface ToolRecord {
  /** Llamada registrada para esta ejecución; `null` si no llegó a registrarse. */
  call: string | null;
  mcp: string;
  tool: string;
  args: Record<string, unknown>;
  startedAt: number;
  durationMs: number;
  /** Resultado crudo, recortado; `null` si hay `ref` o si la herramienta lanzó. */
  result: string | null;
  /** Largo del resultado crudo serializado como JSON (incluye la envoltura del protocolo). */
  resultChars: number | null;
  ref: string | null;
  /** Largo del texto guardado en la ref (`size` de la ref); `null` sin ref. Difiere de `resultChars` por la envoltura JSON. */
  refSize: number | null;
  error: string | null;
}

/** Una espera del usuario: de que la tarea se detuvo a que se resolvió (o se cerró la tarea). */
export interface WaitRecord {
  kind: Waiting["kind"];
  /** Versión del contexto cuando empezó la espera. */
  n: number;
  startedAt: number;
  endedAt: number;
}

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
      step: event.stage === "plan" || event.stage === "final" ? null : this.currentStep,
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
      const snapshot = this.ctx.snapshot();
      const line = JSON.stringify({
        v: TRACE_FORMAT_VERSION,
        taskId: snapshot.task.id,
        startedAt: new Date(snapshot.task.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        snapshot,
        models: this.models,
        tools: this.tools,
        waits: this.waits,
      });
      const file = path.resolve(process.cwd(), ConfigManager.getConfig().tracePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${line}\n`, "utf-8");
    } catch (error) {
      console.warn("[TaskTrace] No se pudo registrar la traza:", errorMessage(error));
    }
  }
}