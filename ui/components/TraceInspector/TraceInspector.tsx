import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { jarvisApi } from "../../services/jarvisApi.ts";
import type { FullTrace, SlimTrace, TraceQuery } from "../../types/trace.ts";
import { formatMs } from "../../utils/traceStages.ts";
import { QueryList } from "./QueryList.tsx";
import { QueryDetail } from "./QueryDetail.tsx";

interface Props {
  taskId: string;
  /** Si viene, la lista se filtra a las consultas enlazadas a esa llamada. */
  initialCallId?: string | null;
}

export const TraceInspector: React.FC<Props> = ({ taskId, initialCallId = null }) => {
  const [queries, setQueries] = useState<TraceQuery[] | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [rawMissing, setRawMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [onlyCall, setOnlyCall] = useState<string | null>(initialCallId);

  useEffect(() => {
    let alive = true;
    setQueries(null);
    setError(null);
    Promise.all([
      jarvisApi.getTrace(taskId, "json").then((t) => JSON.parse(t) as SlimTrace),
      jarvisApi.getTrace(taskId, "full").then((t) => JSON.parse(t) as FullTrace).catch(() => null),
    ])
      .then(([slim, full]) => {
        if (!alive) return;
        const raw = new Map((full?.models ?? []).map((m) => [m.seq, m]));
        setRawMissing(full === null);
        setTotalMs(slim.durationMs);
        const merged: TraceQuery[] = slim.queries.map((q) => ({
          ...q,
          rawInput: raw.get(q.seq)?.input ?? null,
          rawOutput: raw.get(q.seq)?.output ?? null,
        }));
        setQueries(merged);
        const first = initialCallId ? merged.find((q) => q.link.call === initialCallId) : undefined;
        setSelected((first ?? merged[0])?.seq ?? null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "No hay traza para esta tarea.");
      });
    return () => {
      alive = false;
    };
  }, [taskId, initialCallId]);

  const visible = useMemo(
    () => (queries === null ? [] : onlyCall ? queries.filter((q) => q.link.call === onlyCall) : queries),
    [queries, onlyCall],
  );
  const current = visible.find((q) => q.seq === selected) ?? visible[0] ?? null;

  if (error) {
    return (
      <div className="m-6 flex items-start gap-3 p-4 border border-amber-900/50 rounded-lg text-amber-300 text-xs">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>
          {error} Las trazas requieren <code className="text-purple-300">traceEnabled</code> y una tarea terminada.
        </span>
      </div>
    );
  }
  if (queries === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-400 text-xs font-mono">
        <Loader2 className="w-5 h-5 animate-spin text-purple-400" /> Cargando consultas…
      </div>
    );
  }

  const totalLlm = queries.reduce((s, q) => s + q.durationMs, 0);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 text-[11px] font-mono text-slate-500 border-b border-slate-800">
        <span>{queries.length} consultas</span>
        <span>
          modelos: {formatMs(totalLlm)}
          {totalMs ? ` de ${formatMs(totalMs)}` : ""}
        </span>
        {rawMissing && <span className="text-amber-400">entradas crudas no disponibles</span>}
        {onlyCall && (
          <button
            type="button"
            onClick={() => setOnlyCall(null)}
            className="ml-auto px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer"
          >
            Llamada {onlyCall} · ver todas
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[18rem_1fr] 2xl:grid-cols-[21rem_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-800 bg-slate-950/40">
          <QueryList queries={visible} selected={current?.seq ?? null} onSelect={setSelected} />
        </aside>
        <main className="min-h-0 min-w-0">
          {current ? (
            <QueryDetail query={current} />
          ) : (
            <p className="p-6 text-xs text-slate-500 font-mono">Sin consultas para mostrar.</p>
          )}
        </main>
      </div>
    </div>
  );
};
