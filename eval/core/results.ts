/**
 * eval/core/results.ts
 *
 * Escritura de runs.jsonl, scores.json y meta.json por celda (variante × dataset).
 * Estructura de carpetas: sección 5.4.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalConfig } from "./config.ts";
import { computeScoreSummary } from "./scoring.ts";
import type { GlobalScoreSummary, RunMeta, RunRecord, StageName } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

// ───────────────────────── Helpers ─────────────────────────

/** sha256 (16 hex) de un objeto cualquiera (canonicalizado con JSON.stringify). */
export function objectHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

/**
 * Sustituye por `_` los caracteres inválidos en nombres de carpeta de Windows
 * (`< > : " / \ | ? *` y control) y recorta puntos/espacios finales.
 * Para nombres ya válidos (p. ej. `qwen3.5:4b` → `qwen3.5_4b`) el resultado no cambia.
 */
function safeName(name: string): string {
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

/** Nombre de carpeta de celda: `<variante>__<dataset>`, más `__<target>` cuando la corrida compara modelos. */
export function cellDirName(variantSpec: string, datasetName: string, targetId?: string): string {
  const base = `${safeName(variantSpec)}__${safeName(datasetName)}`;
  return targetId ? `${base}__${safeName(targetId)}` : base;
}

/**
 * Directorio raíz de resultados para una corrida. El timestamp tiene resolución de segundo: si la
 * carpeta ya existe (dos corridas en el mismo segundo) se agrega `-2`, `-3`… para no mezclar `runs.jsonl`.
 */
export function runRootDir(cfg: EvalConfig, ts: string): string {
  const label = cfg.label ? `_${safeName(cfg.label)}` : "";
  // La carpeta nombra lo que corre. Una configuración (o un solo flag): el modelo generativo, o el de decisión con
  // `--d-model`. Varias: todos los nombres unidos (`a+b`); en modo "all", cada configuración como `gen~decisión`.
  const names = (list: string[]) => list.map(safeName).join("+");
  const modelDir =
    cfg.modelScope === "decision"
      ? names(cfg.decisionModels)
      : cfg.modelScope === "generative" || cfg.pairs.length <= 1
        ? names(cfg.models)
        : cfg.pairs.map((p) => `${safeName(p.model)}~${safeName(p.decisionModel)}`).join("+").slice(0, 100);
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

export function gitInfo(): { gitCommit?: string; gitDirty?: boolean } {
  const commit = tryGit("git rev-parse --short HEAD");
  const status = tryGit(GIT_STATUS_CMD);
  return {
    gitCommit: commit || undefined,
    gitDirty: status !== undefined ? status.length > 0 : undefined,
  };
}

// ───────────────────────── Writer por celda ─────────────────────────

export interface CellWriter {
  /** Escribe una línea en runs.jsonl y acumula el record para scoring. */
  writeRun(record: RunRecord): void;
  /** Cierra la celda: escribe scores.json y meta.json. */
  close(meta: RunMeta): void;
  /** Records acumulados (para comparison en F5). */
  readonly records: RunRecord[];
  readonly cellDir: string;
}

export function createCellWriter(rootDir: string, variantSpec: string, datasetName: string, targetId?: string): CellWriter {
  const cellDir = resolve(`${rootDir}/${cellDirName(variantSpec, datasetName, targetId)}`);
  mkdirSync(cellDir, { recursive: true });

  const records: RunRecord[] = [];
  // Parte siempre de un runs.jsonl vacío: nunca se anexa a restos de otra corrida.
  writeFileSync(`${cellDir}/runs.jsonl`, "", "utf8");

  return {
    cellDir,
    get records() { return records; },
    writeRun(record: RunRecord) {
      records.push(record);
      appendFileSync(`${cellDir}/runs.jsonl`, JSON.stringify(record) + "\n", "utf8");
    },
    close(meta: RunMeta) {
      const scores: GlobalScoreSummary = computeScoreSummary(records);
      writeFileSync(`${cellDir}/scores.json`, JSON.stringify(scores, null, 2), "utf8");
      writeFileSync(`${cellDir}/meta.json`, JSON.stringify(meta, null, 2), "utf8");
    },
  };
}

// ───────────────────────── runId / timestamp ─────────────────────────

export function newRunId(): string {
  return createHash("sha256").update(Math.random().toString() + Date.now()).digest("hex").slice(0, 16);
}

// ───────────────────────── Construcción de RunMeta ─────────────────────────

export function buildRunMeta(opts: {
  cfg: EvalConfig;
  variantChain: string[];
  variantHash: string;
  datasetPath: string;
  datasetHash: string;
  stages: StageName[];
  /** Target de la celda; define qué modelos figuran en el meta. Sin él, ambos modelos de `cfg`. */
  scope?: RunMeta["scope"];
  /** ISO 8601 del inicio de la corrida (igual que `RunRecord.timestamp`). */
  timestamp: string;
  /** Un solo id por invocación: pasar el mismo a todas las celdas. Si falta, se genera uno. */
  runId?: string;
}): RunMeta {
  const { cfg, variantChain, variantHash, datasetPath, datasetHash, stages, timestamp } = opts;
  const scope = opts.scope ?? "all";
  const git = gitInfo();

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: opts.runId ?? newRunId(),
    timestamp,
    model: scope === "decision" ? null : cfg.model,
    decisionModel: scope === "generative" ? null : cfg.decisionModel,
    scope,
    url: cfg.url,
    decisionUrl: cfg.decisionUrl,
    variantChain,
    variantHash,
    datasetPath,
    datasetHash,
    stages,
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