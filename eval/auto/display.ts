/**
 * eval/auto/display.ts
 *
 * Salida por consola de `--auto`: encabezado de la corrida y tabla del ranking de cada vuelta.
 */

import { fmtDeltaPct, fmtMs, fmtPct } from "../core/report-format.ts";
import { isDecisionStage } from "../core/stages/index.ts";
import { c, section } from "../ui/style.ts";
import type { AutoConfig } from "./config.ts";
import type { AutoRun } from "./runContext.ts";
import type { RankedVariant, AutoSessionState } from "./ranking.ts";

/** Encabezado: objetivo, modelos, datasets y, si hay, la sesión previa compatible que se retoma. */
export function printRunBanner(run: AutoRun, resumed: AutoSessionState | null): void {
  if (run.silent) return;
  const { cfg, discovered, log } = run;
  section(`eval --auto — etapa '${cfg.stage}'`);
  log(`  Objetivo: ${cfg.metric} >= ${fmtPct(cfg.target)} | Máx. vueltas: ${cfg.maxLoops}`);
  if (isDecisionStage(cfg.stage)) {
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
  if (resumed) {
    log(`  ${c.gray(`Sesión previa compatible detectada (${resumed.completedRounds} vuelta(s), Top-2=${resumed.top2.join(", ")}).`)}`);
  }
}

/** Tabla del ranking de un lote, con el Top-2 marcado y el Δ contra `prod`. */
export function printRankedTable(run: AutoRun, ranked: RankedVariant[], top2: string[]): void {
  if (run.silent) return;
  const metric: AutoConfig["metric"] = run.cfg.metric;
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const tag = top2.includes(r.variant) ? c.green(`[TOP-${top2.indexOf(r.variant) + 1}]`) : c.gray("       ");
    const delta =
      r.variant === "prod"
        ? c.gray("baseline")
        : r.deltaPassRate !== undefined
          ? fmtDeltaPct(metric === "macroPassRate" ? (r.deltaMacroPassRate ?? r.deltaPassRate) : r.deltaPassRate)
          : "—";
    console.log(
      `  ${i + 1}. ${tag} ${r.variant.padEnd(32)} ${fmtPct(r.score).padStart(6)} (${r.passedRuns}/${r.totalRuns})  Δ=${delta.padEnd(7)}  p50=${fmtMs(r.p50DurationMs)}`,
    );
  }
}
