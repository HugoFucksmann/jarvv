import React from "react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";

type Answers = Record<string, { choice?: string; p?: Record<string, number> | null; noul?: number }>;

/** Resumen de una línea de lo decidido: opción elegida y su probabilidad, o los tokens de salida del generativo. */
function brief(q: TraceQuery): string {
  const out = q.output;
  if (q.error) return "error";
  if (typeof out === "object" && out !== null && !Array.isArray(out) && stageInfo(q.stage).kind === "decision") {
    return Object.entries(out as Answers)
      .map(([k, a]) => {
        if (a.choice !== undefined) return `${a.choice} ${Math.round((a.p?.[a.choice] ?? 0) * 100)}%`;
        if (typeof a.noul === "number") return `${k} ${a.noul.toFixed(2)}`;
        return k;
      })
      .join(" · ");
  }
  return q.tokens?.output != null ? `${q.tokens.output} tok` : "";
}

interface Props {
  queries: TraceQuery[];
  selected: number | null;
  onSelect: (seq: number) => void;
}

/** Consultas agrupadas por paso (las del plan, pendientes y respuesta final no tienen paso). */
export const QueryList: React.FC<Props> = ({ queries, selected, onSelect }) => {
  const groups: { key: string; label: string; items: TraceQuery[] }[] = [];
  for (const q of queries) {
    const key = q.step ?? "_";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(q);
    else groups.push({ key, label: q.step ? `Paso ${q.step}` : "Fuera de paso", items: [q] });
  }
  return (
    <div className="flex flex-col gap-3 p-2">
      {groups.map((g, gi) => (
        <div key={`${g.key}-${gi}`} className="flex flex-col gap-0.5">
          <div className="px-2 text-[10px] uppercase tracking-wider text-slate-600 font-mono">{g.label}</div>
          {g.items.map((q) => {
            const info = stageInfo(q.stage);
            const active = q.seq === selected;
            return (
              <button
                key={q.seq}
                type="button"
                onClick={() => onSelect(q.seq)}
                className={`text-left px-2 py-1.5 rounded-md border transition-colors cursor-pointer ${
                  active ? "bg-slate-800/80 border-sky-700/60" : "border-transparent hover:bg-slate-900"
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-600 tabular-nums w-5">{q.seq}</span>
                  <span
                    className={`font-mono text-[10px] px-1 rounded ${
                      info.kind === "decision" ? "bg-sky-950 text-sky-300" : "bg-violet-950 text-violet-300"
                    }`}
                  >
                    {info.code ?? (info.kind === "decision" ? "D" : "LLM")}
                  </span>
                  <span className={`truncate ${q.error ? "text-rose-300" : "text-slate-200"}`}>{info.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-500 tabular-nums">{formatMs(q.durationMs)}</span>
                </div>
                <div className="pl-7 text-[11px] font-mono text-slate-500 truncate">{brief(q)}</div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
