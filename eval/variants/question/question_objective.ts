import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are JARVIS. Missing information is required from the user to proceed.
Ask ONE clear, objective question in the user's language targeting the missing parameter.
Do not repeat past questions. If REJECTED specifies a missing parameter, ask directly for it. If DATA lists available options, offer them.
Output ONLY the question text. No preamble, no actions, no internal IDs.
${DATA_NOTICE_EN}`;

const question_objective: Variant = {
  name: "question_objective",
  prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, SYSTEM } } },
};
export default question_objective;

