/**
 * JARVIS Core — Generación de ModelIteration para auditoría de modelos
 * Soporte para eventos de ciclo de vida de Decision-2.0-Eos-0.8B y Qwen 3.5 9B.
 */

import type { CoreEvent, Task } from "./types.ts";
import { EXECUTABLE_ROUTES, type ModelIteration } from "./types.ts";

// Instantáneas: captura el estado en el instante exacto del evento
const snapLog = (t?: Task | null): string[] => [...(t?.memory?.log ?? [])];
const snapFail = (t?: Task | null): string[] => [...(t?.memory?.fail ?? [])];
const snapEffects = (t?: Task | null): string[] => [...(t?.memory?.effects ?? [])];
const snapFacts = (t?: Task | null): Record<string, string> => ({ ...(t?.memory?.facts ?? {}) });
const topMargin = (p?: Record<string, number>): number | undefined => {
  const v = Object.values(p ?? {}).sort((a, b) => b - a);
  return v.length >= 2 ? Number((v[0] - v[1]).toFixed(4)) : undefined;
};

/**
 * Construye un ModelIteration a partir de un CoreEvent emitido por el orquestador.
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
      if (task?.mode === "PLAN") {
        return null;
      }

      const isFin = data.route === "fin";
      const targetStepSeq = (task?.stepSeq ?? (task?.steps?.length ? task.steps.length : 0)) + 1;
      const expectedStepId = isFin ? "routing_fin" : (stepId || `s${targetStepSeq}`);

      const matchingStep = task?.steps?.find((s) => s.id === expectedStepId);

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
          rutasCandidatas: [...EXECUTABLE_ROUTES, "fin"],
          esPrimeraIteracion: (task?.steps?.length || 0) <= 1,
        },
        output: {
          rutaSeleccionada: data.route,
          confianza: data.confidence,
          probabilidades: data.probabilities || (data.answers?.route?.probabilities ?? {}),
          margen: topMargin(data.probabilities),
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
          servidorMCP: currentStep?.mcp,
          herramientasCandidatas: data.candidates || [],
          memoriaEnviada: data.memory || "",
        },
        output: {
          herramientaSeleccionada: data.tool,
          confianza: data.confidence,
          distribucionProbabilidades: data.probabilities || {},
          margen: topMargin(data.probabilities),
        },
        metrics: {
          confidence: typeof data.confidence === "number" ? data.confidence : undefined,
        },
      };
    }

    case "ARGUMENTS_GENERATED": {
      const data = event.data as any;
      const failed = typeof data.error === "string";
      return {
        id: `iter_${ts}_qwen_args_${stepId || "step"}${data.attempt ? `_a${data.attempt}` : ""}`,
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
        output: failed
          ? { error: data.error }
          : {
            argumentos: data.args || {},
            referenciasResueltas: data.resolvedRefs || [],
            conteoReemplazos: data.replacedCount || 0,
          },
        metrics: {
          verdict: failed ? "Argumentos inválidos" : "Argumentos estructurados",
        },
        error: failed ? data.error : undefined,
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
          verificadoPor: data.verifiedBy,
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
      const isReplan = data.replan === true;
      const steps = (data.steps || task?.steps || []).filter((s: any) => !s.superseded);
      return {
        id: `iter_${ts}_qwen_${isReplan ? "replan" : "plan"}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: isReplan ? "REPLAN" : "PLAN_GENERATION",
        stepId: "plan_global",
        stepTitle: isReplan ? "Replanificación Autónoma" : "Planificación Estratégica Global",
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
          verdict: `${isReplan ? "Replan" : "Plan"} con ${steps.length} etapas estructuradas`,
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