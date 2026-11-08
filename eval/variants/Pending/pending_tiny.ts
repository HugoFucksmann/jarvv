import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Compresión fuerte (~45 % del largo de prod). Sin ejemplos, cuatro reglas. Si rinde mejor que
 * pending_short, el modelo se beneficia de tener menos que seguir; si rinde peor, faltan reglas.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
Follow USER.
${DATA_NOTICE_EN}`;

const pending_tiny: Variant = {
  name: "pending_tiny",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_tiny;
