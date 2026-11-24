/**
 * JARVIS Core — Qué espera una tarea del usuario: un plan que confirmar, una operación que aprobar o una pregunta que responder; y la pausa por un modelo caído.
 *
 * Son solo datos: los produce el ejecutor (`engine/runtime.ts`) y los leen quienes muestran la espera (la traza, la API, Telegram). Viven acá para que esos
 * lectores no dependan del motor.
 */

import type { JsonObject } from "../ctx/index.ts";
import type { ListLevel } from "../policy/blacklist.ts";
import type { ApprovalTier } from "../policy/tiers.ts";
import type { Capability } from "../types.ts";

/** Regla de la lista negra asociada a una solicitud de aprobación. */
export interface ApprovalBlacklist {
  readonly id: string;
  readonly level: ListLevel;
}

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
  /** ¿Se ofrece «aprobar siempre en esta tarea»? Falso para lo obligatorio de Guard, la lista negra y lo que no se pudo resolver: solo admiten «una vez». */
  readonly canRemember?: boolean;
  /** Nivel de riesgo de la escritura (`green` | `yellow` | `red`). */
  readonly tier?: ApprovalTier;
  /** Regla de lista negra que motivó o condicionó la aprobación. */
  readonly blacklist?: ApprovalBlacklist;
}

export type ApprovalOutcome =
  | { readonly kind: "approved"; readonly remember?: boolean }
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

export type QuestionSource = "model" | "process";

export interface PendingQuestion {
  readonly id: string;
  readonly stepId: string;
  readonly question: string;
  readonly source: QuestionSource;
  readonly pid?: string;
}

export type QuestionOutcome =
  | { readonly kind: "answered"; readonly answer: string }
  | { readonly kind: "cancelled" };

/** Espera actual de la tarea. */
export type Waiting =
  | { readonly kind: "plan"; readonly request: PlanApprovalRequest }
  | { readonly kind: "approval"; readonly request: ApprovalRequest }
  | { readonly kind: "question"; readonly question: PendingQuestion };

/** Pausa temporal de la tarea mientras un modelo no está disponible (§6.1). */
export interface ModelPause {
  readonly since: number;
  readonly model: string;
}
