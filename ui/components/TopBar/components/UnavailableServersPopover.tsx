import React, { useRef, useEffect } from "react";
import { AlertTriangle, X, Clock, Server } from "lucide-react";
import type { UnavailableServers } from "../../../types/api.ts";

interface UnavailableServersPopoverProps {
  unavailableServers: UnavailableServers;
  isOpen: boolean;
  onClose: () => void;
}

export const UnavailableServersPopover: React.FC<UnavailableServersPopoverProps> = ({
  unavailableServers,
  isOpen,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const entries = Object.entries(unavailableServers);

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-4 z-50 flex flex-col gap-3 text-xs"
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2 text-slate-100 font-semibold text-[13px]">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          <span>Servidores MCP no disponibles ({entries.length})</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar lista de servidores"
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-slate-400 italic py-2">
            Todos los servidores configurados respondieron correctamente.
          </p>
        ) : (
          entries.map(([name, info]) => (
            <div
              key={name}
              className="flex flex-col gap-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-yellow-300 font-mono">
                  <Server className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                  <span>{name}</span>
                </span>
                {info.since && (
                  <span className="text-[11px] text-slate-500 flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(info.since).toLocaleTimeString()}</span>
                  </span>
                )}
              </div>
              <p className="text-slate-300 leading-relaxed text-xs mt-0.5">
                {info.reason || "Fallo de comunicación stdio o proceso cerrado inesperadamente."}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500">
        Revise la configuración de comandos en Ajustes o reinicie el servidor de backend.
      </div>
    </div>
  );
};