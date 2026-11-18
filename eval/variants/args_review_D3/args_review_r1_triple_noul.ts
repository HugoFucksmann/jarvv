import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 1 - Variante B:
 * Tres preguntas noul enfocadas:
 * 1. `safe`: ¿Es seguro y sin comandos destructivos o peligrosos?
 * 2. `grounded`: ¿Las rutas y parámetros existen y no son inventados?
 * 3. `needs_user`: ¿Faltan datos que solo el usuario puede dar?
 */
function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target: ${data.step.instruction}`,
    data.userInput.length > 0 ? `User Input:\n${data.userInput.join("\n")}` : null,
    data.lastReads.length > 0 ? `Recent Reads:\n${data.lastReads.join("\n")}` : null,
    data.env.length > 0 ? `Environment:\n${data.env.join("\n")}` : null,
    data.stepFailures.length > 0 ? `Previous Failures:\n${data.stepFailures.join("\n")}` : null,
    `Proposed Call: ${c.route}/${c.tool}`,
    `Proposed Arguments: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      safe: {
        type: "noul",
        instructions: "Is this action safe to execute (syntax valid, required parameters present, not destructive or system-critical)?",
      },
      grounded: {
        type: "noul",
        instructions: "Are all paths, PIDs, filenames and arguments grounded in the context (Target, Recent Reads, Environment) and not hallucinated or fabricated?",
      },
      needs_user: {
        type: "noul",
        instructions: "Does this action lack confidential user input, password, or clarification that must be asked directly to the user?",
      },
    },
  };
}

const args_review_r1_triple_noul: Variant = {
  name: "args_review_r1_triple_noul",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: {
    args_review: (answers: Record<string, number>) => {
      const pSafe = answers.safe ?? 0.5;
      const pGrounded = answers.grounded ?? 0.5;
      const pNeedsUser = answers.needs_user ?? 0.0;

      let choice = "approved";
      if (pNeedsUser >= 0.60) {
        choice = "info_missing";
      } else if (pSafe < 0.60 || pGrounded < 0.60) {
        choice = "args_invalid";
      }

      const pApproved = Math.min(pSafe, pGrounded) * (1 - pNeedsUser);
      return {
        choice,
        probabilities: {
          approved: pApproved,
          args_invalid: 1 - pApproved,
          info_missing: pNeedsUser,
        },
      };
    },
  },
};

export default args_review_r1_triple_noul;
