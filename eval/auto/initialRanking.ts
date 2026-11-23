/**
 * eval/auto/initialRanking.ts
 *
 * Vuelta 0: de dónde sale el Top-2 con que arranca el bucle. Con `--seed-top`, las variantes indicadas; sin él, las dos mejores de entre `prod` y las
 * variantes activas de la etapa. En los dos casos se reutilizan resultados guardados si son 100 % compatibles; si no, se mide de verdad.
 */

import { fail, section, sym } from "../ui/style.ts";
import { runComparativeBatch } from "./batchExecution.ts";
import { printRankedTable } from "./display.ts";
import type { DiscoveredVariant } from "./discover.ts";
import { loadVariantSpecEphemeral } from "./ephemeralVariant.ts";
import { scanReusableInitialRanking } from "./ranking.ts";
import type { AutoRun, LoopMemory } from "./runContext.ts";

interface HashedVariant {
  name: string;
  hash: string;
}

/** Resultados reutilizables de una corrida previa para estas variantes y datasets de desarrollo. */
function reusable(run: AutoRun, variants: HashedVariant[]) {
  const { discovered } = run;
  return scanReusableInitialRanking({
    cfg: run.cfg,
    variants,
    datasets: discovered.dev.map((d) => ({ name: d.name, hash: d.hash, casesHash: discovered.devCasesHashes[d.name] })),
    resultsRoot: run.reuseFrom,
  });
}

/** Mide `variantNames` sobre los datasets de desarrollo como ronda `r0`. `undefined` si el lote falló (el motivo ya se informó). */
async function measureRoundZero(run: AutoRun, variantNames: string[]) {
  const batch = await runComparativeBatch(run, { variantNames, datasetPaths: run.devPaths, label: "r0" });
  if (!batch.ok) {
    fail(batch.reason);
    return undefined;
  }
  return batch;
}

/** `--seed-top`: el Top-2 queda fijado por el usuario; las semillas deben existir y ser `mode: "prompt"`. */
async function seedFromTop(run: AutoRun, mem: LoopMemory): Promise<number | undefined> {
  const { cfg, variantsRoot, log, silent } = run;
  const seeds: HashedVariant[] = [];
  for (const name of cfg.seedTop) {
    try {
      const loaded = loadVariantSpecEphemeral(name, undefined, variantsRoot);
      if (loaded.variant.mode === "structure") {
        throw new Error('es mode "structure": no es comparable contra prod y --auto solo optimiza variantes mode "prompt".');
      }
      seeds.push({ name, hash: loaded.hash });
    } catch (e) {
      fail(`Error en --seed-top='${name}': ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }
  mem.top2 = [...cfg.seedTop];
  const prod: HashedVariant = { name: "prod", hash: loadVariantSpecEphemeral("prod", undefined, variantsRoot).hash };
  const extra = seeds.filter((s) => s.name !== "prod");

  const cached = reusable(run, [prod, ...extra]);
  if (cached) {
    mem.remember(run, mem.top2, cached.ranked, cached.report, cached.cells);
    log(`\n${sym.ok} Top-2 fijado por --seed-top (${mem.top2.join(", ")}) con resultados cacheados reutilizados.`);
    return undefined;
  }
  // Sin caché compatible no se inventan métricas: se evalúa de verdad prod + las variantes semilla para que el optimizador vea resultados reales.
  log(`\n${sym.bullet} Top-2 inicial fijado por --seed-top (${mem.top2.join(", ")}); sin caché compatible: Vuelta 0 real sobre prod + semillas.`);
  if (!silent) section(`Vuelta 0 — Baseline + ${extra.length} variante(s) semilla`);
  const batch = await measureRoundZero(run, ["prod", ...extra.map((s) => s.name)]);
  if (!batch) return 2;
  mem.remember(run, mem.top2, batch.ranked, batch.report, batch.cells);
  printRankedTable(run, batch.ranked, mem.top2);
  return undefined;
}

/** Sin `--seed-top`: el Top-2 son las dos mejores de entre `prod` y las variantes activas de la etapa. */
async function rankActiveVariants(run: AutoRun, mem: LoopMemory, active: DiscoveredVariant[]): Promise<number | undefined> {
  const { variantsRoot, silent } = run;
  const prod: HashedVariant = { name: "prod", hash: loadVariantSpecEphemeral("prod", undefined, variantsRoot).hash };
  const variants = [prod, ...active.map((v) => ({ name: v.name, hash: v.hash }))];

  const cached = reusable(run, variants);
  if (cached) {
    mem.top2 = cached.ranked.slice(0, 2).map((r) => r.variant);
    mem.remember(run, mem.top2, cached.ranked, cached.report, cached.cells);
    if (!silent) {
      section("Inicialización Top-2 (resultados cacheados reutilizados)");
      printRankedTable(run, cached.ranked, mem.top2);
    }
  } else {
    if (!silent) section(`Vuelta 0 — Baseline + ${active.length} variante(s) activa(s)`);
    const batch = await measureRoundZero(run, variants.map((v) => v.name));
    if (!batch) return 2;
    mem.top2 = batch.ranked.slice(0, 2).map((r) => r.variant);
    mem.remember(run, mem.top2, batch.ranked, batch.report, batch.cells);
    printRankedTable(run, batch.ranked, mem.top2);
  }
  mem.considerBest(mem.ranked, 0);
  return undefined;
}

/** Deja el Top-2 y el ranking iniciales en `mem`. Devuelve un código de salida solo si hay que abortar. */
export function initializeTop2(run: AutoRun, mem: LoopMemory, active: DiscoveredVariant[]): Promise<number | undefined> {
  return run.cfg.seedTop.length > 0 ? seedFromTop(run, mem) : rankActiveVariants(run, mem, active);
}
