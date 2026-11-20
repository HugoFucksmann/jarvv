/**
 * eval/auto/batchRunner.ts
 *
 * Ejecutor de un lote comparativo `(variante × dataset)` para `eval --auto`.
 * Carga todas las variantes de forma efímera (`loadVariantSpecEphemeral`) y devuelve
 * únicamente metadatos planos + celdas slimmed + reporte + ranking, apto tanto para correr
 * dentro de un `Worker` efímero como en memoria cuando los tests inyectan `makeClients`.
 */

import { createEvalClients, executeComparisonBatch, type BatchVariantInput, type EvalClients } from "../core/batch.ts";
import { loadDatasets, type Dataset, type RawDatasetCache } from "../core/datasets.ts";
import type { ComparisonReport, InputCell } from "../core/report.ts";
import type { Variant } from "../core/variants/types.ts";
import { toEvalConfig, type AutoConfig } from "./config.ts";
import { loadVariantSpecEphemeral } from "./ephemeralVariant.ts";
import { rankParticipants, type RankedVariant } from "./ranking.ts";

export interface RunAutoBatchPayload {
  cfg: AutoConfig;
  variantNames: string[];
  datasetPaths: string[];
  label: string;
  resultsRoot?: string;
  variantsRoot?: string;
}

export interface BatchLoadedFileMeta {
  name: string;
  hash: string;
  filePath: string;
}

export type AutoBatchOutcome =
  | {
      ok: true;
      rootDir: string;
      cells: InputCell[];
      report: ComparisonReport;
      ranked: RankedVariant[];
      loadedFiles: BatchLoadedFileMeta[];
    }
  | {
      ok: false;
      reason: string;
    };

export interface ExecuteAutoBatchHooks {
  clients?: EvalClients;
  rawCache?: RawDatasetCache;
  onRootReady?: (rootDir: string) => void;
  onCellEnd?: (info: { variantSpec: string; datasetName: string; passCount: number; runCount: number }) => void;
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export async function executeAutoBatchInProcess(
  payload: RunAutoBatchPayload,
  hooks: ExecuteAutoBatchHooks = {},
): Promise<AutoBatchOutcome> {
  const { cfg, variantNames, datasetPaths, label, resultsRoot, variantsRoot } = payload;
  const participants = uniqueStrings(["prod", ...variantNames]);
  const evalCfg = toEvalConfig(cfg, {
    datasetSpecs: datasetPaths,
    variantSpecs: participants,
    baseline: "prod",
    label,
  });

  const batchVariants: BatchVariantInput[] = [];
  const loadedFiles: BatchLoadedFileMeta[] = [];
  const datasetsByVariant = new Map<string, Dataset[]>();

  for (const spec of participants) {
    const { variant, hash, filePath } = loadVariantSpecEphemeral(spec, undefined, variantsRoot);
    batchVariants.push({ spec, hash, variant });
    loadedFiles.push({ name: spec, hash, filePath });
    datasetsByVariant.set(spec, loadDatasets(datasetPaths, { stages: [cfg.stage] }, variant, hooks.rawCache));
  }

  const clients = hooks.clients ?? createEvalClients(cfg);
  const batch = await executeComparisonBatch({
    cfg: evalCfg,
    variants: batchVariants,
    datasetsByVariant,
    stageFilter: [cfg.stage],
    clients,
    resultsRoot,
    onRootReady: hooks.onRootReady,
    onCellEnd: ({ variantSpec, dataset, passCount, runCount }) => {
      hooks.onCellEnd?.({ variantSpec, datasetName: dataset.name, passCount, runCount });
    },
  });

  // Soltar explícitamente las referencias a objetos Variant y Datasets materializados del lote
  batchVariants.length = 0;
  datasetsByVariant.clear();

  if (!batch.ok) {
    return { ok: false, reason: batch.reason };
  }

  return {
    ok: true,
    rootDir: batch.rootDir,
    cells: batch.cells,
    report: batch.report,
    ranked: rankParticipants(batch.report, cfg.metric, batch.cells),
    loadedFiles,
  };
}

export type { Variant };
