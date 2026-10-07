import React, { useState } from "react";
import { Settings, X, Check, Terminal } from "lucide-react";
import { ConfigManager, JarvisConfig } from "../../core/config.ts";

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
  const [config, setConfig] = useState<JarvisConfig>(ConfigManager.getConfig());
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    ConfigManager.updateConfig(config);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onConfigSaved();
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 text-slate-100 flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold tracking-wide">
              Configuración de Servicios Externos
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Los servidores MCP operan mediante <strong>stdio</strong> en su PC (Windows, Desktop Commander, Free Search).
          Decision 2.0 y Qwen 3.5 9B operan mediante endpoints HTTP.
        </p>

        <form onSubmit={handleSave} className="flex flex-col gap-4 text-xs">
          {/* 1. Qwen 3.5 9B URL & Model */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="font-mono font-medium text-slate-300">
                  Qwen 3.5 9B URL (ngrok / HTTP):
                </label>
                <span className={`font-mono text-[11px] ${config.qwenUrl ? "text-emerald-400" : "text-amber-400"}`}>
                  {config.qwenUrl ? "Configurado" : "Pendiente"}
                </span>
              </div>
              <input
                type="text"
                value={config.qwenUrl}
                onChange={(e) => setConfig({ ...config, qwenUrl: e.target.value })}
                placeholder="https://xxxx.ngrok-free.app/v1"
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[11px] text-slate-400">
                Modelo / Tag de Qwen 3.5 9B (opcional):
              </label>
              <input
                type="text"
                value={config.qwenModel || ""}
                onChange={(e) => setConfig({ ...config, qwenModel: e.target.value })}
                placeholder="Nombre o tag exacto del modelo configurado en su PC"
                className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* 2. Decision 2.0 URL (HTTP default 127.0.0.1:8765) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="font-mono font-medium text-slate-300">
                Decision 2.0 URL (HTTP / 127.0.0.1:8765):
              </label>
              <span className={`font-mono text-[11px] ${config.decisionUrl ? "text-emerald-400" : "text-amber-400"}`}>
                {config.decisionUrl ? "Configurado" : "Pendiente"}
              </span>
            </div>
            <input
              type="text"
              value={config.decisionUrl}
              onChange={(e) => setConfig({ ...config, decisionUrl: e.target.value })}
              placeholder="http://127.0.0.1:8765"
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          {/* 3. MCP Stdio Configuration */}
          <div className="border-t border-slate-800/80 pt-3 flex flex-col gap-3">
            <div className="flex items-center gap-1.5 font-mono text-slate-400 font-medium">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>Configuración Stdio de Servidores MCP</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  Windows MCP (Comando & Argumentos):
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input
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
                    placeholder="mcp-windows"
                    className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  Desktop Commander MCP (Comando & Argumentos):
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input
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

              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  Free Search MCP (Comando & Argumentos):
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input
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
                    placeholder="free-search-mcp"
                    className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              Cerrar
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer"
            >
              {saved ? (
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
      </div>
    </div>
  );
};
