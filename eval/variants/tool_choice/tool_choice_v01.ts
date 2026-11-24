/**
 * eval/variants/tool_choice/tool_choice_v01.ts
 *
 * Tool Choice completa:
 * - selected_tool (choice): criterios y descripción clara de cada herramienta ofrecida en la ruta.
 */

import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const toolQ = base.questions.selected_tool;
  if (toolQ.type !== "choice") return base;

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
        instructions: "Choose the tool that directly accomplishes the step instruction without side-effects or detour.",
        criteria,
      },
    },
  };
}

const tool_choice_v01: Variant = {
  name: "tool_choice_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};
export default tool_choice_v01;
