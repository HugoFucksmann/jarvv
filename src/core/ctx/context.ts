/**
 * `TaskContext`: el contexto de una tarea. Fachada fina sobre los módulos del paquete:
 * escritura (`apply`), lectura (`get`, `find`, `current`), derivaciones y vistas (`view`, `isRepeat`, contadores),
 * eventos (`on`) y persistencia (`snapshot`).
 *
 * Un solo escritor por tarea y todo síncrono: no hace falta control de concurrencia (sección 4).
 * No conoce herramientas, modelos ni traza (principio 5): quien lo usa le pasa los datos ya resueltos.
 */

import { prepareBatch } from "./apply.ts";
import { canFinish as canFinishOf, hasApprovedCall as hasApprovedCallOf } from "./closure.ts";
import {
  callsInStep as callsInStepOf,
  effectsOf,
  escalationCount,
  questionsAsked as questionsAskedOf,
  nextAnswerKey as nextAnswerKeyOf,
  isRepeat as isRepeatOf,
  possibleEffectsOf,
  recentWindowSize,
  replansDone as replansDoneOf,
} from "./derive.ts";
import type { RepeatOptions } from "./derive.ts";
import { ContextError } from "./errors.ts";
import { currentOf, findElements, getElement } from "./query.ts";
import { cloneData } from "./snapshot.ts";
import { checkMeta } from "./validate.ts";
import {
  buildArgsView,
  buildAskView,
  buildFallbackView,
  buildFinalView,
  buildPendingView,
  buildPlanView,
  buildReviewView,
  buildRouteView,
  buildVerifyView,
} from "./views/index.ts";
import type { ContextViews } from "./views/types.ts";
import type {
  ApplyResult,
  Call,
  ChangeEvent,
  ChangeMeta,
  ContextData,
  ContextElement,
  ContextLimits,
  ContextOptions,
  CurrentView,
  ElementOf,
  Op,
  ResultEntry,
  SectionName,
  TaskInfo,
} from "./types.ts";

export type ChangeListener = (event: ChangeEvent) => void;

export class TaskContext {
  private data: ContextData;
  private counter = 0;
  private emitting = false;
  private readonly listeners = new Set<ChangeListener>();
  private readonly now: () => number;
  private readonly limits: ContextLimits;
  private readonly onListenerError: ((error: unknown) => void) | undefined;

  /** `ctx.view.<vista>(...)` (sección 8): objetos estructurados de solo lectura; el texto lo arman los renderizadores. */
  readonly view: ContextViews = {
    forPlan: (options) => buildPlanView(this.data, options),
    forRoute: (options) => buildRouteView(this.data, options),
    forArgs: (options) => buildArgsView(this.data, options),
    forAsk: () => buildAskView(this.data),
    forPending: (previous, options) => buildPendingView(this.data, previous, options),
    forReview: (options) => buildReviewView(this.data, options),
    forVerify: (callId) => buildVerifyView(this.data, callId),
    forFinal: (options) => buildFinalView(this.data, options),
    forFallback: (options) => buildFallbackView(this.data, options),
  };

  constructor(data: ContextData, options: ContextOptions) {
    this.data = data;
    this.now = options.now;
    this.limits = {
      summaryMax: options.summaryMax,
      argsStringMax: options.argsStringMax,
      factValueMax: options.factValueMax,
      feedbackMax: options.feedbackMax,
      jsonMaxDepth: options.jsonMaxDepth,
    };
    this.onListenerError = options.onListenerError;
  }

  // ─────────── Versión y estado ───────────

  /** Versión actual: contador interno de `apply`. Fuera del JSON y no se persiste. */
  get n(): number {
    return this.counter;
  }

  /** Identidad y estado de la tarea (solo lectura). */
  get task(): Readonly<TaskInfo> {
    return this.data.task;
  }

  /** Respuesta final; `null` hasta que exista (solo lectura). */
  get result(): Readonly<ResultEntry> | null {
    return this.data.result;
  }

  /** ¿La tarea llegó a un estado terminal? Quien ejecuta lo consulta para descartar eventos tardíos (5.3). */
  isClosed(): boolean {
    return this.data.task.state !== "running";
  }

  // ─────────── Escritura ───────────

  /**
   * Única puerta de escritura. Una operación o un arreglo; el arreglo se aplica completo o no se aplica:
   * ante cualquier error lanza `ContextError`, no cambia nada y no emite evento.
   */
  apply(ops: Op | readonly Op[], meta?: ChangeMeta): ApplyResult {
    if (this.emitting) {
      throw new ContextError("reentrant", null, "`apply` no se puede llamar dentro de un suscriptor de `change`");
    }
    const changeMeta = checkMeta(meta);
    const at = this.now();
    const batch = prepareBatch(this.data, ops, at, this.limits);
    batch.commit();
    this.counter += 1;
    const event: ChangeEvent = Object.freeze({
      n: this.counter,
      at,
      ops: Object.freeze(batch.ops),
      meta: changeMeta === null ? null : Object.freeze(changeMeta),
    });
    this.emit(event);
    return { n: this.counter, ids: batch.ids };
  }

  // ─────────── Eventos ───────────

  /**
   * Suscripción a `change`. Los suscriptores son de solo lectura: no pueden llamar a `apply` y, si fallan, el
   * cambio no se revierte (el error va a `onListenerError`). Devuelve la función que cancela la suscripción.
   */
  on(event: "change", listener: ChangeListener): () => void {
    if (event !== "change") throw new ContextError("malformed_op", null, `evento desconocido "${String(event)}"`);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ChangeEvent): void {
    this.emitting = true;
    try {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (error) {
          this.onListenerError?.(error);
        }
      }
    } finally {
      this.emitting = false;
    }
  }

  // ─────────── Lectura ───────────

  /** Un elemento por `id` (`facts.<clave>` para un hecho); `undefined` si no existe. */
  get(id: string): Readonly<ContextElement> | undefined {
    return getElement(this.data, id);
  }

  /** Elementos de una sección que cumplen la igualdad de campos de `where`, incluidos los reemplazados por un replan. */
  find<S extends SectionName>(section: S, where: Partial<ElementOf<S>>): readonly ElementOf<S>[] {
    return findElements(this.data, section, where);
  }

  /** `{ step, lastCall }`: el paso vigente `running` (o el primer vigente `pending`) y la última llamada. */
  current(): CurrentView {
    return currentOf(this.data);
  }

  // ─────────── Consultas para el control de ejecución (8.6) ───────────

  /**
   * Anti-loop (5.4): ¿ejecutar `tool` con `sig` repite una llamada ejecutada anterior? Con `exempt = true` (la
   * exención la resuelve quien ejecuta con el catálogo) devuelve `false` sin comparar.
   */
  isRepeat(tool: string, sig: string | null, options: RepeatOptions): boolean {
    return isRepeatOf(this.data, tool, sig, options);
  }

  /** Cierre del reactivo (5.4): `completed`, `no_alternatives` o `null` (todavía no se puede cerrar). */
  canFinish(): "completed" | "no_alternatives" | null {
    return this.data.task.mode === "reactive" ? canFinishOf(this.data.calls) : null;
  }

  /** ¿Existe una llamada con `verdict = approved`, de cualquier `status`? */
  hasApprovedCall(): boolean {
    return hasApprovedCallOf(this.data.calls);
  }

  // ─────────── Derivaciones (5.4) ───────────

  /** Efectos: llamadas `write` con `status = ok`, sin tope. */
  effects(): readonly Call[] {
    return effectsOf(this.data.calls);
  }

  /** Posibles efectos: `write` con `tool_error`, `exception` o `interrupted`. */
  possibleEffects(): readonly Call[] {
    return possibleEffectsOf(this.data.calls);
  }

  /** Llamadas del paso para el tope por paso (sin `user_rejected`). */
  callsInStep(stepId: string): number {
    return callsInStepOf(this.data.calls, stepId);
  }

  /** Preguntas ya hechas al usuario en el paso (hechos `answer_*` del paso). */
  questionsAsked(stepId: string): number {
    return questionsAskedOf(this.data.facts, stepId);
  }

  /** Clave del hecho de la siguiente respuesta del paso: `answer_<stepId>_<n>`. */
  nextAnswerKey(stepId: string): string {
    return nextAnswerKeyOf(this.data.facts, stepId);
  }

  /** Replans realizados: planes con `trigger = step_failure`. */
  replansDone(): number {
    return replansDoneOf(this.data.plans);
  }

  /** Escalaciones: pasos `failed`, incluidos los reemplazados. */
  escalations(): number {
    return escalationCount(this.data.steps);
  }

  /** Tamaño de las ventanas recientes según las escalaciones (9). */
  recentWindow(recentWindows: readonly number[]): number {
    return recentWindowSize(this.data.steps, recentWindows);
  }

  // ─────────── Persistencia ───────────

  /** Copia profunda en JSON plano; no comparte nada con el contexto vivo. */
  snapshot(): ContextData {
    return cloneData(this.data);
  }
}