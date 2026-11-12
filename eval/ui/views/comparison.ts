/**
 * eval/ui/views/comparison.ts
 *
 * Resumen de la comparación en consola: por variante, por etapa, por pregunta y contra la baseline.
 * Formatea con `core/report-format.ts` (lo mismo que comparison.md) y no calcula nada.
 */

import { fmtDeltaPct, fmtMs, fmtPct, variantTableHead, variantTableRows } from "../../core/report-format.ts";
import type { CellStageReport, ComparisonReport } from "../../core/report.ts";
import type { QuestionScore } from "../../core/types.ts";
import { c, padEnd, rateColor, section, sym, table, vlen, WIDTH } from "../style.ts";

const log = (s = ""): void => console.log(s);

/** Verde si sube, rojo si baja (passRate, accuracy). */
const colorDelta = (s: string): string => (s.startsWith("+") ? c.green(s) : s.startsWith("-") ? c.red(s) : s);

/** Para latencia es al revés: bajar es bueno. */
const colorLatencyDelta = (s: string): string => (s.startsWith("-") ? c.green(s) : s.startsWith("+") ? c.red(s) : s);

const pctDelta = (r: number): string => colorDelta(fmtDeltaPct(r));

/** FP/FN de una pregunta sí/no (positiva = "yes"), sin contar las no respondidas. undefined si tiene otras clases. */
function yesNoFpFn(q: QuestionScore): { fp: number; fn: number } | undefined {
  const keys = Object.keys(q.perClass);
  if (keys.length === 0 || !keys.every((k) => k === "yes" || k === "no")) return undefined;
  return { fp: q.confusionMatrix["no"]?.["yes"] ?? 0, fn: q.confusionMatrix["yes"]?.["no"] ?? 0 };
}

/** "FP 1, FN 2, sin respuesta 1" para preguntas sí/no (suman los errores); "errores N" para el resto. */
function errorSummary(q: { errors: number; unanswered: number }, fpfn: { fp: number; fn: number } | undefined): string {
  if (!fpfn) return `errores ${q.errors}`;
  return `FP ${fpfn.fp}, FN ${fpfn.fn}${q.unanswered > 0 ? `, sin respuesta ${q.unanswered}` : ""}`;
}

/** Encabezados abreviados para que la tabla entre en la terminal (comparison.md trae los completos). */
const SHORT_HEAD: Record<string, string> = {
  "Δ vs baseline": "Δ",
  "Macro por etapa": "Macro",
  Regresiones: "Regr.",
  "p (signos)": "p",
  "Sin medir": "Sin med.",
  Reintentos: "Reint.",
};

/** Columnas que se descartan, en este orden, si la tabla no entra en `WIDTH`. */
const DROP_ORDER = ["Macro por etapa", "p (signos)", "Reintentos", "Sin medir"];

/** Tabla de una fila por variante (y tipo de etapas), con el color puesto donde importa. */
export function printVariantSummary(report: ComparisonReport): void {
  if (report.variants.length === 0) return;
  const head = variantTableHead(report);
  const rows = variantTableRows(report).map((cells, r) => {
    const v = report.variants[r];
    const isBase = v.variant === report.baseline;
    return cells.map((s, i) => {
      switch (head[i]) {
        case "Tipo":
          return s === "total (mezcla)" ? "total" : s;
        case "Variante":
          return isBase ? c.bold(s) : c.cyan(s);
        case "passRate":
          return rateColor(v.passRate, s);
        case "Δ vs baseline":
          return colorDelta(s);
        case "Regresiones":
          return !isBase && v.regressions > 0 ? c.red(s) : s;
        case "Mejoras":
          return !isBase && v.improvements > 0 ? c.green(s) : s;
        case "Sin medir":
          return v.clientFailedRuns > 0 ? c.yellow(s) : c.gray(s);
        default:
          return s;
      }
    });
  });

  // Se descartan columnas de menor prioridad hasta que entre; "Sin medir" solo si no hay llamadas fallidas.
  const droppable = DROP_ORDER.filter((h) => head.includes(h) && !(h === "Sin medir" && report.variants.some((v) => v.clientFailedRuns > 0)));
  const dropped = new Set<string>();
  const render = (): string[] => {
    const keep = head.flatMap((h, i) => (dropped.has(h) ? [] : [i]));
    const shown = keep.map((i) => SHORT_HEAD[head[i]] ?? head[i]);
    const right = keep.flatMap((i, k) => (head[i] === "Tipo" || head[i] === "Variante" ? [] : [k]));
    return table(shown, rows.map((r) => keep.map((i) => r[i])), { right });
  };
  let lines = render();
  for (const h of droppable) {
    if (vlen(lines[0]) <= WIDTH) break;
    dropped.add(h);
    lines = render();
  }
  section("Resumen por variante");
  for (const line of lines) log(line);
  if (dropped.size > 0) log(`\n  ${c.gray(`Tabla completa en comparison.md (acá se omite: ${[...dropped].join(", ")}).`)}`);
}

/**
 * Resumen por etapa: por cada (dataset, etapa), una línea por variante con su pass rate, accuracy y p50, y el delta
 * contra la baseline. Es lo mismo que la tabla por etapa de comparison.md, en un formato que entra en la terminal.
 */
export function printStageSummary(report: ComparisonReport): void {
  if (report.cells.length === 0) return;
  const key = (variant: string, x: { dataset: string; stageKey: string }): string => `${variant}\u0000${x.dataset}\u0000${x.stageKey}`;
  const deltas = new Map(report.deltas.map((d) => [key(d.variant, d), d]));
  const groups = new Map<string, CellStageReport[]>();
  for (const cell of report.cells) {
    const k = `${cell.dataset}\u0000${cell.stageKey}`;
    groups.set(k, [...(groups.get(k) ?? []), cell]);
  }
  const isBase = (cell: CellStageReport): boolean => cell.variant === report.baseline;
  const labelOf = (cell: CellStageReport): string => (isBase(cell) ? `${cell.variant} (base)` : cell.variant);
  const nameW = Math.max(...report.cells.map((cell) => labelOf(cell).length));
  section("Resumen por etapa");
  for (const cells of groups.values()) {
    const f = cells[0];
    log(`\n  ${c.bold(f.dataset)} ${c.gray("·")} ${c.cyan(f.stageKey)}`);
    for (const cell of cells) {
      const d = deltas.get(key(cell.variant, cell));
      const pass = cell.totalRuns > 0 ? rateColor(cell.passRate, `${fmtPct(cell.passRate)} (${cell.passedRuns}/${cell.totalRuns})`) : c.gray("—");
      const acc = cell.accuracy !== undefined ? `acc ${fmtPct(cell.accuracy)}` : "";
      const delta = d
        ? `Δ pass ${pctDelta(d.deltaPassRate)}${d.deltaAccuracy !== undefined ? `, Δ acc ${pctDelta(d.deltaAccuracy)}` : ""}`
        : "";
      const name = padEnd(isBase(cell) ? c.bold(labelOf(cell)) : labelOf(cell), nameW);
      log(`    ${name}  ${padEnd(pass, 15)}  ${padEnd(c.gray(acc), 10)}  ${c.gray("p50")} ${padEnd(fmtMs(cell.p50DurationMs), 8)}  ${delta}`.trimEnd());
    }
  }
}

/** Una línea por pregunta de las etapas con varias preguntas: accuracy y FP/FN totales. */
export function printQuestionSummary(report: ComparisonReport): void {
  const withQ = report.cells.filter((cell) => cell.questions && Object.keys(cell.questions).length > 0);
  if (withQ.length === 0) return;
  section("Preguntas por etapa");
  for (const cell of withQ) {
    log(`\n  ${c.cyan(cell.variant)} ${c.bold(`${cell.dataset}/${cell.stageKey}`)}`);
    for (const [k, q] of Object.entries(cell.questions as Record<string, QuestionScore>)) {
      const acc = rateColor(q.accuracy, fmtPct(q.accuracy).padStart(6));
      const errs = c.gray(errorSummary({ errors: q.graded - q.correct, unanswered: q.unanswered }, yesNoFpFn(q)));
      log(`    ${k.padEnd(14)} ${acc} ${c.gray(`(${q.correct}/${q.graded})`)}  ${errs}${q.role === "main" ? `  ${c.violet("[principal]")}` : ""}`);
    }
    for (const x of cell.questionCross ?? []) {
      log(c.gray(`    ${x.a} × ${x.b}: ambas bien ${x.bothCorrect}, solo ${x.a} ${x.onlyA}, solo ${x.b} ${x.onlyB}, ambas mal ${x.bothWrong}`));
    }
  }
}

/** Avisos, deltas, y regresiones y mejoras contra la baseline (también las de casos raw). */
export function printComparisonSummary(report: ComparisonReport): void {
  const warnings = report.warnings ?? [];
  if (
    report.deltas.length === 0 &&
    report.regressions.length === 0 &&
    report.improvements.length === 0 &&
    report.rawRegressions.length === 0 &&
    report.rawImprovements.length === 0 &&
    warnings.length === 0
  ) {
    return;
  }

  section(`Comparación vs baseline (${report.baseline})`);
  for (const w of warnings) log(`  ${sym.warn} ${c.yellow(w)}`);

  for (const d of report.deltas) {
    const acc = d.deltaAccuracy !== undefined ? ` ${c.gray("|")} Δ acc: ${pctDelta(d.deltaAccuracy)}` : "";
    const ms = colorLatencyDelta(fmtMs(d.deltaP50Ms, true));
    log(`  ${c.cyan(d.variant)} ${c.gray(`[${d.dataset}/${d.stageKey}]`)}: Δ pass: ${pctDelta(d.deltaPassRate)}${acc} ${c.gray("|")} Δ p50: ${ms}`);
  }

  const changes = (title: string, mark: string, sign: string, color: (s: string) => string, items: ComparisonReport["regressions"]): void => {
    if (items.length === 0) return;
    log(`\n  ${color(mark)} ${c.bold(`${title} (${items.length}${title.includes("raw") ? ", fuera de passRate" : ""}):`)}`);
    for (const x of items) log(`    ${color(sign)} ${x.caseId} ${c.gray(`[${x.stageKey}]`)} ${c.gray(`(${x.variant}):`)} ${x.diff}`);
  };
  changes("Regresiones", "⚠", "-", c.red, report.regressions);
  changes("Mejoras", "★", "+", c.green, report.improvements);
  changes("Regresiones en casos raw", "⚠", "-", c.red, report.rawRegressions);
  changes("Mejoras en casos raw", "★", "+", c.green, report.rawImprovements);
}
