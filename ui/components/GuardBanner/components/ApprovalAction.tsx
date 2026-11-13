import React, { useState } from "react";
import { ShieldAlert, Check, X, Loader2, Terminal } from "lucide-react";
import type { WaitingApproval } from "../../../types/api.ts";
import type { ActionResult } from "../../../types/ui.ts";
import { CopyButton } from "../../Shared/CopyButton.tsx";

interface ApprovalActionProps {
  request: WaitingApproval["request"];
  onApprove: () => ActionResult;
  onDeny: (reason?: string) => ActionResult;
}

function renderWithVisibleControlChars(text: string): React.ReactNode {
  if (typeof text !== "string") return String(text);

  const parts = text.split(/(\r|\t|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F])/g);

  return parts.map((part, index) => {
    if (part === "\r") {
      return (
        <span
          key={index}
          className="inline-flex items-center px-1 py-0.5 mx-0.5 rounded text-[10px] font-mono font-bold bg-yellow-950 text-yellow-300 border border-yellow-700/70 select-none"
          title="Retorno de carro (\r)"
        >
          \r
        </span>
      );
    }
    if (part === "\t") {
      return (
        <span
          key={index}
          className="inline-flex items-center px-1 py-0.5 mx-0.5 rounded text-[10px] font-mono font-bold bg-yellow-950 text-yellow-300 border border-yellow-700/70 select-none"
          title="Tabulador (\t)"
        >
          ⇥
        </span>
      );
    }
    if (part.length === 1 && part.charCodeAt(0) < 32 && part !== "\n") {
      const hex = part.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase();
      return (
        <span
          key={index}
          className="inline-flex items-center px-1 py-0.5 mx-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800/80 select-none"
          title={`Carácter de control 0x${hex}`}
        >
          \x{hex}
        </span>
      );
    }
    return part;
  });
}

function formatArgValue(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

export const ApprovalAction: React.FC<ApprovalActionProps> = ({
  request,
  onApprove,
  onDeny,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runAction = async (action: () => ActionResult) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await action();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = () => runAction(onApprove);
  const handleDeny = () => runAction(() => onDeny("Rechazado manualmente por el usuario"));

  const rawArgs = request.args || {};
  // `run_command`: un comando nuevo (`command`) o la respuesta a un proceso que esperaba entrada (`pid` e `input`).
  const isStartProcess = Boolean(rawArgs.command);
  const isInteractWithProcess = Boolean(rawArgs.input);

  let primaryType: "command" | "input" | null = null;
  let primaryContent: string | null = null;
  const secondaryEntries: Array<[string, unknown]> = [];

  if (isStartProcess && typeof rawArgs.command === "string") {
    primaryType = "command";
    primaryContent = rawArgs.command;
    for (const [k, v] of Object.entries(rawArgs)) {
      if (k !== "command") {
        secondaryEntries.push([k, v]);
      }
    }
  } else if (isInteractWithProcess && typeof rawArgs.input === "string") {
    primaryType = "input";
    primaryContent = rawArgs.input;
    for (const [k, v] of Object.entries(rawArgs)) {
      if (k !== "input") {
        secondaryEntries.push([k, v]);
      }
    }
  } else {
    for (const [k, v] of Object.entries(rawArgs)) {
      secondaryEntries.push([k, v]);
    }
  }

  const processId = rawArgs.pid !== undefined ? String(rawArgs.pid) : rawArgs.process_id !== undefined ? String(rawArgs.process_id) : null;

  return (
    <div className="flex flex-col gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-200">
      {/* Encabezado de la compuerta y acciones */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <ShieldAlert className="w-5 h-5 text-yellow-400 shrink-0" />
          <span className="text-sm font-semibold text-yellow-300">Aprobación requerida</span>
          {request.capability && (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300">
              {request.capability}
            </span>
          )}
          <span className="text-xs font-mono font-semibold text-slate-100 break-all">
            {request.mcp ? `${request.mcp}:` : ""}
            {request.tool}
          </span>
          <span className="text-[11px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
            Espera activa sin expiración
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleDeny}
            title="Denegar operación"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900/60 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            <span>Denegar</span>
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleApprove}
            title="Aprobar ejecución"
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-accent-500 hover:bg-accent-400 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>Aprobar ejecución</span>
          </button>
        </div>
      </div>

      {/* Motivo reportado por Guard */}
      {request.reason && (
        <p className="text-sm text-slate-100 leading-relaxed">{request.reason}</p>
      )}

      {/* Bloque de comando o entrada interactiva */}
      {primaryContent !== null && (
        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-xs pb-1.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-accent-400 shrink-0" />
              <span className="font-semibold text-slate-200">
                {primaryType === "command" ? "Comando de terminal" : "Entrada interactiva (stdin)"}
              </span>
              {processId !== null && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-mono">
                  process_id: {processId}
                </span>
              )}
            </div>
            <CopyButton
              text={primaryContent}
              title="Copiar contenido exacto al portapapeles"
              copiedLabel="¡Copiado!"
              className="gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white"
            />
          </div>
          <pre className="p-2 rounded bg-black/40 text-slate-100 font-mono text-[13px] whitespace-pre-wrap break-all leading-relaxed max-h-56 overflow-y-auto selection:bg-accent-500/30">
            {renderWithVisibleControlChars(primaryContent)}
          </pre>
        </div>
      )}

      {/* Otros argumentos */}
      {secondaryEntries.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {primaryContent !== null ? "Otros argumentos de la llamada" : "Argumentos de la llamada"}
          </span>
          <div className="flex flex-col gap-1.5 font-mono text-xs">
            {secondaryEntries.map(([k, v]) => {
              const isString = typeof v === "string";
              const isMultiline = isString && (v.includes("\n") || v.length > 80);
              const strVal = formatArgValue(v);

              if (isMultiline) {
                return (
                  <div key={k} className="flex flex-col gap-1 p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-accent-400 font-semibold">{k}:</span>
                      <CopyButton
                        text={strVal}
                        copiedLabel="¡Copiado!"
                        className="gap-1 text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      />
                    </div>
                    <pre className="p-1.5 rounded bg-black/40 text-slate-100 whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-xs leading-relaxed">
                      {renderWithVisibleControlChars(strVal)}
                    </pre>
                  </div>
                );
              }

              return (
                <div key={k} className="flex items-start gap-2 py-0.5 px-1 rounded hover:bg-slate-800/40">
                  <span className="text-accent-400 font-semibold shrink-0">{k}:</span>
                  <span className="text-slate-100 break-all">{strVal}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};