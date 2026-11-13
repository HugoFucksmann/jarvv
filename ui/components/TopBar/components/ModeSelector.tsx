import React from "react";
import type { ExecutionMode } from "../../../types/ui.ts";
import { MODE_LABELS } from "../../../utils/taskStatus.ts";

interface ModeSelectorProps {
  mode: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

/** Los modos disponibles son las claves de `MODE_LABELS`, que es exhaustivo sobre los modos del core. */
const MODES = Object.keys(MODE_LABELS) as ExecutionMode[];

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange, disabled = false }) => (
  <div
    className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg"
    role="group"
    aria-label="Selector de modo de ejecución"
  >
    {MODES.map((value) => {
      const selected = mode === value;
      return (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          onClick={() => onChange(value)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${selected
              ? "bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30"
              : "text-slate-400 hover:text-slate-200"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {MODE_LABELS[value]}
        </button>
      );
    })}
  </div>
);