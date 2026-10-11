import React, { useState } from "react";
import type { MCPTool } from "../../../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../../../core/mcp/types.ts";
import { jarvisApi } from "../../../services/jarvisApi.ts";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Terminal, Database, Sparkles } from "lucide-react";

interface DiscoveryCatalogViewProps {
  discoveredTools: Record<string, MCPTool[]>;
  extraCapabilities?: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
  unavailableServers?: Record<string, { reason: string; since: number }>;
  onRefreshDiscovery?: () => Promise<void>;
}

export const DiscoveryCatalogView: React.FC<DiscoveryCatalogViewProps> = ({
  discoveredTools,
  extraCapabilities,
  unavailableServers = {},
  onRefreshDiscovery,
}) => {
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [reconnectingServer, setReconnectingServer] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleReconnect = async (serverName: string) => {
    setReconnectingServer(serverName);
    setActionMessage(null);
    try {
      await jarvisApi.reconnectMcpServer(serverName);
      setActionMessage(`Servidor '${serverName}' reconectado con éxito.`);
      if (onRefreshDiscovery) {
        await onRefreshDiscovery();
      }
    } catch (err: any) {
      setActionMessage(`Fallo al reconectar '${serverName}': ${err.message}`);
    } finally {
      setReconnectingServer(null);
    }
  };

  const unavailableEntries = Object.entries(unavailableServers);
  const toolServers = Object.entries(discoveredTools);

  return (
    <div className="flex flex-col gap-5 text-xs">
      {/* 1. Alerta de Servidores MCP No Disponibles (INT-03) */}
      {unavailableEntries.length > 0 && (
        <div className="flex flex-col gap-2 p-3 bg-amber-950/40 border border-amber-900/60 rounded-lg text-amber-200">
          <div className="flex items-center gap-2 font-mono font-semibold text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>SERVIDORES MCP NO DISPONIBLES ({unavailableEntries.length})</span>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            {unavailableEntries.map(([serverName, info]) => (
              <div
                key={serverName}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-slate-950/60 rounded border border-amber-900/40 text-[11px] font-mono"
              >
                <div className="flex flex-col">
                  <span className="text-amber-300 font-bold uppercase">{serverName}</span>
                  <span className="text-amber-200/80">{info.reason}</span>
                </div>
                <button
                  type="button"
                  disabled={reconnectingServer === serverName}
                  onClick={() => handleReconnect(serverName)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-sans text-amber-200 bg-amber-900/50 hover:bg-amber-900/80 border border-amber-800 rounded transition-colors cursor-pointer self-start sm:self-center disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${reconnectingServer === serverName ? "animate-spin" : ""}`} />
                  <span>Reconectar</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="p-2 bg-slate-900 border border-slate-800 rounded text-[11px] text-sky-300 font-mono flex items-center justify-between">
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-slate-500 hover:text-slate-300 text-xs ml-2 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* 2. Herramientas Descubiertas por Servidor */}
      <div className="flex flex-col gap-4">
        {toolServers.length === 0 ? (
          <div className="py-6 text-center text-slate-500 font-mono">
            No se han descubierto herramientas todavía. Compruebe la configuración de servidores stdio.
          </div>
        ) : (
          toolServers.map(([serverName, tools]) => (
            <div key={serverName} className="flex flex-col gap-2">
              <div className="flex items-center justify-between font-mono text-slate-300 border-b border-slate-800/80 pb-1.5">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-sky-400 font-bold uppercase">{serverName}</span>
                  <span className="text-slate-500 font-normal">
                    ({tools.length} tool{tools.length === 1 ? "" : "s"} vía tools/list)
                  </span>
                </div>
                <button
                  type="button"
                  disabled={reconnectingServer === serverName}
                  onClick={() => handleReconnect(serverName)}
                  title="Reconectar y refrescar este servidor"
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${reconnectingServer === serverName ? "animate-spin" : ""}`} />
                  <span>Reconectar</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {tools.map((t) => {
                  const reqCount = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required.length : 0;
                  const isSelected = selectedTool?.name === t.name;

                  return (
                    <div
                      key={t.name}
                      onClick={() => setSelectedTool(isSelected ? null : t)}
                      className={`p-2.5 bg-slate-900/50 border rounded transition-colors cursor-pointer ${
                        isSelected
                          ? "border-sky-500 bg-slate-900/80"
                          : "border-slate-800/80 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-slate-200 font-semibold">{t.name}</span>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                          <span>{reqCount} req</span>
                          {isSelected ? (
                            <ChevronDown className="w-3 h-3 text-sky-400" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-slate-600" />
                          )}
                        </div>
                      </div>
                      <div className="text-slate-400 text-[11px] line-clamp-2 mt-1">
                        {t.description}
                      </div>

                      {/* Detalle interactivo de inputSchema (INT-06) */}
                      {isSelected && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800 text-[11px] font-mono flex flex-col gap-1.5 text-slate-300">
                          <span className="text-slate-500 font-semibold text-[10px]">PARÁMETROS ACEPTADOS:</span>
                          <pre className="p-2 bg-slate-950 rounded text-[10px] text-sky-200 overflow-x-auto max-h-36">
                            {JSON.stringify(t.inputSchema || {}, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 3. Resource Templates descubiertos (INT-06) */}
      {extraCapabilities?.resourceTemplates && Object.keys(extraCapabilities.resourceTemplates).length > 0 && (
        <div className="pt-3 border-t border-slate-800">
          <div className="flex items-center gap-2 font-mono font-semibold text-slate-300 mb-2">
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-indigo-400 font-bold">RESOURCE TEMPLATES</span>
            <span className="text-slate-500 font-normal ml-1">(resources/templates/list)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(extraCapabilities.resourceTemplates).flatMap(([mcpName, templates]) =>
              templates.map((tpl) => (
                <div
                  key={`${mcpName}:${tpl.uriTemplate}`}
                  className="p-2 bg-slate-900/40 border border-slate-800/80 rounded font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-indigo-300 font-medium">{tpl.uriTemplate}</span>
                    <span className="text-[10px] text-slate-500 uppercase">{mcpName}</span>
                  </div>
                  <div className="text-slate-400 text-[10px] mt-0.5">
                    {tpl.name ? `${tpl.name} — ` : ""}
                    {tpl.description || "Plantilla URI disponible"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 4. Prompts MCP descubiertos */}
      {extraCapabilities?.prompts && Object.keys(extraCapabilities.prompts).length > 0 && (
        <div className="pt-3 border-t border-slate-800">
          <div className="flex items-center gap-2 font-mono font-semibold text-slate-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 font-bold">PROMPTS MCP</span>
            <span className="text-slate-500 font-normal ml-1">(prompts/list)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(extraCapabilities.prompts).flatMap(([mcpName, promptsList]) =>
              promptsList.map((p) => (
                <div
                  key={`${mcpName}:${p.name}`}
                  className="p-2 bg-slate-900/40 border border-slate-800/80 rounded font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300 font-medium">{p.name}</span>
                    <span className="text-[10px] text-slate-500 uppercase">{mcpName}</span>
                  </div>
                  <div className="text-slate-400 text-[10px] mt-0.5">{p.description}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
