/**
 * Utilidades de la UI para reconstruir, agrupar y derivar vistas de las iteraciones de modelo.
 * Consumido por DecisionStream, hooks e inspectores.
 *
 * Las iteraciones nuevas las construye `src/core/modelIterations.ts` (el mismo módulo que usa el servidor, para que
 * ambos lados describan igual cada intercambio). Aquí solo viven las vistas propias de la UI: reconstrucción desde una
 * instantánea de la tarea, agrupación por paso y derivación de los crudos.
 */

import type { Task, Step, StepCall } from "../../src/core/types.ts";
import { EXECUTABLE_ROUTES, type ModelIteration } from "../../src/core/types.ts";
import { buildEffectsContext } from "../../src/core/context.ts";
import { callVerdict, finalResponseVerdict } from "../../src/core/modelIterations.ts";
import type { StepIterationGroupData } from "../types/debug.ts";

export { createIterationFromEvent } from "../../src/core/modelIterations.ts";

// Instantáneas para reconstrucción de estado
const snapFacts = (t?: Task | null): Record<string, string> => ({ ...(t?.memory?.facts ?? {}) });
// Los efectos se derivan de las llamadas registradas (no hay almacén propio).
const snapEffects = (t?: Task | null): string[] => (t ? buildEffectsContext(t, Number.POSITIVE_INFINITY) : []);

/**
 * Reconstructs missing model iterations from a Task snapshot (steps, calls, finalResponse).
 * Guarantees that historical tasks and page refreshes maintain all model traces.
 */
export function reconstructIterationsFromTask(task: Task): ModelIteration[] {
  if (task.modelIterations && task.modelIterations.length > 0) {
    return task.modelIterations;
  }

  const iterations: ModelIteration[] = [];
  const baseTime = Date.now();

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

  task.steps.forEach((step, stepIndex) => {
    const stepSeq = stepIndex + 1;
    const stepTime = baseTime - ((task.steps.length - stepIndex) * 1000);

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
          rutasCandidatas: [...EXECUTABLE_ROUTES, "fin"],
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

    const calls = step.calls && step.calls.length > 0 ? step.calls : (
      step.tool ? [{
        id: `call_${step.id}`,
        mcp: step.mcp,
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

      if (call.verification || call.evidence || call.outcome) {
        // `call.status` es la fuente única; las tareas anteriores a ese campo conservan la inferencia previa.
        const isOk = call.status !== undefined
          ? call.status === "ok"
          : Boolean(call.outcome?.success ?? call.evidence?.ok ?? (step.state === "COMPLETED"));
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
            estadoLlamada: call.status,
            estadoVerificacion: call.verification || (isOk ? "VERIFIED" : "NOT_REQUIRED"),
            duracionHerramientaMs: call.execution?.durationMs,
            resultado: call.outcome,
            error: call.error,
          },
          metrics: {
            isStepSuccess: isOk,
            verdict: call.status ? callVerdict(call.status) : isOk ? "PASO VERIFICADO" : "DESVIACIÓN / ERROR",
          },
        });
      }
    });
  });

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
        origen: task.finalResponseSource === "fallback" ? "plantilla de respaldo" : "modelo",
      },
      metrics: {
        verdict: finalResponseVerdict(task.finalResponseSource, task.state),
      },
    });
  }

  // Una iteración reconstruida corresponde a un intercambio real solo si conserva su entrada cruda.
  for (const it of iterations) {
    if (it.invoked === undefined) it.invoked = it.rawInput !== undefined;
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
    if (!grp.iterations.some((existing) => existing.id === iter.id)) {
      grp.iterations.push(iter);
    }
  }

  const result = Array.from(groupsMap.values()).filter((g) => g.iterations.length > 0);

  result.sort((a, b) => {
    if (a.stepId === "planning") return -1;
    if (b.stepId === "planning") return 1;
    if (a.stepId === "final_response") return 1;
    if (b.stepId === "final_response") return -1;
    if (a.stepId === "routing_fin") return 1;
    if (b.stepId === "routing_fin") return -1;
    if (a.stepSeq !== undefined && b.stepSeq !== undefined) {
      return a.stepSeq - b.stepSeq;
    }
    const aMinTime = Math.min(...a.iterations.map((i) => i.timestamp));
    const bMinTime = Math.min(...b.iterations.map((i) => i.timestamp));
    return aMinTime - bMinTime;
  });

  return result;
}

const MAX_DERIVED_INTERACTIONS = 50;
const hasRaw = (it: ModelIteration): boolean => it.rawInput !== undefined || it.rawOutput !== undefined;

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