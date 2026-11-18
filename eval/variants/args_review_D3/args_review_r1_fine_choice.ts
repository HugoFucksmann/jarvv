import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 1 - Variante B:
 * Explota `choice` con 4 opciones hiper-específicas usando `approved`, `args_invalid`, `info_missing` y `fabricated`:
 * Al incluir `fabricated` como opción separada, d3 no confunde error de sintaxis con alucinación de ruta/PID.
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
      review: {
        type: "choice",
        instructions: "Evaluate the tool arguments and pick the exact diagnosis category.",
        criteria: {
          approved: "The arguments are valid, safe, and directly grounded in the task, environment, or previous reads.",
          args_invalid: "Malformed syntax, missing parameter, empty path, or dangerous command.",
          fabricated: "The arguments invent a non-existent path, hallucinated PID, fake URL, or unverified name.",
          info_missing: "Missing confidential user information, password, or explicit user clarification.",
        },
      },
    },
  };
}

const args_review_r1_fine_choice: Variant = {
  name: "args_review_r1_fine_choice",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: {
    args_review: (answers: any) => {
      // Si answers trae noul o probabilities
      // En args_review parseOutput llama a reader(values) con noul.
      // Pero si enviamos questions noul podemos mapear directamente:
      const p = answers.review?.probabilities ?? {};
      const pApproved = p.approved ?? 0;
      const pFabricated = p.fabricated ?? 0;
      const pInvalid = p.args_invalid ?? 0;
      const pMissing = p.info_missing ?? 0;

      let choice = "approved";
      if (pApproved < 0.60 || pFabricated > 0.30 || pInvalid > 0.30) {
        choice = pMissing > pInvalid && pMissing > pFabricated ? "info_missing" : "args_invalid";
      }

      return {
        choice,
        probabilities: {
          approved: pApproved,
          args_invalid: Math.max(pInvalid, pFabricated),
          info_missing: pMissing,
        },
      };
    },
  },
};

export default args_review_r1_fine_choice;
