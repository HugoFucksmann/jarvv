/**
 * eval/variants/question/question_v1.ts
 *
 * Variante dedicada para la etapa `question` (`QUESTION`).
 * Fuerza una única pregunta breve en lenguaje natural sin tokens `snake_case`, herramientas ni IDs internos.
 */

import { DATA_NOTICE_EN, type QuestionPromptData } from "../../../src/core/models/prompts.ts";
import type { PromptSet } from "../../../src/core/models/stageRequests.ts";
import type { Variant } from "../../core/variants/types.ts";

const QUESTION: PromptSet["QUESTION"] = {
  SYSTEM: `You are JARVIS. Execution is paused waiting for ONE missing detail from the user.
Reply with ONE concise question ending with "?" in the exact language of GOAL/TASK.
- Ask ONLY for the missing value; do not answer yourself, do not confirm unrelated actions, and do not re-ask values already given in USER.
- NEVER mention tool names, route names, snake_case identifiers, or internal IDs (c1, s2, r3, step numbers). Use natural plain words.
- When DATA provides candidate files, folders, or processes, name those concrete options briefly in plain language.
${DATA_NOTICE_EN}`,

  buildUserPrompt(data: QuestionPromptData): string {
    return data.view.trim()
      ? `${data.view}\n\nWrite ONE concise question in the language of GOAL/TASK asking only for the missing detail, with zero tool names or internal tokens.`
      : "(no context available)";
  },
};

const question_v1: Variant = {
  name: "question_v1",
  prompts: { PROMPTS: { QUESTION } },
};

export default question_v1;
