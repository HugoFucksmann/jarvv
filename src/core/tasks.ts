/**
 * JARVIS Core — Fachada de tareas (Fase 7).
 *
 * Es la única puerta entre el exterior (servidor HTTP, UI) y el motor: crea el contexto de cada tarea, lanza `runTask` en
 * segundo plano, expone las respuestas del usuario (plan, mutación, pregunta) y la cancelación, y emite los eventos que el
 * servidor reenvía por SSE. No decide nada del flujo: eso es de `runTask` (PLAN_FLUJO); aquí solo se conecta.
 *
 * - Una tarea = un `TaskContext` + un `TaskRuntime` + un `TaskTraceRecorder`. La traza se conecta por `EngineDeps.sink` y por
 *   `change`; la fachada no la conoce más que para cerrarla.
 * - Eventos: `created`, `change` (las operaciones normalizadas de un `apply`, con su versión `n`) y `waiting` (cambia lo que
 *   espera la tarea del usuario). El estado completo se pide con `get` (`ctx.snapshot()` + `n` + espera).
 * - Un error de programación dentro de `runTask` no deja la tarea colgada: se cierra con `unrecoverable` y respuesta de respaldo.
 * - Retención: como máximo `MAX_RETAINED_TASKS`; se expulsan las terminales más antiguas y, si aun así se excede, se cancela
 *   la tarea en espera más antigua (abandonada).
 */

import fs from "node:fs";
import { BUDGET } from "./budget.ts";
import { create, terminalStateFor } from "./ctx/index.ts";
import type {
  ContextData,
  ContextLimits,
  ContextOptions,
  NormalizedOp,
  Op,
  StopReason,
  TaskContext,
  TaskMode,
  TaskState,
} from "./ctx/index.ts";
import type { EngineDeps, EngineLLM, IActionDecision, IDiscoveryEngine, PreviousTask } from "./contracts.ts";
import { previousTaskOf, THREAD_TTL_MS } from "./engine/thread.ts";
import type { EngineServices } from "./engine/services.ts";
import { createEngineServices } from "./engine/services.ts";
import type { ConfigSource } from "./config.ts";
import { runTask } from "./engine/runTask.ts";
import { TaskRuntime } from "./engine/runtime.ts";
import type { ModelPause, Waiting } from "./engine/runtime.ts";
import { renderFallback } from "./render/index.ts";
import { windowOptions } from "./engine/adapters.ts";
import { listTaskLogFiles, openTaskLog, readTaskLog, summarizeClosedTaskLog, taskLogPath, tasksDirFromSource } from "./taskLog.ts";
import { argsMax } from "./tools/manifest.ts";
import { TaskTraceRecorder } from "./trace/recorder.ts";
import { MAX_RETAINED_TASKS } from "./types/limits.ts";
import { errorMessage, newId } from "./utils.ts";

export const RESTART_RESULT_TEXT = "El servidor se reinició mientras la tarea corría";

/** Motores que recibe la fachada; los construye la raíz de composición (server.ts). */
export interface TaskManagerDeps {
  readonly decision: IActionDecision;
  readonly discovery: IDiscoveryEngine;
  readonly llm: EngineLLM;
}

/** Estado completo de una tarea: el snapshot del contexto, su versión y lo que espera del usuario. */
export interface TaskDto extends ContextData {
  /** Versión del contexto (`ctx.n`): los eventos `change` traen la suya, para detectar saltos. */
  n: number;
  waiting: Waiting | null;
  paused: ModelPause | null;
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
  | { readonly type: "created"; readonly taskId: string; readonly n: number; readonly summary: TaskSummary }
  | { readonly type: "change"; readonly taskId: string; readonly n: number; readonly at: number; readonly ops: readonly Readonly<NormalizedOp>[] }
  | { readonly type: "waiting"; readonly taskId: string; readonly waiting: Waiting | null }
  | { readonly type: "paused"; readonly taskId: string; readonly paused: ModelPause | null };

export type TaskListener = (event: TaskEvent) => void;

/** Resultado de una orden del usuario: el servidor lo traduce a HTTP (404, 409). */
export type ControlResult = "ok" | "unknown_task" | "not_waiting";

interface TaskEntry {
  readonly ctx: TaskContext;
  readonly runtime: TaskRuntime;
  readonly recorder?: TaskTraceRecorder;
}

export class TaskManager {
  /** Caché en RAM (máximo `MAX_RETAINED_TASKS`); las tareas anteriores se reconstruyen desde su log bajo demanda. */
  private readonly tasks = new Map<string, TaskEntry>();
  /** Resumen en memoria de todas las tareas válidas conocidas (en caché o en disco), para `list()`. */
  private readonly summaries = new Map<string, TaskSummary>();
  /** Tareas cuyo log resultó ilegible al arrancar o consultar (no se cargan a medias; el archivo se conserva en disco). */
  private readonly unreadable = new Map<string, string>();
  /** Tareas que estaban abiertas al arrancar y se cerraron con `restart`. */
  private readonly restartedOnStartup: TaskSummary[] = [];
  private readonly listeners = new Set<TaskListener>();
  /** Ejecuciones en curso (con la escritura de su traza). */
  private readonly inFlight = new Set<Promise<void>>();
  /** Hilo (`engine/thread.ts`): la última tarea completada con respuesta del modelo, en RAM; vence a los `THREAD_TTL_MS`. */
  private previous: { readonly id: string; readonly task: PreviousTask; readonly at: number } | null = null;
  private readonly tasksDir: string;
  private readonly contextLimits: ContextLimits = {
    summaryMax: BUDGET.summaryMax,
    argsStringMax: argsMax(BUDGET.argsStringDefault),
    factValueMax: BUDGET.factValueMax,
    feedbackMax: BUDGET.feedbackMax,
    jsonMaxDepth: BUDGET.jsonMaxDepth,
    recalledKeyMax: BUDGET.recalledKeyMax,
    recalledValueMax: BUDGET.recalledValueMax,
    threadValueMax: BUDGET.threadValueMax,
  };
  private readonly onListenerError = (error: unknown): void => {
    console.error("[Tasks] un suscriptor de `change` falló:", errorMessage(error));
  };

  constructor(
    private readonly deps: TaskManagerDeps,
    private readonly getConfig: ConfigSource,
    private readonly services: EngineServices = createEngineServices(getConfig),
  ) {
    this.tasksDir = tasksDirFromSource(this.getConfig);
    this.restoreFromDisk();
  }

  addEventListener(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tareas que estaban no terminales al arrancar el servidor y se cerraron con motivo `restart`. */
  interruptedOnStartup(): readonly TaskSummary[] {
    return [...this.restartedOnStartup];
  }

  // ─────────── Ciclo de vida ───────────

  /** Tareas sin cerrar (en curso o esperando al usuario). */
  activeCount(): number {
    let active = 0;
    for (const { ctx } of this.tasks.values()) if (!ctx.isClosed()) active++;
    return active;
  }

  /** Crea la tarea y la lanza en segundo plano. Devuelve su estado inicial. */
  start(message: string, mode: TaskMode): TaskDto {
    const id = newId("task");
    const startedAt = Date.now();
    let created = false;
    const log = openTaskLog(this.tasksDir, {
      id,
      mode,
      request: message,
      startedAt,
      limits: this.contextLimits,
    });
    const options: ContextOptions = {
      ...this.contextLimits,
      now: () => {
        if (!created) {
          created = true;
          return startedAt;
        }
        return Date.now();
      },
      onApply: log.onApply,
      onListenerError: this.onListenerError,
    };
    const ctx = create.context({ id, request: message, mode }, options);
    const recorder = new TaskTraceRecorder(ctx, this.getConfig);
    const runtime = new TaskRuntime({
      onChange: (waiting) => {
        recorder.onWaiting(waiting);
        this.summaries.set(id, this.summaryOf(ctx, waiting));
        this.emit({ type: "waiting", taskId: id, waiting });
      },
      onPause: (paused) => {
        recorder.onPaused(paused);
        this.emit({ type: "paused", taskId: id, paused });
      },
    });
    const entry: TaskEntry = { ctx, runtime, recorder };

    const summary = this.summaryOf(ctx, runtime.waiting);
    this.tasks.set(id, entry);
    this.summaries.set(id, summary);
    ctx.on("change", (event) => {
      this.summaries.set(id, this.summaryOf(ctx, runtime.waiting));
      this.emit({ type: "change", taskId: id, n: event.n, at: event.at, ops: event.ops });
    });
    this.prune();
    this.emit({ type: "created", taskId: id, n: ctx.n, summary });

    console.log(`[Task] start id=${id} mode=${mode}`);
    const previousActive = this.previous !== null && Date.now() - this.previous.at < THREAD_TTL_MS ? this.previous : null;
    const previousTask = previousActive?.task ?? null;
    const previousTaskId = previousActive?.id ?? null;
    const deps: EngineDeps = { ...this.deps, ...this.services, sink: recorder.sink, previousTask, previousTaskId };
    // La ejecución incluye la escritura de la traza (asíncrona, después de la respuesta): `drain` espera a ambas al apagar el servidor.
    const run: Promise<void> = runTask(ctx, runtime, deps)
      .catch((error: unknown) => this.closeOnDefect(entry, error))
      .then(() => this.remember(ctx))
      .finally(() => recorder.finish())
      .finally(() => void this.inFlight.delete(run));
    this.inFlight.add(run);

    return this.toDto(entry);
  }

  /** Guarda la tarea para el hilo si terminó completada con una respuesta del modelo (no la de respaldo, que es texto fijo). */
  private remember(ctx: TaskContext): void {
    const result = ctx.result;
    if (ctx.task.state !== "completed" || result === null || result.origin !== "model") return;
    this.previous = { id: ctx.task.id, task: previousTaskOf(ctx.task.request, result.text), at: Date.now() };
  }

  /** Cancela la tarea: aborta lo que esté en curso y resuelve la espera. El cierre (`user_cancelled`) lo escribe `runTask`. */
  cancel(taskId: string): ControlResult {
    const entry = this.tasks.get(taskId);
    if (!entry) return "unknown_task";
    if (entry.ctx.isClosed()) return "not_waiting";
    entry.runtime.cancel();
    return "ok";
  }

  /**
   * Espera a que terminen las ejecuciones en curso (cierre de la tarea, cierre de sus procesos en segundo plano y escritura de la traza),
   * hasta `timeoutMs`. Se usa después de `cancelAll`, antes de apagar los servidores MCP.
   */
  async drain(timeoutMs: number): Promise<void> {
    if (this.inFlight.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([Promise.allSettled([...this.inFlight]), limit]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Cancela todas las tareas abiertas (cierre del servidor). */
  cancelAll(): void {
    for (const entry of this.tasks.values()) if (!entry.ctx.isClosed()) entry.runtime.cancel();
  }

  // ─────────── Lectura ───────────

  get(taskId: string): TaskDto | null {
    const entry = this.tasks.get(taskId);
    if (entry) return this.toDto(entry);
    const ctx = this.loadFromDisk(taskId);
    return ctx ? { ...ctx.snapshot(), n: ctx.n, waiting: null, paused: null } : null;
  }

  /** Texto completo de una ref de la tarea. La ruta sale del contexto, nunca del pedido, y el almacén solo lee dentro de su carpeta. */
  async readRef(taskId: string, refId: string): Promise<{ readonly text: string } | "unknown_task" | "unknown_ref" | "unavailable"> {
    const ctx = this.tasks.get(taskId)?.ctx ?? this.loadFromDisk(taskId);
    if (!ctx) return "unknown_task";
    const ref = ctx.snapshot().refs.find((r) => r.id === refId);
    if (!ref) return "unknown_ref";
    try {
      return { text: await this.services.vault.readAll(ref.where) };
    } catch (error) {
      console.warn(`[Tasks] no se pudo leer la ref ${refId}: ${errorMessage(error)}`);
      return "unavailable";
    }
  }

  /** Ids de las tareas retenidas en memoria (la retención en disco no borra sus refs ni su log). */
  taskIds(): string[] {
    return [...this.tasks.keys()];
  }

  list(): TaskSummary[] {
    const out: TaskSummary[] = [];
    for (const [id, summary] of this.summaries) {
      if (!this.tasks.has(id) && !fs.existsSync(taskLogPath(this.tasksDir, id))) {
        this.summaries.delete(id);
        continue;
      }
      out.push(summary);
    }
    return out;
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

  /** Acepta la mutación que espera confirmación; con `remember`, también las idénticas (misma herramienta y mismo comando o ruta) durante esta tarea. */
  approveCall(taskId: string, waitId?: string, remember = false): ControlResult {
    return this.control(taskId, "approval", waitId, (runtime, id) => runtime.resolveApproval(id, true, undefined, remember));
  }

  /** Rechaza la mutación, con una instrucción opcional que el motor deja a la vista del modelo. */
  denyCall(taskId: string, instruction?: string, waitId?: string): ControlResult {
    return this.control(taskId, "approval", waitId, (runtime, id) => runtime.resolveApproval(id, false, instruction));
  }

  /** Responde la pregunta abierta. `waitId` (opcional) debe coincidir con `question.id` si se envía. Una respuesta vacía no se aplica (`not_waiting`). */
  answer(taskId: string, text: string, waitId?: string): ControlResult {
    const entry = this.tasks.get(taskId);
    if (!entry) return "unknown_task";
    const waiting = entry.runtime.waiting;
    if (waiting === null || waiting.kind !== "question") return "not_waiting";
    if (waitId !== undefined && waitId !== waiting.question.id) return "not_waiting";
    return entry.runtime.answer(text, waiting.question.id) ? "ok" : "not_waiting";
  }

  // ─────────── Internos ───────────

  /**
   * Al arrancar: las `MAX_RETAINED_TASKS` tareas más recientes se reproducen completas (quedan en la caché de RAM) y cualquier tarea que no esté cerrada y con respuesta se
   * cierra con `restart`. El resto, ya cerradas, se listan leyendo solo cabecera y los dos últimos registros (`summarizeClosedTaskLog`): reproducir todos los logs
   * (hasta `retentionDays` y `retentionMaxMb`) demoraría el arranque. Un log viejo que ese resumen no entiende sí se reproduce completo.
   */
  private restoreFromDisk(): void {
    const files = listTaskLogFiles(this.tasksDir);
    const firstRecent = Math.max(0, files.length - MAX_RETAINED_TASKS);

    files.forEach(({ taskId, filePath }, index) => {
      const recent = index >= firstRecent;
      if (!recent) {
        const closed = summarizeClosedTaskLog(filePath);
        if (closed !== null) {
          this.summaries.set(taskId, {
            id: closed.id,
            mode: closed.mode,
            request: closed.request,
            state: closed.state,
            stopReason: closed.stopReason,
            startedAt: closed.startedAt,
            n: closed.n,
            waiting: null,
          });
          return;
        }
      }
      const result = readTaskLog(filePath, { onListenerError: this.onListenerError, attachLiveWriter: true });
      if (!result.ok) {
        this.unreadable.set(result.id, result.reason);
        console.warn(`[Tasks] log ilegible '${result.id}' (${filePath}): ${result.reason}`);
        return;
      }
      const { ctx } = result;
      if (!ctx.isClosed() || ctx.result === null) {
        this.closeOnRestart(ctx);
        this.restartedOnStartup.push(this.summaryOf(ctx, null));
      }
      this.summaries.set(taskId, this.summaryOf(ctx, null));
      if (recent) this.tasks.set(taskId, { ctx, runtime: new TaskRuntime({ onChange: () => undefined }) });
    });
  }

  private closeOnRestart(ctx: TaskContext): void {
    try {
      if (!ctx.isClosed()) {
        const ops: Op[] = [];
        for (const step of ctx.find("steps", { state: "running" })) {
          ops.push({ op: "update", target: step.id, value: { state: "failed" } });
        }
        const calls = ctx.find("calls", {});
        ops.push({ op: "finish", target: "task", value: { state: terminalStateFor("restart", calls), stopReason: "restart" } });
        ctx.apply(ops, { reason: "restart" });
      }
      if (ctx.result === null) {
        ctx.apply({ op: "set", target: "result", value: { text: RESTART_RESULT_TEXT, origin: "fallback" } }, { reason: "restart" });
      }
    } catch (error) {
      console.error(`[Tasks] no se pudo cerrar '${ctx.task.id}' tras reinicio:`, errorMessage(error));
    }
  }

  private loadFromDisk(taskId: string): TaskContext | null {
    if (this.unreadable.has(taskId)) return null;
    const filePath = taskLogPath(this.tasksDir, taskId);
    if (!fs.existsSync(filePath)) return null;
    const result = readTaskLog(filePath, { onListenerError: this.onListenerError });
    if (!result.ok) {
      this.unreadable.set(taskId, result.reason);
      console.warn(`[Tasks] log ilegible '${taskId}' (${filePath}): ${result.reason}`);
      return null;
    }
    return result.ctx;
  }

  private summaryOf(ctx: TaskContext, waiting: Waiting | null): TaskSummary {
    return {
      id: ctx.task.id,
      mode: ctx.task.mode,
      request: ctx.task.request,
      state: ctx.task.state,
      stopReason: ctx.task.stopReason,
      startedAt: ctx.task.startedAt,
      n: ctx.n,
      waiting: waiting?.kind ?? null,
    };
  }

  private control(
    taskId: string,
    kind: "plan" | "approval",
    waitId: string | undefined,
    resolve: (runtime: TaskRuntime, id: string) => boolean,
  ): ControlResult {
    const entry = this.tasks.get(taskId);
    if (!entry) return "unknown_task";
    const waiting = entry.runtime.waiting;
    if (waiting === null || waiting.kind !== kind) return "not_waiting";
    if (waitId !== undefined && waitId !== waiting.request.id) return "not_waiting";
    return resolve(entry.runtime, waiting.request.id) ? "ok" : "not_waiting";
  }

  private toDto({ ctx, runtime }: TaskEntry): TaskDto {
    return { ...ctx.snapshot(), n: ctx.n, waiting: runtime.waiting, paused: runtime.paused };
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

  /** Tope de tareas retenidas: expulsa las terminales con respuesta y, si aun así se excede, cancela la espera más antigua. */
  private prune(): void {
    this.evictFinished();
    if (this.tasks.size <= MAX_RETAINED_TASKS) return;
    const abandoned = [...this.tasks.values()].find((e) => e.runtime.waiting !== null);
    if (!abandoned) return;
    console.warn(`[Tasks] Tope de ${MAX_RETAINED_TASKS} tareas: se cancela la tarea en espera más antigua '${abandoned.ctx.task.id}'.`);
    abandoned.runtime.cancel(); // cierra de forma asíncrona: se expulsa en la próxima tarea
  }

  private evictFinished(): void {
    for (const [id, entry] of this.tasks) {
      if (this.tasks.size <= MAX_RETAINED_TASKS) return;
      if (entry.ctx.isClosed() && entry.ctx.result !== null) this.tasks.delete(id);
    }
  }
}