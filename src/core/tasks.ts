/**
 * JARVIS Core — Fachada de tareas (Fase 7).
 *
 * Es la única puerta entre el exterior (servidor HTTP, UI, Telegram) y el motor: mantiene UNA sola tarea activa a la vez,
 * lanza `runTask` en segundo plano, expone las respuestas del usuario (plan, mutación, pregunta) y la cancelación, y emite los
 * eventos que el servidor reenvía por SSE. No decide nada del flujo: eso es de `runTask`; aquí solo se conecta.
 *
 * - Una tarea = un `TaskContext` + un `TaskRuntime` + un `TaskTraceRecorder`. La traza se conecta por `EngineDeps.sink` y por
 *   `change`; la fachada no la conoce más que para cerrarla.
 * - Concurrencia: solo corre una tarea por vez (`active` + una única promesa `inFlight`); si llega otra antes de terminar por
 *   completo (respuesta final y traza cerrada), rechaza con `TaskBusyError`.
 * - Hilo: un único `previousTask` global en RAM (vence a los `THREAD_TTL_MS`).
 * - Historial: hasta `MAX_RETAINED_TASKS` tareas terminadas; nunca cancela una espera por tamaño de historial.
 */

import { BUDGET } from "./budget.ts";
import { create, terminalStateFor } from "./ctx/index.ts";
import type { ContextData, ContextOptions, NormalizedOp, StopReason, TaskContext, TaskMode, TaskState } from "./ctx/index.ts";
import type { EngineDeps, EngineLLM, IActionDecision, IDiscoveryEngine, PreviousTask } from "./contracts.ts";
import { previousTaskOf, THREAD_TTL_MS } from "./engine/thread.ts";
import type { EngineServices } from "./engine/services.ts";
import { createEngineServices } from "./engine/services.ts";
import type { ConfigSource } from "./config.ts";
import { runTask } from "./engine/runTask.ts";
import { TaskRuntime } from "./engine/runtime.ts";
import type { Waiting } from "./engine/runtime.ts";
import { renderFallback } from "./render/index.ts";
import { windowOptions } from "./engine/adapters.ts";
import { argsMax } from "./tools/manifest.ts";
import { TaskTraceRecorder } from "./trace/recorder.ts";
import { MAX_RETAINED_TASKS } from "./types/limits.ts";
import { errorMessage, newId } from "./utils.ts";

/** Motores que recibe la fachada; los construye la raíz de composición (server.ts). */
export interface TaskManagerDeps {
  readonly decision: IActionDecision;
  readonly discovery: IDiscoveryEngine;
  readonly llm: EngineLLM;
}

export interface TaskManagerOptions {
  /** Plazo (ms) tras cancelar antes de liberar una ejecución colgada que no responde al aborto. */
  readonly cancelGraceMs?: number;
}

/** Estado completo de una tarea: el snapshot del contexto, su versión y lo que espera del usuario. */
export interface TaskDto extends ContextData {
  /** Versión del contexto (`ctx.n`): los eventos `change` traen la suya, para detectar saltos. */
  n: number;
  waiting: Waiting | null;
}

/** Fila de un listado. */
export interface TaskSummary {
  id: string;
  mode: TaskMode;
  request: string;
  state: TaskState;
  stopReason: StopReason | null;
  startedAt: number;
  n: number;
  waiting: Waiting["kind"] | null;
}

export type TaskEvent =
  | { readonly type: "created"; readonly taskId: string; readonly n: number }
  | { readonly type: "change"; readonly taskId: string; readonly n: number; readonly at: number; readonly ops: readonly Readonly<NormalizedOp>[] }
  | { readonly type: "waiting"; readonly taskId: string; readonly waiting: Waiting | null };

export type TaskListener = (event: TaskEvent) => void;

/** Resultado de una orden del usuario: el servidor lo traduce a HTTP (404, 409). */
export type ControlResult = "ok" | "unknown_task" | "not_waiting";

/** Error al intentar iniciar una tarea cuando todavía hay una activa (o cerrando su traza). */
export class TaskBusyError extends Error {
  readonly activeTaskId: string;

  constructor(activeTaskId: string) {
    super("Ya hay una tarea en curso; esperá a que termine o cancelala desde la interfaz web (botón Cancelar) o con /cancel en Telegram si la iniciaste ahí.");
    this.name = "TaskBusyError";
    this.activeTaskId = activeTaskId;
  }
}

interface TaskEntry {
  readonly ctx: TaskContext;
  readonly runtime: TaskRuntime;
  readonly recorder: TaskTraceRecorder;
}

interface ActiveRun {
  readonly entry: TaskEntry;
  readonly run: Promise<void>;
  detached: boolean;
  cancelTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_CANCEL_GRACE_MS = 1500;

export class TaskManager {
  private active: ActiveRun | null = null;
  /** Única ejecución en curso (incluye respuesta final y escritura de la traza). */
  private inFlight: Promise<void> | null = null;
  /** Historial de tareas terminadas en orden cronológico, acotado a `MAX_RETAINED_TASKS`. */
  private readonly history = new Map<string, TaskEntry>();
  private readonly listeners = new Set<TaskListener>();
  /** Hilo (`engine/thread.ts`): última tarea completada con respuesta del modelo, única y global; vence a los `THREAD_TTL_MS`. */
  private previousTask: { readonly task: PreviousTask; readonly at: number } | null = null;
  private readonly cancelGraceMs: number;
  private readonly contextOptions: ContextOptions = {
    now: Date.now,
    summaryMax: BUDGET.summaryMax,
    argsStringMax: argsMax(BUDGET.argsStringDefault),
    factValueMax: BUDGET.factValueMax,
    feedbackMax: BUDGET.feedbackMax,
    jsonMaxDepth: BUDGET.jsonMaxDepth,
    onListenerError: (error) => console.error("[Tasks] un suscriptor de `change` falló:", errorMessage(error)),
  };

  constructor(
    private readonly deps: TaskManagerDeps,
    private readonly getConfig: ConfigSource,
    private readonly services: EngineServices = createEngineServices(getConfig),
    options: TaskManagerOptions = {},
  ) {
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  }

  addEventListener(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ─────────── Ciclo de vida ───────────

  /** Crea la tarea y la lanza en segundo plano. Rechaza con `TaskBusyError` si hay otra sin terminar por completo. */
  start(message: string, mode: TaskMode): TaskDto {
    if (this.active !== null || this.inFlight !== null) {
      throw new TaskBusyError(this.active?.entry.ctx.task.id ?? "");
    }

    const id = newId("task");
    const ctx = create.context({ id, request: message, mode }, this.contextOptions);
    const recorder = new TaskTraceRecorder(ctx, this.getConfig);
    const runtime = new TaskRuntime({
      onChange: (waiting) => {
        recorder.onWaiting(waiting);
        this.emit({ type: "waiting", taskId: id, waiting });
      },
    });
    const entry: TaskEntry = { ctx, runtime, recorder };

    ctx.on("change", (event) => this.emit({ type: "change", taskId: id, n: event.n, at: event.at, ops: event.ops }));

    const prev = this.previousTask;
    const previousTask = prev !== null && Date.now() - prev.at < THREAD_TTL_MS ? prev.task : null;
    if (prev !== null && previousTask === null) this.previousTask = null;
    const deps: EngineDeps = { ...this.deps, ...this.services, sink: recorder.sink, previousTask };

    let current!: ActiveRun;
    const run: Promise<void> = runTask(ctx, runtime, deps)
      .catch((error: unknown) => {
        if (!current.detached) this.closeOnDefect(entry, error);
      })
      .then(() => {
        if (!current.detached) this.remember(ctx);
      })
      .finally(() => recorder.finish())
      .finally(() => this.completeActive(current));

    current = { entry, run, detached: false };
    this.active = current;
    this.inFlight = run;

    this.emit({ type: "created", taskId: id, n: ctx.n });
    console.log(`[Task] start id=${id} mode=${mode}`);

    return this.toDto(entry);
  }

  /** Guarda la tarea para el hilo si terminó completada con una respuesta del modelo (no la de respaldo, que es texto fijo). */
  private remember(ctx: TaskContext): void {
    const result = ctx.result;
    if (ctx.task.state !== "completed" || result === null || result.origin !== "model") return;
    this.previousTask = { task: previousTaskOf(ctx.task.request, result.text), at: Date.now() };
  }

  /** Cancela la tarea: aborta lo que esté en curso y resuelve la espera. Si queda colgada, programa su liberación tras `cancelGraceMs`. */
  cancel(taskId: string): ControlResult {
    const entry = this.entryOf(taskId);
    if (!entry) return "unknown_task";
    if (entry.ctx.isClosed()) return "not_waiting";
    entry.runtime.cancel();
    if (this.active?.entry === entry && this.active.cancelTimer === undefined) {
      const target = this.active;
      target.cancelTimer = setTimeout(() => this.forceRelease(target), this.cancelGraceMs);
      target.cancelTimer.unref();
    }
    return "ok";
  }

  /**
   * Espera hasta `graceMs` a que la tarea cancelada termine y libere el cupo activo. Si la ejecución está colgada y no
   * respondió dentro del plazo, fuerza su cierre (`user_cancelled` + respaldo), cierra la traza y libera el lugar.
   */
  async settleCancel(taskId: string, graceMs = this.cancelGraceMs): Promise<void> {
    const target = this.active;
    if (target === null || target.entry.ctx.task.id !== taskId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    try {
      await Promise.race([target.run.catch(() => undefined), limit]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (this.active === target) {
      this.forceRelease(target);
      await target.entry.recorder.finish();
    }
  }

  /**
   * Espera a que termine la ejecución en curso (cierre de la tarea, cierre de sus procesos en segundo plano y escritura de la traza),
   * hasta `timeoutMs`. Se usa después de `cancelActive`, antes de apagar los servidores MCP.
   */
  async drain(timeoutMs: number): Promise<void> {
    const run = this.inFlight;
    if (run === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([run.catch(() => undefined), limit]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Cancela la tarea abierta (cierre del servidor), sin forzar liberación prematura: `drain` marca el plazo real. */
  cancelActive(): void {
    this.active?.entry.runtime.cancel();
  }

  // ─────────── Lectura ───────────

  get(taskId: string): TaskDto | null {
    const entry = this.entryOf(taskId);
    return entry ? this.toDto(entry) : null;
  }

  /** Texto completo de una ref de la tarea. La ruta sale del contexto, nunca del pedido, y el almacén solo lee dentro de su carpeta. */
  async readRef(taskId: string, refId: string): Promise<{ readonly text: string } | "unknown_task" | "unknown_ref" | "unavailable"> {
    const entry = this.entryOf(taskId);
    if (!entry) return "unknown_task";
    const ref = entry.ctx.snapshot().refs.find((r) => r.id === refId);
    if (!ref) return "unknown_ref";
    try {
      return { text: await this.services.vault.readAll(ref.where) };
    } catch (error) {
      console.warn(`[Tasks] no se pudo leer la ref ${refId}: ${errorMessage(error)}`);
      return "unavailable";
    }
  }

  /** Ids de las tareas retenidas en memoria (la retención en disco no borra sus refs). */
  taskIds(): string[] {
    return this.entries().map((e) => e.ctx.task.id);
  }

  list(): TaskSummary[] {
    return this.entries().map(({ ctx, runtime }) => ({
      id: ctx.task.id,
      mode: ctx.task.mode,
      request: ctx.task.request,
      state: ctx.task.state,
      stopReason: ctx.task.stopReason,
      startedAt: ctx.task.startedAt,
      n: ctx.n,
      waiting: runtime.waiting?.kind ?? null,
    }));
  }

  // ─────────── Respuestas del usuario ───────────

  /** Acepta el plan que espera confirmación. `waitId` (opcional) debe ser el de la espera actual. */
  approvePlan(taskId: string, waitId?: string): ControlResult {
    return this.control(taskId, "plan", waitId, (runtime, id) => runtime.resolvePlanApproval(id, true));
  }

  /** Pide un plan nuevo con la instrucción del usuario. */
  modifyPlan(taskId: string, feedback: string, waitId?: string): ControlResult {
    return this.control(taskId, "plan", waitId, (runtime, id) => runtime.resolvePlanApproval(id, false, feedback));
  }

  /** Rechaza el plan sin instrucción: la tarea se cancela. */
  rejectPlan(taskId: string, waitId?: string): ControlResult {
    return this.control(taskId, "plan", waitId, (runtime, id) => runtime.resolvePlanApproval(id, false));
  }

  /** Acepta la mutación que espera confirmación. */
  approveCall(taskId: string, waitId?: string): ControlResult {
    return this.control(taskId, "approval", waitId, (runtime, id) => runtime.resolveApproval(id, true));
  }

  /** Rechaza la mutación, con una instrucción opcional que el motor deja a la vista del modelo. */
  denyCall(taskId: string, instruction?: string, waitId?: string): ControlResult {
    return this.control(taskId, "approval", waitId, (runtime, id) => runtime.resolveApproval(id, false, instruction));
  }

  /** Responde la pregunta abierta. Una respuesta vacía no se aplica (`not_waiting`) y la tarea sigue esperando. */
  answer(taskId: string, text: string): ControlResult {
    const entry = this.entryOf(taskId);
    if (!entry) return "unknown_task";
    return entry.runtime.waiting?.kind === "question" && entry.runtime.answer(text) ? "ok" : "not_waiting";
  }

  // ─────────── Internos ───────────

  private entryOf(taskId: string): TaskEntry | undefined {
    if (this.active?.entry.ctx.task.id === taskId) return this.active.entry;
    return this.history.get(taskId);
  }

  private entries(): TaskEntry[] {
    return this.active ? [...this.history.values(), this.active.entry] : [...this.history.values()];
  }

  private control(
    taskId: string,
    kind: "plan" | "approval",
    waitId: string | undefined,
    resolve: (runtime: TaskRuntime, id: string) => boolean,
  ): ControlResult {
    const entry = this.entryOf(taskId);
    if (!entry) return "unknown_task";
    const waiting = entry.runtime.waiting;
    if (waiting === null || waiting.kind !== kind) return "not_waiting";
    if (waitId !== undefined && waitId !== waiting.request.id) return "not_waiting";
    return resolve(entry.runtime, waiting.request.id) ? "ok" : "not_waiting";
  }

  private toDto({ ctx, runtime }: TaskEntry): TaskDto {
    return { ...ctx.snapshot(), n: ctx.n, waiting: runtime.waiting };
  }

  private emit(event: TaskEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Tasks] un suscriptor de eventos falló:", errorMessage(error));
      }
    }
  }

  /** Defecto de programación en `runTask`: la tarea no puede quedar abierta. Se cierra con `unrecoverable` y respaldo. */
  private closeOnDefect({ ctx, runtime }: TaskEntry, error: unknown): void {
    console.error("[Tasks] error interno en la ejecución de la tarea:", error);
    try {
      runtime.cancel();
      if (!ctx.isClosed()) {
        for (const step of ctx.find("steps", { state: "running" })) {
          ctx.apply({ op: "update", target: step.id, value: { state: "failed" } });
        }
        const calls = ctx.find("calls", {});
        ctx.apply({ op: "finish", target: "task", value: { state: terminalStateFor("unrecoverable", calls), stopReason: "unrecoverable" } });
      }
      if (ctx.result === null) {
        ctx.apply({ op: "set", target: "result", value: { text: renderFallback(ctx.view.forFallback(windowOptions())).text, origin: "fallback" } });
      }
    } catch (closing) {
      console.error("[Tasks] no se pudo cerrar la tarea tras el error:", errorMessage(closing));
    }
  }

  private completeActive(target: ActiveRun): void {
    if (target.cancelTimer !== undefined) {
      clearTimeout(target.cancelTimer);
      target.cancelTimer = undefined;
    }
    if (this.inFlight === target.run) this.inFlight = null;
    if (this.active !== target) return;
    this.active = null;
    this.archive(target.entry);
  }

  private forceRelease(target: ActiveRun): void {
    if (target.cancelTimer !== undefined) {
      clearTimeout(target.cancelTimer);
      target.cancelTimer = undefined;
    }
    if (this.active !== target) return;
    target.detached = true;
    this.active = null;
    if (this.inFlight === target.run) this.inFlight = null;

    const { ctx, runtime, recorder } = target.entry;
    try {
      runtime.cancel();
      if (!ctx.isClosed()) {
        for (const step of ctx.find("steps", { state: "running" })) {
          ctx.apply({ op: "update", target: step.id, value: { state: "failed" } });
        }
        ctx.apply({ op: "finish", target: "task", value: { state: "cancelled", stopReason: "user_cancelled" } });
      }
      if (ctx.result === null) {
        ctx.apply({ op: "set", target: "result", value: { text: renderFallback(ctx.view.forFallback(windowOptions())).text, origin: "fallback" } });
      }
    } catch (error) {
      console.warn(`[Tasks] no se pudo cerrar la tarea colgada '${ctx.task.id}':`, errorMessage(error));
    }
    void Promise.resolve(this.deps.discovery.notifyTaskEnd?.(ctx.task.id, "cancelled")).catch(() => undefined);
    void recorder.finish();
    this.archive(target.entry);
  }

  private archive(entry: TaskEntry): void {
    this.history.delete(entry.ctx.task.id);
    this.history.set(entry.ctx.task.id, entry);
    while (this.history.size > MAX_RETAINED_TASKS) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }
}