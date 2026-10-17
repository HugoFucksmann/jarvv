import React, { useState, useMemo } from "react";
import type { CoreEvent, Task } from "../../core/types.ts";
import type { ModelIteration } from "../../types/debug.ts";
import { groupIterationsByStep } from "../../utils/debugAccumulator.ts";
import { StepIterationGroup } from "./components/StepIterationGroup.tsx";
import { ChevronDown, ChevronRight, Cpu, Copy, Check, Layers, Activity } from "lucide-react";

interface DecisionStreamProps {
  events: CoreEvent[];
  modelIterations?: ModelIteration[];
  isExecuting?: boolean;
  task?: Task | null;
}

export const DecisionStream: React.FC<DecisionStreamProps> = ({
  events,
  modelIterations = [],
  isExecuting = false,
  task = null,
}) => {
  const [showFullTrace, setShowFullTrace] = useState(false);
  const [expandAllGroups, setExpandAllGroups] = useState<boolean | null>(false);
  const [copiedAudit, setCopiedAudit] = useState(false);

  // Agrupamiento estructurado por paso de ejecución
  const stepGroups = useMemo(() => {
    return groupIterationsByStep(modelIterations, task);
  }, [modelIterations, task]);

  // Si no hay eventos ni iteraciones, no renderizar nada
  if (events.length === 0 && modelIterations.length === 0) return null;

  const totalEos = modelIterations.filter((m) => m.model === "EOS_0_8B").length;
  const totalQwen = modelIterations.filter((m) => m.model === "QWEN_3_5_9B").length;

  const relevantTraceEvents = events.filter((e) =>
    [
      "DECISION_ONE",
      "DECISION_TWO",
      "ARGUMENTS_GENERATED",
      "GUARD_EVALUATION",
      "APPROVAL_REQUESTED",
      "APPROVAL_RESOLVED",
      "MCP_DISPATCHED",
      "MCP_RESULT",
      "RESULT_PROCESSED",
      "STEP_STATE_CHANGED",
      "STEP_COMPLETED",
      "STAGE_VERIFIED",
      "FINAL_RESPONSE",
    ].includes(e.type)
  );

  const handleCopyFullAudit = async () => {
    try {
      const payload = {
        taskId: task?.id || "current",
        exportedAt: new Date().toISOString(),
        totalIterations: modelIterations.length,
        modelsSummary: {
          eos_0_8b: totalEos,
          qwen_3_5_9b: totalQwen,
        },
        iterations: modelIterations,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedAudit(true);
      setTimeout(() => setCopiedAudit(false), 2000);
    } catch (err) {
      console.error("Error al exportar auditoría de modelos:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-2">
      {/* 1. Header de Observabilidad de Modelos con Controles Globales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 flex-wrap text-slate-300 font-mono text-xs">
          <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="font-semibold text-slate-200">
            Historial de Iteraciones de Modelos
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-400 tabular-nums">
            {modelIterations.length} iteraciones registradas
          </span>
          {totalEos > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-sky-300 tabular-nums">{totalEos} Eos-0.8B</span>
            </>
          )}
          {totalQwen > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-indigo-300 tabular-nums">{totalQwen} Qwen 3.5 9B</span>
            </>
          )}
        </div>

        {/* Acciones Globales */}
        <div className="flex items-center gap-2">
          {stepGroups.length > 0 && (
            <button
              type="button"
              onClick={() => setExpandAllGroups((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 rounded transition-colors cursor-pointer"
            >
              <Layers className="w-3 h-3" />
              <span>{expandAllGroups ? "Colapsar todos" : "Expandir todos"}</span>
            </button>
          )}

          {modelIterations.length > 0 && (
            <button
              type="button"
              onClick={handleCopyFullAudit}
              title="Copiar auditoría completa de modelos en formato JSON"
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded transition-colors cursor-pointer"
            >
              {copiedAudit ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Auditoría Copiada</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>Copiar Auditoría</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 2. Lista de Grupos de Iteraciones Agrupados por Paso */}
      {stepGroups.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {stepGroups.map((group) => (
            <StepIterationGroup
              key={`group-${group.stepId}-${group.stepSeq || 0}`}
              group={group}
              isInitiallyExpanded={Boolean(expandAllGroups)}
            />
          ))}
        </div>
      ) : isExecuting ? (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/30 text-xs text-slate-400 font-mono">
          <Cpu className="w-3.5 h-3.5 text-sky-400 animate-pulse shrink-0" />
          <span>Esperando iteraciones de inferencia de modelos...</span>
        </div>
      ) : null}

      {/* 3. Traza de Eventos Operativos en Vivo (Colapsable con recuento exacto) */}
      {relevantTraceEvents.length > 0 && (
        <div className="flex flex-col border border-slate-800/80 rounded-lg bg-slate-900/30 overflow-hidden text-xs mt-1">
          <button
            type="button"
            onClick={() => setShowFullTrace(!showFullTrace)}
            className="flex items-center justify-between px-3.5 py-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer bg-slate-950/40"
          >
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-medium text-slate-300">Traza de Eventos Operativos en Vivo</span>
              <span className="text-slate-500">({relevantTraceEvents.length} eventos registrados)</span>
            </div>
            {showFullTrace ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showFullTrace && (
            <div className="flex flex-col divide-y divide-slate-800/50 max-h-52 overflow-y-auto font-mono text-[11px] p-1 bg-slate-950/30">
              {[...relevantTraceEvents].reverse().map((ev, idx) => (
                <div key={`trace-${ev.taskId}-${ev.timestamp}-${idx}`} className="flex items-start gap-2.5 py-1.5 px-2 hover:bg-slate-900/50 rounded">
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span
                    className={`font-semibold shrink-0 ${
                      ev.type.startsWith("DECISION")
                        ? "text-sky-300"
                        : ev.type.startsWith("GUARD") || ev.type.startsWith("APPROVAL")
                        ? "text-amber-300"
                        : ev.type.startsWith("MCP")
                        ? "text-emerald-300"
                        : "text-slate-300"
                    }`}
                  >
                    [{ev.type}]
                  </span>
                  <span className="text-slate-400 truncate flex-1">
                    {ev.type === "ARGUMENTS_GENERATED"
                      ? `args: ${JSON.stringify(ev.data?.args || {})}`
                      : ev.type === "GUARD_EVALUATION"
                      ? `decisión: ${(ev.data?.guardDecision as any)?.decision || "ALLOW"}`
                      : ev.type === "MCP_DISPATCHED"
                      ? `${ev.data?.mcp}:${ev.data?.tool}`
                      : ev.type === "DECISION_ONE"
                      ? `ruta: ${ev.data?.route} (conf: ${((Number(ev.data?.confidence) || 0) * 100).toFixed(0)}%)`
                      : ev.type === "DECISION_TWO"
                      ? `tool: ${ev.data?.tool} (conf: ${((Number(ev.data?.confidence) || 0) * 100).toFixed(0)}%)`
                      : ev.type === "RESULT_PROCESSED"
                      ? `ok=${(ev.data as any)?.verification?.ok ?? (ev.data as any)?.isStepSuccess} cumple=${(ev.data as any)?.verification?.cumple ?? (ev.data as any)?.isStepSuccess} | ${((ev.data as any)?.processed?.finding || "procesado").slice(0, 80)}`
                      : ev.type === "STAGE_VERIFIED"
                      ? `etapa ${(ev.data as any)?.stageId || ""}: ${(ev.data as any)?.situation || "verificada"} (conf=${(((ev.data as any)?.confidence || 0) * 100).toFixed(0)}%)`
                      : ev.type === "PLAN_GENERATED"
                      ? `Plan generado (${((ev.data as any)?.steps || []).length} etapas)`
                      : ev.type === "PLAN_MODIFIED"
                      ? `Plan modificado: ${(ev.data as any)?.feedback || "ajuste solicitado"}`
                      : ev.type === "PLAN_REJECTED"
                      ? `Plan rechazado: ${(ev.data as any)?.reason || "cancelado por usuario"}`
                      : ev.type === "FINAL_RESPONSE"
                      ? "Respuesta sintetizada"
                      : ev.type === "STEP_STATE_CHANGED"
                      ? `paso ${ev.stepId || ""}: estado -> ${(ev.data as any)?.state || (ev.data as any)?.step?.state}`
                      : ev.type === "STEP_COMPLETED"
                      ? `paso ${ev.stepId || ""}: concluido (${(ev.data as any)?.step?.state || "COMPLETED"})${(ev.data as any)?.error ? ` [error: ${(ev.data as any).error}]` : ""}`
                      : JSON.stringify(ev.data || {})}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
