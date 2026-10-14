import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Scratchpad, Step, MCPTool, TaskMemory, Task } from "../../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../../core/mcp/types.ts";
import { SessionStateView } from "./components/SessionStateView.tsx";
import { ScratchpadView } from "./components/ScratchpadView.tsx";
import { EvidenceView } from "./components/EvidenceView.tsx";
import { DiscoveryCatalogView } from "./components/DiscoveryCatalogView.tsx";
import { MemoryView } from "./components/MemoryView.tsx";

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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"state" | "memory" | "scratchpad" | "evidence" | "discovery">("state");

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
    <footer className="mt-auto border-t border-slate-800 bg-slate-950/90 text-xs">
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
            {unavailableCount > 0 && (
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
                <span className="text-[10px] text-slate-500 ml-0.5">({totalDiscovered})</span>
                {unavailableCount > 0 && (
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
        <div id="context-inspector-panel" className="px-6 py-3 border-t border-slate-800/80 max-h-64 overflow-y-auto">
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
            />
          )}
        </div>
      )}
    </footer>
  );
};
