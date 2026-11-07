import React from "react";
import { Terminal, Cpu, FileText, ExternalLink, HelpCircle, AlertCircle, HardDrive, Clock } from "lucide-react";
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
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm text-xs font-mono">
      {/* A. Proceso en segundo plano activo */}
      {backgroundProcess && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-emerald-200">
          <Cpu className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-emerald-300">
                PROCESO EN SEGUNDO PLANO ACTIVO
              </span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-900/60 text-emerald-300 text-[11px] font-bold">
                PID / ID: {String(backgroundProcess.value)}
              </span>
              {backgroundProcess.stepId && (
                <span className="text-slate-400 text-[11px]">
                  (Iniciado en {backgroundProcess.stepId})
                </span>
              )}
            </div>
            <p className="text-[12px] text-emerald-100/90 font-sans leading-relaxed">
              La tarea finalizó dejando este proceso en ejecución continua en su equipo (p. ej., un servidor o monitoreo). Sigue activo de forma independiente.
            </p>
          </div>
        </div>
      )}

      {/* B. Errores de servicio no disponible */}
      {hasErrors && (
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-rose-950/30 border border-rose-900/50">
          <div className="flex items-center gap-2 text-rose-300 font-semibold">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>INCIDENCIAS DE SERVICIO DETECTADAS ({errors.length})</span>
          </div>
          <div className="flex flex-col gap-1 pl-6">
            {errors.map((err, i) => (
              <div key={err.id || i} className="text-rose-200 text-[11px]">
                • <span className="font-bold">{err.kind}</span> en paso {err.stepId} ({new Date(err.at).toLocaleTimeString()})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* C. Historial de preguntas interactivas respondidas */}
      {answeredQuestions.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-2 text-slate-300 font-semibold text-[11px]">
            <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
            <span>RESPUESTAS INTERACTIVAS REGISTRADAS ({answeredQuestions.length})</span>
          </div>
          <div className="flex flex-col gap-1.5 pl-5">
            {answeredQuestions.map((q, idx) => (
              <div key={q.key || idx} className="p-2 rounded bg-slate-950/70 border border-slate-800/80 text-[11px]">
                <div className="text-slate-400 mb-0.5 flex items-center justify-between">
                  <span>Paso {q.stepId}</span>
                  <span>{new Date(q.at).toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-200 font-sans whitespace-pre-wrap">{q.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D. Archivos y Referencias generadas (refs) */}
      {hasRefs && (
        <div className="flex flex-col gap-2 pt-1 border-t border-slate-800/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold text-[11px]">
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>ARCHIVOS Y REFERENCIAS GENERADAS ({refs.length})</span>
            </div>
            <span className="text-[10px] text-slate-500">
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
                  className="flex flex-col justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-cyan-800/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 font-bold border border-cyan-800/60 text-[11px]">
                        {r.id}
                      </span>
                      <span className="text-slate-200 font-sans text-xs font-medium truncate" title={r.label}>
                        {r.label || "Sin etiqueta"}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                      {formattedSize}
                    </span>
                  </div>

                  {r.where && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1.5 truncate" title={r.where}>
                      <HardDrive className="w-3 h-3 shrink-0" />
                      <span className="truncate">{r.where}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{new Date(r.at).toLocaleTimeString()}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onViewRef(r.id, r)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cyan-300 hover:text-white bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-800/60 transition-colors cursor-pointer"
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

