/**
 * eval/variants/d0/d0_v1.ts
 *
 * Variante dedicada para la etapa `d0` (`buildFirstQuery`).
 * Desambigua charla pura / consulta conceptual, acción única y flujo multi-paso encadenado.
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${safe(data.request)}`,
    questions: {
      kind: {
        type: "choice",
        instructions:
          "Classify how many real computer/web tool actions JARVIS needs to satisfy Request:",
        criteria: {
          chat: "Pure greeting, farewell, thanks, joke, or general conceptual/how-to question answerable from knowledge without touching files, OS, apps, or live web.",
          single:
            "One single tool action suffices (one file read/search/listing, one system info/settings/open/media call, one shell command, or one web lookup/download).",
          multi:
            "Requires two or more distinct tool actions: chained steps (search/read/inspect THEN write/move/delete/execute) or multiple independent targets/deliverables.",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does Request require two or more separate tool executions or a multi-step pipeline (e.g., gather data then save a file, locate then modify/delete)?",
        criteria: {
          true: "Multiple distinct targets, a dependency chain across tools, or read/search followed by write/save/action.",
          false: "Pure conversation (chat) OR one single lookup/action and replying directly to the user.",
        },
      },
    },
  };
}

const d0_v1: Variant = {
  name: "d0_v1",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_v1;
