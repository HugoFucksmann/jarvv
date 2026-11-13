import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle, RefreshCw, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

const PIN_KEY = "traceInspector.railPinned";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60";

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) !== "0";
  } catch {
    return true;
  }
}

export const TraceInspector: React.FC<Props> = ({ taskId, initialCallId = null }) => {
  const [queries, setQueries] = useState<TraceQuery[] | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [rawMissing, setRawMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [onlyCall, setOnlyCall] = useState<string | null>(initialCallId);

  // Lista lateral: fijada (siempre abierta) o riel que se expande al pasar el ratón / con el teclado.
  const [pinned, setPinned] = useState(readPinned);
  const [hovered, setHovered] = useState(false);
  const [kbFocus, setKbFocus] = useState(false);
  // Tras contraer a propósito, el riel no se reabre por hover/foco hasta que el puntero o el foco salgan de él.
  // Sin esto, el ratón sigue encima del botón que se acaba de pulsar y el panel se queda abierto como
  // superposición mientras el contenido ya ocupó su sitio (queda oculto por detrás).
  const [suppressed, setSuppressed] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expanded = pinned || (!suppressed && (hovered || kbFocus));

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
  }, [taskId, initialCallId, attempt]);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const scheduleHover = (value: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // Pequeña espera para que un roce accidental no abra el panel ni un instante fuera lo cierre.
    hoverTimer.current = setTimeout(
      () => {
        setHovered(value);
        // El puntero salió del todo: el riel vuelve a poder expandirse con el ratón.
        if (!value) setSuppressed(false);
      },
      value ? 80 : 200,
    );
  };

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    // Al contraer se bloquea la reapertura por hover/foco; al fijar no hace falta.
    setSuppressed(!next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      /* sin almacenamiento: se queda solo en memoria */
    }
  };

  const visible = useMemo(
    () => (queries === null ? [] : onlyCall ? queries.filter((q) => q.link.call === onlyCall) : queries),
    [queries, onlyCall],
  );
  const current = visible.find((q) => q.seq === selected) ?? visible[0] ?? null;

  if (error) {
    return (
      <div role="alert" className="mx-auto mt-10 flex max-w-xl items-start gap-3 border-l-2 border-yellow-500 pl-4 text-xs">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-yellow-200">No se pudieron cargar las consultas</span>
          <span className="break-words text-slate-300">{error}</span>
          <span className="text-xs text-slate-500">
            Las trazas requieren <code className="font-mono text-accent-300">traceEnabled</code> y una tarea terminada.
          </span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={`mt-1 flex items-center gap-1.5 self-start rounded px-2 py-1 text-slate-200 hover:bg-slate-800 cursor-pointer ${FOCUS_RING}`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (queries === null) {
    return (
      <div role="status" className="flex h-full flex-col items-center justify-center gap-2 text-xs text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-accent-400" />
        Cargando consultas…
      </div>
    );
  }

  const totalLlm = queries.reduce((s, q) => s + q.durationMs, 0);

  return (
    <div className="flex h-full min-h-0">
      {/* Lista lateral. El contenedor reserva el ancho; el panel se superpone al expandirse con el ratón. */}
      <div
        className={`relative shrink-0 transition-[width] duration-150 motion-reduce:transition-none ${pinned ? "w-80" : "w-16"}`}
        onMouseEnter={() => scheduleHover(true)}
        onMouseLeave={() => scheduleHover(false)}
        onFocus={(e) => {
          if (e.target.matches(":focus-visible")) setKbFocus(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setKbFocus(false);
            // El foco salió: si el puntero tampoco está encima, se levanta el bloqueo.
            if (!hovered) setSuppressed(false);
          }
        }}
      >
        <aside
          aria-label="Lista de consultas"
          className={`absolute inset-y-0 left-0 z-20 flex flex-col overflow-hidden border-r border-slate-800 bg-slate-950 transition-[width,box-shadow] duration-150 motion-reduce:transition-none ${expanded ? "w-80" : "w-16"
            } ${expanded && !pinned ? "shadow-2xl shadow-black/60" : ""}`}
        >
          <div className="flex h-10 w-80 shrink-0 items-center gap-2 border-b border-slate-800 pl-4">
            <button
              type="button"
              onClick={togglePinned}
              aria-expanded={pinned}
              aria-label={pinned ? "Contraer la lista de consultas" : "Fijar la lista de consultas abierta"}
              title={pinned ? "Contraer lista" : "Fijar lista abierta"}
              className={`rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer ${FOCUS_RING}`}
            >
              {pinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
            <span
              className={`whitespace-nowrap text-xs text-slate-400 transition-opacity duration-150 motion-reduce:transition-none ${expanded ? "opacity-100" : "opacity-0"
                }`}
            >
              <span className="font-medium text-slate-200">{visible.length}</span>
              {onlyCall ? ` de ${queries.length}` : ""} {visible.length === 1 ? "consulta" : "consultas"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <QueryList queries={visible} selected={current?.seq ?? null} onSelect={setSelected} compact={!expanded} />
          </div>
        </aside>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-4 border-b border-slate-800 px-5 text-xs">
          <span className="text-slate-500">
            Tiempo en modelos <span className="font-mono text-slate-200">{formatMs(totalLlm)}</span>
            {totalMs ? (
              <>
                {" "}
                de <span className="font-mono text-slate-400">{formatMs(totalMs)}</span>
              </>
            ) : null}
          </span>
          {rawMissing && <span className="text-yellow-400">Entradas y salidas crudas no disponibles</span>}
          {onlyCall && (
            <span className="ml-auto flex items-center gap-2 text-slate-500">
              Llamada <span className="font-mono text-slate-300">{onlyCall}</span>
              <button
                type="button"
                onClick={() => setOnlyCall(null)}
                className={`rounded px-1.5 py-0.5 text-accent-300 hover:bg-slate-800 cursor-pointer ${FOCUS_RING}`}
              >
                Ver todas
              </button>
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {current ? (
            <QueryDetail key={current.seq} query={current} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-slate-500">
              <span>No hay consultas para mostrar.</span>
              {onlyCall && (
                <button
                  type="button"
                  onClick={() => setOnlyCall(null)}
                  className={`rounded px-2 py-1 text-accent-300 hover:bg-slate-800 cursor-pointer ${FOCUS_RING}`}
                >
                  Ver todas las consultas
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};