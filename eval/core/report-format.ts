/**
 * eval/core/report-format.ts
 *
 * Formato compartido del reporte de comparación: porcentajes, deltas, latencias y la tabla por variante.
 * Lo usan comparison.md (`report.ts`) y la consola (`ui/views/comparison.ts`), para que ambos muestren lo mismo.
 */

import type { ComparisonReport, VariantSummary } from "./report.ts";

/** Por debajo de esto, el p95 por rango más cercano es el máximo de la muestra: no se publica su delta. */
export const MIN_P95_SAMPLES = 20;

export function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

export function fmtDeltaPct(r: number): string {
  const sign = r > 0 ? "+" : "";
  return `${sign}${(r * 100).toFixed(1)}%`;
}

export function fmtDeltaMs(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}ms`;
}

export function fmtMs(n: number | undefined, delta = false): string {
  if (n === undefined) return "—";
  return delta ? fmtDeltaMs(n) : `${n}ms`;
}

/** `†`: con pocas muestras el p95 es el máximo de la muestra (en la práctica, a menudo la carga en frío del modelo). */
export function fmtP95(n: number | undefined, samples: number): string {
  return n !== undefined && samples < MIN_P95_SAMPLES ? `${n}ms†` : fmtMs(n);
}

export function fmtP(p: number | undefined): string {
  if (p === undefined) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

type SummaryKind = NonNullable<VariantSummary["kind"]>;

const KIND_LABEL: Record<SummaryKind, string> = { generative: "generativo", decision: "decisión", total: "total (mezcla)" };

/** Hay fila `total`: la corrida tiene ambos tipos de etapas y se agrega la columna Tipo. */
const hasKinds = (report: ComparisonReport): boolean => report.variants.some((v) => v.kind === "total");

const hasRetries = (report: ComparisonReport): boolean => report.variants.some((v) => v.retriedRuns > 0);

export function variantTableHead(report: ComparisonReport): string[] {
  return [
    ...(hasKinds(report) ? ["Tipo"] : []),
    "Variante",
    "passRate",
    "Δ vs baseline",
    "Macro por etapa",
    "Regresiones",
    "Mejoras",
    "p (signos)",
    "Sin medir",
    ...(hasRetries(report) ? ["Reintentos"] : []),
    "p50",
  ];
}

/** Una fila por `report.variants`, en el mismo orden. */
export function variantTableRows(report: ComparisonReport): string[][] {
  const withKind = hasKinds(report);
  const withRetries = hasRetries(report);
  return report.variants.map((v) => {
    const isBase = v.variant === report.baseline;
    const macroDelta = v.deltaMacroPassRate === undefined ? "" : ` (${fmtDeltaPct(v.deltaMacroPassRate)})`;
    return [
      ...(withKind ? [KIND_LABEL[v.kind ?? "total"]] : []),
      isBase ? `${v.variant} (baseline)` : v.variant,
      `${fmtPct(v.passRate)} (${v.passedRuns}/${v.totalRuns})`,
      v.deltaPassRate === undefined ? "—" : fmtDeltaPct(v.deltaPassRate),
      `${fmtPct(v.macroPassRate)}${macroDelta}`,
      isBase ? "—" : String(v.regressions),
      isBase ? "—" : String(v.improvements),
      fmtP(v.signTestP),
      String(v.clientFailedRuns),
      ...(withRetries ? [String(v.retriedRuns)] : []),
      fmtMs(v.p50DurationMs),
    ];
  });
}