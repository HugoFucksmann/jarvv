/**
 * JARVIS Core — Resultados del ejecutor de llamadas y del bucle de paso (Fase 5).
 *
 * Frontera con la Fase 6 (D2): `runCall` y `runStep` NUNCA llaman a `finish` ni escriben `result`. Registran en el
 * contexto lo que ocurrió (llamadas, errores, hechos, estado del paso) y devuelven aquí qué sigue. El cierre de la tarea
 * (`finish`, `result`), la escalación y el replan son de quien los llama.
 */

import type { CallStatus, CallVerdict, StopReason, VerdictReason } from "../ctx/index.ts";

/**
 * Qué devuelve `runCall` a `runStep`.
 *
 * - `registered`: la llamada quedó registrada (con su veredicto si correspondía verificarla) y el paso decide qué sigue.
 * - `no_tools`: tras filtrar las herramientas que exigen un proceso o una búsqueda activos no queda ninguna utilizable en el
 *   destino. No hay llamada ni error: no es infraestructura caída.
 * - `close`: la tarea debe cerrar con `stopReason`. `callId` es la llamada registrada que lo provocó (`denied` del Guard,
 *   llamada ejecutada cuyo resultado no se pudo guardar), o `null` si no hay (infraestructura caída, desborde).
 * - `cancelled`: el usuario canceló. `callId` es la llamada `interrupted` ya registrada, si se había despachado.
 */
export type CallOutcome =
  | {
    readonly kind: "registered";
    readonly callId: string;
    readonly status: CallStatus;
    readonly verdict: CallVerdict | null;
    readonly reason: VerdictReason | null;
    /** Solo con `waiting_input`: lo que el proceso pide, tal como lo detectó la herramienta; el bucle de paso se lo pregunta al usuario. */
    readonly prompt?: string;
  }
  | { readonly kind: "no_tools" }
  | { readonly kind: "close"; readonly stopReason: StopReason; readonly callId: string | null }
  | { readonly kind: "cancelled"; readonly callId: string | null };

/** Por qué un paso quedó `failed` (la recuperación del modo —escalación o replan— la resuelve la Fase 6). */
export type StepFailureCause = "call_cap" | "repeat_blocked" | "review_rejected" | "user_rejected" | "server_denied" | "no_tools";

/**
 * Qué devuelve `runStep` al proveedor de pasos.
 *
 * - `completed`: el paso quedó `completed` con una llamada `approved`.
 * - `failed`: el paso quedó `failed`.
 * - `close`: la tarea debe cerrar con `stopReason` (`security_denied`, `unrecoverable`). El paso queda como estaba.
 * - `cancelled`: el usuario canceló; el paso queda como estaba (tras `finish` el contexto queda congelado).
 */
export type StepOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly cause: StepFailureCause }
  | { readonly kind: "close"; readonly stopReason: StopReason }
  | { readonly kind: "cancelled" };