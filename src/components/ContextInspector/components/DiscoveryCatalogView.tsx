import React from "react";
import { MCPTool } from "../../../core/types.ts";
import { MCPPrompt, MCPResourceTemplate } from "../../../core/mcp/types.ts";

interface DiscoveryCatalogViewProps {
  discoveredTools: Record<string, MCPTool[]>;
  extraCapabilities?: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
}

export const DiscoveryCatalogView: React.FC<DiscoveryCatalogViewProps> = ({
  discoveredTools,
  extraCapabilities,
}) => {
  return (
    <div className="flex flex-col gap-5 text-xs">
      {/* 1. Tools discovered */}
      <div className="flex flex-col gap-4">
        {Object.entries(discoveredTools).map(([serverName, tools]) => (
          <div key={serverName} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-mono font-semibold text-slate-300">
              <span className="text-sky-400 font-bold uppercase">{serverName}</span>
              <span className="text-slate-500 font-normal">({tools.length} tools descubiertas vía tools/list)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {tools.map((t) => (
                <div
                  key={t.name}
                  className="p-2.5 bg-slate-900/50 border border-slate-800/80 rounded"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-slate-200 font-semibold">{t.name}</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {(t.inputSchema.required as string[])?.length || 0} req
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px] line-clamp-2 mt-1">
                    {t.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 2. Resource Templates discovered (free-search-mcp cache://) */}
      {extraCapabilities?.resourceTemplates && Object.keys(extraCapabilities.resourceTemplates).length > 0 && (
        <div className="pt-3 border-t border-slate-800">
          <div className="font-mono font-semibold text-slate-300 mb-2">
            <span className="text-indigo-400 font-bold">RESOURCE TEMPLATES</span>
            <span className="text-slate-500 font-normal ml-2">(resources/templates/list)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(extraCapabilities.resourceTemplates).flatMap(([mcpName, templates]) =>
              templates.map((tpl) => (
                <div key={tpl.uriTemplate} className="p-2 bg-slate-900/40 border border-slate-800/80 rounded font-mono text-[11px]">
                  <div className="text-indigo-300 font-medium">{tpl.uriTemplate}</div>
                  <div className="text-slate-400 text-[10px]">{tpl.name} — {tpl.description}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. Prompts discovered */}
      {extraCapabilities?.prompts && Object.keys(extraCapabilities.prompts).length > 0 && (
        <div className="pt-3 border-t border-slate-800">
          <div className="font-mono font-semibold text-slate-300 mb-2">
            <span className="text-amber-400 font-bold">PROMPTS MCP</span>
            <span className="text-slate-500 font-normal ml-2">(prompts/list)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(extraCapabilities.prompts).flatMap(([mcpName, promptsList]) =>
              promptsList.map((p) => (
                <div key={p.name} className="p-2 bg-slate-900/40 border border-slate-800/80 rounded font-mono text-[11px]">
                  <div className="text-amber-300 font-medium">{p.name}</div>
                  <div className="text-slate-400 text-[10px]">{p.description}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
