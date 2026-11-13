import React, { useRef } from "react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";
import { LOW_CONFIDENCE, type Answers } from "./ProbBars.tsx";

/** Lo decidido en una línea: opción elegida y su probabilidad (amarillo si es baja), o tokens de salida. */
const Brief: React.FC<{ query: TraceQuery }> = ({ query: q }) => {
  if (q.error) return <span className="text-rose-400">error</span>;
  const out = q.output;
  if (typeof out === "object" && out !== null && !Array.isArray(out) && stageInfo(q.stage).kind === "decision") {
    return (
      <>
        {Object.entries(out as Answers).map(([k, a], i) => {
          const sep = i > 0 ? <span className="text-slate-600"> · </span> : null;
          if (a.choice !== undefined) {
            const p = a.p?.[a.choice] ?? 0;
            return (
              <span key={k}>
                {sep}
                <span className="text-slate-200">{a.choice}</span>{" "}
                <span className={p < LOW_CONFIDENCE ? "text-yellow-400" : "text-slate-500"}>{Math.round(p * 100)}%</span>
              </span>
            );
          }
          if (typeof a.noul === "number") {
            return (
              <span key={k}>
                {sep}
                {k} {a.noul.toFixed(2)}
              </span>
            );
          }
          return (
            <span key={k}>
              {sep}
              {k}
            </span>
          );
        })}
      </>
    );
  }
  return <>{q.tokens?.output != null ? `${q.tokens.output} tok` : ""}</>;
};

interface Props {
  queries: TraceQuery[];
  selected: number | null;
  onSelect: (seq: number) => void;
  /** Modo riel: solo número y código de cada consulta. Las filas mantienen su tamaño para que no salten al expandir. */
  compact?: boolean;
}

/** Consultas agrupadas por paso (las del plan, pendientes y respuesta final no tienen paso). */
export const QueryList: React.FC<Props> = ({ queries, selected, onSelect, compact = false }) => {
  const rootRef = useRef<HTMLDivElement>(null);

  const groups: { key: string; label: string; items: TraceQuery[] }[] = [];
  for (const q of queries) {
    const key = q.step ?? "_";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(q);
    else groups.push({ key, label: q.step ? `Paso ${q.step}` : "Fuera de paso", items: [q] });
  }

  // La consulta más lenta se resalta para localizar cuellos de botella de un vistazo.
  const maxMs = queries.length > 1 ? Math.max(...queries.map((q) => q.durationMs)) : 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = queries.findIndex((q) => q.seq === selected);
    const next = queries[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    onSelect(next.seq);
    rootRef.current?.querySelector<HTMLElement>(`[data-seq="${next.seq}"]`)?.focus();
  };

  const fade = `transition-opacity duration-150 motion-reduce:transition-none ${compact ? "opacity-0" : "opacity-100"}`;

  return (
    <div ref={rootRef} onKeyDown={handleKeyDown} className="flex flex-col pb-2">
      {groups.map((g, gi) => (
        <div key={`${g.key}-${gi}`} className="flex flex-col">
          <div className={`w-80 whitespace-nowrap px-3 pt-3 pb-1 text-[11px] text-slate-500 ${fade}`}>{g.label}</div>
          {g.items.map((q) => {
            const info = stageInfo(q.stage);
            const active = q.seq === selected;
            const isDecision = info.kind === "decision";
            const slowest = maxMs > 0 && q.durationMs === maxMs;
            return (
              <button
                key={q.seq}
                type="button"
                data-seq={q.seq}
                onClick={() => onSelect(q.seq)}
                aria-current={active ? "true" : undefined}
                title={`${q.seq} · ${info.label}`}
                className={`relative block w-80 py-1.5 pl-2.5 pr-4 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-slate-800/70 ${active ? "bg-slate-800/60" : "hover:bg-slate-900"
                  }`}
              >
                {active && <span className="absolute left-0 inset-y-1 w-0.5 rounded-full bg-accent-400" />}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="w-5 text-right font-mono text-[11px] tabular-nums text-slate-500">{q.seq}</span>
                  <span
                    className={`w-7 text-center font-mono text-[11px] font-medium ${q.error ? "text-rose-400" : isDecision ? "text-accent-400" : "text-slate-400"
                      }`}
                  >
                    {info.code ?? (isDecision ? "D" : "LLM")}
                  </span>
                  <span
                    className={`truncate ${fade} ${q.error ? "text-rose-300" : active ? "font-medium text-slate-50" : "text-slate-300"
                      }`}
                  >
                    {info.label}
                  </span>
                  <span
                    className={`ml-auto font-mono text-[11px] tabular-nums ${fade} ${slowest ? "text-yellow-300" : "text-slate-500"
                      }`}
                    title={slowest ? "Consulta más lenta" : undefined}
                  >
                    {formatMs(q.durationMs)}
                  </span>
                </div>
                <div className={`mt-0.5 h-4 truncate pl-[3.75rem] text-[11px] text-slate-500 ${fade}`}>
                  <Brief query={q} />
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};