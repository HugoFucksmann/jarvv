import type React from "react";
import { useRef } from "react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";
import { analyzeNoul, LOW_CONFIDENCE, type Answers } from "./ProbBars.tsx";

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
            const noul = analyzeNoul(a.noul, q.stage);
            const isDoubt = noul.zone === "duda";
            const side = noul.yes >= noul.no ? `sí ${noul.yesPctText}` : `no ${noul.noPctText}`;
            return (
              <span
                key={k}
                title={`${k}: sí ${noul.yesPctText} / no ${noul.noPctText} (${noul.zone})`}
              >
                {sep}
                <span className="text-slate-200">{k}</span>{" "}
                <span className={isDoubt ? "text-yellow-400" : "text-slate-400"}>
                  {side}
                </span>
                {isDoubt && <span className="text-yellow-400"> · duda</span>}
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

  const fade = `transition-opacity duration-150 motion-reduce:transition-none ${compact ? "opacity-0 pointer-events-none" : "opacity-100"}`;
  const compactFade = `transition-opacity duration-150 motion-reduce:transition-none ${compact ? "opacity-100" : "opacity-0 pointer-events-none"}`;

  return (
    <div ref={rootRef} onKeyDown={handleKeyDown} className="flex flex-col pb-2">
      {groups.map((g, gi) => (
        <div key={`${g.key}-${gi}`} className="flex flex-col">
          <div className="relative w-80 pt-3 pb-1">
            <div
              aria-hidden={!compact}
              className={`absolute inset-y-0 left-0 flex w-[4.625rem] items-center justify-center gap-1 px-2 pt-3 pb-1 ${compactFade}`}
            >
              <span className="h-px flex-1 bg-slate-800" />
              <span className="font-mono text-[10px] text-slate-500">
                {g.key === "_" ? "·" : g.key}
              </span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>
            <div className={`whitespace-nowrap px-3 text-[11px] text-slate-500 ${fade}`}>
              {g.label}
            </div>
          </div>

          {g.items.map((q) => {
            const info = stageInfo(q.stage);
            const active = q.seq === selected;
            const isDecision = info.kind === "decision";
            const slowest = maxMs > 0 && q.durationMs === maxMs;
            const shortCode = info.code ?? info.short ?? (isDecision ? "D" : "LLM");

            return (
              <button
                key={q.seq}
                type="button"
                data-seq={q.seq}
                onClick={() => onSelect(q.seq)}
                aria-current={active ? "true" : undefined}
                title={`${q.seq} · ${info.label} (${formatMs(q.durationMs)})`}
                className={`relative block w-80 py-1.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-slate-800/70 ${active ? "bg-slate-800/70" : "hover:bg-slate-900"
                  }`}
              >
                {active && <span className="absolute left-0 inset-y-1 w-0.5 rounded-full bg-accent-400" />}

                <div className="flex items-center text-xs">
                  <div className="flex w-[4.625rem] shrink-0 items-center gap-1.5 pl-2 pr-1">
                    <span className="w-5 text-right font-mono text-[11px] tabular-nums text-slate-500">
                      {q.seq}
                    </span>
                    <span
                      className={`w-8 rounded py-px text-center font-mono text-[11px] font-medium ${q.error
                          ? "bg-rose-950/60 text-rose-300"
                          : isDecision
                            ? "bg-accent-500/10 text-accent-300"
                            : "bg-slate-800/90 text-slate-300"
                        }`}
                    >
                      {shortCode}
                    </span>
                  </div>

                  <div className={`flex min-w-0 flex-1 items-center gap-2 pl-1.5 pr-4 ${fade}`}>
                    <span
                      className={`truncate ${q.error ? "text-rose-300" : active ? "font-medium text-slate-50" : "text-slate-300"
                        }`}
                    >
                      {info.label}
                    </span>
                    <span
                      className={`ml-auto shrink-0 font-mono text-[11px] tabular-nums ${slowest ? "text-yellow-300" : "text-slate-500"
                        }`}
                      title={slowest ? "Consulta más lenta" : undefined}
                    >
                      {formatMs(q.durationMs)}
                    </span>
                  </div>
                </div>

                <div className="relative mt-0.5 h-4 text-[11px]">
                  <div
                    aria-hidden={!compact}
                    className={`absolute inset-y-0 left-0 flex w-[4.625rem] items-center justify-end pr-2 font-mono text-[10px] tabular-nums ${compactFade} ${q.error ? "text-rose-400" : slowest ? "text-yellow-300" : "text-slate-500"
                      }`}
                  >
                    {q.error ? "error" : formatMs(q.durationMs)}
                  </div>
                  <div className={`truncate pl-[5rem] pr-4 text-slate-500 ${fade}`}>
                    <Brief query={q} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};