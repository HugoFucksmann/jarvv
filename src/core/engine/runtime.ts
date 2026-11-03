/**
 * JARVIS Core — Estado de ejecución de una tarea que NO vive en el contexto (Fase 5).
 *
 * Las esperas del usuario (confirmar el plan, confirmar una mutación, responder una pregunta) son control de flujo del ejecutor: la espera
 * no está en el contexto, solo su resultado (5.3). Este objeto tiene el `AbortController` de la tarea, la espera actual
 * (aprobación o pregunta) y las operaciones con las que la fachada (Fase 7) las resuelve. No emite eventos hacia la UI:
 * expone `onChange` opcional y la Fase 7 lo conecta (D14).
 *
 * Una sola espera a la vez: el ejecutor es secuencial. Cancelar resuelve cualquier espera como `cancelled`.
 */

import type { JsonObject } from "../ctx/index.ts";
import type { Capability } from "../types.ts";
import { newId } from "../utils.ts";

/** Mutación que espera confirmación del usuario. */
export interface ApprovalRequest {
  readonly id: string;
  readonly mcp: string;
  readonly tool: string;
  readonly capability: Capability;
  /** Motivo fijo que da el Guard. */
  readonly reason: string;
  /** Argumentos tal como se registrarán (recortados), no los resueltos: pueden contener el contenido de una ref. */
  readonly args: JsonObject;
}

export type ApprovalOutcome =
  | { readonly kind: "approved" }
  | { readonly kind: "rejected"; readonly instruction: string | null }
  | { readonly kind: "cancelled" };

/** Paso del plan propuesto, tal como lo ve el usuario al confirmarlo. */
export interface PlanStepInfo {
  readonly id: string;
  readonly instruction: string;
  readonly route: string;
  readonly expected: string;
}

/** Plan que espera la confirmación del usuario (deliberativo): tras el plan inicial y tras cada plan `user_feedback`. */
export interface PlanApprovalRequest {
  readonly id: string;
  readonly planId: string;
  readonly steps: readonly PlanStepInfo[];
}

/** `rejected` con `instruction` pide un plan nuevo; sin ella, el rechazo cancela la tarea (FLUJO 6). */
export type PlanApprovalOutcome =
  | { readonly kind: "approved" }
  | { readonly kind: "rejected"; readonly instruction: string | null }
  | { readonly kind: "cancelled" };

export interface PendingQuestion {
  readonly stepId: string;
  readonly question: string;
}

export type QuestionOutcome =
  | { readonly kind: "answered"; readonly answer: string }
  | { readonly kind: "cancelled" };

/** Espera actual de la tarea. */
export type Waiting =
  | { readonly kind: "plan"; readonly request: PlanApprovalRequest }
  | { readonly kind: "approval"; readonly request: ApprovalRequest }
  | { readonly kind: "question"; readonly question: PendingQuestion };

export interface TaskRuntimeOptions {
  /** Se invoca cada vez que cambia la espera (`null` = ya no se espera nada). Un fallo del receptor no afecta al ejecutor. */
  readonly onChange?: (waiting: Waiting | null) => void;
}

interface PendingPlanEntry {
  readonly request: PlanApprovalRequest;
  readonly resolve: (outcome: PlanApprovalOutcome) => void;
}

interface PendingApprovalEntry {
  readonly request: ApprovalRequest;
  readonly resolve: (outcome: ApprovalOutcome) => void;
}

interface PendingQuestionEntry {
  readonly question: PendingQuestion;
  readonly resolve: (outcome: QuestionOutcome) => void;
}

export class TaskRuntime {
  private readonly controller = new AbortController();
  private readonly options: TaskRuntimeOptions;
  private plan: PendingPlanEntry | null = null;
  private approval: PendingApprovalEntry | null = null;
  private question: PendingQuestionEntry | null = null;

  constructor(options: TaskRuntimeOptions = {}) {
    this.options = options;
  }

  /** Señal de cancelación de la tarea: se pasa a los modelos y compite contra `callTool`. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /** Espera actual, o `null`. */
  get waiting(): Waiting | null {
    if (this.plan) return { kind: "plan", request: this.plan.request };
    if (this.approval) return { kind: "approval", request: this.approval.request };
    if (this.question) return { kind: "question", question: this.question.question };
    return null;
  }

  /** Cancela la tarea: aborta la señal y resuelve la espera activa como `cancelled`. Idempotente. */
  cancel(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    const plan = this.plan;
    const approval = this.approval;
    const question = this.question;
    this.plan = null;
    this.approval = null;
    this.question = null;
    plan?.resolve({ kind: "cancelled" });
    approval?.resolve({ kind: "cancelled" });
    question?.resolve({ kind: "cancelled" });
    if (plan || approval || question) this.notify();
  }

  // ─────────── Confirmación del plan ───────────

  /** Espera la decisión del usuario sobre el plan propuesto. Con la tarea ya cancelada resuelve `cancelled` sin esperar. */
  requestPlanApproval(input: Omit<PlanApprovalRequest, "id">): Promise<PlanApprovalOutcome> {
    if (this.cancelled) return Promise.resolve({ kind: "cancelled" });
    this.assertIdle();
    const request: PlanApprovalRequest = { ...input, id: newId("plan") };
    return new Promise<PlanApprovalOutcome>((resolve) => {
      this.plan = { request, resolve };
      this.notify();
    });
  }

  /**
   * Resuelve la confirmación del plan pendiente. Devuelve `false` si no hay una o su `id` no coincide. `instruction` solo
   * se conserva si se rechaza y no está vacía.
   */
  resolvePlanApproval(id: string, approved: boolean, instruction?: string): boolean {
    const entry = this.plan;
    if (!entry || entry.request.id !== id) return false;
    this.plan = null;
    const clean = instruction?.trim() ? instruction.trim() : null;
    entry.resolve(approved ? { kind: "approved" } : { kind: "rejected", instruction: clean });
    this.notify();
    return true;
  }

  // ─────────── Confirmación de una mutación ───────────

  /** Espera la decisión del usuario sobre una mutación. Con la tarea ya cancelada resuelve `cancelled` sin esperar. */
  requestApproval(input: Omit<ApprovalRequest, "id">): Promise<ApprovalOutcome> {
    if (this.cancelled) return Promise.resolve({ kind: "cancelled" });
    this.assertIdle();
    const request: ApprovalRequest = { ...input, id: newId("approval") };
    return new Promise<ApprovalOutcome>((resolve) => {
      this.approval = { request, resolve };
      this.notify();
    });
  }

  /**
   * Resuelve la confirmación pendiente. Devuelve `false` si no hay una o su `id` no coincide (respuesta tardía o de otra
   * solicitud). `instruction` solo se conserva si se rechaza y no está vacía.
   */
  resolveApproval(id: string, approved: boolean, instruction?: string): boolean {
    const entry = this.approval;
    if (!entry || entry.request.id !== id) return false;
    this.approval = null;
    const clean = instruction?.trim() ? instruction.trim() : null;
    entry.resolve(approved ? { kind: "approved" } : { kind: "rejected", instruction: clean });
    this.notify();
    return true;
  }

  // ─────────── Pregunta al usuario (`ask_user`) ───────────

  /** Espera la respuesta del usuario a la pregunta de un paso. Con la tarea ya cancelada resuelve `cancelled`. */
  askUser(question: PendingQuestion): Promise<QuestionOutcome> {
    if (this.cancelled) return Promise.resolve({ kind: "cancelled" });
    this.assertIdle();
    return new Promise<QuestionOutcome>((resolve) => {
      this.question = { question, resolve };
      this.notify();
    });
  }

  /** Responde la pregunta abierta. Una respuesta vacía se ignora (sigue esperando): devuelve `false`, igual que sin pregunta. */
  answer(text: string): boolean {
    const entry = this.question;
    const clean = text.trim();
    if (!entry || clean.length === 0) return false;
    this.question = null;
    entry.resolve({ kind: "answered", answer: clean });
    this.notify();
    return true;
  }

  // ─────────── Internos ───────────

  private assertIdle(): void {
    if (this.plan || this.approval || this.question) throw new Error("TaskRuntime: ya hay una espera activa (el ejecutor es secuencial).");
  }

  private notify(): void {
    try {
      this.options.onChange?.(this.waiting);
    } catch (error) {
      console.error("[TaskRuntime] onChange falló:", error);
    }
  }
}