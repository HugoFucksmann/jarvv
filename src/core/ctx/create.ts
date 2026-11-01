/**
 * `create.context({ id, request, mode }, options)` y `create.fromSnapshot(snapshot, options)`.
 *
 * Estado inicial (sección 5): `task.state = "running"`, `stopReason = null`; `plans`, `steps`, `calls`, `errors` y
 * `refs` vacíos; `facts = {}`; `result = null`. El `id` de la tarea, el reloj y los topes los pasa quien lo usa
 * (principio 5: el contexto no genera identidades, no toca el sistema y no tiene valores propios).
 */

import { TaskContext } from "./context.ts";
import { deepFreeze } from "./json.ts";
import { parseSnapshot } from "./snapshot.ts";
import { CONTEXT_VERSION, TASK_MODES } from "./types.ts";
import type { ContextData, ContextOptions, TaskMode } from "./types.ts";
import { ensureKeys, ensureObject, oneOf, reqText } from "./validate.ts";

export interface CreateContextParams {
  id: string;
  /** Solicitud original del usuario. */
  request: string;
  mode: TaskMode;
}

function context(params: CreateContextParams, options: ContextOptions): TaskContext {
  const p = ensureObject(params, "create.context");
  ensureKeys(p, ["id", "request", "mode"], [], "create.context");
  const id = reqText(p.id, "task.id");
  const request = reqText(p.request, "task.request");
  const mode = oneOf(p.mode, TASK_MODES, "task.mode");

  const data: ContextData = {
    v: CONTEXT_VERSION,
    task: deepFreeze({ id, mode, request, state: "running" as const, stopReason: null, startedAt: options.now() }),
    plans: [],
    steps: [],
    calls: [],
    errors: [],
    facts: {},
    refs: [],
    result: null,
  };
  return new TaskContext(data, options);
}

/** Contexto a partir de un snapshot (validado por completo; rechaza los de otro `v`). `n` empieza en 0. */
function fromSnapshot(snapshot: unknown, options: ContextOptions): TaskContext {
  return new TaskContext(parseSnapshot(snapshot, options), options);
}

export const create = { context, fromSnapshot } as const;
