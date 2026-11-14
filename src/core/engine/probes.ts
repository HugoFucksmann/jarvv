/**
 * JARVIS Core — Motor de las sondas de verificación (`tools/probes.ts`).
 *
 * Tras un veredicto base aprobado (postcondición cumplida, lectura conocida o `cumple` de Decisión 4), corre las sondas que el catálogo declara para la herramienta de
 * la llamada. Cada sonda hace sus consultas en orden; una consulta con compuerta (`gate`) por debajo de `GATE_MIN` deja la sonda sin aplicar (pasa); en las demás, el
 * valor de «bien» es la probabilidad (o su complemento con `badWhenTrue`) y debe llegar al umbral de la sonda: dudar es rechazar. La primera sonda que falla rechaza la
 * llamada con su motivo cerrado; el paso reintenta y el tope de rechazos de la verificación lo corta.
 */

import type { Call, VerdictReason } from "../ctx/index.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import { probesOf, serverOf } from "../tools/manifest.ts";
import { GATE_MIN, type Probe, type ProbeCall } from "../tools/probes.ts";
import type { ExecutableRoute } from "../types/routes.ts";

export type ProbesOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly reason: VerdictReason; readonly probe: string }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** Lo que las sondas saben de la llamada: el pedido (reactivo) o la instrucción del paso (deliberativo), los argumentos y el resumen tal cual los guardó el motor. */
export function probeCallOf(env: EngineEnv, call: Call): ProbeCall {
  const { ctx } = env;
  const step = ctx.find("steps", { id: call.stepId })[0];
  const stepText = step?.instruction ?? ctx.task.request;
  return {
    tool: call.tool,
    args: call.args,
    summary: call.summary,
    request: ctx.task.mode === "reactive" ? ctx.task.request : stepText,
    step: ctx.task.mode === "reactive" ? ctx.task.request : stepText,
  };
}

/** Las sondas de la herramienta de la llamada que aplican a ella. */
export function applicableProbes(call: Call, probeCall: ProbeCall): readonly Probe[] {
  let server: string;
  try {
    server = serverOf(call.route as ExecutableRoute);
  } catch {
    return [];
  }
  return probesOf(server, call.tool).filter((p) => p.applies(probeCall));
}

export async function runProbes(env: EngineEnv, call: Call): Promise<ProbesOutcome> {
  const { ctx, runtime, decision } = env;
  if (decision.probe === undefined) return { kind: "pass" };
  const probeCall = probeCallOf(env, call);
  for (const probe of applicableProbes(call, probeCall)) {
    for (const stage of probe.stages(probeCall)) {
      const answered = await queryModel(() => decision.probe!({ state: stage.state, question: stage.question }, runtime.signal), 0);
      if (!answered.ok) {
        const closure = closeOnFailure(ctx, call.stepId, answered.failure, answered.error);
        return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
      }
      if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
      const p = answered.value.probability;
      if (stage.gate === true) {
        if (p < GATE_MIN) break; // la sonda no aplica a este caso
        continue;
      }
      const good = stage.badWhenTrue === true ? 1 - p : p;
      if (!(good >= probe.threshold)) return { kind: "fail", reason: probe.reason, probe: probe.id };
    }
  }
  return { kind: "pass" };
}
