import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Settings,
  X,
  Check,
  Terminal,
  Loader2,
  AlertCircle,
  Cpu,
  Timer,
  Shield,
  ShieldAlert,
  Plus,
  Trash2,
  Activity,
  Laptop,
  Volume2,
} from "lucide-react";
import type { JarvisConfig, BlacklistEntry, UserEnvironment, EngineLimits } from "../../types/api.ts";
import { jarvisApi } from "../../services/jarvisApi.ts";

interface SettingsModalProps {
  onClose: () => void;
  onConfigSaved: () => void;
  onOpenEnvironment?: () => void;
}

type McpKey = "desktopCommanderMcp" | "freeSearchMcp";
type McpPatch = { command?: string; args?: string[] };

const SAVED_FEEDBACK_MS = 600;

/** Clases comunes de los campos de texto, para que todos respondan igual al foco. */
const INPUT_BASE =
  "bg-slate-950 border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 transition-colors";

/**
 * Argumentos ↔ texto. Los argumentos con espacios (rutas de Windows, p. ej.) se escriben entre comillas dobles:
 * con un simple `split(" ")` se partían en dos al editar el campo. Una comilla doble literal dentro de un argumento no se soporta.
 */
const parseArgs = (text: string): string[] =>
  (text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((token) => token.replace(/"/g, ""));

const formatArgs = (args: string[]): string =>
  args.map((arg) => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

// ---------------------------------------------------------------------------
// Campos reutilizables
// ---------------------------------------------------------------------------

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-slate-100 font-semibold text-[13px] border-b border-slate-800 pb-2">
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
      <label htmlFor={id} className="text-slate-300 font-medium">
        {label}
      </label>
      <span className={`text-[11px] ${value ? "text-emerald-400" : "text-yellow-400"}`}>
        {value ? "Configurado" : "Pendiente"}
      </span>
    </div>
    <input
      id={id}
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`px-3 py-2 ${INPUT_BASE} font-mono`}
    />
  </div>
);

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/**
 * Entero positivo, como lo exige el back (`positiveInt`: otro valor se descarta en silencio y se conserva el anterior).
 * Mantiene el texto tal como se escribe y solo propaga valores válidos; el formulario no se envía mientras sea inválido.
 */
const NumberField: React.FC<NumberFieldProps> = ({ id, label, value, onChange }) => {
  const [text, setText] = useState(String(value));

  // Re-sincroniza solo cuando el valor externo cambia por otra vía (p. ej. tras guardar)
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-400 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="number"
        required
        min={1}
        step={1}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 1) onChange(n);
        }}
        className={`w-full px-2.5 py-1.5 ${INPUT_BASE} font-mono text-xs tabular-nums invalid:border-rose-700`}
      />
    </div>
  );
};

/**
 * Argumentos separados por espacios. Mantiene el texto tal como se escribe: si se derivara directamente del
 * array, el espacio final se descartaría al instante y no se podrían tipear varios argumentos.
 */
const ArgsInput: React.FC<{
  args?: string[];
  placeholder: string;
  ariaLabel: string;
  onChange: (args: string[]) => void;
  readOnly?: boolean;
}> = ({ args, placeholder, ariaLabel, onChange, readOnly }) => {
  const external = formatArgs(args || []);
  const [text, setText] = useState(external);

  // Re-sincroniza solo cuando el valor externo cambia por otra vía (p. ej. tras guardar)
  useEffect(() => {
    setText((current) => (formatArgs(parseArgs(current)) === external ? current : external));
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
      readOnly={readOnly}
      className="col-span-2 px-2.5 py-1.5 bg-slate-950/60 border border-slate-800 rounded-md text-slate-400 font-mono text-xs focus:outline-none"
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
    <label htmlFor={id} className="block text-xs text-slate-300 font-medium mb-1">
      {label}
    </label>
    <div className="grid grid-cols-3 gap-2">
      <input
        id={id}
        type="text"
        value={value?.command || ""}
        onChange={(e) => onChange({ command: e.target.value })}
        readOnly
        placeholder={commandPlaceholder}
        className="px-2.5 py-1.5 bg-slate-950/60 border border-slate-800 rounded-md text-slate-400 font-mono text-xs focus:outline-none"
      />
      <ArgsInput
        args={value?.args}
        placeholder={argsPlaceholder}
        ariaLabel={`${label} argumentos`}
        onChange={(args) => onChange({ args })}
        readOnly
      />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onConfigSaved,
  onOpenEnvironment,
}) => {
  // La configuración vigente vive en el backend: no se duplican sus valores por defecto en el cliente.
  const [config, setConfig] = useState<JarvisConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Estado para formulario de nueva regla en lista negra
  const [showBlacklistForm, setShowBlacklistForm] = useState(false);
  const [newTool, setNewTool] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newReason, setNewReason] = useState("");

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

  const handleAddBlacklist = () => {
    if (!newTool.trim() || !newReason.trim()) return;
    const entry: BlacklistEntry = {
      tool: newTool.trim(),
      reason: newReason.trim(),
      ...(newPattern.trim() ? { pattern: newPattern.trim() } : {}),
    };
    const list = [...(config?.blacklist || []), entry];
    update({ blacklist: list });
    setNewTool("");
    setNewPattern("");
    setNewReason("");
    setShowBlacklistForm(false);
  };

  const handleRemoveBlacklist = (index: number) => {
    const list = (config?.blacklist || []).filter((_, i) => i !== index);
    update({ blacklist: list });
  };

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
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 text-slate-100 flex flex-col gap-5 max-h-[88vh] overflow-y-auto">
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-accent-400" />
            <h2 id="settings-modal-title" className="text-sm font-semibold">
              Configuración de servicios externos
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
          <div className="flex items-center gap-2 p-3 bg-rose-950/50 border border-rose-900/60 rounded-md text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="flex-1">{error}</span>
            {!config && !isLoading && (
              <button
                type="button"
                onClick={() => void loadConfig()}
                className="px-2.5 py-1 text-xs font-medium text-rose-200 bg-rose-900/50 hover:bg-rose-900/80 border border-rose-800/60 rounded transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
            <span>Cargando configuración desde el servidor...</span>
          </div>
        ) : config ? (
          <form onSubmit={handleSave} className="flex flex-col gap-6 text-xs">
            {/* SECCIÓN 1: MODELOS LOCALES */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Cpu className="w-3.5 h-3.5 text-accent-400" />}>
                1. Modelos de inferencia local (HTTP)
              </SectionTitle>

              {/* Qwen 3.5 9B */}
              <div className="flex flex-col gap-2.5 pl-1">
                <UrlField
                  id="cfg-qwen-url"
                  label="Qwen URL (Ollama / ngrok / v1)"
                  value={config.qwenUrl}
                  placeholder="http://127.0.0.1:11434"
                  onChange={(qwenUrl) => update({ qwenUrl })}
                />

                <div className="flex flex-col gap-1">
                  <label htmlFor="cfg-qwen-model" className="text-slate-400">
                    Tag o nombre del modelo
                  </label>
                  <input
                    id="cfg-qwen-model"
                    type="text"
                    value={config.qwenModel || ""}
                    onChange={(e) => update({ qwenModel: e.target.value })}
                    placeholder="qwen3.5:9b"
                    className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono text-xs`}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 pt-1">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300 font-medium">
                      Thinking en la respuesta final
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {config.thinking ? "Habilitado (think: true)" : "Deshabilitado (modo directo rápido)"}
                      {" · "}el plan y la replanificación siempre usan thinking
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(config.thinking)}
                    onChange={(e) => update({ thinking: e.target.checked })}
                    aria-label="Habilitar o deshabilitar modo thinking"
                    className="w-4 h-4 accent-accent-500 rounded cursor-pointer shrink-0"
                  />
                </div>
              </div>

              {/* Decision 2.0 */}
              <div className="pl-1 pt-2 flex flex-col gap-2.5">
                <UrlField
                  id="cfg-decision-url"
                  label="URL del servicio de decisión"
                  value={config.decisionUrl}
                  placeholder="http://127.0.0.1:11434"
                  onChange={(decisionUrl) => update({ decisionUrl })}
                />

                <div className="flex flex-col gap-1">
                  <label htmlFor="cfg-decision-model" className="text-slate-400">
                    Tag del modelo
                  </label>
                  <input
                    id="cfg-decision-model"
                    type="text"
                    value={config.decisionModel ?? ""}
                    onChange={(e) => update({ decisionModel: e.target.value })}
                    placeholder="d3:2b"
                    className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono text-xs`}
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: SERVIDORES MCP STDIO */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Terminal className="w-3.5 h-3.5 text-accent-400" />}>
                2. Servidores MCP locales (stdio)
              </SectionTitle>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 leading-relaxed">
                <span className="text-yellow-300 font-medium">Nota de proceso: </span>
                El comando y los argumentos de arranque son de solo lectura aquí: la API no los acepta, para que ningún cliente local pueda cambiar el programa que se lanza. Para cambiarlos, edite <code className="font-mono text-slate-300">jarvis-config.json</code> y reinicie el servidor backend.
              </div>

              <div className="grid grid-cols-1 gap-3 pl-1">
                <McpCommandField
                  id="cfg-desktop-cmd"
                  label="Desktop Commander MCP (comando / argumentos)"
                  value={config.desktopCommanderMcp}
                  commandPlaceholder="npx"
                  argsPlaceholder="-y @wonderwhy-er/desktop-commander"
                  onChange={(patch) => updateMcp("desktopCommanderMcp", patch)}
                />
                <McpCommandField
                  id="cfg-search-cmd"
                  label="Free Search MCP (comando / argumentos)"
                  value={config.freeSearchMcp}
                  commandPlaceholder="uvx"
                  argsPlaceholder="--from free-search-mcp==0.18.0 free-search-mcp"
                  onChange={(patch) => updateMcp("freeSearchMcp", patch)}
                />
              </div>
            </div>

            {/* SECCIÓN 3: LÍMITES Y TIMEOUTS */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Timer className="w-3.5 h-3.5 text-accent-400" />}>
                3. Límites operativos y timeouts (ms)
              </SectionTitle>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pl-1">
                <NumberField
                  id="cfg-decision-timeout"
                  label="Decision 2.0"
                  value={config.decisionTimeoutMs}
                  onChange={(decisionTimeoutMs) => update({ decisionTimeoutMs })}
                />
                <NumberField
                  id="cfg-qwen-timeout"
                  label="Qwen (sin thinking)"
                  value={config.qwenTimeoutMs}
                  onChange={(qwenTimeoutMs) => update({ qwenTimeoutMs })}
                />
                <NumberField
                  id="cfg-qwen-thinking-timeout"
                  label="Qwen (con thinking)"
                  value={config.qwenThinkingTimeoutMs}
                  onChange={(qwenThinkingTimeoutMs) => update({ qwenThinkingTimeoutMs })}
                />
                <NumberField
                  id="cfg-mcp-timeout"
                  label="MCPs (stdio)"
                  value={config.mcpTimeoutMs}
                  onChange={(mcpTimeoutMs) => update({ mcpTimeoutMs })}
                />
              </div>
            </div>

            {/* SECCIÓN 4: SEGURIDAD, POLÍTICAS GUARD Y MODO AUTOMÁTICO */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Shield className="w-3.5 h-3.5 text-accent-400" />}>
                4. Seguridad, Guard y modo automático
              </SectionTitle>

              {/* Modo Automático */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-200">
                      Modo automático <span className="font-mono font-normal text-slate-500">(autoMode)</span>
                    </span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${config.autoMode
                          ? "bg-yellow-950/40 text-yellow-300 border border-yellow-800/50"
                          : "bg-slate-800 text-slate-400"
                        }`}
                    >
                      {config.autoMode ? "Activado" : "Desactivado (interactivo)"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Con el modo automático activado, las operaciones de escritura y comandos del catálogo <strong className="text-slate-200">no generarán espera de aprobación manual</strong>; serán validadas directamente por la revisión de argumentos de Decisión 3. Guard destructivo y la lista negra continuarán bloqueando amenazas.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(config.autoMode)}
                  onChange={(e) => update({ autoMode: e.target.checked })}
                  aria-label="Activar o desactivar modo automático"
                  className="w-4 h-4 accent-yellow-500 rounded cursor-pointer mt-1 shrink-0"
                />
              </div>

              {/* Lista Negra */}
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-slate-200 text-xs font-medium">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>Lista negra de herramientas modificadoras</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBlacklistForm((v) => !v)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-rose-300 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/60 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Agregar regla</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Reglas deterministas de rechazo (tool_rejected). Afecta solo a herramientas que modifican el sistema.
                </p>

                {/* Formulario para nueva regla */}
                {showBlacklistForm && (
                  <div className="p-3 rounded-lg bg-slate-950 border border-rose-900/60 flex flex-col gap-2 mt-1">
                    <div className="flex items-center justify-between text-xs text-rose-300 font-semibold">
                      <span>Nueva regla de lista negra</span>
                      <button
                        type="button"
                        onClick={() => setShowBlacklistForm(false)}
                        aria-label="Cerrar formulario de regla"
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Herramienta (ej: run_command)"
                        aria-label="Herramienta"
                        value={newTool}
                        onChange={(e) => setNewTool(e.target.value)}
                        className={`px-2 py-1.5 ${INPUT_BASE} text-xs font-mono`}
                      />
                      <input
                        type="text"
                        placeholder="Patrón regex (opcional)"
                        aria-label="Patrón regex"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        className={`px-2 py-1.5 ${INPUT_BASE} text-xs font-mono`}
                      />
                      <input
                        type="text"
                        placeholder="Motivo para el modelo"
                        aria-label="Motivo"
                        value={newReason}
                        onChange={(e) => setNewReason(e.target.value)}
                        className={`px-2 py-1.5 ${INPUT_BASE} text-xs`}
                      />
                    </div>
                    <div className="flex justify-end gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setShowBlacklistForm(false)}
                        className="px-2.5 py-1 text-slate-400 text-xs hover:text-slate-200 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!newTool.trim() || !newReason.trim()}
                        onClick={handleAddBlacklist}
                        className="px-3 py-1 bg-rose-500 hover:bg-rose-400 text-slate-950 font-semibold rounded-md text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Añadir regla
                      </button>
                    </div>
                  </div>
                )}

                {/* Listado de reglas actuales */}
                <div className="flex flex-col gap-1 mt-1">
                  {config.blacklist && config.blacklist.length > 0 ? (
                    config.blacklist.map((rule, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-mono font-semibold text-rose-300">{rule.tool}</span>
                          {rule.pattern && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-yellow-300 text-[11px] font-mono">
                              regex: /{rule.pattern}/
                            </span>
                          )}
                          <span className="text-slate-400 truncate max-w-sm">
                            {rule.reason}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveBlacklist(idx)}
                          title="Eliminar regla"
                          aria-label={`Eliminar regla de ${rule.tool}`}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs italic pl-1">
                      No hay reglas personalizadas en la lista negra (todas las herramientas permitidas por Guard están habilitadas).
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* SECCIÓN 5: VOZ */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Volume2 className="w-3.5 h-3.5 text-accent-400" />}>
                5. Voz (TTS local)
              </SectionTitle>
              <UrlField
                id="cfg-voice-url"
                label="Servidor de voz (scripts/phonon_server.py)"
                value={config.voiceUrl}
                placeholder="http://127.0.0.1:8880"
                onChange={(voiceUrl) => update({ voiceUrl })}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="cfg-voice-name" className="text-slate-400">
                  Voz ("default" usa la predeterminada)
                </label>
                <input
                  id="cfg-voice-name"
                  type="text"
                  value={config.voiceName || ""}
                  onChange={(e) => update({ voiceName: e.target.value })}
                  placeholder="default"
                  className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono text-xs`}
                />
              </div>
              <label className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <span className="text-xs text-slate-300">Leer en voz alta la respuesta final en esta interfaz</span>
                <input
                  type="checkbox"
                  checked={Boolean(config.voiceEnabled)}
                  onChange={(e) => update({ voiceEnabled: e.target.checked })}
                  className="w-4 h-4 accent-accent-500 shrink-0"
                />
              </label>
              <label className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <span className="text-xs text-slate-300 leading-relaxed">
                  Telegram responde también con nota de voz (requiere <code className="font-mono text-slate-200">ffmpeg</code>; el bot se configura con TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en <code className="font-mono text-slate-200">.env</code>)
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(config.telegramVoice)}
                  onChange={(e) => update({ telegramVoice: e.target.checked })}
                  className="w-4 h-4 accent-accent-500 shrink-0"
                />
              </label>
            </div>

            {/* SECCIÓN 6: REGISTRO DE TRAZAS Y ENTORNO */}
            <div className="flex flex-col gap-3">
              <SectionTitle icon={<Activity className="w-3.5 h-3.5 text-accent-400" />}>
                6. Auditoría y registro de trazas
              </SectionTitle>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-1">
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300 font-medium">
                      Habilitar trazas <span className="font-mono font-normal text-slate-500">(traceEnabled)</span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Registra una carpeta y snapshot por tarea terminada
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(config.traceEnabled)}
                    onChange={(e) => update({ traceEnabled: e.target.checked })}
                    aria-label="Habilitar trazas"
                    className="w-4 h-4 accent-accent-500 rounded cursor-pointer shrink-0"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="cfg-trace-path" className="text-slate-400">
                    Ruta del archivo de registro de trazas
                  </label>
                  <input
                    id="cfg-trace-path"
                    type="text"
                    value={config.tracePath || ""}
                    onChange={(e) => update({ tracePath: e.target.value })}
                    readOnly
                    title="Solo se cambia en jarvis-config.json (la API no lo acepta)"
                    placeholder="trace/runs.jsonl"
                    className="px-2.5 py-1.5 bg-slate-950/60 border border-slate-800 rounded-md text-slate-400 font-mono text-xs focus:outline-none"
                  />
                </div>
              </div>

              {onOpenEnvironment && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={onOpenEnvironment}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
                  >
                    <Laptop className="w-3.5 h-3.5 text-accent-400" />
                    <span>Ver información del entorno de la PC y límites operativos</span>
                  </button>
                </div>
              )}
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
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-slate-950 bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors cursor-pointer"
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
                  <span>Guardar configuración</span>
                )}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};