#!/usr/bin/env node
/**
 * eval/auto.ts
 *
 * Punto de entrada del bucle autónomo de optimización de prompts (`--auto`): interpreta los argumentos, corre una etapa (`runAutoLoop`) o varias en
 * serie (`runAutoStages`). El bucle en sí vive en `eval/auto/` (`loop.ts` y los módulos de cada paso) y reutiliza `eval/core/batch.ts` para ejecutar
 * cada vuelta con el mismo runner, graders y reportes que `eval/cli.ts`.
 *
 * Uso recomendado:
 *   npm run eval -- --auto --stage=args_review --max-loops=8 --target=0.80 --optimizer-model=qwen3:32b [flags]
 *   npx tsx eval/auto.ts --stage=args_review --max-loops=8 --target=0.80 --optimizer-model=qwen3:32b [flags]
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, section, sym } from "./ui/style.ts";
import { defaultLedgerPath, parseAutoConfig, printAutoHelp, type AutoConfig } from "./auto/config.ts";
import { discoverStageDatasets } from "./auto/discover.ts";
import { runAutoLoop, type AutoLoopDeps } from "./auto/loop.ts";
import { loadAutoState } from "./auto/ranking.ts";
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

export { runAutoLoop, type AutoLoopDeps };

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
