/**
 * eval/auto/feedback.ts
 *
 * Extrae resumen estructurado por variante/dataset de `ComparisonReport` y una muestra acotada
 * de hasta 14 casos fallidos reales del Top-1 vigente para alimentar al agente optimizador (`§5.1`).
 * Nunca incluye casos de `--holdout`.
 * Cuando las celdas en RAM vienen aligeradas (con `cellDir`), hidrata el detalle de errores/entradas
 * leyendo en streaming únicamente los casos seleccionados desde `<cellDir>/runs.jsonl`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { datasetName } from "../core/datasets.ts";
import { forEachJsonlLineSync } from "../core/io.ts";
import type { ComparisonReport, InputCell } from "../core/report.ts";
import type { Case, RunRecord } from "../core/types.ts";

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
  /** Intentos fallidos del caso cuando `--repeat > 1` (sobre intentos canónicos válidos). */
  failedAttempts?: number;
  totalAttempts?: number;
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

function recordLookupKey(r: Pick<RunRecord, "dataset" | "caseId" | "stageKey" | "iteration">): string {
  return `${r.dataset}\u0000${r.caseId}\u0000${r.stageKey}\u0000${r.iteration}`;
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
  devDatasetPaths?: string[];
  caseLookup?: Map<string, Case>;
  limit?: number;
}): FailureSample[] {
  const limit = opts.limit ?? MAX_SAMPLES;
  const caseMap = opts.caseLookup ?? new Map<string, Case>();

  // Filtro estricto de datasets dev para nunca filtrar casos de --holdout al optimizador.
  const devPathNames = opts.devDatasetPaths && opts.devDatasetPaths.length > 0
    ? new Set(opts.devDatasetPaths.map((p) => datasetName(p)))
    : null;
  const isAllowedDevDataset = (name: string): boolean => {
    if (devPathNames && !devPathNames.has(name)) return false;
    if (opts.devDatasetNames.size > 0 && !opts.devDatasetNames.has(name)) return false;
    return devPathNames !== null || opts.devDatasetNames.size > 0;
  };

  const prodStatus = new Map<string, boolean>();
  const focusRecordsByCase = new Map<string, Array<{ record: RunRecord; cellDir?: string }>>();

  for (const cell of opts.cells) {
    if (!isAllowedDevDataset(cell.datasetName)) continue;

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
        list.push({ record: r, cellDir: cell.cellDir });
        focusRecordsByCase.set(key, list);
      }
    }
  }

  interface CandidateMeta {
    tier: number;
    diversityKey: string;
    priority: FailureSample["priority"];
    slimRecord: RunRecord;
    cellDir?: string;
    failedChecks: string[];
    expected: string;
    failedAttempts: number;
    totalAttempts: number;
  }

  const candidates: CandidateMeta[] = [];
  for (const [key, items] of focusRecordsByCase.entries()) {
    const failedItems = items.filter((item) => !item.record.passed);
    if (failedItems.length === 0) continue;

    const failedItem = failedItems[0];
    const failedRec = failedItem.record;
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
      priority,
      slimRecord: failedRec,
      cellDir: failedItem.cellDir,
      failedChecks,
      expected,
      failedAttempts: failedItems.length,
      totalAttempts: items.length,
    });
  }

  candidates.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.slimRecord.dataset.localeCompare(b.slimRecord.dataset) ||
      a.slimRecord.caseId.localeCompare(b.slimRecord.caseId),
  );

  // Selección con diversidad: primera pasada tomando un representante por (tier, diversityKey), luego completar hasta limit.
  const pickedMeta: CandidateMeta[] = [];
  const pickedIds = new Set<string>();
  const seenDiversity = new Set<string>();

  for (const cand of candidates) {
    if (pickedMeta.length >= limit) break;
    const key = `${cand.tier}::${cand.diversityKey}`;
    if (!seenDiversity.has(key)) {
      seenDiversity.add(key);
      pickedMeta.push(cand);
      pickedIds.add(`${cand.slimRecord.dataset}\u0000${cand.slimRecord.caseId}`);
    }
  }

  for (const cand of candidates) {
    if (pickedMeta.length >= limit) break;
    const uid = `${cand.slimRecord.dataset}\u0000${cand.slimRecord.caseId}`;
    if (!pickedIds.has(uid)) {
      pickedIds.add(uid);
      pickedMeta.push(cand);
    }
  }

  // Hidratación bajo demanda desde `<cellDir>/runs.jsonl` únicamente para los casos elegidos.
  const neededByDir = new Map<string, Set<string>>();
  for (const meta of pickedMeta) {
    if (!meta.cellDir) continue;
    let keys = neededByDir.get(meta.cellDir);
    if (!keys) {
      keys = new Set<string>();
      neededByDir.set(meta.cellDir, keys);
    }
    keys.add(recordLookupKey(meta.slimRecord));
  }

  const hydratedRecords = new Map<string, RunRecord>();
  for (const [cellDir, targetKeys] of neededByDir.entries()) {
    const runsPath = join(cellDir, "runs.jsonl");
    if (!existsSync(runsPath)) continue;
    try {
      forEachJsonlLineSync(runsPath, (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const rec = JSON.parse(trimmed) as RunRecord;
        const rk = recordLookupKey(rec);
        if (targetKeys.has(rk)) {
          hydratedRecords.set(`${cellDir}\u0000${rk}`, rec);
        }
      });
    } catch {
      // Si falla la lectura parcial en disco, caemos al record resumido en RAM.
    }
  }

  return pickedMeta.map((meta) => {
    const fullRec = meta.cellDir
      ? hydratedRecords.get(`${meta.cellDir}\u0000${recordLookupKey(meta.slimRecord)}`) ?? meta.slimRecord
      : meta.slimRecord;
    return {
      id: fullRec.caseId,
      dataset: fullRec.dataset,
      priority: meta.priority,
      inputCompact: compactRawInput(fullRec.rawInput),
      expected: meta.expected,
      predicted: formatPredicted(fullRec),
      failedChecks: meta.failedChecks,
      errors: fullRec.errors.slice(0, 3).map((e) => clipText(e, 220)),
      rawOutput: clipText(fullRec.rawOutput ?? "", MAX_RAW_OUTPUT_CHARS),
      ...(meta.totalAttempts > 1 ? { failedAttempts: meta.failedAttempts, totalAttempts: meta.totalAttempts } : {}),
    };
  });
}
