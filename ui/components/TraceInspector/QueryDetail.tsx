import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TraceQuery } from "../../types/trace.ts";
import { formatMs, stageInfo } from "../../utils/traceStages.ts";
import { CopyButton } from "../Shared/CopyButton.tsx";
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
const Block: React.FC<{ title: string; text: string; defaultOpen?: boolean; prose?: boolean }> = ({
  title,
  text,
  defaultOpen = true,
  prose = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="group/block">
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
      {open && (
        <pre
          className={`mt-1 ml-[7px] border-l border-slate-800 pl-4 whitespace-pre-wrap break-words ${prose ? "font-sans text-[13px] leading-6 text-slate-200" : "font-mono text-xs leading-relaxed text-slate-300"
            }`}
        >
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
          return (
            <Block
              key={i}
              title={role}
              text={pretty(msg.content ?? "")}
              prose={typeof msg.content === "string"}
              defaultOpen={role !== "system" || messages.length === 1}
            />
          );
        })}
        {Object.keys(params).length > 0 && <Block title="parámetros" text={pretty(params)} defaultOpen={false} />}
      </div>
    );
  }
  if (isRecord(parsed) && ("state" in parsed || "questions" in parsed)) {
    const { state, questions, ...rest } = parsed;
    return (
      <div className="flex flex-col gap-3">
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
    <div className="flex flex-col gap-4">
      {query.error && (
        <div className="border-l-2 border-rose-500 pl-3 text-xs leading-relaxed text-rose-300 whitespace-pre-wrap break-words">
          <span className="font-semibold">Error</span>
          <br />
          {query.error}
        </div>
      )}
      {answers && <ProbBars answers={answers} offered={query.offered} />}
      {hasInterpreted && <Block title="salida interpretada" text={pretty(out)} prose={typeof out === "string"} />}
      {query.rawOutput !== null && <Block title="salida cruda" text={query.rawOutput} defaultOpen={!answers && !hasInterpreted} />}
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

export const QueryDetail: React.FC<{ query: TraceQuery }> = ({ query }) => {
  const info = stageInfo(query.stage);
  const isDecision = info.kind === "decision";
  const link = query.link.call ?? query.link.plan ?? query.link.fact ?? (query.link.result ? "respuesta" : null);
  const truncated = query.finishReason != null && TRUNCATED.has(query.finishReason);
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex flex-col gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="flex items-baseline gap-2 text-base font-semibold text-slate-50">
            <span className="font-mono text-xs font-normal text-slate-500">#{query.seq}</span>
            {info.code && (
              <span className={`font-mono text-sm ${isDecision ? "text-accent-400" : "text-slate-400"}`}>{info.code}</span>
            )}
            {info.label}
          </h3>
          {query.error && <span className="text-xs font-medium text-rose-400">Con error</span>}
          <span className="text-xs text-slate-500 sm:ml-auto">
            <span className="font-mono">{query.model ?? "modelo desconocido"}</span>, {isDecision ? "decisión" : "generativo"}
          </span>
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
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 xl:divide-x divide-slate-800 overflow-y-auto xl:overflow-hidden">
        <section className="min-h-0 xl:overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <h4 className="text-xs font-medium text-slate-500">Entrada</h4>
          <InputPanel query={query} />
        </section>
        <section className="min-h-0 xl:overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <h4 className="text-xs font-medium text-slate-500">Salida</h4>
          <OutputPanel query={query} />
        </section>
      </div>
    </div>
  );
};