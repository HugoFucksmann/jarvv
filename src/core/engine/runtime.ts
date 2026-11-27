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

import type {
  ApprovalOutcome,
  ApprovalRequest,
  ModelPause,
  PendingQuestion,
  PlanApprovalOutcome,
  PlanApprovalRequest,
  QuestionOutcome,
  Waiting,
} from "../types/waiting.ts";
import { newId } from "../utils.ts";

interface TaskRuntimeOptions {
  /** Se invoca cada vez que cambia la espera (`null` = ya no se espera nada). Un fallo del receptor no afecta al ejecutor. */
  readonly onChange?: (waiting: Waiting | null) => void;
  /** Se invoca cuando la tarea entra o sale de pausa por modelo no disponible. Un fallo del receptor no afecta al ejecutor. */
  readonly onPause?: (paused: ModelPause | null) => void;
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
  private _paused: ModelPause | null = null;
  /** «Aprobar siempre en esta tarea» y rechazos del usuario: solo en RAM y solo de esta tarea (claves de `policy/approvalKey.ts`). */
  private readonly alwaysApproved = new Set<string>();
  private readonly userRejected = new Set<string>();

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

  /** Pausa actual por modelo no disponible, o `null`. */
  get paused(): ModelPause | null {
    return this._paused;
  }

  /** Marca o limpia la pausa por modelo no disponible. */
  setPaused(paused: ModelPause | null): void {
    if (this._paused === null && paused === null) return;
    if (this._paused !== null && paused !== null && this._paused.since === paused.since && this._paused.model === paused.model) return;
    this._paused = paused;
    this.notifyPause();
  }

  /** Cancela la tarea: aborta la señal y resuelve la espera activa como `cancelled`. Idempotente. */
  cancel(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    const wasPaused = this._paused !== null;
    this._paused = null;
    const plan = this.plan;
    const approval = this.approval;
    const question = this.question;
    this.plan = null;
    this.approval = null;
    this.question = null;
    plan?.resolve({ kind: "cancelled" });
    approval?.resolve({ kind: "cancelled" });
    question?.resolve({ kind: "cancelled" });
    if (wasPaused) this.notifyPause();
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
  resolveApproval(id: string, approved: boolean, instruction?: string, remember = false): boolean {
    const entry = this.approval;
    if (!entry || entry.request.id !== id) return false;
    this.approval = null;
    const clean = instruction?.trim() ? instruction.trim() : null;
    // «Siempre» solo vale si la solicitud lo ofrecía (nunca para lo obligatorio de Guard).
    entry.resolve(approved ? (remember && entry.request.canRemember === true ? { kind: "approved", remember: true } : { kind: "approved" }) : { kind: "rejected", instruction: clean });
    this.notify();
    return true;
  }

  // ─────────── Aprobaciones recordadas en la tarea ───────────

  isAlwaysApproved(key: string): boolean {
    return this.alwaysApproved.has(key);
  }
  rememberApproval(key: string): void {
    this.alwaysApproved.add(key);
  }
  wasRejectedByUser(key: string): boolean {
    return this.userRejected.has(key);
  }
  rememberRejection(key: string): void {
    this.userRejected.add(key);
  }

  // ─────────── Pregunta al usuario (`ask_user`) ───────────

  /** Espera la respuesta del usuario a la pregunta de un paso. Con la tarea ya cancelada resuelve `cancelled`. */
  askUser(input: Omit<PendingQuestion, "id">): Promise<QuestionOutcome> {
    if (this.cancelled) return Promise.resolve({ kind: "cancelled" });
    this.assertIdle();
    const question: PendingQuestion = { ...input, id: newId("question") };
    return new Promise<QuestionOutcome>((resolve) => {
      this.question = { question, resolve };
      this.notify();
    });
  }

  /** Responde la pregunta abierta. Si se indica `id`, debe coincidir con la pregunta vigente. Una respuesta vacía se ignora: devuelve `false`. */
  answer(text: string, id?: string): boolean {
    const entry = this.question;
    const clean = text.trim();
    if (!entry || clean.length === 0) return false;
    if (id !== undefined && entry.question.id !== id) return false;
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

  private notifyPause(): void {
    try {
      this.options.onPause?.(this._paused);
    } catch (error) {
      console.error("[TaskRuntime] onPause falló:", error);
    }
  }
}