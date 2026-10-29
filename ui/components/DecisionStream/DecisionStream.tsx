import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Cpu, Layers, Activity } from "lucide-react";
import type { CoreEvent, CoreEventType, Task } from "../../../src/core/types.ts";
import type { ModelIteration } from "../../types/debug.ts";
import { groupIterationsByStep } from "../../utils/debugAccumulator.ts";
import { StepIterationGroup } from "./components/StepIterationGroup.tsx";
import { Separator } from "../Shared/Separator.tsx";
import { MODELS } from "../../../src/core/models.ts";

interface DecisionStreamProps {
  events: CoreEvent[];
  modelIterations?: ModelIteration[];
  isExecuting?: boolean;
  task?: Task | null;
}

/** Eventos que se muestran en la traza operativa. */
const TRACE_EVENT_TYPES = new Set<CoreEventType>([
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
  "PLAN_GENERATED",
  "PLAN_MODIFIED",
  "PLAN_REJECTED",
  "FINAL_RESPONSE",
]);

function getEventColorClass(type: CoreEventType): string {
  if (type.startsWith("DECISION")) return "text-sky-300";
  if (type.startsWith("GUARD") || type.startsWith("APPROVAL")) return "text-amber-300";
  if (type.startsWith("MCP")) return "text-emerald-300";
  return "text-slate-300";
}

const formatConf = (v: unknown): string =>
  typeof v === "number" && !Number.isNaN(v) ? `${(v * 100).toFixed(0)}%` : "N/D";

/**
 * Resumen de una línea para cada tipo de evento de la traza.
 * `ev` es una unión discriminada: cada `case` estrecha `ev.data` al tipo que el core declara en `CoreEventDataMap`.
 */
function summarizeEvent(ev: CoreEvent): string {
  switch (ev.type) {
    case "ARGUMENTS_GENERATED": {
      const d = ev.data;
      return "error" in d ? `error: ${d.error}` : `args: ${JSON.stringify(d.args)}`;
    }
    case "GUARD_EVALUATION":
      return `decisión: ${ev.data.guardDecision.decision}`;
    case "APPROVAL_REQUESTED":
      return `${ev.data.pendingApproval.mcp}:${ev.data.pendingApproval.tool}`;
    case "APPROVAL_RESOLVED":
      return `${ev.data.approved ? "aprobada" : "denegada"}${ev.data.reason ? ` (${ev.data.reason})` : ""}`;
    case "MCP_DISPATCHED":
      return `${ev.data.mcp}:${ev.data.tool}`;
    case "DECISION_ONE":
      return `ruta: ${ev.data.route} (conf: ${formatConf(ev.data.probabilities?.[ev.data.route])})`;
    case "DECISION_TWO":
      return `tool: ${ev.data.tool} (conf: ${formatConf(ev.data.probabilities?.[ev.data.tool])})`;
    case "RESULT_PROCESSED": {
      const d = ev.data;
      return `estado=${d.callStatus} verificación=${d.verificationState} | ${(d.processed.finding || "procesado").slice(0, 80)}`;
    }
    case "STAGE_VERIFIED":
      return `etapa ${ev.data.stepId}: ${ev.data.stageVerification.status}`;
    case "PLAN_GENERATED":
      return `Plan generado (${ev.data.steps.length} etapas)`;
    case "PLAN_MODIFIED":
      return `Plan modificado: ${ev.data.feedback}`;
    case "PLAN_REJECTED":
      return `Plan rechazado: ${ev.data.reason}`;
    case "FINAL_RESPONSE":
      return "Respuesta sintetizada";
    case "STEP_STATE_CHANGED":
      return `paso ${ev.stepId || ev.data.step.id}: estado -> ${ev.data.state}`;
    case "STEP_COMPLETED":
      return `paso ${ev.stepId || ev.data.step.id}: concluido (${ev.data.step.state})${ev.data.error ? ` [error: ${ev.data.error}]` : ""}`;
    default:
      return JSON.stringify(ev.data);
  }
}

export const DecisionStream: React.FC<DecisionStreamProps> = ({
  events,
  modelIterations = [],
  isExecuting = false,
  task = null,
}) => {
  const [showFullTrace, setShowFullTrace] = useState(false);
  const [expandAllGroups, setExpandAllGroups] = useState(false);

  // Agrupamiento estructurado por paso de ejecución
  const stepGroups = useMemo(
    () => groupIterationsByStep(modelIterations, task),
    [modelIterations, task],
  );

  // Sin eventos ni iteraciones no hay nada que mostrar
  if (events.length === 0 && modelIterations.length === 0) return null;

  const totalEos = modelIterations.filter((m) => m.model === "EOS_0_8B" && m.invoked === true).length;
  const totalQwen = modelIterations.filter((m) => m.model === "QWEN_3_5_9B" && m.invoked === true).length;
  const traceEvents = events.filter((e) => TRACE_EVENT_TYPES.has(e.type));

  return (
    <div className="flex flex-col gap-3 px-6 py-2">
      {/* 1. Cabecera de observabilidad con controles globales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 flex-wrap text-slate-300 font-mono text-xs">
          <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="font-semibold text-slate-200">Historial de Iteraciones de Modelos</span>
          <Separator />
          <span className="text-slate-400 tabular-nums">
            {modelIterations.length} iteraciones registradas
          </span>
          {totalEos > 0 && (
            <>
              <Separator />
              <span className="text-sky-300 tabular-nums">{totalEos} {MODELS.EOS_0_8B.name}</span>
            </>
          )}
          {totalQwen > 0 && (
            <>
              <Separator />
              <span className="text-indigo-300 tabular-nums">{totalQwen} {MODELS.QWEN_3_5_9B.name}</span>
            </>
          )}
        </div>

        {stepGroups.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setExpandAllGroups((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 rounded transition-colors cursor-pointer"
            >
              <Layers className="w-3 h-3" />
              <span>{expandAllGroups ? "Colapsar todos" : "Expandir todos"}</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. Iteraciones agrupadas por paso */}
      {stepGroups.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {stepGroups.map((group) => (
            <StepIterationGroup
              key={group.stepId}
              group={group}
              isInitiallyExpanded={expandAllGroups}
            />
          ))}
        </div>
      ) : isExecuting ? (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/30 text-xs text-slate-400 font-mono">
          <Cpu className="w-3.5 h-3.5 text-sky-400 animate-pulse shrink-0" />
          <span>Esperando iteraciones de inferencia de modelos...</span>
        </div>
      ) : null}

      {/* 3. Traza de eventos operativos (colapsable) */}
      {traceEvents.length > 0 && (
        <div className="flex flex-col border border-slate-800/80 rounded-lg bg-slate-900/30 overflow-hidden text-xs mt-1">
          <button
            type="button"
            onClick={() => setShowFullTrace((v) => !v)}
            aria-expanded={showFullTrace}
            className="flex items-center justify-between px-3.5 py-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer bg-slate-950/40"
          >
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-medium text-slate-300">Traza de Eventos Operativos en Vivo</span>
              <span className="text-slate-500">({traceEvents.length} eventos registrados)</span>
            </div>
            {showFullTrace ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showFullTrace && (
            <div className="flex flex-col divide-y divide-slate-800/50 max-h-52 overflow-y-auto font-mono text-[11px] p-1 bg-slate-950/30">
              {[...traceEvents].reverse().map((ev, idx) => (
                <div
                  key={`trace-${ev.taskId}-${ev.timestamp}-${idx}`}
                  className="flex items-start gap-2.5 py-1.5 px-2 hover:bg-slate-900/50 rounded"
                >
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {new Date(ev.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className={`font-semibold shrink-0 ${getEventColorClass(ev.type)}`}>
                    [{ev.type}]
                  </span>
                  <span className="text-slate-400 truncate flex-1">{summarizeEvent(ev)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};