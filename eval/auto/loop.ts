/**
 * eval/auto/loop.ts
 *
 * El bucle de `--auto` para una etapa: prepara la corrida (datasets, clientes, variantes activas), fija el Top-2 inicial, mide el holdout de `prod` si
 * lo hay y repite vueltas hasta cumplir `--target` o agotar `--max-loops`. Cada paso vive en su módulo (`initialRanking`, `holdout`, `round`).
 *
 * Códigos de salida: 0 objetivo cumplido, 1 se agotaron las vueltas sin cumplirlo, 2 error de configuración, de transporte o de medición.
 */

import { randomUUID } from "node:crypto";
import { PROD_SHORTCUT_TAG } from "../core/case.ts";
import { createEvalClients, type EvalClients } from "../core/batch.ts";
import { createRawDatasetCache, type Dataset } from "../core/datasets.ts";
import { fmtPct } from "../core/report-format.ts";
import { VARIANTS_DIR } from "../core/variants/load.ts";
import { c, fail, sym } from "../ui/style.ts";
import type { AutoConfig } from "./config.ts";
import { printRunBanner } from "./display.ts";
import { discoverStageDatasets, discoverStageVariants } from "./discover.ts";
import { measureProdHoldout } from "./holdout.ts";
import { initializeTop2 } from "./initialRanking.ts";
import { createPromptContext } from "./promptContext.ts";
import { buildFingerprint, fingerprintsEqual, loadAutoState } from "./ranking.ts";
import { runRound } from "./round.ts";
import { holdoutFilesOf } from "./stages.ts";
import { LoopMemory, type AutoLoopDeps, type AutoRun } from "./runContext.ts";
import { openAutoSession } from "./session.ts";
import { collectKnownVariantHashes } from "./validateVariant.ts";

export type { AutoLoopDeps } from "./runContext.ts";

/** Identificador de esta corrida en los nombres de las variantes generadas: fecha y hora más 4 caracteres al azar. */
function makeRunTag(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${datePart}_${randomUUID().replace(/-/g, "").slice(0, 4)}`;
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

/** Arma el contexto de la corrida. Devuelve `undefined` si algo de la configuración no sirve (ya informado). */
function prepareRun(cfg: AutoConfig, deps: AutoLoopDeps): AutoRun | undefined {
  const silent = deps.silent ?? false;
  const rawCache = createRawDatasetCache();

  // Sin `--dataset` ni `--holdout`: desarrollo = los datasets de la etapa y holdout = sus `*_holdout*.jsonl` (los casos fáciles, que sirven para
  // comprobar que una variante no empeora lo que ya andaba).
  if (cfg.datasetSpecs.length === 0 && cfg.holdoutSpecs.length === 0) cfg.holdoutSpecs = holdoutFilesOf(cfg.stage);
  let discovered: AutoRun["discovered"];
  try {
    discovered = discoverStageDatasets(cfg.stage, cfg.datasetSpecs, cfg.holdoutSpecs, rawCache);
  } catch (e) {
    fail(`Error de dataset: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
  if (countCanonicalCases(discovered.dev, cfg.includeShortcut) === 0) {
    fail(`Los datasets de '${cfg.stage}' no tienen ningún caso canónico para evaluar.`);
    return undefined;
  }

  // Valida los modelos evaluados; solo se retienen los clientes si los inyecta `deps.makeClients` (si no, cada lote los crea en su worker).
  let customClients: EvalClients | undefined;
  try {
    if (deps.makeClients) customClients = deps.makeClients(cfg);
    else createEvalClients(cfg);
  } catch (e) {
    fail(`Error de configuración de modelos evaluados: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }

  return {
    cfg,
    resultsRoot: deps.resultsRoot,
    reuseFrom: deps.reuseFrom,
    variantsRoot: deps.variantsRoot ?? VARIANTS_DIR,
    rawCache,
    customClients,
    discovered,
    devPaths: discovered.dev.map((d) => d.path),
    holdoutPaths: discovered.holdout.map((d) => d.path),
    devDatasetNames: new Set(discovered.dev.map((d) => d.name)),
    silent,
    log: (...args: unknown[]) => {
      if (!silent) console.log(...args);
    },
  };
}

async function runAutoLoopInSession(cfg: AutoConfig, deps: AutoLoopDeps): Promise<number> {
  const run = prepareRun(cfg, deps);
  if (!run) return 2;

  // Variantes activas de la etapa, y retomar una sesión previa solo si es 100 % compatible (mismos datasets, casos y configuración).
  const active = await discoverStageVariants(cfg.stage, run.variantsRoot);
  const knownHashes = collectKnownVariantHashes(cfg.stage, active.map((v) => v.path), run.variantsRoot);
  const fingerprint = buildFingerprint(cfg, run.discovered.devHashes, run.discovered.devCasesHashes);
  const prior = loadAutoState(cfg.stage, run.variantsRoot);
  const resumed = prior && fingerprintsEqual(prior.fingerprint, fingerprint) ? prior : null;
  printRunBanner(run, resumed);

  const mem = new LoopMemory(resumed);
  const aborted = await initializeTop2(run, mem, active);
  if (aborted !== undefined) return aborted;

  // Holdout: se mide `prod` una vez como referencia del umbral para confirmar.
  let holdoutThreshold = cfg.target;
  if (run.holdoutPaths.length > 0) {
    const baseline = await measureProdHoldout(run);
    if (!baseline) return 2;
    holdoutThreshold = baseline.threshold;
  }

  const env = {
    runTag: makeRunTag(),
    knownHashes,
    holdoutThreshold,
    fingerprint,
    prompts: createPromptContext(run, mem),
    callOptimizer: deps.callOptimizer,
  };
  for (let round = 1; round <= cfg.maxLoops; round++) {
    const exit = await runRound(run, mem, env, round);
    if (exit !== undefined) return exit;
  }

  // Se alcanzó maxLoops sin cumplir --target: el estado y el historial ya quedaron guardados en cada vuelta; sale con 1.
  mem.persist(run, fingerprint);
  run.log(
    `\n${sym.warn} ${c.yellow(`Se alcanzó --max-loops=${cfg.maxLoops} sin alcanzar ${fmtPct(cfg.target)}.`)} Mejor variante != prod: ${mem.bestNonProd ? `${mem.bestNonProd.variant} (${fmtPct(mem.bestNonProd.score)})` : "ninguna"}`,
  );
  return 1;
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
