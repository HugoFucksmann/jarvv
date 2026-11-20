import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Categorize the request for an assistant with access to system tools. Is it pure conversation or a task?",
        criteria: {
          chat: "Purely conversational content such as greetings, farewells, expressions of thanks, small talk, or subjective questions that do not require any action, lookup, command execution, file operation, or data retrieval.",
          single: "A request requiring exactly one specific action, lookup, command execution, file operation, or data retrieval (e.g., running one command, reading/writing one file, checking one setting).",
          multi: "Requests involving multiple distinct steps, sequential tasks, processing several items, or separate actions where the result of one feeds into another.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does fulfilling this request require executing two or more distinct operations?",
        criteria: {
          true: "The request clearly asks for multiple actions, consecutive stages, a list of separate tasks, or processing several items.",
          false: "The request asks for a single action, check, finding one specific piece of information, or running one command.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r2_a: Variant = {
  name: "auto_d0_20261119_224745_cs10_r2_a",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r2_a;
