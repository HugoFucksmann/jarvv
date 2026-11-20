import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_concise_calibrated: criterios mínimos y directos para D0 sin ejemplos largos que sesguen hacia `multi`.
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Classify the execution scope needed to satisfy Request.",
        criteria: {
          chat: "No tools needed: small talk, thanks, or stable general knowledge without checking PC or live web data.",
          single: "Single tool action (one search, one local read/check, one command, or opening one app).",
          multi: "Multiple dependent or independent actions across files, terminal, or web.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Are multiple distinct tool actions strictly required (true), or is one action or pure reply enough (false)?",
      },
    },
  };
}

const d0_concise_calibrated: Variant = {
  name: "d0_concise_calibrated",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_concise_calibrated;
