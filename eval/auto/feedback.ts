/**
 * eval/auto/feedback.ts
 *
 * Extrae resumen estructurado por variante/dataset de `ComparisonReport` y una muestra acotada
 * de hasta 14 casos fallidos reales del Top-1 vigente para alimentar al agente optimizador (`§5.1`).
 * Nunca incluye casos de `--holdout`.
 */

import type { Case, RunRecord } from "../core/types.ts";
import type { ComparisonReport, InputCell } from "../core/report.ts";

export interface FailureSample {
  id: string;
  dataset: string;
  priority: "regression_vs_prod" | "shared_failure" | "other_failure";
  inputCompact: string;
  expected: string;
  predicted: string;
  failedChecks: string[];
  errors: string[];
  rawOutput: string;
}

export interface VariantDatasetStat {
  variant: string;
  dataset: string;
  stageKey: string;
  passRate: number;
  passedRuns: number;
  totalRuns: number;
  p50DurationMs?: number;
  retriedRuns: number;
  deltaPassRate?: number;
}

const MAX_INPUT_CHARS = 1200;
const MAX_RAW_OUTPUT_CHARS = 500;
const MAX_SAMPLES = 14;

function clipText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 14))}...[recortado]`;
}

function compactRawInput(rawInput: unknown): string {
  if (!rawInput || typeof rawInput !== "object") {
    return clipText(String(rawInput ?? ""), MAX_INPUT_CHARS);
  }
  const obj = rawInput as Record<string, unknown>;

  // Decision request: { model, state, questions }
  if (typeof obj.state === "string") {
    const qObj = obj.questions && typeof obj.questions === "object"
      ? (obj.questions as Record<string, { type?: string; criteria?: Record<string, string> }>)
      : {};
    const qDesc = Object.entries(qObj)
      .map(([k, q]) => {
        const opts = q.criteria ? `(${Object.keys(q.criteria).join("|")})` : "";
        return `${k}:${q.type ?? "?"}${opts}`;
      })
      .join(", ");
    const combined = `STATE:\n${clipText(obj.state, 950)}\nQUESTIONS: ${qDesc}`;
    return clipText(combined, MAX_INPUT_CHARS);
  }

  // Generative request: { messages: [{ role, content }, ...] }
  if (Array.isArray(obj.messages)) {
    const userMsg = (obj.messages as Array<{ role?: string; content?: unknown }>).find((m) => m.role === "user");
    if (userMsg && typeof userMsg.content === "string") {
      return clipText(userMsg.content, MAX_INPUT_CHARS);
    }
  }

  return clipText(JSON.stringify(rawInput), MAX_INPUT_CHARS);
}

function formatPredicted(r: RunRecord): string {
  if (r.predictedLabel !== undefined && r.predictedLabel !== null) {
    const probs = r.probabilities
      ? ` probs=${JSON.stringify(Object.fromEntries(Object.entries(r.probabilities).map(([k, v]) => [k, Number(v.toFixed(3))])))}`
      : "";
    return `${r.predictedLabel}${probs}`;
  }
  if (r.parsedOutput !== undefined) {
    return clipText(JSON.stringify(r.parsedOutput), 260);
  }
  return r.rawOutput ? clipText(r.rawOutput, 200) : "(sin salida)";
}

function formatExpected(r: RunRecord, caseMap: Map<string, Case>): string {
  const fc = caseMap.get(`${r.dataset}\u0000${r.caseId}`);
  if (fc) return clipText(JSON.stringify(fc.expect), 260);
  if (r.expectedLabel !== undefined && r.expectedLabel !== null) return r.expectedLabel;
  return "(ver métricas)";
}

/** Construye estadísticas por variante y dataset a partir del reporte comparativo. */
export function extractVariantDatasetStats(report: ComparisonReport, cells: InputCell[]): VariantDatasetStat[] {
  const deltaMap = new Map<string, number>();
  for (const d of report.deltas) {
    deltaMap.set(`${d.variant}\u0000${d.dataset}\u0000${d.stageKey}`, d.deltaPassRate);
  }

  const retryByCell = new Map<string, number>();
  for (const cell of cells) {
    for (const r of cell.records) {
      if (r.bucket !== "canonical") continue;
      if (Number(r.measurements?.attempts) > 1) {
        const key = `${cell.variantSpec}\u0000${cell.datasetName}\u0000${r.stageKey}`;
        retryByCell.set(key, (retryByCell.get(key) ?? 0) + 1);
      }
    }
  }

  return report.cells.map((c) => {
    const key = `${c.variant}\u0000${c.dataset}\u0000${c.stageKey}`;
    return {
      variant: c.variant,
      dataset: c.dataset,
      stageKey: c.stageKey,
      passRate: c.passRate,
      passedRuns: c.passedRuns,
      totalRuns: c.totalRuns,
      ...(c.p50DurationMs !== undefined ? { p50DurationMs: c.p50DurationMs } : {}),
      retriedRuns: retryByCell.get(key) ?? 0,
      ...(deltaMap.has(key) ? { deltaPassRate: deltaMap.get(key) } : {}),
    };
  });
}

/**
 * Extrae hasta `limit` casos fallidos representativos de `focusVariant` sobre datasets `dev`.
 * Prioriza:
 * 1. Regresiones vs `prod` (`prod` pasó y `focusVariant` falló)
 * 2. Fallos compartidos (`prod` y `focusVariant` fallaron)
 * 3. Diversidad por etiqueta esperada / checks fallidos / dataset
 */
export function extractFailureSamples(opts: {
  focusVariant: string;
  cells: InputCell[];
  devDatasetNames: Set<string>;
  caseLookup?: Map<string, Case>;
  limit?: number;
}): FailureSample[] {
  const limit = opts.limit ?? MAX_SAMPLES;
  const caseMap = opts.caseLookup ?? new Map<string, Case>();

  const prodStatus = new Map<string, boolean>();
  const focusRecordsByCase = new Map<string, RunRecord[]>();

  for (const cell of opts.cells) {
    // Seguridad: nunca incluir datasets holdout ni bucket raw en el feedback del optimizador.
    if (!opts.devDatasetNames.has(cell.datasetName)) continue;

    for (const r of cell.records) {
      if (r.bucket !== "canonical") continue;
      if (r.metrics?.client_call_ok === false) continue;

      const key = `${r.dataset}\u0000${r.caseId}\u0000${r.stageKey}`;
      if (cell.variantSpec === "prod") {
        const prev = prodStatus.get(key);
        prodStatus.set(key, prev === undefined ? r.passed : prev && r.passed);
      }
      if (cell.variantSpec === opts.focusVariant) {
        const list = focusRecordsByCase.get(key) ?? [];
        list.push(r);
        focusRecordsByCase.set(key, list);
      }
    }
  }

  interface ScoredCandidate {
    sample: FailureSample;
    tier: number;
    diversityKey: string;
  }

  const candidates: ScoredCandidate[] = [];
  for (const [key, recs] of focusRecordsByCase.entries()) {
    const failedRec = recs.find((r) => !r.passed);
    if (!failedRec) continue;

    const prodOk = prodStatus.get(key);
    const priority: FailureSample["priority"] =
      prodOk === true
        ? "regression_vs_prod"
        : prodOk === false
          ? "shared_failure"
          : "other_failure";

    const tier = priority === "regression_vs_prod" ? 0 : priority === "shared_failure" ? 1 : 2;
    const failedChecks = Object.entries(failedRec.metrics)
      .filter(([, ok]) => ok === false)
      .map(([k]) => k);

    const expected = formatExpected(failedRec, caseMap);
    const diversityKey = `${failedRec.expectedLabel ?? expected}::${failedChecks.join(",")}`;

    candidates.push({
      tier,
      diversityKey,
      sample: {
        id: failedRec.caseId,
        dataset: failedRec.dataset,
        priority,
        inputCompact: compactRawInput(failedRec.rawInput),
        expected,
        predicted: formatPredicted(failedRec),
        failedChecks,
        errors: failedRec.errors.slice(0, 3).map((e) => clipText(e, 220)),
        rawOutput: clipText(failedRec.rawOutput ?? "", MAX_RAW_OUTPUT_CHARS),
      },
    });
  }

  candidates.sort((a, b) => a.tier - b.tier || a.sample.dataset.localeCompare(b.sample.dataset) || a.sample.id.localeCompare(b.sample.id));

  // Selección con diversidad: primera pasada tomando un representante por (tier, diversityKey), luego completar hasta limit.
  const picked: FailureSample[] = [];
  const pickedIds = new Set<string>();
  const seenDiversity = new Set<string>();

  for (const c of candidates) {
    if (picked.length >= limit) break;
    const key = `${c.tier}::${c.diversityKey}`;
    if (!seenDiversity.has(key)) {
      seenDiversity.add(key);
      picked.push(c.sample);
      pickedIds.add(`${c.sample.dataset}\u0000${c.sample.id}`);
    }
  }

  for (const c of candidates) {
    if (picked.length >= limit) break;
    const uid = `${c.sample.dataset}\u0000${c.sample.id}`;
    if (!pickedIds.has(uid)) {
      pickedIds.add(uid);
      picked.push(c.sample);
    }
  }

  return picked;
}
