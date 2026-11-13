import React from "react";

export interface Answer {
  choice?: string;
  p?: Record<string, number> | null;
  noul?: number;
}

export type Answers = Record<string, Answer>;

/** Por debajo de esta probabilidad, la opción elegida se marca como poco segura. */
export const LOW_CONFIDENCE = 0.6;

const pct = (x: number) => `${(x * 100).toFixed(x >= 0.995 || x < 0.0005 ? 1 : 2)}%`;

interface RowProps {
  label: string;
  value: number;
  /** Fila protagonista: la opción elegida o un valor único. */
  strong?: boolean;
  /** Color de la barra cuando es protagonista. */
  tone?: string;
  /** Resalta el porcentaje en amarillo. */
  warn?: boolean;
}

const Row: React.FC<RowProps> = ({ label, value, strong = false, tone = "bg-accent-400", warn = false }) => (
  <div className="grid grid-cols-[minmax(6rem,14rem)_1fr_3.75rem] items-center gap-3">
    <span
      className={`truncate ${strong ? "text-sm font-semibold text-slate-50" : "text-xs text-slate-500"}`}
      title={label}
    >
      {label}
    </span>
    <div className={`rounded-full bg-slate-800 overflow-hidden ${strong ? "h-2" : "h-1"}`}>
      <div
        className={`h-full rounded-full ${strong ? (warn ? "bg-yellow-400" : tone) : "bg-slate-600"}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
    <span
      className={`text-right font-mono tabular-nums ${strong ? (warn ? "text-sm font-semibold text-yellow-300" : "text-sm font-semibold text-slate-50") : "text-xs text-slate-500"
        }`}
      title={warn ? "Confianza baja" : undefined}
    >
      {pct(value)}
    </span>
  </div>
);

/** Respuestas de una consulta de decisión: barras por opción (choice) o un solo valor 0–1 (noul). */
export const ProbBars: React.FC<{ answers: Answers; offered: string[] | null }> = ({ answers, offered }) => (
  <div className="flex flex-col gap-6">
    {Object.entries(answers).map(([question, a]) => (
      <div key={question} className="flex flex-col gap-2">
        <div className="text-xs text-slate-500">{question}</div>
        {a.p ? (
          <div className="flex flex-col gap-1.5">
            {Object.entries(a.p)
              .sort((x, y) => y[1] - x[1])
              .map(([opt, v]) => {
                const chosen = opt === a.choice;
                return <Row key={opt} label={opt} value={v} strong={chosen} warn={chosen && v < LOW_CONFIDENCE} />;
              })}
          </div>
        ) : typeof a.noul === "number" ? (
          <Row label="noul" value={a.noul} strong tone={a.noul >= 0.5 ? "bg-emerald-400" : "bg-yellow-400"} />
        ) : a.choice !== undefined ? (
          <div className="text-sm font-semibold text-slate-50">
            {a.choice} <span className="text-xs font-normal text-slate-500">(sin probabilidades registradas)</span>
          </div>
        ) : (
          <span className="text-xs text-slate-500">Sin datos</span>
        )}
      </div>
    ))}
    {offered && offered.length > 0 && (
      <div className="text-xs text-slate-500">Opciones ofrecidas: {offered.join(", ")}</div>
    )}
  </div>
);