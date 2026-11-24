/**
 * eval/auto/promptContext.ts
 *
 * Lo que se le muestra al optimizador en cada vuelta: el Top-2 con su resumen por dataset y los textos vigentes de cada variante.
 * Las etapas de decisión editan textos por pregunta y opción (la forma sale de los casos); las generativas editan el `SYSTEM` completo.
 */

import { fmtPct } from "../core/report-format.ts";
import { isDecisionStage } from "../core/stages/index.ts";
import { loadVariantSpecEphemeral } from "./ephemeralVariant.ts";
import { formatConfusions, formatFailureKinds, type VariantDatasetStat } from "./feedback.ts";
import type { TopVariantContext } from "./optimizer.ts";
import {
  collectDecisionRequests,
  currentSystemText,
  deriveStateNote,
  formatCurrentTexts,
  patchFromRequests,
  shapeFromRequests,
} from "./patchVariant.ts";
import type { RankedVariant } from "./ranking.ts";
import type { AutoRun, LoopMemory } from "./runContext.ts";
import { getStageContract } from "./stageContract.ts";

/** Resumen de cada variante del Top-2 (o ceros si todavía no se midió) con sus resultados por dataset. */
export function buildTop2Contexts(top2Names: string[], ranked: RankedVariant[], stats: VariantDatasetStat[]): TopVariantContext[] {
  return top2Names.map((name) => ({
    name,
    summary: ranked.find((r) => r.variant === name) ?? {
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
    },
    perDataset: stats.filter((s) => s.variant === name),
  }));
}

/**
 * Arma el contexto de prompts de la corrida. La forma de las preguntas (decisión) y los pedidos de producción se calculan una vez; los textos de
 * cada variante, en cada vuelta, porque el Top-2 cambia.
 */
export function createPromptContext(run: AutoRun, mem: LoopMemory) {
  const { cfg, devPaths, holdoutPaths, rawCache, variantsRoot } = run;
  const metricText = (name: string, contexts: TopVariantContext[]): string => {
    const score = contexts.find((c) => c.name === name)?.summary.score;
    return score !== undefined ? ` (${cfg.metric}=${fmtPct(score)})` : "";
  };
  const variantOf = (name: string) => (name === "prod" ? undefined : loadVariantSpecEphemeral(name, undefined, variantsRoot).variant);

  // Etapas de decisión: el optimizador escribe solo textos. Las preguntas válidas salen de los casos y los textos vigentes de cada Top-2.
  const prodRequests = isDecisionStage(cfg.stage) ? collectDecisionRequests(cfg.stage, devPaths, undefined, rawCache) : [];
  const shape = isDecisionStage(cfg.stage) ? shapeFromRequests(prodRequests) : undefined;
  // Textos de producción de TODAS las opciones que aparecen en dev y holdout: con ellos se completa toda variante generada, así que el archivo
  // siempre escribe cada opción (lo que el optimizador no cambia queda con el texto de `prod`, explícito en el archivo).
  const prodTexts = isDecisionStage(cfg.stage) ? patchFromRequests(collectDecisionRequests(cfg.stage, [...devPaths, ...holdoutPaths], undefined, rawCache)) : undefined;
  const requestsOf = (name: string) => collectDecisionRequests(cfg.stage, devPaths, variantOf(name), rawCache);

  // Etapas generativas: el optimizador escribe el texto SYSTEM completo.
  const generativeKey = isDecisionStage(cfg.stage) ? undefined : getStageContract(cfg.stage).promptKey;
  const systemOf = (name: string): string => currentSystemText(generativeKey as string, variantOf(name));

  return {
    /** Forma de las preguntas de la etapa de decisión; `undefined` en las generativas. */
    shape,
    /** rewrite: Top-1 y Top-2 como referencia. improve: solo el prompt base (el Top-1 vigente), con sus textos completos para aplicar los cambios encima. */
    decision(names: string[], contexts: TopVariantContext[]) {
      if (!shape) throw new Error("decision() solo existe en las etapas de decisión.");
      const confusions = formatConfusions(mem.confusions);
      if (cfg.mode === "improve") {
        const baseName = names[0] ?? "prod";
        const reqs = requestsOf(baseName);
        const stateNote = baseName === "prod" ? undefined : deriveStateNote(reqs, prodRequests);
        const base = { ...patchFromRequests(reqs), ...(stateNote !== undefined ? { stateNote } : {}) };
        return { shape, mode: cfg.mode, base, prodTexts, confusions, topTexts: `### Base: \`${baseName}\`${metricText(baseName, contexts)}\n${formatCurrentTexts(reqs, stateNote)}` };
      }
      const topTexts = names
        .map((name, i) => `### Top-${i + 1}: \`${name}\`${metricText(name, contexts)}\n${formatCurrentTexts(requestsOf(name))}`)
        .join("\n\n");
      return { shape, mode: cfg.mode, prodTexts, confusions, topTexts };
    },
    /** improve: solo el texto del Top-1, que es el base. */
    generative(names: string[], contexts: TopVariantContext[]) {
      const block = (name: string, label: string): string => `### ${label}: \`${name}\`${metricText(name, contexts)}\n${JSON.stringify(systemOf(name))}`;
      const baseName = names[0] ?? "prod";
      const topTexts = cfg.mode === "improve" ? block(baseName, "Base") : names.map((name, i) => block(name, `Top-${i + 1}`)).join("\n\n");
      return { topTexts, current: systemOf(baseName), mode: cfg.mode, failures: formatFailureKinds(mem.failureKinds) };
    },
  };
}
