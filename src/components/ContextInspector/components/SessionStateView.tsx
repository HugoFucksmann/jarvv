import React, { useState } from "react";
import { Copy, Check, Target, Activity, FileText, Zap, AlertOctagon, Terminal, Database } from "lucide-react";
import type { Task, TaskMemory, Scratchpad, Step } from "../../../core/types.ts";

interface SessionStateViewProps {
  task: Task | null;
  scratchpad: Scratchpad;
  memory?: TaskMemory;
  steps: Step[];
}

export const SessionStateView: React.FC<SessionStateViewProps> = ({
  task,
  scratchpad,
  memory,
  steps,
}) => {
  const [copiedFormat, setCopiedFormat] = useState<"json" | "markdown" | null>(null);

  const facts = memory?.facts || {};
  const logLines = memory?.log || [];
  const effects = memory?.effects || [];
  const failLines = memory?.fail || [];
  const scratchpadEntries = Object.entries(scratchpad || {});

  // Extraer la última observación y herramienta de los pasos ejecutados
  const lastExecutedCall = steps
    .flatMap((s) => s.calls || [])
    .filter((c) => c.evidence || c.outcome)
    .slice(-1)[0];

  const lastObs = lastExecutedCall?.evidence?.obs || lastExecutedCall?.evidence?.summary || null;
  const lastTool = lastExecutedCall?.tool || steps.slice(-1)[0]?.tool || null;

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
        },
        scratchpad,
        memoria: {
          hechos: facts,
          efectos: effects,
          fallos: failLines,
          log: logLines,
        },
        ultimaObservacion: lastObs ? { tool: lastTool, obs: lastObs } : null,
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
      lines.push(`**Modo**: ${task?.mode || "NORMAL"} · **Estado**: ${task?.state || "IDLE"} · **Paso**: ${task ? task.currentStep + 1 : 0}/${task?.steps.length || 0}`);
      lines.push("");

      if (Object.keys(facts).length > 0) {
        lines.push(`## Hechos Extraídos (FACTS)`);
        Object.entries(facts).forEach(([k, v]) => lines.push(`- **${k}**: \`${v}\``));
        lines.push("");
      }

      if (scratchpadEntries.length > 0) {
        lines.push(`## Variables de Scratchpad`);
        scratchpadEntries.forEach(([k, v]) => lines.push(`- **${k}**: ${JSON.stringify(v)}`));
        lines.push("");
      }

      if (effects.length > 0) {
        lines.push(`## Efectos Secundarios (EFFECTS)`);
        effects.forEach((eff) => lines.push(`- ${eff}`));
        lines.push("");
      }

      if (failLines.length > 0) {
        lines.push(`## Registro de Fallos (FAIL)`);
        failLines.forEach((f) => lines.push(`- ⚠️ ${f}`));
        lines.push("");
      }

      if (lastObs) {
        lines.push(`## Último Resultado Observable (${lastTool || "MCP"})`);
        lines.push(`\`\`\`\n${lastObs}\n\`\`\``);
        lines.push("");
      }

      if (logLines.length > 0) {
        lines.push(`## Historial Continuo (LOG)`);
        logLines.slice(-30).forEach((l) => lines.push(`- \`${l}\``));
        lines.push("");
      }

      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedFormat("markdown");
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch (err) {
      console.error("Error al copiar estado en Markdown:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      {/* Barra Superior con Resumen y Botones de Copia */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2 flex-wrap text-slate-300">
          <Target className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-white">Estado Activo del Contexto Vivo</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-400">{task?.mode || "NORMAL"}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className={task?.state === "RUNNING" ? "text-sky-300 font-medium" : "text-emerald-400"}>
            {task?.state || "SIN TAREA"}
          </span>
          {task?.steps && task.steps.length > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400 tabular-nums">
                Paso {task.currentStep + 1} de {task.steps.length}
              </span>
            </>
          )}
        </div>

        {/* Botones de Copiado */}
        <div className="flex items-center gap-2">
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
                <span>Copiar Markdown</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Grid de 3 Columnas Responsivas con la Información Esencial */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* 1. Meta Activa e Instrucción */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
            <Target className="w-3.5 h-3.5 text-sky-400" />
            <span>META ACTIVA (GOAL)</span>
          </div>
          <p className="text-slate-200 text-xs font-sans leading-relaxed break-words">
            {task?.message || "No hay meta activa en ejecución."}
          </p>
          {task?.id && (
            <span className="text-[10px] text-slate-500 truncate mt-1">ID: {task.id}</span>
          )}
        </div>

        {/* 2. Hechos Extraídos (FACTS) */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>HECHOS FACTUALES (FACTS)</span>
            </div>
            <span className="text-slate-500 tabular-nums">({Object.keys(facts).length})</span>
          </div>
          {Object.keys(facts).length === 0 ? (
            <span className="text-slate-500 text-[11px] italic">Sin hechos extraídos</span>
          ) : (
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
              {Object.entries(facts).map(([key, val]) => (
                <div key={key} className="flex items-baseline gap-1.5 text-[11px] truncate">
                  <span className="text-emerald-400 shrink-0 font-medium">{key}:</span>
                  <span className="text-slate-200 truncate">{String(val)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Scratchpad Activo */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span>SCRATCHPAD OPERATIVO</span>
            </div>
            <span className="text-slate-500 tabular-nums">({scratchpadEntries.length})</span>
          </div>
          {scratchpadEntries.length === 0 ? (
            <span className="text-slate-500 text-[11px] italic">Scratchpad vacío</span>
          ) : (
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
              {scratchpadEntries.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-1.5 text-[11px] truncate">
                  <span className="text-sky-300 shrink-0">{k}:</span>
                  <span className="text-slate-300 truncate font-mono">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. Efectos Secundarios Mutados (EFFECTS) */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>EFECTOS SECUNDARIOS (EFFECTS)</span>
            </div>
            <span className="text-slate-500 tabular-nums">({effects.length})</span>
          </div>
          {effects.length === 0 ? (
            <span className="text-slate-500 text-[11px] italic">Sin efectos secundarios registrados</span>
          ) : (
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
              {effects.map((eff, i) => (
                <div key={i} className="text-[11px] text-amber-300/90 truncate">
                  • {eff}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. Registro de Fallos (FAIL) */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
            <div className="flex items-center gap-1.5">
              <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
              <span>FALLOS Y ERRORES (FAIL)</span>
            </div>
            <span className="text-slate-500 tabular-nums">({failLines.length})</span>
          </div>
          {failLines.length === 0 ? (
            <span className="text-emerald-400/80 text-[11px]">Sin fallos registrados (Limpio)</span>
          ) : (
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
              {failLines.map((fl, i) => (
                <div key={i} className="text-[11px] text-rose-400 truncate">
                  • {fl}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 6. Último Resultado Observable (Last Result / Obs) */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>ÚLTIMA OBSERVACIÓN ({lastTool || "MCP"})</span>
            </div>
          </div>
          {lastObs ? (
            <pre className="text-slate-300 text-[11px] whitespace-pre-wrap break-all max-h-28 overflow-y-auto leading-tight">
              {lastObs.slice(0, 300)}
            </pre>
          ) : (
            <span className="text-slate-500 text-[11px] italic">Ninguna observación registrada aún</span>
          )}
        </div>
      </div>

      {/* 7. Historial Continuo (LOG) — Hasta 30 entradas con badge de estado */}
      {logLines.length > 0 && (
        <div className="flex flex-col gap-1 p-2.5 rounded bg-slate-900/40 border border-slate-800/80 mt-1">
          <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px] pb-1 border-b border-slate-800/60">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>HISTORIAL CONTINUO (LOG)</span>
            </div>
            <span className="text-slate-500 tabular-nums">
              Mostrando {Math.min(logLines.length, 30)} de {logLines.length} líneas
            </span>
          </div>

          <div className="flex flex-col divide-y divide-slate-800/50 max-h-40 overflow-y-auto text-[11px]">
            {logLines.slice(-30).map((line, idx) => {
              const parts = line.split("|");
              const seq = parts[0] || String(idx + 1);
              const tool = parts[1] || "";
              const status = parts[2] || "ok";
              const finding = parts.slice(3).join("|") || line;

              const statusColor =
                status === "ok"
                  ? "text-emerald-400"
                  : status === "err"
                  ? "text-rose-400 font-semibold"
                  : status === "nf"
                  ? "text-amber-400"
                  : "text-slate-400";

              return (
                <div key={idx} className="flex items-start gap-2 py-1 px-1 hover:bg-slate-900/60 rounded">
                  <span className="text-slate-500 shrink-0 tabular-nums w-5">#{seq}</span>
                  <span className="text-sky-300 font-medium shrink-0">{tool}</span>
                  <span className={`${statusColor} shrink-0`}>[{status}]</span>
                  <span className="text-slate-300 truncate flex-1">{finding}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
