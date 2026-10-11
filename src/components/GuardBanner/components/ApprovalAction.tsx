import React, { useState } from "react";
import { ShieldAlert, Check, X, Loader2 } from "lucide-react";
import type { PendingApproval } from "../../../core/types.ts";

interface ApprovalActionProps {
  pending: PendingApproval;
  onApprove: () => void | Promise<void>;
  onDeny: (reason?: string) => void | Promise<void>;
}

export const ApprovalAction: React.FC<ApprovalActionProps> = ({
  pending,
  onApprove,
  onDeny,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleApprove = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onApprove();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeny = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onDeny("Rechazado manualmente por el usuario");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-amber-950/40 border border-amber-900/60 rounded-lg text-amber-200">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs font-mono font-medium text-amber-300">
            <span>GUARD: APROBACIÓN REQUERIDA</span>
            <span aria-hidden="true">·</span>
            <span>{pending.capability}</span>
            <span aria-hidden="true">·</span>
            <span>{pending.mcp}:{pending.tool}</span>
          </div>
          <p className="text-sm text-amber-100">
            {pending.reason}
          </p>
          <div className="text-xs font-mono text-amber-400/80">
            Argumentos: {JSON.stringify(pending.args)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end md:self-center shrink-0">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleDeny}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/60 hover:bg-rose-900/50 border border-rose-900/60 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          <span>Denegar</span>
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleApprove}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          <span>Aprobar Ejecución</span>
        </button>
      </div>
    </div>
  );
};
