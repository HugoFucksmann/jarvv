/**
 * eval/variants/d0/d0_v2.ts
 *
 * Hipótesis: reforzar en `multi` las señales observables (dos resultados pedidos, lectura/búsqueda seguida de escritura/movimiento/conversión, o acciones en distintos destinos) mejora la separación entre `single` y `multi`.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const MULTI_INSTRUCTIONS =
  "Does this request require two or more separate tool calls (either two independent targets/questions or one lookup/read followed by a write, move, edit, or conversion)?";

const MULTI_CRITERIA: { true: string; false: string } = {
  true: "Requires multiple tool calls: two different items to check/change, actions joined by 'and'/'then', or reading/searching/downloading first and then writing/editing/moving/converting.",
  false: "Needs zero or one tool call: pure chat/concepts, or a single lookup/read/command/setting/file operation whose result is just reported back to the user.",
};

function buildFirstQuery(data: Parameters<typeof DECISION_PROMPTS.buildFirstQuery>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const multi = base.questions.multi;
  if (multi?.type !== "noul") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      multi: { ...multi, instructions: MULTI_INSTRUCTIONS, criteria: MULTI_CRITERIA },
    },
  };
}

const d0_v2: Variant = {
  name: "d0_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_v2;
