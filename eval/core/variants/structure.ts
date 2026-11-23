/**
 * eval/core/variants/structure.ts
 *
 * Comprueba que una variante `mode: "prompt"` solo cambió textos: las preguntas y las opciones de cada pregunta `choice`
 * (y su orden) tienen que ser las que arma producción para el mismo escenario. Las opciones salen del backend, no de la variante.
 */

import type { DecisionRequest } from "../types.ts";

/** Diferencias de estructura entre el request de producción (`base`) y el de la variante (`other`); vacío si coinciden. */
export function decisionStructureDiff(base: DecisionRequest, other: DecisionRequest): string[] {
  const diffs: string[] = [];
  const baseKeys = Object.keys(base.questions);
  const otherKeys = Object.keys(other.questions);
  if (baseKeys.join("\u0000") !== otherKeys.join("\u0000")) {
    diffs.push(`preguntas: producción [${baseKeys.join(", ")}], variante [${otherKeys.join(", ")}]`);
    return diffs;
  }
  for (const key of baseKeys) {
    const b = base.questions[key];
    const o = other.questions[key];
    if (b.type !== o.type) {
      diffs.push(`pregunta '${key}': tipo '${b.type}' en producción, '${o.type}' en la variante`);
      continue;
    }
    if (b.type !== "choice" || o.type !== "choice") continue;
    const bo = Object.keys(b.criteria);
    const oo = Object.keys(o.criteria);
    if (bo.join("\u0000") !== oo.join("\u0000")) {
      diffs.push(`opciones de '${key}': producción [${bo.join(", ")}], variante [${oo.join(", ")}]`);
    }
  }
  return diffs;
}
