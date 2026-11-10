import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are JARVIS. Crucial information is missing from the user to continue execution.
Formulate exactly ONE direct, concise question in the user's language.
If REJECTED indicated a missing argument, ask for it. If DATA provides options, list them clearly.
Never ask for answered items. Never leak tool names or internal identifiers. Return nothing except the question.
${DATA_NOTICE_EN}`;

const question_direct: Variant = {
  name: "question_direct",
  prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, SYSTEM } } },
};
export default question_direct;

