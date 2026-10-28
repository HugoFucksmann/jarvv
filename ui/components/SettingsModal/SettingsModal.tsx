import React, { useState, useEffect, useRef, useCallback } from "react";
import { Settings, X, Check, Terminal, Loader2, AlertCircle, Cpu, Timer } from "lucide-react";
import type { JarvisConfig } from "../../../src/core/config.ts";
import { jarvisApi } from "../../services/jarvisApi.ts";
import { MODELS } from "../../../src/core/models.ts";

interface SettingsModalProps {
  onClose: () => void;
  onConfigSaved: () => void;
}

type McpKey = "desktopCommanderMcp" | "freeSearchMcp";
type McpPatch = { command?: string; args?: string[] };

const SAVED_FEEDBACK_MS = 600;

const parseArgs = (text: string): string[] => text.split(" ").filter(Boolean);

// ---------------------------------------------------------------------------
// Campos reutilizables
// ---------------------------------------------------------------------------

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-slate-200 font-mono font-semibold text-xs border-b border-slate-800/60 pb-1.5">
    {icon}
    <span>{children}</span>
  </div>
);

interface UrlFieldProps {
  id: string;
  label: string;
  value?: string;
  placeholder: string;
  onChange: (value: string) => void;
}

const UrlField: React.FC<UrlFieldProps> = ({ id, label, value, placeholder, onChange }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="font-mono text-slate-300 font-medium">
        {label}
      </label>
      <span className={`font-mono text-[11px] ${value ? "text-emerald-400" : "text-amber-400"}`}>
        {value ? "Configurado" : "Pendiente"}
      </span>
    </div>
    <input
      id={id}
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
    />
  </div>
);

interface NumberFieldProps {
  id: string;
  label: string;
  value?: number;
  fallback: number;
  onChange: (value: number) => void;
}

const NumberField: React.FC<NumberFieldProps> = ({ id, label, value, fallback, onChange }) => (
  <div>
    <label htmlFor={id} className="block text-[10px] font-mono text-slate-400 mb-1">
      {label}
    </label>
    <input
      id={id}
      type="number"
      value={value || fallback}
      onChange={(e) => onChange(Number(e.target.value) || fallback)}
      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
    />
  </div>
);

/**
 * Argumentos separados por espacios. Mantiene el texto tal como se escribe: si se derivara directamente del
 * array, el espacio final se descartaría al instante y no se podrían tipear varios argumentos.
 */
const ArgsInput: React.FC<{
  args?: string[];
  placeholder: string;
  ariaLabel: string;
  onChange: (args: string[]) => void;
}> = ({ args, placeholder, ariaLabel, onChange }) => {
  const external = (args || []).join(" ");
  const [text, setText] = useState(external);

  // Re-sincroniza solo cuando el valor externo cambia por otra vía (p. ej. tras guardar)
  useEffect(() => {
    setText((current) => (parseArgs(current).join(" ") === external ? current : external));
  }, [external]);

  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseArgs(e.target.value));
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
    />
  );
};

interface McpCommandFieldProps {
  id: string;
  label: string;
  value?: { command?: string; args?: string[] };
  commandPlaceholder: string;
  argsPlaceholder: string;
  onChange: (patch: McpPatch) => void;
}

const McpCommandField: React.FC<McpCommandFieldProps> = ({
  id,
  label,
  value,
  commandPlaceholder,
  argsPlaceholder,
  onChange,
}) => (
  <div>
    <label htmlFor={id} className="block text-[11px] font-mono text-slate-300 mb-1">
      {label}
    </label>
    <div className="grid grid-cols-3 gap-2">
      <input
        id={id}
        type="text"
        value={value?.command || ""}
        onChange={(e) => onChange({ command: e.target.value })}
        placeholder={commandPlaceholder}
        className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 font-mono text-[11px]"
      />
      <ArgsInput
        args={value?.args}
        placeholder={argsPlaceholder}
        ariaLabel={`${label} argumentos`}
        onChange={(args) => onChange({ args })}
      />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onConfigSaved }) => {
  // La configuración vigente vive en el backend: no se duplican sus valores por defecto en el cliente.
  const [config, setConfig] = useState<JarvisConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const backendCfg = await jarvisApi.getConfig();
      if (backendCfg && typeof backendCfg === "object") {
        setConfig(backendCfg);
      } else {
        setError("El servidor devolvió una configuración inválida.");
      }
    } catch (err) {
      console.warn("Failed to load config from backend:", err);
      setError("No se pudo cargar la configuración del servidor.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    return () => clearTimeout(closeTimerRef.current);
  }, [loadConfig]);

  const update = (patch: Partial<JarvisConfig>) =>
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));

  const updateMcp = (key: McpKey, patch: McpPatch) =>
    setConfig((prev) => (prev ? ({ ...prev, [key]: { ...prev[key], ...patch } } as JarvisConfig) : prev));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setIsSaving(true);
    setError(null);

    try {
      const updated = await jarvisApi.updateConfig(config);
      setConfig(updated);
      setSaved(true);
      // Se refresca el catálogo de inmediato; el cierre espera solo para mostrar "Guardado"
      onConfigSaved();
      closeTimerRef.current = setTimeout(onClose, SAVED_FEEDBACK_MS);
    } catch (err) {
      console.error("Error saving config:", err);
      setError(err instanceof Error && err.message ? err.message : "Error al guardar la configuración en el servidor.");
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

        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-950/60 border border-rose-900/60 rounded-md text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="flex-1">{error}</span>
            {!config && !isLoading && (
              <button
                type="button"
                onClick={() => void loadConfig()}
                className="px-2.5 py-1 text-[11px] font-medium text-rose-200 bg-rose-900/50 hover:bg-rose-900/80 border border-rose-800/60 rounded transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Cargando configuración desde el servidor...</span>
          </div>
        ) : config ? (
          <form onSubmit={handleSave} className="flex flex-col gap-5 text-xs">
            {/* SECCIÓN 1: MODELOS LOCALES */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Cpu className="w-3.5 h-3.5 text-sky-400" />}>
                1. Modelos de Inferencia Local (HTTP)
              </SectionTitle>

              {/* Qwen 3.5 9B */}
              <div className="flex flex-col gap-2 pl-1">
                <UrlField
                  id="cfg-qwen-url"
                  label="Qwen 3.5 9B URL (Ollama / ngrok / v1):"
                  value={config.qwenUrl}
                  placeholder="http://127.0.0.1:11434"
                  onChange={(qwenUrl) => update({ qwenUrl })}
                />

                <div className="flex flex-col gap-1">
                  <label htmlFor="cfg-qwen-model" className="font-mono text-[11px] text-slate-400">
                    Tag o nombre del modelo:
                  </label>
                  <input
                    id="cfg-qwen-model"
                    type="text"
                    value={config.qwenModel || ""}
                    onChange={(e) => update({ qwenModel: e.target.value })}
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
                    onChange={(e) => update({ thinking: e.target.checked })}
                    aria-label="Habilitar o deshabilitar modo thinking"
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer bg-slate-950 border-slate-800"
                  />
                </div>
              </div>

              {/* Decision 2.0 */}
              <div className="pl-1 pt-2">
                <UrlField
                  id="cfg-decision-url"
                  label={`Decision 2.0 URL (${MODELS.EOS_0_8B.name} / HTTP):`}
                  value={config.decisionUrl}
                  placeholder="http://127.0.0.1:8765"
                  onChange={(decisionUrl) => update({ decisionUrl })}
                />
              </div>
            </div>

            {/* SECCIÓN 2: SERVIDORES MCP STDIO */}
            <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4">
              <SectionTitle icon={<Terminal className="w-3.5 h-3.5 text-emerald-400" />}>
                2. Servidores MCP Locales (stdio)
              </SectionTitle>
              <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded text-[11px] text-slate-400 leading-relaxed font-sans">
                <span className="text-amber-400 font-medium font-mono">Nota de proceso: </span>
                Los comandos y argumentos se persisten en el servidor. La modificación de comandos de arranque stdio no reinicia automáticamente los procesos hijos ya en ejecución; para aplicar cambios en el comando base se requiere reiniciar el proceso del servidor backend (<code className="font-mono text-slate-300">node server.ts</code>).
              </div>

              <div className="grid grid-cols-1 gap-3 pl-1">
                <McpCommandField
                  id="cfg-desktop-cmd"
                  label="Desktop Commander MCP (Comando / Argumentos):"
                  value={config.desktopCommanderMcp}
                  commandPlaceholder="npx"
                  argsPlaceholder="-y @wonderwhy-er/desktop-commander"
                  onChange={(patch) => updateMcp("desktopCommanderMcp", patch)}
                />
                <McpCommandField
                  id="cfg-search-cmd"
                  label="Free Search MCP (Comando / Argumentos):"
                  value={config.freeSearchMcp}
                  commandPlaceholder="uvx"
                  argsPlaceholder="--from free-search-mcp==0.13.1 free-search-mcp"
                  onChange={(patch) => updateMcp("freeSearchMcp", patch)}
                />
              </div>
            </div>

            {/* SECCIÓN 3: LÍMITES Y TIMEOUTS */}
            <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4">
              <SectionTitle icon={<Timer className="w-3.5 h-3.5 text-amber-400" />}>
                3. Límites Operativos y Timeouts (ms)
              </SectionTitle>

              <div className="grid grid-cols-3 gap-2.5 pl-1">
                <NumberField
                  id="cfg-decision-timeout"
                  label="Decision 2.0:"
                  value={config.decisionTimeoutMs}
                  fallback={30000}
                  onChange={(decisionTimeoutMs) => update({ decisionTimeoutMs })}
                />
                <NumberField
                  id="cfg-qwen-timeout"
                  label="Qwen 3.5 9B:"
                  value={config.qwenTimeoutMs}
                  fallback={120000}
                  onChange={(qwenTimeoutMs) => update({ qwenTimeoutMs })}
                />
                <NumberField
                  id="cfg-mcp-timeout"
                  label="MCPs (stdio):"
                  value={config.mcpTimeoutMs}
                  fallback={30000}
                  onChange={(mcpTimeoutMs) => update({ mcpTimeoutMs })}
                />
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
                disabled={isSaving || saved}
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
        ) : null}
      </div>
    </div>
  );
};