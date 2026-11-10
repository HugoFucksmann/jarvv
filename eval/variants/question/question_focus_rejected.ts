import { DATA_NOTICE_EN, PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { QuestionPromptData } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * question_focus_rejected:
 * Mantiene el SYSTEM probado de question_objective.
 * En el contexto del usuario (buildUserPrompt), prioriza visualmente la sección REJECTED
 * y DATA poniéndolas arriba de la TASK para que el LLM centre la atención en el parámetro que falta.
 */
const SYSTEM = `You are JARVIS. Missing information is required from the user to proceed.
Ask ONE clear, objective question in the user's language targeting the missing parameter.
Do not repeat past questions. If REJECTED specifies a missing parameter, ask directly for it. If DATA lists available options, offer them.
Output ONLY the question text. No preamble, no actions, no internal IDs.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: QuestionPromptData): string {
  const text = data.view.trim();
  if (!text) return "(no context available)";
  // Si contiene REJECTED o DATA, resaltamos primero la sección clave
  return `### ACTION REQUIRED: ASK USER FOR MISSING INFORMATION\n${text}`;
}

const question_focus_rejected: Variant = {
  name: "question_focus_rejected",
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

export default question_focus_rejected;

