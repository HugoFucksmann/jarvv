/**
 * eval/variants/tool_choice/tool_choice_v02.ts
 *
 * Tool Choice — variante v02:
 * - selected_tool (choice): criterios derivados de la descripción de cada herramienta.
 *
 * Hipótesis: v01 usa la descripción completa de cada herramienta como criterio (texto largo,
 * variable). El borde difícil es cuando dos herramientas de la misma ruta hacen cosas
 * parecidas y la instrucción del paso es ambigua. v02 agrega a la instrucción una regla
 * de mínimo efecto secundario: preferir la herramienta más específica cuyo alcance
 * no supere lo pedido (evita side-effects no solicitados).
 */

import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const toolQ = base.questions.selected_tool;
  if (toolQ.type !== "choice") return base;

  // Misma estrategia de criterios que v01: descripción completa de cada herramienta.
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const desc = t.description ? t.description.trim() : t.name;
    criteria[t.name] = desc;
  }

  return {
    ...base,
    questions: {
      selected_tool: {
        ...toolQ,
        // Nueva instrucción: principio de mínimo alcance — elegir la herramienta más
        // específica que cumpla el paso sin producir efectos secundarios no solicitados.
        instructions:
          "Choose the tool that directly accomplishes the step instruction. " +
          "When two tools could work, prefer the one with the narrower scope: the tool that does exactly what is asked without side-effects or unrequested changes.",
        criteria,
      },
    },
  };
}

const tool_choice_v02: Variant = {
  name: "tool_choice_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};
export default tool_choice_v02;
