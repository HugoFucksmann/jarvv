/**
 * JARVIS Core — Ejecutor de una llamada (`runCall`, Fase 5; PLAN_CONTEXT 5.2 y 5.3).
 *
 * `runCall` solo encadena las fases, en este orden (cada una en su módulo):
 *
 *   `callPrepare`   descubrir herramientas → elegir herramienta (Decision #2) → argumentos (LLM) → huella (`sig`)
 *   anti-bucle
 *   `callAuthorize` Guard → lista negra (en automático, el nivel 1 se rechaza aquí) → pre-chequeo determinista → allowedDirectories → ¿pide confirmación?
 *   `callConfirm`   confirmación del usuario (si la autorización la exige: con ella, D3 no entra) → revisión de argumentos (Decisión 3, solo escrituras que no pidieron confirmación)
 *   `callExecute`   despacho (compite contra la cancelación) → procesar el resultado → guardar la ref si hace falta → registrar la llamada → verificar
 *
 * Registro en el contexto (`callRecord.ts`):
 * - Una llamada se registra UNA sola vez, al terminar el intento, con su `status` final y sin `verdict`. Un reintento es una
 *   llamada nueva. El `verdict` y la `reason` se escriben después, juntos, en un segundo `apply` (`verifyCall`).
 * - Con `ref`: el texto crudo se guarda en disco (`vault.put`) → `apply add ref` → `apply add call` con `ref = rN` (dos `apply`).
 * - `args` van como los propuso el modelo, con los strings recortados; `sig` sale de esos mismos argumentos y es `null`
 *   en `args_invalid` por validación; un `args_invalid` de la revisión conserva su `sig`.
 * - No se registra nada mientras se espera la confirmación; cancelar ahí no deja llamada. Si la cancelación llega con la
 *   herramienta ya despachada se registra `interrupted` en ese momento y el resultado tardío se descarta.
 *
 * Esta función NUNCA llama a `finish` ni escribe `result` (Fase 6): devuelve un `CallOutcome` y quien llama decide.
 */

import type { CallStatus } from "../ctx/index.ts";
import { repeatPolicyOf, serverOf } from "../tools/manifest.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import { authorize } from "./callAuthorize.ts";
import { confirmIfNeeded, reviewIfNeeded } from "./callConfirm.ts";
import type { Gate } from "./callConfirm.ts";
import { executeAndRecord } from "./callExecute.ts";
import { prepareArgs, selectTool } from "./callPrepare.ts";
import { CANCELLED, recordCall, registered, summaryText } from "./callRecord.ts";
import type { EngineEnv } from "./env.ts";
import type { CallOutcome } from "./outcomes.ts";

export interface RunCallParams {
  readonly stepId: string;
  /** Destino de la llamada: en reactivo lo elige Decision #1; en deliberativo viene del plan. */
  readonly route: ExecutableRoute;
}

export async function runCall(env: EngineEnv, params: RunCallParams): Promise<CallOutcome> {
  const { ctx, runtime } = env;
  const { stepId, route } = params;

  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

  // 1 a 5. Elegir la herramienta, generar los argumentos y calcular la huella (`callPrepare.ts`).
  const selected = await selectTool(env, stepId, route);
  if (selected.kind === "stop") return selected.outcome;
  const preparedResult = await prepareArgs(env, stepId, route, selected);
  if (preparedResult.kind === "stop") return preparedResult.outcome;
  const { call: prepared, environment } = preparedResult;

  // A partir de acá la llamada tiene huella: se registra con los mismos `args` y `sig`, sin `ref`. `reject` además devuelve el resultado.
  const reject = (status: CallStatus, summary: string | null = null): CallOutcome => registered(recordCall(ctx, prepared, status, summaryText(summary)), status);

  // Anti-bucle (un `denied` del servidor cuenta como ejecutada).
  if (ctx.isRepeat(prepared.tool.name, prepared.sig, { policy: repeatPolicyOf(serverOf(route), prepared.tool.name, prepared.resolved), stepId })) return reject("loop_blocked");

  // 6 a 6c. Autorización (`callAuthorize.ts`): Guard → lista negra `blocked` → pre-chequeo → allowedDirectories → ¿pide confirmación? El orden es ese y no cambia.
  // Un rechazo se registra acá (`tool_rejected`, `args_invalid`, `info_missing`); no cierra la tarea.
  const auth = await authorize(env, prepared, environment);
  if (auth.kind === "reject") return reject(auth.status, auth.summary);
  if (auth.kind === "cancelled") return CANCELLED;

  // 7. Confirmación del usuario y 8. revisión de argumentos (D3) (`callConfirm.ts`). Si el usuario aprobó, la aprobación es la revisión y D3 no entra.
  const settle = (gate: Gate): CallOutcome | null => (gate.kind === "reject" ? reject(gate.status, gate.summary) : gate.kind === "stop" ? gate.outcome : null);
  const confirmed = settle(await confirmIfNeeded(env, prepared, auth));
  if (confirmed !== null) return confirmed;
  const reviewed = settle(await reviewIfNeeded(env, prepared, auth));
  if (reviewed !== null) return reviewed;

  // 9 a 12. Despacho, resultado, registro y verificación (`callExecute.ts`). Desde acá no hay más decisiones de autorización.
  return executeAndRecord(env, prepared);
}
