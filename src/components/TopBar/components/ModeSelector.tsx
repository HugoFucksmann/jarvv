import React from "react";

interface ModeSelectorProps {
  mode: "NORMAL" | "PLAN";
  onChange: (mode: "NORMAL" | "PLAN") => void;
  disabled?: boolean;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange, disabled }) => {
  return (
    <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-md">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("NORMAL")}
        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
          mode === "NORMAL"
            ? "bg-slate-800 text-white shadow-xs"
            : "text-slate-400 hover:text-slate-200"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        NORMAL
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("PLAN")}
        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
          mode === "PLAN"
            ? "bg-slate-800 text-white shadow-xs"
            : "text-slate-400 hover:text-slate-200"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        PLAN
      </button>
    </div>
  );
};
