import React from "react";
import { Step } from "../../../core/types.ts";

interface EvidenceViewProps {
  steps: Step[];
}

export const EvidenceView: React.FC<EvidenceViewProps> = ({ steps }) => {
  const stepsWithEvidence = steps.filter((s) => s.evidence);

  if (stepsWithEvidence.length === 0) {
    return (
      <div className="py-4 text-xs font-mono text-slate-500">
        Sin evidencia registrada aún.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-slate-800/80 text-xs font-mono">
      {stepsWithEvidence.map((s, idx) => (
        <div key={s.id || idx} className="py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-slate-300 font-semibold">{s.evidence?.ref || s.tool}</span>
            <span className={s.evidence?.ok ? "text-emerald-400" : "text-rose-400"}>
              {s.evidence?.ok ? "OK" : "ERROR"}
            </span>
          </div>
          <p className="text-slate-300 font-sans text-xs">
            {s.evidence?.summary}
          </p>
          {s.evidence?.flags && s.evidence.flags.length > 0 && (
            <div className="flex gap-2 text-slate-500 text-[11px]">
              {s.evidence.flags.map((f, fIdx) => (
                <span key={fIdx}>[{f}]</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
