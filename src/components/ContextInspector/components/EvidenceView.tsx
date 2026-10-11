import React from "react";
import type { Step } from "../../../core/types.ts";

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
  flags?: string[];
  callId?: string;
  verification?: string;
}

export const EvidenceView: React.FC<EvidenceViewProps> = ({ steps }) => {
  const items: EvidenceItem[] = [];

  steps.forEach((step, sIdx) => {
    if (step.calls && step.calls.length > 0) {
      step.calls.forEach((call, cIdx) => {
        if (call.evidence || call.error) {
          items.push({
            key: `${step.id}-${call.id || cIdx}`,
            stepIndex: sIdx + 1,
            stepRoute: step.route,
            source: `${call.mcp}:${call.tool}`,
            ok: Boolean(call.evidence?.ok && !call.error),
            summary: call.evidence?.summary || call.error || "Llamada completada",
            flags: call.evidence?.flags,
            callId: call.id,
            verification: call.verification,
          });
        }
      });
    } else if (step.evidence) {
      items.push({
        key: `${step.id}-root`,
        stepIndex: sIdx + 1,
        stepRoute: step.route,
        source: step.tool || step.evidence.ref || step.route,
        ok: step.evidence.ok,
        summary: step.evidence.summary || "Paso ejecutado",
        flags: step.evidence.flags,
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
      {items.map((item) => (
        <div key={item.key} className="py-2.5 flex flex-col gap-1">
          <div className="flex items-center justify-between text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-mono">Paso #{item.stepIndex}</span>
              <span className="text-slate-600">·</span>
              <span className="text-sky-300 font-semibold">{item.source}</span>
              {item.verification && (
                <span className="text-[10px] text-slate-500">[{item.verification}]</span>
              )}
            </div>
            <span className={item.ok ? "text-emerald-400 font-medium" : "text-rose-400 font-medium"}>
              {item.ok ? "OK" : "ERROR"}
            </span>
          </div>
          <p className="text-slate-300 font-sans text-xs leading-relaxed">
            {item.summary}
          </p>
          {item.flags && item.flags.length > 0 && (
            <div className="flex flex-wrap gap-2 text-slate-500 text-[11px] mt-0.5">
              {item.flags.map((f, fIdx) => (
                <span key={fIdx}>[{f}]</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
