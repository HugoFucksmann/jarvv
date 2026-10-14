import React, { useState } from "react";
import { CornerDownLeft, XCircle } from "lucide-react";

interface PromptInputProps {
  onRun: (prompt: string) => void;
  onCancel: () => void;
  isExecuting: boolean;
  mode: "NORMAL" | "PLAN";
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onRun,
  onCancel,
  isExecuting,
  mode,
  inputRef,
}) => {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isExecuting) return;
    setValue("");
    onRun(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center w-full" role="search" aria-label="Línea de comando de JARVIS">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          mode === "PLAN"
            ? "Describe una tarea compleja en modo PLAN (Ctrl+K para enfocar)..."
            : "Instrucción u objetivo para JARVIS (Ctrl+K para enfocar)..."
        }
        aria-label="Instrucción u objetivo para JARVIS"
        disabled={isExecuting}
        className="w-full pl-4 pr-32 py-3 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-700 transition-colors disabled:opacity-60"
      />

      <div className="absolute right-2 flex items-center gap-1.5">
        {!isExecuting && !value && (
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-950/80 border border-slate-800 rounded">
            ⌘K
          </kbd>
        )}

        {isExecuting ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar ejecución actual"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 bg-rose-950/60 border border-rose-900/60 rounded-md hover:bg-rose-900/40 transition-colors cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Cancelar</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Ejecutar instrucción"
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
          >
            <span>Ejecutar</span>
            <CornerDownLeft className="w-3 h-3 text-slate-400" />
          </button>
        )}
      </div>
    </form>
  );
};
