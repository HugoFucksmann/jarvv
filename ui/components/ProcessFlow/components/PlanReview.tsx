import type React from "react";
import { useState } from "react";
import { Check, X, Pencil, Loader2, Sparkles, Send } from "lucide-react";
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

const ICON_BTN_BASE =
  "inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70";

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

  const handleConfirm = () => void submit(onConfirm);

  const handleCancelPlan = () => {
    if (onReject) {
      void submit(() => onReject());
    } else {
      void submit(onCancel);
    }
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Sparkles className="w-4 h-4 text-accent-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-100">Plan propuesto</span>
          <span className="text-xs text-slate-500 tabular-nums">({steps.length} {steps.length === 1 ? "etapa" : "etapas"})</span>
          <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-950/30 text-yellow-300 border border-yellow-800/50">
            Confirmación requerida
          </span>
        </div>

        {/* Acciones por iconos: Aceptar, Editar, Cancelar */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto" role="group" aria-label="Acciones del plan">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            title="Aceptar y ejecutar plan"
            aria-label="Aceptar y ejecutar plan"
            className={`${ICON_BTN_BASE} border-accent-400/30 bg-accent-500 hover:bg-accent-400 text-slate-950 shadow-xs`}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 stroke-[2.5]" />
            )}
          </button>

          {onModify && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setShowModifyPanel((v) => !v)}
              title={showModifyPanel ? "Cerrar edición del plan" : "Editar plan"}
              aria-label="Editar plan"
              aria-expanded={showModifyPanel}
              className={`${ICON_BTN_BASE} ${
                showModifyPanel
                  ? "bg-accent-500/20 text-accent-300 border-accent-500/50"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleCancelPlan}
            title="Cancelar plan"
            aria-label="Cancelar plan"
            className={`${ICON_BTN_BASE} text-rose-300 hover:text-rose-100 bg-rose-950/50 hover:bg-rose-900/50 border-rose-900/60`}
          >
            <X className="w-4 h-4" />
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
              title="Cerrar panel de edición"
              aria-label="Cerrar panel de edición"
              className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
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
                if (e.key === "Escape") setShowModifyPanel(false);
              }}
              placeholder="Ej: Omitir la búsqueda web y usar el terminal directamente..."
              className="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 rounded-md text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none transition-colors"
              autoFocus
            />
            <button
              type="button"
              disabled={!feedbackText.trim() || isSubmitting}
              onClick={handleSendModify}
              title="Enviar cambios y re-planificar"
              className="px-3 py-2 font-semibold text-xs rounded-md transition-colors flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-slate-950 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800 shrink-0"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Re-planificar</span>
            </button>
          </div>
        </div>
      )}

      {/* Lista de etapas del plan */}
      <div className="flex flex-col divide-y divide-slate-800/80 border-t border-slate-800 pt-1">
        {steps.map((step, idx) => (
          <div key={`plan-step-${step.id || idx}`} className="flex items-start gap-3 py-2.5 text-sm">
            <span className="font-mono text-xs text-slate-500 w-5 tabular-nums mt-0.5 shrink-0">{idx + 1}.</span>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-xs text-accent-400 font-medium">{getRouteLabel(step.route)}</span>
              <span className="text-slate-100 leading-relaxed">{step.instruction}</span>
              {step.expected && (
                <span className="text-slate-400 text-xs">
                  <span className="text-slate-500">Esperado:</span> {step.expected}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};