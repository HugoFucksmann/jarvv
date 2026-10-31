import React, { memo, useState } from "react";
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
import type { ModelIteration, ModelStage } from "../../../types/debug.ts";
import { CopyButton } from "../../Shared/CopyButton.tsx";
import { JsonViewer } from "../../Shared/JsonViewer.tsx";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";
import { MODELS } from "../../../../src/core/models.ts";
import { EXECUTABLE_ROUTES, type ExecutableRoute } from "../../../../src/core/types.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";

interface ModelIterationCardProps {
  iteration: ModelIteration;
}

/** Exhaustivo: una etapa nueva en el core se detecta al compilar. */
const STAGE_TITLES: Record<ModelStage, string> = {
  DECISION_ONE: "Decisión #1: Enrutamiento",
  DECISION_TWO: "Decisión #2: Tool",
  ARGUMENT_GENERATION: "Generación Argumentos",
  STEP_VERIFICATION: "Verificación Factual",
  STAGE_VERIFICATION: "Verificación Etapa",
  PLAN_GENERATION: "Planificación Global",
  FINAL_RESPONSE: "Respuesta Final",
  REPLAN: "Replanificación",
};

// `iteration.output` es un registro abierto; sus claves las fija `src/core/modelIterations.ts` (un constructor por etapa).
const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
const asProbabilities = (v: unknown): Record<string, number> => asRecord(v) as Record<string, number>;

const pct = (v: number, digits = 0): string => `${(v * 100).toFixed(digits)}%`;

/**
 * Etapas con panel estructurado propio. Exhaustivo: una etapa nueva en el core obliga a decidir aquí;
 * mientras valga `false`, el panel muestra su salida con el visor JSON.
 */
const STRUCTURED_STAGES: Record<ModelStage, boolean> = {
  DECISION_ONE: true,
  DECISION_TWO: true,
  STEP_VERIFICATION: true,
  STAGE_VERIFICATION: true,
  ARGUMENT_GENERATION: true,
  PLAN_GENERATION: true,
  REPLAN: true,
  FINAL_RESPONSE: true,
};

type Tab = "detail" | "input" | "output";
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["detail", "Panel Estructurado"],
  ["input", "Entrada (Prompt)"],
  ["output", "Salida (JSON)"],
];

/** Veredicto semántico de Qwen: texto de cabecera, etiqueta del panel y clases del distintivo. */
const STAGE_STATUS: Record<string, { head: string; label: string; badge: string }> = {
  completed: {
    head: "text-emerald-400",
    label: "COMPLETED (Objetivo Cumplido)",
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-800",
  },
  recoverable_deviation: {
    head: "text-amber-400",
    label: "RECOVERABLE_DEVIATION (Desviación)",
    badge: "bg-amber-950/80 text-amber-300 border-amber-800",
  },
  insufficient_info: {
    head: "text-sky-300",
    label: "INSUFFICIENT_INFO (Requiere Respuesta)",
    badge: "bg-sky-950/80 text-sky-300 border-sky-800",
  },
  unrecoverable_blocked: {
    head: "text-rose-400",
    label: "UNRECOVERABLE_BLOCKED (Bloqueado)",
    badge: "bg-rose-950/80 text-rose-300 border-rose-800",
  },
};
const STAGE_STATUS_UNKNOWN = { head: "text-rose-400", badge: "bg-rose-950/80 text-rose-300 border-rose-800" };

/** Texto crudo de una de las dos caras de la llamada; solo se calcula al copiar (no en cada render). */
const rawText = (raw: string | undefined, structured: unknown): string =>
  raw || (typeof structured === "string" ? structured : JSON.stringify(structured, null, 2));

/** `servidorSugerido` es la ruta del paso: se valida contra la lista del core antes de traducirla a su etiqueta. */
const routeLabel = (route?: string): string =>
  route && (EXECUTABLE_ROUTES as readonly string[]).includes(route)
    ? getRouteLabel(route as ExecutableRoute)
    : route ?? "—";

export const ModelIterationCard = memo(function ModelIterationCard({ iteration }: ModelIterationCardProps) {
  // Las tarjetas arrancan minimizadas; el estado es local y lo reinicia el remontaje del grupo.
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("detail");

  const isEos = iteration.model === "EOS_0_8B";
  const modelColorClass = isEos ? "text-sky-400" : "text-indigo-400";
  const modelBgClass = isEos ? "bg-sky-950/20 border-sky-900/50" : "bg-indigo-950/20 border-indigo-900/50";
  const modelBadgeName = MODELS[iteration.model].name;

  const getInputText = () => rawText(iteration.rawInput, iteration.input);
  const getOutputText = () => rawText(iteration.rawOutput, iteration.output);

  // Lo que copia el botón del encabezado depende de la pestaña activa
  const getHeaderCopyText = () => {
    if (activeTab === "input") return getInputText();
    if (activeTab === "output") return getOutputText();
    return JSON.stringify(
      {
        id: iteration.id,
        timestamp: new Date(iteration.timestamp).toISOString(),
        model: iteration.model,
        stage: iteration.stage,
        stepId: iteration.stepId,
        stepSeq: iteration.stepSeq,
        invoked: iteration.invoked,
        metrics: iteration.metrics,
        error: iteration.error,
        rawInput: getInputText(),
        rawOutput: getOutputText(),
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

  const out: Record<string, unknown> = typeof iteration.output === "object" ? iteration.output : {};
  const latencyMs = iteration.metrics?.latencyMs;
  const margin = iteration.metrics?.margin;
  // `invoked === false`: la decisión la tomó un atajo determinista (o no llegó a ejecutarse), no el modelo.
  const skippedModel = iteration.invoked === false;

  // Decision One (Routing)
  const d1Route = asString(out.rutaSeleccionada);
  const d1Probabilities = asProbabilities(out.probabilidades);
  const d1NeedsContext = out.necesitaContextoAdicional === true;

  // Decision Two (Tool Selection)
  const d2Tool = asString(out.herramientaSeleccionada);
  const d2Probabilities = asProbabilities(out.distribucionProbabilidades);
  const d2Origin = asString(out.origen);

  // Confianza de Eos: la probabilidad de la opción elegida (solo existe si hubo distribución)
  const selectedProbability =
    iteration.stage === "DECISION_ONE" && d1Route
      ? d1Probabilities[d1Route]
      : iteration.stage === "DECISION_TWO" && d2Tool
        ? d2Probabilities[d2Tool]
        : undefined;
  const resolvedConfidence = typeof selectedProbability === "number" ? selectedProbability : undefined;

  // Step Verification: `null` = Eos no corrió (señales físicas no limpias), el veredicto lo dio otro o nadie
  const verifyOk = asBool(out.veredictoOk);
  const verifyCumple = asBool(out.veredictoCumple);
  const verifiedBy = asString(out.verificadoPor);
  const verifyCallStatus = asString(out.estadoLlamada);
  const verifySignals = asRecord(out.senalesFisicas);
  const verifyFinding = asString(out.hallazgo) ?? "";
  const eosVerified = verifyOk !== null || verifyCumple !== null;
  const isCleanSignals =
    !verifySignals.exception &&
    !verifySignals.timeout &&
    !verifySignals.denied &&
    !verifySignals.not_found &&
    !verifySignals.empty_output &&
    !verifySignals.stale_element &&
    (verifySignals.exit_code === 0 || verifySignals.exit_code === undefined);

  // Argument Generation (con error el output solo trae `error`)
  const argsCount = out.argumentos !== undefined ? Object.keys(asRecord(out.argumentos)).length : null;

  // Plan Generation / Replan
  const planStepsCount = typeof out.cantidadEtapas === "number" ? out.cantidadEtapas : null;

  // Stage Verification (Qwen Semantics)
  const stageStatus = asString(out.estado);
  const stageReason = asString(out.motivo);
  const stageQuestion = asString(out.preguntaUsuario);

  // Qwen: argumentos, plan y respuesta final (claves fijadas por `modelIterations.ts`)
  const inp = asRecord(iteration.input);
  const argsTool = asString(inp.herramienta);
  const argsInstruction = asString(inp.instruccion);
  const argsValue = out.argumentos;
  const argsRefs = Array.isArray(out.referenciasResueltas) ? out.referenciasResueltas.map(String) : [];
  const argsReplaced = typeof out.conteoReemplazos === "number" ? out.conteoReemplazos : 0;
  const planSteps = Array.isArray(out.etapasPropuestas) ? out.etapasPropuestas.map(asRecord) : [];
  const finalText = asString(out.respuestaSintetizada);
  const finalOrigin = asString(out.origen);

  const sep = <span className="text-slate-600" aria-hidden="true">·</span>;

  const verdictBadge = (ok: boolean | null, label: string) =>
    ok === null ? (
      <span className="text-slate-500 font-semibold">{label}: N/D</span>
    ) : (
      <span className={ok ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
        {label}: {ok ? "✓" : "✗"}
      </span>
    );

  return (
    <div className={`@container flex flex-col rounded-lg border ${modelBgClass} overflow-hidden text-xs`}>
      {/* Header — Click para abrir/cerrar (por defecto minimizado/encojido) */}
      <div className="flex items-center justify-between bg-slate-950/60 border-b border-slate-800/60">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          className="flex flex-1 min-w-0 items-center gap-2 flex-wrap px-3 py-2.5 text-left text-xs font-mono hover:bg-slate-900/60 cursor-pointer select-none transition-colors"
        >
          <span className="flex items-center gap-1.5 text-slate-300 font-medium">
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
          </span>

          {sep}
          <span className="text-slate-200 font-semibold">{STAGE_TITLES[iteration.stage]}</span>
          {skippedModel && (
            <span
              title="Sin intercambio con el modelo: la salida la produjo un atajo determinista o la etapa no llegó a ejecutarse"
              className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/80"
            >
              Sin llamada al modelo
            </span>
          )}
          {sep}
          <span className="text-slate-500 tabular-nums">{formattedTime}</span>
          {latencyMs !== undefined && (
            <>
              {sep}
              <span className="text-slate-500 tabular-nums">{Math.round(latencyMs)} ms</span>
            </>
          )}

          {/* Resumen clave en la cabecera minimizada */}
          {iteration.stage === "DECISION_ONE" && d1Route && (
            <>
              {sep}
              <span className="text-slate-400">Ruta:</span>
              <span className="text-sky-300 font-semibold">{d1Route}</span>
            </>
          )}

          {iteration.stage === "DECISION_TWO" && d2Tool && (
            <>
              {sep}
              <span className="text-slate-400">Tool:</span>
              <span className="text-emerald-300 font-semibold">{d2Tool}</span>
            </>
          )}

          {iteration.stage === "STEP_VERIFICATION" && (
            <>
              {sep}
              {eosVerified ? (
                <>
                  {verdictBadge(verifyOk, "ok")}
                  {sep}
                  {verdictBadge(verifyCumple, "cumple")}
                </>
              ) : (
                <span className="text-slate-400">Eos no verificó · por: {verifiedBy ?? "ninguno"}</span>
              )}
            </>
          )}

          {iteration.stage === "ARGUMENT_GENERATION" && (
            <>
              {sep}
              {argsCount !== null ? (
                <span className="text-slate-400">{argsCount} parámetros</span>
              ) : (
                <span className="text-rose-400 font-semibold">error</span>
              )}
            </>
          )}

          {(iteration.stage === "PLAN_GENERATION" || iteration.stage === "REPLAN") && planStepsCount !== null && (
            <>
              {sep}
              <span className="text-indigo-300">{planStepsCount} etapas propuestas</span>
            </>
          )}

          {iteration.stage === "STAGE_VERIFICATION" && stageStatus && (
            <>
              {sep}
              <span className={`${(STAGE_STATUS[stageStatus] ?? STAGE_STATUS_UNKNOWN).head} font-semibold`}>
                {stageStatus === "completed" ? "✓ Etapa Completada" : stageStatus}
              </span>
            </>
          )}

          {(iteration.stage === "DECISION_ONE" || iteration.stage === "DECISION_TWO") && !skippedModel && (
            <>
              {sep}
              <span className={resolvedConfidence !== undefined ? "text-emerald-400 tabular-nums" : "text-slate-500 tabular-nums"}>
                Conf: {resolvedConfidence !== undefined ? pct(resolvedConfidence) : "N/D"}
              </span>
            </>
          )}

          {/* En la verificación semántica el veredicto ya es el estado de arriba */}
          {iteration.metrics?.verdict && iteration.stage !== "STAGE_VERIFICATION" && (
            <>
              {sep}
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
        </button>

        {/* Acciones del encabezado (fuera del botón: no se anidan controles interactivos) */}
        <div className="flex items-center gap-1 shrink-0 px-2">
          <CopyButton
            text={getHeaderCopyText}
            label={activeTab === "input" ? "Copiar Entrada" : activeTab === "output" ? "Copiar Salida" : "Copiar"}
            title={activeTab === "input" ? "Copiar entrada cruda al portapapeles" : activeTab === "output" ? "Copiar salida cruda al portapapeles" : "Copiar datos completos de la iteración en JSON"}
            iconColor="text-slate-400"
            className="gap-1 px-2 py-0.5 text-[11px] font-mono rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
          />
        </div>
      </div>

      {/* Contenido desplegado (cuando se expande) */}
      {isExpanded && (
        <div className="flex flex-col gap-3 px-3 py-3 font-mono text-[11px]">
          {/* Selector de Pestaña Interna */}
          <div className="flex items-center justify-between pb-1.5 text-[10px] text-slate-400 border-b border-slate-900">
            <div className="flex items-center gap-1">
              {TABS.map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${activeTab === tab ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-300"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {iteration.stepTitle && (
              <span className="text-slate-500 truncate max-w-sm hidden @md:inline">{iteration.stepTitle}</span>
            )}
          </div>

          {/* Vistas según pestaña activa */}
          {activeTab === "detail" && (
            <div className="flex flex-col gap-2">
              {iteration.error && (
                <div className="flex items-start gap-1.5 p-2 rounded bg-rose-950/30 border border-rose-900/60 text-rose-300 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="break-all">{iteration.error}</span>
                </div>
              )}

              {/* Eos Decision #1: Routing Breakdown */}
              {iteration.stage === "DECISION_ONE" && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div>
                      <span className="text-slate-500">Ruta Seleccionada: </span>
                      <span className="text-sky-300 font-semibold font-sans">
                        {d1Route === "fin" ? "Fin (Terminación Directa)" : d1Route}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Confianza Argmax: </span>
                      <span className="text-emerald-400 font-semibold">
                        {resolvedConfidence !== undefined ? pct(resolvedConfidence, 1) : "N/D"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Margen: </span>
                      <span className="text-slate-300">{margin !== undefined ? pct(margin, 1) : "N/D"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Ventana Contexto: </span>
                      <span className={d1NeedsContext ? "text-amber-300" : "text-slate-400"}>
                        {d1NeedsContext ? "Ampliada" : "Estándar"}
                      </span>
                    </div>
                  </div>

                  {/* Distribución de Probabilidades */}
                  {Object.keys(d1Probabilities).length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-slate-400 font-medium text-[10px]">
                        Distribución de Probabilidades {MODELS.EOS_0_8B.name}:
                      </span>
                      <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2">
                        {Object.entries(d1Probabilities).map(([key, val]) => {
                          const share = pct(val);
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
                                <span className={isSelected ? "text-sky-300" : "text-slate-500"}>{share}</span>
                              </div>
                              <div className="w-full bg-slate-800 h-1 rounded-full mt-1 overflow-hidden">
                                <div
                                  className={`h-full ${isSelected ? "bg-sky-400" : "bg-slate-600"}`}
                                  style={{ width: share }}
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
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div>
                      <span className="text-slate-500">Herramienta Seleccionada: </span>
                      <span className="text-emerald-300 font-semibold font-sans">{d2Tool}</span>
                    </div>
                    {d2Origin ? (
                      <span className="text-slate-400 font-sans">{d2Origin}</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-slate-500">Confianza: </span>
                          <span className="text-emerald-400 font-semibold">
                            {resolvedConfidence !== undefined ? pct(resolvedConfidence, 1) : "N/D"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Margen: </span>
                          <span className="text-slate-300">{margin !== undefined ? pct(margin, 1) : "N/D"}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Ranking de Herramientas Evaluadas */}
                  {Object.keys(d2Probabilities).length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-slate-400 font-medium text-[10px]">
                        Herramientas Evaluadas por {MODELS.EOS_0_8B.name}:
                      </span>
                      <div className="grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 gap-1.5">
                        {Object.entries(d2Probabilities)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 6)
                          .map(([key, val]) => {
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
                                <span className={isSelected ? "text-emerald-300" : "text-slate-500"}>{pct(val)}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step Verification: Factual Verification Breakdown */}
              {iteration.stage === "STEP_VERIFICATION" && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 @md:grid-cols-3 gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">ok:</span>
                      {verifyOk === null ? (
                        <span className="text-slate-400">N/D (Eos no verificó)</span>
                      ) : verifyOk ? (
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
                      {verifyCumple === null ? (
                        <span className="text-slate-400">N/D (Eos no verificó)</span>
                      ) : verifyCumple ? (
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

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    {verifyCallStatus && (
                      <span>
                        <span className="text-slate-500">Estado de llamada: </span>
                        {verifyCallStatus}
                      </span>
                    )}
                    <span>
                      <span className="text-slate-500">Verificado por: </span>
                      {verifiedBy ?? "ninguno"}
                    </span>
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
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 text-slate-300">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-medium">Veredicto Semántico:</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${(STAGE_STATUS[stageStatus ?? ""] ?? STAGE_STATUS_UNKNOWN).badge}`}>
                        {stageStatus ? (STAGE_STATUS[stageStatus]?.label ?? stageStatus) : "N/D"}
                      </span>
                    </div>
                  </div>

                  {stageReason && (
                    <div className="flex flex-col gap-1 text-[11px] text-slate-300 pt-1">
                      <span className="text-slate-400 font-medium">Justificación Semántica:</span>
                      <div className="pl-3 border-l-2 border-slate-700 text-slate-200 leading-relaxed font-sans">
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
                      <div className="pl-3 border-l-2 border-sky-700 text-sky-200 leading-relaxed font-sans">
                        {stageQuestion}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Qwen Argument Generation */}
              {iteration.stage === "ARGUMENT_GENERATION" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <div>
                      <span className="text-slate-500">Herramienta: </span>
                      <span className="text-emerald-300 font-semibold font-sans">{argsTool ?? "N/D"}</span>
                    </div>
                    {argsCount !== null && (
                      <span className="text-slate-400">
                        {argsCount} parámetros · {argsReplaced} referencias reemplazadas
                      </span>
                    )}
                  </div>

                  {argsInstruction && (
                    <div className="text-[11px] text-slate-300">
                      <span className="text-slate-500 font-medium">Instrucción: </span>
                      <span className="font-sans">{argsInstruction}</span>
                    </div>
                  )}

                  {argsValue !== undefined ? (
                    <JsonViewer data={argsValue} defaultExpandDepth={2} maxHeightClass="max-h-64" />
                  ) : (
                    <span className="text-[11px] text-slate-500">No se generaron argumentos válidos.</span>
                  )}

                  {argsRefs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] pt-1">
                      <span className="text-slate-500">Referencias resueltas:</span>
                      {argsRefs.map((ref) => (
                        <span key={ref} className="px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-900/60 text-sky-300">
                          {ref}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Qwen Plan / Replan */}
              {(iteration.stage === "PLAN_GENERATION" || iteration.stage === "REPLAN") && (
                <div className="flex flex-col gap-2">
                  <div className="pb-2 border-b border-slate-800/60 text-slate-300">
                    <span className="text-slate-500">{iteration.stage === "REPLAN" ? "Replanificación: " : "Plan: "}</span>
                    <span className="text-indigo-300 font-semibold">
                      {planStepsCount ?? planSteps.length} etapas propuestas
                    </span>
                  </div>

                  {planSteps.length > 0 ? (
                    <ol className="flex flex-col divide-y divide-slate-800/60">
                      {planSteps.map((s, idx) => {
                        const id = asString(s.id);
                        const expected = asString(s.resultadoEsperado);
                        return (
                          <li key={id ?? idx} className="flex items-start gap-2.5 py-2">
                            <span className="text-slate-500 tabular-nums w-5 shrink-0">
                              {typeof s.indice === "number" ? s.indice : idx + 1}.
                            </span>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sky-300 font-medium">[{routeLabel(asString(s.servidorSugerido))}]</span>
                                {id && <span className="text-slate-500 text-[10px]">{id}</span>}
                              </div>
                              <span className="text-slate-200 font-sans">{asString(s.instruccion)}</span>
                              {expected && <span className="text-emerald-400/90 text-[11px]">Esperado: {expected}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <span className="text-[11px] text-slate-500">El plan no trae etapas.</span>
                  )}
                </div>
              )}

              {/* Qwen Final Response */}
              {iteration.stage === "FINAL_RESPONSE" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-800/60 text-slate-300">
                    <span className="text-slate-500 font-medium">Origen:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${finalOrigin === "modelo"
                        ? "bg-indigo-950/80 text-indigo-300 border-indigo-800"
                        : "bg-amber-950/80 text-amber-300 border-amber-800"
                        }`}
                    >
                      {finalOrigin ?? "N/D"}
                    </span>
                  </div>

                  {finalText ? (
                    <div className="max-h-80 overflow-y-auto font-sans">
                      <MarkdownRenderer content={finalText} />
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500">Sin respuesta sintetizada.</span>
                  )}
                </div>
              )}

              {/* Etapa sin panel propio (una etapa nueva del core): su salida en el visor JSON */}
              {!STRUCTURED_STAGES[iteration.stage] && (
                <div className="flex flex-col gap-2">
                  <JsonViewer data={iteration.output} defaultExpandDepth={2} maxHeightClass="max-h-64" />
                </div>
              )}
            </div>
          )}

          {activeTab === "input" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                  Entrada Cruda ({isEos ? `Payload { state, questions } enviado a ${MODELS.EOS_0_8B.short}` : `Payload JSON completo enviado a ${MODELS.QWEN_3_5_9B.short}`})
                </span>
                <CopyButton
                  text={getInputText}
                  label="Copiar entrada cruda"
                  title="Copiar string crudo completo de entrada"
                  iconColor="text-slate-400"
                  className="gap-1 px-2 py-0.5 text-[10px] font-mono rounded text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700"
                />
              </div>
              <JsonViewer data={iteration.rawInput || iteration.input} defaultExpandDepth={1} maxHeightClass="max-h-96" />
            </div>
          )}

          {activeTab === "output" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                  Salida Cruda ({isEos ? `Respuesta original devuelta por ${MODELS.EOS_0_8B.short}` : `Respuesta original devuelta por ${MODELS.QWEN_3_5_9B.short}`})
                </span>
                <CopyButton
                  text={getOutputText}
                  label="Copiar salida cruda"
                  title="Copiar string crudo completo de salida"
                  iconColor="text-slate-400"
                  className="gap-1 px-2 py-0.5 text-[10px] font-mono rounded text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700"
                />
              </div>
              <JsonViewer data={iteration.rawOutput || iteration.output} defaultExpandDepth={1} maxHeightClass="max-h-96" />
            </div>
          )}
        </div>
      )}
    </div>
  );
});