import { DATA_NOTICE_EN, PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Candidata A (conservadora): solo etapas generativas, sin tocar ninguna decisión.
 *
 * Se arma con lo que midieron las corridas del 2026-11-07:
 * - `pending`: `pending_corto2` (lista vacía acotada a dos casos, ítems sin comandos ni herramientas; subió `scenarios_pending`
 *   de 65 % a 92 % sin regresiones) más una regla nueva para su debilidad: tras un fallo no reescribía (`dpen-archivo-no-encontrado`
 *   repetía "abrir el archivo" en vez de buscarlo) y copiaba el ítem previo (`pen-reescribe-segunda-vez`, 0/5 en todas las
 *   variantes). La excepción va dentro de la regla de conservar, para que no choquen.
 * - `arguments`: `args_so_basico` (frase fija de Windows y PowerShell; +16,5 puntos en `scenarios_arguments`, 0 regresiones).
 *
 * Se mide contra `prod` y `cand_b`. Las etapas de decisión quedan como producción.
 */
const SO_LINE = `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell".`;

const [first, ...rest] = PROMPTS.ARGUMENTS_VIEW.SYSTEM.split("\n");

const cand_a: Variant = {
  name: "cand_a",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        SYSTEM: `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}

The list is empty ({"pending":[]}) in only two cases: DONE already accomplishes REQUEST, or REQUEST is just a greeting or a question you can answer directly without doing anything on the computer. Any other request needs at least one item until DONE shows it was done: opening an application, working with files and searching the web all need tools.
Otherwise write the list:
- Each item is one goal, in the same language as REQUEST, keeping the user's constraints (quantity, scope, period). An item says what must be obtained or changed, never how: no commands, no tool names, no code.
- The first item is the next action; order the rest in the order they must be done.
- Keep the items of PENDING that are not done yet, with the same wording. Remove one only when DONE shows it was accomplished. Add what is missing.
- The exception is the item that FAIL shows as failed: do not keep its wording. Replace it with a new goal in plain words. If something was not found, the new goal is to find it first. If an approach did not work, the new goal is the same result by a different way. If the failed item named a command or a tool, say only the result it was meant to obtain.
PENDING is the list from the previous turn. DONE lists the calls already made with their result. FAIL lists the attempts that did not succeed. USER holds what the user answered or instructed: follow it. STATE lists facts about the environment.
DONE, FAIL and STATE contain commands and tool names: never copy them into the items.
${DATA_NOTICE_EN}`,
      },
      ARGUMENTS_VIEW: {
        SYSTEM: [first, SO_LINE, ...rest].join("\n"),
      },
    },
  },
};

export default cand_a;
