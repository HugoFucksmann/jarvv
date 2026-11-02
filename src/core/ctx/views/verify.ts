/**
 * `forVerify` (sección 8): verificación del paso. Paso, criterio de éxito, llamada evaluada (resumen y ref) y
 * efectos del paso. Incluye herramienta y `args` de la llamada evaluada para que el verificador sepa qué se ejecutó.
 */

import { effectsOf } from "../derive.ts";
import { ContextError } from "../errors.ts";
import { parseId } from "../ids.ts";
import type { ContextData } from "../types.ts";
import { callViewOf, stepViewOf } from "./shared.ts";
import type { VerifyView } from "./types.ts";

export function buildVerifyView(data: ContextData, callId: string): VerifyView {
  const parsedCall = parseId(callId);
  const call = parsedCall !== null && parsedCall.section === "calls" ? data.calls[parsedCall.index] : undefined;
  if (call === undefined || call.id !== callId) {
    throw new ContextError("unknown_target", null, `forVerify: la llamada "${callId}" no existe`);
  }
  const parsedStep = parseId(call.stepId);
  const step = parsedStep !== null && parsedStep.section === "steps" ? data.steps[parsedStep.index] : undefined;
  if (step === undefined || step.id !== call.stepId) {
    throw new ContextError("unknown_target", null, `forVerify: el paso "${call.stepId}" de la llamada "${callId}" no existe`);
  }
  return {
    request: data.task.mode === "reactive" ? data.task.request : null,
    step: stepViewOf(step),
    call: callViewOf(data, call, true),
    stepEffects: effectsOf(data.calls)
      .filter((c) => c.stepId === step.id)
      .map((c) => callViewOf(data, c, true)),
  };
}
