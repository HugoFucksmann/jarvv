import React, { useState } from "react";
import type { Step, ExecutableRoute } from "../../../core/types.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import { Terminal, Copy, Check, ChevronDown, ChevronRight, ExternalLink, Filter } from "lucide-react";

interface EvidenceViewProps {
  steps: Step[];
  onInspectRef?: (refKey: string) => void;
}

interface EvidenceItem {
  id: string;
  stepIndex: number;
  stepId: string;
  stepRoute?: string;
  mcpServer?: string;
  toolName?: string;
  ok: boolean;
  summary: string;
  expectedOutcome?: string;
  obs?: string;
  ref?: string;
  args?: Record<string, unknown>;
  flags?: string[];
  callId?: string;
  verification?: string;
}

function formatRouteLabel(route: string | undefined): string {
  if (!route) return "Sin destino";
  if (route === "fin") return "Finalización";
  if (route === "global") return "Global";
  if (route === "files" || route === "search_local" || route === "terminal" || route === "web") {
    return getRouteLabel(route as ExecutableRoute);
  }
  return route;
}

export const EvidenceView: React.FC<EvidenceViewProps> = ({ steps, onInspectRef }) => {
  const [filter, setFilter] = useState<"all" | "errors" | "ok">("all");
  const [expandedObs, setExpandedObs] = useState<Record<string, boolean>>({});
  const [expandedArgs, setExpandedArgs] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const toggleObs = (key: string) => {
    setExpandedObs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleArgs = (key: string) => {
    setExpandedArgs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error("Error al copiar texto:", err);
    }
  };

  const normalizeRefKey = (k: string): string => k.replace(/^ref:/, "").trim();

  const items: EvidenceItem[] = [];

  steps.forEach((step, sIdx) => {
    if (step.calls && step.calls.length > 0) {
      step.calls.forEach((call, cIdx) => {
        if (call.evidence || call.error || call.outcome) {
          items.push({
            id: `ev-${step.id || sIdx}-${call.id || cIdx}`,
            stepIndex: sIdx + 1,
            stepId: step.id,
            stepRoute: step.route,
            mcpServer: call.mcp,
            toolName: call.tool,
            ok: Boolean((call.evidence?.ok ?? call.outcome?.success) && !call.error),
            summary:
              call.evidence?.summary ||
              call.error ||
              (call.outcome?.success ? "Llamada ejecutada con éxito" : "Llamada completada"),
            expectedOutcome: step.expectedOutcome,
            obs: call.evidence?.obs,
            ref: call.evidence?.ref,
            args: call.args,
            flags: call.evidence?.flags,
            callId: call.id,
            verification: call.verification,
          });
        }
      });
    } else if (step.evidence || step.error) {
      items.push({
        id: `ev-${step.id || sIdx}-root`,
        stepIndex: sIdx + 1,
        stepId: step.id,
        stepRoute: step.route,
        mcpServer: step.mcp,
        toolName: step.tool,
        ok: Boolean(step.evidence?.ok && !step.error),
        summary: step.evidence?.summary || step.error || "Paso ejecutado",
        expectedOutcome: step.expectedOutcome,
        obs: step.evidence?.obs,
        ref: step.evidence?.ref,
        args: step.args,
        flags: step.evidence?.flags,
        verification: step.verification,
      });
    }
  });

  const totalErrors = items.filter((it) => !it.ok).length;
  const totalOk = items.filter((it) => it.ok).length;

  const filteredItems = items.filter((it) => {
    if (filter === "errors") return !it.ok;
    if (filter === "ok") return it.ok;
    return true;
  });

  if (items.length === 0) {
    return (
      <div className="py-6 text-center text-xs font-mono text-slate-500">
        Sin evidencias registradas aún en esta tarea.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      {/* Barra de Filtro y Métricas */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-semibold uppercase tracking-wider">Filtro de Evidencias:</span>
          <div className="flex items-center gap-1 ml-1" role="group" aria-label="Filtrar evidencias por resultado">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                filter === "all" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Todas ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("errors")}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                filter === "errors" ? "bg-rose-950/70 text-rose-300 font-medium border border-rose-900/60" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Errores ({totalErrors})
            </button>
            <button
              type="button"
              onClick={() => setFilter("ok")}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                filter === "ok" ? "bg-emerald-950/70 text-emerald-300 font-medium border border-emerald-900/60" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              OK ({totalOk})
            </button>
          </div>
        </div>
      </div>

      {/* Lista de Evidencias */}
      <div className="flex flex-col divide-y divide-slate-800/50">
        {filteredItems.map((item) => {
          const isObsExpanded = expandedObs[item.id] ?? false;
          const isArgsExpanded = expandedArgs[item.id] ?? false;
          const hasObs = Boolean(item.obs && item.obs.trim());
          const hasArgs = Boolean(item.args && Object.keys(item.args).length > 0);
          const cleanRef = item.ref ? normalizeRefKey(item.ref) : null;

          return (
            <div key={item.id} className="py-2.5 flex flex-col gap-1.5 hover:bg-slate-900/20 px-1 rounded transition-colors">
              {/* Cabecera de la Evidencia */}
              <div className="flex items-center justify-between text-slate-400 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-500 font-medium tabular-nums">
                    Paso #{item.stepIndex} ({item.stepId})
                  </span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-sky-300 font-medium px-1.5 py-0.2 rounded bg-sky-950/60 border border-sky-900/50 text-[10px]">
                    {formatRouteLabel(item.stepRoute)}
                  </span>
                  {(item.mcpServer || item.toolName) && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-200 font-medium flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-slate-400" />
                        {item.mcpServer ? `${item.mcpServer}:${item.toolName || ""}` : item.toolName}
                      </span>
                    </>
                  )}
                  {cleanRef && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-indigo-300 text-[10px] bg-indigo-950/60 px-1 rounded border border-indigo-900/50">
                        ref:{cleanRef}
                      </span>
                    </>
                  )}
                  {item.verification && (
                    <span className={`text-[10px] px-1 rounded border ${
                      item.verification === "VERIFIED"
                        ? "text-emerald-400 border-emerald-900/50 bg-emerald-950/40"
                        : "text-amber-400 border-amber-900/50 bg-amber-950/40"
                    }`}>
                      [{item.verification}]
                    </span>
                  )}
                </div>

                <span className={`font-semibold text-[11px] px-1.5 py-0.2 rounded border ${
                  item.ok
                    ? "text-emerald-400 border-emerald-900/50 bg-emerald-950/40"
                    : "text-rose-400 border-rose-900/50 bg-rose-950/40"
                }`}>
                  {item.ok ? "OK" : "ERROR"}
                </span>
              </div>

              {/* Criterio Esperado (si está disponible) */}
              {item.expectedOutcome && (
                <div className="text-[11px] text-slate-400 font-sans flex items-baseline gap-1.5">
                  <span className="text-slate-500 font-mono text-[10px] uppercase shrink-0">Esperado:</span>
                  <span className="italic">{item.expectedOutcome}</span>
                </div>
              )}

              {/* Veredicto Observable / Resumen */}
              <p className="text-slate-200 font-sans text-xs leading-relaxed">
                {item.summary}
              </p>

              {/* Argumentos Ejecutados (colapsable/copiable) */}
              {hasArgs && (
                <div className="flex flex-col gap-1 mt-0.5">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => toggleArgs(item.id)}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      {isArgsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>Parámetros ejecutados (args)</span>
                    </button>
                    {isArgsExpanded && (
                      <button
                        type="button"
                        onClick={() => handleCopyText(`args-${item.id}`, JSON.stringify(item.args, null, 2))}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
                      >
                        {copiedKey === `args-${item.id}` ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                        <span>{copiedKey === `args-${item.id}` ? "Copiado" : "Copiar args"}</span>
                      </button>
                    )}
                  </div>
                  {isArgsExpanded && (
                    <pre className="p-2 bg-slate-950 rounded border border-slate-800/80 text-[11px] text-slate-300 font-mono overflow-x-auto select-text">
                      {JSON.stringify(item.args, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Observación Cruda (obs) y Visor de RefStore */}
              {hasObs && (
                <div className="flex flex-col gap-1 mt-0.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleObs(item.id)}
                      className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      {isObsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>Evidencia observable ({item.obs!.length} caracteres)</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {cleanRef && onInspectRef && (
                        <button
                          type="button"
                          onClick={() => onInspectRef(cleanRef)}
                          className="flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-100 px-2 py-0.5 rounded bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-800/60 transition-colors cursor-pointer"
                          title={`Ver contenido completo almacenado bajo ref:${cleanRef}`}
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          <span>Ver en RefStore (ref:{cleanRef})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyText(`obs-${item.id}`, item.obs!)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
                      >
                        {copiedKey === `obs-${item.id}` ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                            <span className="text-emerald-400">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-2.5 h-2.5" />
                            <span>Copiar obs</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {isObsExpanded && (
                    <div className="flex flex-col gap-1">
                      <div className="p-2 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto select-text leading-relaxed">
                        {item.obs}
                      </div>
                      {cleanRef && (
                        <span className="text-[10px] text-slate-500 italic">
                          Contenido completo disponible en la referencia de RefStore (ref:{cleanRef}).
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Banderas (flags) */}
              {item.flags && item.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-slate-500 text-[10px] mt-0.5">
                  {item.flags.map((f, fIdx) => (
                    <span key={`flag-${fIdx}`} className="bg-slate-900 px-1 rounded border border-slate-800">
                      [{f}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
