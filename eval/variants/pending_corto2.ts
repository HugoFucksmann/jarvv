import { DATA_NOTICE_EN } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Etapa `pending` (qwen 4b, sin thinking). Corrige la regresión de `pending_corto` (`pen-primera-calculadora`).
 *
 * Hallazgo de la corrida: `pending_corto` puso la regla de lista vacía primero y la redactó con "REQUEST needs no tools";
 * el 4b la tomó para "abre la calculadora" y devolvió `{"pending":[]}` (0/5; en `prod` pasaba 5/5).
 *
 * Hipótesis: la regla de vacío se mantiene primera (con ella mejoraron los otros casos) pero acotada a dos casos
 * cerrados: DONE ya cumple REQUEST, o REQUEST es solo un saludo o una pregunta sin acción en la computadora. Y se dice
 * explícitamente que abrir una aplicación, trabajar con archivos o buscar en la web llevan ítem hasta que DONE muestre que
 * se hizo. El resto del prompt es el de `pending_corto`: no hay ejemplos (copian idioma) ni nombres de comandos.
 *
 * Se mide contra `prod` y `pending_corto`. Riesgo: que ahora falle algún caso de lista vacía; mirar `expectEmpty`.
 * Antes de pasarla a `src`, correrla en un dataset que no se haya usado para iterar.
 */
const pending_corto2: Variant = {
  name: "pending_corto2",
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
- If FAIL shows that the next action failed, rewrite that item as a different goal or approach in plain words; do not repeat what failed.
PENDING is the list from the previous turn. DONE lists the calls already made with their result. FAIL lists the attempts that did not succeed. USER holds what the user answered or instructed: follow it. STATE lists facts about the environment.
DONE, FAIL and STATE contain commands and tool names: never copy them into the items.
${DATA_NOTICE_EN}`,
      },
    },
  },
};

export default pending_corto2;
