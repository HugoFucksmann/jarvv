import React, { useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import type { ModelIteration } from "../../../types/debug.ts";
import { CopyButton } from "../../Shared/CopyButton.tsx";

interface ModelIterationCardProps {
  iteration: ModelIteration;
  isInitiallyExpanded?: boolean;
}

export const ModelIterationCard: React.FC<ModelIterationCardProps> = ({
  iteration,
  isInitiallyExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);
  const [activeTab, setActiveTab] = useState<"detail" | "input" | "output">("detail");

  useEffect(() => {
    if (isInitiallyExpanded !== undefined) {
      setIsExpanded(isInitiallyExpanded);
    }
  }, [isInitiallyExpanded]);

  const isEos = iteration.model === "EOS_0_8B";
  const modelColorClass = isEos ? "text-sky-400" : "text-indigo-400";
  const modelBgClass = isEos ? "bg-sky-950/20 border-sky-900/50" : "bg-indigo-950/20 border-indigo-900/50";
  const modelBadgeName = isEos ? "Eos-0.8B" : "Qwen 3.5 9B";

  const getStageTitle = (stage: ModelIteration["stage"]) => {
    switch (stage) {
      case "DECISION_ONE":
        return "Decisión #1: Enrutamiento";
      case "DECISION_TWO":
        return "Decisión #2: Tool";
      case "ARGUMENT_GENERATION":
        return "Generación Argumentos";
      case "STEP_VERIFICATION":
        return "Verificación Factual";
      case "STAGE_VERIFICATION":
        return "Verificación Etapa";
      case "PLAN_GENERATION":
        return "Planificación Global";
      case "FINAL_RESPONSE":
        return "Respuesta Final";
      case "REPLAN":
        return "Replanificación";
      default:
        return stage;
    }
  };

  const displayInput = iteration.rawInput || (typeof iteration.input === "string" ? iteration.input : JSON.stringify(iteration.input, null, 2));
  const displayOutput = iteration.rawOutput || (typeof iteration.output === "string" ? iteration.output : JSON.stringify(iteration.output, null, 2));

  // Lo que copia el botón del encabezado depende de la pestaña activa
  const getHeaderCopyText = () => {
    if (activeTab === "input") return displayInput;
    if (activeTab === "output") return displayOutput;
    return JSON.stringify(
      {
        id: iteration.id,
        timestamp: new Date(iteration.timestamp).toISOString(),
        model: iteration.model,
        stage: iteration.stage,
        stepId: iteration.stepId,
        stepSeq: iteration.stepSeq,
        metrics: iteration.metrics,
        rawInput: displayInput,
        rawOutput: displayOutput,
        input: iteration.input,
        output: iteration.output,
      },
      null,
      2,
    );
  };

  const formattedTime = new Date(iteration.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Extracción de datos específicos según etapa
  const outputData = (typeof iteration.output === "object" && iteration.output !== null ? iteration.output : {}) as any;

  // Decision One (Routing)
  const d1Route = outputData.rutaSeleccionada || outputData.route;
  const d1Probabilities = outputData.probabilidades || outputData.probabilities || {};
  const d1NeedsContext = Boolean(outputData.necesitaContextoAdicional ?? outputData.needsContext);

  // Decision Two (Tool Selection)
  const d2Tool = outputData.herramientaSeleccionada || outputData.tool;
  const d2Probabilities = outputData.distribucionProbabilidades || outputData.probabilities || {};

  // Step Verification
  const verifyOk = outputData.veredictoOk ?? outputData.ok ?? iteration.metrics?.isStepSuccess;
  const verifyCumple = outputData.veredictoCumple ?? outputData.cumple ?? iteration.metrics?.isStepSuccess;
  const verifySignals = outputData.senalesFisicas || iteration.metrics?.signals || {};
  const verifyFinding = outputData.hallazgo || outputData.finding || "";
  const isCleanSignals =
    !verifySignals.exception &&
    !verifySignals.timeout &&
    !verifySignals.denied &&
    !verifySignals.not_found &&
    !verifySignals.empty_output &&
    !verifySignals.stale_element &&
    (verifySignals.exit_code === 0 || verifySignals.exit_code === undefined);

  // Argument Generation
  const argsCount = outputData.argumentos ? Object.keys(outputData.argumentos).length : (outputData.args ? Object.keys(outputData.args).length : null);

  // Plan Generation
  const planStepsCount = outputData.cantidadEtapas || (Array.isArray(outputData.steps) ? outputData.steps.length : null);

  // Stage Verification (Qwen Semantics)
  const stageStatus = outputData.estado || outputData.status || (outputData.stageVerification ? outputData.stageVerification.status : undefined) || iteration.metrics?.verdict;
  const stageReason = outputData.motivo || outputData.reason || "";
  const stageQuestion = outputData.preguntaUsuario || outputData.questionForUser || outputData.question_for_user || "";

  const resolvedConfidence = useMemo(() => {
    if (typeof iteration.metrics?.confidence === "number") {
      return iteration.metrics.confidence;
    }
    if (typeof outputData.confianza === "number") {
      return outputData.confianza;
    }
    if (iteration.stage === "DECISION_ONE") {
      const route = outputData.rutaSeleccionada || outputData.route;
      const probs = outputData.probabilidades || outputData.probabilities;
      if (route && probs && typeof probs[route] === "number") {
        return probs[route];
      }
    }
    if (iteration.stage === "DECISION_TWO") {
      const tool = outputData.herramientaSeleccionada || outputData.tool;
      const probs = outputData.distribucionProbabilidades || outputData.probabilities;
      if (tool && probs && typeof probs[tool] === "number") {
        return probs[tool];
      }
    }
    return undefined;
  }, [iteration, outputData]);

  const stageConfidence = typeof resolvedConfidence === "number" ? resolvedConfidence : undefined;

  return (
    <div className={`flex flex-col rounded-md border ${modelBgClass} overflow-hidden text-xs transition-all`}>
      {/* Header — Click para abrir/cerrar (por defecto minimizado/encojido) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 bg-slate-950/60 hover:bg-slate-900/60 cursor-pointer select-none transition-colors border-b border-slate-800/60"
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-slate-300 font-medium">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
            {isEos ? (
              <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            )}
            <span className={`${modelColorClass} font-semibold`}>{modelBadgeName}</span>
          </div>

          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-200 font-semibold">{getStageTitle(iteration.stage)}</span>
          {iteration.id.startsWith("iter_reconstructed_") && (
            <span
              title="Iteración sintetizada a partir del resultado de los pasos para tareas anteriores a v2.2 sin registro crudo persistido"
              className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/80"
            >
              Reconstruida
            </span>
          )}
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-500 tabular-nums">{formattedTime}</span>

          {/* Resumen clave en la cabecera minimizada */}
          {iteration.stage === "DECISION_ONE" && d1Route && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">Ruta:</span>
              <span className="text-sky-300 font-semibold">{d1Route}</span>
            </>
          )}

          {iteration.stage === "DECISION_TWO" && d2Tool && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">Tool:</span>
              <span className="text-emerald-300 font-semibold">{d2Tool}</span>
            </>
          )}

          {iteration.stage === "STEP_VERIFICATION" && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={verifyOk ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                ok: {verifyOk ? "✓" : "✗"}
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={verifyCumple ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                cumple: {verifyCumple ? "✓" : "✗"}
              </span>
            </>
          )}

          {iteration.stage === "ARGUMENT_GENERATION" && argsCount !== null && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">{argsCount} parámetros</span>
            </>
          )}

          {iteration.stage === "PLAN_GENERATION" && planStepsCount !== null && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-indigo-300">{planStepsCount} etapas propuestas</span>
            </>
          )}

          {iteration.stage === "STAGE_VERIFICATION" && stageStatus && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={
                stageStatus === "completed"
                  ? "text-emerald-400 font-semibold"
                  : stageStatus === "recoverable_deviation"
                    ? "text-amber-400 font-semibold"
                    : stageStatus === "insufficient_info"
                      ? "text-sky-300 font-semibold"
                      : "text-rose-400 font-semibold"
              }>
                {stageStatus === "completed" ? "✓ Etapa Completada" : stageStatus}
              </span>
            </>
          )}

          {isEos && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={typeof resolvedConfidence === "number" ? "text-emerald-400 tabular-nums" : "text-slate-500 tabular-nums"}>
                Conf: {typeof resolvedConfidence === "number" ? `${(resolvedConfidence * 100).toFixed(0)}%` : "N/D"}
              </span>
            </>
          )}

          {iteration.metrics?.verdict && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={`font-semibold flex items-center gap-1 ${iteration.metrics.isStepSuccess !== false ? "text-emerald-400" : "text-rose-400"
                }`}>
                {iteration.metrics.isStepSuccess !== false ? (
                  <ShieldCheck className="w-3 h-3 inline" />
                ) : (
                  <AlertTriangle className="w-3 h-3 inline" />
                )}
                {iteration.metrics.verdict}
              </span>
            </>
          )}
        </div>

        {/* Acciones del encabezado */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <CopyButton
            text={getHeaderCopyText}
            label={activeTab === "input" ? "Copiar Entrada" : activeTab === "output" ? "Copiar Salida" : "Copiar"}
            title={activeTab === "input" ? "Copiar entrada cruda al portapapeles" : activeTab === "output" ? "Copiar salida cruda al portapapeles" : "Copiar datos completos de la iteración en JSON"}
            iconColor="text-slate-400"
            stopPropagation
            className="gap-1 px-2 py-0.5 text-[11px] font-mono rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
          />
        </div>
      </div>

      {/* Contenido desplegado (cuando se expande) */}
      {isExpanded && (
        <div className="flex flex-col gap-2.5 p-3 bg-slate-950/40 font-mono text-[11px]">
          {/* Selector de Pestaña Interna */}
          <div className="flex items-center justify-between pb-1.5 text-[10px] text-slate-400 border-b border-slate-900">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("detail");
                }}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeTab === "detail" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-300"
                  }`}
              >
                Panel Estructurado
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("input");
                }}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeTab === "input" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-300"
                  }`}
              >
                Entrada (Prompt)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("output");
                }}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeTab === "output" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-300"
                  }`}
              >
                Salida (JSON)
              </button>
            </div>
            {iteration.stepTitle && (
              <span className="text-slate-500 truncate max-w-sm hidden sm:inline">{iteration.stepTitle}</span>
            )}
          </div>

          {/* Vistas según pestaña activa */}
          {activeTab === "detail" && (
            <div className="flex flex-col gap-2">
              {/* Eos Decision #1: Routing Breakdown */}
              {iteration.stage === "DECISION_ONE" && (
                <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div>
                      <span className="text-slate-500">Ruta Seleccionada: </span>
                      <span className="text-sky-300 font-semibold font-sans">
                        {d1Route === "fin" ? "Fin (Terminación Directa)" : d1Route}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Confianza Argmax: </span>
                      <span className="text-emerald-400 font-semibold">
                        {typeof resolvedConfidence === "number"
                          ? `${(resolvedConfidence * 100).toFixed(1)}%`
                          : "N/D"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Ventana Contexto: </span>
                      <span className={d1NeedsContext ? "text-amber-300" : "text-slate-400"}>
                        {d1NeedsContext ? "Ampliada (>= 0.6)" : "Estándar"}
                      </span>
                    </div>
                  </div>

                  {/* Distribución de Probabilidades */}
                  {Object.keys(d1Probabilities).length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-slate-400 font-medium text-[10px]">
                        Distribución de Probabilidades Eos-0.8B:
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.entries(d1Probabilities).map(([key, val]) => {
                          const pct = (Number(val) * 100).toFixed(0);
                          const isSelected = key === d1Route;
                          return (
                            <div
                              key={key}
                              className={`p-1.5 rounded border text-[11px] ${isSelected
                                  ? "bg-sky-950/60 border-sky-800 text-sky-200 font-semibold"
                                  : "bg-slate-900/50 border-slate-800 text-slate-400"
                                }`}
                            >
                              <div className="flex justify-between items-center">
                                <span>{key}</span>
                                <span className={isSelected ? "text-sky-300" : "text-slate-500"}>{pct}%</span>
                              </div>
                              <div className="w-full bg-slate-800 h-1 rounded-full mt-1 overflow-hidden">
                                <div
                                  className={`h-full ${isSelected ? "bg-sky-400" : "bg-slate-600"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Eos Decision #2: Tool Selection Breakdown */}
              {iteration.stage === "DECISION_TWO" && (
                <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 text-slate-300">
                    <div>
                      <span className="text-slate-500">Herramienta Seleccionada: </span>
                      <span className="text-emerald-300 font-semibold font-sans">{d2Tool}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Confianza: </span>
                      <span className="text-emerald-400 font-semibold">
                        {typeof resolvedConfidence === "number"
                          ? `${(resolvedConfidence * 100).toFixed(1)}%`
                          : "N/D"}
                      </span>
                    </div>
                  </div>

                  {/* Ranking de Herramientas Evaluadas */}
                  {Object.keys(d2Probabilities).length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-slate-400 font-medium text-[10px]">
                        Herramientas Evaluadas por Eos-0.8B:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {Object.entries(d2Probabilities)
                          .sort(([, a], [, b]) => Number(b) - Number(a))
                          .slice(0, 6)
                          .map(([key, val]) => {
                            const pct = (Number(val) * 100).toFixed(0);
                            const isSelected = key === d2Tool;
                            return (
                              <div
                                key={key}
                                className={`flex items-center justify-between p-1.5 rounded border text-[11px] ${isSelected
                                    ? "bg-emerald-950/60 border-emerald-800 text-emerald-200 font-semibold"
                                    : "bg-slate-900/50 border-slate-800 text-slate-400"
                                  }`}
                              >
                                <span className="truncate mr-2">{key}</span>
                                <span className={isSelected ? "text-emerald-300" : "text-slate-500"}>{pct}%</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Eos Step Verification: Factual Verification Breakdown */}
              {iteration.stage === "STEP_VERIFICATION" && (
                <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">ok:</span>
                      {verifyOk ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 inline" /> SÍ (Válido)
                        </span>
                      ) : (
                        <span className="text-rose-400 font-semibold flex items-center gap-1">
                          <XCircle className="w-3 h-3 inline" /> NO (Error)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">cumple:</span>
                      {verifyCumple ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 inline" /> SÍ (Cumple)
                        </span>
                      ) : (
                        <span className="text-rose-400 font-semibold flex items-center gap-1">
                          <XCircle className="w-3 h-3 inline" /> NO (Desviación)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Señales:</span>
                      {isCleanSignals ? (
                        <span className="text-emerald-300 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" /> Limpias (CLEAN)
                        </span>
                      ) : (
                        <span className="text-amber-300 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400 inline" /> Anomalías
                        </span>
                      )}
                    </div>
                  </div>

                  {verifyFinding && (
                    <div className="text-[11px] text-slate-300 pt-1">
                      <span className="text-slate-500 font-medium">Hallazgo Factual: </span>
                      <span>{verifyFinding}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Qwen Semantic Stage Verification */}
              {iteration.stage === "STAGE_VERIFICATION" && (
                <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 text-slate-300">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-medium">Veredicto Semántico:</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${stageStatus === "completed"
                          ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
                          : stageStatus === "recoverable_deviation"
                            ? "bg-amber-950/80 text-amber-300 border-amber-800"
                            : stageStatus === "insufficient_info"
                              ? "bg-sky-950/80 text-sky-300 border-sky-800"
                              : "bg-rose-950/80 text-rose-300 border-rose-800"
                        }`}>
                        {stageStatus === "completed" && "COMPLETED (Objetivo Cumplido)"}
                        {stageStatus === "recoverable_deviation" && "RECOVERABLE_DEVIATION (Desviación)"}
                        {stageStatus === "insufficient_info" && "INSUFFICIENT_INFO (Requiere Respuesta)"}
                        {stageStatus === "unrecoverable_blocked" && "UNRECOVERABLE_BLOCKED (Bloqueado)"}
                        {!["completed", "recoverable_deviation", "insufficient_info", "unrecoverable_blocked"].includes(stageStatus) && stageStatus}
                      </span>
                    </div>

                    {typeof stageConfidence === "number" && (
                      <div className="text-[11px]">
                        <span className="text-slate-500">Confianza: </span>
                        <span className="text-indigo-400 font-semibold font-mono">
                          {(stageConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {stageReason && (
                    <div className="flex flex-col gap-1 text-[11px] text-slate-300 pt-1">
                      <span className="text-slate-400 font-medium">Justificación Semántica:</span>
                      <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60 text-slate-200 leading-relaxed font-sans">
                        {stageReason}
                      </div>
                    </div>
                  )}

                  {stageQuestion && (
                    <div className="flex flex-col gap-1 text-[11px] pt-1">
                      <div className="flex items-center gap-1.5 text-sky-400 font-medium">
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Pregunta Formulada al Usuario:</span>
                      </div>
                      <div className="p-2 rounded bg-sky-950/40 border border-sky-800/60 text-sky-200 leading-relaxed font-sans">
                        {stageQuestion}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Qwen / Other Stages: Structured Overview */}
              {iteration.stage !== "DECISION_ONE" &&
                iteration.stage !== "DECISION_TWO" &&
                iteration.stage !== "STEP_VERIFICATION" &&
                iteration.stage !== "STAGE_VERIFICATION" && (
                  <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
                    <pre className="text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed text-[11px]">
                      {typeof iteration.output === "string"
                        ? iteration.output
                        : JSON.stringify(iteration.output, null, 2)}
                    </pre>
                  </div>
                )}
            </div>
          )}

          {activeTab === "input" && (
            <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                  Entrada Cruda ({isEos ? "Payload { state, questions } enviado a Eos" : "Payload JSON completo enviado a Qwen"})
                </span>
                <CopyButton
                  text={displayInput}
                  label="Copiar entrada cruda"
                  title="Copiar string crudo completo de entrada"
                  iconColor="text-slate-400"
                  stopPropagation
                  className="gap-1 px-2 py-0.5 text-[10px] font-mono rounded text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700"
                />
              </div>
              <pre className="text-slate-200 whitespace-pre-wrap break-all max-h-80 overflow-y-auto leading-relaxed text-[11px] font-mono select-text p-1 bg-slate-950/40 rounded">
                {displayInput}
              </pre>
            </div>
          )}

          {activeTab === "output" && (
            <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/60 border border-slate-800/80">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                  Salida Cruda ({isEos ? "Respuesta original devuelta por Eos" : "Respuesta original devuelta por Qwen"})
                </span>
                <CopyButton
                  text={displayOutput}
                  label="Copiar salida cruda"
                  title="Copiar string crudo completo de salida"
                  iconColor="text-slate-400"
                  stopPropagation
                  className="gap-1 px-2 py-0.5 text-[10px] font-mono rounded text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700"
                />
              </div>
              <pre className="text-slate-200 whitespace-pre-wrap break-all max-h-80 overflow-y-auto leading-relaxed text-[11px] font-mono select-text p-1 bg-slate-950/40 rounded">
                {displayOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};