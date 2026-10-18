import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, ExternalLink, X, Copy, Check } from "lucide-react";
import type { Scratchpad, Step, MCPTool, TaskMemory, Task } from "../../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../../core/mcp/types.ts";
import { jarvisApi } from "../../services/jarvisApi.ts";
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
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [refContent, setRefContent] = useState<string | null>(null);
  const [isLoadingRef, setIsLoadingRef] = useState<boolean>(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<boolean>(false);

  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleInspectRef = async (refKey: string) => {
    const cleanKey = refKey.replace(/^ref:/, "").trim();
    setSelectedRef(cleanKey);
    setRefContent(null);
    setRefError(null);
    setIsLoadingRef(true);

    try {
      const activeId = taskId || task?.id;
      const res = await jarvisApi.getRef(cleanKey, activeId);
      if (res && res.found) {
        setRefContent(res.content);
      } else {
        setRefError(`No se encontró contenido en RefStore para 'ref:${cleanKey}'.`);
      }
    } catch (err: any) {
      setRefError(err?.message || "Error al consultar la referencia temporal en RefStore.");
    } finally {
      setIsLoadingRef(false);
    }
  };

  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("jarvis_context_inspector_height");
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= MIN_HEIGHT) return parsed;
      }
    } catch {

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

  const tabs = [
    { id: "state" as const, label: "Estado", count: null },
    { id: "memory" as const, label: "Memoria", count: factsCount > 0 ? factsCount : null },
    { id: "scratchpad" as const, label: "Scratchpad", count: scratchpadKeysCount > 0 ? scratchpadKeysCount : null },
    { id: "evidence" as const, label: "Evidencia", count: evidenceCount > 0 ? evidenceCount : null },
    { id: "discovery" as const, label: "Discovery", count: mcpInitStatus === "loading" ? null : totalDiscovered },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex = -1;
    if (e.key === "ArrowRight") {
      targetIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      targetIndex = 0;
    } else if (e.key === "End") {
      targetIndex = tabs.length - 1;
    }
    if (targetIndex !== -1) {
      e.preventDefault();
      const nextTab = tabs[targetIndex];
      setActiveTab(nextTab.id);
      tabButtonRefs.current[nextTab.id]?.focus();
    }
  };

  return (
    <footer className="relative mt-auto border-t border-slate-800 bg-slate-950/90 text-xs">
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
            className={`w-14 h-1 rounded-full transition-all duration-150 ${isDragging
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
            className="flex items-center gap-1.5 text-slate-300 hover:text-white font-mono font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 rounded px-1"
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
            <div className="flex items-center gap-1" role="tablist" aria-label="Pestañas de inspección de contexto">
              {tabs.map((t, idx) => {
                const isSelected = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabButtonRefs.current[t.id] = el;
                    }}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-controls={`tabpanel-${t.id}`}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setActiveTab(t.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    className={`px-2.5 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 ${
                      isSelected
                        ? "bg-slate-800 text-white font-medium shadow-xs"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>{t.label}</span>
                    {t.id === "discovery" && mcpInitStatus === "loading" && (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-400 ml-0.5" />
                    )}
                    {t.count !== null && t.count > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono">({t.count})</span>
                    )}
                    {t.id === "discovery" && unavailableCount > 0 && mcpInitStatus !== "loading" && (
                      <span className="text-[9px] px-1 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 font-mono">
                        {unavailableCount}!
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-2.5 text-slate-500 font-mono text-[10px]">
          <span>MAX_STEPS=15</span>
          <span aria-hidden="true">·</span>
          <span>PROG_MEM=2→5→10</span>
          <span aria-hidden="true">·</span>
          <span>MAX_REPLANS=2</span>
        </div>
      </div>

      {isOpen && (
        <div
          id="context-inspector-panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          style={{ height: `${height}px` }}
          className="px-6 py-3 border-t border-slate-800/80 overflow-y-auto select-text flex flex-col"
        >
          {/* Visor de RefStore compartido elevado a nivel contenedor */}
          {selectedRef && (
            <div className="mb-3 p-3 bg-slate-900 border border-sky-800/80 rounded-lg shadow-lg flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <div className="flex items-center gap-1.5 text-sky-300 font-semibold text-xs font-mono">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Contenido íntegro en RefStore: ref:{selectedRef}</span>
                </div>
                <div className="flex items-center gap-2">
                  {refContent && (
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(refContent);
                        setCopiedRef(true);
                        setTimeout(() => setCopiedRef(false), 2000);
                      }}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-950 border border-slate-800 transition-colors cursor-pointer"
                    >
                      {copiedRef ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedRef ? "Copiado" : "Copiar"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedRef(null)}
                    className="text-slate-400 hover:text-white transition-colors cursor-pointer p-0.5"
                    aria-label="Cerrar visor de referencia"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {isLoadingRef && (
                <div className="flex items-center gap-2 text-slate-400 text-xs py-2 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  <span>Cargando contenido desde el servidor...</span>
                </div>
              )}
              {refError && (
                <div className="text-rose-400 text-xs py-1 font-mono">{refError}</div>
              )}
              {refContent && (
                <pre className="max-h-48 overflow-y-auto p-2 bg-slate-950 rounded border border-slate-800 text-[11px] text-slate-200 whitespace-pre-wrap break-all font-mono leading-relaxed select-text">
                  {refContent}
                </pre>
              )}
            </div>
          )}

          <div className="flex-1">
            {activeTab === "state" && (
              <SessionStateView
                task={task}
                scratchpad={scratchpad}
                memory={memory}
                steps={steps}
              />
            )}
            {activeTab === "memory" && (
              <MemoryView
                memory={memory}
                steps={steps}
                taskId={taskId}
                onInspectRef={handleInspectRef}
              />
            )}
            {activeTab === "scratchpad" && <ScratchpadView scratchpad={scratchpad} />}
            {activeTab === "evidence" && (
              <EvidenceView
                steps={steps}
                onInspectRef={handleInspectRef}
              />
            )}
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
        </div>
      )}
    </footer>
  );
};
