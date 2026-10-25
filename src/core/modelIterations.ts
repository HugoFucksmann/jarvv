/**
 * JARVIS Core — Construcción de ModelIteration (auditoría de los modelos)
 *
 * Convierte cada CoreEvent del orquestador en un registro de lo que Decision-2.0-Eos-0.8B o Qwen 3.5 9B recibieron y
 * devolvieron. El servidor lo usa en cada evento (core.ts) y el cliente lo reutiliza para reconstruir las iteraciones
 * desde el SSE; por eso no puede depender de módulos de Node. Los ayudantes de veredicto se comparten con la UI para
 * que ambos lados describan igual el resultado de una llamada.
 */

import type { CallStatus, CoreEvent, ExecutedCallStatus, Task, TaskState, TimeSpan } from "./types.ts";
import { EXECUTABLE_ROUTES, type ModelIteration } from "./types.ts";
import { buildEffectsContext } from "./context.ts";

// Instantáneas: captura el estado en el instante exacto del evento
const snapLog = (t?: Task | null): string[] => [...(t?.memory?.log ?? [])];
const snapFail = (t?: Task | null): string[] => [...(t?.memory?.fail ?? [])];
// Los efectos se derivan de las llamadas registradas (no hay almacén propio): ver buildEffectsContext.
const snapEffects = (t?: Task | null): string[] => (t ? buildEffectsContext(t, Number.POSITIVE_INFINITY) : []);
const snapFacts = (t?: Task | null): Record<string, string> => ({ ...(t?.memory?.facts ?? {}) });

/** Diferencia entre las dos probabilidades más altas: la señal real de qué tan decidido estuvo el modelo. */
export const topMargin = (p?: Record<string, number>): number | undefined => {
  const v = Object.values(p ?? {}).sort((a, b) => b - a);
  return v.length >= 2 ? Number((v[0] - v[1]).toFixed(4)) : undefined;
};

/** Veredicto de una llamada ejecutada: se deriva del estado único calculado en callExecutor (classifyCall). */
const CALL_VERDICT: Record<ExecutedCallStatus, string> = {
  ok: "PASO VERIFICADO",
  unverified: "SIN VEREDICTO (verificación no disponible)",
  rejected: "RESULTADO NO APROBADO",
  tool_error: "ERROR DE HERRAMIENTA",
  not_found: "RECURSO NO ENCONTRADO",
  no_data: "SIN DATOS",
};

export const callVerdict = (status?: CallStatus): string =>
  status && status in CALL_VERDICT ? CALL_VERDICT[status as ExecutedCallStatus] : status ? "LLAMADA FALLIDA" : "SIN ESTADO";

const FINAL_STATE_LABEL: Partial<Record<TaskState, string>> = { COMPLETED: "completada", PARTIAL: "parcial", FAILED: "fallida" };

/** Veredicto de la respuesta final: describe su origen y el estado real de la tarea, no una finalización asumida. */
export const finalResponseVerdict = (source: "model" | "fallback" | undefined, state?: TaskState): string =>
  `${source === "fallback" ? "Respuesta de respaldo" : "Respuesta sintetizada"} · tarea ${(state && FINAL_STATE_LABEL[state]) ?? state?.toLowerCase() ?? "sin estado"}`;

/** Un intercambio real con el modelo: hay entrada enviada y no es un atajo determinista. */
const isExchange = (rawInput: unknown, shortcut = false): boolean => rawInput !== undefined && !shortcut;

const timingOf = (v: unknown): TimeSpan | undefined => {
  const t = v as Partial<TimeSpan> | null | undefined;
  return t && typeof t.startedAt === "number" && typeof t.durationMs === "number" ? (t as TimeSpan) : undefined;
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
      const timing = timingOf(data.timing);

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
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        invoked: isExchange(data.rawInput),
        input: {
          objetivo: task?.message || "Instrucción del usuario",
          historialRegistrado: snapLog(task),
          hechosConfirmados: snapFacts(task),
          rutasCandidatas: [...EXECUTABLE_ROUTES, "fin"],
          esPrimeraIteracion: (task?.steps?.length || 0) <= 1,
        },
        output: {
          rutaSeleccionada: data.route,
          probabilidades: data.probabilities || (data.answers?.route?.probabilities ?? {}),
          margen: topMargin(data.probabilities),
          necesitaContextoAdicional: Boolean(data.needsContext),
        },
        metrics: {
          latencyMs: timing?.durationMs,
          margin: topMargin(data.probabilities),
          tokens: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined,
        },
      };
    }

    case "DECISION_TWO": {
      const data = event.data as any;
      const timing = timingOf(data.timing);
      // Con una sola herramienta posible no hay llamada al modelo: lo que se registra es la decisión determinista,
      // sin la memoria (no se envió), sin una "confianza" de 1 y sin margen (no hay alternativa que comparar).
      const shortcut = data.shortcut === true;
      return {
        id: `iter_${ts}_eos_d2_${stepId || "step"}`,
        taskId,
        model: "EOS_0_8B",
        stage: "DECISION_TWO",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: ${currentStep.instruction.slice(0, 40)}` : "Selección de Herramienta",
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        invoked: isExchange(data.rawInput, shortcut),
        input: shortcut
          ? {
            instruccionEtapa: currentStep?.instruction || "Acción inmediata",
            servidorMCP: currentStep?.mcp,
            herramientasCandidatas: data.candidates || [],
          }
          : {
            instruccionEtapa: currentStep?.instruction || "Acción inmediata",
            servidorMCP: currentStep?.mcp,
            herramientasCandidatas: data.candidates || [],
            memoriaEnviada: data.memory || "",
          },
        output: shortcut
          ? {
            herramientaSeleccionada: data.tool,
            origen: "atajo determinista: herramienta única (sin llamada al modelo)",
          }
          : {
            herramientaSeleccionada: data.tool,
            distribucionProbabilidades: data.probabilities || {},
            margen: topMargin(data.probabilities),
          },
        metrics: shortcut ? undefined : { latencyMs: timing?.durationMs, margin: topMargin(data.probabilities) },
      };
    }

    case "ARGUMENTS_GENERATED": {
      const data = event.data as any;
      const failed = typeof data.error === "string";
      const timing = timingOf(data.timing);
      return {
        id: `iter_${ts}_qwen_args_${stepId || "step"}${data.attempt ? `_a${data.attempt}` : ""}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "ARGUMENT_GENERATION",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: Invocación de Argumentos` : "Generación de Argumentos",
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        invoked: isExchange(data.rawInput),
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
          latencyMs: timing?.durationMs,
          verdict: failed ? "Argumentos inválidos" : "Argumentos estructurados",
        },
        error: failed ? data.error : undefined,
      };
    }

    case "RESULT_PROCESSED": {
      const data = event.data as any;
      const processed = data.processed || {};
      const verification = data.verification || null;
      const isStepSuccess = Boolean(data.isStepSuccess);
      // Eos solo verifica cuando las señales físicas son limpias: sin su intercambio no hay veredicto de Eos que mostrar.
      const eosRan = isExchange(verification?.rawInput);
      const timing = timingOf(verification?.timing);

      return {
        id: `iter_${ts}_eos_verify_${stepId || "step"}`,
        taskId,
        model: "EOS_0_8B",
        stage: "STEP_VERIFICATION",
        stepId,
        stepSeq,
        stepTitle: currentStep ? `Paso #${stepSeq || 1}: Verificación Factual` : "Verificación de Resultado",
        // Eos corre antes que el segundo juez y antes de que se emita este evento: se ubica donde empezó de verdad.
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput || verification?.rawInput,
        rawOutput: data.rawOutput || verification?.rawOutput,
        invoked: eosRan,
        input: {
          instruccionEtapa: currentStep?.instruction || "",
          herramientaEjecutada: currentStep?.tool || currentStep?.calls?.slice(-1)[0]?.tool || "MCP",
          resumenObservacion: processed.summaryText || processed.decisionSummary || processed.compactObs || "",
          resultadoEsperado: currentStep?.expectedOutcome || "Ejecución exitosa y consistente",
        },
        output: {
          estadoLlamada: data.callStatus,
          veredictoOk: eosRan ? verification.ok : null,
          veredictoCumple: eosRan ? verification.cumple : null,
          probabilidadOk: eosRan ? verification.okProbability : null,
          probabilidadCumple: eosRan ? verification.cumpleProbability : null,
          // Quién aprobó el paso; "ninguno" cuando nadie lo aprobó (rechazado, sin veredicto o con error de herramienta).
          verificadoPor: data.verifiedBy ?? "ninguno",
          senalesFisicas: processed.signals || {},
          hallazgo: processed.finding || processed.summaryText || "",
          // Estado real tras verificar (no el que fija el procesador antes de verificar).
          estadoVerificacion: data.verificationState ?? processed.verification,
          duracionHerramientaMs: timingOf(data.execution)?.durationMs,
        },
        metrics: {
          latencyMs: timing?.durationMs,
          isStepSuccess,
          verdict: callVerdict(data.callStatus),
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
      const targetStepId = stepId || data.stepId || data.stageId;
      const timing = timingOf(data.timing ?? sv.timing);
      return {
        id: `iter_${ts}_qwen_stage_${targetStepId || "stage"}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "STAGE_VERIFICATION",
        stepId: targetStepId,
        stepSeq,
        stepTitle: `Verificación Semántica de Etapa ${targetStepId || ""}`,
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput || sv.rawInput,
        rawOutput: data.rawOutput || sv.rawOutput,
        invoked: isExchange(data.rawInput || sv.rawInput),
        input: {
          meta: task?.message || "",
          etapaId: targetStepId,
          situacionObservada: data.situation,
        },
        output: {
          estado: stageStatus,
          motivo: stageReason,
          preguntaUsuario: stageQuestion,
        },
        metrics: {
          latencyMs: timing?.durationMs,
          verdict: stageStatus,
        },
      };
    }

    case "PLAN_GENERATED": {
      const data = event.data as any;
      const isReplan = data.replan === true;
      const timing = timingOf(data.timing);
      const steps = (data.steps || task?.steps || []).filter((s: any) => !s.superseded);
      return {
        id: `iter_${ts}_qwen_${isReplan ? "replan" : "plan"}`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: isReplan ? "REPLAN" : "PLAN_GENERATION",
        stepId: "plan_global",
        stepTitle: isReplan ? "Replanificación Autónoma" : "Planificación Estratégica Global",
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        invoked: isExchange(data.rawInput),
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
          latencyMs: timing?.durationMs,
          verdict: `${isReplan ? "Replan" : "Plan"} con ${steps.length} etapas estructuradas`,
        },
      };
    }

    case "FINAL_RESPONSE": {
      const data = event.data as any;
      const timing = timingOf(data.timing);
      return {
        id: `iter_${ts}_qwen_final`,
        taskId,
        model: "QWEN_3_5_9B",
        stage: "FINAL_RESPONSE",
        stepId: "final_response",
        stepTitle: "Síntesis y Respuesta Final",
        timestamp: timing?.startedAt ?? ts,
        rawInput: data.rawInput,
        rawOutput: data.rawOutput,
        invoked: isExchange(data.rawInput),
        input: {
          objetivo: task?.message || "",
          hechosConfirmados: snapFacts(task),
          registroLog: snapLog(task),
          efectosSecundarios: snapEffects(task),
          fallosRegistrados: snapFail(task),
        },
        output: {
          respuestaSintetizada: data.response || task?.finalResponse || "",
          origen: data.source === "fallback" ? "plantilla de respaldo" : "modelo",
        },
        error: data.synthesisError,
        metrics: {
          latencyMs: timing?.durationMs,
          verdict: finalResponseVerdict(data.source, data.state),
        },
      };
    }

    default:
      return null;
  }
}