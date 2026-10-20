import React, { useState } from "react";
import { Copy, Check, Target, Terminal, Database, HelpCircle, CheckCircle2, RotateCcw, AlertTriangle, ArrowRight } from "lucide-react";
import type { Task, TaskMemory, Scratchpad, Step } from "../../../core/types.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";

interface SessionStateViewProps {
  task: Task | null;
  scratchpad: Scratchpad;
  memory?: TaskMemory;
  steps: Step[];
}

function formatRouteLabel(route?: string): string {
  if (!route) return "Sin ruta";
  if (route === "fin") return "Finalización";
  if (route === "global") return "Global";
  if (
    route === "files" ||
    route === "locate" ||
    route === "terminal" ||
    route === "web"
  ) {
    return getRouteLabel(route);
  }
  return String(route);
}

export const SessionStateView: React.FC<SessionStateViewProps> = ({
  task,
  scratchpad,
  memory,
  steps,
}) => {
  const [copiedFormat, setCopiedFormat] = useState<"json" | "markdown" | "final" | "obs" | null>(null);

  const facts = memory?.facts || {};
  const logLines = memory?.log || [];
  const effects = memory?.effects || [];
  const failLines = memory?.fail || [];
  const scratchpadEntries = Object.entries(scratchpad || {});

  const currentStep = task && task.steps && task.steps[task.currentStep] ? task.steps[task.currentStep] : null;

  // Extraer la última observación y herramienta de los pasos ejecutados
  const lastExecutedCall = steps
    .flatMap((s) => s.calls || [])
    .filter((c) => c.evidence || c.outcome)
    .slice(-1)[0];

  const lastObs = lastExecutedCall?.evidence?.obs || lastExecutedCall?.evidence?.summary || null;
  const lastTool = lastExecutedCall?.tool || steps.slice(-1)[0]?.tool || null;
  const lastRef = lastExecutedCall?.evidence?.ref;

  const handleCopyJSON = async () => {
    try {
      const payload = {
        taskId: task?.id || "N/A",
        meta: {
          instruccion: task?.message || "Sin instrucción activa",
          modo: task?.mode || "NORMAL",
          estado: task?.state || "IDLE",
          pasoActual: task ? `${task.currentStep + 1} de ${task.steps.length}` : "N/A",
          replans: task?.replans ?? 0,
          escalations: task?.escalations ?? 0,
        },
        pasoActivo: currentStep
          ? {
              id: currentStep.id,
              instruction: currentStep.instruction,
              route: currentStep.route,
              expectedOutcome: currentStep.expectedOutcome,
              state: currentStep.state,
            }
          : null,
        pendingQuestion: task?.pendingQuestion || null,
        finalResponse: task?.finalResponse || null,
        scratchpad,
        resumenMetrico: {
          hechos: Object.keys(facts).length,
          efectos: effects.length,
          fallos: failLines.length,
          logTotal: logLines.length,
        },
        ultimaObservacion: lastObs ? { tool: lastTool, obs: lastObs, ref: lastRef } : null,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedFormat("json");
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch (err) {
      console.error("Error al copiar estado en JSON:", err);
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      const lines: string[] = [];
      lines.push(`# JARVIS Context Snapshot — Tarea: ${task?.id || "N/A"}`);
      lines.push(`**Instrucción / Meta**: ${task?.message || "N/A"}`);
      lines.push(
        `**Modo**: ${task?.mode || "NORMAL"} · **Estado**: ${task?.state || "IDLE"} · **Paso**: ${
          task ? task.currentStep + 1 : 0
        }/${task?.steps.length || 0} · **Replans**: ${task?.replans ?? 0}`
      );
      lines.push("");

      if (currentStep) {
        lines.push(`## Paso Activo (${currentStep.id})`);
        lines.push(`- **Instrucción**: ${currentStep.instruction}`);
        lines.push(`- **Ruta**: ${formatRouteLabel(currentStep.route)}`);
        if (currentStep.expectedOutcome) {
          lines.push(`- **Criterio de éxito**: ${currentStep.expectedOutcome}`);
        }
        lines.push("");
      }

      if (task?.pendingQuestion) {
        lines.push(`## Pregunta Pendiente al Usuario`);
        lines.push(`- **Pregunta**: ${task.pendingQuestion.question}`);
        lines.push(`- **Motivo**: ${task.pendingQuestion.reason}`);
        lines.push("");
      }

      if (task?.finalResponse) {
        lines.push(`## Respuesta Final Sintetizada`);
        lines.push(task.finalResponse);
        lines.push("");
      }

      lines.push(`## Resumen de Contexto Vivo`);
      lines.push(`- Hechos (FACTS): ${Object.keys(facts).length}`);
      lines.push(`- Variables Scratchpad: ${scratchpadEntries.length}`);
      lines.push(`- Efectos Secundarios: ${effects.length}`);
      lines.push(`- Fallos Registrados: ${failLines.length}`);
      lines.push("");

      if (lastObs) {
        lines.push(`## Último Resultado Observable (${lastTool || "MCP"})`);
        lines.push(`\`\`\`\n${lastObs}\n\`\`\``);
        lines.push("");
      }

      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedFormat("markdown");
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch (err) {
      console.error("Error al copiar estado en Markdown:", err);
    }
  };

  const handleCopyText = async (type: "final" | "obs", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedFormat(type);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      {/* 1. Header Bar: Status & Copy Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2 flex-wrap text-slate-300">
          <Target className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="font-semibold text-white">Ficha Ejecutiva</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-400 font-medium">{task?.mode || "NORMAL"}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span
            className={
              task?.state === "RUNNING"
                ? "text-sky-300 font-semibold"
                : task?.state === "WAITING_INPUT"
                ? "text-amber-400 font-semibold"
                : task?.state === "FAILED"
                ? "text-rose-400 font-semibold"
                : "text-emerald-400 font-semibold"
            }
          >
            {task?.state || "SIN TAREA"}
          </span>
          {task?.steps && task.steps.length > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-300 tabular-nums font-semibold">
                Paso {task.currentStep + 1} de {task.steps.length}
              </span>
            </>
          )}
          {typeof task?.replans === "number" && task.replans > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] flex items-center gap-1">
              <RotateCcw className="w-3 h-3" />
              Replans: {task.replans}
            </span>
          )}
        </div>

        {/* Copy actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyJSON}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded transition-colors cursor-pointer"
          >
            {copiedFormat === "json" ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-medium">JSON Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-slate-400" />
                <span>Copiar JSON</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded transition-colors cursor-pointer"
          >
            {copiedFormat === "markdown" ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-medium">MD Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-slate-400" />
                <span>Copiar MD</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Goal / Prompt Card */}
      <div className="p-3 rounded border border-slate-800/80 bg-slate-900/40 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold font-mono">
          <div className="flex items-center gap-1.5 text-sky-400">
            <Target className="w-3.5 h-3.5" />
            <span>OBJETIVO DE LA TAREA (GOAL)</span>
          </div>
          {task?.id && <span className="text-slate-500 font-normal">ID: {task.id}</span>}
        </div>
        <p className="text-slate-100 text-xs font-sans leading-relaxed break-words font-medium">
          {task?.message || "No hay tarea activa en ejecución."}
        </p>
      </div>

      {/* 3. Pending Question Alert (if WAITING_INPUT) */}
      {task?.pendingQuestion && (
        <div className="p-3 rounded border border-amber-500/40 bg-amber-950/20 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
            <HelpCircle className="w-4 h-4 shrink-0" />
            <span>PREGUNTA PENDIENTE AL USUARIO</span>
            <span className="text-[10px] font-mono font-normal text-amber-500/80">
              (Paso: {task.pendingQuestion.stepId})
            </span>
          </div>
          <div className="text-amber-100 font-sans text-xs leading-relaxed font-medium pl-6">
            {task.pendingQuestion.question}
          </div>
          {task.pendingQuestion.reason && (
            <div className="text-amber-300/80 text-[11px] font-mono pl-6 border-t border-amber-500/20 pt-1.5">
              <span className="text-amber-400/90 font-medium">Motivo: </span>
              {task.pendingQuestion.reason}
            </div>
          )}
        </div>
      )}

      {/* 4. Synthesized Final Response (if present) */}
      {task?.finalResponse && (
        <div className="p-3 rounded border border-emerald-500/40 bg-emerald-950/20 flex flex-col gap-2">
          <div className="flex items-center justify-between text-emerald-400 font-semibold text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>RESPUESTA FINAL SINTETIZADA</span>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText("final", task.finalResponse!)}
              className="text-[10px] font-mono text-emerald-400/80 hover:text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-900/40 flex items-center gap-1 cursor-pointer"
            >
              {copiedFormat === "final" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedFormat === "final" ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <div className="text-slate-100 font-sans text-xs leading-relaxed whitespace-pre-wrap pl-6">
            {task.finalResponse}
          </div>
        </div>
      )}

      {/* 5. Active Step Details */}
      {currentStep && (
        <div className="p-3 rounded border border-slate-800/80 bg-slate-900/40 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-[11px] pb-1 border-b border-slate-800/60">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold font-mono">
              <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
              <span>PASO ACTIVO: {currentStep.id}</span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                currentStep.state === "RUNNING"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                  : currentStep.state === "FAILED"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : currentStep.state === "COMPLETED"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {currentStep.state}
            </span>
          </div>

          <div className="text-slate-200 text-xs font-sans leading-relaxed">
            <span className="font-mono text-slate-400 text-[11px] font-medium mr-1.5">Instrucción:</span>
            {currentStep.instruction}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-[11px] font-mono text-slate-400">
            <div>
              <span className="text-slate-500">Ruta: </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                {formatRouteLabel(currentStep.route)}
              </span>
            </div>
            {(currentStep.mcp || currentStep.tool) && (
              <div>
                <span className="text-slate-500">Herramienta: </span>
                <span className="text-sky-300">
                  {currentStep.mcp ? `${currentStep.mcp}:${currentStep.tool || ""}` : currentStep.tool}
                </span>
              </div>
            )}
          </div>

          {currentStep.expectedOutcome && (
            <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60 text-[11px]">
              <span className="font-mono text-emerald-400/90 font-medium">Criterio de éxito: </span>
              <span className="font-sans text-slate-300">{currentStep.expectedOutcome}</span>
            </div>
          )}
        </div>
      )}

      {/* 6. Context Metrics Ledger (Executive snapshot without duplicated full lists) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-2.5 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col">
          <span className="text-slate-400 text-[10px] font-mono">Hechos Factuales</span>
          <span className="text-emerald-400 font-semibold text-base tabular-nums mt-0.5">
            {Object.keys(facts).length}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 font-sans">En pestaña Memoria</span>
        </div>

        <div className="p-2.5 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col">
          <span className="text-slate-400 text-[10px] font-mono">Scratchpad</span>
          <span className="text-sky-300 font-semibold text-base tabular-nums mt-0.5">
            {scratchpadEntries.length} var{scratchpadEntries.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 font-sans">En pestaña Scratchpad</span>
        </div>

        <div className="p-2.5 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col">
          <span className="text-slate-400 text-[10px] font-mono">Efectos Mutados</span>
          <span className="text-amber-400 font-semibold text-base tabular-nums mt-0.5">
            {effects.length}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 font-sans">En pestaña Memoria</span>
        </div>

        <div className="p-2.5 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col">
          <span className="text-slate-400 text-[10px] font-mono">Fallos Registrados</span>
          <span
            className={`font-semibold text-base tabular-nums mt-0.5 ${
              failLines.length > 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {failLines.length}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 font-sans">
            {failLines.length === 0 ? "Sin errores" : "En pestaña Memoria"}
          </span>
        </div>
      </div>

      {/* 7. Last Observable Output (Without arbitrary slice(0, 400)) */}
      <div className="p-3 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] pb-1 border-b border-slate-800/60 font-mono">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>ÚLTIMA OBSERVACIÓN ({lastTool || "MCP"})</span>
          </div>
          {lastObs && (
            <div className="flex items-center gap-2">
              {lastRef && (
                <span className="text-[10px] text-slate-400 font-mono">
                  Ref: <span className="text-cyan-400">ref:{lastRef.replace(/^ref:/, "")}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => handleCopyText("obs", lastObs)}
                className="text-[10px] font-mono text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              >
                {copiedFormat === "obs" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedFormat === "obs" ? "Copiado!" : "Copiar"}
              </button>
            </div>
          )}
        </div>

        {lastObs ? (
          <pre className="text-slate-200 text-xs whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed font-mono p-2 bg-slate-950/80 rounded border border-slate-800 selection:bg-cyan-950">
            {lastObs}
          </pre>
        ) : (
          <div className="text-slate-500 text-xs italic py-1">Ninguna observación registrada aún.</div>
        )}
      </div>
    </div>
  );
};
