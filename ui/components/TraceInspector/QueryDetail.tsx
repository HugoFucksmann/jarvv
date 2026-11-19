import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Columns2, Rows2 } from "lucide-react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";
import { CopyButton } from "../Shared/CopyButton.tsx";
import { JsonText, JsonView } from "../Shared/JsonView.tsx";
import { ProbBars, type Answers } from "./ProbBars.tsx";

function tryParse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const pretty = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

const fmtInt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/** Finalizaciones que indican respuesta cortada por límite de tokens. */
const TRUNCATED = new Set(["length", "max_tokens"]);

/**
 * Sección plegable sin caja: cabecera ligera y contenido con una guía vertical.
 * `prose` usa tipografía de texto (prompts, mensajes); sin él, monoespaciada (JSON, salidas crudas).
 */
const Block: React.FC<{
  title: string;
  text: string;
  value?: unknown;
  defaultOpen?: boolean;
  prose?: boolean;
}> = ({ title, text, value, defaultOpen = true, prose = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="group/block min-w-0">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded py-0.5 text-xs text-slate-400 hover:text-slate-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span className="font-medium text-slate-300">{title}</span>
          <span className="font-mono text-[11px] text-slate-500">{text.length.toLocaleString()} car.</span>
        </button>
        <div className="opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
          <CopyButton
            text={text}
            title={`Copiar ${title}`}
            iconSize="w-3 h-3"
            className="gap-1 text-[11px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800"
          />
        </div>
      </div>
      {open &&
        (prose ? (
          <pre className="mt-1 ml-[7px] min-w-0 border-l border-slate-800 pl-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm leading-6 text-slate-200">
            {text}
          </pre>
        ) : (
          <div className="mt-1 ml-[7px] min-w-0 border-l border-slate-800 pl-4">
            {value !== undefined ? (
              <JsonView value={value} defaultDepth={3} />
            ) : (
              <JsonText text={text} defaultDepth={3} />
            )}
          </div>
        ))}
    </div>
  );
};

/** Entrada: decisión → estado + preguntas; generativo → mensajes (system / user …) y parámetros. */
const InputPanel: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const parsed = useMemo(() => tryParse(query.rawInput), [query.rawInput]);
  if (query.rawInput === null) {
    return (
      <p className="text-xs text-slate-500">
        Entrada no disponible: solo se registró su huella <span className="font-mono">{query.inputHash ?? "—"}</span>.
      </p>
    );
  }
  if (isRecord(parsed) && Array.isArray(parsed.messages)) {
    const { messages, ...params } = parsed as { messages: unknown[];[k: string]: unknown };
    return (
      <div className="flex flex-col gap-3">
        {messages.map((m, i) => {
          const msg = isRecord(m) ? m : {};
          const role = typeof msg.role === "string" ? msg.role : `mensaje ${i + 1}`;
          const content = msg.content ?? "";
          const isStr = typeof content === "string";
          return (
            <Block
              key={i}
              title={role}
              text={pretty(content)}
              value={isStr ? undefined : content}
              prose={isStr}
              defaultOpen={role !== "system" || messages.length === 1}
            />
          );
        })}
        {Object.keys(params).length > 0 && (
          <Block title="parámetros" text={pretty(params)} value={params} defaultOpen={false} />
        )}
      </div>
    );
  }
  if (isRecord(parsed) && ("state" in parsed || "questions" in parsed)) {
    const { state, questions, ...rest } = parsed;
    return (
      <div className="flex flex-col gap-3">
        {state !== undefined && (
          <Block
            title="state"
            text={pretty(state)}
            value={typeof state === "string" ? undefined : state}
          />
        )}
        {questions !== undefined && (
          <Block
            title="questions"
            text={pretty(questions)}
            value={typeof questions === "string" ? undefined : questions}
          />
        )}
        {Object.keys(rest).length > 0 && (
          <Block title="otros" text={pretty(rest)} value={rest} defaultOpen={false} />
        )}
      </div>
    );
  }
  return <Block title="entrada cruda" text={query.rawInput} />;
};

const OutputPanel: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const out = query.output;
  const answers = stageInfo(query.stage).kind === "decision" && isRecord(out) ? (out as Answers) : null;
  const hasInterpreted = answers === null && out !== null && out !== undefined;
  const isOutStr = typeof out === "string";
  return (
    <div className="flex flex-col gap-4">
      {query.error && (
        <div className="border-l-2 border-rose-500 pl-3 text-xs leading-relaxed text-rose-300 whitespace-pre-wrap break-words">
          <span className="font-semibold">Error</span>
          <br />
          {query.error}
        </div>
      )}
      {answers && <ProbBars answers={answers} offered={query.offered} stage={query.stage} />}
      {hasInterpreted && (
        <Block
          title="salida interpretada"
          text={pretty(out)}
          value={isOutStr ? undefined : out}
          prose={isOutStr}
        />
      )}
      {query.rawOutput !== null && (
        <Block title="salida cruda" text={query.rawOutput} defaultOpen={!answers && !hasInterpreted} />
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; muted?: boolean; warn?: boolean }> = ({
  label,
  value,
  muted = false,
  warn = false,
}) => (
  <div className="flex flex-col">
    <span className="text-[11px] text-slate-500">{label}</span>
    <span
      className={`font-mono tabular-nums ${muted ? "text-xs text-slate-400" : warn ? "text-sm font-medium text-yellow-300" : "text-sm font-medium text-slate-100"
        }`}
    >
      {value}
    </span>
  </div>
);

type SplitLayout = "stacked" | "columns";

const SPLIT_PCT_KEY = "traceInspector.detailSplitPct";
const SPLIT_LAYOUT_KEY = "traceInspector.detailSplitLayout";
const DEFAULT_SPLIT = 54;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

const clampSplit = (pct: number) => Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, Math.round(pct * 10) / 10));

function readSplitPct(): number {
  try {
    const raw = Number(localStorage.getItem(SPLIT_PCT_KEY));
    return Number.isFinite(raw) && raw >= MIN_SPLIT && raw <= MAX_SPLIT ? raw : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

function readSplitLayout(): SplitLayout {
  try {
    return localStorage.getItem(SPLIT_LAYOUT_KEY) === "columns" ? "columns" : "stacked";
  } catch {
    return "stacked";
  }
}

export const QueryDetail: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const info = stageInfo(query.stage);
  const isDecision = info.kind === "decision";
  const link = query.link.call ?? query.link.plan ?? query.link.fact ?? (query.link.result ? "respuesta" : null);
  const truncated = query.finishReason != null && TRUNCATED.has(query.finishReason);

  const [layout, setLayout] = useState<SplitLayout>(readSplitLayout);
  const [splitPct, setSplitPct] = useState<number>(readSplitPct);
  const [dragging, setDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const updateSplit = useCallback((next: number) => {
    const clamped = clampSplit(next);
    setSplitPct(clamped);
    try {
      localStorage.setItem(SPLIT_PCT_KEY, String(clamped));
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  const changeLayout = (next: SplitLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(SPLIT_LAYOUT_KEY, next);
    } catch {
      /* sin almacenamiento */
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (layout === "stacked") {
        if (rect.height <= 0) return;
        updateSplit(((e.clientY - rect.top) / rect.height) * 100);
      } else {
        if (rect.width <= 0) return;
        updateSplit(((e.clientX - rect.left) / rect.width) * 100);
      }
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragging, layout, updateSplit]);

  const handleSeparatorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 4;
    const dec = layout === "stacked" ? "ArrowUp" : "ArrowLeft";
    const inc = layout === "stacked" ? "ArrowDown" : "ArrowRight";
    if (e.key === dec) {
      e.preventDefault();
      updateSplit(splitPct - step);
    } else if (e.key === inc) {
      e.preventDefault();
      updateSplit(splitPct + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      updateSplit(DEFAULT_SPLIT);
    }
  };

  const isStacked = layout === "stacked";

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <header className="shrink-0 flex flex-col gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="flex items-baseline gap-2 text-base font-semibold text-slate-50">
            <span className="font-mono text-xs font-normal text-slate-500">#{query.seq}</span>
            {info.code && (
              <span className={`font-mono text-sm ${isDecision ? "text-accent-400" : "text-slate-400"}`}>{info.code}</span>
            )}
            {info.label}
          </h3>
          {query.error && <span className="text-xs font-medium text-rose-400">Con error</span>}
          <div className="flex items-center gap-3 sm:ml-auto">
            <span className="text-xs text-slate-500">
              <span className="font-mono">{query.model ?? "modelo desconocido"}</span>, {isDecision ? "decisión" : "generativo"}
            </span>
            <div
              role="group"
              aria-label="Disposición de Entrada y Salida"
              className="flex items-center rounded-md border border-slate-800 bg-slate-950 p-0.5"
            >
              <button
                type="button"
                onClick={() => changeLayout("stacked")}
                aria-pressed={isStacked}
                title="Entrada arriba y Salida abajo (divisor vertical)"
                className={`rounded p-1 transition-colors cursor-pointer ${
                  isStacked ? "bg-slate-800 text-accent-300" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                <Rows2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => changeLayout("columns")}
                aria-pressed={!isStacked}
                title="Entrada y Salida en columnas"
                className={`rounded p-1 transition-colors cursor-pointer ${
                  !isStacked ? "bg-slate-800 text-accent-300" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <Stat label="Latencia" value={formatMs(query.durationMs)} />
          <Stat label="Tokens (entrada → salida)" value={`${fmtInt(query.tokens?.input)} → ${fmtInt(query.tokens?.output)}`} />
          {query.finishReason && <Stat label="Fin" value={query.finishReason} warn={truncated} />}
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2 sm:ml-auto">
            <Stat muted label="Paso" value={query.step ?? "—"} />
            <Stat muted label="Enlace" value={link ?? "—"} />
            <Stat muted label="n" value={query.n} />
            <Stat muted label="Hash" value={query.inputHash ?? "—"} />
          </div>
        </div>
      </header>
      <div
        ref={splitContainerRef}
        className={`flex-1 min-h-0 min-w-0 flex overflow-hidden ${isStacked ? "flex-col" : "flex-row"} ${
          dragging ? "select-none" : ""
        }`}
      >
        <section
          style={{ flexBasis: `${splitPct}%` }}
          className="shrink-0 grow-0 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-4 flex flex-col gap-3"
        >
          <h4 className="text-xs font-medium text-slate-500">Entrada</h4>
          <InputPanel query={query} />
        </section>

        <div
          role="separator"
          tabIndex={0}
          aria-orientation={isStacked ? "horizontal" : "vertical"}
          aria-label="Ajustar tamaño entre Entrada y Salida"
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          aria-valuenow={Math.round(splitPct)}
          title={
            isStacked
              ? "Arrastrá arriba o abajo para ajustar altura (doble clic para restablecer)"
              : "Arrastrá a izquierda o derecha para ajustar ancho (doble clic para restablecer)"
          }
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => updateSplit(DEFAULT_SPLIT)}
          onKeyDown={handleSeparatorKeyDown}
          className={`shrink-0 touch-none flex items-center justify-center bg-slate-950/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70 group/sep ${
            isStacked
              ? "h-2.5 w-full cursor-row-resize border-y border-slate-800 hover:bg-slate-800/70"
              : "w-2.5 h-full cursor-col-resize border-x border-slate-800 hover:bg-slate-800/70"
          } ${dragging ? "bg-slate-800" : ""}`}
        >
          <span
            aria-hidden="true"
            className={`rounded-full transition-colors ${
              isStacked ? "h-0.5 w-10" : "w-0.5 h-10"
            } ${dragging ? "bg-accent-400" : "bg-slate-700 group-hover/sep:bg-accent-400"}`}
          />
        </div>

        <section className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-4 flex flex-col gap-3">
          <h4 className="text-xs font-medium text-slate-500">Salida</h4>
          <OutputPanel query={query} />
        </section>
      </div>
    </div>
  );
};