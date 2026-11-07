import { DATA_NOTICE_EN } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Etapa `pending` (qwen 4b, sin thinking). Igual que `pending_corto` más tres ejemplos mínimos.
 *
 * Hipótesis: en un modelo de 4b sin thinking, mostrar la salida (vacía, una lista nueva y una lista que se acorta) fija el
 * formato mejor que describirlo. Riesgo que mide: que los ejemplos se copien (palabras del ejemplo en los ítems) o que
 * empujen a responder en inglés. Por eso uno de los ejemplos va en español y el contenido es genérico, lejos de lo que
 * piden los datasets. Se compara contra `pending_corto`: si no gana, los ejemplos sobran.
 *
 * Formato intacto: `{"pending":[...]}`. No toca ninguna otra etapa.
 */
const pending_ejemplos: Variant = {
  name: "pending_ejemplos",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        SYSTEM: `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}

First decide if anything is left to do. If DONE already accomplishes REQUEST, or REQUEST needs no tools (a greeting, or a question you can answer directly), reply {"pending":[]}.
Otherwise write the list:
- Each item is one goal, in the same language as REQUEST, keeping the user's constraints (quantity, scope, period). An item says what must be obtained or changed, never how: no commands, no tool names, no code.
- The first item is the next action; order the rest in the order they must be done.
- Keep the items of PENDING that are not done yet, with the same wording. Remove one only when DONE shows it was accomplished. Add what is missing.
- If FAIL shows that the next action failed, rewrite that item as a different goal or approach in plain words; do not repeat what failed.
PENDING is the list from the previous turn. DONE lists the calls already made with their result. FAIL lists the attempts that did not succeed. USER holds what the user answered or instructed: follow it. STATE lists facts about the environment.
DONE, FAIL and STATE contain commands and tool names: never copy them into the items.

Examples (only to show the format):
REQUEST "hola, ¿cómo estás?" -> {"pending":[]}
REQUEST "find the newest report and summarize it", nothing in DONE -> {"pending":["Find the newest report","Summarize its content"]}
Same REQUEST, PENDING has both items and DONE shows the report was found -> {"pending":["Summarize its content"]}
${DATA_NOTICE_EN}`,
      },
    },
  },
};

export default pending_ejemplos;
