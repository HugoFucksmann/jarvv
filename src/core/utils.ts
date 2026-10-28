/**
 * JARVIS Core — Utilidades puras compartidas (sin dependencias del resto del núcleo).
 */

/** Objeto plano (no `null` ni arreglo): estrecha `unknown` antes de leer sus claves. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/** Mensaje legible de cualquier valor capturado en un `catch`. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Recorta una cadena si supera `n` caracteres agregando elipsis al final. */
export const clip = (s: string, n: number): string =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

/** Conserva el final de una cadena (lo más reciente) agregando elipsis al inicio. */
export const clipTail = (s: string, n: number): string =>
    s.length > n ? "…" + s.slice(-(n - 1)) : s;

/** Id con prefijo, fecha y sufijo aleatorio. */
export const newId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;