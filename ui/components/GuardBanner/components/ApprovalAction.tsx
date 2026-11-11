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
          className="inline-flex items-center px-1 py-0.2 mx-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/80 select-none"
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
          className="inline-flex items-center px-1 py-0.2 mx-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/80 select-none"
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
          className="inline-flex items-center px-1 py-0.2 mx-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800/80 select-none"
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
    <div className="flex flex-col gap-3 p-3.5 bg-amber-950/50 border border-amber-900/80 rounded-lg text-amber-200 shadow-md">
      {/* Encabezado de la compuerta y acciones */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-amber-900/60">
        <div className="flex items-center gap-2.5 flex-wrap">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
          <span className="text-xs font-mono font-semibold text-amber-300">
            GUARD: APROBACIÓN REQUERIDA
          </span>
          {request.capability && (
            <>
              <span className="text-amber-700" aria-hidden="true">
                ·
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-800/80 text-[11px] font-mono text-amber-300">
                {request.capability}
              </span>
            </>
          )}
          <span className="text-amber-700" aria-hidden="true">
            ·
          </span>
          <span className="text-xs font-mono font-bold text-amber-200">
            {request.mcp ? `${request.mcp}:` : ""}
            {request.tool}
          </span>
          <span className="text-amber-700" aria-hidden="true">
            ·
          </span>
          <span className="text-emerald-400 font-sans text-[11px] bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">
            Espera activa sin expiración
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleDeny}
            title="Denegar operación"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/60 hover:bg-rose-900/50 border border-rose-900/60 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            <span>Denegar</span>
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleApprove}
            title="Aprobar ejecución"
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>Aprobar Ejecución</span>
          </button>
        </div>
      </div>

      {/* Motivo reportado por Guard */}
      {request.reason && (
        <p className="text-sm text-amber-100 font-medium leading-relaxed">{request.reason}</p>
      )}

      {/* Bloque de comando o entrada interactiva */}
      {primaryContent !== null && (
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-slate-950/80 border border-amber-900/70">
          <div className="flex items-center justify-between text-xs font-mono pb-1 border-b border-amber-950">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-semibold text-amber-200">
                {primaryType === "command" ? "COMANDO DE TERMINAL" : "ENTRADA INTERACTIVA (stdin)"}
              </span>
              {processId !== null && (
                <span className="px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700/80 text-amber-300 text-[11px]">
                  process_id: {processId}
                </span>
              )}
            </div>
            <CopyButton
              text={primaryContent}
              title="Copiar contenido exacto al portapapeles"
              copiedLabel="Copiado!"
              className="gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 hover:bg-amber-900/80 border border-amber-800/80 text-amber-300 hover:text-white"
            />
          </div>
          <pre className="p-2 rounded bg-black/60 border border-amber-950 text-amber-100 font-mono text-xs whitespace-pre-wrap break-all leading-relaxed max-h-56 overflow-y-auto selection:bg-amber-900/60">
            {renderWithVisibleControlChars(primaryContent)}
          </pre>
        </div>
      )}

      {/* Otros argumentos */}
      {secondaryEntries.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-amber-900/40">
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-amber-400/90">
            {primaryContent !== null ? "Otros argumentos de la llamada:" : "Argumentos de la llamada:"}
          </span>
          <div className="flex flex-col gap-1.5 font-mono text-xs">
            {secondaryEntries.map(([k, v]) => {
              const isString = typeof v === "string";
              const isMultiline = isString && (v.includes("\n") || v.length > 80);
              const strVal = formatArgValue(v);

              if (isMultiline) {
                return (
                  <div key={k} className="flex flex-col gap-1 p-2 rounded bg-slate-950/60 border border-amber-900/50">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-400 font-semibold">{k}:</span>
                      <CopyButton
                        text={strVal}
                        copiedLabel="Copiado!"
                        className="gap-1 text-[10px] px-1.5 py-0.2 rounded hover:bg-amber-900/60 text-amber-400 hover:text-white"
                      />
                    </div>
                    <pre className="p-1.5 rounded bg-black/50 text-amber-100 whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-[11px] leading-relaxed">
                      {renderWithVisibleControlChars(strVal)}
                    </pre>
                  </div>
                );
              }

              return (
                <div key={k} className="flex items-start gap-2 py-0.5 px-1 rounded hover:bg-amber-950/30">
                  <span className="text-amber-400 font-semibold shrink-0">{k}:</span>
                  <span className="text-amber-100 break-all">{strVal}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
