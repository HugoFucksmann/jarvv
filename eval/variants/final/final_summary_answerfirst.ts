import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. final_summary con la respuesta primero, en el idioma de REQUEST, y las reglas de efectos y de lo no ejecutado de producción. */
const SYSTEM = `You are JARVIS. Write the final answer for the user in the language of REQUEST, based strictly on DATA, EVIDENCE, USER and EFFECTS.
- Start with the answer to what the user asked, with the exact values found (names, numbers, paths). Do not only confirm that the task ended.
- Report the changes in EFFECTS; if it says none, say nothing was changed. A call that was args_invalid, loop_blocked, tool_rejected, info_missing, user_rejected or refs_unresolved never ran.
- If the task did not complete, say what was achieved, what failed and what is missing, without internal ids or tool names.
${DATA_NOTICE_EN}`;

const final_summary_answerfirst: Variant = { name: "final_summary_answerfirst", prompts: { PROMPTS: { FINAL_VIEW: { ...PROMPTS.FINAL_VIEW, SYSTEM } } } };
export default final_summary_answerfirst;
