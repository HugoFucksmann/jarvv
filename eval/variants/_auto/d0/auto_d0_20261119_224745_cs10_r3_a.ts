import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Categorize the request for an assistant with access to system tools. Is it pure conversation, a single action, or multiple actions?",
        criteria: {
          chat: "Purely conversational content such as greetings, farewells, expressions of thanks, small talk, or subjective questions that do not require any action, lookup, command execution, file operation, data retrieval, listing items, comparing entities, or processing several things.",
          single: "A request requiring exactly one specific action, lookup, command execution, file operation, or data retrieval (e.g., running one command, reading/writing one file, checking one setting). Excludes lists, comparisons, or multiple items.",
          multi: "Requests involving multiple distinct steps, sequential tasks, processing several items, listing things, comparing entities, or separate actions where the result of one feeds into another.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does fulfilling this request require executing two or more distinct operations (including lists, comparisons, or sequential steps)?",
        criteria: {
          true: "The request clearly asks for multiple actions, consecutive stages, a list of separate tasks, processing several items, comparing things, or finding multiple pieces of information.",
          false: "The request asks for exactly one thing to do, find, check, or run. A single lookup or command is not multiple.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r3_a: Variant = {
  name: "auto_d0_20261119_224745_cs10_r3_a",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r3_a;
