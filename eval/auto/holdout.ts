/**
 * eval/auto/holdout.ts
 *
 * Confirmación contra el holdout: el dev set solo propone, el holdout confirma. Se mide `prod` una vez como referencia y cada candidato que llega
 * al objetivo en desarrollo se valida una sola vez (sin cifras para el optimizador, que no debe enterarse de los resultados del dataset oculto).
 */

import { fmtPct } from "../core/report-format.ts";
import { c, fail, sym } from "../ui/style.ts";
import { runComparativeBatch } from "./batchExecution.ts";
import type { RankedVariant } from "./ranking.ts";
import type { AutoRun, LoopMemory } from "./runContext.ts";

/**
 * Mide `prod` sobre el holdout. El umbral para confirmar es el puntaje de `prod` más `--holdout-margin` (por defecto 0: no empeorar a `prod`;
 * un margen negativo tolera una caída pequeña). `undefined` si el lote falló.
 */
export async function measureProdHoldout(run: AutoRun): Promise<{ threshold: number } | undefined> {
  const { cfg, log } = run;
  const batch = await runComparativeBatch(run, { variantNames: ["prod"], datasetPaths: run.holdoutPaths, label: "holdout-prod", silent: true });
  if (!batch.ok) {
    fail(batch.reason);
    return undefined;
  }
  const row = batch.ranked.find((r) => r.variant === "prod");
  const prodScore = row?.score ?? 0;
  const threshold = prodScore + (cfg.holdoutMargin ?? 0);
  log(
    `\n  ${sym.bullet} Holdout: prod obtiene ${fmtPct(prodScore)} (${row?.passedRuns ?? 0}/${row?.totalRuns ?? 0}). Umbral para confirmar: ${fmtPct(Math.min(threshold, 1))}${
      cfg.holdoutMargin !== undefined && cfg.holdoutMargin !== 0 ? ` (prod ${cfg.holdoutMargin > 0 ? "+" : "−"} ${fmtPct(Math.abs(cfg.holdoutMargin))})` : " (igual a prod)"
    }.`,
  );
  if (threshold > 1) {
    log(`  ${sym.warn} ${c.yellow(`El umbral (${fmtPct(threshold)}) supera el 100 %: ninguna variante podrá confirmarse. Bajá --holdout-margin.`)}`);
  }
  return { threshold };
}

/** Qué pasó al comprobar el objetivo de una vuelta. */
export interface TargetVerdict {
  /** El objetivo se cumplió y, si hay holdout, se confirmó en él: el bucle termina. */
  confirmed: boolean;
  /** Variante que se validó contra el holdout (o la mejor de la vuelta si no hay holdout). */
  evaluated?: RankedVariant;
  /** Texto de sobreajuste si el candidato cayó en el holdout. */
  overfitNote?: string;
}

/**
 * Comprueba `--target` con la mejor variante de la vuelta. Sin holdout alcanza el objetivo en desarrollo; con holdout, el candidato se valida una
 * vez y queda anotado en `mem.testedHoldout`. `undefined` si el lote del holdout falló.
 */
export async function checkTarget(
  run: AutoRun,
  mem: LoopMemory,
  ranked: RankedVariant[],
  best: RankedVariant | undefined,
  round: number,
  holdoutThreshold: number,
): Promise<TargetVerdict | undefined> {
  const { cfg, log, silent } = run;
  // El objetivo es absoluto y además la variante tiene que superar a `prod` en desarrollo: llegar al umbral con un resultado peor que el de prod no cuenta.
  const prodScore = ranked.find((r) => r.variant === "prod")?.score ?? 0;
  const beatsProd = (r: RankedVariant): boolean => r.variant !== "prod" && r.score >= cfg.target && r.score > prodScore;
  if (!best || !beatsProd(best)) return { confirmed: false };
  if (run.holdoutPaths.length === 0) return { confirmed: true, evaluated: best };

  const candidate = ranked.find((r) => beatsProd(r) && !mem.testedHoldout.has(r.variant));
  if (!candidate) {
    const prev = mem.testedHoldout.get(best.variant);
    log(`\n  ${sym.warn} '${best.variant}' alcanzó ${fmtPct(best.score)} en dev pero ya falló --holdout en R${prev?.round ?? "?"} (${fmtPct(prev?.score ?? 0)}); se omite re-evaluación.`);
    return { confirmed: false };
  }

  if (!silent) log(`\n  ${sym.bullet} '${candidate.variant}' alcanzó ${fmtPct(candidate.score)} en dev; validando contra --holdout...`);
  const batch = await runComparativeBatch(run, { variantNames: [candidate.variant], datasetPaths: run.holdoutPaths, label: `r${round}-holdout` });
  if (!batch.ok) {
    fail(batch.reason);
    return undefined;
  }
  const score = batch.ranked.find((r) => r.variant === candidate.variant)?.score ?? 0;
  const passed = score >= holdoutThreshold;
  mem.testedHoldout.set(candidate.variant, { score, confirmed: passed, round });
  if (passed) {
    mem.bestNonProd = { variant: candidate.variant, score: candidate.score, round, confirmedHoldout: true };
    log(`  ${sym.ok} ${c.green(`Holdout confirmado: ${fmtPct(score)} >= ${fmtPct(holdoutThreshold)}`)}`);
    return { confirmed: true, evaluated: candidate };
  }
  const overfitNote = `'${candidate.variant}' obtuvo ${fmtPct(candidate.score)} en dev pero cayó a ${fmtPct(score)} en holdout (< ${fmtPct(holdoutThreshold)}) — posible sobreajuste.`;
  log(`  ${sym.warn} ${c.yellow(overfitNote)}`);
  return { confirmed: false, evaluated: candidate, overfitNote };
}
