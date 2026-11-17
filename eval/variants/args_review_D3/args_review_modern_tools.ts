import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * args_review_modern_tools: criterios compactos adaptados a las herramientas reales actuales
 * (web_search, stop_process, get_more_search_results, run_command, files/xlsx) con `Recent reads` solo si aporta contexto.
 */
const CRITERIA = {
  approved: "Valid syntax, grounded paths/URLs/PIDs/sessionIds, safe action, and matches Target and User Input.",
  args_invalid: "Syntax error, wrapped powershell, && on Windows, wrong path/PID/URL/sessionId not grounded, raw URL in web_search.need, placeholders, or repeating Previous Errors.",
  info_missing: "A required path, destination, choice, or secret is blank or missing from the user.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target: ${data.step.instruction}`,
    listBlock("User Input", data.userInput),
    listBlock("Recent reads", data.lastReads),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Classify the proposed Call and Args conservatively against Target and observed facts.",
        criteria: CRITERIA,
      },
    },
  };
}

const args_review_modern_tools: Variant = {
  name: "args_review_modern_tools",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_modern_tools;
