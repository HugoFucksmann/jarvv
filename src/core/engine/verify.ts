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
import { ARGS_REVIEWS, VERIFY_CHECKS } from "../contracts.ts";
import type { ArgsReview, ReviewDecision, VerifyCheckKey } from "../contracts.ts";
import type { EngineEnv } from "./env.ts";
import { knownVerifyAnswers, postconditionOf } from "./postcondition.ts";
import { closeOnFailure, pauseOf, queryModel } from "./failures.ts";
import { runProbes } from "./probes.ts";

type VerifyOutcome =
  | { readonly kind: "verified"; readonly verdict: CallVerdict; readonly reason: VerdictReason | null }
  | { readonly kind: "skipped" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** Una respuesta `noul` aprueba solo si su probabilidad llega a este valor (ante ambigüedad, no se aprueba). Es el corte de `cumple`. */
export const NOUL_APPROVE = 0.6;

/**
 * Corte de `ok` («¿el resultado trae datos o confirma el éxito?»). Más bajo que el de `cumple`: en los datasets de verificación `ok` separa casi sin errores (por debajo de 0,1 no hay
 * ningún «sí» y por encima de 0,1 los «sí» son el 99 %), y con 0,6 rechazaba 11 resultados buenos de 129 contra 2 con 0,3, sin aprobar ninguno malo más (1 en los dos casos). `cumple` sigue en 0,6: en
 * su zona del medio (0,2 a 0,9) el modelo acierta como una moneda y mover el corte solo cambia qué error se comete.
 */
export const OK_APPROVE = 0.3;

/** Corte de cada pregunta de `VERIFY_CHECKS`: la pregunta aprueba solo si su probabilidad llega a él. */
export const VERIFY_APPROVE: Readonly<Record<VerifyCheckKey, number>> = { ok: OK_APPROVE, cumple: NOUL_APPROVE };

/** La revisión de argumentos (D3) aprueba solo si la probabilidad de `approved` es al menos este valor (`reviewOutcome`). */
export const REVIEW_APPROVE = 0.6;

/**
 * Resultado de la revisión de argumentos con umbral: `approved` si su probabilidad llega a `REVIEW_APPROVE`; si no, la opción de
 * rechazo más probable. Sin la probabilidad de `approved` en la respuesta se conserva la opción que eligió el modelo.
 * `approveAt` permite un umbral más estricto (`BUDGET.sensitiveApprove`, comandos del nivel 2 de la lista negra en modo automático).
 */
export function reviewOutcome(decision: Pick<ReviewDecision, "review" | "probabilities">, approveAt: number = REVIEW_APPROVE): ArgsReview {
  const approved = decision.probabilities.approved;
  if (typeof approved !== "number") return decision.review;
  if (approved >= approveAt) return "approved";
  const rejections = ARGS_REVIEWS.filter((r) => r !== "approved");
  return rejections.reduce((best, r) => ((decision.probabilities[r] ?? 0) > (decision.probabilities[best] ?? 0) ? r : best), rejections[0]);
}

/**
 * Veredicto de las respuestas de Decision: aprueba solo si pasan todas las preguntas de `VERIFY_CHECKS`; si no, la razón es
 * la de la primera que no pasa, en el orden de la tabla (5.3).
 */
export function verdictOf(answers: Readonly<Record<VerifyCheckKey, number>>): { verdict: CallVerdict; reason: VerdictReason | null } {
  const failed = VERIFY_CHECKS.find(({ key }) => !(answers[key] >= VERIFY_APPROVE[key]));
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

  // Un veredicto base aprobado pasa por las sondas de la herramienta (`tools/probes.ts`): si una falla, la llamada se rechaza con su motivo.
  const withProbes = async (verdict: CallVerdict, reason: VerdictReason | null): Promise<VerifyOutcome> => {
    if (verdict !== "approved") return record(verdict, reason);
    const probed = await runProbes(env, call);
    if (probed.kind === "cancelled") return { kind: "cancelled" };
    if (probed.kind === "close") return { kind: "close", stopReason: probed.stopReason };
    return probed.kind === "fail" ? record("rejected", probed.reason) : record("approved", null);
  };

  // D3: sin consulta al modelo.
  if (call.status === "tool_error" || call.status === "exception") return record("rejected", "no_usable_data");
  // Una escritura que no halló la ruta o la carpeta no escribió nada: no hay resultado que juzgar.
  if (call.status === "not_found" && call.kind === "write") return record("rejected", "no_usable_data");
  // Sin datos (`no_data`: la herramienta dice que no hubo resultado; en las de lectura, un resultado vacío es un error por política): tampoco hace falta preguntar.
  if (call.status === "no_data") return record("rejected", "no_usable_data");

  // N5: lo que el código puede comprobar no se le pregunta al modelo. Una escritura del catálogo se verifica en el disco: cumplida, se aprueba; no cumplida, se rechaza.
  if (call.status === "ok" && call.kind === "write") {
    const post = postconditionOf(call.tool, call.args, env.deps.disk);
    if (post === "unmet") return record("rejected", "not_accomplished");
    if (post === "met") return withProbes("approved", null);
  }

  const view = verifyInput(ctx.view.forVerify(callId));
  // Lo que el código ya sabe no se le pregunta al modelo (`knownVerifyAnswers`): si lo sabe todo, ni se consulta.
  const known = knownVerifyAnswers(call.tool, call.status, call.summary);
  if (VERIFY_CHECKS.every(({ key }) => known[key] !== undefined)) {
    const { verdict, reason } = verdictOf(known as Record<VerifyCheckKey, number>);
    return withProbes(verdict, reason);
  }
  const query = await queryModel(() => env.decision.verifyResult({ ...view, known }, runtime.signal), pauseOf(env, "decision"));

  if (!query.ok) {
    const closure = closeOnFailure(env, call.stepId, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  // Una cancelación que llega justo con la respuesta: la llamada queda sin veredicto y el paso no sigue.
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };

  const { verdict, reason } = verdictOf(query.value.answers);
  return withProbes(verdict, reason);
}