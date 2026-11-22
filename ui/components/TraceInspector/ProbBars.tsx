import type React from "react";

export interface Answer {
  choice?: string;
  p?: Record<string, number> | null;
  noul?: number;
}

export type Answers = Record<string, Answer>;

/**
 * Umbrales de decisión copiados del backend (`src/core/`) para mantener la UI desacoplada de `src/`:
 * - `NOUL_APPROVE` (`src/core/engine/verify.ts`) y `GATE_MIN` / `threshold` (`src/core/tools/probes.ts`): 0.6
 * - `COMPLETION_APPROVE` / `COMPLETION_INCOMPLETE_BELOW` (`src/core/engine/completion.ts`): 0.75 / 0.25
 * - `CONTINUATION_APPROVE` (`src/core/engine/thread.ts`): 0.3
 * - `FIRST_QUERY_MULTI_APPROVE` (`src/core/types/firstQuery.ts`): 0.5
 */
export const LOW_CONFIDENCE = 0.6;
export const NOUL_APPROVE = 0.6;
export const COMPLETION_APPROVE = 0.75;
export const COMPLETION_INCOMPLETE_BELOW = 0.25;
export const CONTINUATION_APPROVE = 0.3;
export const FIRST_QUERY_MULTI_APPROVE = 0.5;

export interface NoulSummary {
  yes: number;
  no: number;
  yesPctText: string;
  noPctText: string;
  /** `< 0.5` → `false`, `> 0.5` → `true`, `=== 0.5` → `null` (empate). */
  verdict: boolean | null;
  zone: "claro" | "duda";
  /** Umbral de aprobación en backend para esta etapa (`null` si no aplica uno específico). */
  approveThreshold: number | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const shortPct = (x: number): string => {
  const p = clamp01(x) * 100;
  if (p > 0 && p < 0.5) return "<1%";
  if (p > 99.5 && p < 100) return ">99%";
  return `${Math.round(p)}%`;
};

function noulBounds(stage?: string): { low: number; high: number; approveThreshold: number | null } {
  switch (stage) {
    case "completion":
      return { low: COMPLETION_INCOMPLETE_BELOW, high: COMPLETION_APPROVE, approveThreshold: COMPLETION_APPROVE };
    case "continuation":
      return { low: CONTINUATION_APPROVE, high: NOUL_APPROVE, approveThreshold: CONTINUATION_APPROVE };
    case "first_query":
      return { low: 1 - NOUL_APPROVE, high: NOUL_APPROVE, approveThreshold: FIRST_QUERY_MULTI_APPROVE };
    case "verify":
    case "probe":
      return { low: 1 - NOUL_APPROVE, high: NOUL_APPROVE, approveThreshold: NOUL_APPROVE };
    default:
      return { low: 1 - NOUL_APPROVE, high: NOUL_APPROVE, approveThreshold: null };
  }
}

export function analyzeNoul(rawValue: number, stage?: string): NoulSummary {
  const yes = clamp01(rawValue);
  const no = clamp01(1 - yes);
  const { low, high, approveThreshold } = noulBounds(stage);
  const isDoubt = stage === "completion" ? yes >= low && yes < high : yes >= low && yes < high && !(stage !== "continuation" && yes === low);
  const verdict = yes > 0.5 ? true : yes < 0.5 ? false : null;
  return {
    yes,
    no,
    yesPctText: shortPct(yes),
    noPctText: shortPct(no),
    verdict,
    zone: isDoubt ? "duda" : "claro",
    approveThreshold,
  };
}

const pct = (x: number) => `${(clamp01(x) * 100).toFixed(x >= 0.995 || x < 0.0005 ? 1 : 2)}%`;

interface RowProps {
  label: string;
  value: number;
  /** Fila protagonista: la opción elegida o el lado dominante. */
  strong?: boolean;
  /** Color de la barra cuando es protagonista. */
  tone?: string;
  /** Resalta el porcentaje en amarillo. */
  warn?: boolean;
}

const Row: React.FC<RowProps> = ({ label, value, strong = false, tone = "bg-accent-400", warn = false }) => (
  <div className="grid grid-cols-[minmax(6rem,14rem)_1fr_4.25rem] items-center gap-3">
    <span
      className={`truncate ${strong ? "text-sm font-semibold text-slate-50" : "text-xs text-slate-500"}`}
      title={label}
    >
      {label}
    </span>
    <div className={`rounded-full bg-slate-800 overflow-hidden ${strong ? "h-2" : "h-1.5"}`}>
      <div
        className={`h-full rounded-full ${strong ? (warn ? "bg-yellow-400" : tone) : "bg-slate-600"}`}
        style={{ width: `${clamp01(value) * 100}%` }}
      />
    </div>
    <span
      className={`text-right font-mono tabular-nums ${
        strong ? (warn ? "text-sm font-semibold text-yellow-300" : "text-sm font-semibold text-slate-50") : "text-xs text-slate-500"
      }`}
      title={warn ? "Zona de duda / confianza baja" : undefined}
    >
      {pct(value)}
    </span>
  </div>
);

/** Respuestas de una consulta de decisión: barras por opción (choice) o desglose sí/no + zona (noul). */
export const ProbBars: React.FC<{ answers: Answers; offered: string[] | null; stage?: string }> = ({
  answers,
  offered,
  stage,
}) => (
  <div className="flex flex-col gap-6">
    {Object.entries(answers).map(([question, a]) => {
      const noul = typeof a.noul === "number" ? analyzeNoul(a.noul, stage) : null;
      const isDoubt = noul?.zone === "duda";
      return (
        <div key={question} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">{question}</span>
            {noul && (
              <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                <span className="font-mono text-slate-300">
                  sí {noul.yesPctText} / no {noul.noPctText}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                    noul.verdict === true
                      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
                      : noul.verdict === false
                        ? "border-slate-700 bg-slate-800/80 text-slate-200"
                        : "border-yellow-800/60 bg-yellow-950/40 text-yellow-300"
                  }`}
                  title="< 0.5 es false · > 0.5 es true"
                >
                  {noul.verdict === null ? "= 0.5" : noul.verdict ? "true" : "false"}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                    isDoubt
                      ? "border-yellow-800/60 bg-yellow-950/40 text-yellow-300"
                      : "border-emerald-800/50 bg-emerald-950/30 text-emerald-300"
                  }`}
                >
                  {noul.zone}
                </span>
                {noul.approveThreshold !== null && (
                  <span className="font-mono text-[11px] text-slate-500">
                    umbral ≥ {Math.round(noul.approveThreshold * 100)}%
                  </span>
                )}
              </div>
            )}
          </div>
          {a.p ? (
            <div className="flex flex-col gap-1.5">
              {Object.entries(a.p)
                .sort((x, y) => y[1] - x[1])
                .map(([opt, v]) => {
                  const chosen = opt === a.choice;
                  return <Row key={opt} label={opt} value={v} strong={chosen} warn={chosen && v < LOW_CONFIDENCE} />;
                })}
            </div>
          ) : noul ? (
            <div className="flex flex-col gap-1.5">
              <Row
                label="sí (true)"
                value={noul.yes}
                strong={noul.yes >= noul.no}
                tone="bg-emerald-400"
                warn={noul.yes >= noul.no && isDoubt}
              />
              <Row
                label="no (false)"
                value={noul.no}
                strong={noul.no > noul.yes}
                tone="bg-slate-300"
                warn={noul.no > noul.yes && isDoubt}
              />
            </div>
          ) : a.choice !== undefined ? (
            <div className="text-sm font-semibold text-slate-50">
              {a.choice} <span className="text-xs font-normal text-slate-500">(sin probabilidades registradas)</span>
            </div>
          ) : (
            <span className="text-xs text-slate-500">Sin datos</span>
          )}
        </div>
      );
    })}
    {offered && offered.length > 0 && (
      <div className="text-xs text-slate-500">Opciones ofrecidas: {offered.join(", ")}</div>
    )}
  </div>
);