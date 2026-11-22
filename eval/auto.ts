#!/usr/bin/env node
/**
 * eval/auto.ts
 *
 * Orquestador del bucle autónomo de optimización de prompts (`--auto`), según `docs/evaluacion/DISENO_EVAL_AUTONOMO.md`.
 * Reutiliza `eval/core/batch.ts` (`createEvalClients`, `executeComparisonBatch`) para ejecutar cada vuelta con el mismo
 * runner, graders y reportes que `eval/cli.ts`.
 *
 * Uso recomendado:
 *   npm run eval -- --auto --stage=args_review --max-loops=8 --target=0.80 --optimizer-model=qwen3:32b [flags]
 *   npx tsx eval/auto.ts --stage=args_review --max-loops=8 --target=0.80 --optimizer-model=qwen3:32b [flags]
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PROD_SHORTCUT_TAG } from "./core/case.ts";
import { createEvalClients, type EvalClients } from "./core/batch.ts";
import { createRawDatasetCache, type Dataset, type RawDatasetCache } from "./core/datasets.ts";
import { fmtDeltaPct, fmtMs, fmtPct } from "./core/report-format.ts";
import type { ComparisonReport, InputCell } from "./core/report.ts";
import { isDecisionStage } from "./core/stages/index.ts";
import { VARIANTS_DIR } from "./core/variants/load.ts";
import { c, fail, section, sym } from "./ui/style.ts";
import {
  executeAutoBatchInProcess,
  type AutoBatchOutcome,
  type RunAutoBatchPayload,
} from "./auto/batchRunner.ts";
import type { AutoBatchWorkerMessage } from "./auto/batchWorker.ts";
import {
  defaultLedgerPath,
  printAutoHelp,
  parseAutoConfig,
  type AutoConfig,
} from "./auto/config.ts";
import { appendLedger, formatLedgerForPrompt, type LedgerEntry } from "./auto/ledger.ts";
import {
  discoverStageDatasets,
  discoverStageVariants,
  isAutoVariantPathForStage,
} from "./auto/discover.ts";
import { loadVariantSpecEphemeral } from "./auto/ephemeralVariant.ts";
import { openAutoSession } from "./auto/session.ts";
import {
  argvForStage,
  checkMultiStageFlags,
  combineExitCodes,
  expandStages,
  formatStageSummary,
  holdoutFilesOf,
  isMultiStageArg,
  type StageOutcome,
} from "./auto/stages.ts";
import { collectDecisionRequests, currentSystemText, deriveStateNote, formatCurrentTexts, patchFromRequests, shapeFromRequests } from "./auto/patchVariant.ts";
import {
  extractConfusions,
  extractFailureKinds,
  extractVariantDatasetStats,
  formatConfusions,
  formatFailureKinds,
  type ConfusionStat,
  type FailureKind,
  type VariantDatasetStat,
} from "./auto/feedback.ts";
import {
  generateVariantsForRound,
  OptimizerTransportError,
  type OptimizerLlmCaller,
  type TopVariantContext,
} from "./auto/optimizer.ts";
import {
  archiveLosingAutoVariants,
  buildFingerprint,
  fingerprintsEqual,
  loadAutoState,
  promoteWinningAutoVariants,
  saveAutoState,
  scanReusableInitialRanking,
  type AutoSessionState,
  type RankedVariant,
} from "./auto/ranking.ts";
import { getStageContract } from "./auto/stageContract.ts";
import { collectKnownVariantHashes } from "./auto/validateVariant.ts";

export interface AutoLoopDeps {
  callOptimizer?: OptimizerLlmCaller;
  makeClients?: (cfg: AutoConfig) => EvalClients;
  /** Carpeta de la sesión (tests). Sin ella, `eval/results/auto/<etapa>/<fecha_hora>/`. */
  resultsRoot?: string;
  /** Solo para el escaneo de resultados reutilizables: si no se indica, el escaneo usa las carpetas de resultados habituales. Lo fija `runAutoLoop`. */
  reuseFrom?: string;
  variantsRoot?: string;
  silent?: boolean;
}

const BATCH_WORKER_URL = new URL("./auto/batchWorker.ts", import.meta.url);

function makeRunTag(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = randomUUID().replace(/-/g, "").slice(0, 4);
  return `${datePart}_${rand}`;
}

function countCanonicalCases(datasets: Dataset[], includeShortcut: boolean): number {
  let count = 0;
  for (const ds of datasets) {
    for (const fc of ds.cases) {
      if (fc.isRaw) continue;
      if ((fc.tags ?? []).includes(PROD_SHORTCUT_TAG) && !includeShortcut) continue;
      count++;
    }
  }
  return count;
}

async function runComparativeBatchInWorker(
  payload: RunAutoBatchPayload,
  silent?: boolean,
): Promise<AutoBatchOutcome> {
  const worker = new Worker(BATCH_WORKER_URL, { workerData: payload });
  try {
    return await new Promise<AutoBatchOutcome>((resolvePromise) => {
      let settled = false;
      const finish = (outcome: AutoBatchOutcome): void => {
        if (settled) return;
        settled = true;
        resolvePromise(outcome);
      };

      worker.on("message", (msg: AutoBatchWorkerMessage) => {
        if (msg.type === "rootReady") {
          if (!silent) console.log(`${c.gray("Resultados en")} ${c.cyan(msg.rootDir)}`);
        } else if (msg.type === "cellEnd") {
          if (!silent) console.log(`  ${msg.variantSpec.padEnd(28)} ${msg.datasetName.padEnd(24)} ${msg.passCount}/${msg.runCount}`);
        } else if (msg.type === "done") {
          finish(msg.outcome);
        } else if (msg.type === "error") {
          finish({ ok: false, reason: `Error en worker de evaluación: ${msg.message}` });
        }
      });

      worker.once("error", (err) => {
        finish({ ok: false, reason: `Error en worker de evaluación: ${err.message}` });
      });

      worker.once("exit", (code) => {
        finish({ ok: false, reason: `Worker de evaluación terminó inesperadamente (exit ${code}).` });
      });
    });
  } finally {
    await worker.terminate().catch(() => {});
  }
}

async function runComparativeBatch(opts: {
  cfg: AutoConfig;
  variantNames: string[];
  datasetPaths: string[];
  label: string;
  customClients?: EvalClients;
  resultsRoot?: string;
  variantsRoot?: string;
  rawCache?: RawDatasetCache;
  silent?: boolean;
}): Promise<AutoBatchOutcome> {
  const payload: RunAutoBatchPayload = {
    cfg: opts.cfg,
    variantNames: opts.variantNames,
    datasetPaths: opts.datasetPaths,
    label: opts.label,
    resultsRoot: opts.resultsRoot,
    variantsRoot: opts.variantsRoot,
  };

  if (!opts.customClients) {
    return runComparativeBatchInWorker(payload, opts.silent);
  }

  return executeAutoBatchInProcess(payload, {
    clients: opts.customClients,
    rawCache: opts.rawCache,
    onRootReady: (rootDir) => {
      if (!opts.silent) console.log(`${c.gray("Resultados en")} ${c.cyan(rootDir)}`);
    },
    onCellEnd: ({ variantSpec, datasetName, passCount, runCount }) => {
      if (!opts.silent) console.log(`  ${variantSpec.padEnd(28)} ${datasetName.padEnd(24)} ${passCount}/${runCount}`);
    },
  });
}

function buildTop2Contexts(
  top2Names: string[],
  ranked: RankedVariant[],
  stats: VariantDatasetStat[],
): TopVariantContext[] {
  const contexts: TopVariantContext[] = [];
  for (const name of top2Names) {
    const summary = ranked.find((r) => r.variant === name) ?? {
      variant: name,
      passRate: 0,
      macroPassRate: 0,
      score: 0,
      passedRuns: 0,
      totalRuns: 0,
      clientFailedRuns: 0,
      retriedRuns: 0,
      regressions: 0,
      improvements: 0,
    };
    contexts.push({
      name,
      summary,
      perDataset: stats.filter((s) => s.variant === name),
    });
  }
  return contexts;
}

function printRankedTable(ranked: RankedVariant[], top2: string[], cfg: AutoConfig, silent?: boolean): void {
  if (silent) return;
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const tag = top2.includes(r.variant) ? c.green(`[TOP-${top2.indexOf(r.variant) + 1}]`) : c.gray("       ");
    const delta = r.variant === "prod"
      ? c.gray("baseline")
      : r.deltaPassRate !== undefined
        ? fmtDeltaPct(cfg.metric === "macroPassRate" ? (r.deltaMacroPassRate ?? r.deltaPassRate) : r.deltaPassRate)
        : "—";
    console.log(
      `  ${i + 1}. ${tag} ${r.variant.padEnd(32)} ${fmtPct(r.score).padStart(6)} (${r.passedRuns}/${r.totalRuns})  Δ=${delta.padEnd(7)}  p50=${fmtMs(r.p50DurationMs)}`,
    );
  }
}

/** Corre el bucle dentro de una sesión (`session.json` + una carpeta por ronda) y registra cómo terminó. */
export async function runAutoLoop(cfg: AutoConfig, deps: AutoLoopDeps = {}): Promise<number> {
  const session = openAutoSession(cfg, deps.resultsRoot);
  let code = 2;
  try {
    code = await runAutoLoopInSession(cfg, { ...deps, resultsRoot: session.dir, reuseFrom: deps.resultsRoot });
    return code;
  } finally {
    session.close(code);
  }
}

async function runAutoLoopInSession(cfg: AutoConfig, deps: AutoLoopDeps): Promise<number> {
  const silent = deps.silent ?? false;
  const variantsRoot = deps.variantsRoot ?? VARIANTS_DIR;
  const rawCache = createRawDatasetCache();
  const log = (...args: unknown[]) => {
    if (!silent) console.log(...args);
  };

  // 1. Descubrir datasets dev y holdout opcional
  let discovered;
  try {
    discovered = discoverStageDatasets(cfg.stage, cfg.datasetSpecs, cfg.holdoutSpecs, rawCache);
  } catch (e) {
    fail(`Error de dataset: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  if (countCanonicalCases(discovered.dev, cfg.includeShortcut) === 0) {
    fail(`Los datasets de '${cfg.stage}' no tienen ningún caso canónico para evaluar.`);
    return 2;
  }

  const devPaths = discovered.dev.map((d) => d.path);
  const holdoutPaths = discovered.holdout.map((d) => d.path);
  const devDatasetNames = new Set(discovered.dev.map((d) => d.name));

  // 2. Validar/construir clientes del sistema evaluado (solo se retienen si los inyecta `deps.makeClients`)
  let customClients: EvalClients | undefined;
  try {
    if (deps.makeClients) {
      customClients = deps.makeClients(cfg);
    } else {
      createEvalClients(cfg);
    }
  } catch (e) {
    fail(`Error de configuración de modelos evaluados: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  // 3. Descubrir variantes activas de la etapa y preparar inicialización Top-2
  const activeVariants = await discoverStageVariants(cfg.stage, variantsRoot);
  const knownHashes = collectKnownVariantHashes(cfg.stage, activeVariants.map((v) => v.path), variantsRoot);
  const fingerprint = buildFingerprint(cfg, discovered.devHashes, discovered.devCasesHashes);
  const priorState = loadAutoState(cfg.stage, variantsRoot);
  const sameFingerprintState = priorState && fingerprintsEqual(priorState.fingerprint, fingerprint) ? priorState : null;
  const runTag = makeRunTag();

  if (!silent) {
    const decisionStage = isDecisionStage(cfg.stage);
    section(`eval --auto — etapa '${cfg.stage}'`);
    log(`  Objetivo: ${cfg.metric} >= ${fmtPct(cfg.target)} | Máx. vueltas: ${cfg.maxLoops}`);
    if (decisionStage) {
      log(`  Modelo evaluado (decisión): ${cfg.decisionModel} (${cfg.decisionUrl}) [client=${cfg.client}, repeat=${cfg.repeat}]`);
    } else {
      log(`  Modelo evaluado (generativo): ${cfg.model} (${cfg.url}) [client=${cfg.client}, thinking=${cfg.thinking}, repeat=${cfg.repeat}]`);
    }
    log(`  Optimizador: ${cfg.optimizerModel} (${cfg.optimizerUrl}, thinking=${cfg.optimizerThinking})`);
    log(`  Datasets dev (${discovered.dev.length}): ${discovered.dev.map((d) => `${d.name}(${d.cases.length})`).join(", ")}`);
    if (discovered.holdout.length > 0) {
      log(`  Holdout (${discovered.holdout.length}): ${discovered.holdout.map((d) => `${d.name}(${d.cases.length})`).join(", ")}`);
    }
    log(`  Historial de ideas: ${cfg.ledgerPath}`);
    if (sameFingerprintState) {
      log(`  ${c.gray(`Sesión previa compatible detectada (${sameFingerprintState.completedRounds} vuelta(s), Top-2=${sameFingerprintState.top2.join(", ")}).`)}`);
    }
  }

  let currentTop2: string[] = [];
  let lastStats: VariantDatasetStat[] = [];
  let lastFailureKinds: FailureKind[] = [];
  let lastConfusions: ConfusionStat[] = [];
  let lastRanked: RankedVariant[] = [];
  let bestNonProd: AutoSessionState["bestNonProd"] | undefined = sameFingerprintState?.bestNonProd;
  let completedRounds = sameFingerprintState?.completedRounds ?? 0;
  const testedHoldoutVariants = new Map<string, { score: number; confirmed: boolean; round: number }>(
    Object.entries(sameFingerprintState?.holdoutChecked ?? {}),
  );

  const summarizeBatchMemory = (
    top2: string[],
    ranked: RankedVariant[],
    report: ComparisonReport,
    cells: InputCell[],
  ): void => {
    lastRanked = ranked;
    lastStats = extractVariantDatasetStats(report, cells);
    lastConfusions = cells.length > 0 ? extractConfusions({ focusVariant: top2[0] ?? "prod", cells, devDatasetNames, devDatasetPaths: devPaths }) : [];
    // Ninguna etapa muestra casos al optimizador: las de decisión ven errores por etiqueta; las generativas, tipos de fallo del evaluador con su conteo.
    lastFailureKinds = cells.length > 0 && !isDecisionStage(cfg.stage) ? extractFailureKinds({ focusVariant: top2[0] ?? "prod", cells, devDatasetNames, devDatasetPaths: devPaths }) : [];
  };

  if (cfg.seedTop.length > 0) {
    // Validar existencia y cargar de forma efímera las variantes de --seed-top (sin ESM cache)
    const seedSpecs: Array<{ name: string; hash: string }> = [];
    for (const s of cfg.seedTop) {
      try {
        const loaded = loadVariantSpecEphemeral(s, undefined, variantsRoot);
        seedSpecs.push({ name: s, hash: loaded.hash });
      } catch (e) {
        fail(`Error en --seed-top='${s}': ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    }
    currentTop2 = [...cfg.seedTop];

    const prodSpec = loadVariantSpecEphemeral("prod", undefined, variantsRoot);
    const cacheCheck = scanReusableInitialRanking({
      cfg,
      variants: [{ name: "prod", hash: prodSpec.hash }, ...seedSpecs.filter((s) => s.name !== "prod")],
      datasets: discovered.dev.map((d) => ({ name: d.name, hash: d.hash, casesHash: discovered.devCasesHashes[d.name] })),
      resultsRoot: deps.reuseFrom,
    });
    if (cacheCheck) {
      summarizeBatchMemory(currentTop2, cacheCheck.ranked, cacheCheck.report, cacheCheck.cells);
      log(`\n${sym.ok} Top-2 fijado por --seed-top (${currentTop2.join(", ")}) con resultados cacheados reutilizados.`);
    } else {
      // Sin caché compatible no se inventan métricas: se evalúa de verdad prod + las variantes semilla para que el optimizador vea resultados reales.
      log(`\n${sym.bullet} Top-2 inicial fijado por --seed-top (${currentTop2.join(", ")}); sin caché compatible: Vuelta 0 real sobre prod + semillas.`);
      if (!silent) section(`Vuelta 0 — Baseline + ${seedSpecs.filter((s) => s.name !== "prod").length} variante(s) semilla`);
      const batch0 = await runComparativeBatch({
        cfg,
        variantNames: ["prod", ...seedSpecs.filter((s) => s.name !== "prod").map((s) => s.name)],
        datasetPaths: devPaths,
        label: "r0",
        customClients,
        resultsRoot: deps.resultsRoot,
        variantsRoot,
        rawCache,
        silent,
      });
      if (!batch0.ok) {
        fail(batch0.reason);
        return 2;
      }
      summarizeBatchMemory(currentTop2, batch0.ranked, batch0.report, batch0.cells);
      printRankedTable(batch0.ranked, currentTop2, cfg, silent);
    }
  } else {
    // Intentar reutilizar resultados compatibles en eval/results/ para prod + variantes activas
    const prodSpec = loadVariantSpecEphemeral("prod", undefined, variantsRoot);
    const variantsForScan = [
      { name: "prod", hash: prodSpec.hash },
      ...activeVariants.map((v) => ({ name: v.name, hash: v.hash })),
    ];
    const datasetSpecsForScan = discovered.dev.map((d) => ({
      name: d.name,
      hash: d.hash,
      casesHash: discovered.devCasesHashes[d.name],
    }));

    const reused = scanReusableInitialRanking({
      cfg,
      variants: variantsForScan,
      datasets: datasetSpecsForScan,
      resultsRoot: deps.reuseFrom,
    });

    if (reused) {
      currentTop2 = reused.ranked.slice(0, 2).map((r) => r.variant);
      summarizeBatchMemory(currentTop2, reused.ranked, reused.report, reused.cells);
      if (!silent) {
        section("Inicialización Top-2 (resultados cacheados reutilizados)");
        printRankedTable(reused.ranked, currentTop2, cfg, silent);
      }
    } else {
      if (!silent) {
        section(`Vuelta 0 — Baseline + ${activeVariants.length} variante(s) activa(s)`);
      }
      const initialNames = variantsForScan.map((v) => v.name);
      const batch0 = await runComparativeBatch({
        cfg,
        variantNames: initialNames,
        datasetPaths: devPaths,
        label: "r0",
        customClients,
        resultsRoot: deps.resultsRoot,
        variantsRoot,
        rawCache,
        silent,
      });
      if (!batch0.ok) {
        fail(batch0.reason);
        return 2;
      }
      currentTop2 = batch0.ranked.slice(0, 2).map((r) => r.variant);
      summarizeBatchMemory(currentTop2, batch0.ranked, batch0.report, batch0.cells);
      printRankedTable(batch0.ranked, currentTop2, cfg, silent);
    }

    const best0 = lastRanked.find((r) => r.variant !== "prod");
    if (best0 && (!bestNonProd || best0.score >= bestNonProd.score)) {
      bestNonProd = { variant: best0.variant, score: best0.score, round: 0 };
    }
  }

  const persistSessionState = (): void => {
    saveAutoState({
      schemaVersion: 1,
      stage: cfg.stage,
      fingerprint,
      completedRounds,
      top2: currentTop2,
      top2Summaries: currentTop2
        .map((name) => lastRanked.find((r) => r.variant === name))
        .filter((r): r is RankedVariant => Boolean(r)),
      prodSummary: lastRanked.find((r) => r.variant === "prod"),
      bestNonProd,
      ...(testedHoldoutVariants.size > 0
        ? { holdoutChecked: Object.fromEntries(testedHoldoutVariants.entries()) }
        : {}),
      updatedAt: new Date().toISOString(),
    }, variantsRoot);
  };

  // Holdout: se mide `prod` una vez como referencia. El umbral para confirmar es `--target` o, con `--holdout-margin`, prod + margen.
  let holdoutThreshold = cfg.target;
  if (holdoutPaths.length > 0) {
    const prodHoldout = await runComparativeBatch({
      cfg,
      variantNames: ["prod"],
      datasetPaths: holdoutPaths,
      label: "holdout-prod",
      customClients,
      resultsRoot: deps.resultsRoot,
      variantsRoot,
      rawCache,
      silent: true,
    });
    if (!prodHoldout.ok) {
      fail(prodHoldout.reason);
      return 2;
    }
    const prodRow = prodHoldout.ranked.find((r) => r.variant === "prod");
    const prodScore = prodRow?.score ?? 0;
    if (cfg.holdoutMargin !== undefined) holdoutThreshold = prodScore + cfg.holdoutMargin;
    log(
      `\n  ${sym.bullet} Holdout: prod obtiene ${fmtPct(prodScore)} (${prodRow?.passedRuns ?? 0}/${prodRow?.totalRuns ?? 0}). Umbral para confirmar: ${fmtPct(Math.min(holdoutThreshold, 1))}${
        cfg.holdoutMargin !== undefined ? ` (prod + ${fmtPct(cfg.holdoutMargin)})` : " (--target)"
      }.`,
    );
    if (holdoutThreshold > 1) {
      log(`  ${sym.warn} ${c.yellow(`El umbral (${fmtPct(holdoutThreshold)}) supera el 100 %: ninguna variante podrá confirmarse. Bajá --holdout-margin.`)}`);
    }
  }

  // Etapas de decisión: el optimizador escribe solo textos. Las preguntas válidas salen de los casos y los textos vigentes de cada Top-2.
  const decisionShape = isDecisionStage(cfg.stage) ? shapeFromRequests(collectDecisionRequests(cfg.stage, devPaths, undefined, rawCache)) : undefined;
  const prodRequests = decisionShape ? collectDecisionRequests(cfg.stage, devPaths, undefined, rawCache) : [];
  const requestsOf = (name: string) =>
    collectDecisionRequests(cfg.stage, devPaths, name === "prod" ? undefined : loadVariantSpecEphemeral(name, undefined, variantsRoot).variant, rawCache);
  const scoreOf = (name: string, contexts: TopVariantContext[]): string => {
    const score = contexts.find((c) => c.name === name)?.summary.score;
    return score !== undefined ? ` (${cfg.metric}=${fmtPct(score)})` : "";
  };
  // rewrite: Top-1 y Top-2 como referencia. improve: solo el prompt base (el Top-1 vigente), con sus textos completos para aplicar los cambios encima.
  const buildDecisionContext = (names: string[], contexts: TopVariantContext[]) => {
    if (cfg.mode === "improve") {
      const baseName = names[0] ?? "prod";
      const reqs = requestsOf(baseName);
      const stateNote = baseName === "prod" ? undefined : deriveStateNote(reqs, prodRequests);
      const base = { ...patchFromRequests(reqs), ...(stateNote !== undefined ? { stateNote } : {}) };
      return { shape: decisionShape!, mode: cfg.mode, base, confusions: formatConfusions(lastConfusions), topTexts: `### Base: \`${baseName}\`${scoreOf(baseName, contexts)}\n${formatCurrentTexts(reqs, stateNote)}` };
    }
    const topTexts = names
      .map((name, i) => `### Top-${i + 1}: \`${name}\`${scoreOf(name, contexts)}\n${formatCurrentTexts(requestsOf(name))}`)
      .join("\n\n");
    return { shape: decisionShape!, mode: cfg.mode, confusions: formatConfusions(lastConfusions), topTexts };
  };

  // Etapas generativas: el optimizador escribe el texto SYSTEM completo. Se le muestran los vigentes (improve: solo el del Top-1, que es el texto base).
  const generativeKey = isDecisionStage(cfg.stage) ? undefined : getStageContract(cfg.stage).promptKey;
  const systemOf = (name: string): string =>
    currentSystemText(generativeKey!, name === "prod" ? undefined : loadVariantSpecEphemeral(name, undefined, variantsRoot).variant);
  const buildGenerativeContext = (names: string[], contexts: TopVariantContext[]) => {
    const block = (name: string, label: string): string => `### ${label}: \`${name}\`${scoreOf(name, contexts)}\n${JSON.stringify(systemOf(name))}`;
    const baseName = names[0] ?? "prod";
    const topTexts = cfg.mode === "improve" ? block(baseName, "Base") : names.map((name, i) => block(name, `Top-${i + 1}`)).join("\n\n");
    return { topTexts, current: systemOf(baseName), mode: cfg.mode, failures: formatFailureKinds(lastFailureKinds) };
  };

  // 4. Bucle Vuelta 1 .. maxLoops
  for (let round = 1; round <= cfg.maxLoops; round++) {
    if (!silent) {
      section(`Vuelta ${round}/${cfg.maxLoops}`);
    }

    const ledgerText = formatLedgerForPrompt(cfg.ledgerPath);
    const top2Contexts = buildTop2Contexts(currentTop2, lastRanked, lastStats);

    // 4.1 & 4.2 Generar + validar hasta 2 variantes nuevas
    let generation;
    try {
      generation = await generateVariantsForRound({
        cfg,
        round,
        runTag,
        ledgerText,
        top2Contexts,
        allRanked: lastRanked,
        ...(decisionShape ? { decision: buildDecisionContext(currentTop2, top2Contexts) } : { generative: buildGenerativeContext(currentTop2, top2Contexts) }),
        devDatasetPaths: devPaths,
        knownHashes,
        variantsRoot,
        rawCache,
        callLlm: deps.callOptimizer,
      });
    } catch (e) {
      if (e instanceof OptimizerTransportError) {
        fail(`Error de transporte del optimizador en Vuelta ${round}: ${e.message}`);
        return 2;
      }
      fail(`Error inesperado en optimizador: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }

    if (generation.analysis && !silent) {
      log(`  ${c.gray("Diagnóstico:")} ${generation.analysis}`);
    }
    for (const note of generation.rejectedNotes) {
      log(`  ${sym.warn} ${c.yellow(`Variante rechazada tras reintentos: ${note}`)}`);
    }
    for (const v of generation.validVariants) {
      log(`  ${sym.ok} Generada ${c.cyan(v.name)}: ${v.hypothesis}`);
    }

    if (generation.validVariants.length === 0) {
      log(`  ${sym.warn} ${c.yellow("Ninguna variante pasó validación en esta vuelta; registrando fallo y continuando.")}`);
      completedRounds += 1;
      appendLedger(cfg.ledgerPath, [
        { round, variant: "(ninguna válida)", summary: generation.rejectedNotes[0] ?? "todas las propuestas fallaron la validación", status: "invalida" },
      ]);
      persistSessionState();
      continue;
    }

    // 4.3 Corrida comparativa unificada `[prod, ...currentTop2, ...nuevas]`
    const newNames = generation.validVariants.map((v) => v.name);
    const batch = await runComparativeBatch({
      cfg,
      variantNames: [...currentTop2, ...newNames],
      datasetPaths: devPaths,
      label: `r${round}`,
      customClients,
      resultsRoot: deps.resultsRoot,
      variantsRoot,
      rawCache,
      silent,
    });

    if (!batch.ok) {
      fail(batch.reason);
      return 2;
    }

    const nextTop2 = batch.ranked.slice(0, 2).map((r) => r.variant);
    printRankedTable(batch.ranked, nextTop2, cfg, silent);

    // 4.4 Archivar variantes generadas perdedoras en `_auto/<stage>/descartadas/`
    const autoCandidatesInBatch: Array<{ name: string; filePath: string }> = batch.loadedFiles
      .filter((info) => isAutoVariantPathForStage(info.filePath, cfg.stage, variantsRoot))
      .map((info) => ({ name: info.name, filePath: info.filePath }));
    // 4.4a Las que superan a prod salen de _auto/ hacia _ganadoras/<etapa>/ (antes de archivar, así el archivo de perdedoras no las toca).
    const promoted = promoteWinningAutoVariants({ stage: cfg.stage, candidateFiles: autoCandidatesInBatch, ranked: batch.ranked, variantsRoot });
    if (promoted.length > 0) {
      log(`  ${c.green("Ganadoras (superan a prod) movidas a _ganadoras/" + cfg.stage + "/:")} ${promoted.join(", ")}`);
    }
    const archived = archiveLosingAutoVariants({
      stage: cfg.stage,
      candidateFiles: autoCandidatesInBatch.filter((cand) => !promoted.includes(cand.name)),
      top2: nextTop2,
      ranked: batch.ranked,
      archiveLosers: cfg.archiveLosers,
      variantsRoot,
    });
    if (archived.length > 0) {
      log(`  ${c.gray("Archivadas en descartadas/:")} ${archived.join(", ")}`);
    }

    // 4.5 Revisar condición de corte `--target` (solo variantes != prod)
    const roundBestNonProd = batch.ranked.find((r) => r.variant !== "prod");
    if (roundBestNonProd && (!bestNonProd || roundBestNonProd.score >= bestNonProd.score)) {
      bestNonProd = { variant: roundBestNonProd.variant, score: roundBestNonProd.score, round };
    }

    let holdoutConfirmed = false;
    let holdoutOverfitNote: string | undefined;
    let holdoutEvaluatedCandidate: RankedVariant | undefined;

    if (roundBestNonProd && roundBestNonProd.score >= cfg.target) {
      if (holdoutPaths.length > 0) {
        const candidateToTest = batch.ranked.find(
          (r) => r.variant !== "prod" && r.score >= cfg.target && !testedHoldoutVariants.has(r.variant),
        );
        if (!candidateToTest) {
          const prev = testedHoldoutVariants.get(roundBestNonProd.variant);
          log(
            `\n  ${sym.warn} '${roundBestNonProd.variant}' alcanzó ${fmtPct(roundBestNonProd.score)} en dev pero ya falló --holdout en R${prev?.round ?? "?"} (${fmtPct(prev?.score ?? 0)}); se omite re-evaluación.`,
          );
        } else {
          holdoutEvaluatedCandidate = candidateToTest;
          if (!silent) {
            log(`\n  ${sym.bullet} '${candidateToTest.variant}' alcanzó ${fmtPct(candidateToTest.score)} en dev; validando contra --holdout...`);
          }
          const holdoutBatch = await runComparativeBatch({
            cfg,
            variantNames: [candidateToTest.variant],
            datasetPaths: holdoutPaths,
            label: `r${round}-holdout`,
            customClients,
            resultsRoot: deps.resultsRoot,
            variantsRoot,
            rawCache,
            silent,
          });
          if (!holdoutBatch.ok) {
            fail(holdoutBatch.reason);
            return 2;
          }
          const holdoutRow = holdoutBatch.ranked.find((r) => r.variant === candidateToTest.variant);
          const holdoutScore = holdoutRow?.score ?? 0;
          const passedHoldout = holdoutScore >= holdoutThreshold;
          testedHoldoutVariants.set(candidateToTest.variant, { score: holdoutScore, confirmed: passedHoldout, round });
          if (passedHoldout) {
            holdoutConfirmed = true;
            bestNonProd = { variant: candidateToTest.variant, score: candidateToTest.score, round, confirmedHoldout: true };
            log(`  ${sym.ok} ${c.green(`Holdout confirmado: ${fmtPct(holdoutScore)} >= ${fmtPct(holdoutThreshold)}`)}`);
          } else {
            holdoutOverfitNote = `'${candidateToTest.variant}' obtuvo ${fmtPct(candidateToTest.score)} en dev pero cayó a ${fmtPct(holdoutScore)} en holdout (< ${fmtPct(holdoutThreshold)}) — posible sobreajuste.`;
            log(`  ${sym.warn} ${c.yellow(holdoutOverfitNote)}`);
          }
        }
      } else {
        holdoutConfirmed = true;
        holdoutEvaluatedCandidate = roundBestNonProd;
      }
    }

    // 4.6 Registrar la vuelta en el ledger (lo medido lo escribe el código; del modelo solo viene el resumen de cada variante).
    // El holdout se anota sin cifras: el optimizador no debe enterarse de los resultados del dataset oculto.
    appendLedger(
      cfg.ledgerPath,
      generation.validVariants.map((v): LedgerEntry => {
        const row = batch.ranked.find((r) => r.variant === v.name);
        if (!row) return { round, variant: v.name, summary: v.hypothesis, status: "no_evaluada" };
        const delta = cfg.metric === "macroPassRate" ? (row.deltaMacroPassRate ?? row.deltaPassRate) : row.deltaPassRate;
        const failedHoldout = holdoutOverfitNote !== undefined && holdoutEvaluatedCandidate?.variant === v.name;
        return {
          round,
          variant: v.name,
          summary: v.hypothesis,
          score: row.score,
          ...(delta !== undefined ? { deltaVsProd: delta } : {}),
          improvements: row.improvements,
          regressions: row.regressions,
          status: failedHoldout ? "fallo_holdout" : nextTop2.includes(v.name) ? "top2" : "perdio",
        };
      }),
    );

    completedRounds += 1;
    currentTop2 = nextTop2;
    summarizeBatchMemory(nextTop2, batch.ranked, batch.report, batch.cells);

    persistSessionState();

    const winner = holdoutEvaluatedCandidate ?? roundBestNonProd;
    if (holdoutConfirmed && winner) {
      log(`\n${sym.ok} ${c.green(`Objetivo cumplido en Vuelta ${round}: '${winner.variant}' (${fmtPct(winner.score)} >= ${fmtPct(cfg.target)})`)}`);
      return 0;
    }
  }

  // Se alcanzó maxLoops sin cumplir --target: el estado y el historial ya quedaron guardados en cada vuelta; sale con 1.
  persistSessionState();

  log(
    `\n${sym.warn} ${c.yellow(`Se alcanzó --max-loops=${cfg.maxLoops} sin alcanzar ${fmtPct(cfg.target)}.`)} Mejor variante != prod: ${bestNonProd ? `${bestNonProd.variant} (${fmtPct(bestNonProd.score)})` : "ninguna"}`,
  );
  return 1;
}

/**
 * `--stage` con varias etapas: corre cada una en serie (decisión primero) con los mismos `--max-loops` y `--target`. Una etapa que termina sin alcanzar
 * el objetivo no corta a las demás; un error de configuración o de transporte sí. Termina con 0 si todas llegaron, 1 si alguna no, 2 si hubo un error.
 */
export async function runAutoStages(argv: string[], deps: AutoLoopDeps = {}): Promise<number> {
  const raw = argv.find((a) => a.startsWith("--stage="))?.slice("--stage=".length) ?? "";
  let stages: ReturnType<typeof expandStages>;
  try {
    checkMultiStageFlags(argv);
    stages = expandStages(raw);
  } catch (e) {
    fail(`Error de configuración: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const holdoutAuto = argv.includes("--holdout=auto");
  const outcomes: StageOutcome[] = [];

  for (const [i, stage] of stages.entries()) {
    if (!deps.silent) section(`Etapa ${i + 1}/${stages.length}: ${stage}`);
    let cfg: AutoConfig;
    try {
      cfg = parseAutoConfig(argvForStage(argv, stage));
    } catch (e) {
      fail(`Error de configuración: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
    if (deps.variantsRoot) cfg.ledgerPath = defaultLedgerPath(stage, deps.variantsRoot);
    cfg.holdoutSpecs = holdoutAuto ? holdoutFilesOf(stage) : [];
    if (holdoutAuto && cfg.holdoutSpecs.length === 0 && !deps.silent) console.log(`  ${sym.warn} Sin holdout para '${stage}': se confirma solo con los datasets de desarrollo.`);

    try {
      discoverStageDatasets(stage, [], cfg.holdoutSpecs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.startsWith("Ninguno de los datasets cargados contiene casos")) {
        fail(`Error de configuración: ${message}`);
        return 2;
      }
      if (!deps.silent) console.log(`  ${sym.warn} '${stage}' no tiene datasets con casos: se omite.`);
      outcomes.push({ stage, code: "skipped" });
      continue;
    }

    const code = (await runAutoLoop(cfg, deps)) as 0 | 1 | 2;
    const state = loadAutoState(stage, deps.variantsRoot);
    outcomes.push({
      stage,
      code,
      ...(state?.prodSummary ? { prodScore: state.prodSummary.score } : {}),
      ...(state?.bestNonProd ? { best: { variant: state.bestNonProd.variant, score: state.bestNonProd.score } } : {}),
    });
    if (code === 2) break;
  }

  if (!deps.silent) {
    section("Resumen");
    console.log(formatStageSummary(outcomes));
    const pending = stages.length - outcomes.length;
    if (pending > 0) console.log(`  ${sym.warn} Se cortó por un error: ${pending} etapa(s) sin correr.`);
  }
  return combineExitCodes(outcomes);
}

/** Punto de entrada programático compartido por `eval/cli.ts --auto` y `eval/auto.ts`. */
export async function runAutoCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printAutoHelp();
    return 0;
  }

  const stageArg = argv.find((a) => a.startsWith("--stage="))?.slice("--stage=".length);
  if (stageArg !== undefined && isMultiStageArg(stageArg)) return runAutoStages(argv);

  let cfg: AutoConfig;
  try {
    cfg = parseAutoConfig(argv);
  } catch (e) {
    fail(`Error de configuración: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  return runAutoLoop(cfg);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  runAutoCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}
