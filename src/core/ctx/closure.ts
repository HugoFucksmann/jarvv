/**
 * Derivaciones que `apply` necesita para validar `finish` (5.3 y 5.4): la tabla de estado terminal por motivo y el
 * invariante 3. Son funciones puras sobre arreglos; las derivaciones restantes (anti-loop, efectos con topes,
 * contadores, vistas) están en `derive.ts` y reutilizan estas.
 */

import { violation } from "./errors.ts";
import type { Call, Step, StopReason, TaskMode, TerminalTaskState } from "./types.ts";

/** Efecto (5.4): llamada `write` con `status = ok`, con cualquier veredicto. Único lugar donde se define. */
export function isEffect(call: Call): boolean {
  return call.kind === "write" && call.status === "ok";
}

/** Efectos (5.4): hay al menos una llamada que es efecto. */
export function hasEffects(calls: readonly Call[]): boolean {
  return calls.some(isEffect);
}

/** Existe llamada aprobada (5.4): `verdict = approved`, de cualquier `status`. */
export function hasApprovedCall(calls: readonly Call[]): boolean {
  return calls.some((c) => c.verdict === "approved");
}

/** Para `partial` solo cuenta una llamada aprobada con `status = ok` (5.4). */
export function hasApprovedOk(calls: readonly Call[]): boolean {
  return calls.some((c) => c.verdict === "approved" && c.status === "ok");
}

/**
 * Cierre del modo reactivo (5.4), cuando la lista de pendientes queda vacía: `completed` si `calls` está vacío o existe una llamada `approved`;
 * si no, `no_alternatives` si existe una `user_rejected`; si no, `null`.
 */
export function canFinish(calls: readonly Call[]): "completed" | "no_alternatives" | null {
  if (calls.length === 0 || calls.some((c) => c.verdict === "approved")) return "completed";
  if (calls.some((c) => c.status === "user_rejected")) return "no_alternatives";
  return null;
}

/**
 * Cierre del plan (modo deliberativo, 5.4): pasos vigentes (sin `superseded`), al menos uno, ninguno `failed` y
 * todos `completed` → `completed`.
 */
export function planClosure(steps: readonly Step[]): "completed" | null {
  let vigentes = 0;
  for (const step of steps) {
    if (step.superseded) continue;
    if (step.state !== "completed") return null;
    vigentes++;
  }
  return vigentes > 0 ? "completed" : null;
}

/** Estado terminal por motivo de detención (5.3, tabla "Estado terminal por motivo de detención"). */
export function terminalStateFor(stopReason: StopReason, calls: readonly Call[]): TerminalTaskState {
  switch (stopReason) {
    case "security_denied":
      return "failed";
    case "user_cancelled":
      return "cancelled";
    case "max_steps":
    case "replans_exhausted":
    case "no_alternatives":
    case "unrecoverable":
      return hasEffects(calls) || hasApprovedOk(calls) ? "partial" : "failed";
  }
}

/**
 * Comprueba un cierre contra 5.3: `completed` no lleva motivo y cumple el invariante 3; el resto lleva motivo y su
 * estado es el que la tabla asigna a ese motivo. `steps` y `calls` son los de la vista final.
 */
export function assertFinalState(
  mode: TaskMode,
  state: TerminalTaskState,
  stopReason: StopReason | null,
  steps: readonly Step[],
  calls: readonly Call[],
): void {
  if (state === "completed") {
    if (stopReason !== null) violation("finish_table", 6, "`completed` no lleva `stopReason`");
    if (mode === "deliberative") {
      if (planClosure(steps) !== "completed") {
        violation("invariant", 6, "invariante 3: el cierre del plan no da `completed` (hace falta al menos un paso vigente y todos `completed`)");
      }
    } else if (canFinish(calls) !== "completed") {
      violation("invariant", 6, "invariante 3: `canFinish()` no da `completed` (hace falta que `calls` esté vacío o exista una llamada `approved`)");
    }
    return;
  }
  if (stopReason === null) violation("finish_table", 6, `\`${state}\` requiere \`stopReason\``);
  const expected = terminalStateFor(stopReason, calls);
  if (state !== expected) {
    violation("finish_table", 6, `\`stopReason = ${stopReason}\` cierra con \`${expected}\`, no con \`${state}\``);
  }
}