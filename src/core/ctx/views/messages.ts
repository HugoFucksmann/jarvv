/**
 * Qué fallos de llamada muestran en las vistas lo que se quiso ejecutar (herramienta y `args`) además del `status` y el resumen (sección 8).
 *
 * Las vistas ya no llevan frases fijas por `status`, `reason`, estado de la tarea ni motivo de detención: cada línea muestra solo el `status`, el `verdict` y el resumen que
 * dejó la herramienta o el código. Las frases (algunas mandaban «elegí otra herramienta» o «cambiá los argumentos») las obedecían los modelos al pie de la letra y, con un
 * resumen específico al lado, lo contradecían a veces; sin ellas se ve en qué falla el flujo.
 */

import type { CallStatus } from "../types.ts";

export const ARGS_SHOWN_STATUSES: readonly CallStatus[] = ["args_invalid", "tool_rejected", "info_missing", "loop_blocked"];
