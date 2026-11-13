import React, { useState } from "react";
import { Check, X, Edit3, ArrowRight, Loader2, Sparkles } from "lucide-react";
import type { WaitingPlanStep } from "../../../types/api.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import type { ActionResult } from "../../../types/ui.ts";

interface PlanReviewProps {
  steps: WaitingPlanStep[];
  onConfirm: () => ActionResult;
  onReject?: () => ActionResult;
  onModify?: (feedback: string) => ActionResult;
  onCancel: () => ActionResult;
}

export const PlanReview: React.FC<PlanReviewProps> = ({
  steps,
  onConfirm,
  onReject,
  onModify,
  onCancel,
}) => {
  const [showModifyPanel, setShowModifyPanel] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (action: () => ActionResult) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await action();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = () => submit(onConfirm);

  const handleReject = () => {
    if (!onReject) return;
    void submit(() => onReject());
  };

  const handleSendModify = () => {
    const feedback = feedbackText.trim();
    if (!feedback || !onModify) return;
    void submit(async () => {
      if ((await onModify(feedback)) === false) return;
      setShowModifyPanel(false);
      setFeedbackText("");
    });
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-md">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-accent-400" />
          <span className="text-sm font-semibold text-slate-100">Plan propuesto por el modelo</span>
          <span className="text-xs text-slate-500">({steps.length} etapas)</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-950/30 text-yellow-300 border border-yellow-800/50">
            Confirmación requerida antes de actuar
          </span>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>

          {onReject && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleReject}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:text-rose-100 bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900/60 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              <span>Rechazar</span>
            </button>
          )}

          {onModify && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setShowModifyPanel((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <Edit3 className="w-3 h-3" />
              <span>Modificar</span>
            </button>
          )}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-accent-500 hover:bg-accent-400 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>Aceptar y ejecutar</span>
          </button>
        </div>
      </div>

      {showModifyPanel && (
        <div className="p-3 rounded-lg border flex flex-col gap-2 bg-slate-950 border-accent-500/40">
          <div className="flex items-center justify-between text-xs font-medium text-slate-200">
            <span>Indica los cambios o instrucciones para re-planificar:</span>
            <button
              type="button"
              onClick={() => setShowModifyPanel(false)}
              aria-label="Cerrar panel"
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && feedbackText.trim() && !isSubmitting) handleSendModify();
              }}
              placeholder="Ej: Omitir la búsqueda web y usar Desktop Commander directamente..."
              className="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 rounded-md text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none transition-colors"
              autoFocus
            />
            <button
              type="button"
              disabled={!feedbackText.trim() || isSubmitting}
              onClick={handleSendModify}
              className="px-3 py-2 font-semibold text-xs rounded-md transition-colors flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-slate-950 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Re-planificar</span>
            </button>
          </div>
        </div>
      )}

      {/* Lista de etapas del plan */}
      <div className="flex flex-col divide-y divide-slate-800 border-t border-slate-800 pt-2">
        {steps.map((step, idx) => (
          <div key={`plan-step-${step.id || idx}`} className="flex items-start gap-3 py-2.5 text-sm">
            <span className="font-mono text-xs text-slate-500 w-5 tabular-nums mt-0.5">{idx + 1}.</span>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-xs text-accent-400 font-medium">{getRouteLabel(step.route)}</span>
              <span className="text-slate-100">{step.instruction}</span>
              {step.expected && (
                <span className="text-slate-400 text-xs">
                  <span className="text-slate-500">Esperado:</span> {step.expected}
                </span>
              )}
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
};