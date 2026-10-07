import React, { useState } from "react";
import { CornerDownLeft, XCircle } from "lucide-react";

interface PromptInputProps {
  onRun: (prompt: string) => void;
  onCancel: () => void;
  isExecuting: boolean;
  mode: "NORMAL" | "PLAN";
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onRun,
  onCancel,
  isExecuting,
  mode,
}) => {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isExecuting) return;
    onRun(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          mode === "PLAN"
            ? "Describe una tarea compleja para generar y revisar el plan paso a paso..."
            : "Instrucción u objetivo para JARVIS (ej: buscar documentación, inspeccionar UI o crear archivo)..."
        }
        disabled={isExecuting}
        className="w-full pl-4 pr-24 py-3 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-700 transition-colors disabled:opacity-60"
      />

      <div className="absolute right-2 flex items-center gap-1.5">
        {isExecuting ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 bg-rose-950/60 border border-rose-900/60 rounded-md hover:bg-rose-900/40 transition-colors cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Cancelar</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Ejecutar</span>
            <CornerDownLeft className="w-3 h-3 text-slate-400" />
          </button>
        )}
      </div>
    </form>
  );
};
