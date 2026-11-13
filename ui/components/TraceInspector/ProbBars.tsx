import React from "react";

interface Answer {
  choice?: string;
  p?: Record<string, number> | null;
  noul?: number;
}

const pct = (x: number) => `${(x * 100).toFixed(x >= 0.995 || x < 0.0005 ? 1 : 2)}%`;

const Bar: React.FC<{ label: string; value: number; chosen?: boolean; tone?: string }> = ({
  label,
  value,
  chosen = false,
  tone,
}) => (
  <div className="grid grid-cols-[minmax(6rem,12rem)_1fr_3.6rem] items-center gap-2 text-[11px] font-mono">
    <span className={`truncate ${chosen ? "text-sky-300 font-semibold" : "text-slate-400"}`} title={label}>
      {label}
    </span>
    <div className="h-2 rounded-sm bg-slate-800/80 overflow-hidden">
      <div
        className={`h-full ${tone ?? (chosen ? "bg-sky-500" : "bg-slate-600")}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
    <span className={`text-right tabular-nums ${chosen ? "text-sky-300" : "text-slate-500"}`}>{pct(value)}</span>
  </div>
);

/** Respuestas de una consulta de decisión: barras por opción (choice) o un solo valor 0–1 (noul). */
export const ProbBars: React.FC<{ answers: Record<string, Answer>; offered: string[] | null }> = ({ answers, offered }) => (
  <div className="flex flex-col gap-4">
    {Object.entries(answers).map(([question, a]) => (
      <div key={question} className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{question}</div>
        {a.p ? (
          Object.entries(a.p)
            .sort((x, y) => y[1] - x[1])
            .map(([opt, v]) => <Bar key={opt} label={opt} value={v} chosen={opt === a.choice} />)
        ) : typeof a.noul === "number" ? (
          <Bar label="noul" value={a.noul} tone={a.noul >= 0.5 ? "bg-emerald-500" : "bg-amber-500"} />
        ) : (
          <span className="text-xs text-slate-500 font-mono">sin datos</span>
        )}
      </div>
    ))}
    {offered && offered.length > 0 && (
      <div className="text-[10px] font-mono text-slate-600">ofrecidas: {offered.join(" · ")}</div>
    )}
  </div>
);
