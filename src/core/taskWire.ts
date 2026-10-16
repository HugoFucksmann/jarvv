/**
 * JARVIS Core — Representación de tareas para el cable (SSE y listados)
 *
 * `modelIterations` concentra toda la traza cruda de los modelos y es, con diferencia, la parte más pesada de una
 * tarea. Los eventos SSE se emiten varias veces por paso y cada uno llevaba la tarea completa: el tráfico crecía
 * de forma cuadrática. El cliente ya reconstruye cada iteración a partir del propio evento
 * (createIterationFromEvent), así que el SSE y los listados no necesitan transportarla; la tarea seleccionada
 * (`/state` → `task`) sí la incluye completa.
 */

import type { Task } from "./types.ts";

export function toWireTask<T extends Task | null | undefined>(task: T): T {
    if (!task) return task;
    const { modelIterations: _omitted, ...rest } = task as Task;
    return rest as T;
}