import React from "react";
import { Settings } from "lucide-react";
import { BrandWordmark } from "./components/BrandWordmark.tsx";
import { SystemStatus } from "./components/SystemStatus.tsx";
import { ModeSelector } from "./components/ModeSelector.tsx";
import { HistoryMenu } from "./components/HistoryMenu.tsx";
import type { Task } from "../../core/types.ts";

interface TopBarProps {
  mode: "NORMAL" | "PLAN";
  onModeChange: (mode: "NORMAL" | "PLAN") => void;
  onOpenSettings: () => void;
  isExecuting: boolean;
  mcpCount: number;
  unavailableCount?: number;
  tasks?: Task[];
  activeTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  onOpenSettings,
  isExecuting,
  mcpCount,
  unavailableCount = 0,
  tasks = [],
  activeTaskId,
  onSelectTask,
}) => {
  return (
    <header className="relative z-30 flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md shrink-0">
      {/* Zone 1: Brand Wordmark & Session History */}
      <div className="flex items-center gap-3">
        <BrandWordmark />
        {tasks.length > 1 && onSelectTask && (
          <HistoryMenu
            tasks={tasks}
            activeTaskId={activeTaskId}
            onSelectTask={onSelectTask}
          />
        )}
      </div>

      {/* Zone 2: System Status */}
      <SystemStatus
        isExecuting={isExecuting}
        mcpCount={mcpCount}
        unavailableCount={unavailableCount}
      />

      {/* Zone 3: Mode Selector & Settings */}
      <div className="flex items-center gap-3">
        <ModeSelector mode={mode} onChange={onModeChange} disabled={isExecuting} />
        <button
          type="button"
          onClick={onOpenSettings}
          title="Configuración de endpoints (Qwen 3.5 9B, Decision 2.0, MCPs)"
          aria-label="Abrir configuración de servicios"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer border border-transparent hover:border-slate-800"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
