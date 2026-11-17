import React, { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Clock, History, ArrowUpRight } from "lucide-react";
import type { RecalledDto } from "../../../types/api.ts";

interface RecalledContextProps {
  recalled: RecalledDto[];
  availableTaskIds?: Set<string>;
  onSelectTask?: (taskId: string) => void;
}

const THREAD_KEY_LABELS: Record<string, string> = {
  previous_request: "Consulta previa",
  previous_answer: "Respuesta previa",
};

function formatRecalledKey(entry: RecalledDto): string {
  if (entry.source === "thread" && THREAD_KEY_LABELS[entry.key]) {
    return THREAD_KEY_LABELS[entry.key];
  }
  return entry.key;
}

export const RecalledContext: React.FC<RecalledContextProps> = ({
  recalled,
  availableTaskIds,
  onSelectTask,
}) => {
  const [expanded, setExpanded] = useState<boolean>(() => recalled.length <= 4);

  if (!recalled || recalled.length === 0) return null;

  const memoryCount = recalled.filter((r) => r.source === "user_memory").length;
  const threadCount = recalled.filter((r) => r.source === "thread").length;

  const summaryParts: string[] = [];
  if (memoryCount > 0) summaryParts.push(`${memoryCount} de memoria`);
  if (threadCount > 0) summaryParts.push(`${threadCount} de hilo previo`);

  return (
    <section
      aria-label="Contexto recordado"
      className="flex flex-col rounded-xl bg-slate-900/50 border border-slate-800 text-xs"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-slate-900/80 rounded-xl transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <Brain className="w-3.5 h-3.5 text-accent-400 shrink-0" />
          <span className="font-semibold text-slate-200">
            Contexto recordado ({recalled.length})
          </span>
          {summaryParts.length > 0 && (
            <span className="text-slate-400">
              · {summaryParts.join(" · ")}
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">
          {expanded ? "Ocultar" : "Ver detalle"}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col divide-y divide-slate-800/80 border-t border-slate-800 max-h-64 overflow-y-auto px-3.5">
          {recalled.map((entry, idx) => {
            const isThread = entry.source === "thread";
            const canJumpToSource = Boolean(
              entry.from && onSelectTask && (!availableTaskIds || availableTaskIds.has(entry.from))
            );
            const displayKey = formatRecalledKey(entry);
            const rawKeyDifferent = displayKey !== entry.key;

            return (
              <div key={entry.id || `${entry.source}-${entry.key}-${idx}`} className="py-2.5 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="flex items-center gap-1 font-medium text-accent-300">
                      {isThread ? (
                        <History className="w-3 h-3 shrink-0" />
                      ) : (
                        <Brain className="w-3 h-3 shrink-0" />
                      )}
                      <span>{isThread ? "Hilo previo" : "Memoria de usuario"}</span>
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-200 font-medium">
                      {displayKey}
                      {rawKeyDifferent && (
                        <span className="font-mono text-slate-500 font-normal ml-1">
                          ({entry.key})
                        </span>
                      )}
                    </span>
                    {entry.stepId && (
                      <>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono text-slate-400">Paso {entry.stepId}</span>
                      </>
                    )}
                    {entry.from && (
                      <>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        {canJumpToSource ? (
                          <button
                            type="button"
                            onClick={() => onSelectTask?.(entry.from!)}
                            title={`Abrir tarea origen ${entry.from}`}
                            className="inline-flex items-center gap-0.5 font-mono text-accent-300 hover:text-accent-200 underline underline-offset-2 cursor-pointer"
                          >
                            <span>{entry.from}</span>
                            <ArrowUpRight className="w-2.5 h-2.5" />
                          </button>
                        ) : (
                          <span className="font-mono text-slate-400" title={`Tarea origen: ${entry.from}`}>
                            origen: {entry.from}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {entry.at && (
                    <span className="flex items-center gap-1 text-slate-500 tabular-nums shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{new Date(entry.at).toLocaleTimeString()}</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed pl-4">
                  {entry.value}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
