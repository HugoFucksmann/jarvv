/**
 * JARVIS Core — Limpieza de la respuesta final por código (DN-2.10, relleno).
 *
 * La regla del prompt «informá los cambios o aclará que no hubo» hace que el modelo cierre respuestas a preguntas simples con «No se realizaron cambios en el
 * sistema» (77 de 98 respuestas en el laboratorio). Cambiar la regla del prompt bajó el relleno a 10 de 98 pero también bajó el acierto de los datasets de
 * `final` (−6 y −8 puntos en dos corridas), así que se quita la frase de la respuesta ya generada. Solo si la tarea no dejó cambios y el pedido no pregunta
 * por cambios, y nunca si la respuesta quedaría vacía.
 *
 * Con efectos la frase es FALSA (una carpeta creada es un cambio, aunque otro paso haya fallado): el modelo la escribe por la regla «aclará que no hubo» sin mirar EFFECTS.
 * Ahí se quita siempre, también si el pedido habla de cambios: decir «no hubo cambios» cuando los hubo es peor que callar.
 */

/** La frase empieza así: «No se realizaron cambios…», «No changes were made…», «Sin cambios en el sistema». */
const FILLER = /^(?:no\s+(?:se\s+)?(?:realiz|hicieron|hizo|hubo|efectu|aplic|modific)\w*\s+(?:ning[uú]n\s+)?cambios?|sin\s+cambios|no\s+(?:system\s+)?changes\s+(?:were|have\s+been)\s+made|there\s+were\s+no\s+changes|no\s+changes?\b)/i;

/** El pedido pregunta por lo que cambió: ahí la aclaración sí es la respuesta. */
const ASKS_ABOUT_CHANGES = /\b(?:cambi\w*|modific\w*|se\s+(?:hizo|toc[oó])|changed?|modified|touched)\b/i;

/** «No se realizaron cambios ADICIONALES»: con efectos es verdad y se conserva. */
const MORE_CHANGES = /\b(?:adicional\w*|otros|m[aá]s|further|additional|other|more|else)\b/i;

export function stripNoChangesFiller(text: string, request: string, hadEffects: boolean): string {
  if (!hadEffects && ASKS_ABOUT_CHANGES.test(request)) return text;
  // Frases por punto, signo o salto de línea; se conservan los separadores de lo que queda.
  const parts = text.split(/(?<=[.!?])[ \t]+|\n+/);
  const kept = parts.filter((p) => !FILLER.test(p.trim()) || (hadEffects && MORE_CHANGES.test(p)));
  if (kept.length === parts.length || kept.every((p) => p.trim() === "")) return text;
  // Se vuelve a unir por línea si el original tenía varias; si no, por espacio.
  return kept.join(text.includes("\n") ? "\n" : " ").trim();
}
