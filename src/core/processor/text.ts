/**
 * JARVIS Core — Utilidades de texto para memoria y observaciones.
 * Sin dependencias: lo usan el procesador de resultados, el contexto y los motores.
 */

/**
 * Sanitizes external text to a single line, stripping control chars and escaping delimiters (§10.7)
 */
export function sanitizeForMemory(text: string, maxLen = 120): string {
    if (!text) return "";
    let clean = text
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[\x00-\x1F\x7F]/g, "")
        .replace(/<\/?obs>/gi, "[obs]")
        .replace(/\b(GOAL|FACTS|LOG|FAIL|TASK|PLAN|CHAT|SCHEMA|TOOL|REFS|EFFECTS|LAST|DATA):/gi, "$1_")
        .trim();
    if (clean.length > maxLen) {
        clean = clean.substring(0, maxLen - 3) + "...";
    }
    return clean;
}

/** Tope del hallazgo (`finding`): la línea de un resultado que viaja a LOG, FAIL, efectos y replan. */
export const MAX_FINDING_CHARS = 300;

/**
 * Hallazgo genérico: el contenido completo aplanado (sin saltos de línea ni espacios repetidos), no solo su primera
 * línea. Si no cabe en `maxLen`, el recorte es explícito: termina en `…` y, cuando el resultado quedó en RefStore,
 * lleva la clave `[ref:rN]` para recuperar el texto íntegro.
 */
export function fitFinding(text: string, prefix = "", refKey?: string, maxLen = MAX_FINDING_CHARS): string {
    const flat = sanitizeForMemory(`${prefix}${text}`, Number.MAX_SAFE_INTEGER).replace(/\s{2,}/g, " ");
    if (flat.length <= maxLen) return flat;
    const marker = refKey ? ` [ref:${refKey}]` : "";
    return `${flat.slice(0, maxLen - marker.length - 1).trimEnd()}…${marker}`;
}

/** Recorta en el último espacio dentro de `n` caracteres; si recortó, termina en `…`. */
export function clipAtWord(text: string, n: number): string {
    if (text.length <= n) return text;
    const cut = text.lastIndexOf(" ", n);
    return `${text.slice(0, cut > n * 0.6 ? cut : n).trimEnd()}…`;
}