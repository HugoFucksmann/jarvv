import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 1 - Variante A:
 * Descompone la revisión en 2 preguntas noul independientes:
 * 1. `grounded`: ¿Las rutas y valores provienen del pedido o de lecturas previas (no inventados)?
 * 2. `safe_syntax`: ¿La sintaxis es válida y la acción no es destructiva ni peligrosa?
 * En `read`: aprueba solo si ambas son >= 0.60.
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
      grounded: {
        type: "noul",
        instructions: "Are all paths, identifiers, and parameters in Proposed Arguments grounded in Target, Recent Reads, or Environment, without fabricated or non-existent values?",
        criteria: {
          true: "All parameters and paths are directly requested, observed, or standard.",
          false: "Contains invented paths, hallucinated PIDs, fake URLs, or ungrounded values.",
        },
      },
      safe_syntax: {
        type: "noul",
        instructions: "Are the Proposed Arguments syntactically valid, complete, and safe to execute (no empty paths, malformed syntax, or destructive commands)?",
        criteria: {
          true: "Syntax is correct, required parameters are present, and command is safe.",
          false: "Syntax error, missing mandatory argument, destructive operation, or empty path.",
        },
      },
    },
  };
}

const args_review_r1_dual_check: Variant = {
  name: "args_review_r1_dual_check",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: {
    args_review: (answers) => {
      const pGrounded = answers.grounded ?? 0.5;
      const pSafe = answers.safe_syntax ?? 0.5;

      // P(approved) es la probabilidad conjunta
      const pApproved = pGrounded * pSafe;
      
      let choice = "approved";
      if (pGrounded < 0.60 || pSafe < 0.60) {
        choice = "args_invalid";
      }

      return {
        choice,
        probabilities: {
          approved: pApproved,
          args_invalid: 1 - pApproved,
          info_missing: 0.05,
        },
      };
    },
  },
};

export default args_review_r1_dual_check;
