import React from "react";
import { Cpu, FileText, ExternalLink, HelpCircle, AlertCircle, HardDrive, Clock } from "lucide-react";
import type { TaskDto, RefDto } from "../../../types/api.ts";

interface ArtifactsListProps {
  task: TaskDto;
  onViewRef: (refId: string, meta?: RefDto) => void;
}

export const ArtifactsList: React.FC<ArtifactsListProps> = ({ task, onViewRef }) => {
  const { facts, refs, errors } = task;

  // 1. Proceso activo en segundo plano
  const backgroundProcess = facts?.process && facts.process.value !== null && facts.process.value !== undefined
    ? facts.process
    : null;

  // 2. Respuestas interactivas del usuario en facts
  const answeredQuestions = Object.entries(facts || {})
    .filter(([key, fact]) => key.startsWith("answer_") && Boolean(fact.value))
    .map(([key, fact]) => ({
      key,
      stepId: fact.stepId,
      at: fact.at,
      value: String(fact.value),
    }));

  const hasRefs = refs && refs.length > 0;
  const hasErrors = errors && errors.length > 0;

  if (!backgroundProcess && answeredQuestions.length === 0 && !hasRefs && !hasErrors) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs">
      {/* A. Proceso en segundo plano activo */}
      {backgroundProcess && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-accent-500/5 border border-accent-500/30 text-slate-200">
          <Cpu className="w-5 h-5 text-accent-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-accent-300 text-[13px]">
                Proceso en segundo plano activo
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-mono font-semibold">
                PID / ID: {String(backgroundProcess.value)}
              </span>
              {backgroundProcess.stepId && (
                <span className="text-slate-400 text-[11px]">
                  (Iniciado en {backgroundProcess.stepId})
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              La tarea finalizó dejando este proceso en ejecución continua en su equipo (p. ej., un servidor o monitoreo). Sigue activo de forma independiente.
            </p>
          </div>
        </div>
      )}

      {/* B. Errores de servicio no disponible */}
      {hasErrors && (
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-rose-950/30 border border-rose-900/50">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-[13px]">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>Incidencias de servicio detectadas ({errors.length})</span>
          </div>
          <div className="flex flex-col gap-1 pl-6">
            {errors.map((err, i) => (
              <div key={err.id || i} className="text-rose-200 text-xs">
                • <span className="font-semibold font-mono">{err.kind}</span> en paso {err.stepId} ({new Date(err.at).toLocaleTimeString()})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* C. Historial de preguntas interactivas respondidas */}
      {answeredQuestions.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-slate-800">
          <div className="flex items-center gap-2 text-slate-200 font-semibold text-[13px]">
            <HelpCircle className="w-3.5 h-3.5 text-accent-400" />
            <span>Respuestas interactivas registradas ({answeredQuestions.length})</span>
          </div>
          <div className="flex flex-col gap-1.5 pl-5">
            {answeredQuestions.map((q, idx) => (
              <div key={q.key || idx} className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <div className="text-slate-500 mb-0.5 flex items-center justify-between text-[11px]">
                  <span>Paso {q.stepId}</span>
                  <span className="tabular-nums">{new Date(q.at).toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-200 whitespace-pre-wrap">{q.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D. Archivos y Referencias generadas (refs) */}
      {hasRefs && (
        <div className="flex flex-col gap-2 pt-1 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-[13px]">
              <FileText className="w-3.5 h-3.5 text-accent-400" />
              <span>Archivos y referencias generadas ({refs.length})</span>
            </div>
            <span className="text-[11px] text-slate-500">
              Resultados capturados en disco
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            {refs.map((r: RefDto) => {
              const formattedSize =
                r.size > 1024
                  ? `${(r.size / 1024).toFixed(1)} KB`
                  : `${r.size} car.`;

              return (
                <div
                  key={r.id}
                  className="flex flex-col justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-accent-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-300 font-mono font-semibold border border-accent-500/25 text-[11px]">
                        {r.id}
                      </span>
                      <span className="text-slate-100 text-xs font-medium truncate" title={r.label}>
                        {r.label || "Sin etiqueta"}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                      {formattedSize}
                    </span>
                  </div>

                  {r.where && (
                    <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 mt-1.5 truncate" title={r.where}>
                      <HardDrive className="w-3 h-3 shrink-0" />
                      <span className="truncate">{r.where}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-800">
                    <span className="text-[11px] text-slate-500 flex items-center gap-1 tabular-nums">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{new Date(r.at).toLocaleTimeString()}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onViewRef(r.id, r)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-accent-300 hover:text-accent-200 bg-accent-500/10 hover:bg-accent-500/20 border border-accent-500/25 transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>Ver contenido</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};