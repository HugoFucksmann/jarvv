import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_prev: el prompt de `pending` de antes de agregar la regla de lista vacía (el actual de `prod` sin esa línea). Sirve de baseline para el A/B de esa regla.
 */
const EMPTY_RULE = "- Greetings, thanks, small talk, jokes and questions about general knowledge or about what you can do need no computer: reply with an empty list.\n";
const SYSTEM = PROMPTS.PENDING_VIEW.SYSTEM.replace(EMPTY_RULE, "");
if (SYSTEM === PROMPTS.PENDING_VIEW.SYSTEM) throw new Error("pending_prev: la regla de lista vacía ya no está en prod; revisar la variante.");

const pending_prev: Variant = {
  name: "pending_prev",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_prev;
