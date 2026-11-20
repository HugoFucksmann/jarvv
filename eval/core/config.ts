/**
 * eval/core/config.ts
 *
 * Parseo de flags de CLI y resolución de defaults. Sección 6.
 * Sintaxis única: `--flag=valor` o `--flag` (booleano).
 * Flag desconocido → lanza error de configuración.
 */

import { ConfigManager } from "./contract.ts";
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

  // Modelo generativo y modelo de decisión (`--model=<generativo>+<decisión>`).
  model: string;
  url: string;
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

// Los defaults salen de la configuración de producción (`jarvis-config.json`; sin él, sus valores por defecto), así el eval
// mide por defecto lo que corre Jarvis y no puede divergir en silencio.
const PROD = ConfigManager.getConfig();
export const DEFAULT_MODEL = PROD.qwenModel;
export const DEFAULT_URL = PROD.qwenUrl;
export const DEFAULT_DECISION_URL = PROD.decisionUrl;
export const DEFAULT_DECISION_MODEL = PROD.decisionModel;
export const DEFAULT_DATASETS = "eval/datasets/";

/** Timeout por tipo de llamada (ms): los de la configuración de producción. */
export const TIMEOUT_GENERATIVE = PROD.qwenTimeoutMs;
export const TIMEOUT_THINKING = PROD.qwenThinkingTimeoutMs;
export const TIMEOUT_DECISION = PROD.decisionTimeoutMs;

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
  "repeat", "concurrency", "model", "decision-model", "generative-model", "url", "decision-url",
  "thinking", "timeout", "client",
  "dry-run", "list", "label", "min-pass-rate", "include-shortcut", "no-baseline",
]);

/** Flags que cambiaron de nombre: el error de "flag desconocido" indica el nuevo. */
const RENAMED_FLAGS: Record<string, string> = {
  "d-model": "decision-model=<id>",
  "llm-model": "generative-model=<id>",
};

// ───────────────────────── Parseo ─────────────────────────

/** Parseo estricto de argv (`--flag=valor` o `--flag`) contra un conjunto cerrado de flags permitidos. */
export function parseArgvFlags(
  argv: string[],
  knownFlags: Set<string>,
  renamedFlags: Record<string, string> = {},
): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`Argumento inesperado: '${arg}'. Use --flag=valor o --flag.`);
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (result.has(key)) throw new Error(`Flag repetido: '--${key}'.`);
    const value = eq === -1 ? true : arg.slice(eq + 1);
    if (!knownFlags.has(key)) {
      const renamed = renamedFlags[key];
      throw new Error(`Flag desconocido: '--${key}'.${renamed ? ` Ahora se llama '--${renamed}'.` : ""}`);
    }
    result.set(key, value);
  }
  return result;
}

export function flagStr(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key);
  // `--model` sin valor antes se ignoraba en silencio y se usaba el default.
  if (v === true) throw new Error(`--${key} requiere un valor (--${key}=valor).`);
  // `--min-pass-rate=` se leía como umbral 0 (siempre pasa).
  if (typeof v === "string" && v.trim() === "") throw new Error(`--${key} no puede estar vacío.`);
  return typeof v === "string" ? v.trim() : undefined;
}

export function flagBool(flags: Map<string, string | true>, key: string, defaultValue = false): boolean {
  const v = flags.get(key);
  if (v === undefined) return defaultValue;
  // Antes `--dry-run=false` se leía como true (solo se miraba si la clave existía).
  if (v === true || v === "true") return true;
  if (v === "false") return false;
  throw new Error(`--${key} es booleano: use --${key}, --${key}=true o --${key}=false (recibido: '${v}').`);
}

export function flagInt(flags: Map<string, string | true>, key: string, min: number): number | undefined {
  const v = flagStr(flags, key);
  if (v === undefined) return undefined;
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`--${key} debe ser un entero >= ${min}, recibido: '${v}'.`);
  }
  return n;
}

export function flagFloat(flags: Map<string, string | true>, key: string): number | undefined {
  const v = flagStr(flags, key);
  if (v === undefined) return undefined;
  // Solo decimales simples (0.5, -1, 2): `0x10`, `1e3` o `.5` no se aceptan.
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`--${key} debe ser un número decimal simple (ej. 0.5), recibido: '${v}'.`);
  return Number(v);
}

/**
 * `--model=<generativo>[+<decisión>]`: un modelo generativo y uno de decisión. Un lado vacío usa el default
 * (`--model=qwen3.5:4b` = ese generativo con el de decisión por defecto; `--model=+d3:2b` al revés).
 */
export function parseModelSpec(raw: string): { model: string; decisionModel: string } {
  if (raw.includes(",")) throw new Error(`--model: '${raw}' tiene más de una configuración; el eval corre un solo modelo generativo y uno de decisión.`);
  const parts = raw.split("+");
  if (parts.length > 2) throw new Error(`--model: '${raw}' tiene más de un '+' (formato: <generativo>+<decisión>).`);
  return { model: parts[0].trim() || DEFAULT_MODEL, decisionModel: (parts[1] ?? "").trim() || DEFAULT_DECISION_MODEL };
}

/** Resuelve `--model`, `--generative-model` y `--decision-model` de forma uniforme en normal y `--auto`. */
export function resolveEvaluatedModels(flags: Map<string, string | true>): { model: string; decisionModel: string } {
  const modelRaw = flagStr(flags, "model");
  const genOverride = flagStr(flags, "generative-model");
  const decOverride = flagStr(flags, "decision-model");

  const parsed = modelRaw !== undefined
    ? parseModelSpec(modelRaw)
    : { model: DEFAULT_MODEL, decisionModel: DEFAULT_DECISION_MODEL };
  const explicitGen = modelRaw !== undefined ? modelRaw.split("+")[0].trim() : "";
  const explicitDec = modelRaw !== undefined ? (modelRaw.split("+")[1] ?? "").trim() : "";

  if (genOverride && explicitGen && genOverride !== explicitGen) {
    throw new Error(`--generative-model='${genOverride}' entra en conflicto con --model='${modelRaw}'. Use solo uno.`);
  }
  if (decOverride && explicitDec && decOverride !== explicitDec) {
    throw new Error(`--decision-model='${decOverride}' entra en conflicto con --model='${modelRaw}'. Use solo uno.`);
  }

  return {
    model: genOverride ?? parsed.model,
    decisionModel: decOverride ?? parsed.decisionModel,
  };
}

export function flagCsv(flags: Map<string, string | true>, key: string): string[] {
  const v = flagStr(flags, key);
  if (!v) return [];
  const list = v.split(",").map((s) => s.trim()).filter(Boolean);
  // `--stages=,` o `--ids=,` dejaban una lista vacía y se corría todo en silencio.
  if (list.length === 0) throw new Error(`--${key} no contiene ningún valor (recibido: '${v}').`);
  return list;
}

/** Parsea `argv` (sin el binario ni el script) y devuelve `EvalConfig`. Lanza en error de config. */
export function parseConfig(argv: string[]): EvalConfig {
  const flags = parseArgvFlags(argv, KNOWN_FLAGS, RENAMED_FLAGS);

  // stages
  const stageNames = allStageNames();
  const stagesRaw = flagCsv(flags, "stages");
  const stages: StageName[] = [];
  for (const s of stagesRaw) {
    if (!(stageNames as string[]).includes(s)) {
      throw new Error(`--stages: etapa '${s}' desconocida (válidas: ${stageNames.join(", ")}).`);
    }
    stages.push(s as StageName);
  }

  // thinking
  // Por defecto SIN thinking: con él cada llamada generativa tarda decenas de segundos y Jarvis no lo usa; sin la bandera el modelo piensa por su cuenta.
  const thinkingRaw = flagStr(flags, "thinking") ?? "off";
  if (!["prod", "on", "off", "both"].includes(thinkingRaw)) {
    throw new Error(`--thinking: valor inválido '${thinkingRaw}' (prod|on|off|both).`);
  }
  const thinking = thinkingRaw as ThinkingMode;

  // client
  const clientRaw = flagStr(flags, "client") ?? "real";
  if (clientRaw !== "real" && clientRaw !== "mock" && clientRaw !== "oracle") {
    throw new Error(`--client: debe ser 'real', 'mock' u 'oracle', recibido: '${clientRaw}'.`);
  }

  const decisionUrl = flagStr(flags, "decision-url") ?? DEFAULT_DECISION_URL;

  // variants: `prod` se agrega si falta (la comparación usa la spec exacta), sin duplicados
  // `--no-baseline`: no se agrega `prod`; sin `--baseline` explícito, la baseline es la primera variante.
  const noBaseline = flagBool(flags, "no-baseline");
  if (noBaseline && flagStr(flags, "variant") === undefined) {
    throw new Error("--no-baseline requiere --variant con al menos una variante.");
  }
  const variantSpecs = parseVariantSpecs(flagStr(flags, "variant") ?? "prod", !noBaseline);
  if (clientRaw === "oracle") {
    const other = variantSpecs.filter((v) => v !== "prod");
    if (other.length > 0) {
      throw new Error(`--client=oracle solo vale con la variante 'prod' (el oráculo responde en sus términos); no se puede con: ${other.join(", ")}.`);
    }
  }
  const baseline = flagStr(flags, "baseline") ?? (noBaseline ? variantSpecs[0] : "prod");
  if (!variantSpecs.includes(baseline)) {
    throw new Error(`--baseline: '${baseline}' no está entre las variantes (${variantSpecs.join(", ")}).`);
  }

  // min-pass-rate: passRate vive en [0,1]; `--min-pass-rate=95` fallaría siempre
  const minPassRate = flagFloat(flags, "min-pass-rate");
  if (minPassRate !== undefined && (minPassRate < 0 || minPassRate > 1)) {
    throw new Error(`--min-pass-rate debe estar entre 0 y 1 (ej. 0.95), recibido: '${minPassRate}'.`);
  }

  const { model, decisionModel } = resolveEvaluatedModels(flags);

  const datasetList = flagCsv(flags, "dataset");
  const datasetSpecs = datasetList.length > 0 ? datasetList : [DEFAULT_DATASETS];

  return {
    datasetSpecs,
    variantSpecs,
    baseline,
    stages,
    tags: flagCsv(flags, "tags"),
    ids: flagCsv(flags, "ids"),
    limit: flagInt(flags, "limit", 1),
    repeat: flagInt(flags, "repeat", 1) ?? 1,
    concurrency: flagInt(flags, "concurrency", 1) ?? 3,
    model,
    url: flagStr(flags, "url") ?? DEFAULT_URL,
    decisionUrl,
    decisionModel,
    thinking,
    timeoutMs: flagInt(flags, "timeout", 1),
    client: clientRaw as "real" | "mock" | "oracle",
    dryRun: flagBool(flags, "dry-run"),
    list: flagBool(flags, "list"),
    includeShortcut: flagBool(flags, "include-shortcut"),
    label: flagStr(flags, "label"),
    minPassRate,
  };
}