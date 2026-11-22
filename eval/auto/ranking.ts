/**
 * eval/auto/ranking.ts
 *
 * Selección determinista de Top-2 (sin LLM), desempates (`§6.1`), persistencia de estado
 * (`auto_state.json`), reutilización de corridas compatibles en `eval/results/` (`§2.3`)
 * y archivado de variantes generadas perdedoras en `descartadas/` (`§2.4`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, resolve } from "node:path";
import { atomicWriteFileSync, forEachJsonlLineSync } from "../core/io.ts";
import { generateComparisonReport, type ComparisonReport, type InputCell, type VariantSummary } from "../core/report.ts";
import { evaluatedModelDirName, RESULTS_ROOT, safeName } from "../core/results.ts";
import { promptEnvironment } from "../core/scenario.ts";
import { computeScoreSummary } from "../core/scoring.ts";
import { isDecisionStage } from "../core/stages/index.ts";
import type { GlobalScoreSummary, RunMeta, RunRecord, StageName } from "../core/types.ts";
import { invalidateVariantCache, VARIANTS_DIR } from "../core/variants/load.ts";
import type { AutoConfig, AutoMetric } from "./config.ts";
import { autoStageDir, autoStatePath, winnersStageDir } from "./config.ts";

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
  holdoutChecked?: Record<string, { score: number; confirmed: boolean; round: number }>;
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

export function loadAutoState(stage: StageName, variantsRoot = VARIANTS_DIR): AutoSessionState | null {
  const path = resolve(autoStatePath(stage, variantsRoot));
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

export function saveAutoState(state: AutoSessionState, variantsRoot = VARIANTS_DIR): void {
  atomicWriteFileSync(resolve(autoStatePath(state.stage, variantsRoot)), JSON.stringify(state, null, 2));
}

function slimRecordForMemory(r: RunRecord): RunRecord {
  return {
    ...r,
    errors: [],
    warnings: [],
    rawInput: undefined,
    rawOutput: "",
    parsedOutput: undefined,
    probabilities: undefined,
    rawScore: undefined,
    questions: undefined,
  };
}

function parseJsonlRecordsForStage(filePath: string, stage: StageName): { allCount: number; stageRecords: RunRecord[] } {
  let allCount = 0;
  const stageRecords: RunRecord[] = [];
  forEachJsonlLineSync(filePath, (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    allCount++;
    const rec = JSON.parse(trimmed) as RunRecord;
    if (rec.stage === stage) {
      stageRecords.push(rec);
    }
  });
  return { allCount, stageRecords };
}

/** Nombres de carpeta de modelo donde pueden estar las corridas compatibles (decisión: el de decisión y, si difiere, el generativo). */
function evaluatedModelFolders(cfg: AutoConfig, decisionOnly: boolean): string[] {
  const main = evaluatedModelDirName({ stages: [cfg.stage], model: cfg.model, decisionModel: cfg.decisionModel });
  return decisionOnly && cfg.model !== cfg.decisionModel ? [main, safeName(cfg.model)] : [main];
}

/** Sesiones `--auto` anteriores de la etapa (más recientes primero): cada una contiene sus rondas. */
function autoSessionFolders(stage: string, root: string): string[] {
  const base = resolve(`${root}/auto/${stage}`);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .map((name) => resolve(base, name));
}

/**
 * Carpetas que pueden contener corridas reutilizables (cada una guarda carpetas de corrida con sus celdas). Con `resultsRoot` solo esa;
 * si no: las corridas manuales del modelo, las rondas de sesiones `--auto` anteriores de la etapa y la carpeta anterior a la reorganización
 * (`<raíz>/<modelo>/`, cuyos resultados siguen siendo reutilizables). `root` se parametriza para poder probarlo.
 */
export function reusableResultsDirs(cfg: AutoConfig, resultsRoot?: string, root: string = RESULTS_ROOT): string[] {
  if (resultsRoot) return [resolve(resultsRoot)];
  if (cfg.client !== "real") return [resolve(`${root}/sin-modelo/${cfg.client}`), resolve(`${root}/_${cfg.client}`)];
  const models = evaluatedModelFolders(cfg, isDecisionStage(cfg.stage));
  return [
    ...models.map((m) => resolve(`${root}/evals/${m}`)),
    ...autoSessionFolders(cfg.stage, root),
    ...models.map((m) => resolve(`${root}/${m}`)),
  ];
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
  const decisionOnly = isDecisionStage(cfg.stage);

  const candidateDirs = reusableResultsDirs(cfg, opts.resultsRoot);

  const baseDirs = [...new Set(candidateDirs)].filter((d) => existsSync(d));
  if (baseDirs.length === 0) return null;

  // Listar carpetas de corridas en orden inverso (más reciente primero) por cada raíz compatible.
  const runDirs: Array<{ baseDir: string; runName: string }> = [];
  for (const baseDir of baseDirs) {
    const names = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const runName of names) runDirs.push({ baseDir, runName });
  }

  if (runDirs.length === 0) return null;

  // Fase 1: buscar celdas compatibles leyendo solo `meta.json` (y validando existencia de scores.json/runs.jsonl).
  // Fase 2: leer `scores.json` y `runs.jsonl` únicamente cuando TODAS las celdas `(variante × dataset)` tuvieron candidato compatible.
  type CandidateCell = { variantName: string; datasetName: string; cellDir: string };
  const matchedCandidates: CandidateCell[] = [];
  const candidatesByPair = new Map<string, CandidateCell[]>();

  for (const v of variants) {
    for (const ds of datasets) {
      const expectedCellDir = `${safeName(v.name)}__${safeName(ds.name)}`;
      const matches: CandidateCell[] = [];

      for (const { baseDir, runName } of runDirs) {
        const cellDir = resolve(baseDir, runName, expectedCellDir);
        const metaPath = resolve(cellDir, "meta.json");
        const scoresPath = resolve(cellDir, "scores.json");
        const runsPath = resolve(cellDir, "runs.jsonl");
        if (!existsSync(metaPath) || !existsSync(scoresPath) || !existsSync(runsPath)) continue;

        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;
          const modelMatches = decisionOnly
            ? meta.decisionModel === cfg.decisionModel
            : meta.model === cfg.model;
          const metaMatches =
            modelMatches &&
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

          if (metaMatches) {
            matches.push({ variantName: v.name, datasetName: ds.name, cellDir });
          }
        } catch {
          continue;
        }
      }

      if (matches.length === 0) return null;
      candidatesByPair.set(`${v.name}\u0000${ds.name}`, matches);
      matchedCandidates.push(matches[0]);
    }
  }

  if (matchedCandidates.length === 0) return null;

  const matchedCells: InputCell[] = [];
  for (const v of variants) {
    for (const ds of datasets) {
      const list = candidatesByPair.get(`${v.name}\u0000${ds.name}`) ?? [];
      let loaded: { scores: GlobalScoreSummary; records: RunRecord[]; cellDir: string } | null = null;

      for (const cand of list) {
        try {
          const rawScores = JSON.parse(readFileSync(resolve(cand.cellDir, "scores.json"), "utf8")) as GlobalScoreSummary;
          const { allCount, stageRecords } = parseJsonlRecordsForStage(resolve(cand.cellDir, "runs.jsonl"), cfg.stage);
          if (stageRecords.length === 0) continue;

          // Verificar que haya casos canónicos y que no hayan fallado completamente por red.
          const canonical = stageRecords.filter((r) => r.bucket === "canonical");
          if (canonical.length === 0 || canonical.every((r) => r.metrics?.client_call_ok === false)) {
            continue;
          }

          const scores = stageRecords.length === allCount ? rawScores : computeScoreSummary(stageRecords);
          loaded = {
            scores,
            records: stageRecords.map(slimRecordForMemory),
            cellDir: cand.cellDir,
          };
          break;
        } catch {
          continue;
        }
      }

      if (!loaded) return null;
      matchedCells.push({
        variantSpec: v.name,
        datasetName: ds.name,
        scores: loaded.scores,
        records: loaded.records,
        cellDir: loaded.cellDir,
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
 * Mueve a `eval/variants/_ganadoras/<etapa>/` las variantes generadas que superaron a `prod` en esta corrida, para que no se mezclen con
 * las que quedan en `_auto/<etapa>/`. Se mueven, no se copian (el nombre de una variante debe ser único) y nunca se pisa un archivo existente.
 * Siguen cargándose por nombre y como variantes activas en las corridas siguientes, pero ya no se archivan ni se descartan.
 */
export function promoteWinningAutoVariants(opts: {
  stage: StageName;
  candidateFiles: Array<{ name: string; filePath: string }>;
  ranked: RankedVariant[];
  variantsRoot?: string;
}): string[] {
  const prodScore = opts.ranked.find((r) => r.variant === "prod")?.score ?? 0;
  const winnersDir = resolve(winnersStageDir(opts.stage, opts.variantsRoot));
  const moved: string[] = [];

  for (const cand of opts.candidateFiles) {
    const row = opts.ranked.find((r) => r.variant === cand.name);
    if (!row || row.score <= prodScore + SCORE_EPS || !existsSync(cand.filePath)) continue;
    const dest = resolve(winnersDir, basename(cand.filePath));
    if (existsSync(dest)) continue;
    mkdirSync(winnersDir, { recursive: true });
    renameSync(cand.filePath, dest);
    moved.push(cand.name);
  }

  if (moved.length > 0) invalidateVariantCache(opts.variantsRoot);
  return moved;
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
  variantsRoot?: string;
}): string[] {
  if (!opts.archiveLosers || opts.candidateFiles.length === 0) return [];

  const prodScore = opts.ranked.find((r) => r.variant === "prod")?.score ?? 0;
  const top2Set = new Set(opts.top2);
  const discardedDir = resolve(autoStageDir(opts.stage, opts.variantsRoot), "descartadas");
  const moved: string[] = [];

  for (const cand of opts.candidateFiles) {
    if (top2Set.has(cand.name)) continue;
    const rankInfo = opts.ranked.find((r) => r.variant === cand.name);
    const beatsProd = rankInfo !== undefined && rankInfo.score > prodScore + SCORE_EPS;
    if (beatsProd) continue;

    if (!existsSync(cand.filePath)) continue;
    mkdirSync(discardedDir, { recursive: true });
    const baseName = basename(cand.filePath, ".ts");
    let dest = resolve(discardedDir, `${baseName}.ts`);
    for (let n = 2; existsSync(dest); n++) {
      dest = resolve(discardedDir, `${baseName}-${n}.ts`);
    }
    renameSync(cand.filePath, dest);
    moved.push(cand.name);
  }

  if (moved.length > 0) {
    invalidateVariantCache(opts.variantsRoot);
  }

  return moved;
}
