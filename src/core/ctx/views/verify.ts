/**
 * `forVerify` (sección 8.3): verificación del resultado de una llamada (Decisión 4). El criterio es el del paso (su
 * instrucción y, en deliberativo, lo esperado). La llamada evaluada lleva herramienta, `args`, resumen y ref para que el
 * verificador sepa qué se ejecutó. En reactivo suma lo hecho (`done`, líneas `L`); en ambos modos, la entrada del usuario
 * y las llamadas previas aprobadas completas (`previous`: el adaptador se queda con las últimas N).
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
  const callIndex = parsedCall?.index ?? Number.POSITIVE_INFINITY;
  return {
    criterion: { instruction: step.instruction, expected: step.expected },
    call: callViewOf(data, call, true),
    done: reactive ? doneCalls(data.calls).filter((c) => c.id !== call.id).map(lineViewOf) : [],
    // Llamadas aprobadas anteriores a la evaluada, en orden, con args y resumen (en ambos modos). Sin tope: lo aplica el adaptador.
    previous: doneCalls(data.calls)
      .filter((c) => {
        const p = parseId(c.id);
        return p !== null && p.section === "calls" && p.index < callIndex;
      })
      .map((c) => callViewOf(data, c, true)),
    userInput: userInputViewsOf(data),
  };
}