/** Tareas retenidas en memoria. Las terminales más antiguas se expulsan (junto con sus refs). */
export const MAX_RETAINED_TASKS = 20;
/** Tope (caracteres) de la descripción de una herramienta: el manifest rechaza al arrancar una más larga y Decision recorta a este valor. */
export const MAX_TOOL_DESC_CHARS = 80;
/** Tope (caracteres) de la nota de un parámetro (formato que el esquema del servidor no expresa): el manifest rechaza al arrancar una más larga. */
export const MAX_PARAM_NOTE_CHARS = 240;

/** Política unificada de reintentos hacia el LLM y Decision. Reintentos ante fallo de red o HTTP 503 (nunca ante timeout ni abort). */
export const LLM_TRANSPORT_RETRIES = 1;
export const LLM_TRANSPORT_BACKOFF_MS = 1000;