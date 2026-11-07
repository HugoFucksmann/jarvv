import { DATA_NOTICE_EN } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Etapa `pending` (qwen 4b, sin thinking). Prompt entero, corto y sin ejemplos.
 *
 * Hipótesis:
 * 1. Vacío bien: en producción la regla de la lista vacía es el último punto y el modelo, sin thinking, no llega a ella.
 *    Si la decisión "¿queda algo por hacer?" va primera y la salida vacía se muestra literal, devuelve `{"pending":[]}`
 *    más seguido (saludos, preguntas directas, REQUEST ya cumplido por DONE).
 * 2. Sin comandos: DONE, FAIL y STATE traen nombres de herramientas y comandos con sus args, y el modelo los copia a los
 *    ítems. Una regla en positivo (el ítem dice QUÉ lograr, nunca CÓMO) más el aviso de que esas secciones no se copian
 *    reduce la fuga sin nombrar palabras prohibidas (nombrarlas las pone en el contexto del modelo chico).
 *
 * Formato intacto: `{"pending":[...]}`. No toca ninguna otra etapa.
 */
const pending_corto: Variant = {
  name: "pending_corto",
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
${DATA_NOTICE_EN}`,
      },
    },
  },
};

export default pending_corto;
