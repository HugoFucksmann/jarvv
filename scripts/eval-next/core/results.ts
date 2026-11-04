/**
 * scripts/eval-next/core/results.ts
 *
 * Gestión de resultados: escritura incremental de runs.jsonl, cálculo de scores.json
 * y guardado de metadatos en meta.json.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { PROMPTS, DECISION_PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type {
  CaseScoreSummary,
  GlobalScoreSummary,
  RunMeta,
  RunRecord,
  StageName,
  StageScoreSummary,
} from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type { RunnerConfig } from "./config.ts";

function getLocalTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}

function getGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function getGitDirty(): boolean {
  try {
    const status = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function hashString(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function computePromptHashes(): Record<string, string> {
  return {
    plan_view: hashString(PROMPTS.PLAN_VIEW.SYSTEM),
    args_view: hashString(PROMPTS.ARGUMENTS_VIEW.SYSTEM),
    final_view: hashString(PROMPTS.FINAL_VIEW.SYSTEM),
    question: hashString(PROMPTS.QUESTION.SYSTEM),
    decision_prompts: hashString(JSON.stringify(DECISION_PROMPTS)),
  };
}

function computeSourceHashes(): Record<string, string> {
  const srcFiles = [
    "src/core/reasoner/prompts.ts",
    "src/core/reasoner/qwen.ts",
    "src/core/render/plan.ts",
    "src/core/render/args.ts",
    "src/core/render/final.ts",
    "src/core/render/ask.ts",
    "src/core/engine/adapters.ts",
    "src/core/engine/deps.ts",
  ];
  const result: Record<string, string> = {};
  for (const f of srcFiles) {
    try {
      const content = fs.readFileSync(path.resolve(process.cwd(), f), "utf-8");
      result[f] = hashString(content);
    } catch {
      result[f] = "unreadable";
    }
  }
  return result;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export class ResultsWriter {
  readonly outputDir: string;
  readonly runsFile: string;
  readonly scoresFile: string;
  readonly metaFile: string;
  private readonly records: RunRecord[] = [];
  /** Cola de escritura serializada: garantiza orden sin interleaving bajo concurrencia > 1. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(cfg: RunnerConfig) {
    const timestampStr = getLocalTimestamp();
    const datasetBase = path.basename(cfg.dataset, path.extname(cfg.dataset));
    const labelSuffix = cfg.label ? `_${cfg.label}` : cfg.tag ? `_${cfg.tag}` : "";
    const sanitizedModel = cfg.model.replace(/[:/]/g, "_");

    const folderName = `${timestampStr}_${datasetBase}_${cfg.variant}${labelSuffix}`;
    this.outputDir = path.resolve(
      process.cwd(),
      `scripts/eval-next/results/${sanitizedModel}/${folderName}`
    );

    fs.mkdirSync(this.outputDir, { recursive: true });

    this.runsFile = path.join(this.outputDir, "runs.jsonl");
    this.scoresFile = path.join(this.outputDir, "scores.json");
    this.metaFile = path.join(this.outputDir, "meta.json");

    // Asegurar que runs.jsonl empieza limpio para una nueva corrida
    fs.writeFileSync(this.runsFile, "", "utf-8");

    // Guardar meta.json inicial
    const meta: RunMeta = {
      schemaVersion: SCHEMA_VERSION,
      runId: folderName,
      timestamp: new Date().toISOString(),
      model: cfg.model,
      url: cfg.url || "default",
      variant: cfg.variant,
      stages: cfg.stages,
      datasetPath: cfg.dataset,
      repeat: cfg.repeat,
      gitCommit: getGitCommit(),
      gitDirty: getGitDirty(),
      promptHashes: computePromptHashes(),
      sourceHashes: computeSourceHashes(),
      params: {
        device: cfg.device,
        timeoutMs: cfg.timeoutMs,
        concurrency: cfg.concurrency,
        thinking: cfg.thinking,
        temperature: cfg.temperature,
        seed: cfg.seed,
        numCtx: cfg.numCtx,
        filter: cfg.filter,
        label: cfg.label,
        isMock: cfg.isMock,
      },
    };
    fs.writeFileSync(this.metaFile, JSON.stringify(meta, null, 2), "utf-8");
  }

  append(record: RunRecord): void {
    this.records.push(record);
    // Serializar escrituras para evitar interleaving bajo concurrencia > 1
    this.writeQueue = this.writeQueue.then(() => {
      fs.appendFileSync(this.runsFile, JSON.stringify(record) + "\n", "utf-8");
    });
  }

  finish(): GlobalScoreSummary {
    const summary = computeScoreSummary(this.records);
    fs.writeFileSync(this.scoresFile, JSON.stringify(summary, null, 2), "utf-8");
    return summary;
  }
}

export function computeScoreSummary(records: RunRecord[]): GlobalScoreSummary {
  // Separar casos canónicos (no-raw) de casos raw
  const canonicalRecords = records.filter((r) => !r.isRaw);
  const rawRecords = records.filter((r) => r.isRaw);

  // ── Canonical by stage ──
  const byStage = new Map<StageName, RunRecord[]>();
  for (const r of canonicalRecords) {
    const list = byStage.get(r.stage) || [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  // ── Raw by stage ──
  const byStageRaw = new Map<StageName, RunRecord[]>();
  for (const r of rawRecords) {
    const list = byStageRaw.get(r.stage) || [];
    list.push(r);
    byStageRaw.set(r.stage, list);
  }

  const stagesSummary: Record<string, StageScoreSummary> = {};

  let globalTotal = 0;
  let globalPassed = 0;
  let globalPassAllCases = 0;
  let globalTotalCases = 0;
  const globalDurations: number[] = [];
  let globalRawTotal = 0;
  let globalRawPassed = 0;

  // Collect all stages that appear in canonical OR raw records
  const allStages = new Set<StageName>([...byStage.keys(), ...byStageRaw.keys()]);

  for (const st of allStages) {
    const stageRecords = byStage.get(st) || [];
    const stageRawRecords = byStageRaw.get(st) || [];

    const byCase = new Map<string, RunRecord[]>();
    for (const r of stageRecords) {
      const list = byCase.get(r.caseId) || [];
      list.push(r);
      byCase.set(r.caseId, list);
    }

    const casesSummary: CaseScoreSummary[] = [];
    let stPassed = 0;
    let stPassAllCases = 0;
    const stDurations: number[] = [];

    // Confusion matrix for decision stages
    const confusionMatrix: Record<string, Record<string, number>> = {};
    let correctDecisions = 0;
    let totalDecisions = 0;

    for (const [caseId, caseRecords] of byCase.entries()) {
      const n = caseRecords.length;
      const cPassed = caseRecords.filter((r) => r.passed).length;
      const cDuration = caseRecords.reduce((acc, r) => acc + r.durationMs, 0);

      stPassed += cPassed;
      for (const r of caseRecords) {
        stDurations.push(r.durationMs);
        globalDurations.push(r.durationMs);

        if (r.expectedLabel && r.predictedLabel) {
          totalDecisions++;
          if (r.expectedLabel === r.predictedLabel) correctDecisions++;
          confusionMatrix[r.expectedLabel] = confusionMatrix[r.expectedLabel] || {};
          confusionMatrix[r.expectedLabel][r.predictedLabel] =
            (confusionMatrix[r.expectedLabel][r.predictedLabel] || 0) + 1;
        }
      }

      const passRate = n > 0 ? cPassed / n : 0;

      // Varianza muestral: null cuando n=1 (una sola repetición → no hay varianza estimable)
      const variance: number | null =
        n > 1
          ? Math.round(
              ((cPassed * Math.pow(1 - passRate, 2) + (n - cPassed) * Math.pow(passRate, 2)) /
                (n - 1)) *
                1000
            ) / 1000
          : null;

      const passAll = cPassed === n;
      if (passAll) stPassAllCases++;

      casesSummary.push({
        caseId,
        stage: st,
        runsCount: n,
        passCount: cPassed,
        passRate,
        variance,
        passAll,
        avgDurationMs: n > 0 ? Math.round(cDuration / n) : 0,
      });
    }

    const totalStRuns = stageRecords.length;
    const totalStCases = casesSummary.length;
    globalTotal += totalStRuns;
    globalPassed += stPassed;
    globalPassAllCases += stPassAllCases;
    globalTotalCases += totalStCases;

    // Raw stats for this stage
    const stRawTotal = stageRawRecords.length;
    const stRawPassed = stageRawRecords.filter((r) => r.passed).length;
    globalRawTotal += stRawTotal;
    globalRawPassed += stRawPassed;

    stDurations.sort((a, b) => a - b);
    const avgDurationMs = totalStRuns > 0 ? Math.round(stDurations.reduce((a, b) => a + b, 0) / totalStRuns) : 0;

    stagesSummary[st] = {
      stage: st,
      totalRuns: totalStRuns,
      passedRuns: stPassed,
      passRate: totalStRuns > 0 ? stPassed / totalStRuns : 0,
      passAllRate: totalStCases > 0 ? stPassAllCases / totalStCases : 0,
      avgDurationMs,
      p50DurationMs: percentile(stDurations, 50),
      p95DurationMs: percentile(stDurations, 95),
      accuracy: totalDecisions > 0 ? Math.round((correctDecisions / totalDecisions) * 1000) / 1000 : undefined,
      confusionMatrix: totalDecisions > 0 ? confusionMatrix : undefined,
      rawTotalRuns: stRawTotal,
      rawPassedRuns: stRawPassed,
      rawPassRate: stRawTotal > 0 ? stRawPassed / stRawTotal : 0,
      cases: casesSummary,
    };
  }

  globalDurations.sort((a, b) => a - b);
  const avgGlobalDurationMs =
    globalTotal > 0 ? Math.round(globalDurations.reduce((a, b) => a + b, 0) / globalTotal) : 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    totalRuns: globalTotal,
    passedRuns: globalPassed,
    passRate: globalTotal > 0 ? globalPassed / globalTotal : 0,
    passAllRate: globalTotalCases > 0 ? globalPassAllCases / globalTotalCases : 0,
    avgDurationMs: avgGlobalDurationMs,
    p50DurationMs: percentile(globalDurations, 50),
    p95DurationMs: percentile(globalDurations, 95),
    rawTotalRuns: globalRawTotal,
    rawPassedRuns: globalRawPassed,
    rawPassRate: globalRawTotal > 0 ? globalRawPassed / globalRawTotal : 0,
    stages: stagesSummary,
  };
}
