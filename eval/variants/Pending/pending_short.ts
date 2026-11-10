import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Compresión media (~65 % del largo de prod). Sin ejemplos. Mismas reglas de prod, sin repeticiones
 * (prod dice dos veces "no copies comandos") y sin el glosario de secciones que se explican solas.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
Return an empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Any other request needs at least one item until DONE shows it was done (opening applications, working with files and searching the web all need tools).
Rules for the items:
- One goal per item, in the language of REQUEST, keeping the user's constraints (quantity, scope, period).
- State what to obtain or change, never how: no commands, tool names or code.
- The first item is the next action; the rest follow in order.
- Keep the items of PENDING that are not done, with the same wording. Remove one only when DONE shows it was accomplished. Add what is missing.
- If FAIL shows that an item failed, replace it with a new goal in plain words: if something was not found, find it first; if the approach did not work, reach the same result another way.
Follow USER. DONE, FAIL and STATE show commands and tool names: do not copy them.
${DATA_NOTICE_EN}`;

const pending_short: Variant = {
  name: "pending_short",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_short;
