import React from "react";
import { Settings } from "lucide-react";
import { BrandWordmark } from "./components/BrandWordmark.tsx";
import { SystemStatus } from "./components/SystemStatus.tsx";
import { ModeSelector } from "./components/ModeSelector.tsx";

interface TopBarProps {
  mode: "NORMAL" | "PLAN";
  onModeChange: (mode: "NORMAL" | "PLAN") => void;
  onOpenSettings: () => void;
  isExecuting: boolean;
  mcpCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  onOpenSettings,
  isExecuting,
  mcpCount,
}) => {
  return (
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md shrink-0">
      {/* Zone 1: Brand Wordmark */}
      <BrandWordmark />

      {/* Zone 2: System Status */}
      <SystemStatus isExecuting={isExecuting} mcpCount={mcpCount} />

      {/* Zone 3: Mode Selector & Settings */}
      <div className="flex items-center gap-3">
        <ModeSelector mode={mode} onChange={onModeChange} disabled={isExecuting} />
        <button
          type="button"
          onClick={onOpenSettings}
          title="Configuración de endpoints (Qwen 3.5 9B, Decision 2.0, MCPs)"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer border border-transparent hover:border-slate-800"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
