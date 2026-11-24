/**
 * eval/variants/d0/d0_v03.ts
 *
 * D0 — variante v03: combinación de lo mejor de v01 y v02.
 *
 * Resultado del eval:
 * - v01 ganó (+21.4%): criterios explícitos y simétricos de kind/multi.
 * - v02 (+12.9%): instrucción de "cuántas acciones discretas" recuperó 11 casos
 *   distintos de los que recuperó v01 (d0-hard-03, d0-hard2-06, d0-hard2-08,
 *   d0-hard2-20, d0-h2h-09).
 *
 * Hipótesis v03: la instrucción de v02 ("How many discrete actions") + los criterios
 * de v01 (ya medidos como los mejores) debería capturar los casos de ambas versiones.
 * Además el criterio `single` de v01 no mencionaba que "buscar y responder = 1 acción"
 * — se agrega esa aclaración explícita al criterio (ya estaba en v02).
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Greeting, thanks, small talk, general conceptual knowledge, or questions about the assistant. Nothing to check on the computer or look up online.",
  single:
    "Exactly one action is needed: one web lookup for current or changing facts (prices, weather, latest versions, news), one command, one file operation, or opening one thing. Looking something up and then giving the answer counts as one action — not two.",
  multi:
    "Two or more distinct actions, or chained steps where the output of one action feeds another (e.g. search and then save, read and then convert, or several separate things to find or do).",
};

const MULTI_CRITERIA: { true: string; false: string } = {
  true: "The request asks for two or more different things to do or find (several items, or steps joined by 'and', 'then' or commas), or one action whose result feeds another action.",
  false: "The request asks for exactly one thing to do or find. Reading or looking something up and then telling the answer is still one action.",
};

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kindQ = base.questions.kind;
  const multiQ = base.questions.multi;
  if (kindQ.type !== "choice" || multiQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      kind: {
        ...kindQ,
        // Instrucción de v02 (ancla en nº de acciones, no en dificultad) +
        // criterios de v01 con la aclaración de single que ya tenía v02.
        instructions:
          "How many discrete computer or web actions does this request require? A single lookup followed by answering is one action. Only count actions, not the complexity of the topic.",
        criteria: KIND_CRITERIA,
      },
      multi: {
        ...multiQ,
        instructions:
          "Confirm: does the request need two or more separate actions, or does one action's result feed directly into another?",
        criteria: MULTI_CRITERIA,
      },
    },
  };
}

const d0_v03: Variant = {
  name: "d0_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v03;
