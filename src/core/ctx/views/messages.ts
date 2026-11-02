/**
 * Mensajes fijos de las vistas (sección 8): una frase por `status` y por `reason`. Las arman las vistas y no se
 * guardan en el contexto. Texto aprobado (v0.28 + revisión de la Fase 2); `denied` cubre los dos orígenes (Guard y
 * servidor de la herramienta), que el contexto no distingue.
 */

import type { CallStatus, VerdictReason } from "../types.ts";

export const STATUS_NOTES: { readonly [S in CallStatus]: string | null } = {
  ok: null,
  no_data: "La herramienta respondió sin datos.",
  not_found: "No se encontró lo pedido.",
  tool_error: "La herramienta devolvió un error.",
  exception: "La ejecución falló con una excepción.",
  interrupted: "La ejecución se interrumpió antes de terminar.",
  args_invalid: "Los argumentos no eran válidos; no se ejecutó.",
  refs_unresolved: "Una referencia no pudo resolverse; no se ejecutó.",
  loop_blocked: "Repetición bloqueada: ya se hizo lo mismo; no se ejecutó.",
  user_rejected: "El usuario rechazó la acción; no se ejecutó.",
  tool_rejected: "La revisión descartó esta herramienta; no se ejecutó.",
  info_missing: "La revisión detectó que faltan datos del usuario; no se ejecutó.",
  denied: "La operación fue denegada; no se realizó.",
};

export const REASON_NOTES: { readonly [R in VerdictReason]: string } = {
  no_usable_data: "El resultado no tiene datos utilizables.",
  not_accomplished: "El resultado no cumple lo pedido.",
};

/** Fallos que muestran lo que se quiso ejecutar (herramienta y `args`) además de la frase (sección 8). */
export const ARGS_SHOWN_STATUSES: readonly CallStatus[] = ["args_invalid", "tool_rejected", "info_missing"];
