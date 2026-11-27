/**
 * JARVIS Core — Estado de ejecución de una tarea (lo vivo que no es del contexto).
 *
 * El estado de la tarea que se persiste (pasos, llamadas, hechos, `recalled`) vive en `ctx` y pasa por `apply`. Esto es lo otro: lo que el motor recuerda mientras
 * corre la tarea y que no entra al log. Antes estaba repartido en cajas sueltas de `EngineEnv` y en un `WeakSet` global de módulo (`llmDown`); ahora tiene un solo
 * dueño, se crea al empezar la tarea (`createEngineEnv`) y viaja en `env.state`. Se mantiene chico a propósito: solo lo que varias fases leen o escriben. Lo que usa
 * una sola función (la lista de pendientes del reactivo) es local de esa función (`reactiveList.ts`).
 */

import type { PreviousTask } from "../contracts.ts";

export interface TaskExecutionState {
  /** La tarea anterior si el pedido la continúa (`detectContinuation`). La fija `runReactive` al empezar; la leen `pending` y el registro inicial de `recalled`. */
  thread: PreviousTask | null;
  /** Lo último que dijo Decisión 5 (`confirmCompletion`): la probabilidad de `request_complete`, o `null` si no respondió. */
  lastCompletion: number | null;
  /** Cuánto cubre la primera lista de pendientes lo que pide la solicitud (`covers` de Decisión, la midió `shadowCoverage`); `null` si no se midió (lista de una sola acción o Decisión no respondió). Lo usa `confirmCompletion`. */
  listCoverage: number | null;
  /** El LLM generativo no estuvo disponible en esta tarea: la respuesta final no lo consulta y va directo a la de respaldo. */
  llmDown: boolean;
}

export const createExecutionState = (): TaskExecutionState => ({ thread: null, lastCompletion: null, listCoverage: null, llmDown: false });
