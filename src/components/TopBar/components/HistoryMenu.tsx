import React, { useState, useRef, useEffect } from "react";
import { History, ChevronDown, Check } from "lucide-react";
import type { Task } from "../../../core/types.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";

interface HistoryMenuProps {
  tasks: Task[];
  activeTaskId?: string | null;
  onSelectTask: (taskId: string) => void;
}

export const HistoryMenu: React.FC<HistoryMenuProps> = ({
  tasks,
  activeTaskId,
  onSelectTask,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (tasks.length === 0) return null;

  const getStatusType = (state: Task["state"]) => {
    switch (state) {
      case "RUNNING":
        return "running";
      case "COMPLETED":
        return "completed";
      case "FAILED":
        return "failed";
      case "PARTIAL":
        return "unverified";
      default:
        return "idle";
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Historial de tareas de la sesión"
        aria-label="Abrir historial de tareas"
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded transition-colors cursor-pointer"
      >
        <History className="w-3.5 h-3.5 text-sky-400" />
        <span className="hidden sm:inline">Historial</span>
        <span className="text-[11px] text-slate-500">({tasks.length})</span>
        <ChevronDown className="w-3 h-3 text-slate-500" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-72 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-1 z-50 flex flex-col gap-0.5 text-xs font-mono max-h-64 overflow-y-auto">
          <div className="px-2.5 py-1.5 text-[10px] text-slate-500 font-semibold border-b border-slate-800/80 mb-0.5">
            TAREAS RECIENTES DE LA SESIÓN
          </div>
          {[...tasks].reverse().map((t) => {
            const isSelected = t.id === activeTaskId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelectTask(t.id);
                  setIsOpen(false);
                }}
                className={`flex items-start gap-2 p-2 rounded text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-300 hover:bg-slate-800/50 hover:text-white"
                }`}
              >
                <div className="mt-1">
                  <StatusDot status={getStatusType(t.state)} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-xs font-sans text-slate-200">
                    {t.message}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    <span>{t.mode}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.steps.length} pasos</span>
                    {t.state === "RUNNING" && (
                      <span className="text-sky-400 font-semibold animate-pulse">[En curso]</span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
