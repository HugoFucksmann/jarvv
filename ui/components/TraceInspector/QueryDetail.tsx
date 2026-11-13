import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";
import { CopyButton } from "../Shared/CopyButton.tsx";
import { ProbBars } from "./ProbBars.tsx";

type Answers = Record<string, { choice?: string; p?: Record<string, number> | null; noul?: number }>;

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

const Block: React.FC<{ title: string; text: string; defaultOpen?: boolean }> = ({ title, text, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-950/60 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/60">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-mono text-slate-300 hover:text-white cursor-pointer"
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>{title}</span>
          <span className="text-slate-600">· {text.length.toLocaleString()} car.</span>
        </button>
        <CopyButton
          text={text}
          title={`Copiar ${title}`}
          iconSize="w-3 h-3"
          className="gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800"
        />
      </div>
      {open && (
        <pre className="p-2.5 text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words max-h-[55vh] overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  );
};

/** Entrada: decisión → estado + preguntas; generativo → mensajes (system / user …) y parámetros. */
const InputPanel: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const parsed = useMemo(() => tryParse(query.rawInput), [query.rawInput]);
  if (query.rawInput === null) {
    return <p className="text-xs text-slate-500 font-mono">Entrada no disponible (solo se registró su huella: {query.inputHash ?? "—"}).</p>;
  }
  if (isRecord(parsed) && Array.isArray(parsed.messages)) {
    const { messages, ...params } = parsed as { messages: unknown[]; [k: string]: unknown };
    return (
      <div className="flex flex-col gap-2">
        {messages.map((m, i) => {
          const msg = isRecord(m) ? m : {};
          const role = typeof msg.role === "string" ? msg.role : `mensaje ${i + 1}`;
          return <Block key={i} title={role} text={pretty(msg.content ?? "")} defaultOpen={role !== "system" || messages.length === 1} />;
        })}
        {Object.keys(params).length > 0 && <Block title="parámetros" text={pretty(params)} defaultOpen={false} />}
      </div>
    );
  }
  if (isRecord(parsed) && ("state" in parsed || "questions" in parsed)) {
    const { state, questions, ...rest } = parsed;
    return (
      <div className="flex flex-col gap-2">
        {state !== undefined && <Block title="state" text={pretty(state)} />}
        {questions !== undefined && <Block title="questions" text={pretty(questions)} />}
        {Object.keys(rest).length > 0 && <Block title="otros" text={pretty(rest)} defaultOpen={false} />}
      </div>
    );
  }
  return <Block title="entrada cruda" text={query.rawInput} />;
};

const OutputPanel: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const out = query.output;
  const answers = stageInfo(query.stage).kind === "decision" && isRecord(out) ? (out as Answers) : null;
  const hasInterpreted = answers === null && out !== null && out !== undefined;
  return (
    <div className="flex flex-col gap-3">
      {query.error && (
        <div className="p-2.5 rounded-lg border border-rose-900/60 bg-rose-950/30 text-xs font-mono text-rose-300 whitespace-pre-wrap">
          Error: {query.error}
        </div>
      )}
      {answers && (
        <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
          <ProbBars answers={answers} offered={query.offered} />
        </div>
      )}
      {hasInterpreted && <Block title="salida interpretada" text={pretty(out)} />}
      {query.rawOutput !== null && <Block title="salida cruda" text={query.rawOutput} defaultOpen={!answers && !hasInterpreted} />}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[9px] uppercase tracking-wider text-slate-600 font-mono">{label}</span>
    <span className="text-xs font-mono text-slate-200 tabular-nums">{value}</span>
  </div>
);

export const QueryDetail: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const info = stageInfo(query.stage);
  const link = query.link.call ?? query.link.plan ?? query.link.fact ?? (query.link.result ? "respuesta" : null);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 py-3 border-b border-slate-800 bg-slate-950/50">
        <div className="flex flex-col mr-2">
          <span className="text-sm font-semibold text-slate-100">
            #{query.seq} · {info.code ? `${info.code} ` : ""}
            {info.label}
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            {query.model ?? "modelo desconocido"} · {info.kind === "decision" ? "decisión" : "generativo"}
          </span>
        </div>
        <Stat label="latencia" value={formatMs(query.durationMs)} />
        <Stat label="tokens in" value={query.tokens?.input ?? "—"} />
        <Stat label="tokens out" value={query.tokens?.output ?? "—"} />
        {query.finishReason && <Stat label="fin" value={query.finishReason} />}
        <Stat label="paso" value={query.step ?? "—"} />
        <Stat label="enlace" value={link ?? "—"} />
        <Stat label="n" value={query.n} />
        <Stat label="hash" value={query.inputHash ?? "—"} />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 xl:divide-x divide-slate-800 overflow-y-auto xl:overflow-hidden">
        <section className="min-h-0 xl:overflow-y-auto p-4 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Entrada</h3>
          <InputPanel query={query} />
        </section>
        <section className="min-h-0 xl:overflow-y-auto p-4 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Salida</h3>
          <OutputPanel query={query} />
        </section>
      </div>
    </div>
  );
};
