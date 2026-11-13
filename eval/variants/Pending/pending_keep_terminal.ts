import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_keep_terminal: prod más una regla estrecha: si la solicitud pide ejecutar algo en la terminal, PowerShell o cmd, el ítem lo conserva junto con el comando.
 * Versión acotada de pending_keep (la regla amplia tocó casos ajenos: -14,6 % en llm_gemai). Ver eval/exp/select_tools.ts.
 */
const RULE =
  "- If REQUEST says to run something in the terminal, PowerShell or cmd, keep that in the item together with the command (for example: 'In the terminal: <command>').\n";
const SYSTEM = PROMPTS.PENDING_VIEW.SYSTEM.replace("Follow USER.", `${RULE}Follow USER.`);
if (SYSTEM === PROMPTS.PENDING_VIEW.SYSTEM) throw new Error("pending_keep_terminal: no se encontró 'Follow USER.' en el prompt de prod.");

const pending_keep_terminal: Variant = {
  name: "pending_keep_terminal",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_keep_terminal;
