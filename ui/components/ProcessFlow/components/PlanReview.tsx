import React, { useState } from "react";
import { Check, X, Edit3, ArrowRight, Loader2, Sparkles, AlertCircle } from "lucide-react";
import type { Step } from "../../../../src/core/types.ts";
import { MODELS } from "../../../../src/core/models.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import type { ActionResult } from "../../../types/ui.ts";

interface PlanReviewProps {
  steps: Step[];
  replans?: number;
  onConfirm: () => ActionResult;
  onReject?: (reason?: string) => ActionResult;
  onModify?: (feedback: string) => ActionResult;
  onCancel: () => ActionResult;
}

/** Solo uno de los dos paneles de entrada puede estar abierto a la vez. */
type Panel = "modify" | "reject";

// Clases completas por tono (Tailwind necesita ver los nombres literales).
const PANEL_TONES: Record<Panel, { box: string; title: string; input: string; submit: string }> = {
  modify: {
    box: "bg-slate-950 border-sky-800/80",
    title: "text-sky-300",
    input: "border-slate-700 focus:border-sky-400",
    submit: "bg-sky-500 hover:bg-sky-400 text-slate-950",
  },
  reject: {
    box: "bg-rose-950/40 border-rose-900/80",
    title: "text-rose-300",
    input: "border-rose-900/60 focus:border-rose-400",
    submit: "bg-rose-500 hover:bg-rose-400 text-white",
  },
};

interface FeedbackPanelProps {
  tone: Panel;
  title: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitIcon: React.ReactNode;
  submitDisabled: boolean;
  isSubmitting: boolean;
}

const FeedbackPanel: React.FC<FeedbackPanelProps> = ({
  tone,
  title,
  placeholder,
  value,
  onChange,
  onClose,
  onSubmit,
  submitLabel,
  submitIcon,
  submitDisabled,
  isSubmitting,
}) => {
  const styles = PANEL_TONES[tone];

  return (
    <div className={`p-3 rounded-lg border flex flex-col gap-2 ${styles.box}`}>
      <div className={`flex items-center justify-between text-xs font-medium ${styles.title}`}>
        {title}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel"
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitDisabled) onSubmit();
          }}
          placeholder={placeholder}
          className={`flex-1 px-3 py-1.5 bg-slate-900 border rounded text-xs text-white placeholder-slate-500 focus:outline-none font-mono ${styles.input}`}
          autoFocus
        />
        <button
          type="button"
          disabled={submitDisabled}
          onClick={onSubmit}
          className={`px-3 py-1.5 font-semibold text-xs rounded transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer ${styles.submit}`}
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : submitIcon}
          <span>{submitLabel}</span>
        </button>
      </div>
    </div>
  );
};

export const PlanReview: React.FC<PlanReviewProps> = ({
  steps,
  replans = 0,
  onConfirm,
  onReject,
  onModify,
  onCancel,
}) => {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const togglePanel = (target: Panel) => setPanel((current) => (current === target ? null : target));

  // Bloquea los botones mientras el backend procesa la acción
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

  const handleSendModify = () => {
    const feedback = feedbackText.trim();
    if (!feedback || !onModify) return;
    void submit(async () => {
      // Si el back rechaza la acción, el panel conserva el texto para reintentar.
      if ((await onModify(feedback)) === false) return;
      setPanel(null);
      setFeedbackText("");
    });
  };

  const handleSendReject = () => {
    if (!onReject) return;
    void submit(async () => {
      if ((await onReject(rejectReason.trim() || undefined)) === false) return;
      setPanel(null);
      setRejectReason("");
    });
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900/90 border border-slate-700/80 rounded-lg shadow-md">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-mono font-semibold tracking-wider text-sky-300">
            {replans > 0
              ? `REPLANIFICACIÓN #${replans} POR ${MODELS.QWEN_3_5_9B.name.toUpperCase()}`
              : `PLAN ESTRUCTURADO POR ${MODELS.QWEN_3_5_9B.name.toUpperCase()}`}
          </span>
          <span className="text-xs text-slate-500 font-mono">({steps.length} etapas)</span>
          <span className="text-[11px] font-sans px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
            Aprobación requerida antes de actuar
          </span>
        </div>

        {/* Acciones de cabecera */}
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
              onClick={() => togglePanel("reject")}
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
              onClick={() => togglePanel("modify")}
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

      {panel === "modify" && (
        <FeedbackPanel
          tone="modify"
          title={<span>Indica los cambios o instrucciones correctivas para {MODELS.QWEN_3_5_9B.short}:</span>}
          placeholder="Ej: Omitir la búsqueda web y usar Desktop Commander directamente..."
          value={feedbackText}
          onChange={setFeedbackText}
          onClose={() => setPanel(null)}
          onSubmit={handleSendModify}
          submitLabel="Regenerar"
          submitIcon={<Check className="w-3.5 h-3.5" />}
          submitDisabled={!feedbackText.trim() || isSubmitting}
          isSubmitting={isSubmitting}
        />
      )}

      {panel === "reject" && (
        <FeedbackPanel
          tone="reject"
          title={
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Confirmar rechazo del plan (motivo opcional):</span>
            </div>
          }
          placeholder="Motivo del rechazo (opcional)..."
          value={rejectReason}
          onChange={setRejectReason}
          onClose={() => setPanel(null)}
          onSubmit={handleSendReject}
          submitLabel="Confirmar Rechazo"
          submitIcon={<X className="w-3.5 h-3.5" />}
          submitDisabled={isSubmitting}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Lista de etapas del plan */}
      <div className="flex flex-col divide-y divide-slate-800 border-t border-slate-800 pt-2">
        {steps.map((step, idx) => (
          <div key={`plan-step-${step.id || "item"}-${idx}`} className="flex items-start gap-3 py-2.5 text-xs">
            <span className="font-mono text-slate-500 w-5 tabular-nums mt-0.5">{idx + 1}.</span>
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sky-400 font-medium">[{getRouteLabel(step.route)}]</span>
              </div>
              <span className="text-slate-200">{step.instruction}</span>
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