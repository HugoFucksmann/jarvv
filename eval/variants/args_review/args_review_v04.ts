/**
 * eval/variants/args_review/args_review_v04.ts
 *
 * Args Review — variante v04 (Ganadora del bucle autónomo con qwen3.5:9b, récord: 39.3%):
 * Utiliza un árbol de decisión explícito en 2 pasos:
 * Step 1: Comprobar si existe fuente para el valor. Si no hay fuente ni inferencia -> info_missing.
 * Step 2: Si existe fuente pero el valor es erróneo, malformado o peligroso -> args_invalid.
 * Si es correcto -> approved.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = {
  instructions: {
    review:
      "Step 1: Determine if a valid source for the value exists in the user input or context. If no source exists and inference is impossible, mark as missing info. If a source exists (even if bad), proceed to Step 2. Step 2: If the found value is malformed, wrong, unsafe, or contradicts the target, mark it as invalid args. If the found value is reasonable and correct, mark as approved.",
  },
  criteria: {
    review: {
      approved:
        "A valid source was identified in the user input or context, and the value extracted from it is well-formed, safe, and consistent with the step target.",
      args_invalid:
        "A valid source was identified in the user input or context, but the value extracted is malformed, contains errors, is unsafe, or contradicts the intended action.",
      info_missing:
        "No source for the value exists in the user input or context, and it is impossible to infer the correct value from available information.",
    },
  },
  stateNote:
    "Priority: Check existence first. If a source exists -> check validity (Invalid/Approved). If no source exists AND inference is impossible -> Missing.",
};

const MARKER = /\s*(\[[^\]]*\])\s*$/;

function buildArgsReview(data: Parameters<typeof DECISION_PROMPTS.buildArgsReview>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildArgsReview(data);
  const questions: DecisionInput["questions"] = {};
  for (const [key, question] of Object.entries(base.questions)) {
    const next = { ...question };
    if (PATCH.instructions?.review !== undefined) next.instructions = PATCH.instructions.review;
    const criteria = PATCH.criteria?.review;
    if (next.type === "choice" && criteria !== undefined) {
      const merged: Record<string, string> = { ...next.criteria };
      for (const [option, text] of Object.entries(criteria)) {
        if (!(option in merged)) continue;
        const marker = MARKER.exec(merged[option]);
        merged[option] = marker ? `${text} ${marker[1]}` : text;
      }
      next.criteria = merged;
    }
    questions[key] = next;
  }
  const state = PATCH.stateNote === undefined ? base.state : `${PATCH.stateNote}\n${base.state}`;
  return { ...base, state, questions };
}

const args_review_v04: Variant = {
  name: "args_review_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};
export default args_review_v04;
