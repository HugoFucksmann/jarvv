/**
 * JARVIS Core — Verificación del resultado de una llamada (Fase 5, 5.3 y D3).
 *
 * Una sola vía: el modelo de decisión (Decisión 4, `verifyResult`), con las dos preguntas `noul` (`ok`, `cumple`) mapeadas
 * a `reason`: falla `ok` → `no_usable_data`; falla solo `cumple` → `not_accomplished`; si fallan ambas gana
 * `no_usable_data`. Aprueba solo si pasan las dos. El criterio es el del paso (deliberativo) o la solicitud (reactivo).
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
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";

export type VerifyOutcome =
  | { readonly kind: "verified"; readonly verdict: CallVerdict; readonly reason: VerdictReason | null }
  | { readonly kind: "skipped" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** Veredicto de las dos preguntas de Decision: aprueba solo si pasan ambas; la razón sigue la precedencia de 5.3. */
function verdictOf(ok: boolean, cumple: boolean): { verdict: CallVerdict; reason: VerdictReason | null } {
  if (ok && cumple) return { verdict: "approved", reason: null };
  return { verdict: "rejected", reason: ok ? "not_accomplished" : "no_usable_data" };
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

  const { verdict, reason } = verdictOf(query.value.ok, query.value.cumple);
  return record(verdict, reason);
}