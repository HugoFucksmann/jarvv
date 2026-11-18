/**
 * JARVIS Core — Confirmación del usuario y revisión de argumentos de una llamada ya autorizada (`runCall`, fases 7 y 8).
 *
 * Reciben la llamada preparada y la autorización (`authorize`) y devuelven si la llamada sigue (`pass`), se rechaza (`reject`, que `runCall` registra) o hay que
 * detenerse con un `CallOutcome` (`stop`: cancelación, o un modelo caído). Ninguna registra nada: eso es de `runCall`.
 *
 * - `confirmIfNeeded` (fase 7): si la autorización lo exige, le pide al usuario que apruebe, después del pre-chequeo (no se le pide aprobar lo que ya se sabe inválido).
 *   No hay registro mientras se espera; cancelar acá no deja llamada. Si aprueba, la aprobación es la revisión y D3 no entra.
 * - `reviewIfNeeded` (fase 8, Decisión 3): solo en las escrituras que el usuario no aprobó ni escribió, y que no son verdes.
 */

import { BUDGET } from "../budget.ts";
import { approvalKey } from "../policy/approvalKey.ts";
import type { Authorization, Rejection } from "./callAuthorize.ts";
import { CANCELLED, fromFailure } from "./callRecord.ts";
import type { PreparedCall } from "./callRecord.ts";
import { reviewInput, reviewViewOptions } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import { pauseOf, queryModel } from "./failures.ts";
import type { CallOutcome } from "./outcomes.ts";
import { reviewOutcome } from "./verify.ts";

/** La llamada sigue, se rechaza (la registra `runCall`) o hay que detenerse con este resultado. */
export type Gate = { readonly kind: "pass" } | Rejection | { readonly kind: "stop"; readonly outcome: CallOutcome };

const PASS: Gate = { kind: "pass" };
const STOP_CANCELLED: Gate = { kind: "stop", outcome: CANCELLED };
const reject = (status: Rejection["status"], summary: string | null = null): Rejection => ({ kind: "reject", status, summary });

const REPEATED_REJECTION_NOTE = "The user already rejected this exact operation in this task. Do not ask again: use a different approach or say what could not be done.";

/** Motivo fijo de un `args_invalid` de la revisión (D3): el modelo de decisión solo elige la opción, no dice qué argumento falla. */
export const REVIEW_ARGS_INVALID_NOTE =
  "The review found a wrong argument: a value is invented, copied incorrectly, or contradicts the task or the data read. Write the arguments again from the task and the data.";

/** Fase 7. Confirmación del usuario, si la autorización la exige. */
export async function confirmIfNeeded(env: EngineEnv, call: PreparedCall, auth: Authorization): Promise<Gate> {
  const { ctx, runtime } = env;
  if (!auth.askUser) return PASS;

  const { guard, tier, listed, allowedUnresolvableReason } = auth;
  // «Siempre en esta tarea» no se ofrece para lo obligatorio de Guard, la lista negra ni lo que no se pudo resolver: esos solo admiten «una vez».
  const canRemember = guard.mandatory !== true && listed === null && allowedUnresolvableReason === null;
  const key = approvalKey(call.tool.name, call.resolved);
  // El usuario ya rechazó exactamente esto en esta tarea: no se le vuelve a preguntar.
  if (runtime.wasRejectedByUser(key)) return reject("user_rejected", REPEATED_REJECTION_NOTE);
  // Ya lo aprobó «siempre» en esta tarea: se omite la pregunta (la aprobación sustituye a D3, igual que si lo hubiera aprobado ahora).
  if (canRemember && runtime.isAlwaysApproved(key)) return PASS;

  const approvalReason =
    listed !== null
      ? `Lista de seguridad (${listed.id}): ${listed.reason}`
      : guard.mandatory === true
        ? (guard.reason ?? "Operación sensible")
        : allowedUnresolvableReason ?? (guard.reason ?? "Operación sensible");
  const approval = await runtime.requestApproval({
    mcp: call.mcp,
    tool: call.tool.name,
    capability: guard.capability,
    reason: approvalReason,
    args: call.recorded,
    canRemember,
    ...(tier !== null ? { tier } : {}),
    ...(listed !== null ? { blacklist: { id: listed.id, level: listed.level } } : {}),
  });
  if (approval.kind === "cancelled" || runtime.cancelled || ctx.isClosed()) return STOP_CANCELLED;
  if (approval.kind === "rejected") {
    runtime.rememberRejection(key);
    return reject("user_rejected", approval.instruction ?? null);
  }
  if (approval.remember === true && canRemember) runtime.rememberApproval(key);
  return PASS;
}

/**
 * Fase 8. Revisión de argumentos (Decisión 3): solo en las escrituras que el usuario no aprobó (si las aprobó, la aprobación es la revisión), ni escribió él
 * (RC-20), ni son verdes. Una lectura no la pasa por D3: no deja cambios, la verificación posterior atrapa un resultado inútil y, medido, D3 rechazaba lecturas
 * correctas (con el pre-chequeo delante, solo suma falsos rechazos). Con `reviewReads` (experimental, apagado por defecto) las lecturas también pasan por D3.
 * Si rechaza una escritura, la llamada queda con su `sig` (los argumentos sí se resolvieron) y con el `status` del escenario.
 */
export async function reviewIfNeeded(env: EngineEnv, call: PreparedCall, auth: Authorization): Promise<Gate> {
  const { ctx, runtime, deps } = env;
  const applies = call.kind === "write" ? !auth.askUser && !auth.userAuthored && auth.tier !== "green" : deps.reviewReads?.() === true;
  if (!applies) return PASS;

  const reviewView = ctx.view.forReview(reviewViewOptions());
  const review = await queryModel(() => env.decision.reviewArgs(reviewInput(reviewView, call.route, call.tool, call.recorded), runtime.signal), 0, pauseOf(env, "decision"));
  if (!review.ok) return { kind: "stop", outcome: fromFailure(env, call.stepId, review.failure, review.error) };
  if (runtime.cancelled || ctx.isClosed()) return STOP_CANCELLED;

  // Nivel 2 de la lista negra (solo llega aquí en automático) o nivel amarillo: umbral estricto. Si el comando habría pasado con el umbral normal y solo lo frena la
  // exigencia extra, no es un argumento inválido: se rechaza como `tool_rejected` (no cuenta contra el tope de rechazos de D3) y el modelo prueba otro camino.
  const strict = auth.listed?.level === "sensitive" || auth.tier === "yellow";
  const reviewed = reviewOutcome(review.value, strict ? BUDGET.sensitiveApprove : undefined);
  if (reviewed !== "approved" && strict && reviewOutcome(review.value) === "approved") {
    const note = `${auth.listed?.reason ?? "This change is not trivially reversible."} The safety review was not confident enough to run it automatically. Use a safer command or a different approach.`;
    return reject("tool_rejected", note);
  }
  if (reviewed !== "approved") return reject(reviewed, reviewed === "args_invalid" ? REVIEW_ARGS_INVALID_NOTE : null);
  return PASS;
}
