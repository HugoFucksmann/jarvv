import React, { useState, useEffect } from "react";
import { Settings, X, Check, Terminal, Loader2, AlertCircle, Cpu, Timer } from "lucide-react";
import type { JarvisConfig } from "../../core/config.ts";
import { jarvisApi } from "../../services/jarvisApi.ts";

const INITIAL_CONFIG: JarvisConfig = {
  qwenUrl: "http://127.0.0.1:11434",
  qwenModel: "qwen3.5:9b",
  thinking: false,
  decisionUrl: "http://127.0.0.1:8765",
  windowsMcp: {
    command: "uvx",
    args: ["windows-mcp", "serve"],
  },
  desktopCommanderMcp: {
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
  },
  freeSearchMcp: {
    command: "uvx",
    args: ["--from", "free-search-mcp==0.13.1", "--with", "selectolax==0.3.34", "free-search-mcp"],
  },
  decisionTimeoutMs: 30000,
  qwenTimeoutMs: 60000,
  mcpTimeoutMs: 30000,
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const [config, setConfig] = useState<JarvisConfig>(INITIAL_CONFIG);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingConfig(true);
      setSaveError(null);
      jarvisApi
        .getConfig()
        .then((backendCfg) => {
          if (backendCfg && typeof backendCfg === "object") {
            setConfig((prev) => ({
              ...prev,
              ...backendCfg,
            }));
          }
        })
        .catch((err) => {
          console.warn("Failed to load config from backend:", err);
          setSaveError("No se pudo cargar la configuración del servidor.");
        })
        .finally(() => {
          setIsLoadingConfig(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await jarvisApi.updateConfig(config);
      setConfig(updated);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onConfigSaved();
        onClose();
      }, 600);
    } catch (err: any) {
      console.error("Error saving config:", err);
      setSaveError(err.message || "Error al guardar la configuración en el servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 text-slate-100 flex flex-col gap-5 max-h-[88vh] overflow-y-auto">
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-sky-400" />
            <h2 id="settings-modal-title" className="text-sm font-semibold tracking-wide">
              Configuración de Servicios Externos
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de configuración"
            className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {saveError && (
          <div className="flex items-center gap-2 p-3 bg-rose-950/60 border border-rose-900/60 rounded-md text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {isLoadingConfig ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Cargando configuración desde el servidor...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-5 text-xs">
            {/* SECCIÓN 1: MODELOS LOCALES */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-slate-200 font-mono font-semibold text-xs border-b border-slate-800/60 pb-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                <span>1. Modelos de Inferencia Local (HTTP)</span>
              </div>

              {/* Qwen 3.5 9B */}
              <div className="flex flex-col gap-2 pl-1">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="cfg-qwen-url" className="font-mono text-slate-300 font-medium">
                      Qwen 3.5 9B URL (Ollama / ngrok / v1):
                    </label>
                    <span className={`font-mono text-[11px] ${config.qwenUrl ? "text-emerald-400" : "text-amber-400"}`}>
                      {config.qwenUrl ? "Configurado" : "Pendiente"}
                    </span>
                  </div>
                  <input
                    id="cfg-qwen-url"
                    type="text"
                    value={config.qwenUrl || ""}
                    onChange={(e) => setConfig({ ...config, qwenUrl: e.target.value })}
                    placeholder="http://127.0.0.1:11434"
                    className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="cfg-qwen-model" className="font-mono text-[11px] text-slate-400">
                    Tag o nombre del modelo:
                  </label>
                  <input
                    id="cfg-qwen-model"
                    type="text"
                    value={config.qwenModel || ""}
                    onChange={(e) => setConfig({ ...config, qwenModel: e.target.value })}
                    placeholder="qwen3.5:9b"
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs text-slate-300 font-medium">
                      Modo Thinking (razonamiento largo):
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {config.thinking ? "Habilitado (think: true)" : "Deshabilitado (modo directo rápido)"}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(config.thinking)}
                    onChange={(e) => setConfig({ ...config, thinking: e.target.checked })}
                    aria-label="Habilitar o deshabilitar modo thinking"
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer bg-slate-950 border-slate-800"
                  />
                </div>
              </div>

              {/* Decision 2.0 */}
              <div className="flex flex-col gap-1 pl-1 pt-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="cfg-decision-url" className="font-mono text-slate-300 font-medium">
                    Decision 2.0 URL (Kai-0.6B / HTTP):
                  </label>
                  <span className={`font-mono text-[11px] ${config.decisionUrl ? "text-emerald-400" : "text-amber-400"}`}>
                    {config.decisionUrl ? "Configurado" : "Pendiente"}
                  </span>
                </div>
                <input
                  id="cfg-decision-url"
                  type="text"
                  value={config.decisionUrl || ""}
                  onChange={(e) => setConfig({ ...config, decisionUrl: e.target.value })}
                  placeholder="http://127.0.0.1:8765"
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
            </div>

            {/* SECCIÓN 2: SERVIDORES MCP STDIO */}
            <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4">
              <div className="flex items-center gap-2 text-slate-200 font-mono font-semibold text-xs border-b border-slate-800/60 pb-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>2. Servidores MCP Locales (stdio)</span>
              </div>

              <div className="grid grid-cols-1 gap-3 pl-1">
                {/* Windows MCP */}
                <div>
                  <label htmlFor="cfg-windows-cmd" className="block text-[11px] font-mono text-slate-300 mb-1">
                    Windows MCP (Comando / Argumentos):
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      id="cfg-windows-cmd"
                      type="text"
                      value={config.windowsMcp?.command || ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          windowsMcp: { ...config.windowsMcp, command: e.target.value },
                        })
                      }
                      placeholder="uvx"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                    <input
                      type="text"
                      value={(config.windowsMcp?.args || []).join(" ")}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          windowsMcp: {
                            ...config.windowsMcp,
                            args: e.target.value.split(" ").filter(Boolean),
                          },
                        })
                      }
                      placeholder="windows-mcp serve"
                      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                </div>

                {/* Desktop Commander MCP */}
                <div>
                  <label htmlFor="cfg-desktop-cmd" className="block text-[11px] font-mono text-slate-300 mb-1">
                    Desktop Commander MCP (Comando / Argumentos):
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      id="cfg-desktop-cmd"
                      type="text"
                      value={config.desktopCommanderMcp?.command || ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          desktopCommanderMcp: { ...config.desktopCommanderMcp, command: e.target.value },
                        })
                      }
                      placeholder="npx"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                    <input
                      type="text"
                      value={(config.desktopCommanderMcp?.args || []).join(" ")}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          desktopCommanderMcp: {
                            ...config.desktopCommanderMcp,
                            args: e.target.value.split(" ").filter(Boolean),
                          },
                        })
                      }
                      placeholder="-y @wonderwhy-er/desktop-commander"
                      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                </div>

                {/* Free Search MCP */}
                <div>
                  <label htmlFor="cfg-search-cmd" className="block text-[11px] font-mono text-slate-300 mb-1">
                    Free Search MCP (Comando / Argumentos):
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      id="cfg-search-cmd"
                      type="text"
                      value={config.freeSearchMcp?.command || ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          freeSearchMcp: { ...config.freeSearchMcp, command: e.target.value },
                        })
                      }
                      placeholder="uvx"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                    <input
                      type="text"
                      value={(config.freeSearchMcp?.args || []).join(" ")}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          freeSearchMcp: {
                            ...config.freeSearchMcp,
                            args: e.target.value.split(" ").filter(Boolean),
                          },
                        })
                      }
                      placeholder="--from free-search-mcp==0.13.1 free-search-mcp"
                      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SECCIÓN 3: LÍMITES Y TIMEOUTS */}
            <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4">
              <div className="flex items-center gap-2 text-slate-200 font-mono font-semibold text-xs border-b border-slate-800/60 pb-1.5">
                <Timer className="w-3.5 h-3.5 text-amber-400" />
                <span>3. Límites Operativos y Timeouts (ms)</span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pl-1">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">Decision 2.0:</label>
                  <input
                    type="number"
                    value={config.decisionTimeoutMs || 30000}
                    onChange={(e) => setConfig({ ...config, decisionTimeoutMs: Number(e.target.value) || 30000 })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">Qwen 3.5 9B:</label>
                  <input
                    type="number"
                    value={config.qwenTimeoutMs || 60000}
                    onChange={(e) => setConfig({ ...config, qwenTimeoutMs: Number(e.target.value) || 60000 })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">MCPs (stdio):</label>
                  <input
                    type="number"
                    value={config.mcpTimeoutMs || 30000}
                    onChange={(e) => setConfig({ ...config, mcpTimeoutMs: Number(e.target.value) || 30000 })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>

            {/* Acciones de pie */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors cursor-pointer shadow-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : saved ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Guardado</span>
                  </>
                ) : (
                  <span>Guardar Configuración</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
