/**
 * Utilities for capturing, reconstructing, and grouping Model Iterations
 * Support for Decision-2.0-Eos-0.8B and Qwen 3.5 9B lifecycle events.
 */

import type { CoreEvent, Task, Step, StepCall } from "../core/types.ts";
import type { ModelIteration, StepIterationGroupData } from "../types/debug.ts";

// ---------------------------------------------------------------------------
// Instantáneas: lo que se guarda en `iteration.input` debe ser el estado EN ESE MOMENTO. Referenciar los objetos
// vivos de la tarea hacía que todas las iteraciones mostraran (y persistieran) el estado más reciente.
// ---------------------------------------------------------------------------
const snapLog = (t?: Task | null): string[] => [...(t?.memory?.log ?? [])];
const snapFail = (t?: Task | null): string[] => [...(t?.memory?.fail ?? [])];
const snapEffects = (t?: Task | null): string[] => [...(t?.memory?.effects ?? [])];
const snapFacts = (t?: Task | null): Record<string, string> => ({ ...(t?.memory?.facts ?? {}) });
const snapScratchpad = (t?: Task | null): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...(t?.scratchpad ?? {}) };
  if (Array.isArray(copy.search_results)) copy.search_results = [...copy.search_results];
  return copy;
};

/**
 * Creates a ModelIteration from an SSE CoreEvent if applicable.
 */
export function createIterationFromEvent(
  event: CoreEvent,
  task: Task | null
): ModelIteration | null {
  const ts = event.timestamp || Date.now();
  const stepId = event.stepId || (event.data as any)?.stepId;
  const taskId = event.taskId;

  const currentStep = task?.steps?.find((s) => s.id === stepId) || task?.steps?.[task?.currentStep ?? 0];
  const stepSeq = currentStep ? task?.steps?.indexOf(currentStep)! + 1 : undefined;

  switch (event.type) {
    case "DECISION_ONE": {
      const data = event.data as any;
      // En modo PLAN no existe DECISION_ONE (las etapas surgen de la planificación estructurada de Qwen) (FRONT-04)
      if (task?.mode === "PLAN") {
        return null;
      }

      const isFin = data.route === "fin";
      // Determinar stepId real sin asociar erróneamente pasos previos
      const targetStepSeq = (task?.stepSeq ?? (task?.steps?.length ? task.steps.length : 0)) + 1;
      const expectedStepId = isFin ? "routing_fin" : (stepId || `s${targetStepSeq}`);

      const matchingStep = task?.steps?.find((s) => s.id === expectedStepId) ||
        (!isFin && task?.steps && task.steps.length > 0 ? task.steps[task.steps.length - 1] : undefined);

      const resolvedStepSeq = matchingStep
        ? task?.steps?.indexOf(matchingStep)! + 1
        : (isFin ? undefined : targetStepSeq);

      const stepTitle = isFin
        ? "Decisión de Finalización (Eos-0.8B)"
        : (matchingStep
          ? `Paso #${resolvedStepSeq}: Enrutamiento (${matchingStep.instruction.slice(0, 35)})`
          : `Paso #${resolvedStepSeq || 1}: Enrutamiento de Subsistema`);

      return {
        id: `iter_${ts}_eos_d1_${expectedStepId}`,
        taskId,
        model: "EOS_0_8B",
        stage: "DECISION_ONE",
        stepId: expectedStepId,
        stepSeq: resolvedStepSeq,
        stepTitle,
        timestamp: ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        input: {
          objetivo: task?.message || "Instrucción del usuario",
          historialRegistrado: snapLog(task),
          hechosConfirmados: snapFacts(task),
          rutasCandidatas: ["windows", "desktop_commander", "free_search", "fin"],
          esPrimeraIteracion: (task?.steps?.length || 0) <= 1,
        },
        output: {
          rutaSeleccionada: data.route,
          confianza: data.confidence,
          probabilidades: data.probabilities || (data.answers?.route?.probabilities ?? {}),
          necesitaContextoAdicional: Boolean(data.needsContext),
        },
        metrics: {
          confidence: typeof data.confidence === "number" ? data.confidence : undefined,
          tokens: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined,
        },
      };
    }

    case "DECISION_TWO": {
      const data = event.data as any;
      return {
        id: `iter_${ts}_eos_d2_${stepId || "step"}`,
        taskId,
        model: "EOS_0_8B",
        stage: "DECISION_TWO",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: ${currentStep.instruction.slice(0, 40)}` : "Selección de Herramienta",
        timestamp: ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        input: {
          instruccionEtapa: currentStep?.instruction || "Acción inmediata",
          servidorMCP: currentStep?.route || "desktop_commander",
          herramientasCandidatas: currentStep?.candidate_tools || [],
          variablesScratchpad: snapScratchpad(task),
        },
        output: {
          herramientaSeleccionada: data.tool,
          confianza: data.confidence,
          distribucionProbabilidades: data.probabilities || {},
        },
        metrics: {
          confidence: typeof data.confidence === "number" ? data.confidence : undefined,
        },
      };
    }

    case "ARGUMENTS_GENERATED": {
      const data = event.data as any;
      return {
        id: `iter_${ts}_qwen_args_${stepId || "step"}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "ARGUMENT_GENERATION",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: Invocación de Argumentos` : "Generación de Argumentos",
        timestamp: ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        input: {
          meta: task?.message || "",
          herramienta: currentStep?.tool || "MCP Tool",
          instruccion: currentStep?.instruction || "",
          hechosFactuales: snapFacts(task),
          fallosPrevios: snapFail(task),
        },
        output: {
          argumentos: data.args || {},
          referenciasResueltas: data.resolvedRefs || [],
          conteoReemplazos: data.replacedCount || 0,
        },
        metrics: {
          verdict: "Argumentos estructurados",
        },
      };
    }

    case "RESULT_PROCESSED": {
      const data = event.data as any;
      const processed = data.processed || {};
      const verification = data.verification || {};
      const isStepSuccess = Boolean(data.isStepSuccess);

      return {
        id: `iter_${ts}_eos_verify_${stepId || "step"}`,
        taskId,
        model: "EOS_0_8B",
        stage: "STEP_VERIFICATION",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: Verificación Factual` : "Verificación de Resultado",
        timestamp: ts,
        rawInput: data.rawInput || verification?.rawInput,
        rawOutput: data.rawOutput || verification?.rawOutput,
        input: {
          instruccionEtapa: currentStep?.instruction || "",
          herramientaEjecutada: currentStep?.tool || currentStep?.calls?.slice(-1)[0]?.tool || "MCP",
          resumenObservacion: processed.summaryText || processed.decisionSummary || processed.compactObs || "",
          resultadoEsperado: currentStep?.expectedOutcome || "Ejecución exitosa y consistente",
        },
        output: {
          veredictoOk: verification.ok ?? isStepSuccess,
          veredictoCumple: verification.cumple ?? isStepSuccess,
          senalesFisicas: processed.signals || {},
          hallazgo: processed.finding || processed.summaryText || "",
          estadoVerificacion: processed.verification || (isStepSuccess ? "VERIFIED" : "UNVERIFIED"),
        },
        metrics: {
          isStepSuccess,
          verdict: isStepSuccess ? "PASO VERIFICADO" : "DESVIACIÓN / ERROR",
          signals: processed.signals,
        },
      };
    }

    case "STAGE_VERIFIED": {
      const data = event.data as any;
      const sv = data.stageVerification || data;
      const stageStatus = sv.status || data.status;
      const stageReason = sv.reason || data.reason;
      const stageQuestion = sv.questionForUser || data.questionForUser || sv.question_for_user || data.question_for_user;
      const stageConf = sv.confidence ?? data.confidence;
      const targetStepId = stepId || data.stepId || data.stageId;
      return {
        id: `iter_${ts}_qwen_stage_${targetStepId || "stage"}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "STAGE_VERIFICATION",
        stepId: targetStepId,
        stepSeq,
        stepTitle: `Verificación Semántica de Etapa ${targetStepId || ""}`,
        timestamp: ts,
        rawInput: data.rawInput || sv.rawInput,
        rawOutput: data.rawOutput || sv.rawOutput,
        input: {
          meta: task?.message || "",
          etapaId: targetStepId,
          situacionObservada: data.situation,
        },
        output: {
          estado: stageStatus,
          motivo: stageReason,
          confianza: stageConf,
          preguntaUsuario: stageQuestion,
        },
        metrics: {
          confidence: typeof stageConf === "number" ? stageConf : undefined,
          verdict: stageStatus,
        },
      };
    }

    case "PLAN_GENERATED": {
      const data = event.data as any;
      const steps = data.steps || task?.steps || [];
      return {
        id: `iter_${ts}_qwen_plan`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "PLAN_GENERATION",
        stepId: "plan_global",
        stepTitle: "Planificación Estratégica Global",
        timestamp: ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        input: {
          objetivoUsuario: task?.message || "",
          modo: "PLAN",
        },
        output: {
          cantidadEtapas: steps.length,
          etapasPropuestas: steps.map((s: any, idx: number) => ({
            indice: idx + 1,
            id: s.id,
            instruccion: s.instruction || s.goal,
            servidorSugerido: s.suggested_mcp || s.route,
            resultadoEsperado: s.expectedOutcome || s.expected_outcome,
          })),
        },
        metrics: {
          verdict: `Plan con ${steps.length} etapas estructuradas`,
        },
      };
    }

    case "FINAL_RESPONSE": {
      const data = event.data as any;
      return {
        id: `iter_${ts}_qwen_final`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "FINAL_RESPONSE",
        stepId: "final_response",
        stepTitle: "Síntesis y Respuesta Final",
        timestamp: ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        input: {
          objetivo: task?.message || "",
          hechosConfirmados: snapFacts(task),
          registroLog: snapLog(task),
          efectosSecundarios: snapEffects(task),
          fallosRegistrados: snapFail(task),
        },
        output: {
          respuestaSintetizada: data.response || task?.finalResponse || "",
        },
        metrics: {
          verdict: "Respuesta al usuario completada",
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Reconstructs missing model iterations from a Task snapshot (steps, calls, finalResponse).
 * Guarantees that historical tasks and page refreshes maintain all model traces.
 */
export function reconstructIterationsFromTask(task: Task): ModelIteration[] {
  // Si la tarea ya tiene sus iteraciones de modelo completas preservadas en memoria/persistencia, retornarlas directamente
  if (task.modelIterations && task.modelIterations.length > 0) {
    return task.modelIterations;
  }

  const iterations: ModelIteration[] = [];
  const baseTime = Date.now();

  // If task has plan and mode is PLAN
  if (task.mode === "PLAN" && task.steps && task.steps.length > 0) {
    iterations.push({
      id: `iter_reconstructed_plan_${task.id}`,
      taskId: task.id,
      model: "QWEN_3_5_9B",
      stage: "PLAN_GENERATION",
      stepId: "plan_global",
      stepTitle: "Planificación Estratégica Global",
      timestamp: baseTime - (task.steps.length * 1000 + 5000),
      rawInput: task.rawPlanInput,
      rawOutput: task.rawPlanOutput,
      input: {
        objetivoUsuario: task.message,
        modo: "PLAN",
      },
      output: {
        cantidadEtapas: task.steps.length,
        etapasPropuestas: task.steps.map((s, idx) => ({
          indice: idx + 1,
          id: s.id,
          instruccion: s.instruction,
          servidorSugerido: s.route,
          resultadoEsperado: s.expectedOutcome,
        })),
      },
      metrics: {
        verdict: `Plan restaurado (${task.steps.length} etapas)`,
      },
    });
  }

  // Iterate steps
  task.steps.forEach((step, stepIndex) => {
    const stepSeq = stepIndex + 1;
    const stepTime = baseTime - ((task.steps.length - stepIndex) * 1000);

    // 1. Decision #1 Route (Únicamente en modo NORMAL / FAST - FRONT-04)
    if (task.mode === "NORMAL" && step.route) {
      iterations.push({
        id: `iter_reconstructed_d1_${step.id}`,
        taskId: task.id,
        model: "EOS_0_8B",
        stage: "DECISION_ONE",
        stepId: step.id,
        stepSeq,
        stepTitle: `Paso #${stepSeq}: Enrutamiento (${step.instruction.slice(0, 35)})`,
        timestamp: stepTime,
        rawInput: step.rawInput,
        rawOutput: step.rawOutput,
        input: {
          objetivo: task.message,
          pasoActual: step.instruction,
          rutasCandidatas: ["windows", "desktop_commander", "free_search", "fin"],
          rutaAsignada: step.route,
        },
        output: {
          rutaSeleccionada: step.route,
          estado: step.state,
        },
        metrics: {
          verdict: `Ruta: ${step.route}`,
        },
      });
    }

    // 2. Step calls
    const calls = step.calls && step.calls.length > 0 ? step.calls : (
      step.tool ? [{
        id: `call_${step.id}`,
        mcp: step.mcp || step.route,
        tool: step.tool,
        args: step.args,
        evidence: step.evidence,
        verification: step.verification,
        outcome: step.outcome,
        error: step.error,
        timestamp: stepTime + 200,
        rawInput: step.rawInput,
        rawOutput: step.rawOutput,
      } as StepCall] : []
    );

    calls.forEach((call, callIndex) => {
      const callTime = call.timestamp || (stepTime + 100 * (callIndex + 1));

      // D2 Tool Selection
      iterations.push({
        id: `iter_reconstructed_d2_${step.id}_${call.id || callIndex}`,
        taskId: task.id,
        model: "EOS_0_8B",
        stage: "DECISION_TWO",
        stepId: step.id,
        stepSeq,
        stepTitle: `Paso #${stepSeq}: Selección de ${call.tool}`,
        timestamp: callTime,
        rawInput: call.rawInput || step.rawInput,
        rawOutput: call.rawOutput || step.rawOutput,
        input: {
          servidor: call.mcp,
          instruccion: step.instruction,
        },
        output: {
          herramientaSeleccionada: call.tool,
          servidor: call.mcp,
        },
      });

      // Arguments generation (Qwen)
      if (call.args && Object.keys(call.args).length > 0) {
        iterations.push({
          id: `iter_reconstructed_args_${step.id}_${call.id || callIndex}`,
          taskId: task.id,
          model: "QWEN_3_5_9B",
          stage: "ARGUMENT_GENERATION",
          stepId: step.id,
          stepSeq,
          stepTitle: `Paso #${stepSeq}: Argumentos para ${call.tool}`,
          timestamp: callTime + 50,
          rawInput: call.rawInput,
          rawOutput: call.rawOutput,
          input: {
            herramienta: call.tool,
            instruccion: step.instruction,
          },
          output: {
            argumentos: call.args,
          },
        });
      }

      // Step Verification (Eos)
      if (call.verification || call.evidence || call.outcome) {
        const isOk = Boolean(call.outcome?.success ?? call.evidence?.ok ?? (step.state === "COMPLETED"));
        iterations.push({
          id: `iter_reconstructed_verify_${step.id}_${call.id || callIndex}`,
          taskId: task.id,
          model: "EOS_0_8B",
          stage: "STEP_VERIFICATION",
          stepId: step.id,
          stepSeq,
          stepTitle: `Paso #${stepSeq}: Verificación ${call.tool}`,
          timestamp: callTime + 150,
          rawInput: call.rawInput || step.rawInput,
          rawOutput: call.rawOutput || step.rawOutput,
          input: {
            herramienta: call.tool,
            observacion: call.evidence?.obs || call.evidence?.summary || "",
            resultadoEsperado: step.expectedOutcome || "Consistente",
          },
          output: {
            veredictoOk: isOk,
            veredictoCumple: isOk,
            estadoVerificacion: call.verification || (isOk ? "VERIFIED" : "UNVERIFIED"),
            resultado: call.outcome,
            error: call.error,
          },
          metrics: {
            isStepSuccess: isOk,
            verdict: isOk ? "PASO VERIFICADO" : "DESVIACIÓN / ERROR",
          },
        });
      }
    });
  });

  // Final Response if exists
  if (task.finalResponse) {
    iterations.push({
      id: `iter_reconstructed_final_${task.id}`,
      taskId: task.id,
      model: "QWEN_3_5_9B",
      stage: "FINAL_RESPONSE",
      stepId: "final_response",
      stepTitle: "Síntesis y Respuesta Final",
      timestamp: baseTime,
      rawInput: task.rawFinalInput,
      rawOutput: task.rawFinalOutput,
      input: {
        objetivo: task.message,
        hechosConfirmados: snapFacts(task),
        efectosSecundarios: snapEffects(task),
      },
      output: {
        respuestaSintetizada: task.finalResponse,
      },
      metrics: {
        verdict: "Respuesta al usuario completada",
      },
    });
  }

  return iterations;
}

/**
 * Groups a flat array of ModelIteration items into hierarchically organized StepIterationGroups.
 */
export function groupIterationsByStep(
  iterations: ModelIteration[],
  task: Task | null
): StepIterationGroupData[] {
  const groupsMap = new Map<string, StepIterationGroupData>();

  // Ensure groups exist for known steps in task if provided
  if (task?.steps) {
    task.steps.forEach((step, idx) => {
      groupsMap.set(step.id, {
        stepId: step.id,
        stepSeq: idx + 1,
        stepTitle: `Paso #${idx + 1}: ${step.instruction}`,
        route: step.route,
        tool: step.tool,
        state: step.state,
        iterations: [],
      });
    });
  }

  for (const iter of iterations) {
    let key = iter.stepId || "global";
    if (key === "plan_global") {
      key = "planning";
    }

    if (!groupsMap.has(key)) {
      let title = iter.stepTitle || "Iteraciones del Sistema";
      if (key === "planning") {
        title = "Planificación Global";
      } else if (key === "final_response") {
        title = "Respuesta Final y Cierre";
      } else if (key === "routing_fin") {
        title = "Decisión de Finalización (Eos-0.8B)";
      } else if (iter.stepSeq) {
        title = `Paso #${iter.stepSeq}: ${iter.stepTitle || ""}`;
      }

      groupsMap.set(key, {
        stepId: key,
        stepSeq: iter.stepSeq,
        stepTitle: title,
        iterations: [],
      });
    }

    const grp = groupsMap.get(key)!;
    // Evitar duplicados por id
    if (!grp.iterations.some((existing) => existing.id === iter.id)) {
      grp.iterations.push(iter);
    }
  }

  // Filter out empty groups and sort by chronological order or sequence
  const result = Array.from(groupsMap.values()).filter((g) => g.iterations.length > 0);

  result.sort((a, b) => {
    // Planning always comes first
    if (a.stepId === "planning") return -1;
    if (b.stepId === "planning") return 1;
    // Final response always comes last
    if (a.stepId === "final_response") return 1;
    if (b.stepId === "final_response") return -1;
    // Routing fin right before final response
    if (a.stepId === "routing_fin") return 1;
    if (b.stepId === "routing_fin") return -1;
    // Numeric step seq
    if (a.stepSeq !== undefined && b.stepSeq !== undefined) {
      return a.stepSeq - b.stepSeq;
    }
    const aMinTime = Math.min(...a.iterations.map((i) => i.timestamp));
    const bMinTime = Math.min(...b.iterations.map((i) => i.timestamp));
    return aMinTime - bMinTime;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Vista derivada de compatibilidad
// ---------------------------------------------------------------------------

const MAX_DERIVED_INTERACTIONS = 50;

const hasRaw = (it: ModelIteration): boolean => it.rawInput !== undefined || it.rawOutput !== undefined;

/**
 * La traza cruda de los modelos vive solo en `task.modelIterations`. Los campos que históricamente la duplicaban
 * (`memory.rawInteractions`, `step.rawInput/rawOutput`, `calls[].rawInput/rawOutput`) se reconstruyen aquí a partir de
 * las iteraciones, solo cuando faltan, para quien los lea (UI) sin que el núcleo los almacene ni los transmita.
 *
 * - `memory.rawInteractions`: las últimas 50 iteraciones con entrada y salida crudas.
 * - `step.rawInput/rawOutput`: la última iteración del paso (igual que la antigua semántica de "último sobrescrito").
 * - `calls[].rawInput/rawOutput`: la iteración ARGUMENT_GENERATION de cada llamada. Se asocia por orden temporal:
 *   cada iteración se asigna a la primera llamada sin asignar cuyo `timestamp` no la precede.
 *
 * No muta la tarea recibida; devuelve la misma referencia si no hay nada que derivar.
 */
export function deriveTaskView(task: Task, iterations: ModelIteration[]): Task {
  if (!task || iterations.length === 0) return task;

  const withRaw = iterations.filter(hasRaw);
  if (withRaw.length === 0) return task;

  let changed = false;

  let memory = task.memory;
  if (memory && !(memory.rawInteractions && memory.rawInteractions.length > 0)) {
    const derived = withRaw
      .filter((it) => it.rawInput !== undefined && it.rawOutput !== undefined)
      .slice(-MAX_DERIVED_INTERACTIONS)
      .map((it) => ({
        timestamp: it.timestamp,
        model: it.model,
        stage: it.stage,
        rawInput: it.rawInput as string,
        rawOutput: it.rawOutput as string,
      }));
    if (derived.length > 0) {
      memory = { ...memory, rawInteractions: derived };
      changed = true;
    }
  }

  const steps = (task.steps ?? []).map((step) => {
    const stepIters = withRaw.filter((it) => it.stepId === step.id);
    if (stepIters.length === 0) return step;

    let nextStep: Step = step;

    if (step.rawInput === undefined && step.rawOutput === undefined) {
      const last = stepIters[stepIters.length - 1];
      nextStep = { ...nextStep, rawInput: last.rawInput, rawOutput: last.rawOutput };
    }

    const calls = step.calls ?? [];
    if (calls.some((c) => c.rawInput === undefined && c.rawOutput === undefined)) {
      const argIters = stepIters
        .filter((it) => it.stage === "ARGUMENT_GENERATION")
        .sort((a, b) => a.timestamp - b.timestamp);
      const assigned = new Set<number>();
      const byCall = new Map<number, ModelIteration>();
      for (const it of argIters) {
        const j = calls.findIndex(
          (c, idx) => !assigned.has(idx) && typeof c.timestamp === "number" && c.timestamp >= it.timestamp
        );
        if (j >= 0) {
          assigned.add(j);
          byCall.set(j, it);
        }
      }
      if (byCall.size > 0) {
        const derivedCalls = calls.map((c, idx) => {
          const it = byCall.get(idx);
          if (!it || c.rawInput !== undefined || c.rawOutput !== undefined) return c;
          return { ...c, rawInput: it.rawInput, rawOutput: it.rawOutput } as StepCall;
        });
        nextStep = { ...nextStep, calls: derivedCalls };
      }
    }

    if (nextStep !== step) changed = true;
    return nextStep;
  });

  return changed ? { ...task, memory, steps } : task;
}