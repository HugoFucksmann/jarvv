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
      className="flex items-start gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-lg"
    >
      <HelpCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
          <span className="text-yellow-300">Respuesta requerida</span>
          <span aria-hidden="true">·</span>
          <span className="text-[11px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
            Sin temporizador de expiración
          </span>
        </div>
        <p className="text-sm text-slate-100 font-medium whitespace-pre-wrap leading-relaxed">
          {question || "JARVIS requiere aclaración del usuario para proceder con la ejecución."}
        </p>
        <div className="flex items-center gap-2 w-full">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Escribe tu respuesta para reanudar el flujo..."
            aria-label="Respuesta para JARVIS"
            className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 transition-colors disabled:opacity-60"
            disabled={isSending}
            autoFocus
          />
          <button
            type="submit"
            disabled={!answer.trim() || isSending}
            className="px-3 py-2 bg-accent-500 hover:bg-accent-400 text-slate-950 font-semibold text-xs rounded-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800"
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
    <div className="p-2.5 bg-slate-950 border border-yellow-500/40 rounded-xl shadow-xl">
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