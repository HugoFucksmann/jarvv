export const MAX_STEPS = 15;
/** Tareas retenidas en memoria. Las terminales más antiguas se expulsan (junto con sus refs). */
export const MAX_RETAINED_TASKS = 20;
/** Resultados de búsqueda conservados en `scratchpad.search_results`. */
export const MAX_SCRATCHPAD_RESULTS = 10;
/** Tope (caracteres) de la observación compacta de una llamada en todo su recorrido: procesamiento, registro de la llamada y respuesta final. */
export const MAX_EVIDENCE_OBS_CHARS = 2500;
/** Tope (caracteres) de la descripción de una herramienta: el manifest rechaza al arrancar una más larga y Decision recorta a este valor. */
export const MAX_TOOL_DESC_CHARS = 80;
/** Tope (caracteres) de la nota de un parámetro (formato que el esquema del servidor no expresa): el manifest rechaza al arrancar una más larga. */
export const MAX_PARAM_NOTE_CHARS = 240;

/** Política unificada de reintentos hacia el LLM y Decision. Reintentos ante fallo de red o HTTP 503 (nunca ante timeout ni abort). */
export const LLM_TRANSPORT_RETRIES = 1;
export const LLM_TRANSPORT_BACKOFF_MS = 1000;
/** Reintentos ante salida inválida o truncada del modelo. */
export const LLM_INVALID_OUTPUT_RETRIES = 1;