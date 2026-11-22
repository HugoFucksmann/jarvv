/**
 * JARVIS Core — Hilo con la tarea anterior (Frente 1, capa 2).
 *
 * `TaskManager` guarda la última tarea completada (pedido y el comienzo de su respuesta) durante `THREAD_TTL_MS`. Al empezar una tarea reactiva, una consulta de
 * decisión (`continuation`, ~25 ms) pregunta si el pedido nuevo depende de ella («guardalo en un md», “¿y el de Gemini?”). Solo si sí, la tarea anterior entra al
 * prompt de la lista de pendientes, a la generación de argumentos (como líneas de memoria) y a la respuesta final, y es fuente del pre-chequeo. Sin continuación no
 * cambia nada. Una tarea anterior es texto que escribió el usuario y la respuesta que él ya vio: nunca prosa nueva de un modelo.
 */

import { BUDGET } from "../budget.ts";
import { FIXED_TIMEOUTS } from "../timeouts.ts";
import type { PreviousTask } from "../contracts.ts";

/** Cuánto vive la tarea anterior para el hilo (DN-1.5). */
export const THREAD_TTL_MS = FIXED_TIMEOUTS.threadTtlMs;
/** Caracteres de la respuesta anterior que se conservan. */
export const THREAD_ANSWER_CHARS = 500;
/**
 * El pedido continúa la tarea anterior con esta probabilidad o más. Medido en 56 pedidos (28 seguimientos, 28 independientes): 0,3 detecta 28 de 28 con 0 falsos;
 * con 0,5 solo 19 de 28. Los seguimientos más cortos («traducilo al inglés», «abrí la primera») rondan 0,34 a 0,43. No detectar equivale al comportamiento de hoy.
 */
export const CONTINUATION_APPROVE = 0.3;

/** La tarea anterior, con la respuesta recortada. */
export function previousTaskOf(request: string, answer: string): PreviousTask {
  const text = answer.trim();
  // El pedido también se acota (al tope del hilo en el contexto): sin esto, un pedido largo hacía fallar la tarea siguiente con un `ContextError`.
  const ask = request.trim();
  return {
    request: ask.length > BUDGET.threadValueMax ? `${ask.slice(0, BUDGET.threadValueMax - 1)}…` : ask,
    answer: text.length > THREAD_ANSWER_CHARS ? `${text.slice(0, THREAD_ANSWER_CHARS)}…` : text,
  };
}

/** El bloque de texto del hilo vive en `render/thread.ts` (los modelos no importan del motor); se reexporta por comodidad. */
export { threadBlock } from "../render/thread.ts";
