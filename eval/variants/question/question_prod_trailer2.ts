import { PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. SYSTEM de producción; la entrada termina con el recordatorio del formato y de lo que no debe aparecer. */
function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  return `${text}\n\nWrite the single question now, in the language of GOAL. Ask only for the missing value; do not mention tools, ids or internal steps.`;
}

const question_prod_trailer2: Variant = { name: "question_prod_trailer2", prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, buildUserPrompt } } } };
export default question_prod_trailer2;
