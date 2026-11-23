/**
 * eval/variants/continuation/continuation_v02.ts
 *
 * Variante `mode: "prompt"` de `continuation`.
 * Hipótesis: reenfocar `instructions` en si al pedido nuevo le falta un sujeto, ruta o dato que solo aparece en la tarea
 * anterior mejora la discriminación frente a seguimientos cortos elípticos y trampas de conectores conversacionales.
 */

import type { ContinuationInput } from "../../../src/core/contracts.ts";
import { CONTINUATION_KEY } from "../../core/contract.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildContinuation(data: ContinuationInput): DecisionInput {
  return {
    state: `Previous request: ${data.previous.request}\nPrevious answer: ${data.previous.answer}\nNew request: ${data.request}`,
    questions: {
      [CONTINUATION_KEY]: {
        type: "noul",
        instructions:
          "Is the new request missing a target, file, command, or topic that can only be filled in from Previous request or Previous answer?",
        criteria: {
          true: "Yes: uses pronouns ('eso', 'abrilo'), ordinals ('el segundo'), confirmations ('sí'), or ellipses ('¿y en D:?') that require the previous turn.",
          false: "No: the new request names a complete action and target on its own, or is an independent greeting/thanks/new topic.",
        },
      },
    },
  };
}

const continuation_v02: Variant = {
  name: "continuation_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_v02;
