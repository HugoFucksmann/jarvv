import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Activity,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  FileCode,
  FileText,
  ListTree,
  RefreshCw,
} from "lucide-react";
import { jarvisApi } from "../../../services/jarvisApi.ts";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";
import { TraceInspector } from "../../TraceInspector/TraceInspector.tsx";

interface TraceViewerModalProps {
  taskId: string;
  taskRequest?: string;
  /** Abre en «Consultas» filtrado a las consultas de esa llamada. */
  initialCallId?: string | null;
  onClose: () => void;
}

type TraceFormat = "queries" | "summary" | "json";
type CopyState = "idle" | "copied" | "error";

const TABS: {
  id: TraceFormat;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}[] = [
    {
      id: "queries",
      label: "Consultas",
      icon: ListTree,
      hint: "Entrada y salida de cada consulta a los modelos, con probabilidades de decisión, tokens y latencias",
    },
    {
      id: "summary",
      label: "Resumen",
      icon: FileText,
      hint: "Línea de tiempo con decisiones D1 (herramienta), D2 (argumentos), D3 (revisión) y D4 (verificación)",
    },
    {
      id: "json",
      label: "JSON crudo",
      icon: FileCode,
      hint: "Snapshot técnico de auditoría con tiempos y opciones de llamadas",
    },
  ];

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70";

export const TraceViewerModal: React.FC<TraceViewerModalProps> = ({
  taskId,
  taskRequest,
  initialCallId = null,
  onClose,
}) => {
  const [format, setFormat] = useState<TraceFormat>("queries");
  // Caché por tarea+formato: alternar pestañas no vuelve a pedir la traza.
  const [traces, setTraces] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = `${taskId}:${format}`;
  const isTextFormat = format !== "queries";
  const content = isTextFormat ? traces[key] ?? null : null;
  const error = isTextFormat ? errors[key] ?? null : null;
  const loading = isTextFormat && content === null && error === null;
  const activeTab = TABS.find((t) => t.id === format) ?? TABS[0];

  useEffect(() => {
    if (format === "queries") return;
    // Ya cargado: no hace falta volver a pedirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (traces[key] !== undefined) return;

    let isMounted = true;

    jarvisApi
      .getTrace(taskId, format)
      .then((data) => {
        if (isMounted) setTraces((prev) => ({ ...prev, [key]: data }));
      })
      .catch((err) => {
        if (!isMounted) return;
        setErrors((prev) => ({
          ...prev,
          [key]:
            err instanceof Error
              ? err.message
              : "No hay traza para esta tarea (puede que la traza esté desactivada en la configuración o la tarea no haya terminado).",
        }));
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, format, attempt]);

  // Escape para cerrar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Foco dentro del modal, sin scroll de fondo; se restaura al cerrar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const flashCopyState = (state: CopyState) => {
    setCopyState(state);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      flashCopyState("copied");
    } catch (e) {
      console.warn("Failed to copy:", e);
      flashCopyState("error");
    }
  };

  const handleRetry = () => {
    setErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    setAttempt((n) => n + 1);
  };

  const handleTabsKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = TABS.findIndex((t) => t.id === format);
      let next = current;
      if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
      else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = TABS.length - 1;
      else return;
      e.preventDefault();
      setFormat(TABS[next].id);
      tabRefs.current[next]?.focus();
    },
    [format]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trace-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onMouseDown={(e) => {
        // Solo cierra si el clic empieza en el fondo, no al soltar una selección de texto fuera.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-[96vw] 2xl:max-w-[1800px] h-[92vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-100 outline-none animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 bg-slate-950/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-accent-500/10 text-accent-400 border border-accent-500/30 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-baseline gap-2.5 min-w-0">
                <h2 id="trace-modal-title" className="text-sm font-semibold text-slate-100 shrink-0">
                  Traza de auditoría
                </h2>
                <span
                  className="text-[11px] font-mono text-slate-500 truncate select-all"
                  title={`ID de tarea: ${taskId}`}
                >
                  {taskId}
                </span>
              </div>
              {taskRequest && (
                <p className="text-xs text-slate-400 truncate max-w-2xl mt-0.5" title={taskRequest}>
                  {taskRequest}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Siempre ocupa su sitio para que la cabecera no salte al cambiar de pestaña */}
            <button
              type="button"
              onClick={handleCopy}
              disabled={!content}
              title="Copiar contenido de la traza"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING} ${copyState === "error"
                  ? "text-rose-300 bg-rose-950/40 border-rose-900/60"
                  : "text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border-slate-700/60"
                } ${isTextFormat ? "" : "invisible"}`}
            >
              {copyState === "copied" ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : copyState === "error" ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline" aria-live="polite">
                {copyState === "copied" ? "¡Copiado!" : copyState === "error" ? "No se pudo copiar" : "Copiar"}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar visor"
              title="Cerrar (Esc)"
              className={`p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer rounded-md hover:bg-slate-800 ${FOCUS_RING}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pestañas */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/70 px-5">
          <div
            role="tablist"
            aria-label="Formato de la traza"
            onKeyDown={handleTabsKeyDown}
            className="flex items-center gap-1 shrink-0"
          >
            {TABS.map(({ id, label, icon: Icon }, i) => {
              const selected = format === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={`trace-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="trace-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setFormat(id)}
                  className={`-mb-px flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer rounded-t ${FOCUS_RING} ${selected
                      ? "border-accent-400 text-accent-300"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                    }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <p className="hidden md:block text-[11px] text-slate-500 truncate" title={activeTab.hint}>
            {activeTab.hint}
          </p>
        </div>

        {/* Cuerpo */}
        <div
          id="trace-panel"
          role="tabpanel"
          aria-labelledby={`trace-tab-${format}`}
          className="flex-1 min-h-0 bg-slate-950/40"
        >
          {/* Se mantiene montado para conservar filtros y selección al volver desde otra pestaña */}
          <div className={format === "queries" ? "h-full overflow-hidden" : "hidden"}>
            <TraceInspector taskId={taskId} initialCallId={initialCallId} />
          </div>

          {isTextFormat && (
            <div className="h-full overflow-y-auto p-6">
              {loading ? (
                <div
                  role="status"
                  className="h-full flex flex-col items-center justify-center text-slate-400 gap-2"
                >
                  <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                  <span className="text-xs">Cargando la traza de la tarea…</span>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="mx-auto mt-8 max-w-xl flex items-start gap-3 p-4 bg-slate-950 border border-yellow-800/50 rounded-lg text-xs"
                >
                  <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="font-semibold text-yellow-200 text-sm">No se pudo cargar la traza</span>
                    <span className="text-slate-300 break-words">{error}</span>
                    <span className="text-xs text-slate-500 mt-1">
                      Las trazas requieren <code className="font-mono text-accent-300">traceEnabled: true</code> en
                      el servidor y que la tarea haya llegado a un estado terminal.
                    </span>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className={`mt-2 self-start flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 transition-colors cursor-pointer ${FOCUS_RING}`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reintentar
                    </button>
                  </div>
                </div>
              ) : content === "" ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                  <FileText className="w-6 h-6" />
                  <span className="text-xs">La traza de esta tarea está vacía.</span>
                </div>
              ) : format === "summary" ? (
                <div className="mx-auto max-w-4xl">
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                    <MarkdownRenderer content={content ?? ""} />
                  </div>
                </div>
              ) : (
                <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed selection:bg-accent-500/30">
                  {content}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};