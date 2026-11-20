import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de contexto (Frente 2, DN-2.5): `pending` abre un paso de búsqueda ante preguntas de hechos cambiantes.
 * Un 4B no conoce hechos recientes: con la regla de hoy, 0 de 12 preguntas de hechos abren un paso («¿Cuándo se estrena Avengers Doomsday?» se respondió sin buscar).
 * Cambio mínimo: se agrega una excepción al final de la regla de lista vacía en texto explícito e independiente de cambios de redacción en `prod`.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
- Greetings, thanks, small talk, jokes and questions about general knowledge or about what you can do need no computer: reply with an empty list. Exception: a question about recent or changing facts (news, releases, dates, prices, versions) needs a web lookup: write one item.
Follow USER.
${DATA_NOTICE_EN}`;

const ctx_pending_facts: Variant = {
  name: "ctx_pending_facts",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};

export default ctx_pending_facts;
