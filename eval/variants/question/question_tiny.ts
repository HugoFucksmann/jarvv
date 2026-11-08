import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Compresión fuerte (~35 % del largo de prod). Tres frases. */
const SYSTEM = `You are JARVIS. Write ONE short question, in the language of the user's request, that asks only for the information the task is missing.
If DATA lists options, offer them. Do not repeat what USER already answered. Do not mention tools or internal ids.
Reply with the question only.
${DATA_NOTICE_EN}`;

const question_tiny: Variant = {
  name: "question_tiny",
  prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, SYSTEM } } },
};
export default question_tiny;
