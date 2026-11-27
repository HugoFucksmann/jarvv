/**
 * JARVIS Core — Entorno de ejecución de una tarea (Fase 5).
 *
 * Reúne lo que `runStep`, `runCall`, `verifyCall` y `askUser` comparten: el contexto, el `TaskRuntime`, las dependencias y
 * los clientes de los modelos ya envueltos con la captura de la traza (D11). Se crea una vez por tarea: el envoltorio lee
 * `ctx.n`, que es de esa tarea.
 */

import type { TaskContext } from "../ctx/index.ts";
import { captureDecision, captureLlm } from "./capture.ts";
import { NULL_SINK, type CaptureSink } from "../trace/sink.ts";
import type { ContinuationInput, CoverageDecisionInput, DependencyDecisionInput, EngineDeps, EngineLLM, FirstQueryInput, IActionDecision, ProbeQuery, ReadSelectionInput, RequirementsDecisionInput } from "../contracts.ts";
import type { MemoryProvider } from "../../memory/index.ts";
import type { TaskRuntime } from "./runtime.ts";
import { createExecutionState } from "./state.ts";
import type { TaskExecutionState } from "./state.ts";

export interface EngineEnv {
  readonly ctx: TaskContext;
  readonly runtime: TaskRuntime;
  readonly deps: EngineDeps;
  /** Decision con la captura aplicada (sin `sink`, es el de `deps`). */
  readonly decision: IActionDecision;
  /** LLM con la captura aplicada (sin `sink`, es el de `deps`). */
  readonly llm: EngineLLM;
  readonly sink: CaptureSink;
  /** Lo vivo de la tarea que no es del contexto (hilo, última respuesta de D5, LLM caído): ver `state.ts`. */
  readonly state: TaskExecutionState;
  /** Proveedor de memoria de hechos del usuario (`deps.memoryProvider`); `null` = sin memoria. */
  readonly memory: MemoryProvider | null;
}

/**
 * Memoria por tarea de las decisiones (Frente 3, DN-3.5 B): la misma entrada dentro de una tarea da la misma respuesta sin volver a consultar al
 * modelo (reproducibilidad exacta; 8 de 116 consultas de D1 y D2 eran idénticas, todas en tareas en bucle). Vive con la tarea: sin invalidación.
 * Solo se guardan las respuestas válidas; un fallo se vuelve a consultar. Sin cambios de comportamiento si la entrada no se repite.
 */
export function memoizeDecision(decision: IActionDecision): IActionDecision {
  const cache = new Map<string, unknown>();
  const memo = <I, O>(stage: string, call: (input: I, signal?: AbortSignal) => Promise<O>) =>
    async (input: I, signal?: AbortSignal): Promise<O> => {
      let key: string | null = null;
      try {
        key = `${stage}\u0000${JSON.stringify(input)}`;
      } catch {
        key = null; // entrada no serializable: se consulta siempre
      }
      if (key !== null && cache.has(key)) return cache.get(key) as O;
      const result = await call(input, signal);
      if (key !== null) cache.set(key, result);
      return result;
    };
  const { probe, continuation, firstQuery, checkRequirements, checkDependencies, selectReads, checkCoverage } = {
    checkCoverage: decision.checkCoverage?.bind(decision),
    selectReads: decision.selectReads?.bind(decision),
    checkRequirements: decision.checkRequirements?.bind(decision),
    checkDependencies: decision.checkDependencies?.bind(decision),
    probe: decision.probe?.bind(decision),
    continuation: decision.continuation?.bind(decision),
    firstQuery: decision.firstQuery?.bind(decision),
  };
  return {
    chooseRoute: memo("route", (i, s) => decision.chooseRoute(i, s)),
    chooseTool: memo("tool", (i, s) => decision.chooseTool(i, s)),
    reviewArgs: memo("review", (i, s) => decision.reviewArgs(i, s)),
    verifyResult: memo("verify", (i, s) => decision.verifyResult(i, s)),
    checkCompletion: memo("completion", (i, s) => decision.checkCompletion(i, s)),
    ...(checkRequirements === undefined ? {} : { checkRequirements: memo("requirements", (i: RequirementsDecisionInput, s?: AbortSignal) => checkRequirements(i, s)) }),
    ...(checkDependencies === undefined ? {} : { checkDependencies: memo("dependencies", (i: DependencyDecisionInput, s?: AbortSignal) => checkDependencies(i, s)) }),
    ...(selectReads === undefined ? {} : { selectReads: memo("reads", (i: ReadSelectionInput, s?: AbortSignal) => selectReads(i, s)) }),
    ...(checkCoverage === undefined ? {} : { checkCoverage: memo("coverage", (i: CoverageDecisionInput, s?: AbortSignal) => checkCoverage(i, s)) }),
    ...(probe === undefined ? {} : { probe: memo("probe", (i: ProbeQuery, s?: AbortSignal) => probe(i, s)) }),
    ...(continuation === undefined ? {} : { continuation: memo("continuation", (i: ContinuationInput, s?: AbortSignal) => continuation(i, s)) }),
    ...(firstQuery === undefined ? {} : { firstQuery: memo("first_query", (i: FirstQueryInput, s?: AbortSignal) => firstQuery(i, s)) }),
  };
}

export function createEngineEnv(ctx: TaskContext, runtime: TaskRuntime, deps: EngineDeps): EngineEnv {
  const sink = deps.sink ?? NULL_SINK;
  const version = (): number => ctx.n;
  const memory: MemoryProvider | null = deps.memoryProvider ?? null;
  return {
    ctx,
    runtime,
    deps,
    sink,
    memory,
    state: createExecutionState(),
    decision: memoizeDecision(deps.sink ? captureDecision(deps.decision, sink, version) : deps.decision),
    llm: deps.sink ? captureLlm(deps.llm, sink, version) : deps.llm,
  };
}
