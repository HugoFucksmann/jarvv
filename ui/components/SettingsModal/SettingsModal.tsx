import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  Cpu,
  Loader2,
  RotateCcw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Volume2,
  X,
} from "lucide-react";
import type { ConfigPatch, JarvisConfig } from "../../types/api.ts";
import { jarvisApi } from "../../services/jarvisApi.ts";
import { ModelsSection } from "./sections/ModelsSection.tsx";
import { SecuritySection } from "./sections/SecuritySection.tsx";
import { ExecutionSection } from "./sections/ExecutionSection.tsx";
import { VoiceSection } from "./sections/VoiceSection.tsx";
import { TracesSection } from "./sections/TracesSection.tsx";

interface SettingsModalProps {
  onClose: () => void;
  onConfigSaved: () => void;
  onOpenEnvironment?: () => void;
}

type CategoryId = "models" | "security" | "execution" | "voice" | "traces";

interface CategoryMeta {
  id: CategoryId;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
  fieldIds: string[];
  keywords: string[];
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "models",
    label: "Modelos e IA",
    shortDesc: "Qwen, Decision 2.0, timeouts",
    icon: Cpu,
    fieldIds: [
      "cfg-decision-timeout",
      "cfg-qwen-timeout",
      "cfg-qwen-thinking-timeout",
      "cfg-model-pause-max",
      "cfg-qwen-ctx",
      "cfg-decision-ctx",
      "cfg-max-tok-args",
      "cfg-max-tok-plan",
      "cfg-max-tok-replan",
      "cfg-max-tok-final",
    ],
    keywords: [
      "modelo",
      "modelos",
      "qwen",
      "ollama",
      "url",
      "thinking",
      "decision",
      "timeout",
      "pausa",
      "contexto",
      "num_ctx",
      "tokens",
      "qwenmaxtokens",
      "keep-alive",
      "keepalive",
    ],
  },
  {
    id: "security",
    label: "Seguridad y Guard",
    shortDesc: "Modo auto, carpetas, reglas",
    icon: Shield,
    fieldIds: [],
    keywords: [
      "seguridad",
      "guard",
      "auto",
      "automode",
      "niveles",
      "riesgo",
      "approvaltiers",
      "carpetas",
      "directorios",
      "alloweddirectories",
      "lista negra",
      "blacklist",
      "reglas",
      "regex",
    ],
  },
  {
    id: "execution",
    label: "Ejecución y MCP",
    shortDesc: "Herramientas, web, comandos",
    icon: SlidersHorizontal,
    fieldIds: [
      "cfg-mcp-timeout",
      "cfg-web-judge-timeout",
      "cfg-runcmd-default",
      "cfg-runcmd-max",
    ],
    keywords: [
      "mcp",
      "stdio",
      "search",
      "web",
      "juez",
      "bm25",
      "run_command",
      "terminal",
      "experimental",
      "review",
      "cobertura",
      "timeout",
      "comando",
    ],
  },
  {
    id: "voice",
    label: "Voz (TTS)",
    shortDesc: "Síntesis local y Telegram",
    icon: Volume2,
    fieldIds: [],
    keywords: ["voz", "tts", "audio", "telegram", "phonon", "ffmpeg", "voice", "nota"],
  },
  {
    id: "traces",
    label: "Trazas y retención",
    shortDesc: "Auditoría, disco y entorno",
    icon: Activity,
    fieldIds: ["cfg-retention-days", "cfg-log-retention-days", "cfg-retention-max-mb"],
    keywords: [
      "traza",
      "trazas",
      "auditoria",
      "traceenabled",
      "tracepath",
      "retencion",
      "dias",
      "logs",
      "refs",
      "disco",
      "mb",
      "entorno",
      "limites",
    ],
  },
];

const SAVED_FEEDBACK_MS = 600;

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onConfigSaved,
  onOpenEnvironment,
}) => {
  const [initialConfig, setInitialConfig] = useState<JarvisConfig | null>(null);
  const [config, setConfig] = useState<JarvisConfig | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("models");
  const [searchQuery, setSearchQuery] = useState("");
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const backendCfg = await jarvisApi.getConfig();
      if (backendCfg && typeof backendCfg === "object") {
        setInitialConfig(backendCfg);
        setConfig(backendCfg);
        setInvalidFields({});
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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSaving, onClose]);

  const update = useCallback((patch: Partial<JarvisConfig>) => {
    setSaved(false);
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateAllowedDirs = useCallback((allowedDirectories: string[]) => {
    setSaved(false);
    setConfig((prev) => (prev ? { ...prev, allowedDirectories } : prev));
  }, []);

  const handleValidityChange = useCallback((id: string, isValid: boolean) => {
    setInvalidFields((prev) => {
      const currentlyInvalid = Boolean(prev[id]);
      if (isValid && !currentlyInvalid) return prev;
      if (!isValid && currentlyInvalid) return prev;
      const next = { ...prev };
      if (isValid) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }, []);

  const handleDiscard = () => {
    if (!initialConfig) return;
    setConfig(initialConfig);
    setInvalidFields({});
    setError(null);
    setSaved(false);
  };

  const isDirty = useMemo(() => {
    if (!config || !initialConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(initialConfig);
  }, [config, initialConfig]);

  const hasInvalidFields = Object.keys(invalidFields).length > 0;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const matchingCategories = useMemo(() => {
    if (!isSearching) return [activeCategory];
    return CATEGORIES.filter(
      (cat) =>
        cat.label.toLowerCase().includes(normalizedQuery) ||
        cat.shortDesc.toLowerCase().includes(normalizedQuery) ||
        cat.keywords.some((kw) => kw.includes(normalizedQuery))
    ).map((cat) => cat.id);
  }, [activeCategory, isSearching, normalizedQuery]);

  const handleSelectCategory = (id: CategoryId) => {
    setSearchQuery("");
    setActiveCategory(id);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || hasInvalidFields || !isDirty || isSaving) return;
    setIsSaving(true);
    setError(null);

    try {
      const {
        refsDir: _refsDir,
        tracePath: _tracePath,
        freeSearchMcp: _freeSearchMcp,
        toolTimeoutsMs: _toolTimeoutsMs,
        modelTimeoutsMs: _modelTimeoutsMs,
        sseKeepAliveMs: _sseKeepAliveMs,
        shutdownDrainMs: _shutdownDrainMs,
        ...editable
      } = config;
      const patch: ConfigPatch = {
        ...editable,
      };
      const updated = await jarvisApi.updateConfig(patch);
      setInitialConfig(updated);
      setConfig(updated);
      setInvalidFields({});
      setSaved(true);
      onConfigSaved();
      closeTimerRef.current = setTimeout(onClose, SAVED_FEEDBACK_MS);
    } catch (err) {
      console.error("Error saving config:", err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Error al guardar la configuración en el servidor."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const renderSection = (id: CategoryId) => {
    if (!config) return null;
    switch (id) {
      case "models":
        return (
          <ModelsSection
            config={config}
            onUpdate={update}
            onValidityChange={handleValidityChange}
            forceOpenAdvanced={
              isSearching &&
              ["contexto", "num_ctx", "tokens", "qwenmaxtokens", "keep-alive", "keepalive"].some((k) =>
                normalizedQuery.includes(k) || k.includes(normalizedQuery)
              )
            }
          />
        );
      case "security":
        return (
          <SecuritySection
            config={config}
            onUpdate={update}
            onUpdateAllowedDirs={updateAllowedDirs}
          />
        );
      case "execution":
        return (
          <ExecutionSection
            config={config}
            onUpdate={update}
            onValidityChange={handleValidityChange}
            forceOpenExperimental={
              isSearching &&
              ["experimental", "review", "cobertura"].some((k) =>
                normalizedQuery.includes(k) || k.includes(normalizedQuery)
              )
            }
            forceOpenMcp={
              isSearching &&
              ["mcp", "search", "stdio", "comando"].some((k) =>
                normalizedQuery.includes(k) || k.includes(normalizedQuery)
              )
            }
          />
        );
      case "voice":
        return <VoiceSection config={config} onUpdate={update} />;
      case "traces":
        return (
          <TracesSection
            config={config}
            onUpdate={update}
            onValidityChange={handleValidityChange}
            onOpenEnvironment={onOpenEnvironment}
          />
        );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        onSubmit={handleSave}
        className="w-full max-w-4xl h-[86vh] max-h-[760px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl text-slate-100 flex flex-col overflow-hidden animate-in"
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-accent-500/10 text-accent-400 border border-accent-500/30 shrink-0">
              <Settings className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <h2 id="settings-modal-title" className="text-sm font-semibold text-slate-100 truncate">
                Configuración de JARVIS
              </h2>
              <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
                Modelos locales, seguridad Guard, ejecución, voz y auditoría
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-44 sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar ajuste..."
                aria-label="Buscar en la configuración"
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              aria-label="Cerrar ventana de configuración"
              title="Cerrar (Esc)"
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="mx-5 mt-3 flex items-center gap-2 p-3 bg-rose-950/50 border border-rose-900/60 rounded-lg text-xs text-rose-300 shrink-0"
          >
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

        {/* Cuerpo principal */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
            <span>Cargando configuración desde el servidor…</span>
          </div>
        ) : config ? (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* Navegación lateral */}
            <nav
              aria-label="Categorías de configuración"
              className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/40 p-2.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto"
            >
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isSelected = !isSearching && activeCategory === cat.id;
                const hasError = cat.fieldIds.some((id) => invalidFields[id]);

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat.id)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer shrink-0 md:shrink ${
                      isSelected
                        ? "bg-slate-800 text-slate-50 border border-slate-700/80"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/70 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isSelected ? "text-accent-400" : "text-slate-500"
                        }`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium whitespace-nowrap">
                          {cat.label}
                        </span>
                        <span className="hidden md:block text-[11px] text-slate-500 truncate">
                          {cat.shortDesc}
                        </span>
                      </div>
                    </div>
                    {hasError && (
                      <span
                        title="Hay campos numéricos inválidos en esta sección"
                        className="w-2 h-2 rounded-full bg-rose-500 shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Panel de contenido */}
            <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6">
              {matchingCategories.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center py-12">
                  <Search className="w-5 h-5 text-slate-600" />
                  <p className="text-xs text-slate-300 font-medium">
                    No se encontraron ajustes para «{searchQuery}»
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-xs text-accent-400 hover:text-accent-300 cursor-pointer"
                  >
                    Limpiar búsqueda
                  </button>
                </div>
              ) : null}

              <div className={matchingCategories.length === 0 ? "hidden" : "flex flex-col gap-8 max-w-2xl"}>
                {CATEGORIES.map((cat) => {
                  const isVisible = matchingCategories.includes(cat.id);
                  return (
                    <div key={cat.id} className={isVisible ? "block" : "hidden"}>
                      {renderSection(cat.id)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Pie fijo */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-slate-950/80 text-xs shrink-0 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            {hasInvalidFields ? (
              <span className="text-rose-400 font-medium">
                Corrige los campos marcados antes de guardar
              </span>
            ) : isDirty ? (
              <>
                <span className="text-yellow-300 font-medium">Cambios sin guardar</span>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Descartar</span>
                </button>
              </>
            ) : (
              <span className="text-slate-500">Sin cambios pendientes</span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={!config || !isDirty || isSaving || saved || hasInvalidFields}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-slate-950 bg-accent-500 hover:bg-accent-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed rounded-md transition-colors cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando…</span>
                </>
              ) : saved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardado</span>
                </>
              ) : (
                <span>Guardar cambios</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};