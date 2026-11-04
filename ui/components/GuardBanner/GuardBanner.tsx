import React, { memo, useState } from "react";
import { HelpCircle, Send, Loader2 } from "lucide-react";
import type { Waiting } from "../../types/api.ts";
import type { ActionResult } from "../../types/ui.ts";
import { ApprovalAction } from "./components/ApprovalAction.tsx";

interface GuardBannerProps {
  waiting: Waiting | null;
  onApprove: () => ActionResult;
  onDeny: (reason?: string) => ActionResult;
  onAnswer: (answer: string) => ActionResult;
}

const UserAnswerForm: React.FC<{
  question: string;
  onSubmit: (answer: string) => ActionResult;
}> = ({ question, onSubmit }) => {
  const [answer, setAnswer] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      if ((await onSubmit(trimmed)) !== false) setAnswer("");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-sky-950/50 border border-sky-800/80 rounded-lg text-sky-200 shadow-md"
    >
      <div className="flex items-start gap-2.5 flex-1">
        <HelpCircle className="w-5 h-5 text-sky-400 shrink-0 mt-0.5 animate-pulse" />
        <div className="flex flex-col gap-1 flex-1">
          <div className="flex items-center gap-2 text-xs font-mono font-medium text-sky-300">
            <span>Respuesta requerida</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400 font-sans text-[11px] bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-800/60">
              Sin temporizador de expiración
            </span>
          </div>
          <p className="text-sm text-sky-100 font-medium whitespace-pre-wrap leading-relaxed">
            {question || "JARVIS requiere aclaración del usuario para proceder con la ejecución."}
          </p>
          <div className="mt-1 flex items-center gap-2 w-full">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Escribe tu respuesta para reanudar el flujo..."
              aria-label="Respuesta para JARVIS"
              className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400 font-mono"
              disabled={isSending}
              autoFocus
            />
            <button
              type="submit"
              disabled={!answer.trim() || isSending}
              className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Enviar</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

const GuardBannerBase: React.FC<GuardBannerProps> = ({
  waiting,
  onApprove,
  onDeny,
  onAnswer,
}) => {
  if (!waiting || waiting.kind === "plan") return null;

  return (
    <div className="p-2.5 bg-slate-950/95 backdrop-blur-md border border-amber-800/50 rounded-xl shadow-xl">
      {waiting.kind === "approval" ? (
        <ApprovalAction
          request={waiting.request}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ) : waiting.kind === "question" ? (
        <UserAnswerForm
          question={waiting.question.question}
          onSubmit={onAnswer}
        />
      ) : null}
    </div>
  );
};

export const GuardBanner = memo(GuardBannerBase);
