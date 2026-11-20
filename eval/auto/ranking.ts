/**
 * eval/auto/ranking.ts
 *
 * Selección determinista de Top-2 (sin LLM), desempates (`§6.1`), persistencia de estado
 * (`auto_state.json`), reutilización de corridas compatibles en `eval/results/` (`§2.3`)
 * y archivado de variantes generadas perdedoras en `descartadas/` (`§2.4`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { generateComparisonReport, type ComparisonReport, type InputCell, type VariantSummary } from "../core/report.ts";
import { safeName } from "../core/results.ts";
import { promptEnvironment } from "../core/scenario.ts";
import type { GlobalScoreSummary, RunMeta, RunRecord, StageName } from "../core/types.ts";
import type { AutoConfig, AutoMetric } from "./config.ts";
import { autoStageDir, autoStatePath } from "./config.ts";

export interface RankedVariant {
  variant: string;
  passRate: number;
  macroPassRate: number;
  score: number;
  passedRuns: number;
  totalRuns: number;
  clientFailedRuns: number;
  retriedRuns: number;
  regressions: number;
  improvements: number;
  signTestP?: number;
  p50DurationMs?: number;
  avgPromptTokens?: number;
  deltaPassRate?: number;
  deltaMacroPassRate?: number;
}

export interface AutoFingerprint {
  client: "real" | "mock";
  model: string;
  decisionModel: string;
  thinking: string;
  includeShortcut: boolean;
  repeat: number;
  metric: AutoMetric;
  stageConfigHash: string;
  devHashes: Record<string, string>;
  devCasesHashes: Record<string, string>;
}

export interface AutoSessionState {
  schemaVersion: 1;
  stage: StageName;
  fingerprint: AutoFingerprint;
  completedRounds: number;
  top2: string[];
  top2Summaries: RankedVariant[];
  prodSummary?: RankedVariant;
  bestNonProd?: {
    variant: string;
    score: number;
    round: number;
    confirmedHoldout?: boolean;
  };
  updatedAt: string;
}

const SCORE_EPS = 0.0001;

export function buildFingerprint(
  cfg: AutoConfig,
  devHashes: Record<string, string>,
  devCasesHashes: Record<string, string>,
): AutoFingerprint {
  return {
    client: cfg.client,
    model: cfg.model,
    decisionModel: cfg.decisionModel,
    thinking: cfg.thinking,
    includeShortcut: cfg.includeShortcut,
    repeat: cfg.repeat,
    metric: cfg.metric,
    stageConfigHash: promptEnvironment().stageConfigHash,
    devHashes,
    devCasesHashes,
  };
}

export function fingerprintsEqual(a: AutoFingerprint | undefined, b: AutoFingerprint): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function computeAvgPromptTokens(records: RunRecord[]): number | undefined {
  const canonical = records.filter((r) => r.bucket === "canonical" && r.tokens?.prompt !== undefined);
  if (canonical.length === 0) return undefined;
  const total = canonical.reduce((acc, r) => acc + (r.tokens?.prompt ?? 0), 0);
  return Math.round(total / canonical.length);
}

function netAdvantage(v: RankedVariant): number {
  return v.variant === "prod" ? 0 : v.improvements - v.regressions;
}

/**
 * Ordena las variantes evaluadas según `--metric` y los desempates de §6.1:
 * 1. Diferencia >= 0.0001 en `score` (`passRate` o `macroPassRate`)
 * 2. Menos `clientFailedRuns`, luego menos `retriedRuns`
 * 3. Evidencia favorable vs `prod` (mayor neto `improvements - regressions`, menos regresiones, menor `signTestP` cuando el neto > 0)
 * 4. Menor `p50DurationMs`
 * 5. Menor `avgPromptTokens`
 */
export function rankParticipants(
  report: ComparisonReport,
  metric: AutoMetric,
  cells: InputCell[],
): RankedVariant[] {
  const recordsByVariant = new Map<string, RunRecord[]>();
  for (const cell of cells) {
    const list = recordsByVariant.get(cell.variantSpec) ?? [];
    list.push(...cell.records);
    recordsByVariant.set(cell.variantSpec, list);
  }

  // En etapas únicas habrá solo `decision` o `generative`, nunca `total`.
  const summaries: VariantSummary[] = report.variants.filter((v) => v.kind !== "total");
  const ranked: RankedVariant[] = summaries.map((v) => ({
    variant: v.variant,
    passRate: v.passRate,
    macroPassRate: v.macroPassRate,
    score: metric === "macroPassRate" ? v.macroPassRate : v.passRate,
    passedRuns: v.passedRuns,
    totalRuns: v.totalRuns,
    clientFailedRuns: v.clientFailedRuns,
    retriedRuns: v.retriedRuns,
    regressions: v.regressions,
    improvements: v.improvements,
    ...(v.signTestP !== undefined ? { signTestP: v.signTestP } : {}),
    ...(v.p50DurationMs !== undefined ? { p50DurationMs: v.p50DurationMs } : {}),
    avgPromptTokens: computeAvgPromptTokens(recordsByVariant.get(v.variant) ?? []),
    ...(v.deltaPassRate !== undefined ? { deltaPassRate: v.deltaPassRate } : {}),
    ...(v.deltaMacroPassRate !== undefined ? { deltaMacroPassRate: v.deltaMacroPassRate } : {}),
  }));

  ranked.sort((a, b) => {
    if (Math.abs(a.score - b.score) >= SCORE_EPS) {
      return b.score - a.score;
    }
    if (a.clientFailedRuns !== b.clientFailedRuns) {
      return a.clientFailedRuns - b.clientFailedRuns;
    }
    if (a.retriedRuns !== b.retriedRuns) {
      return a.retriedRuns - b.retriedRuns;
    }

    const netA = netAdvantage(a);
    const netB = netAdvantage(b);
    if (netA !== netB) return netB - netA;
    if (a.regressions !== b.regressions) return a.regressions - b.regressions;
    if (netA > 0 && a.signTestP !== undefined && b.signTestP !== undefined && a.signTestP !== b.signTestP) {
      return a.signTestP - b.signTestP;
    }

    const p50A = a.p50DurationMs ?? Number.POSITIVE_INFINITY;
    const p50B = b.p50DurationMs ?? Number.POSITIVE_INFINITY;
    if (p50A !== p50B) return p50A - p50B;

    const tokA = a.avgPromptTokens ?? Number.POSITIVE_INFINITY;
    const tokB = b.avgPromptTokens ?? Number.POSITIVE_INFINITY;
    if (tokA !== tokB) return tokA - tokB;

    if (a.variant === "prod" && b.variant !== "prod") return 1;
    if (b.variant === "prod" && a.variant !== "prod") return -1;
    return a.variant.localeCompare(b.variant);
  });

  return ranked;
}

export function loadAutoState(stage: StageName): AutoSessionState | null {
  const path = resolve(autoStatePath(stage));
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AutoSessionState;
    if (parsed && parsed.schemaVersion === 1 && parsed.stage === stage) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAutoState(state: AutoSessionState): void {
  const stageDir = resolve(autoStageDir(state.stage));
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(resolve(autoStatePath(state.stage)), JSON.stringify(state, null, 2), "utf8");
}

function parseJsonlRecords(filePath: string): RunRecord[] {
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
}

/**
 * Escanea `eval/results/` buscando celdas vigentes y 100 % comparables para `prod` y todas las
 * variantes activas pasadas. Solo reutiliza si TODAS las combinaciones `(variante × dataset)`
 * existen con exactamente la misma huella (`datasetHash`, `cases.hash`, modelo, thinking,
 * `stageConfigHash`, `repeat`, `includeShortcut`, sin filtros, `variantHash`).
 */
export function scanReusableInitialRanking(opts: {
  cfg: AutoConfig;
  variants: Array<{ name: string; hash: string }>;
  datasets: Array<{ name: string; hash: string; casesHash: string }>;
  resultsRoot?: string;
}): { ranked: RankedVariant[]; report: ComparisonReport; cells: InputCell[] } | null {
  const { cfg, variants, datasets } = opts;
  const stageConfigHash = promptEnvironment().stageConfigHash;

  const baseDir = opts.resultsRoot
    ? resolve(opts.resultsRoot)
    : cfg.client === "real"
      ? resolve(`eval/results/${safeName(cfg.model)}`)
      : resolve(`eval/results/_${cfg.client}`);

  if (!existsSync(baseDir)) return null;

  // Listar carpetas de corridas en orden inverso (más reciente primero).
  const runDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  if (runDirs.length === 0) return null;

  const matchedCells: InputCell[] = [];

  for (const v of variants) {
    for (const ds of datasets) {
      let found: { scores: GlobalScoreSummary; records: RunRecord[] } | null = null;
      const expectedCellDir = `${safeName(v.name)}__${safeName(ds.name)}`;

      for (const runName of runDirs) {
        const cellDir = resolve(baseDir, runName, expectedCellDir);
        const metaPath = resolve(cellDir, "meta.json");
        const scoresPath = resolve(cellDir, "scores.json");
        const runsPath = resolve(cellDir, "runs.jsonl");
        if (!existsSync(metaPath) || !existsSync(scoresPath) || !existsSync(runsPath)) continue;

        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;
          const metaMatches =
            meta.model === cfg.model &&
            meta.decisionModel === cfg.decisionModel &&
            meta.variantHash === v.hash &&
            meta.datasetHash === ds.hash &&
            meta.cases?.hash === ds.casesHash &&
            meta.promptEnv?.stageConfigHash === stageConfigHash &&
            meta.repeat === cfg.repeat &&
            meta.params?.thinking === cfg.thinking &&
            meta.params?.client === cfg.client &&
            meta.params?.includeShortcut === cfg.includeShortcut &&
            (meta.filters?.tags?.length ?? 0) === 0 &&
            (meta.filters?.ids?.length ?? 0) === 0 &&
            meta.filters?.limit === null;

          if (!metaMatches) continue;

          const scores = JSON.parse(readFileSync(scoresPath, "utf8")) as GlobalScoreSummary;
          const allRecords = parseJsonlRecords(runsPath);
          const stageRecords = allRecords.filter((r) => r.stage === cfg.stage);
          if (stageRecords.length === 0) continue;

          // Verificar que ninguna llamada del dataset completo falló completamente por red.
          const canonical = stageRecords.filter((r) => r.bucket === "canonical");
          if (canonical.length > 0 && canonical.every((r) => r.metrics?.client_call_ok === false)) {
            continue;
          }

          found = { scores, records: stageRecords };
          break;
        } catch {
          continue;
        }
      }

      if (!found) return null;
      matchedCells.push({
        variantSpec: v.name,
        datasetName: ds.name,
        scores: found.scores,
        records: found.records,
      });
    }
  }

  if (matchedCells.length === 0) return null;

  const report = generateComparisonReport({
    baseline: "prod",
    cells: matchedCells,
    concurrency: cfg.concurrency,
  });
  const ranked = rankParticipants(report, cfg.metric, matchedCells);
  return { ranked, report, cells: matchedCells };
}

/**
 * Mueve variantes generadas de esta etapa que NO entraron en el Top-2 vigente NI superaron
 * a `prod` hacia `eval/variants/_auto/<stage>/descartadas/` (sin borrarlas).
 */
export function archiveLosingAutoVariants(opts: {
  stage: StageName;
  candidateFiles: Array<{ name: string; filePath: string }>;
  top2: string[];
  ranked: RankedVariant[];
  archiveLosers: boolean;
}): string[] {
  if (!opts.archiveLosers || opts.candidateFiles.length === 0) return [];

  const prodScore = opts.ranked.find((r) => r.variant === "prod")?.score ?? 0;
  const top2Set = new Set(opts.top2);
  const discardedDir = resolve(autoStageDir(opts.stage), "descartadas");
  const moved: string[] = [];

  for (const cand of opts.candidateFiles) {
    if (top2Set.has(cand.name)) continue;
    const rankInfo = opts.ranked.find((r) => r.variant === cand.name);
    const beatsProd = rankInfo !== undefined && rankInfo.score > prodScore + SCORE_EPS;
    if (beatsProd) continue;

    if (!existsSync(cand.filePath)) continue;
    mkdirSync(discardedDir, { recursive: true });
    const dest = resolve(discardedDir, basename(cand.filePath));
    renameSync(cand.filePath, dest);
    moved.push(cand.name);
  }

  return moved;
}
