import { DATA_NOTICE_EN, DECISION_PROMPTS, PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Candidata C: la mejor pieza de cada etapa según la corrida `2026-11-07_015324_candidatas` (`cand_a` vs `cand_b` vs `prod`).
 *
 * - `pending`: el de `cand_a`. En `dificil_pending` gana a `prod` (80,4 % contra 74,5 %); la regla extra de `cand_b`
 *   ("cumplido tras fallo") bajó esa etapa a 70,6 % y devolvió la lista vacía en `dpen-parcial-falta-guardar`, que cerraría la
 *   tarea antes de tiempo.
 * - `arguments`: el de `cand_b` (frase de Windows y PowerShell más la equivalencia de comandos de Linux): 100 % en
 *   `scenarios_arguments` y `dificil_arguments`, sin regresiones.
 * - D1 (`route`): el de `cand_b`: 100 % en `scenarios_reactivo` y `dificil_reactivo` (arregla abrir una aplicación y `locate` tras un
 *   `not_found`). Riesgo: en `scenarios_chains` ganó un caso y perdió otro (`seq-comparar-precios-03-route`).
 * - D3 y D4: producción. El ajuste de D3 empeoró `args_review` (35 % a 25 %) y el de D4 cambió 5 casos a mejor y 3 a peor sin
 *   mover los casos que apuntaba.
 *
 * Pendiente sin resolver (ninguna variante lo arregla): tras un fallo, `pending` no reescribe el ítem (`dpen-archivo-no-encontrado`).
 */
const SO_LINE = `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell". If TASK names a Linux command, write the Windows equivalent that gets the same result.`;

const [first, ...rest] = PROMPTS.ARGUMENTS_VIEW.SYSTEM.split("\n");

const cand_c: Variant = {
  name: "cand_c",
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
    DECISION_PROMPTS: {
      // D1: ajusta el texto de las opciones que ya están en el request (nunca agrega una ruta que no se ofrece).
      buildRouteChoice: (data) => {
        const base = DECISION_PROMPTS.buildRouteChoice(data);
        const q = base.questions.route;
        if (q.type !== "choice") return base;
        const criteria = { ...q.criteria };
        if (criteria.files !== undefined) criteria.files = `${criteria.files} Not for opening or launching applications.`;
        if (criteria.terminal !== undefined) criteria.terminal = `${criteria.terminal} Opening an application such as Notepad or the calculator belongs here.`;
        if (criteria.locate !== undefined) criteria.locate = `${criteria.locate} Also use it after a file was not found at the path that was tried.`;
        return { ...base, questions: { route: { ...q, criteria } } };
      },
    },
  },
};

export default cand_c;
