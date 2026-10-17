import React, { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldX,
  HelpCircle,
  Loader2,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Terminal,
  Copy,
  Check,
} from "lucide-react";
import { Step, StepRoute } from "../../../core/types.ts";

interface StepItemProps {
  step: Step;
  index: number;
  isCurrent: boolean;
}

export const StepItem: React.FC<StepItemProps> = ({ step, index, isCurrent }) => {
  const [showCalls, setShowCalls] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const [expandedObs, setExpandedObs] = useState<Record<string, boolean>>({});
  const [copiedObsKey, setCopiedObsKey] = useState<string | null>(null);

  const toggleObs = (key: string) => {
    setExpandedObs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyObs = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedObsKey(key);
      setTimeout(() => setCopiedObsKey(null), 2000);
    } catch (err) {
      console.error("Error al copiar observación:", err);
    }
  };

  const handleCopyError = async () => {
    if (!step.error) return;
    try {
      await navigator.clipboard.writeText(step.error);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    } catch (err) {
      console.error("Error al copiar error:", err);
    }
  };

  const renderStatusIcon = () => {
    switch (step.state) {
      case "COMPLETED":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case "RUNNING":
        return <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />;
      case "FAILED":
        return <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />;
      case "UNVERIFIED":
        return <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />;
      case "BLOCKED":
        return <ShieldX className="w-4 h-4 text-orange-500 shrink-0" />;
      case "PENDING":
      default:
        return <Clock className="w-4 h-4 text-slate-600 shrink-0" />;
    }
  };

  const getRouteLabel = () => {
    switch (step.route as StepRoute) {
      case "windows":
        return "Windows MCP";
      case "desktop_commander":
        return "Desktop Commander";
      case "free_search":
        return "Free Search MCP";
      case "fin":
        return "Fin / Qwen Chat";
      default:
        return step.route;
    }
  };

  const callsCount = step.calls?.length ?? 0;

  return (
    <div
      className={`flex flex-col gap-2 py-3 px-3.5 rounded-lg transition-colors ${
        step.superseded
          ? "opacity-50 bg-slate-950/60 border border-slate-900"
          : isCurrent
          ? "bg-slate-900/90 border border-slate-700/60"
          : "hover:bg-slate-900/40 border border-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{renderStatusIcon()}</div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-500 tabular-nums">
                #{index + 1}
              </span>
              <span className="font-mono text-slate-400 font-medium">
                {getRouteLabel()}
              </span>
              {step.tool && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono text-sky-300">
                    {step.tool}
                  </span>
                </>
              )}
              {step.superseded && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-950/50 text-rose-400 border border-rose-900/50">
                  SUPERSEDED {step.rev ? `(rev ${step.rev})` : ""}
                </span>
              )}
              {step.dependencies && step.dependencies.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-950/50 text-amber-300 border border-amber-900/50">
                  deps: [{step.dependencies.join(", ")}]
                </span>
              )}
            </div>
            <p className={`text-sm ${step.superseded ? "line-through text-slate-500" : "text-slate-200"}`}>
              {step.instruction}
            </p>
            {step.expectedOutcome && !step.superseded && (
              <p className="text-xs text-emerald-400/70 font-mono mt-0.5">
                Esperado: {step.expectedOutcome}
              </p>
            )}
            {step.handoff && !step.superseded && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-900/50 px-2 py-0.5 rounded mt-1">
                <span className="text-cyan-400 font-semibold">Handoff:</span>
                <span className="text-slate-300">{step.handoff.finding}</span>
                {step.handoff.primaryFact && (
                  <span className="text-emerald-400 bg-emerald-950/80 px-1 rounded">
                    {step.handoff.primaryFact.key}={step.handoff.primaryFact.value}
                  </span>
                )}
                {step.handoff.refKey && (
                  <span className="text-sky-300 font-medium">[{step.handoff.refKey}]</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          {step.verification === "UNVERIFIED" && (
            <span className="text-amber-400 font-medium">
              [UNVERIFIED]
            </span>
          )}
          {step.verification === "VERIFIED" && (
            <span className="text-emerald-400">
              [VERIFIED]
            </span>
          )}
          <span className="text-slate-500">
            {step.state}
          </span>
        </div>
      </div>

      {/* Accordion toggle for calls history */}
      {callsCount > 0 && (
        <div className="ml-7 mt-1">
          <button
            type="button"
            onClick={() => setShowCalls(!showCalls)}
            className="flex items-center gap-1.5 text-xs text-sky-400/90 hover:text-sky-300 font-mono transition-colors cursor-pointer"
          >
            {showCalls ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>
              {callsCount} llamada{callsCount > 1 ? "s" : ""} a herramientas
            </span>
          </button>

          {showCalls && (
            <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-slate-800 pl-3 py-1">
              {step.calls!.map((c, cIdx) => {
                const isError = Boolean(c.error);
                const isVerified = c.verification === "VERIFIED";
                return (
                  <div
                    key={`call-${c.id || "item"}-${cIdx}`}
                    className="p-2 rounded bg-slate-950/70 border border-slate-800/80 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="text-sky-300 font-semibold flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-sky-400" />
                        {c.mcp}:{c.tool}
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span
                          className={
                            isError
                              ? "text-rose-400"
                              : isVerified
                              ? "text-emerald-400"
                              : "text-slate-400"
                          }
                        >
                          [{isError ? "error" : c.verification || "ok"}]
                        </span>
                      </div>
                    </div>

                    {c.args && Object.keys(c.args).length > 0 && (
                      <div className="text-[11px] text-slate-400 truncate mb-1">
                        <span className="text-slate-500">args: </span>
                        {JSON.stringify(c.args)}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-300 bg-slate-900/60 p-1.5 rounded border border-slate-800/40">
                      <p className="line-clamp-3">
                        {c.evidence?.summary || c.error || c.evidence?.obs || "Sin detalle textual"}
                      </p>
                    </div>

                    {c.evidence?.obs && (
                      <div className="mt-1 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => toggleObs(`call-${c.id || cIdx}`)}
                            className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer font-mono"
                          >
                            {expandedObs[`call-${c.id || cIdx}`] ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            <span>
                              Salida completa ({c.evidence.obs.length} caracteres)
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyObs(`call-${c.id || cIdx}`, c.evidence!.obs!)}
                            title="Copiar salida de herramienta"
                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
                          >
                            {copiedObsKey === `call-${c.id || cIdx}` ? (
                              <>
                                <Check className="w-2.5 h-2.5 text-emerald-400" />
                                <span className="text-emerald-400">Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>
                        </div>

                        {expandedObs[`call-${c.id || cIdx}`] && (
                          <div className="p-2 bg-slate-950 rounded border border-slate-800 text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                            {c.evidence.obs}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Render evidence or execution details if present */}
      {step.evidence && (
        <div className="ml-7 text-xs text-slate-400 border-l border-slate-800 pl-3 py-0.5 flex flex-col gap-1">
          <p className="line-clamp-2 text-slate-300">
            {step.evidence.summary || step.evidence.obs || "Paso ejecutado"}
          </p>
          {step.evidence.obs && callsCount === 0 && (
            <div className="flex flex-col gap-1 mt-0.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleObs(`step-${step.id || index}`)}
                  className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer font-mono"
                >
                  {expandedObs[`step-${step.id || index}`] ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>Salida completa ({step.evidence.obs.length} caracteres)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyObs(`step-${step.id || index}`, step.evidence!.obs!)}
                  title="Copiar salida de evidencia"
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
                >
                  {copiedObsKey === `step-${step.id || index}` ? (
                    <>
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-2.5 h-2.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
              {expandedObs[`step-${step.id || index}`] && (
                <div className="p-2 bg-slate-950 rounded border border-slate-800 text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {step.evidence.obs}
                </div>
              )}
            </div>
          )}
          {step.evidence.flags && step.evidence.flags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1 text-slate-500 font-mono text-[11px]">
              {step.evidence.flags.map((flag, fIdx) => (
                <span key={fIdx}>· {flag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Render error if failed */}
      {step.error && (
        <div className="ml-7 flex items-start justify-between gap-3 text-xs text-rose-400 font-mono border-l border-rose-900/60 pl-3 py-1.5 bg-rose-950/20 rounded-r">
          <span className="flex-1 break-all">{step.error}</span>
          <button
            type="button"
            onClick={handleCopyError}
            title="Copiar error al portapapeles"
            aria-label="Copiar mensaje de error"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-900/40 border border-rose-900/60 rounded transition-colors cursor-pointer shrink-0"
          >
            {copiedError ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

