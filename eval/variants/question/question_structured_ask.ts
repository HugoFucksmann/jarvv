import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * question_structured_ask: mantiene el SYSTEM validado de prod y estructura explícitamente
 * las secciones de `renderAsk` en `buildUserPrompt` (GOAL, USER, REJECTED, DATA) más un recordatorio breve de concisión.
 */
function buildUserPrompt(data: QuestionPromptData): string {
  if (!data.view.trim()) return "(no context available)";
  const structured = data.view
    .trim()
    .replace(/^GOAL:\s*/m, "### USER GOAL (answer in this language):\n")
    .replace(/^TASK:\s*/m, "### CURRENT TASK (answer in this language):\n")
    .replace(/^USER:\s*/m, "### ALREADY PROVIDED BY USER (do not ask again):\n")
    .replace(/^REJECTED:\s*/m, "### LAST BLOCKED ATTEMPT (ask only for the missing value):\n")
    .replace(/^DATA:\s*/m, "### AVAILABLE OPTIONS FOUND (offer these if ambiguous):\n");
  return `${structured}\n\nReply with ONE concise everyday question only (<= 140 chars if possible, zero technical terms/tools/error codes).`;
}

const question_structured_ask: Variant = {
  name: "question_structured_ask",
  prompts: {
    PROMPTS: {
      QUESTION: {
        ...PROMPTS.QUESTION,
        buildUserPrompt,
      },
    },
  },
};

export default question_structured_ask;
