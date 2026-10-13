import React from "react";
import type { CoreEvent } from "../../../core/types.ts";
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";

interface DecisionVerificationViewProps {
  resultEvent?: CoreEvent;
}

export const DecisionVerificationView: React.FC<DecisionVerificationViewProps> = ({ resultEvent }) => {
  if (!resultEvent) return null;

  const data = (resultEvent.data || {}) as any;
  const processed = data.processed || {};
  const verification = data.verification || {};
  const isStepSuccess = Boolean(data.isStepSuccess);
  const signals = processed.signals || {};

  const isCleanSignals =
    !processed.outcome?.isError &&
    !signals.exception &&
    !signals.timeout &&
    !signals.denied &&
    !signals.not_found &&
    !signals.empty_output &&
    !signals.stale_element &&
    (signals.exit_code === 0 || signals.exit_code === undefined);

  const ok = verification?.ok ?? isStepSuccess;
  const cumple = verification?.cumple ?? isStepSuccess;
  const decisionData = verification?.decision?.answers || {};

  const okProb = decisionData?.ok?.probabilities?.yes ?? (ok ? 1.0 : 0.0);
  const cumpleProb = decisionData?.cumple?.probabilities?.yes ?? (cumple ? 1.0 : 0.0);

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-slate-300">VERIFICACIÓN FACTUAL (EOS-0.8B)</span>
        </div>
        <span className={isStepSuccess ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
          {isStepSuccess ? "PASO VERIFICADO" : "DESVIACIÓN / ERROR"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-1 text-slate-300">
        {/* Señales Físicas */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Señales:</span>
          {isCleanSignals ? (
            <span className="text-emerald-300 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" /> Limpias (CLEAN)
            </span>
          ) : (
            <span className="text-amber-300 flex items-center gap-1 font-medium">
              <AlertTriangle className="w-3 h-3 text-amber-400 inline" /> Con anomalías
            </span>
          )}
        </div>

        {/* Veredicto ok */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">ok:</span>
          {ok ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 inline" /> SÍ ({(Number(okProb) * 100).toFixed(0)}%)
            </span>
          ) : (
            <span className="text-rose-400 font-semibold flex items-center gap-1">
              <XCircle className="w-3 h-3 inline" /> NO
            </span>
          )}
        </div>

        {/* Veredicto cumple */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">cumple:</span>
          {cumple ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 inline" /> SÍ ({(Number(cumpleProb) * 100).toFixed(0)}%)
            </span>
          ) : (
            <span className="text-rose-400 font-semibold flex items-center gap-1">
              <XCircle className="w-3 h-3 inline" /> NO
            </span>
          )}
        </div>
      </div>

      {processed.finding && (
        <div className="pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-1">
          <span className="text-slate-500 shrink-0">Hallazgo:</span>
          <span className="text-slate-300 line-clamp-2">{processed.finding}</span>
        </div>
      )}
    </div>
  );
};
