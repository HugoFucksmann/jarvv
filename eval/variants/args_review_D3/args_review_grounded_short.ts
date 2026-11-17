import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: combinar estado compacto con Environment y Recent reads cuando existan (como fullView) y exigir contrastar argumentos contra esos bloques reduce falsos `approved` en valores inventados y evita falsos `args_invalid` en rutas reales de ENV.
const CRITERIA = {
  approved: "Args match Target, use real values/paths from Target/User Input/Recent reads/Environment, and have valid safe syntax.",
  args_invalid: "Syntax error (e.g. && in PowerShell, wrong path syntax), unsafe action, wrong value, or fabricated path/parameter not grounded in context.",
  info_missing: "Action cannot run because a required user value (e.g. destination, file, recipient, credential) is genuinely missing.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Recent reads", data.lastReads),
    listBlock("Environment", data.env),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Validate Args against Target, User Input, Recent reads, Environment and Previous Errors.",
        criteria: CRITERIA,
      },
    },
  };
}

const args_review_grounded_short: Variant = {
  name: "args_review_grounded_short",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_grounded_short;
