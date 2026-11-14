import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de contexto (Frente 2, DN-2.5): `pending` abre un paso de búsqueda ante preguntas de hechos cambiantes.
 * Un 4B no conoce hechos recientes: con la regla de hoy, 0 de 12 preguntas de hechos abren un paso («¿Cuándo se estrena Avengers Doomsday?» se respondió sin buscar).
 * Cambio mínimo: se agrega una excepción al final de la regla de lista vacía. Con esta frase: 11 de 12 abren un paso y la charla sigue vacía en 8 de 8.
 * (Reescribir la regla entera, `ctx_pending_facts` anterior, abría 12 de 12 pero rompía 3 de 8 casos de charla y dio -6 y -10 puntos en el laboratorio.)
 */
const SYSTEM = PROMPTS.PENDING_VIEW.SYSTEM.replace(
  "reply with an empty list.",
  "reply with an empty list. Exception: a question about recent or changing facts (news, releases, dates, prices, versions) needs a web lookup: write one item.",
);

if (SYSTEM === PROMPTS.PENDING_VIEW.SYSTEM) throw new Error("ctx_pending_facts: el texto de prod cambió y el reemplazo no aplicó.");

const ctx_pending_facts: Variant = {
  name: "ctx_pending_facts",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};

export default ctx_pending_facts;
