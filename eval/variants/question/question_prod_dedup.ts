import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. SYSTEM de producción con la entrada de question_clean_view (sin TASK cuando repite GOAL). */
function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  const goal = /^GOAL: (.*)$/m.exec(text)?.[1]?.trim();
  return text.split("\n\n").filter((s) => !(goal !== undefined && s.startsWith("TASK: ") && s.slice(6).trim() === goal)).join("\n\n");
}

const question_prod_dedup: Variant = { name: "question_prod_dedup", prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, buildUserPrompt } } } };
export default question_prod_dedup;
