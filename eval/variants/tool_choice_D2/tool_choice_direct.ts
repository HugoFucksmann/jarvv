import type { ToolDecisionInput } from "../../../src/core/engine/deps.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: {
      selected_tool: {
        type: "choice",
        instructions: "Choose the tool that directly accomplishes the step instruction.",
        criteria,
      },
    },
  };
}

const tool_choice_direct: Variant = {
  name: "tool_choice_direct",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_direct;

