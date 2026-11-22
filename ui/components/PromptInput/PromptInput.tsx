import type React from "react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft, XCircle } from "lucide-react";
import type { ActionResult, ExecutionMode } from "../../types/ui.ts";
import { FOCUS_SHORTCUT_LABEL } from "../../utils/platform.ts";

interface PromptInputProps {
  /** Devuelve `false` si el back rechazó la tarea: el texto vuelve al campo para reintentar. */
  onRun: (prompt: string, mode: ExecutionMode) => ActionResult;
  onCancel: () => void;
  mode: ExecutionMode;
  /** Hay una tarea activa (ejecutando o esperando): el input se bloquea y se ofrece Cancelar. */
  isBusy: boolean;
  isExecuting: boolean;
  isWaitingInput: boolean;
  isPaused?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const MAX_TEXTAREA_HEIGHT = 160;

function getPlaceholder(
  mode: ExecutionMode,
  isExecuting: boolean,
  isWaitingInput: boolean,
  isPaused: boolean
): string {
  if (isWaitingInput) {
    return "Tarea en espera de tu decisión: revisa la aprobación, la pregunta o el plan en pantalla...";
  }
  if (isPaused) {
    return "Tarea en pausa por modelo no disponible; reintentando automáticamente...";
  }
  if (isExecuting) {
    return "Ejecutando pipeline y despachando herramientas MCP...";
  }
  return mode === "deliberative"
    ? `Describe una tarea compleja en modo deliberativo (${FOCUS_SHORTCUT_LABEL} para enfocar)...`
    : `Instrucción u objetivo para JARVIS (${FOCUS_SHORTCUT_LABEL} para enfocar)...`;
}

const PromptInputBase: React.FC<PromptInputProps> = ({
  onRun,
  onCancel,
  mode,
  isBusy,
  isExecuting,
  isWaitingInput,
  isPaused = false,
  inputRef,
}) => {
  const [value, setValue] = useState("");
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  const setTextareaRef = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (inputRef) {
      inputRef.current = el;
    }
  };

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = el.scrollHeight;
    if (nextHeight > MAX_TEXTAREA_HEIGHT) {
      el.style.height = `${MAX_TEXTAREA_HEIGHT}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = "hidden";
    }
  }, [value, mode, isBusy, isExecuting, isWaitingInput, isPaused]);

  const submitPrompt = async () => {
    const trimmed = value.trim();
    if (!trimmed || isBusy) return;
    setValue("");
    // Si el back rechaza la tarea (400/500) se devuelve el texto, salvo que ya se haya escrito otra cosa.
    if ((await onRun(trimmed, mode)) === false) setValue((current) => current || trimmed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPrompt();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitPrompt();
    }
  };

  return (
    <section>
      <form
        onSubmit={handleSubmit}
        className={`flex items-end gap-2 w-full bg-slate-900 border border-slate-800 rounded-xl transition-colors focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/20 ${
          isBusy ? "opacity-70" : ""
        }`}
        role="search"
        aria-label="Línea de comando de JARVIS"
      >
        <textarea
          ref={setTextareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder(mode, isExecuting, isWaitingInput, isPaused)}
          aria-label="Instrucción u objetivo para JARVIS"
          disabled={isBusy}
          className="flex-1 min-w-0 resize-none border-0 bg-transparent pl-4 py-3 text-[15px] leading-6 text-slate-100 placeholder:text-slate-500 focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed overflow-hidden"
        />

        <div className="shrink-0 flex items-center gap-1.5 pr-2 pb-2">
          {!isBusy && !value && (
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-950 border border-slate-800 rounded">
              {FOCUS_SHORTCUT_LABEL}
            </kbd>
          )}

          {isBusy ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancelar ejecución actual"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/50 border border-rose-900/60 rounded-md hover:bg-rose-900/40 transition-colors cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancelar</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Ejecutar instrucción"
              title="Ejecutar (Enter · Shift+Enter para nueva línea)"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer bg-accent-500 text-slate-950 hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800"
            >
              <span>Ejecutar</span>
              <CornerDownLeft className="w-3 h-3" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
};

/** Sus props son primitivas o callbacks estables: no se re-renderiza con cada evento SSE (y no pierde lo que se escribe). */
export const PromptInput = memo(PromptInputBase);