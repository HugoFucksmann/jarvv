import React, { useEffect, useState } from "react";
import { X, Activity, Loader2, AlertCircle, Copy, Check, FileCode, FileText, ListTree } from "lucide-react";
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

export const TraceViewerModal: React.FC<TraceViewerModalProps> = ({
  taskId,
  taskRequest,
  initialCallId = null,
  onClose,
}) => {
  const [format, setFormat] = useState<"queries" | "summary" | "json">("queries");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (format === "queries") return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    jarvisApi
      .getTrace(taskId, format as "summary" | "json")
      .then((data) => {
        if (isMounted) {
          setContent(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "No hay traza para esta tarea (puede que la traza esté desactivada en la configuración o la tarea no haya terminado)."
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [taskId, format]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Failed to copy:", e);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trace-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-[96vw] 2xl:max-w-[1800px] h-[92vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 px-5 py-3.5 bg-slate-950/70 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-md bg-purple-950 text-purple-400 border border-purple-800/60 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span id="trace-modal-title" className="font-mono text-sm font-bold text-purple-300">
                  Traza de Auditoría
                </span>
                <span className="text-[11px] font-mono text-slate-500 truncate max-w-xs">
                  ID: {taskId}
                </span>
              </div>
              {taskRequest && (
                <p className="text-xs text-slate-300 truncate max-w-lg mt-0.5">
                  {taskRequest}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {/* Selector de formato */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-mono">
              <button
                type="button"
                onClick={() => setFormat("queries")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  format === "queries"
                    ? "bg-purple-900/60 text-purple-200 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ListTree className="w-3.5 h-3.5" />
                <span>Consultas</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat("summary")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  format === "summary"
                    ? "bg-purple-900/60 text-purple-200 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Resumen (D1-D4)</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  format === "json"
                    ? "bg-purple-900/60 text-purple-200 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>JSON Crudo</span>
              </button>
            </div>

            {format !== "queries" && content && (
              <button
                type="button"
                onClick={handleCopy}
                title="Copiar contenido de la traza"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer border border-slate-700/60"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{copied ? "Copiado!" : "Copiar"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar visor"
              className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer rounded hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className={`flex-1 min-h-0 bg-slate-950/40 ${format === "queries" ? "overflow-hidden" : "p-6 overflow-y-auto"}`}>
          {format === "queries" ? (
            <TraceInspector taskId={taskId} initialCallId={initialCallId} />
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              <span className="text-xs font-mono">Consultando traza registrada de la tarea…</span>
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 p-4 bg-slate-950 border border-amber-900/50 rounded-lg text-amber-300 text-xs">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-amber-200">Traza no disponible</span>
                <span className="text-slate-300 font-sans">{error}</span>
                <span className="text-[11px] text-slate-500 mt-2 font-mono">
                  Nota: Las trazas requieren que <code className="text-purple-300">traceEnabled: true</code> esté configurado en el servidor y que la tarea haya alcanzado un estado terminal.
                </span>
              </div>
            </div>
          ) : content !== null ? (
            format === "summary" ? (
              <div className="prose prose-invert max-w-none text-xs leading-relaxed">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 whitespace-pre-wrap break-all leading-relaxed max-h-[65vh] overflow-y-auto selection:bg-purple-900/50">
                {content}
              </pre>
            )
          ) : null}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 bg-slate-950/80 text-xs">
          <span className="text-[11px] font-mono text-slate-500">
            {format === "queries"
              ? "Entrada y salida de cada consulta a los modelos, con probabilidades de decisión, tokens y latencias"
              : format === "summary"
              ? "Línea de tiempo con decisiones D1 (herramienta), D2 (argumentos), D3 (revisión) y D4 (verificación)"
              : "Snapshot técnico de auditoría con tiempos y opciones de llamadas"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

