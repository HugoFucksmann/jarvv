import React from "react";
import { Settings } from "lucide-react";
import type { ExecutionMode } from "../../types/ui.ts";
import type { TaskSummary } from "../../types/api.ts";
import { BrandWordmark } from "./components/BrandWordmark.tsx";
import { SystemStatus, type SystemStatusProps } from "./components/SystemStatus.tsx";
import { ModeSelector } from "./components/ModeSelector.tsx";
import { HistoryMenu } from "./components/HistoryMenu.tsx";

interface TopBarProps extends SystemStatusProps {
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  onOpenSettings: () => void;
  tasks: TaskSummary[];
  activeTaskId?: string | null;
  onSelectTask: (taskId: string) => void;
}

/*
 * z-40: la barra crea su propio contexto de apilamiento (relative + z-index + backdrop-blur), y los
 * menús desplegables (historial, servidores MCP caídos) viven dentro de él: por mucho z-index que
 * tengan, nunca pueden quedar por encima de algo que esté fuera. El cabezal fijo de <main> usa z-30,
 * así que la barra necesita un z-index mayor. Los modales (z-50) siguen por encima de ambos.
 */
export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  onOpenSettings,
  tasks,
  activeTaskId,
  onSelectTask,
  ...status
}) => (
  <header className="relative z-40 flex items-center justify-between px-6 2xl:px-10 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md shrink-0">
    {/* Zona 1: marca e historial de la sesión */}
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
        title="Configuración de servicios y endpoints"
        aria-label="Abrir configuración de servicios"
        className="p-1.5 text-slate-400 hover:text-accent-400 hover:bg-slate-900 rounded-md transition-colors cursor-pointer border border-transparent hover:border-slate-800"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  </header>
);