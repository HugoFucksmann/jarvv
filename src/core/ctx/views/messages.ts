/**
 * Mensajes fijos de las vistas (sección 8): una frase por `status`, por `reason`, por estado y por motivo de detención de
 * la tarea. Van a los prompts de los modelos, así que están en inglés. Las arman las vistas y no se guardan en el contexto.
 * `denied` cubre los dos orígenes (Guard y servidor de la herramienta), que el contexto no distingue.
 */

import type { CallStatus, StopReason, TaskState, VerdictReason } from "../types.ts";

export const STATUS_NOTES: { readonly [S in CallStatus]: string | null } = {
  ok: null,
  no_data: "The tool responded with no data.",
  not_found: "What was asked for was not found.",
  tool_error: "The tool returned an error.",
  exception: "The execution failed with an exception.",
  interrupted: "The execution was interrupted before finishing.",
  args_invalid: "The arguments were not valid; not executed.",
  refs_unresolved: "A reference could not be resolved; not executed.",
  loop_blocked: "Repetition blocked: the same call was already made; not executed. Change the arguments (for a search, use other keywords).",
  user_rejected: "The user rejected the action; not executed.",
  tool_rejected: "This tool or command is on the blacklist for this computer; not executed. Choose another tool or another way to do it.",
  info_missing: "The review found that information from the user is missing; not executed.",
  denied: "The operation was denied; not performed.",
};

export const REASON_NOTES: { readonly [R in VerdictReason]: string } = {
  no_usable_data: "The result has no usable data.",
  not_accomplished: "The result does not accomplish what was asked.",
};

/** Fallos que muestran lo que se quiso ejecutar (herramienta y `args`) además de la frase (sección 8). */
export const ARGS_SHOWN_STATUSES: readonly CallStatus[] = ["args_invalid", "tool_rejected", "info_missing", "loop_blocked"];

export const STATE_NOTES: { readonly [S in TaskState]: string } = {
  running: "The task is still running.",
  completed: "The task was completed.",
  partial: "The task is incomplete: only part of it was achieved.",
  failed: "The task could not be completed.",
  cancelled: "The task was cancelled.",
};

export const STOP_REASON_NOTES: { readonly [R in StopReason]: string } = {
  max_steps: "The maximum number of steps was reached.",
  no_alternatives: "No alternatives were left to continue.",
  security_denied: "The security policy denied a necessary operation.",
  user_cancelled: "The task was cancelled by the user.",
  replans_exhausted: "The replans were exhausted without completing the task.",
  unrecoverable: "A required service failed and the task could not continue.",
};