/**
 * Mensajes fijos de las vistas (sección 8): una frase por `status`, por `reason`, por estado y por motivo de detención de
 * la tarea. Van a los prompts de los modelos, así que están en inglés. Las arman las vistas y no se guardan en el contexto.
 * `denied` cubre los dos orígenes (Guard y servidor de la herramienta), que el contexto no distingue.
 */

import type { CallKind, CallStatus, StopReason, TaskState, VerdictReason } from "../types.ts";

export const STATUS_NOTES: { readonly [S in CallStatus]: string | null } = {
  ok: null,
  no_data: "The tool responded with no data.",
  not_found: "What was asked for was not found.",
  tool_error: "The tool returned an error.",
  exception: "The execution failed with an exception.",
  interrupted: "The execution was interrupted before finishing.",
  waiting_input: "The process is waiting for an answer from the user, who is being asked; it is still running.",
  args_invalid: "The arguments were not valid; not executed.",
  refs_unresolved: "A reference could not be resolved; not executed.",
  loop_blocked: "Repetition blocked: the same call was already made; not executed. Change the arguments (for a search, use other keywords).",
  user_rejected: "The user rejected the action; not executed.",
  tool_rejected: "This tool or command is on the blacklist for this computer; not executed. Choose another tool or another way to do it.",
  info_missing: "The review found that information from the user is missing; not executed.",
  denied: "The operation was denied; not performed.",
};

/**
 * `not_found` en una escritura no es «no se halló lo pedido»: la ruta o la carpeta no existe y NO se escribió nada. Con el texto genérico el generador de la respuesta
 * final daba por hecho que algo se había hecho o no entendía qué faltaba.
 */
const WRITE_NOT_FOUND_NOTE = "The write failed: the folder or path does not exist, so nothing was written. Create the folder first or use a path that exists.";

/** La frase fija de una llamada: la de su `status`, salvo en una escritura con `not_found` (`WRITE_NOT_FOUND_NOTE`). */
export function statusNoteOf(status: CallStatus, kind: CallKind): string | null {
  return status === "not_found" && kind === "write" ? WRITE_NOT_FOUND_NOTE : STATUS_NOTES[status];
}

export const REASON_NOTES: { readonly [R in VerdictReason]: string } = {
  no_usable_data: "The result has no usable data.",
  not_accomplished: "The result does not accomplish what was asked.",
  // Sondas por herramienta (`tools/probes.ts`): el texto le dice al generador qué corregir.
  wrong_place: "It was saved in a different place than the one the user asked for. Use the place the user named.",
  wrong_position: "The text was put in a different position than the step asks (for example appended at the end instead of the start). Rewrite the file with the text where the step says.",
  wrong_scope: "The search leaves out some of the items that were asked for. Use a broader pattern.",
  wrong_item: "A default or a different item was used instead of the one the step names (for example another sheet). Name that item in the arguments.",
  missing_attribute: "The result does not show the property needed to answer (such as dates or sizes). Use a tool that returns it.",
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