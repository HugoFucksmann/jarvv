/**
 * eval/variants/args_review/args_review_v1.ts
 *
 * Variante dedicada para la etapa `args_review` (`buildArgsReview`).
 * Soporta `options.fullView` (EV-018) y delimita claramente `approved`, `args_invalid` e `info_missing`.
 */

import { ARGS_REVIEWS, type ArgsReview, type ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, dataBlock, listBlock, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const CRITERIA: Record<ArgsReview, string> = {
  approved:
    "All required targets are grounded in Target, User Input, Environment, or Recent reads; syntax is PowerShell-safe, valid for the schema, and avoids placeholders.",
  args_invalid:
    "Broken syntax or invalid platform syntax (e.g. '&&' or '@{}' in PowerShell, bash commands), invented/placeholder paths or URLs (<user>, example.com), wrong folder alias, unsafe destructive wildcard, or parameter mismatch vs Target.",
  info_missing:
    "A concrete value required by Target (specific file path, URL, target name, or choice among options) is absent from Target, User Input, and Recent reads and must be asked to the user.",
};

function buildArgsReview(data: ReviewDecisionInput, options: { readonly fullView?: boolean } = {}): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target: ${safe(data.step.instruction)}`,
    dataBlock("User Input", data.userInput.join("\n"), 800),
    options.fullView === true ? listBlock("Recent reads", data.lastReads) : null,
    options.fullView === true ? listBlock("Environment", data.env) : null,
    dataBlock("Previous Errors", data.stepFailures.join("\n"), 800),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${safe(c.args)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions:
          "Review the proposed tool arguments strictly against Target, User Input, Previous Errors, and safety/platform constraints:",
        criteria: Object.fromEntries(ARGS_REVIEWS.map((k) => [k, CRITERIA[k]])),
      },
    },
  };
}

const args_review_v1: Variant = {
  name: "args_review_v1",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_v1;
