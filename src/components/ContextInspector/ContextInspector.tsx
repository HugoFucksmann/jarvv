import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Scratchpad, Step, MCPTool, TaskMemory } from "../../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../../core/mcp/types.ts";
import { ScratchpadView } from "./components/ScratchpadView.tsx";
import { EvidenceView } from "./components/EvidenceView.tsx";
import { DiscoveryCatalogView } from "./components/DiscoveryCatalogView.tsx";
import { MemoryView } from "./components/MemoryView.tsx";

interface ContextInspectorProps {
  scratchpad: Scratchpad;
  steps: Step[];
  discoveredTools: Record<string, MCPTool[]>;
  memory?: TaskMemory;
  extraCapabilities?: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
  unavailableServers?: Record<string, { reason: string; since: number }>;
  onRefreshDiscovery?: () => Promise<void>;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  scratchpad,
  steps,
  discoveredTools,
  memory,
  extraCapabilities,
  unavailableServers = {},
  onRefreshDiscovery,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"scratchpad" | "evidence" | "discovery" | "memory">("memory");

  const totalDiscovered = Object.values(discoveredTools).reduce((acc, t) => acc + t.length, 0);
  const unavailableCount = Object.keys(unavailableServers).length;

  return (
    <footer className="mt-auto border-t border-slate-800 bg-slate-950/90 text-xs">
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-4">
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
                aria-selected={activeTab === "memory"}
                onClick={() => setActiveTab("memory")}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === "memory"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Memoria v2.1
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "scratchpad"}
                onClick={() => setActiveTab("scratchpad")}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === "scratchpad"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Scratchpad
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "evidence"}
                onClick={() => setActiveTab("evidence")}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === "evidence"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Evidencia
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "discovery"}
                onClick={() => setActiveTab("discovery")}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "discovery"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Discovery ({totalDiscovered})</span>
                {unavailableCount > 0 && (
                  <span className="text-[10px] px-1 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
                    {unavailableCount} caído{unavailableCount > 1 ? "s" : ""}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 text-slate-500 font-mono text-[11px]">
          <span>MAX_STEPS=15</span>
          <span aria-hidden="true">·</span>
          <span>MAX_CALLS_STEP=4</span>
          <span aria-hidden="true">·</span>
          <span>MAX_RETRIES=2</span>
          <span aria-hidden="true">·</span>
          <span>MAX_REPLANS=2</span>
        </div>
      </div>

      {isOpen && (
        <div id="context-inspector-panel" className="px-6 py-4 border-t border-slate-800/80 max-h-64 overflow-y-auto">
          {activeTab === "memory" && <MemoryView memory={memory} />}
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
