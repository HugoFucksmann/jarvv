import React, { useState } from "react";
import { Check, X, Edit3, ArrowRight, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { Step } from "../../../core/types.ts";

interface PlanReviewProps {
  steps: Step[];
  replans?: number;
  onConfirm: () => void | Promise<void>;
  onReject?: (reason?: string) => void | Promise<void>;
  onModify?: (feedback: string) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export const PlanReview: React.FC<PlanReviewProps> = ({
  steps,
  replans = 0,
  onConfirm,
  onReject,
  onModify,
  onCancel,
}) => {
  const [isModifying, setIsModifying] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendModify = async () => {
    if (!feedbackText.trim() || isSubmitting || !onModify) return;
    setIsSubmitting(true);
    try {
      await onModify(feedbackText.trim());
      setIsModifying(false);
      setFeedbackText("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendReject = async () => {
    if (isSubmitting || !onReject) return;
    setIsSubmitting(true);
    try {
      await onReject(rejectReason.trim() || undefined);
      setIsRejecting(false);
      setRejectReason("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900/90 border border-slate-700/80 rounded-lg shadow-md">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-mono font-semibold tracking-wider text-sky-300">
            {replans > 0 ? `REPLANIFICACIÓN #${replans} POR QWEN 3.5 9B` : "PLAN ESTRUCTURADO POR QWEN 3.5 9B"}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            ({steps.length} etapas)
          </span>
          <span className="text-[11px] font-sans px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
            Aprobación requerida antes de actuar
          </span>
        </div>

        {/* Acciones de Cabecera */}
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
              onClick={() => {
                setIsRejecting(!isRejecting);
                setIsModifying(false);
              }}
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
              onClick={() => {
                setIsModifying(!isModifying);
                setIsRejecting(false);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <Edit3 className="w-3 h-3" />
              <span>Modificar</span>
            </button>
          )}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>Aceptar y Ejecutar</span>
          </button>
        </div>
      </div>

      {/* Panel para Solicitar Modificaciones */}
      {isModifying && (
        <div className="p-3 bg-slate-950 rounded-lg border border-sky-800/80 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-sky-300 font-medium">
            <span>Indica los cambios o instrucciones correctivas para Qwen:</span>
            <button
              type="button"
              onClick={() => setIsModifying(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Ej: Omitir la búsqueda web y usar Desktop Commander directamente..."
              className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400 font-mono"
              autoFocus
            />
            <button
              type="button"
              disabled={!feedbackText.trim() || isSubmitting}
              onClick={handleSendModify}
              className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Regenerar</span>
            </button>
          </div>
        </div>
      )}

      {/* Panel para Rechazar Plan */}
      {isRejecting && (
        <div className="p-3 bg-rose-950/40 rounded-lg border border-rose-900/80 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-rose-300 font-medium">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Confirmar rechazo del plan (motivo opcional):</span>
            </div>
            <button
              type="button"
              onClick={() => setIsRejecting(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Motivo del rechazo (opcional)..."
              className="flex-1 px-3 py-1.5 bg-slate-900 border border-rose-900/60 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-400 font-mono"
              autoFocus
            />
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSendReject}
              className="px-3 py-1.5 bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs rounded transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              <span>Confirmar Rechazo</span>
            </button>
          </div>
        </div>
      )}

      {/* Lista de Etapas del Plan */}
      <div className="flex flex-col divide-y divide-slate-800 border-t border-slate-800 pt-2">
        {steps.map((step, idx) => (
          <div key={`plan-step-${step.id || "item"}-${idx}`} className="flex items-start gap-3 py-2.5 text-xs">
            <span className="font-mono text-slate-500 w-5 tabular-nums mt-0.5">
              {idx + 1}.
            </span>
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sky-400 font-medium">
                  [{step.route}]
                </span>
                {step.candidate_tools && step.candidate_tools.length > 0 && (
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800">
                    tools: {step.candidate_tools.join(", ")}
                  </span>
                )}
                {step.dependencies && step.dependencies.length > 0 && (
                  <span className="text-[11px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-900/60">
                    deps: [{step.dependencies.join(", ")}]
                  </span>
                )}
              </div>
              <span className="text-slate-200">
                {step.instruction}
              </span>
              {step.expectedOutcome && (
                <span className="text-emerald-400/90 text-[11px] font-mono">
                  Esperado: {step.expectedOutcome}
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
