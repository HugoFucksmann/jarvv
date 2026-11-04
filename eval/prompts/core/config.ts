/**
 * eval/prompts/core/config.ts
 *
 * Parseo de flags de CLI y resolución de defaults. Sección 6.
 * Sintaxis única: `--flag=valor` o `--flag` (booleano).
 * Flag desconocido → lanza error de configuración.
 */

import type { StageName, ThinkingMode } from "./types.ts";
import { allStageNames } from "./stages/index.ts";
import { parseVariantSpecs } from "./variants/load.ts";

// ───────────────────────── Tipos ─────────────────────────

export interface EvalConfig {
  // Datasets
  datasetSpecs: string[];     // specs crudas (archivo|carpeta|glob separadas por coma)

  // Variantes
  variantSpecs: string[];     // ya con prod garantizado
  baseline: string;

  // Filtros
  stages: StageName[];        // vacío = todas
  tags: string[];
  ids: string[];
  limit?: number;

  // Ejecución
  repeat: number;
  concurrency: number;

  // Modelos generativos
  model: string;
  url: string;

  // Modelos de decisión
  decisionUrl: string;
  decisionModel: string;

  // Parámetros
  thinking: ThinkingMode;
  timeoutMs?: number;         // undefined = usar defaults por tipo/thinking

  // Clientes
  client: "real" | "mock" | "oracle";

  // Modos especiales
  dryRun: boolean;
  list: boolean;
  includeShortcut: boolean;

  // Resultados
  label?: string;
  minPassRate?: number;
}

// ───────────────────────── Defaults ─────────────────────────

export const DEFAULT_MODEL = "qwen3.5:4b";
export const DEFAULT_URL = "http://127.0.0.1:11434";
export const DEFAULT_DECISION_URL = "http://127.0.0.1:11434";
export const DEFAULT_DECISION_MODEL = "d3:2b";
export const DEFAULT_DATASETS = "eval/prompts/datasets/";

/** Timeout por tipo de llamada (ms). */
export const TIMEOUT_GENERATIVE = 120_000;
export const TIMEOUT_THINKING = 180_000;
export const TIMEOUT_DECISION = 30_000;

/** Resuelve el timeout real para una llamada generativa según si lleva thinking. */
export function resolveGenerativeTimeout(cfg: EvalConfig, thinking: boolean): number {
  if (cfg.timeoutMs !== undefined) return cfg.timeoutMs;
  return thinking ? TIMEOUT_THINKING : TIMEOUT_GENERATIVE;
}

export function resolveDecisionTimeout(cfg: EvalConfig): number {
  return cfg.timeoutMs ?? TIMEOUT_DECISION;
}

// ───────────────────────── Flags conocidos ─────────────────────────

const KNOWN_FLAGS = new Set([
  "dataset", "variant", "baseline", "stages", "tags", "ids", "limit",
  "repeat", "concurrency", "model", "url", "decision-backend", "decision-url",
  "decision-model", "thinking", "timeout", "client",
  "dry-run", "list", "label", "min-pass-rate", "include-shortcut",
]);

// ───────────────────────── Parseo ─────────────────────────

function parseArgs(argv: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`Argumento inesperado: '${arg}'. Use --flag=valor o --flag.`);
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (result.has(key)) throw new Error(`Flag repetido: '--${key}'.`);
    const value = eq === -1 ? true : arg.slice(eq + 1);
    if (!KNOWN_FLAGS.has(key)) {
      throw new Error(`Flag desconocido: '--${key}'.`);
    }
    result.set(key, value);
  }
  return result;
}

function str(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key);
  // `--model` sin valor antes se ignoraba en silencio y se usaba el default.
  if (v === true) throw new Error(`--${key} requiere un valor (--${key}=valor).`);
  // `--min-pass-rate=` se leía como umbral 0 (siempre pasa).
  if (typeof v === "string" && v.trim() === "") throw new Error(`--${key} no puede estar vacío.`);
  return typeof v === "string" ? v : undefined;
}

function bool(flags: Map<string, string | true>, key: string): boolean {
  const v = flags.get(key);
  if (v === undefined) return false;
  // Antes `--dry-run=false` se leía como true (solo se miraba si la clave existía).
  if (v === true || v === "true") return true;
  if (v === "false") return false;
  throw new Error(`--${key} es booleano: use --${key}, --${key}=true o --${key}=false (recibido: '${v}').`);
}

function int(flags: Map<string, string | true>, key: string, min: number): number | undefined {
  const v = str(flags, key);
  if (v === undefined) return undefined;
  const n = /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`--${key} debe ser un entero >= ${min}, recibido: '${v}'.`);
  }
  return n;
}

function float(flags: Map<string, string | true>, key: string): number | undefined {
  const v = str(flags, key);
  if (v === undefined) return undefined;
  // Solo decimales simples (0.5, -1, 2): `0x10`, `1e3` o `.5` no se aceptan.
  if (!/^-?\d+(\.\d+)?$/.test(v.trim())) throw new Error(`--${key} debe ser un número decimal simple (ej. 0.5), recibido: '${v}'.`);
  return Number(v);
}

function csvList(flags: Map<string, string | true>, key: string): string[] {
  const v = str(flags, key);
  if (!v) return [];
  const list = v.split(",").map((s) => s.trim()).filter(Boolean);
  // `--stages=,` o `--ids=,` dejaban una lista vacía y se corría todo en silencio.
  if (list.length === 0) throw new Error(`--${key} no contiene ningún valor (recibido: '${v}').`);
  return list;
}

/** Parsea `argv` (sin el binario ni el script) y devuelve `EvalConfig`. Lanza en error de config. */
export function parseConfig(argv: string[]): EvalConfig {
  const flags = parseArgs(argv);

  // stages
  const stageNames = allStageNames();
  const stagesRaw = csvList(flags, "stages");
  const stages: StageName[] = [];
  for (const s of stagesRaw) {
    if (!(stageNames as string[]).includes(s)) {
      throw new Error(`--stages: etapa '${s}' desconocida (válidas: ${stageNames.join(", ")}).`);
    }
    stages.push(s as StageName);
  }

  // thinking
  const thinkingRaw = str(flags, "thinking") ?? "auto";
  if (!["auto", "prod", "on", "off", "both"].includes(thinkingRaw)) {
    throw new Error(`--thinking: valor inválido '${thinkingRaw}' (auto|prod|on|off|both).`);
  }
  const thinking = thinkingRaw as ThinkingMode;

  // client
  const clientRaw = str(flags, "client") ?? "real";
  if (clientRaw !== "real" && clientRaw !== "mock" && clientRaw !== "oracle") {
    throw new Error(`--client: debe ser 'real', 'mock' u 'oracle', recibido: '${clientRaw}'.`);
  }

  // decision-backend: el backend `eos` ya no existe; solo se acepta `d3` (no-op, por compatibilidad con scripts)
  const decisionBackendRaw = str(flags, "decision-backend");
  if (decisionBackendRaw !== undefined && decisionBackendRaw !== "d3") {
    throw new Error(`--decision-backend: solo se soporta 'd3' (recibido: '${decisionBackendRaw}').`);
  }
  const decisionUrl = str(flags, "decision-url") ?? DEFAULT_DECISION_URL;

  // variants: `prod` se agrega si falta (la comparación usa spec exacta, `prod+x` no cuenta), sin duplicados
  const variantSpecs = parseVariantSpecs(str(flags, "variant") ?? "prod");
  const baseline = str(flags, "baseline") ?? "prod";
  if (!variantSpecs.includes(baseline)) {
    throw new Error(`--baseline: '${baseline}' no está entre las variantes (${variantSpecs.join(", ")}).`);
  }

  // min-pass-rate: passRate vive en [0,1]; `--min-pass-rate=95` fallaría siempre
  const minPassRate = float(flags, "min-pass-rate");
  if (minPassRate !== undefined && (minPassRate < 0 || minPassRate > 1)) {
    throw new Error(`--min-pass-rate debe estar entre 0 y 1 (ej. 0.95), recibido: '${minPassRate}'.`);
  }

  const datasetList = csvList(flags, "dataset");
  const datasetSpecs = datasetList.length > 0 ? datasetList : [DEFAULT_DATASETS];

  return {
    datasetSpecs,
    variantSpecs,
    baseline,
    stages,
    tags: csvList(flags, "tags"),
    ids: csvList(flags, "ids"),
    limit: int(flags, "limit", 1),
    repeat: int(flags, "repeat", 1) ?? 1,
    concurrency: int(flags, "concurrency", 1) ?? 1,
    model: str(flags, "model") ?? DEFAULT_MODEL,
    url: str(flags, "url") ?? DEFAULT_URL,
    decisionUrl,
    decisionModel: str(flags, "decision-model") ?? DEFAULT_DECISION_MODEL,
    thinking,
    timeoutMs: int(flags, "timeout", 1),
    client: clientRaw as "real" | "mock" | "oracle",
    dryRun: bool(flags, "dry-run"),
    list: bool(flags, "list"),
    includeShortcut: bool(flags, "include-shortcut"),
    label: str(flags, "label"),
    minPassRate,
  };
}