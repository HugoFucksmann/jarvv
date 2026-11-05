/**
 * JARVIS Core — Entorno de ejecución de una tarea (Fase 5).
 *
 * Reúne lo que `runStep`, `runCall`, `verifyCall` y `askUser` comparten: el contexto, el `TaskRuntime`, las dependencias y
 * los clientes de los modelos ya envueltos con la captura de la traza (D11). Se crea una vez por tarea: el envoltorio lee
 * `ctx.n`, que es de esa tarea.
 */

import type { TaskContext } from "../ctx/index.ts";
import { captureDecision, captureLlm, NULL_SINK } from "./capture.ts";
import type { CaptureSink } from "./capture.ts";
import type { EngineDeps, EngineLLM, IActionDecision } from "./deps.ts";
import type { TaskRuntime } from "./runtime.ts";

export interface EngineEnv {
  readonly ctx: TaskContext;
  readonly runtime: TaskRuntime;
  readonly deps: EngineDeps;
  /** Decision con la captura aplicada (sin `sink`, es el de `deps`). */
  readonly decision: IActionDecision;
  /** LLM con la captura aplicada (sin `sink`, es el de `deps`). */
  readonly llm: EngineLLM;
  readonly sink: CaptureSink;
}

export function createEngineEnv(ctx: TaskContext, runtime: TaskRuntime, deps: EngineDeps): EngineEnv {
  const sink = deps.sink ?? NULL_SINK;
  const version = (): number => ctx.n;
  return {
    ctx,
    runtime,
    deps,
    sink,
    decision: deps.sink ? captureDecision(deps.decision, sink, version) : deps.decision,
    llm: deps.sink ? captureLlm(deps.llm, sink, version) : deps.llm,
  };
}
