/**
 * JARVIS Core — Utilidades de texto para memoria y observaciones.
 * Sin dependencias: lo usan el procesador de resultados, el contexto y los motores.
 */

/**
 * Etiquetas de bloque del prompt que un texto externo no puede imitar (`ETIQUETA:` al inicio de una palabra).
 * Las primeras trece son las originales; las diez últimas las agregan los renderizadores de `src/core/render/`.
 */
const BLOCK_LABELS =
    /\b(GOAL|FACTS|LOG|FAIL|TASK|PLAN|CHAT|SCHEMA|TOOL|REFS|EFFECTS|LAST|DATA|PASOS|FEEDBACK|POSIBLES EFECTOS|HANDOFF|RESULTADO DE LA LLAMADA|EVID|PASO ACTUAL|EXPECTED|ESTADO DE LA TAREA|MOTIVO DE DETENCIÓN):/gi;

/**
 * Reduce un texto externo a una sola línea y neutraliza lo que podría confundirse con la estructura del prompt:
 * `<obs>` y las etiquetas de bloque (`LOG:`, `FACTS:`…). Recorta a `maxLen` terminando en `...`.
 */
export function sanitizeForMemory(text: string, maxLen = 120): string {
    if (!text) return "";
    let clean = text
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[\x00-\x1F\x7F]/g, "")
        .replace(/<\/?obs>/gi, "[obs]")
        .replace(BLOCK_LABELS, "$1_")
        .trim();
    if (clean.length > maxLen) {
        clean = clean.substring(0, maxLen - 3) + "...";
    }
    return clean;
}

/**
 * Como `sanitizeForMemory`, pero conserva los saltos de línea y la sangría de cada línea (un tabulador pasa a cuatro
 * espacios); solo recorta los espacios finales de cada línea. Sin tope de largo. Para bloques de datos con estructura
 * (contenido de archivos, resultados de lecturas).
 */
export function sanitizeMultiline(text: string): string {
    if (!text) return "";
    return text
        .split(/\r\n|\r|\n/)
        .map((line) =>
            line
                .replace(/\t/g, "    ")
                .replace(/[\x00-\x1F\x7F]/g, "")
                .replace(/<\/?obs>/gi, "[obs]")
                .replace(BLOCK_LABELS, "$1_")
                .trimEnd(),
        )
        .join("\n");
}

/** Texto en una sola línea, sin saltos ni espacios repetidos y saneado como el resto de la memoria; sin tope de largo. */
export function flatten(text: string): string {
    return sanitizeForMemory(text, Number.MAX_SAFE_INTEGER).replace(/\s{2,}/g, " ");
}

/** Recorta en el último espacio dentro de `n` caracteres; si recortó, termina en `…`. */
export function clipAtWord(text: string, n: number): string {
    if (text.length <= n) return text;
    const cut = text.lastIndexOf(" ", n);
    return `${text.slice(0, cut > n * 0.6 ? cut : n).trimEnd()}…`;
}

// ───────────────────────── Fase 4: recorte con marcador neutro ─────────────────────────
// El `summary` de una llamada no contiene claves de ref (PLAN_CONTEXT 5.2): el marcador de omisión es neutro y la vista
// añade la ref a partir de `call.ref`. Estas funciones no sanean (C9): el saneado lo hacen las vistas al renderizar.
// Las usa `src/core/result/`.

/** Resultado de un recorte: el texto y si hubo omisión. */
export interface ClippedText {
    text: string;
    clipped: boolean;
}

/** Marcador de omisión neutro (texto provisorio): `[… omitidos: 12 entradas]`. Sin clave de ref. */
export function omissionMarker(count: number, unit = "caracteres"): string {
    return `[… omitidos: ${count} ${unit}]`;
}

/** Caracteres que se reservan para el marcador (y sus dos saltos de línea) al recortar contra un tope. */
const MARKER_RESERVE = 40;

/** Inicio y final de un texto con el marcador neutro en medio; íntegro si cabe en `head + tail`. */
export function headTailNeutral(text: string, head: number, tail: number): ClippedText {
    if (text.length <= head + tail) return { text, clipped: false };
    const omitted = text.length - head - tail;
    return {
        text: `${text.slice(0, head)}\n${omissionMarker(omitted)}\n${text.slice(text.length - tail)}`,
        clipped: true,
    };
}

/**
 * Red de seguridad contra un tope de caracteres: si `text` no cabe en `cap`, conserva inicio y final y el marcador
 * neutro cuenta dentro del tope. El resultado nunca supera `cap`.
 */
export function fitToCap(text: string, cap: number): ClippedText {
    if (text.length <= cap) return { text, clipped: false };
    const budget = Math.max(cap - MARKER_RESERVE, 0);
    const head = Math.ceil(budget / 2);
    return headTailNeutral(text, head, budget - head);
}