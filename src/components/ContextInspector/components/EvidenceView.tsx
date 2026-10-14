import React, { useState } from "react";
import type { Step } from "../../../core/types.ts";
import { Terminal, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

interface EvidenceViewProps {
  steps: Step[];
}

interface EvidenceItem {
  key: string;
  stepIndex: number;
  stepRoute: string;
  source: string;
  ok: boolean;
  summary: string;
  obs?: string;
  ref?: string;
  args?: Record<string, unknown>;
  flags?: string[];
  callId?: string;
  verification?: string;
}

export const EvidenceView: React.FC<EvidenceViewProps> = ({ steps }) => {
  const [expandedObs, setExpandedObs] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const toggleExpand = (key: string) => {
    setExpandedObs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyObs = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error("Error al copiar evidencia:", err);
    }
  };

  const items: EvidenceItem[] = [];

  steps.forEach((step, sIdx) => {
    if (step.calls && step.calls.length > 0) {
      step.calls.forEach((call, cIdx) => {
        if (call.evidence || call.error || call.outcome) {
          items.push({
            key: `ev-${sIdx}-${step.id || "step"}-${call.id || cIdx}`,
            stepIndex: sIdx + 1,
            stepRoute: step.route,
            source: `${call.mcp}:${call.tool}`,
            ok: Boolean((call.evidence?.ok ?? call.outcome?.success) && !call.error),
            summary: call.evidence?.summary || call.error || (call.outcome?.success ? "Llamada ejecutada con éxito" : "Llamada completada"),
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
        key: `ev-${sIdx}-${step.id || "step"}-root`,
        stepIndex: sIdx + 1,
        stepRoute: step.route,
        source: step.tool ? `${step.mcp || step.route}:${step.tool}` : step.route,
        ok: Boolean(step.evidence?.ok && !step.error),
        summary: step.evidence?.summary || step.error || "Paso ejecutado",
        obs: step.evidence?.obs,
        ref: step.evidence?.ref,
        args: step.args,
        flags: step.evidence?.flags,
        verification: step.verification,
      });
    }
  });

  if (items.length === 0) {
    return (
      <div className="py-4 text-xs font-mono text-slate-500">
        Sin evidencia registrada aún.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-slate-800/80 text-xs font-mono">
      {items.map((item) => {
        const isObsExpanded = expandedObs[item.key] ?? false;
        const hasObs = Boolean(item.obs && item.obs.trim());
        const hasArgs = item.args && Object.keys(item.args).length > 0;

        return (
          <div key={item.key} className="py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 font-mono">Paso #{item.stepIndex}</span>
                <span className="text-slate-600">·</span>
                <span className="text-sky-300 font-semibold flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-sky-400" />
                  {item.source}
                </span>
                {item.ref && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-indigo-400 font-mono text-[10px] bg-indigo-950/60 px-1 rounded border border-indigo-900/50">
                      ref:{item.ref.replace("ref:", "")}
                    </span>
                  </>
                )}
                {item.verification && (
                  <span className="text-[10px] text-slate-500">[{item.verification}]</span>
                )}
              </div>
              <span className={item.ok ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                {item.ok ? "OK" : "ERROR"}
              </span>
            </div>

            <p className="text-slate-300 font-sans text-xs leading-relaxed">
              {item.summary}
            </p>

            {hasArgs && (
              <div className="text-[11px] text-slate-400 truncate bg-slate-900/40 p-1 rounded border border-slate-800/40">
                <span className="text-slate-500 font-mono">args: </span>
                <span className="font-mono text-slate-300">{JSON.stringify(item.args)}</span>
              </div>
            )}

            {hasObs && (
              <div className="flex flex-col gap-1 mt-0.5">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.key)}
                    className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer font-mono"
                  >
                    {isObsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Evidencia de salida ({item.obs!.length} caracteres)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyObs(item.key, item.obs!)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
                  >
                    {copiedKey === item.key ? (
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

                {isObsExpanded && (
                  <div className="p-2 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {item.obs}
                  </div>
                )}
              </div>
            )}

            {item.flags && item.flags.length > 0 && (
              <div className="flex flex-wrap gap-2 text-slate-500 text-[11px] mt-0.5">
                {item.flags.map((f, fIdx) => (
                  <span key={fIdx}>[{f}]</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
