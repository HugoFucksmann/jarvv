import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { Scratchpad, Step, MCPTool, TaskMemory, Task } from "../../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../../core/mcp/types.ts";
import { SessionStateView } from "./components/SessionStateView.tsx";
import { ScratchpadView } from "./components/ScratchpadView.tsx";
import { EvidenceView } from "./components/EvidenceView.tsx";
import { DiscoveryCatalogView } from "./components/DiscoveryCatalogView.tsx";
import { MemoryView } from "./components/MemoryView.tsx";

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 130;
const MAX_HEIGHT_RATIO = 0.85;

interface ContextInspectorProps {
  task?: Task | null;
  scratchpad: Scratchpad;
  steps: Step[];
  discoveredTools: Record<string, MCPTool[]>;
  memory?: TaskMemory;
  taskId?: string;
  extraCapabilities?: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
  unavailableServers?: Record<string, { reason: string; since: number }>;
  onRefreshDiscovery?: () => Promise<void>;
  mcpInitStatus?: "loading" | "ready" | "partial" | "error";
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  task = null,
  scratchpad,
  steps,
  discoveredTools,
  memory,
  taskId,
  extraCapabilities,
  unavailableServers = {},
  onRefreshDiscovery,
  mcpInitStatus = "ready",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"state" | "memory" | "scratchpad" | "evidence" | "discovery">("state");
  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("jarvis_context_inspector_height");
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= MIN_HEIGHT) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_HEIGHT;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(DEFAULT_HEIGHT);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      dragStartY.current = e.touches[0].clientY;
      dragStartHeight.current = height;
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Arrastrar hacia arriba (menor clientY) aumenta la altura del inspector inferior
      const deltaY = dragStartY.current - e.clientY;
      const maxHeight = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
      const newHeight = Math.min(Math.max(dragStartHeight.current + deltaY, MIN_HEIGHT), maxHeight);
      setHeight(newHeight);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const deltaY = dragStartY.current - e.touches[0].clientY;
        const maxHeight = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
        const newHeight = Math.min(Math.max(dragStartHeight.current + deltaY, MIN_HEIGHT), maxHeight);
        setHeight(newHeight);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      try {
        setHeight((cur) => {
          localStorage.setItem("jarvis_context_inspector_height", String(cur));
          return cur;
        });
      } catch {
        // ignore
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleEnd);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  const totalDiscovered = Object.values(discoveredTools).reduce((acc, t) => acc + t.length, 0);
  const unavailableCount = Object.keys(unavailableServers).length;

  // Cálculo preciso de datos disponibles en cada pestaña
  const factsCount = Object.keys(memory?.facts || {}).length;
  const effectsCount = (memory?.effects || []).length;
  const failCount = (memory?.fail || []).length;
  const scratchpadKeysCount = Object.keys(scratchpad || {}).length;
  const evidenceCount = steps.reduce((acc, s) => {
    if (s.calls && s.calls.length > 0) {
      return acc + s.calls.filter((c) => c.evidence || c.error).length;
    }
    return acc + (s.evidence ? 1 : 0);
  }, 0);

  return (
    <footer className="relative mt-auto border-t border-slate-800 bg-slate-950/90 text-xs">
      {/* Tirador de redimensionamiento vertical interactivo */}
      {isOpen && (
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onDoubleClick={() => {
            setHeight(DEFAULT_HEIGHT);
            try {
              localStorage.setItem("jarvis_context_inspector_height", String(DEFAULT_HEIGHT));
            } catch {
              // ignore
            }
          }}
          title="Arrastrar hacia arriba o abajo para ajustar altura (Doble clic para restablecer)"
          aria-label="Ajustar altura de inspección de contexto"
          className="absolute -top-1.5 left-0 right-0 h-3.5 flex items-center justify-center cursor-row-resize z-20 group transition-all"
        >
          <div
            className={`w-14 h-1 rounded-full transition-all duration-150 ${
              isDragging
                ? "bg-sky-400 w-20 shadow-[0_0_10px_rgba(56,189,248,0.7)]"
                : "bg-slate-700/80 group-hover:bg-sky-400/90 group-hover:w-16"
            }`}
          />
        </div>
      )}

      <div className="flex items-center justify-between px-6 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-controls="context-inspector-panel"
            className="flex items-center gap-1.5 text-slate-300 hover:text-white font-mono font-medium transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <span>Inspección de Contexto</span>
            {mcpInitStatus === "loading" && (
              <span title="Inicializando servidores MCP…">
                <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-400 ml-0.5" />
              </span>
            )}
            {mcpInitStatus !== "loading" && unavailableCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-0.5" title="Servidores con advertencias" />
            )}
          </button>

          {isOpen && (
            <div className="flex items-center gap-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "state"}
                onClick={() => setActiveTab("state")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  activeTab === "state"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Estado</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "memory"}
                onClick={() => setActiveTab("memory")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  activeTab === "memory"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Memoria</span>
                <span className="text-[10px] text-slate-500 ml-1">
                  ({factsCount > 0 ? `${factsCount}h` : "0"}{effectsCount > 0 ? `·${effectsCount}e` : ""}{failCount > 0 ? `·${failCount}f` : ""})
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "scratchpad"}
                onClick={() => setActiveTab("scratchpad")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  activeTab === "scratchpad"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Scratchpad</span>
                {scratchpadKeysCount > 0 && (
                  <span className="text-[10px] text-slate-500 ml-1">({scratchpadKeysCount})</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "evidence"}
                onClick={() => setActiveTab("evidence")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  activeTab === "evidence"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Evidencia</span>
                {evidenceCount > 0 && (
                  <span className="text-[10px] text-slate-500 ml-1">({evidenceCount})</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "discovery"}
                onClick={() => setActiveTab("discovery")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  activeTab === "discovery"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Discovery</span>
                {mcpInitStatus === "loading" ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-400 ml-0.5" />
                ) : (
                  <span className="text-[10px] text-slate-500 ml-0.5">({totalDiscovered})</span>
                )}
                {unavailableCount > 0 && mcpInitStatus !== "loading" && (
                  <span className="text-[9px] px-1 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
                    {unavailableCount}!
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-2.5 text-slate-500 font-mono text-[10px]">
          <span>MAX_STEPS=15</span>
          <span aria-hidden="true">·</span>
          <span>PROG_MEM=2→5→10</span>
          <span aria-hidden="true">·</span>
          <span>MAX_RETRIES=2</span>
          <span aria-hidden="true">·</span>
          <span>MAX_REPLANS=2</span>
        </div>
      </div>

      {isOpen && (
        <div
          id="context-inspector-panel"
          style={{ height: `${height}px` }}
          className="px-6 py-3 border-t border-slate-800/80 overflow-y-auto select-text"
        >
          {activeTab === "state" && (
            <SessionStateView
              task={task}
              scratchpad={scratchpad}
              memory={memory}
              steps={steps}
            />
          )}
          {activeTab === "memory" && <MemoryView memory={memory} steps={steps} taskId={taskId} />}
          {activeTab === "scratchpad" && <ScratchpadView scratchpad={scratchpad} />}
          {activeTab === "evidence" && <EvidenceView steps={steps} />}
          {activeTab === "discovery" && (
            <DiscoveryCatalogView
              discoveredTools={discoveredTools}
              extraCapabilities={extraCapabilities}
              unavailableServers={unavailableServers}
              onRefreshDiscovery={onRefreshDiscovery}
              mcpInitStatus={mcpInitStatus}
            />
          )}
        </div>
      )}
    </footer>
  );
};
