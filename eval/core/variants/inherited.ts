/**
 * eval/core/variants/inherited.ts
 *
 * Detecta las opciones que una variante `mode: "prompt"` no escribió y heredó de producción. Una variante arma sus preguntas llamando
 * a `DECISION_PROMPTS.<builder>` y pisando textos; lo que no pisa queda con el de `src`, y compararlo por igualdad no sirve (una
 * variante puede escribir, a propósito, el mismo texto que producción). Por eso se arma el request con los textos de producción
 * marcados: una opción que conserva la marca no la escribió la variante.
 */

import { DECISION_PROMPTS } from "../contract.ts";
import type { DecisionRequest } from "../types.ts";

const MARK = "⁣PROD⁣";

type Builder = (data: unknown) => { questions: Record<string, { criteria?: Record<string, string> }> };

/** Los criterios de cada pregunta con la marca de producción (idempotente). */
function tag<T extends { questions: Record<string, { criteria?: Record<string, string> }> }>(input: T): T {
  for (const q of Object.values(input.questions)) {
    if (q.criteria === undefined) continue;
    q.criteria = Object.fromEntries(Object.entries(q.criteria).map(([k, text]) => [k, text.startsWith(MARK) ? text : MARK + text]));
  }
  return input;
}

/** Ejecuta `fn` (síncrona) con todos los builders de `DECISION_PROMPTS` devolviendo los textos de criterios marcados. Restaura siempre. */
export function withTaggedProd<T>(fn: () => T): T {
  const table = DECISION_PROMPTS as unknown as Record<string, Builder>;
  const original = { ...table };
  for (const [name, build] of Object.entries(original)) {
    if (typeof build === "function") table[name] = (data) => tag(build.call(DECISION_PROMPTS, data));
  }
  try {
    return fn();
  } finally {
    Object.assign(table, original);
  }
}

/** `pregunta.opción` de las opciones que conservan la marca de producción. */
export function inheritedOptions(request: DecisionRequest): string[] {
  const out: string[] = [];
  for (const [key, q] of Object.entries(request.questions)) {
    for (const [option, text] of Object.entries(q.criteria ?? {})) {
      if (text.includes(MARK)) out.push(`${key}.${option}`);
    }
  }
  return out;
}
