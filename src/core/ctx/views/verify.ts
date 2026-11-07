/**
 * `forVerify` (sección 8.3): verificación del resultado de una llamada (Decisión 4). El criterio es el del paso (su
 * instrucción y, en deliberativo, lo esperado). La llamada evaluada lleva herramienta, `args`, resumen y ref para que el
 * verificador sepa qué se ejecutó. En reactivo suma lo hecho (`done`, líneas `L`); en ambos modos, la entrada del usuario.
 */

import { doneCalls } from "../derive.ts";
import { ContextError } from "../errors.ts";
import { parseId } from "../ids.ts";
import type { ContextData } from "../types.ts";
import { callViewOf, lineViewOf, userInputViewsOf } from "./shared.ts";
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

  const reactive = data.task.mode === "reactive";
  return {
    criterion: { instruction: step.instruction, expected: step.expected },
    call: callViewOf(data, call, true),
    done: reactive ? doneCalls(data.calls).filter((c) => c.id !== call.id).map(lineViewOf) : [],
    userInput: userInputViewsOf(data),
  };
}
