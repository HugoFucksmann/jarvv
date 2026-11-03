/**
 * Frases fijas de la respuesta de respaldo (`forFallback`). Es texto para el usuario, no un prompt: está en español. Las
 * frases del estado y del motivo de detención que ven los modelos están en inglés en `ctx/views/messages.ts`.
 */

import type { StopReason, TaskState } from "../ctx/index.ts";

export const FALLBACK_STATE_TEXT: { readonly [S in TaskState]: string } = {
  running: "La tarea sigue en curso.",
  completed: "La tarea se completó.",
  partial: "La tarea quedó incompleta: se logró solo una parte.",
  failed: "La tarea no se pudo completar.",
  cancelled: "La tarea fue cancelada.",
};

export const FALLBACK_STOP_TEXT: { readonly [R in StopReason]: string } = {
  max_steps: "Se alcanzó el máximo de pasos permitido.",
  no_alternatives: "No quedaron alternativas para continuar.",
  security_denied: "La política de seguridad denegó una operación necesaria.",
  user_cancelled: "La tarea fue cancelada por el usuario.",
  replans_exhausted: "Se agotaron los replanes sin lograr completar la tarea.",
  unrecoverable: "Falló un servicio necesario y la tarea no pudo continuar.",
};