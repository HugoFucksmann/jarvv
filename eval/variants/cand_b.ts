import { DATA_NOTICE_EN, DECISION_PROMPTS, PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Candidata B (ampliada): lo de A más una regla extra en `pending`, una línea extra en `arguments` y ajustes de texto en las
 * tres decisiones que fallaron en las corridas. Las etapas son independientes: la comparación por etapa dice qué parte de B
 * conviene tomar aunque otra no.
 *
 * - `pending`: A más "un objetivo que falló y después aparece cumplido en DONE está hecho" (`dpen-vacio-tras-fallos-y-exito`
 *   falla 0/5 en todas las variantes: con un rechazo previo, el modelo no ve el éxito posterior).
 * - `arguments`: A más "si TASK nombra un comando de Linux, usá el equivalente de Windows" (`arg-terminal-tras-ps-cmd`, 0/5 en
 *   todas: la instrucción dice "usando ps y sort" y el modelo la obedece).
 * - D1 (`route`): `files` no es para abrir aplicaciones, `terminal` sí, y `locate` se usa tras un `not_found` (`rt-terminal-abrir-app`
 *   y `rt-locate-tras-no-encontrado` fallan 0/5: d3 elige `files`). Solo se tocan las opciones que están en el request.
 * - D3 (`review`): acota `tool_rejected` a "tipo de herramienta equivocado" y manda a `args_invalid` los comandos de otro sistema
 *   operativo y los valores inventados (d3 rechazaba como `tool_rejected` los comandos de PowerShell correctos). d3:2b casi no
 *   reacciona al texto, así que se espera poco; hay que confirmarlo.
 * - D4 (`ok` y `cumple`): exige cantidad y restricciones completas y descarta texto de relleno (`rv-ram-solo-tres` aprobaba 3 de 10
 *   procesos con `cumple` en 0.93; `rv-pagina-solo-cookies`).
 *
 * Se mide contra `prod` y `cand_a`.
 */
const SO_LINE = `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell". If TASK names a Linux command, write the Windows equivalent that gets the same result.`;

const [first, ...rest] = PROMPTS.ARGUMENTS_VIEW.SYSTEM.split("\n");

const cand_b: Variant = {
  name: "cand_b",
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
- A goal that failed earlier and later appears in DONE as accomplished is done: remove it, even if FAIL still lists the earlier attempt.
- The exception to keeping an item is the one that FAIL shows as failed and that DONE does not show as accomplished: do not keep its wording. Replace it with a new goal in plain words. If something was not found, the new goal is to find it first. If an approach did not work, the new goal is the same result by a different way. If the failed item named a command or a tool, say only the result it was meant to obtain.
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
      // D3: acota `tool_rejected` y amplía `args_invalid`.
      buildArgsReview: (data) => {
        const base = DECISION_PROMPTS.buildArgsReview(data);
        const q = base.questions.review;
        if (q.type !== "choice") return base;
        const criteria = { ...q.criteria };
        if (criteria.tool_rejected !== undefined) {
          criteria.tool_rejected =
            "The kind of tool is wrong for what the task needs now (for example a terminal command to look something up online, or a tool that only lists when a search is needed). Not for a command with wrong content.";
        }
        if (criteria.args_invalid !== undefined) {
          criteria.args_invalid =
            "The tool fits, but an argument is wrong: a value is invented (a made-up path or URL, a placeholder), a command is written for another operating system (Linux commands on Windows), or it contradicts the task or the data read.";
        }
        return { ...base, questions: { review: { ...q, criteria } } };
      },
    },
  },
  decision: {
    result_verification: {
      questions: {
        ok: {
          instructions: {
            replace:
              "Is the result usable for the step: it contains the information the step asks about (not just boilerplate such as cookie banners, menus or unrelated text), or, for an action that changes something, it confirms that the action succeeded. It is not usable if it is empty, an error message or boilerplate.",
          },
        },
        cumple: {
          instructions: {
            replace:
              "Does the result fully accomplish the step instruction, including every quantity, scope and constraint it states (for example 10 items, only one folder, a given format)? If the result has fewer items than requested, covers only part of it, or is about something else, answer no. The user input, if any, refines what is expected.",
          },
        },
      },
    },
  },
};

export default cand_b;
