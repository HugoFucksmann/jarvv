import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const desc = t.description ? `${t.description.slice(0, 120)}...` : t.name;
    criteria[t.name] = failed.get(t.name) === true ? `${desc} [PREVIOUS ATTEMPT FAILED]` : desc;
  }

  return {
    state: [...frameLines(data), `Route selected: ${data.route}`].filter(Boolean).join("\n"),
    questions: {
      selected_tool: {
        type: "choice",
        instructions: "Which specific tool is best suited to execute the step? Avoid tools marked as failed.",
        criteria,
      },
    },
  };
}

const tool_choice_detailed: Variant = {
  name: "tool_choice_detailed",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_detailed;

