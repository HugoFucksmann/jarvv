import type React from "react";
import { Zap, ListChecks } from "lucide-react";
import type { ExecutionMode } from "../../../types/ui.ts";
import { MODE_LABELS } from "../../../utils/taskStatus.ts";

interface ModeSelectorProps {
  mode: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

/** Los modos disponibles son las claves de `MODE_LABELS`, que es exhaustivo sobre los modos del core. */
const MODES = Object.keys(MODE_LABELS) as ExecutionMode[];

const MODE_ICON: Record<ExecutionMode, React.FC<{ className?: string }>> = {
  reactive: Zap,
  deliberative: ListChecks,
};

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange, disabled = false }) => (
  <div
    className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg"
    role="group"
    aria-label="Selector de modo de ejecución"
  >
    {MODES.map((value) => {
      const selected = mode === value;
      const Icon = MODE_ICON[value];
      const label = MODE_LABELS[value];
      return (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
          className={`flex items-center gap-1.5 px-2 md:px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${selected
              ? "bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30"
              : "text-slate-400 hover:text-slate-200"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">{label}</span>
        </button>
      );
    })}
  </div>
);