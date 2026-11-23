/**
 * eval/variants/continuation/continuation_v01.ts
 *
 * Variante `mode: "prompt"` de `continuation`.
 * Hipótesis: agregar criterios `true`/`false` explícitos en `follow` que exijan dependencia anafórica o elíptica real
 * (y excluyan pedidos autocontenidos con conectores como "también" o "ahora") reduce falsos positivos sin perder elipsis cortas.
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
          'Does the new request depend on the previous task: does it refer to it ("it", "that", "the first one", "also", "now") or need its result to be understood?',
        criteria: {
          true: "The new request is incomplete without the previous turn (pronoun, ordinal, confirmation, ellipsis, or missing file/topic resolved only in Previous request/answer).",
          false: "The new request is self-contained with its own target, path, or complete question, even if it uses words like 'ahora' or 'también' or shares the same topic.",
        },
      },
    },
  };
}

const continuation_v01: Variant = {
  name: "continuation_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_v01;
