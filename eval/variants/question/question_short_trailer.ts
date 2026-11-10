import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. SYSTEM corto (el de question_clean_view) con la entrada de producción más el recordatorio final. */
const SYSTEM = `You are JARVIS. Crucial information is missing from the user to continue execution.
Formulate exactly ONE direct, concise question in the user's language.
If REJECTED indicated a missing argument, ask for it. If DATA provides options, list them clearly.
Never ask for answered items. Never leak tool names or internal identifiers. Return nothing except the question.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  return `${text}\n\nWrite the single question now, in the language of GOAL.`;
}

const question_short_trailer: Variant = { name: "question_short_trailer", prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, SYSTEM, buildUserPrompt } } } };
export default question_short_trailer;
