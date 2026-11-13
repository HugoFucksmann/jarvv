import React, { useState, useRef, useEffect } from "react";
import { History, ChevronDown, Check } from "lucide-react";
import type { TaskSummary } from "../../../types/api.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { getTaskStatusType, MODE_LABELS } from "../../../utils/taskStatus.ts";

interface HistoryMenuProps {
  tasks: TaskSummary[];
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
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  if (tasks.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        title="Historial de tareas de la sesión"
        aria-label="Abrir historial de tareas"
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer"
      >
        <History className="w-3.5 h-3.5 text-accent-400" />
        <span className="hidden sm:inline">Historial</span>
        <span className="text-xs text-slate-500 tabular-nums">({tasks.length})</span>
        <ChevronDown
          className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-80 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-1 z-50 flex flex-col gap-0.5 text-xs max-h-72 overflow-y-auto">
          <div className="px-2.5 py-1.5 text-[11px] text-slate-500 font-semibold tracking-wide border-b border-slate-800 mb-0.5">
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
                className={`flex items-start gap-2.5 p-2 rounded-md text-left transition-colors cursor-pointer ${isSelected
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                  }`}
              >
                <div className="mt-1.5">
                  <StatusDot status={getTaskStatusType(t.state)} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-[13px] text-slate-100">{t.request}</span>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <span>{MODE_LABELS[t.mode]}</span>
                    {t.state === "running" && (
                      <span className="text-accent-400 font-semibold animate-pulse">En curso</span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent-400 shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};