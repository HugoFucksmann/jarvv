/**
 * eval/core/results.ts
 *
 * Escritura de runs.jsonl, scores.json y meta.json por celda (variante × dataset).
 */

import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalConfig } from "./config.ts";
import { atomicWriteFileSync } from "./io.ts";
import { promptEnvironment } from "./scenario.ts";
import { computeScoreSummary } from "./scoring.ts";
import { isDecisionStage } from "./stages/index.ts";
import type { GlobalScoreSummary, RunMeta, RunRecord, StageName } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

// ───────────────────────── Helpers ─────────────────────────

/** sha256 (16 hex) del `JSON.stringify` de un valor. Depende del orden de las claves: el mismo objeto con otro orden da otro hash. */
export function objectHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

/**
 * Sustituye por `_` los caracteres inválidos en nombres de carpeta de Windows
 * (`< > : " / \ | ? *` y control) y recorta puntos/espacios finales.
 * Para nombres ya válidos (p. ej. `qwen3.5:4b` → `qwen3.5_4b`) el resultado no cambia.
 */
export function safeName(name: string): string {
  const out = name.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return out || "_";
}

/** `YYYY-MM-DD_HHmmss` en hora local. */
export function timestampDir(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Nombre de carpeta de celda: `<variante>__<dataset>`. */
export function cellDirName(variantSpec: string, datasetName: string): string {
  return `${safeName(variantSpec)}__${safeName(datasetName)}`;
}

/** Nombre de carpeta del modelo evaluado real: `decisionModel` si todas las etapas son de decisión; si no, `model`. */
export function evaluatedModelDirName(cfg: Pick<EvalConfig, "stages" | "model" | "decisionModel">): string {
  const onlyDecision = cfg.stages.length > 0 && cfg.stages.every((s) => isDecisionStage(s));
  return safeName(onlyDecision ? cfg.decisionModel : cfg.model);
}

/**
 * Directorio raíz de resultados para una corrida. El timestamp tiene resolución de segundo: si la
 * carpeta ya existe (dos corridas en el mismo segundo) se agrega `-2`, `-3`… para no mezclar `runs.jsonl`.
 */
export function runRootDir(cfg: EvalConfig, ts: string): string {
  const label = cfg.label ? `_${safeName(cfg.label)}` : "";
  // Las corridas de `oracle` y `mock` no miden ningún modelo: van aparte (`eval/results/_oracle/…`) para que no se mezclen
  // con las reales al comparar ni al limpiar.
  if (cfg.client !== "real") {
    const base = `eval/results/_${cfg.client}/${ts}${label}`;
    let dir = base;
    for (let n = 2; existsSync(resolve(dir)); n++) dir = `${base}-${n}`;
    return dir;
  }
  const modelDir = evaluatedModelDirName(cfg);
  const base = `eval/results/${modelDir}/${ts}${label}`;
  let dir = base;
  for (let n = 2; existsSync(resolve(dir)); n++) dir = `${base}-${n}`;
  return dir;
}

// ───────────────────────── Git info ─────────────────────────

/** Se excluye `eval/results/`: si no está en .gitignore, el propio eval dejaba el árbol "sucio" siempre. */
const GIT_STATUS_CMD = 'git status --porcelain -- . ":(exclude)eval/results"';

function tryGit(cmd: string): string | undefined {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

let gitCache: { gitCommit?: string; gitDirty?: boolean } | undefined;

/** Commit y estado del árbol. Se consulta una sola vez por proceso: todas las celdas de una corrida llevan el mismo valor. */
export function gitInfo(): { gitCommit?: string; gitDirty?: boolean } {
  if (gitCache) return gitCache;
  const commit = tryGit("git rev-parse --short HEAD");
  const status = tryGit(GIT_STATUS_CMD);
  gitCache = {
    gitCommit: commit || undefined,
    gitDirty: status !== undefined ? status.length > 0 : undefined,
  };
  return gitCache;
}

// ───────────────────────── Writer por celda ─────────────────────────

export interface CellWriter {
  /** Escribe una línea en runs.jsonl y acumula el record para scoring. */
  writeRun(record: RunRecord): void;
  /** Cierra la celda: escribe scores.json y meta.json y devuelve el resumen calculado. */
  close(meta: RunMeta): GlobalScoreSummary;
  /** Records acumulados (alimentan el reporte de comparación). */
  readonly records: RunRecord[];
  readonly cellDir: string;
}

export function createCellWriter(rootDir: string, variantSpec: string, datasetName: string): CellWriter {
  const cellDir = resolve(`${rootDir}/${cellDirName(variantSpec, datasetName)}`);
  mkdirSync(cellDir, { recursive: true });

  const records: RunRecord[] = [];
  // Descriptor único para toda la celda: evita abrir/cerrar el archivo en cada RunRecord.
  let fd: number | null = openSync(`${cellDir}/runs.jsonl`, "w");

  return {
    cellDir,
    get records() { return records; },
    writeRun(record: RunRecord) {
      if (fd === null) throw new Error("CellWriter ya cerrado.");
      writeSync(fd, JSON.stringify(record) + "\n", null, "utf8");
      // En RAM retenemos solo lo necesario para scoring/report; el detalle completo queda en runs.jsonl.
      records.push({
        ...record,
        errors: [],
        warnings: [],
        rawInput: undefined,
        rawOutput: "",
        parsedOutput: undefined,
        probabilities: undefined,
        rawScore: undefined,
      });
    },
    close(meta: RunMeta): GlobalScoreSummary {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
      const scores: GlobalScoreSummary = computeScoreSummary(records);
      // Después de scoreQuestions, `report.ts` solo consume `scores.stages[k].questions`.
      for (const r of records) {
        if (r.questions !== undefined) r.questions = undefined;
      }
      atomicWriteFileSync(`${cellDir}/scores.json`, JSON.stringify(scores, null, 2));
      atomicWriteFileSync(`${cellDir}/meta.json`, JSON.stringify(meta, null, 2));
      return scores;
    },
  };
}

// ───────────────────────── runId / timestamp ─────────────────────────

export function newRunId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// ───────────────────────── Construcción de RunMeta ─────────────────────────

export function buildRunMeta(opts: {
  cfg: EvalConfig;
  variantHash: string;
  datasetPath: string;
  datasetHash: string;
  stages: StageName[];
  /** ISO 8601 del inicio de la corrida (igual que `RunRecord.timestamp`). */
  timestamp: string;
  /** Un solo id por invocación: pasar el mismo a todas las celdas. Si falta, se genera uno. */
  runId?: string;
  /** Ids de los casos que corre la celda (ya filtrados). */
  caseIds: string[];
}): RunMeta {
  const { cfg, variantHash, datasetPath, datasetHash, stages, timestamp, caseIds } = opts;
  const git = gitInfo();

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: opts.runId ?? newRunId(),
    timestamp,
    model: cfg.model,
    decisionModel: cfg.decisionModel,
    url: cfg.url,
    decisionUrl: cfg.decisionUrl,
    variantHash,
    datasetPath,
    datasetHash,
    stages,
    filters: { tags: cfg.tags, ids: cfg.ids, limit: cfg.limit ?? null },
    cases: { count: caseIds.length, hash: objectHash([...caseIds].sort()) },
    promptEnv: promptEnvironment(),
    repeat: cfg.repeat,
    ...(git.gitCommit ? { gitCommit: git.gitCommit } : {}),
    ...(git.gitDirty !== undefined ? { gitDirty: git.gitDirty } : {}),
    params: {
      ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
      concurrency: cfg.concurrency,
      thinking: cfg.thinking,
      client: cfg.client,
      includeShortcut: cfg.includeShortcut,
      ...(cfg.label ? { label: cfg.label } : {}),
    },
  };
}