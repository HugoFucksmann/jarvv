/**
 * JARVIS Core — Utilidades puras compartidas (sin dependencias del resto del núcleo).
 */

/** Objeto plano (no `null` ni arreglo): estrecha `unknown` antes de leer sus claves. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/** Mensaje legible de cualquier valor capturado en un `catch`. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));