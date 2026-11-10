import type { ToolDecisionInput } from "../../../src/core/engine/deps.ts";
import { frameLines, shortDesc } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. Instrucción de tool_choice_direct, estado de producción y criterios planos: los fallos solo figuran en `Attempts not approved`. */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const criteria: Record<string, string> = {};
  for (const t of data.tools) criteria[t.name] = shortDesc(t.description, t.name);
  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions: "Choose the tool that directly accomplishes the step instruction.", criteria } },
  };
}

const tool_choice_direct_nofail: Variant = { name: "tool_choice_direct_nofail", prompts: { DECISION_PROMPTS: { buildToolChoice } } };
export default tool_choice_direct_nofail;
