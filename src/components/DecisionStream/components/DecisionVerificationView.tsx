import React, { useState } from "react";
import type { CoreEvent } from "../../../core/types.ts";
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Copy, Check } from "lucide-react";

interface DecisionVerificationViewProps {
  resultEvent?: CoreEvent;
}

export const DecisionVerificationView: React.FC<DecisionVerificationViewProps> = ({ resultEvent }) => {
  if (!resultEvent) return null;

  const [copiedRaw, setCopiedRaw] = useState(false);
  const data = (resultEvent.data || {}) as any;
  const processed = data.processed || {};
  const verification = data.verification || {};
  const isStepSuccess = Boolean(data.isStepSuccess);
  const signals = processed.signals || {};
  const rawOutput = data.rawOutput || verification?.rawOutput;
  const rawInput = data.rawInput || verification?.rawInput;

  const handleCopyRaw = async () => {
    const textToCopy = rawOutput || rawInput || JSON.stringify(verification, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch (err) {
      console.error("Error al copiar raw Eos verification:", err);
    }
  };

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
        <div className="flex items-center gap-2">
          <span className={isStepSuccess ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
            {isStepSuccess ? "PASO VERIFICADO" : "DESVIACIÓN / ERROR"}
          </span>
          {(rawOutput || rawInput) && (
            <button
              type="button"
              onClick={handleCopyRaw}
              title="Copiar respuesta cruda original de verificación Eos"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {copiedRaw ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copiedRaw ? "Copiado" : "Copiar raw"}</span>
            </button>
          )}
        </div>
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
