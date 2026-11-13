import React, { useEffect, useState } from "react";
import { X, FileText, Loader2, AlertCircle, Copy, Check, HardDrive, Hash, Clock } from "lucide-react";
import type { RefDto } from "../../../types/api.ts";
import { jarvisApi } from "../../../services/jarvisApi.ts";

interface RefViewerModalProps {
  taskId: string;
  refId: string;
  refMeta?: RefDto;
  onClose: () => void;
}

export const RefViewerModal: React.FC<RefViewerModalProps> = ({
  taskId,
  refId,
  refMeta,
  onClose,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    jarvisApi
      .getRefContent(taskId, refId)
      .then((data) => {
        if (isMounted) {
          setContent(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Error al obtener la referencia");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [taskId, refId]);

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

  const formattedSize = refMeta?.size
    ? refMeta.size > 1024
      ? `${(refMeta.size / 1024).toFixed(1)} KB (${refMeta.size.toLocaleString()} caracteres)`
      : `${refMeta.size} caracteres`
    : content
      ? `${content.length.toLocaleString()} caracteres`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ref-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-md bg-accent-500/10 text-accent-400 border border-accent-500/30 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span id="ref-modal-title" className="text-sm font-semibold text-slate-100">
                  Referencia <span className="font-mono text-accent-300">{refId}</span>
                </span>
                {refMeta?.label && (
                  <span className="text-xs text-slate-300 truncate max-w-sm">
                    · {refMeta.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                {formattedSize && (
                  <span className="flex items-center gap-1">
                    <Hash className="w-3 h-3 text-slate-500" />
                    <span>{formattedSize}</span>
                  </span>
                )}
                {refMeta?.at && (
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>{new Date(refMeta.at).toLocaleTimeString()}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                title="Copiar contenido"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer border border-slate-700/60"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "¡Copiado!" : "Copiar"}</span>
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

        {/* Ruta en disco si existe */}
        {refMeta?.where && (
          <div className="flex items-center gap-2 px-5 py-2 bg-slate-950/80 border-b border-slate-800 text-xs text-slate-400 overflow-x-auto">
            <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-slate-500 shrink-0">Ubicación física:</span>
            <span className="text-slate-300 select-all font-mono">{refMeta.where}</span>
          </div>
        )}

        {/* Contenido */}
        <div className="flex-1 p-5 overflow-y-auto bg-slate-950/40">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
              <span className="text-xs">Cargando contenido desde el backend…</span>
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 p-4 bg-rose-950/50 border border-rose-900/60 rounded-lg text-rose-300 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold">No se pudo cargar la referencia</span>
                <span className="text-rose-300/90 font-mono">{error}</span>
                <span className="text-xs text-slate-400 mt-1">
                  Es posible que el archivo temporal haya sido limpiado o la tarea no tenga persistida esta referencia.
                </span>
              </div>
            </div>
          ) : content !== null ? (
            <div className="relative">
              <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[13px] text-slate-200 whitespace-pre-wrap break-all leading-relaxed max-h-[60vh] overflow-y-auto selection:bg-accent-500/30">
                {content}
              </pre>
            </div>
          ) : null}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 bg-slate-950/80 text-xs">
          <span className="text-xs text-slate-500">
            {refMeta?.stepId ? `Generada por paso ${refMeta.stepId}` : "Referencia de ejecución"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};