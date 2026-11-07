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

import { BUDGET } from "./budget.ts";
import { create, terminalStateFor } from "./ctx/index.ts";
import type { ContextData, ContextOptions, NormalizedOp, StopReason, TaskContext, TaskMode, TaskState } from "./ctx/index.ts";
import type { EngineDeps, EngineLLM, EngineServices, IActionDecision, IDiscoveryEngine } from "./engine/deps.ts";
import { createEngineServices } from "./engine/deps.ts";
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

interface TaskEntry {
  readonly ctx: TaskContext;
  readonly runtime: TaskRuntime;
  readonly recorder: TaskTraceRecorder;
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskEntry>();
  private readonly listeners = new Set<TaskListener>();
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
    private readonly services: EngineServices = createEngineServices(),
  ) { }

  addEventListener(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ─────────── Ciclo de vida ───────────

  /** Crea la tarea y la lanza en segundo plano. Devuelve su estado inicial. */
  start(message: string, mode: TaskMode): TaskDto {
    const id = newId("task");
    const ctx = create.context({ id, request: message, mode }, this.contextOptions);
    const recorder = new TaskTraceRecorder(ctx);
    const runtime = new TaskRuntime({
      onChange: (waiting) => {
        recorder.onWaiting(waiting);
        this.emit({ type: "waiting", taskId: id, waiting });
      },
    });
    const entry: TaskEntry = { ctx, runtime, recorder };

    this.tasks.set(id, entry);
    ctx.on("change", (event) => this.emit({ type: "change", taskId: id, n: event.n, at: event.at, ops: event.ops }));
    this.prune();
    this.emit({ type: "created", taskId: id, n: ctx.n });

    console.log(`[Task] start id=${id} mode=${mode}`);
    const deps: EngineDeps = { ...this.deps, ...this.services, sink: recorder.sink };
    void runTask(ctx, runtime, deps)
      .catch((error: unknown) => this.closeOnDefect(entry, error))
      .finally(() => recorder.finish());

    return this.toDto(entry);
  }

  /** Cancela la tarea: aborta lo que esté en curso y resuelve la espera. El cierre (`user_cancelled`) lo escribe `runTask`. */
  cancel(taskId: string): ControlResult {
    const entry = this.tasks.get(taskId);
    if (!entry) return "unknown_task";
    if (entry.ctx.isClosed()) return "not_waiting";
    entry.runtime.cancel();
    return "ok";
  }

  /** Cancela todas las tareas abiertas (cierre del servidor). */
  cancelAll(): void {
    for (const entry of this.tasks.values()) if (!entry.ctx.isClosed()) entry.runtime.cancel();
  }

  // ─────────── Lectura ───────────

  get(taskId: string): TaskDto | null {
    const entry = this.tasks.get(taskId);
    return entry ? this.toDto(entry) : null;
  }

  /** Tareas retenidas, de la más antigua a la más reciente. */
  /** Texto completo de una ref de la tarea. La ruta sale del contexto, nunca del pedido, y el almacén solo lee dentro de su carpeta. */
  async readRef(taskId: string, refId: string): Promise<{ readonly text: string } | "unknown_task" | "unknown_ref" | "unavailable"> {
    const entry = this.tasks.get(taskId);
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

  list(): TaskSummary[] {
    return [...this.tasks.values()].map(({ ctx, runtime }) => ({
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
    const entry = this.tasks.get(taskId);
    if (!entry) return "unknown_task";
    return entry.runtime.waiting?.kind === "question" && entry.runtime.answer(text) ? "ok" : "not_waiting";
  }

  // ─────────── Internos ───────────

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