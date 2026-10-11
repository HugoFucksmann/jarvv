import React from "react";
import { Check, ArrowRight } from "lucide-react";
import { Step } from "../../../core/types.ts";

interface PlanReviewProps {
  steps: Step[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const PlanReview: React.FC<PlanReviewProps> = ({
  steps,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900/90 border border-slate-700/80 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold tracking-wider text-sky-400">
            PLAN GENERADO POR QWEN 3.5 9B — REVISIÓN REQUERIDA
          </span>
          <span className="text-xs text-slate-500 font-mono">
            ({steps.length} pasos)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer"
          >
            <span>Confirmar y Ejecutar Plan</span>
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-slate-800 border-t border-slate-800 pt-2">
        {steps.map((step, idx) => (
          <div key={`plan-step-${step.id || "item"}-${idx}`} className="flex items-start gap-3 py-2 text-xs">
            <span className="font-mono text-slate-500 w-5 tabular-nums">
              {idx + 1}.
            </span>
            <span className="font-mono text-sky-400/90 whitespace-nowrap">
              [{step.route}]
            </span>
            <div className="flex flex-col flex-1">
              <span className="text-slate-300">
                {step.instruction}
              </span>
              {step.expectedOutcome && (
                <span className="text-emerald-400/80 text-[11px] font-mono mt-0.5">
                  Esperado: {step.expectedOutcome}
                </span>
              )}
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          </div>
        ))}
      </div>
    </div>
  );
};
