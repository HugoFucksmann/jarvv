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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PROD_SHORTCUT_TAG } from "./core/case.ts";
import { createEvalClients, executeComparisonBatch, type BatchVariantInput, type EvalClients } from "./core/batch.ts";
import { loadDatasets, type Dataset } from "./core/datasets.ts";
import { fmtDeltaPct, fmtMs, fmtPct } from "./core/report-format.ts";
import type { ComparisonReport, InputCell } from "./core/report.ts";
import { isDecisionStage } from "./core/stages/index.ts";
import type { Case, StageName } from "./core/types.ts";
import { loadVariantSpec, variantFilePath } from "./core/variants/load.ts";
import type { Variant } from "./core/variants/types.ts";
import { c, fail, section, sym } from "./ui/style.ts";
import {
  printAutoHelp,
  parseAutoConfig,
  toEvalConfig,
  type AutoConfig,
} from "./auto/config.ts";
import {
  buildBaselineConclusionsMarkdown,
  formatConclusionsForPrompt,
  formatObjectiveRoundFacts,
  readConclusionsBounded,
  recordHoldoutOverfitAlert,
  writeConclusionsFile,
} from "./auto/conclusions.ts";
import {
  discoverStageDatasets,
  discoverStageVariants,
  isAutoVariantPathForStage,
} from "./auto/discover.ts";
import {
  extractFailureSamples,
  extractVariantDatasetStats,
  type FailureSample,
} from "./auto/feedback.ts";
import {
  decideConclusionsUpdate,
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
  rankParticipants,
  saveAutoState,
  scanReusableInitialRanking,
  type AutoSessionState,
  type RankedVariant,
} from "./auto/ranking.ts";
import { extractProdPromptSource } from "./auto/stageContract.ts";
import { collectKnownVariantHashes } from "./auto/validateVariant.ts";

export interface AutoLoopDeps {
  callOptimizer?: OptimizerLlmCaller;
  makeClients?: (cfg: AutoConfig) => EvalClients;
  resultsRoot?: string;
  silent?: boolean;
}

interface BatchRunOutput {
  ok: true;
  rootDir: string;
  cells: InputCell[];
  report: ComparisonReport;
  ranked: RankedVariant[];
  loadedVariants: Map<string, { variant: Variant; hash: string; filePath: string }>;
}

interface BatchRunFailed {
  ok: false;
  reason: string;
}

function makeRunTag(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${datePart}_${rand}`;
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function makeCaseLookup(datasets: Dataset[]): Map<string, Case> {
  const map = new Map<string, Case>();
  for (const ds of datasets) {
    for (const fc of ds.cases) {
      map.set(`${ds.name}\u0000${fc.id}`, fc);
    }
  }
  return map;
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

async function runComparativeBatch(opts: {
  cfg: AutoConfig;
  variantNames: string[];
  datasetPaths: string[];
  label: string;
  clients: EvalClients;
  resultsRoot?: string;
  silent?: boolean;
}): Promise<BatchRunOutput | BatchRunFailed> {
  const { cfg, variantNames, datasetPaths, label, clients, resultsRoot, silent } = opts;
  const participants = uniqueStrings(["prod", ...variantNames]);
  const evalCfg = toEvalConfig(cfg, {
    datasetSpecs: datasetPaths,
    variantSpecs: participants,
    baseline: "prod",
    label,
  });

  const batchVariants: BatchVariantInput[] = [];
  const loadedVariants = new Map<string, { variant: Variant; hash: string; filePath: string }>();
  const datasetsByVariant = new Map<string, Dataset[]>();

  for (const spec of participants) {
    const { variant, hash } = await loadVariantSpec(spec);
    const filePath = variantFilePath(spec);
    batchVariants.push({ spec, hash, variant });
    loadedVariants.set(spec, { variant, hash, filePath });
    datasetsByVariant.set(spec, loadDatasets(datasetPaths, { stages: [cfg.stage] }, variant));
  }

  const batch = await executeComparisonBatch({
    cfg: evalCfg,
    variants: batchVariants,
    datasetsByVariant,
    stageFilter: [cfg.stage],
    clients,
    resultsRoot,
    onRootReady: (rootDir) => {
      if (!silent) console.log(`${c.gray("Resultados en")} ${c.cyan(rootDir)}`);
    },
    onCellEnd: ({ variantSpec, dataset, passCount, runCount }) => {
      if (!silent) console.log(`  ${variantSpec.padEnd(28)} ${dataset.name.padEnd(24)} ${passCount}/${runCount}`);
    },
  });

  if (!batch.ok) {
    return { ok: false, reason: batch.reason };
  }

  return {
    ok: true,
    rootDir: batch.rootDir,
    cells: batch.cells,
    report: batch.report,
    ranked: rankParticipants(batch.report, cfg.metric, batch.cells),
    loadedVariants,
  };
}

function readVariantSourceForPrompt(name: string, stage: StageName): string {
  if (name === "prod") {
    return extractProdPromptSource(stage);
  }
  try {
    const filePath = variantFilePath(name);
    if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  } catch {
    // Fallback
  }
  return `// Código fuente de '${name}' no disponible.`;
}

function buildTop2Contexts(
  top2Names: string[],
  ranked: RankedVariant[],
  report: ComparisonReport | null,
  cells: InputCell[],
  stage: StageName,
): TopVariantContext[] {
  const stats = report ? extractVariantDatasetStats(report, cells) : [];
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
      code: readVariantSourceForPrompt(name, stage),
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

export async function runAutoLoop(cfg: AutoConfig, deps: AutoLoopDeps = {}): Promise<number> {
  const silent = deps.silent ?? false;
  const log = (...args: unknown[]) => {
    if (!silent) console.log(...args);
  };

  // 1. Descubrir datasets dev y holdout opcional
  let discovered;
  try {
    discovered = discoverStageDatasets(cfg.stage, cfg.datasetSpecs, cfg.holdoutSpecs);
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
  const caseLookup = makeCaseLookup(discovered.dev);

  // 2. Clientes del sistema evaluado (reutiliza fábrica compartida de eval/core/batch.ts)
  let clients: EvalClients;
  try {
    clients = (deps.makeClients ?? createEvalClients)(cfg);
  } catch (e) {
    fail(`Error de configuración de modelos evaluados: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  // 3. Descubrir variantes activas de la etapa y preparar inicialización Top-2
  const activeVariants = await discoverStageVariants(cfg.stage);
  const knownHashes = collectKnownVariantHashes(cfg.stage, activeVariants.map((v) => v.path));
  const fingerprint = buildFingerprint(cfg, discovered.devHashes, discovered.devCasesHashes);
  const priorState = loadAutoState(cfg.stage);
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
    log(`  Conclusiones: ${cfg.conclusionsPath}`);
    if (sameFingerprintState) {
      log(`  ${c.gray(`Sesión previa compatible detectada (${sameFingerprintState.completedRounds} vuelta(s), Top-2=${sameFingerprintState.top2.join(", ")}).`)}`);
    }
  }

  let currentTop2: string[] = [];
  let lastCells: InputCell[] = [];
  let lastReport: ComparisonReport | null = null;
  let lastRanked: RankedVariant[] = [];
  let bestNonProd: AutoSessionState["bestNonProd"] | undefined = sameFingerprintState?.bestNonProd;
  let completedRounds = sameFingerprintState?.completedRounds ?? 0;

  if (cfg.seedTop.length > 0) {
    // Validar existencia de --seed-top
    for (const s of cfg.seedTop) {
      try {
        await loadVariantSpec(s);
      } catch (e) {
        fail(`Error en --seed-top='${s}': ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }
    }
    currentTop2 = [...cfg.seedTop];

    const prodSpec = await loadVariantSpec("prod");
    const seedSpecs = await Promise.all(
      currentTop2.map(async (name) => ({ name, ...(await loadVariantSpec(name)) })),
    );
    const cacheCheck = scanReusableInitialRanking({
      cfg,
      variants: [{ name: "prod", hash: prodSpec.hash }, ...seedSpecs.filter((s) => s.name !== "prod").map((s) => ({ name: s.name, hash: s.hash }))],
      datasets: discovered.dev.map((d) => ({ name: d.name, hash: d.hash, casesHash: discovered.devCasesHashes[d.name] })),
      resultsRoot: deps.resultsRoot,
    });
    if (cacheCheck) {
      lastCells = cacheCheck.cells;
      lastReport = cacheCheck.report;
      lastRanked = cacheCheck.ranked;
      log(`\n${sym.ok} Top-2 fijado por --seed-top (${currentTop2.join(", ")}) con resultados cacheados reutilizados.`);
    } else {
      log(`\n${sym.bullet} Top-2 inicial fijado por --seed-top (${currentTop2.join(", ")}); Vuelta 0 omitida.`);
    }
  } else {
    // Intentar reutilizar resultados compatibles en eval/results/ para prod + variantes activas
    const prodSpec = await loadVariantSpec("prod");
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
      resultsRoot: deps.resultsRoot,
    });

    if (reused) {
      lastCells = reused.cells;
      lastReport = reused.report;
      lastRanked = reused.ranked;
      currentTop2 = reused.ranked.slice(0, 2).map((r) => r.variant);
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
        label: `auto_${cfg.stage}_r0`,
        clients,
        resultsRoot: deps.resultsRoot,
        silent,
      });
      if (!batch0.ok) {
        fail(batch0.reason);
        return 2;
      }
      lastCells = batch0.cells;
      lastReport = batch0.report;
      lastRanked = batch0.ranked;
      currentTop2 = batch0.ranked.slice(0, 2).map((r) => r.variant);
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
      updatedAt: new Date().toISOString(),
    });
  };

  const ensureConclusionsInitialized = (roundNote: string): void => {
    if (existsSync(resolve(cfg.conclusionsPath)) && readConclusionsBounded(cfg.conclusionsPath).content.trim()) {
      return;
    }
    writeConclusionsFile(
      cfg.conclusionsPath,
      buildBaselineConclusionsMarkdown({
        stage: cfg.stage,
        target: cfg.target,
        metric: cfg.metric,
        model: cfg.model,
        decisionModel: cfg.decisionModel,
        ranked: lastRanked,
        top2: currentTop2,
        roundNote,
      }),
    );
  };

  // 4. Bucle Vuelta 1 .. maxLoops
  for (let round = 1; round <= cfg.maxLoops; round++) {
    if (!silent) {
      section(`Vuelta ${round}/${cfg.maxLoops}`);
    }

    const conclusionsForPrompt = formatConclusionsForPrompt(cfg.conclusionsPath);
    const focusVariant = currentTop2[0] ?? "prod";
    const failureSamples: FailureSample[] = lastCells.length > 0
      ? extractFailureSamples({
          focusVariant,
          cells: lastCells,
          devDatasetNames,
          caseLookup,
        })
      : [];
    const top2Contexts = buildTop2Contexts(currentTop2, lastRanked, lastReport, lastCells, cfg.stage);

    // 4.1 & 4.2 Generar + validar hasta 2 variantes nuevas
    let generation;
    try {
      generation = await generateVariantsForRound({
        cfg,
        round,
        runTag,
        conclusionsText: conclusionsForPrompt,
        top2Contexts,
        allRanked: lastRanked,
        failureSamples,
        devDatasetPaths: devPaths,
        knownHashes,
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
      log(`  ${sym.warn} ${c.yellow("Ninguna variante pasó validación en esta vuelta; continuando a la siguiente.")}`);
      continue;
    }

    // 4.3 Corrida comparativa unificada `[prod, ...currentTop2, ...nuevas]`
    const newNames = generation.validVariants.map((v) => v.name);
    const batch = await runComparativeBatch({
      cfg,
      variantNames: [...currentTop2, ...newNames],
      datasetPaths: devPaths,
      label: `auto_${cfg.stage}_r${round}`,
      clients,
      resultsRoot: deps.resultsRoot,
      silent,
    });

    if (!batch.ok) {
      fail(batch.reason);
      return 2;
    }

    const previousTop2 = [...currentTop2];
    const nextTop2 = batch.ranked.slice(0, 2).map((r) => r.variant);
    printRankedTable(batch.ranked, nextTop2, cfg, silent);

    // 4.4 Archivar variantes generadas perdedoras en `_auto/<stage>/descartadas/`
    const autoCandidatesInBatch: Array<{ name: string; filePath: string }> = [];
    for (const [name, info] of batch.loadedVariants.entries()) {
      if (isAutoVariantPathForStage(info.filePath, cfg.stage)) {
        autoCandidatesInBatch.push({ name, filePath: info.filePath });
      }
    }
    const archived = archiveLosingAutoVariants({
      stage: cfg.stage,
      candidateFiles: autoCandidatesInBatch,
      top2: nextTop2,
      ranked: batch.ranked,
      archiveLosers: cfg.archiveLosers,
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
    let holdoutFailedScore: number | undefined;

    if (roundBestNonProd && roundBestNonProd.score >= cfg.target) {
      if (holdoutPaths.length > 0) {
        if (!silent) {
          log(`\n  ${sym.bullet} '${roundBestNonProd.variant}' alcanzó ${fmtPct(roundBestNonProd.score)} en dev; validando contra --holdout...`);
        }
        const holdoutBatch = await runComparativeBatch({
          cfg,
          variantNames: [roundBestNonProd.variant],
          datasetPaths: holdoutPaths,
          label: `auto_${cfg.stage}_r${round}_holdout`,
          clients,
          resultsRoot: deps.resultsRoot,
          silent,
        });
        if (!holdoutBatch.ok) {
          fail(holdoutBatch.reason);
          return 2;
        }
        const holdoutRow = holdoutBatch.ranked.find((r) => r.variant === roundBestNonProd.variant);
        const holdoutScore = holdoutRow?.score ?? 0;
        if (holdoutScore >= cfg.target) {
          holdoutConfirmed = true;
          if (bestNonProd) bestNonProd.confirmedHoldout = true;
          log(`  ${sym.ok} ${c.green(`Holdout confirmado: ${fmtPct(holdoutScore)} >= ${fmtPct(cfg.target)}`)}`);
        } else {
          holdoutFailedScore = holdoutScore;
          holdoutOverfitNote = `'${roundBestNonProd.variant}' obtuvo ${fmtPct(roundBestNonProd.score)} en dev pero cayó a ${fmtPct(holdoutScore)} en holdout (< ${fmtPct(cfg.target)}) — posible sobreajuste.`;
          log(`  ${sym.warn} ${c.yellow(holdoutOverfitNote)}`);
        }
      } else {
        holdoutConfirmed = true;
      }
    }

    // 4.6 Actualizar `conclusiones.md` de forma condicional y guardar `auto_state.json`
    const archivedSet = new Set(archived);
    const roundFacts = formatObjectiveRoundFacts({
      stage: cfg.stage,
      round,
      target: cfg.target,
      metric: cfg.metric,
      model: cfg.model,
      decisionModel: cfg.decisionModel,
      ranked: batch.ranked,
      top2: nextTop2,
      previousTop2,
      generatedHypotheses: generation.validVariants.map((v) => ({
        name: v.name,
        hypothesis: v.hypothesis,
        archived: archivedSet.has(v.name),
      })),
      holdoutOverfitNote,
    });

    const currentConclusions = readConclusionsBounded(cfg.conclusionsPath).content;
    let decision;
    try {
      decision = await decideConclusionsUpdate({
        cfg,
        currentConclusions,
        roundFacts,
        callLlm: deps.callOptimizer,
      });
    } catch (e) {
      if (e instanceof OptimizerTransportError) {
        fail(`Error de transporte del optimizador al evaluar conclusiones en Vuelta ${round}: ${e.message}`);
        return 2;
      }
      throw e;
    }

    if (decision.update && decision.markdown) {
      writeConclusionsFile(cfg.conclusionsPath, decision.markdown);
      log(`  ${sym.ok} conclusiones.md actualizado (${decision.reason || "cambios relevantes"}).`);
    } else {
      log(`  ${c.gray(`conclusiones.md sin cambios (${decision.reason || "sin novedad relevante"}).`)}`);
    }

    if (holdoutOverfitNote && holdoutFailedScore !== undefined && roundBestNonProd) {
      recordHoldoutOverfitAlert({
        filePath: cfg.conclusionsPath,
        stage: cfg.stage,
        candidate: roundBestNonProd.variant,
        devScore: roundBestNonProd.score,
        holdoutScore: holdoutFailedScore,
        target: cfg.target,
        metric: cfg.metric,
        model: cfg.model,
        decisionModel: cfg.decisionModel,
        ranked: batch.ranked,
        top2: nextTop2,
        round,
      });
    }

    completedRounds += 1;
    currentTop2 = nextTop2;
    lastCells = batch.cells;
    lastReport = batch.report;
    lastRanked = batch.ranked;

    persistSessionState();

    if (holdoutConfirmed && roundBestNonProd) {
      ensureConclusionsInitialized(`R${round}: '${roundBestNonProd.variant}' alcanzó objetivo ${fmtPct(roundBestNonProd.score)}.`);
      log(`\n${sym.ok} ${c.green(`Objetivo cumplido en Vuelta ${round}: '${roundBestNonProd.variant}' (${fmtPct(roundBestNonProd.score)} >= ${fmtPct(cfg.target)})`)}`);
      return 0;
    }
  }

  // Se alcanzó maxLoops sin cumplir --target: asegurar persistencia de conclusiones y estado y salir con 1.
  ensureConclusionsInitialized(`Alcanzado maxLoops=${cfg.maxLoops} sin superar target ${fmtPct(cfg.target)}.`);
  persistSessionState();

  log(
    `\n${sym.warn} ${c.yellow(`Se alcanzó --max-loops=${cfg.maxLoops} sin alcanzar ${fmtPct(cfg.target)}.`)} Mejor variante != prod: ${bestNonProd ? `${bestNonProd.variant} (${fmtPct(bestNonProd.score)})` : "ninguna"}`,
  );
  return 1;
}

/** Punto de entrada programático compartido por `eval/cli.ts --auto` y `eval/auto.ts`. */
export async function runAutoCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printAutoHelp();
    return 0;
  }

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
