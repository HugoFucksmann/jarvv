/**
 * JARVIS Core — Utilidades puras compartidas (sin dependencias del resto del núcleo).
 */

/** Objeto plano (no `null` ni arreglo): estrecha `unknown` antes de leer sus claves. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/** Quita del inputSchema las claves que solo agregan ruido al prompt ($schema, title, additionalProperties, examples), también dentro de `properties`. */
export function cleanInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
    if (!schema || typeof schema !== "object") return {};
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === "$schema" || key === "title" || key === "additionalProperties" || key === "examples") {
            continue;
        }
        if (key === "properties" && isRecord(value)) {
            const cleanedProps: Record<string, unknown> = {};
            for (const [propName, propDef] of Object.entries(value)) {
                cleanedProps[propName] = isRecord(propDef) ? cleanInputSchema(propDef) : propDef;
            }
            cleaned[key] = cleanedProps;
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Recorta a `n` caracteres como máximo (la elipsis cuenta). */
export const clip = (s: string, n: number): string =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

/** Como `clip`, pero conserva el final (lo más reciente). */
export const clipTail = (s: string, n: number): string =>
    s.length > n ? "…" + s.slice(-(n - 1)) : s;

export const newId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;