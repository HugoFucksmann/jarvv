/**
 * `forAsk` (sección 8.3): la pregunta de `ask_user` (LLM 4). En reactivo lleva la solicitud; en deliberativo, el paso
 * actual. Suma la entrada del usuario (lo ya preguntado y respondido, para no repetirlo), la última llamada no aprobada del
 * paso (con `args` y resumen) y la última lectura con datos, de donde salen las opciones a ofrecer.
 */

import { attemptCalls, lastReadsWithData } from "../derive.ts";
import { currentOf } from "../query.ts";
import type { ContextData } from "../types.ts";
import { callViewOf, stepViewOf, userInputViewsOf } from "./shared.ts";
import type { AskView } from "./types.ts";

export function buildAskView(data: ContextData): AskView {
  const reactive = data.task.mode === "reactive";
  const step = currentOf(data).step;

  const rejected = step === null ? [] : attemptCalls(data.calls, step.id);
  const rejectedCall = rejected.length === 0 ? null : rejected[rejected.length - 1];
  const reads = lastReadsWithData(data.calls, 1);

  return {
    request: reactive ? data.task.request : null,
    step: reactive || step === null ? null : stepViewOf(step),
    userInput: userInputViewsOf(data),
    rejectedCall: rejectedCall === null ? null : callViewOf(data, rejectedCall, true),
    lastRead: reads.length === 0 ? null : callViewOf(data, reads[0], true),
  };
}
