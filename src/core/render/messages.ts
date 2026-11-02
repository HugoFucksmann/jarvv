/**
 * Frases fijas del cierre (forFinal y forFallback). Redacción propuesta en la Fase 2 (DECISIÓN NUEVA): el diseño
 * exige un mensaje por motivo de detención pero no fija el texto.
 */

import type { StopReason, TaskState } from "../ctx/index.ts";

export const STATE_NOTES: { readonly [S in TaskState]: string } = {
  running: "La tarea sigue en curso.",
  completed: "La tarea se completó.",
  partial: "La tarea quedó incompleta: se logró solo una parte.",
  failed: "La tarea no se pudo completar.",
  cancelled: "La tarea fue cancelada.",
};

export const STOP_REASON_NOTES: { readonly [R in StopReason]: string } = {
  max_steps: "Se alcanzó el máximo de pasos permitido.",
  loop_blocked: "Se detuvo porque la tarea repetía las mismas acciones sin avanzar.",
  no_alternatives: "No quedaron alternativas para continuar.",
  security_denied: "La política de seguridad denegó una operación necesaria.",
  user_cancelled: "La tarea fue cancelada por el usuario.",
  replans_exhausted: "Se agotaron los replanes sin lograr completar la tarea.",
  unrecoverable: "Falló un servicio necesario y la tarea no pudo continuar.",
};
