import React from "react";
import type { ExecutionMode } from "../../../types/ui.ts";

interface ModeSelectorProps {
  mode: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

const MODE_OPTIONS: ReadonlyArray<{ value: ExecutionMode; label: string }> = [
  { value: "NORMAL", label: "NORMAL (FAST)" },
  { value: "PLAN", label: "PLAN" },
];

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange, disabled = false }) => (
  <div
    className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
    role="group"
    aria-label="Selector de modo de ejecución"
  >
    {MODE_OPTIONS.map(({ value, label }) => (
      <button
        key={value}
        type="button"
        disabled={disabled}
        aria-pressed={mode === value}
        onClick={() => onChange(value)}
        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${mode === value ? "bg-slate-800 text-white shadow-xs" : "text-slate-400 hover:text-slate-200"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {label}
      </button>
    ))}
  </div>
);