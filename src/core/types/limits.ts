/** Tareas retenidas en memoria. Las terminales más antiguas se expulsan (junto con sus refs). */
export const MAX_RETAINED_TASKS = 20;
/** Tareas en curso a la vez: cada una consulta los modelos locales y las herramientas, y una más no corre más rápido. `POST /process` responde 429 al pasarse. */
export const MAX_ACTIVE_TASKS = 4;
/** Conexiones SSE abiertas a la vez (cada pestaña de la interfaz abre una). `GET /events` responde 429 al pasarse. */
export const MAX_SSE_CLIENTS = 8;
/** Tope (caracteres) de la descripción de una herramienta: el manifest rechaza al arrancar una más larga y los prompts la recortan a este valor. */
export const MAX_TOOL_DESC_CHARS = 80;
/** Tope (caracteres) de la nota de un parámetro (formato que el esquema del servidor no expresa): el manifest rechaza al arrancar una más larga. */
export const MAX_PARAM_NOTE_CHARS = 240;

/** Política unificada de reintentos hacia el LLM y Decision. Reintentos ante fallo de red o HTTP 503 (nunca ante timeout ni abort). */
export const LLM_TRANSPORT_RETRIES = 1;
export const LLM_TRANSPORT_BACKOFF_MS = 1000;