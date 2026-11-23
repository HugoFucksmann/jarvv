/**
 * eval/auto/round.ts
 *
 * Una vuelta del bucle: el optimizador propone variantes, el código las valida, se miden contra `prod` y el Top-2, las ganadoras se promueven y las
 * perdedoras se archivan, se comprueba el objetivo (con holdout si hay) y se anota la vuelta en el historial.
 */

import { fmtPct } from "../core/report-format.ts";
import { c, fail, section, sym } from "../ui/style.ts";
import { runComparativeBatch } from "./batchExecution.ts";
import { printRankedTable } from "./display.ts";
import { isAutoVariantPathForStage } from "./discover.ts";
import { checkTarget, type TargetVerdict } from "./holdout.ts";
import { appendLedger, formatLedgerForPrompt, type LedgerEntry } from "./ledger.ts";
import { generateVariantsForRound, OptimizerTransportError, type OptimizerLlmCaller, type RoundGenerationOutput } from "./optimizer.ts";
import { buildTop2Contexts, type createPromptContext } from "./promptContext.ts";
import {
  archiveLosingAutoVariants,
  promoteWinningAutoVariants,
  type AutoSessionState,
  type RankedVariant,
} from "./ranking.ts";
import type { AutoRun, LoopMemory } from "./runContext.ts";

/** Lo que cada vuelta necesita además del contexto y la memoria. */
export interface RoundEnv {
  runTag: string;
  knownHashes: Set<string>;
  holdoutThreshold: number;
  fingerprint: AutoSessionState["fingerprint"];
  prompts: ReturnType<typeof createPromptContext>;
  callOptimizer?: OptimizerLlmCaller;
}

/** Pide variantes al optimizador y las valida. `undefined` si el transporte o el optimizador fallaron (ya informado). */
async function generate(run: AutoRun, mem: LoopMemory, env: RoundEnv, round: number): Promise<RoundGenerationOutput | undefined> {
  const { cfg, log, silent } = run;
  const top2Contexts = buildTop2Contexts(mem.top2, mem.ranked, mem.stats);
  let generation: RoundGenerationOutput;
  try {
    generation = await generateVariantsForRound({
      cfg,
      round,
      runTag: env.runTag,
      ledgerText: formatLedgerForPrompt(cfg.ledgerPath),
      top2Contexts,
      allRanked: mem.ranked,
      ...(env.prompts.shape
        ? { decision: env.prompts.decision(mem.top2, top2Contexts) }
        : { generative: env.prompts.generative(mem.top2, top2Contexts) }),
      devDatasetPaths: run.devPaths,
      knownHashes: env.knownHashes,
      variantsRoot: run.variantsRoot,
      rawCache: run.rawCache,
      callLlm: env.callOptimizer,
    });
  } catch (e) {
    if (e instanceof OptimizerTransportError) fail(`Error de transporte del optimizador en Vuelta ${round}: ${e.message}`);
    else fail(`Error inesperado en optimizador: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }

  if (generation.analysis && !silent) log(`  ${c.gray("Diagnóstico:")} ${generation.analysis}`);
  for (const note of generation.rejectedNotes) log(`  ${sym.warn} ${c.yellow(`Variante rechazada tras reintentos: ${note}`)}`);
  for (const v of generation.validVariants) log(`  ${sym.ok} Generada ${c.cyan(v.name)}: ${v.hypothesis}`);
  return generation;
}

/** Mueve las ganadoras a `_ganadoras/<etapa>/` y archiva las perdedoras en `descartadas/`. */
function promoteAndArchive(run: AutoRun, batch: { ranked: RankedVariant[]; loadedFiles: Array<{ name: string; filePath: string }> }, nextTop2: string[]): void {
  const { cfg, log, variantsRoot } = run;
  const candidates = batch.loadedFiles
    .filter((info) => isAutoVariantPathForStage(info.filePath, cfg.stage, variantsRoot))
    .map((info) => ({ name: info.name, filePath: info.filePath }));
  // Las que superan a prod salen de _auto/ hacia _ganadoras/<etapa>/ antes de archivar, así el archivo de perdedoras no las toca.
  const promoted = promoteWinningAutoVariants({ stage: cfg.stage, candidateFiles: candidates, ranked: batch.ranked, variantsRoot });
  if (promoted.length > 0) log(`  ${c.green(`Ganadoras (superan a prod) movidas a _ganadoras/${cfg.stage}/:`)} ${promoted.join(", ")}`);
  const archived = archiveLosingAutoVariants({
    stage: cfg.stage,
    candidateFiles: candidates.filter((cand) => !promoted.includes(cand.name)),
    top2: nextTop2,
    ranked: batch.ranked,
    archiveLosers: cfg.archiveLosers,
    variantsRoot,
  });
  if (archived.length > 0) log(`  ${c.gray("Archivadas en descartadas/:")} ${archived.join(", ")}`);
}

/**
 * Anota la vuelta en el historial: lo medido lo escribe el código y del modelo solo viene el resumen de cada variante.
 * El holdout se anota sin cifras: el optimizador no debe enterarse de los resultados del dataset oculto.
 */
function recordRound(
  run: AutoRun,
  generation: RoundGenerationOutput,
  ranked: RankedVariant[],
  nextTop2: string[],
  verdict: TargetVerdict,
  round: number,
): void {
  const { cfg } = run;
  appendLedger(
    cfg.ledgerPath,
    generation.validVariants.map((v): LedgerEntry => {
      const row = ranked.find((r) => r.variant === v.name);
      if (!row) return { round, variant: v.name, summary: v.hypothesis, status: "no_evaluada" };
      const delta = cfg.metric === "macroPassRate" ? (row.deltaMacroPassRate ?? row.deltaPassRate) : row.deltaPassRate;
      const failedHoldout = verdict.overfitNote !== undefined && verdict.evaluated?.variant === v.name;
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
}

/**
 * Corre la vuelta `round`. Devuelve un código de salida si el bucle debe terminar (0: objetivo cumplido; 2: error) y `undefined` para seguir con la
 * siguiente. El estado queda persistido al cerrar cada vuelta.
 */
export async function runRound(run: AutoRun, mem: LoopMemory, env: RoundEnv, round: number): Promise<number | undefined> {
  const { cfg, log, silent } = run;
  if (!silent) section(`Vuelta ${round}/${cfg.maxLoops}`);

  const generation = await generate(run, mem, env, round);
  if (!generation) return 2;

  if (generation.validVariants.length === 0) {
    log(`  ${sym.warn} ${c.yellow("Ninguna variante pasó validación en esta vuelta; registrando fallo y continuando.")}`);
    mem.completedRounds += 1;
    appendLedger(cfg.ledgerPath, [
      { round, variant: "(ninguna válida)", summary: generation.rejectedNotes[0] ?? "todas las propuestas fallaron la validación", status: "invalida" },
    ]);
    mem.persist(run, env.fingerprint);
    return undefined;
  }

  // Corrida comparativa unificada: el Top-2 vigente y las variantes nuevas (el lote agrega `prod` si falta).
  const batch = await runComparativeBatch(run, {
    variantNames: [...mem.top2, ...generation.validVariants.map((v) => v.name)],
    datasetPaths: run.devPaths,
    label: `r${round}`,
  });
  if (!batch.ok) {
    fail(batch.reason);
    return 2;
  }

  const nextTop2 = batch.ranked.slice(0, 2).map((r) => r.variant);
  printRankedTable(run, batch.ranked, nextTop2);
  promoteAndArchive(run, batch, nextTop2);

  // Condición de corte `--target`: solo cuentan las variantes distintas de prod.
  const best = mem.considerBest(batch.ranked, round);
  const verdict = await checkTarget(run, mem, batch.ranked, best, round, env.holdoutThreshold);
  if (!verdict) return 2;

  recordRound(run, generation, batch.ranked, nextTop2, verdict, round);
  mem.completedRounds += 1;
  mem.top2 = nextTop2;
  mem.remember(run, nextTop2, batch.ranked, batch.report, batch.cells);
  mem.persist(run, env.fingerprint);

  const winner = verdict.evaluated ?? best;
  if (verdict.confirmed && winner) {
    log(`\n${sym.ok} ${c.green(`Objetivo cumplido en Vuelta ${round}: '${winner.variant}' (${fmtPct(winner.score)} >= ${fmtPct(cfg.target)})`)}`);
    return 0;
  }
  return undefined;
}
