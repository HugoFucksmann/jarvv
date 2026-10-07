import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Scratchpad, Step, MCPTool } from "../../core/types.ts";
import { MCPPrompt, MCPResourceTemplate } from "../../core/mcp/types.ts";
import { ScratchpadView } from "./components/ScratchpadView.tsx";
import { EvidenceView } from "./components/EvidenceView.tsx";
import { DiscoveryCatalogView } from "./components/DiscoveryCatalogView.tsx";

interface ContextInspectorProps {
  scratchpad: Scratchpad;
  steps: Step[];
  discoveredTools: Record<string, MCPTool[]>;
  extraCapabilities?: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  scratchpad,
  steps,
  discoveredTools,
  extraCapabilities,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"scratchpad" | "evidence" | "discovery">("scratchpad");

  const totalDiscovered = Object.values(discoveredTools).reduce((acc, t) => acc + t.length, 0);

  return (
    <footer className="mt-auto border-t border-slate-800 bg-slate-950/90 text-xs">
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 text-slate-300 hover:text-white font-mono font-medium transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <span>Inspección de Contexto</span>
          </button>

          {isOpen && (
            <div className="flex items-center gap-1">
              <button
                type="button"
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
                onClick={() => setActiveTab("discovery")}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === "discovery"
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Discovery ({totalDiscovered})
              </button>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 text-slate-500 font-mono text-[11px]">
          <span>Límites: MAX_STEPS=15</span>
          <span aria-hidden="true">·</span>
          <span>MAX_TOOL_CALLS=4</span>
          <span aria-hidden="true">·</span>
          <span>MAX_ARG_RETRIES=1</span>
        </div>
      </div>

      {isOpen && (
        <div className="px-6 py-4 border-t border-slate-800/80 max-h-64 overflow-y-auto">
          {activeTab === "scratchpad" && <ScratchpadView scratchpad={scratchpad} />}
          {activeTab === "evidence" && <EvidenceView steps={steps} />}
          {activeTab === "discovery" && (
            <DiscoveryCatalogView
              discoveredTools={discoveredTools}
              extraCapabilities={extraCapabilities}
            />
          )}
        </div>
      )}
    </footer>
  );
};
