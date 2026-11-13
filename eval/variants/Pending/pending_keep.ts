import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_keep: el prompt actual de `prod` más una regla: conservar lo que el usuario dijo sobre dónde o cómo hacerlo (la terminal, PowerShell, un comando o programa, un sitio).
 * Motivo (eval/exp/select_tools.ts): con "never how (no commands, tools or code)" la meta de "ejecutá en la terminal: robocopy ..." queda "Copiar archivos ..." y D1 elige files;
 * la meta conservaba "terminal/PowerShell/comando" en 4/16 solicitudes, con la regla en 11/16.
 */
const KEEP_RULE =
  "- Keep exactly what the user said about where or how to do it (the terminal, PowerShell, a command or program name, a site): copy it into the item; a command the user wrote is part of the goal.\n";
const SYSTEM = PROMPTS.PENDING_VIEW.SYSTEM.replace("Follow USER.", `${KEEP_RULE}Follow USER.`);
if (SYSTEM === PROMPTS.PENDING_VIEW.SYSTEM) throw new Error("pending_keep: no se encontró 'Follow USER.' en el prompt de prod.");

const pending_keep: Variant = {
  name: "pending_keep",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_keep;
