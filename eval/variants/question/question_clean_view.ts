import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * question_clean_view:
 * Usa el SYSTEM probado de prod/question_short.
 * Limpia el texto de entrada removiendo cabeceras repetitivas redundantes como TASK cuando es idéntica a GOAL.
 */
const SYSTEM = `You are JARVIS. Crucial information is missing from the user to continue execution.
Formulate exactly ONE direct, concise question in the user's language.
If REJECTED indicated a missing argument, ask for it. If DATA provides options, list them clearly.
Never ask for answered items. Never leak tool names or internal identifiers. Return nothing except the question.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  // Limpia duplicación común de GOAL y TASK idénticas
  const lines = text.split("\n");
  const filtered = lines.filter((line, i) => {
    if (line.startsWith("TASK: ") && i > 0 && lines[0].startsWith("GOAL: ")) {
      const goalVal = lines[0].slice(6).trim();
      const taskVal = line.slice(6).trim();
      if (goalVal === taskVal) return false;
    }
    return true;
  });
  return filtered.join("\n");
}

const question_clean_view: Variant = {
  name: "question_clean_view",
  prompts: {
    PROMPTS: {
      QUESTION: {
        ...PROMPTS.QUESTION,
        SYSTEM,
        buildUserPrompt,
      },
    },
  },
};

export default question_clean_view;

