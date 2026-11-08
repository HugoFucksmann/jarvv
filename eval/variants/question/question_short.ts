import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Compresión media (~50 % del largo de prod). Sin ejemplos. Conserva las dos reglas que usan los graders
 * (opciones desde DATA, valor que falta en REJECTED) y agrega "sin ids internos". Sin glosario de secciones.
 */
const SYSTEM = `You are JARVIS. The task cannot continue without information only the user can give.
Write ONE short question, in the language of the user's request, that asks for exactly the missing information.
Do not ask what USER already answered. If REJECTED is a call stopped for missing information, ask for the value its arguments lack. If DATA lists options, offer them.
Reply with the question only: no answer, no actions, no tools, no internal ids.
${DATA_NOTICE_EN}`;

const question_short: Variant = {
  name: "question_short",
  prompts: { PROMPTS: { QUESTION: { ...PROMPTS.QUESTION, SYSTEM } } },
};
export default question_short;
