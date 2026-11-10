import { PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. SYSTEM de producción; la entrada termina con un recordatorio del formato (una pregunta, idioma de GOAL). */
function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  return `${text}\n\nWrite the single question now, in the language of GOAL.`;
}

const question_prod_trailer: Variant = { name: "question_prod_trailer", prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, buildUserPrompt } } } };
export default question_prod_trailer;
