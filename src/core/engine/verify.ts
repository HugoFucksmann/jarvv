/**
 * JARVIS Core — Verificación del resultado de una llamada (Fase 5, 5.3 y D3).
 *
 * Una sola vía: el modelo de decisión (Decisión 4, `verifyResult`), con las preguntas `noul` de `VERIFY_CHECKS` (`ok`,
 * `cumple`) mapeadas a `reason`: falla `ok` → `no_usable_data`; falla solo `cumple` → `not_accomplished`; si fallan ambas
 * gana la primera de la tabla (`no_usable_data`). Aprueba solo si pasan todas (`verdictOf`). El criterio es el del paso.
 *
 * - `tool_error` y `exception` se rechazan SIN consultar al modelo, con `no_usable_data` (D3).
 * - `interrupted` y `denied` no se verifican: su `verdict` queda `null`.
 * - Respuesta inválida de Decision: se repite una vez; si persiste, `service_unavailable` (D4). Desborde: `unrecoverable` sin
 *   `error`. Cancelación: la llamada queda ejecutada y sin veredicto.
 * - El veredicto y la razón se escriben juntos en un único `apply` (regla 4).
 */

import type { CallVerdict, VerdictReason } from "../ctx/index.ts";
import { VERIFIABLE_CALL_STATUSES } from "../ctx/index.ts";
import { verifyInput } from "./adapters.ts";
import { ARGS_REVIEWS, VERIFY_CHECKS } from "./deps.ts";
import type { ArgsReview, ReviewDecision, VerifyCheckKey } from "./deps.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";

export type VerifyOutcome =
  | { readonly kind: "verified"; readonly verdict: CallVerdict; readonly reason: VerdictReason | null }
  | { readonly kind: "skipped" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** Una respuesta `noul` aprueba solo si su probabilidad supera este valor (estrictamente; ante ambigüedad, no se aprueba). */
export const NOUL_APPROVE = 0.5;

/** La revisión de argumentos (D3) aprueba solo si la probabilidad de `approved` es al menos este valor (`reviewOutcome`). */
export const REVIEW_APPROVE = 0.6;

/**
 * Resultado de la revisión de argumentos con umbral: `approved` si su probabilidad llega a `REVIEW_APPROVE`; si no, la opción de
 * rechazo más probable. Sin la probabilidad de `approved` en la respuesta se conserva la opción que eligió el modelo.
 */
export function reviewOutcome(decision: Pick<ReviewDecision, "review" | "probabilities">): ArgsReview {
  const approved = decision.probabilities.approved;
  if (typeof approved !== "number") return decision.review;
  if (approved >= REVIEW_APPROVE) return "approved";
  const rejections = ARGS_REVIEWS.filter((r) => r !== "approved");
  return rejections.reduce((best, r) => ((decision.probabilities[r] ?? 0) > (decision.probabilities[best] ?? 0) ? r : best), rejections[0]);
}

/**
 * Veredicto de las respuestas de Decision: aprueba solo si pasan todas las preguntas de `VERIFY_CHECKS`; si no, la razón es
 * la de la primera que no pasa, en el orden de la tabla (5.3).
 */
export function verdictOf(answers: Readonly<Record<VerifyCheckKey, number>>): { verdict: CallVerdict; reason: VerdictReason | null } {
  const failed = VERIFY_CHECKS.find(({ key }) => !(answers[key] > NOUL_APPROVE));
  return failed === undefined ? { verdict: "approved", reason: null } : { verdict: "rejected", reason: failed.reason };
}

export async function verifyCall(env: EngineEnv, callId: string): Promise<VerifyOutcome> {
  const { ctx, runtime } = env;
  const call = ctx.find("calls", { id: callId })[0];
  if (call === undefined) throw new Error(`verifyCall: la llamada ${callId} no existe.`);

  if (!(VERIFIABLE_CALL_STATUSES as readonly string[]).includes(call.status)) return { kind: "skipped" };

  const record = (verdict: CallVerdict, reason: VerdictReason | null): VerifyOutcome => {
    ctx.apply({ op: "update", target: callId, value: { verdict, reason } });
    return { kind: "verified", verdict, reason };
  };

  // D3: sin consulta al modelo.
  if (call.status === "tool_error" || call.status === "exception") return record("rejected", "no_usable_data");

  const input = verifyInput(ctx.view.forVerify(callId));
  const query = await queryModel(() => env.decision.verifyResult(input, runtime.signal));

  if (!query.ok) {
    const closure = closeOnFailure(ctx, call.stepId, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  // Una cancelación que llega justo con la respuesta: la llamada queda sin veredicto y el paso no sigue.
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };

  const { verdict, reason } = verdictOf(query.value.answers);
  return record(verdict, reason);
}