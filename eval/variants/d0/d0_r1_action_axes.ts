import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_r1_action_axes:
 * Enfoca los criterios de kind y multi en si se necesitan herramientas del sistema/web,
 * delimitando explícitamente charla vs tarea ejecutable y aclarando que reportar un dato leído es una sola acción.
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Categorize the request for an assistant with access to system tools:",
        criteria: {
          chat: "Pure conversational greeting, farewell, courtesy, or subjective question. No system action or lookup required.",
          single: "One self-contained operation: run one command, read or write one file, check one setting or look up one fact.",
          multi: "Multiple distinct steps, sequential tasks (e.g. find and then modify), or separate items to process.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does fulfilling this request require executing two or more distinct operations?",
        criteria: {
          true: "The request clearly asks for multiple actions, consecutive stages, or a list of separate tasks.",
          false: "The request asks for a single action, check, or finding one specific piece of information.",
        },
      },
    },
  };
}

const d0_r1_action_axes: Variant = {
  name: "d0_r1_action_axes",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_r1_action_axes;
