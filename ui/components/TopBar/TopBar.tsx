import React from "react";
import { Settings } from "lucide-react";
import { MODELS } from "../../../src/core/models.ts";
import type { ExecutionMode } from "../../types/ui.ts";
import type { WireTask } from "../../types/api.ts";
import { BrandWordmark } from "./components/BrandWordmark.tsx";
import { SystemStatus, type SystemStatusProps } from "./components/SystemStatus.tsx";
import { ModeSelector } from "./components/ModeSelector.tsx";
import { HistoryMenu } from "./components/HistoryMenu.tsx";

/** Las props del estado del sistema se reenvían tal cual a SystemStatus: se heredan en lugar de redeclararse. */
interface TopBarProps extends SystemStatusProps {
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  onOpenSettings: () => void;
  tasks: WireTask[];
  activeTaskId?: string | null;
  onSelectTask: (taskId: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  onOpenSettings,
  tasks,
  activeTaskId,
  onSelectTask,
  ...status
}) => (
  <header className="relative z-30 flex items-center justify-between px-6 2xl:px-10 py-3 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md shrink-0">
    {/* Zona 1: marca e historial de la sesión (el menú no se muestra sin tareas) */}
    <div className="flex items-center gap-3">
      <BrandWordmark />
      <HistoryMenu tasks={tasks} activeTaskId={activeTaskId} onSelectTask={onSelectTask} />
    </div>

    {/* Zona 2: estado del sistema */}
    <SystemStatus {...status} />

    {/* Zona 3: modo de ejecución y configuración */}
    <div className="flex items-center gap-3">
      <ModeSelector mode={mode} onChange={onModeChange} disabled={status.isExecuting} />
      <button
        type="button"
        onClick={onOpenSettings}
        title={`Configuración de endpoints (${MODELS.QWEN_3_5_9B.name}, Decision 2.0, MCPs)`}
        aria-label="Abrir configuración de servicios"
        className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer border border-transparent hover:border-slate-800"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  </header>
);