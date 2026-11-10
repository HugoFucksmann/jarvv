import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * question_precision_elite:
 * Mantiene la redacción canónica de prod que dio 93.2% de pass rate global,
 * pero aplicando la limpieza de redundancia (GOAL == TASK) de question_clean_view (que redujo 13ms p50)
 * y reforzando explícitamente en el SYSTEM que si DATA lista opciones deben incluirse en la pregunta.
 */
const SYSTEM = `You are JARVIS. The task cannot continue without information only the user can provide.
Write ONE short, direct question in the language of the user's request asking for exactly the missing information.
Never answer it, never propose actions, and never mention internal tools or IDs.
If REJECTED is a call stopped for missing parameters, ask specifically for what its arguments lack.
If DATA lists available choices or values, offer those exact options in the question.
Reply with the question text only.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
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

const question_precision_elite: Variant = {
  name: "question_precision_elite",
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

export default question_precision_elite;

