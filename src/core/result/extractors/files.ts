import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import { BUDGET } from "../../budget.ts";
import { omissionMarker } from "../../processor/text.ts";

/** `list_directory`: entradas del directorio (hasta `listDirEntries` en el resumen). */
export function extractListDirectory({ fullText }: ExtractorInput): ExtractorOutput {
    const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
    // Un directorio vacío no es un error del servidor ni `no_data` (la herramienta no declara `emptyIsError`): es una
    // lectura correcta con un resultado corto, así que conserva su frase.
    if (lines.length === 0) return { summary: "Directorio vacío.", truncated: false };
    const shown = lines.slice(0, BUDGET.extract.listDirEntries);
    const omitted = lines.length - shown.length;
    const body = shown.join("\n");
    return {
        summary: omitted > 0 ? `${body}\n${omissionMarker(omitted, "entradas")}` : body,
        truncated: omitted > 0,
    };
}

/**
 * Cabecera de `read_file` de Desktop Commander (observada):
 *   `[Reading N lines from start (total: T lines, R remaining)]`
 *   `[Reading N lines from line K (total: T lines, R remaining)]`
 *   `[Reading last N lines (total: T lines)]`            (offset negativo; sin `remaining`)
 * Grupos: 1 = `last ` (solo offset negativo), 2 = N, 3 = T, 4 = R (opcional).
 * Tras la cabecera viene una línea en blanco y el contenido; solo se consumen los saltos de línea para no perder la
 * sangría de la primera línea del archivo.
 */
const READ_BANNER = /^\[Reading (last )?(\d+) lines?\b[^\]]*?\(total: (\d+) lines?(?:, (\d+) remaining)?\)\](?:\r?\n)*/;

/**
 * `read_file`: el contenido sin la cabecera; con más de `head + tail` líneas, el inicio y el final con el marcador
 * neutro en medio. La cabecera no es contenido: lo que informa (líneas sin leer, tramo final) pasa a una nota.
 */
export function extractReadFile({ fullText }: ExtractorInput): ExtractorOutput {
    const { readFileHeadLines: head, readFileTailLines: tail } = BUDGET.extract;
    const banner = READ_BANNER.exec(fullText);
    const content = banner ? fullText.slice(banner[0].length) : fullText;
    const total = banner ? parseInt(banner[3], 10) : undefined;
    const remaining = banner && banner[4] ? parseInt(banner[4], 10) : 0;
    const lastN = banner && banner[1] ? parseInt(banner[2], 10) : undefined;

    // Archivo vacío (0 líneas en total): el servidor no lo marca como error, lo decide el Core (`no_data`).
    if (total === 0) return { summary: null, truncated: false, signals: { empty_output: true } };

    const lines = content.length > 0 ? content.split("\n") : [];
    const truncated = lines.length > head + tail;
    const body = truncated
        ? [
              ...lines.slice(0, head),
              omissionMarker(lines.length - head - tail, "líneas"),
              ...lines.slice(lines.length - tail),
          ].join("\n")
        : content;

    // Notas de metadatos de la cabecera: no son contenido omitido, no cuentan para `truncated` (S2).
    const notes: string[] = [];
    if (lastN !== undefined && total !== undefined) notes.push(`[Se leyeron las últimas ${lastN} líneas de ${total} en total]`);
    if (remaining > 0) notes.push(`[Quedan ${remaining} líneas sin leer en el archivo]`);

    const summary = [body, ...notes].filter((part) => part.length > 0).join("\n");
    return { summary: summary.length > 0 ? summary : null, truncated };
}
