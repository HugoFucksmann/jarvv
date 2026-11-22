/**
 * eval/core/batch.ts
 *
 * Primitivos compartidos para construir clientes e ejecutar un lote completo
 * `(variante × dataset)` con escritura de celdas y generación de `comparison.json/.md`.
 * Reutilizado por `eval/cli.ts` y `eval/auto.ts` para evitar duplicación.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDecisionClient, type DecisionClient } from "./client/decision.ts";
import { createGenerativeClient, type GenerativeClient } from "./client/generative.ts";
import { createMockDecisionClient, createMockGenerativeClient } from "./client/mock.ts";
import { oracleDecisionResponder, oracleGenerativeResponder } from "./client/oracle.ts";
import type { EvalConfig } from "./config.ts";
import type { Dataset } from "./datasets.ts";
import { generateComparisonReport, writeComparison, type ComparisonReport, type InputCell } from "./report.ts";
import { atomicWriteFileSync } from "./io.ts";
import { buildRunMeta, createCellWriter, gitInfo, newRunId, runRootDir, safeName, timestampDir, uniqueDir } from "./results.ts";
import { runDataset } from "./runner.ts";
import type { RunRecord, StageName } from "./types.ts";
import type { Variant } from "./variants/types.ts";

export interface EvalClients {
  genClient: GenerativeClient;
  decClient: DecisionClient;
}

/** Construye los clientes generativo y de decisión según `--client` (`real` | `mock` | `oracle`). */
export function createEvalClients(cfg: Pick<EvalConfig, "client" | "url" | "model" | "decisionUrl" | "decisionModel">): EvalClients {
  if (cfg.client === "mock" || cfg.client === "oracle") {
    const oracle = cfg.client === "oracle";
    return {
      genClient: createMockGenerativeClient(
        { url: cfg.url, model: cfg.model },
        oracle ? oracleGenerativeResponder : undefined,
      ),
      decClient: createMockDecisionClient(
        { url: cfg.decisionUrl, model: cfg.decisionModel },
        oracle ? oracleDecisionResponder : undefined,
      ),
    };
  }
  return {
    genClient: createGenerativeClient({ url: cfg.url, model: cfg.model }),
    decClient: createDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }),
  };
}

export interface BatchVariantInput {
  spec: string;
  hash: string;
  variant: Variant;
}

export interface ExecuteBatchOptions {
  cfg: EvalConfig;
  variants: BatchVariantInput[];
  datasetsByVariant: Map<string, Dataset[]>;
  stageFilter: StageName[];
  clients: EvalClients;
  resultsRoot?: string;
  onRootReady?: (rootDir: string) => void;
  onCellStart?: (info: { variantSpec: string; dataset: Dataset }) => void;
  onRecord?: (record: RunRecord) => void;
  onCellEnd?: (info: {
    variantSpec: string;
    dataset: Dataset;
    passCount: number;
    runCount: number;
    failedCalls: number;
  }) => void;
}

export type ExecuteBatchResult =
  | {
      ok: true;
      rootDir: string;
      cells: InputCell[];
      report: ComparisonReport;
    }
  | {
      ok: false;
      kind: "network" | "empty";
      reason: string;
      rootDir: string;
    };

/**
 * Con `resultsRoot` explícito (una sesión de `--auto` o un test) la corrida va en `<resultsRoot>/<label>` (sin fecha: la sesión ya la lleva);
 * sin `label`, en `<resultsRoot>/<fecha_hora>`.
 */
function resolveBatchRootDir(cfg: EvalConfig, ts: string, resultsRoot?: string): string {
  if (!resultsRoot) return runRootDir(cfg, ts);
  return resolve(uniqueDir(resolve(resultsRoot, cfg.label ? safeName(cfg.label) : ts)));
}

type RunStatus = "ok" | "network_failure" | "empty";

/** `run.json`: qué se corrió, con qué modelos y cómo salió, sin abrir las celdas. */
function writeRunManifest(
  rootDir: string,
  info: {
    cfg: EvalConfig;
    runId: string;
    startedAt: string;
    status: RunStatus;
    variants: BatchVariantInput[];
    datasetsByVariant: Map<string, Dataset[]>;
    stages: StageName[];
    cells: InputCell[];
  },
): void {
  const { cfg } = info;
  const git = gitInfo();
  const datasets = new Map<string, { name: string; path: string; hash: string; cases: number }>();
  for (const list of info.datasetsByVariant.values()) {
    for (const ds of list) datasets.set(ds.name, { name: ds.name, path: ds.path, hash: ds.hash, cases: ds.cases.length });
  }
  const manifest = {
    schemaVersion: 1,
    runId: info.runId,
    startedAt: info.startedAt,
    endedAt: new Date().toISOString(),
    status: info.status,
    ...(cfg.label ? { label: cfg.label } : {}),
    client: cfg.client,
    stages: info.stages,
    models: { generative: cfg.model, decision: cfg.decisionModel },
    urls: { generative: cfg.url, decision: cfg.decisionUrl },
    baseline: cfg.baseline,
    repeat: cfg.repeat,
    thinking: cfg.thinking,
    variants: info.variants.map((v) => ({ name: v.spec, hash: v.hash })),
    datasets: [...datasets.values()],
    ...(git.gitCommit ? { gitCommit: git.gitCommit } : {}),
    ...(git.gitDirty !== undefined ? { gitDirty: git.gitDirty } : {}),
    cells: info.cells.map((c) => ({
      dir: c.cellDir === undefined ? `${safeName(c.variantSpec)}__${safeName(c.datasetName)}` : c.cellDir.split(/[\\/]/).pop(),
      variant: c.variantSpec,
      dataset: c.datasetName,
      passRate: c.scores.passRate,
      passedRuns: c.scores.passedRuns,
      totalRuns: c.scores.totalRuns,
    })),
  };
  atomicWriteFileSync(join(resolve(rootDir), "run.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Ejecuta todas las celdas `(variante × dataset)` para un `EvalConfig`, escribe
 * `runs.jsonl`, `scores.json`, `meta.json` y `comparison.{md,json}` y devuelve el reporte.
 */
export async function executeComparisonBatch(opts: ExecuteBatchOptions): Promise<ExecuteBatchResult> {
  const { cfg, variants, datasetsByVariant, stageFilter, clients } = opts;

  const ts = timestampDir();
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const rootDir = resolveBatchRootDir(cfg, ts, opts.resultsRoot);
  mkdirSync(resolve(rootDir), { recursive: true });
  opts.onRootReady?.(rootDir);

  const comparisonCells: InputCell[] = [];
  let anyNetworkFailed = false;
  let allNetworkFailed = true;

  for (const vr of variants) {
    for (const ds of datasetsByVariant.get(vr.spec) ?? []) {
      const cases = ds.cases;
      opts.onCellStart?.({ variantSpec: vr.spec, dataset: ds });

      const writer = createCellWriter(rootDir, vr.spec, ds.name);
      let runCount = 0;
      let passCount = 0;
      let failedCalls = 0;

      const meta = buildRunMeta({
        cfg,
        variantHash: vr.hash,
        datasetPath: ds.path,
        datasetHash: ds.hash,
        stages: stageFilter,
        timestamp: startedAt,
        runId,
        caseIds: cases.filter((k) => stageFilter.includes(k.stage as StageName)).map((k) => k.id),
      });

      let result;
      let scores;
      try {
        result = await runDataset({
          cases,
          datasetName: ds.name,
          variant: vr.variant,
          variantSpec: vr.spec,
          cfg,
          genClient: clients.genClient,
          decClient: clients.decClient,
          stageFilter,
          collectRecords: false,
          onRecord: (record: RunRecord) => {
            writer.writeRun(record);
            if (record.bucket === "canonical") {
              runCount++;
              if (record.passed) passCount++;
              if (record.metrics.client_call_ok === false) failedCalls++;
            }
            opts.onRecord?.(record);
          },
        });
      } finally {
        scores = writer.close(meta);
      }

      if (result.allNetworkFailed) {
        anyNetworkFailed = true;
      } else {
        allNetworkFailed = false;
      }

      opts.onCellEnd?.({ variantSpec: vr.spec, dataset: ds, passCount, runCount, failedCalls });

      comparisonCells.push({
        variantSpec: vr.spec,
        datasetName: ds.name,
        scores,
        records: writer.records,
        cellDir: writer.cellDir,
      });
    }
  }

  const manifestBase = { cfg, runId, startedAt, variants, datasetsByVariant, stages: stageFilter, cells: comparisonCells };

  if (anyNetworkFailed && allNetworkFailed) {
    writeRunManifest(rootDir, { ...manifestBase, status: "network_failure" });
    return {
      ok: false,
      kind: "network",
      rootDir,
      reason: "Error de infraestructura: todas las llamadas fallaron por el cliente (red, timeout o HTTP).",
    };
  }

  if (comparisonCells.every((cell) => cell.scores.totalRuns === 0)) {
    writeRunManifest(rootDir, { ...manifestBase, status: "empty" });
    return {
      ok: false,
      kind: "empty",
      rootDir,
      reason: "No hubo ninguna corrida canónica (todos los casos son raw o se filtraron). Nada que evaluar.",
    };
  }

  const report = generateComparisonReport({
    baseline: cfg.baseline,
    cells: comparisonCells,
    concurrency: cfg.concurrency,
  });
  writeComparison(rootDir, report);
  writeRunManifest(rootDir, { ...manifestBase, status: "ok" });

  return {
    ok: true,
    rootDir,
    cells: comparisonCells,
    report,
  };
}
