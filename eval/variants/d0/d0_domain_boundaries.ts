import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_domain_boundaries: delimita con precisión chat vs single vs multi.
 * Separa conocimiento general estable (chat) de hechos cambiantes / consultas online / sistema local (single)
 * y separa una búsqueda con resumen (single) de una cadena con escritura o varios objetivos (multi).
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions:
          "How many tool actions does this request need from a Windows/web assistant?",
        criteria: {
          chat: "Greeting, thanks, conversation, or timeless general knowledge / concepts explainable without live lookups or computer access. NOT for current weather, prices, news, releases, or local PC files/state.",
          single: "One tool goal is enough: one web lookup (including 'find X and explain/summarize it'), one live-fact check, one command/system check, reading/writing/moving one file, or opening one app.",
          multi: "Two or more distinct goals, or a pipeline whose first result feeds a separate action (for example: find/fetch info AND save it to a file, create a folder AND move files, compare several sources AND act on them).",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request require two or more separate steps (e.g., research and then create/save a file, or two independent tasks)? False if one read, search, or command + answering is enough.",
      },
    },
  };
}

const d0_domain_boundaries: Variant = {
  name: "d0_domain_boundaries",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_domain_boundaries;
