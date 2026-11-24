/**
 * eval/auto/config.ts
 *
 * Parseo y validación de flags CLI para `eval/cli.ts --auto` (y `eval/auto.ts`), reutilizando
 * las primitivas compartidas de `eval/core/config.ts` para evitar duplicación.
 */

import { join } from "node:path";
import {
  DEFAULT_DECISION_MODEL,
  DEFAULT_DECISION_URL,
  DEFAULT_MODEL,
  DEFAULT_URL,
  flagBool,
  flagCsv,
  flagFloat,
  flagInt,
  flagStr,
  parseArgvFlags,
  resolveEvaluatedModels,
  type EvalConfig,
} from "../core/config.ts";
import { allStageNames } from "../core/stages/index.ts";
import type { StageName, ThinkingMode } from "../core/types.ts";
import { VARIANTS_DIR } from "../core/variants/load.ts";

export type AutoMetric = "passRate" | "macroPassRate";
export type OptimizerThinkingMode = "off" | "on";

export interface AutoConfig {
  stage: StageName;
  maxLoops: number;
  target: number;
  optimizerModel: string;
  optimizerUrl: string;
  optimizerApiKeyEnv?: string;
  optimizerTimeoutMs: number;
  optimizerThinking: OptimizerThinkingMode;
  ledgerPath: string;
  datasetSpecs: string[];
  holdoutSpecs: string[];
  /** Con holdout: la variante lo confirma si obtiene en él al menos el puntaje de `prod` más este margen (default 0; negativo tolera una caída). */
  holdoutMargin?: number;
  /** `rewrite`: propone prompts nuevos; `improve`: parte de un prompt base y lo mejora agregando y quitando (puede cambiarlo entero). */
  mode: AutoMode;
  model: string;
  decisionModel: string;
  url: string;
  decisionUrl: string;
  repeat: number;
  concurrency: number;
  thinking: ThinkingMode;
  timeoutMs?: number;
  metric: AutoMetric;
  seedTop: string[];
  archiveLosers: boolean;
  client: "real" | "mock";
  includeShortcut: boolean;
}

export type AutoMode = "rewrite" | "improve";

const DEFAULT_OPTIMIZER_TIMEOUT_MS = 120_000;

const KNOWN_FLAGS = new Set([
  "stage",
  "max-loops",
  "target",
  "optimizer-model",
  "optimizer-url",
  "optimizer-api-key-env",
  "optimizer-timeout",
  "optimizer-thinking",
  "ledger",
  "dataset",
  "holdout",
  "holdout-margin",
  "mode",
  "base",
  "model",
  "decision-model",
  "generative-model",
  "url",
  "decision-url",
  "repeat",
  "concurrency",
  "thinking",
  "timeout",
  "metric",
  "seed-top",
  "archive-losers",
  "client",
  "include-shortcut",
]);

const RENAMED_FLAGS: Record<string, string> = {
  "d-model": "decision-model=<id>",
  "llm-model": "generative-model=<id>",
};

function dedupedCsv(flags: Map<string, string | true>, key: string): string[] {
  return [...new Set(flagCsv(flags, key))];
}

export function autoStageDir(stage: StageName, variantsRoot = VARIANTS_DIR): string {
  return join(variantsRoot, "_auto", stage);
}

/** Carpeta de las variantes que superaron a `prod`: `<variantsRoot>/_ganadoras/<etapa>/`. */
export function winnersStageDir(stage: StageName, variantsRoot = VARIANTS_DIR): string {
  return join(variantsRoot, "_ganadoras", stage);
}

export function defaultLedgerPath(stage: StageName, variantsRoot = VARIANTS_DIR): string {
  return join(autoStageDir(stage, variantsRoot), "ledger.jsonl");
}

export function autoStatePath(stage: StageName, variantsRoot = VARIANTS_DIR): string {
  return join(autoStageDir(stage, variantsRoot), "auto_state.json");
}

/** Parsea `argv` (sin `--auto`, binario ni script) y devuelve `AutoConfig`. Lanza ante errores de configuración. */
export function parseAutoConfig(argv: string[]): AutoConfig {
  const flags = parseArgvFlags(argv, KNOWN_FLAGS, RENAMED_FLAGS);
  const validStages = allStageNames();

  const stageRaw = flagStr(flags, "stage");
  if (!stageRaw) {
    throw new Error(`Falta --stage=<etapa> (válidas: ${validStages.join(", ")}).`);
  }
  if (!(validStages as string[]).includes(stageRaw)) {
    throw new Error(`--stage: etapa '${stageRaw}' desconocida (válidas: ${validStages.join(", ")}).`);
  }
  const stage = stageRaw as StageName;

  const maxLoops = flagInt(flags, "max-loops", 1);
  if (maxLoops === undefined) {
    throw new Error("Falta --max-loops=<entero >= 1>.");
  }

  const target = flagFloat(flags, "target");
  if (target === undefined) {
    throw new Error("Falta --target=<decimal en (0, 1]> (ej. 0.80).");
  }
  if (!(target > 0 && target <= 1)) {
    throw new Error(`--target debe estar en (0, 1] (ej. 0.80), recibido: '${target}'.`);
  }

  const optimizerModel = flagStr(flags, "optimizer-model");
  if (!optimizerModel) {
    throw new Error("Falta --optimizer-model=<id>.");
  }

  const optimizerThinkingRaw = flagStr(flags, "optimizer-thinking") ?? "off";
  if (optimizerThinkingRaw !== "off" && optimizerThinkingRaw !== "on") {
    throw new Error(`--optimizer-thinking: valor inválido '${optimizerThinkingRaw}' (off|on).`);
  }

  const thinkingRaw = flagStr(flags, "thinking") ?? "off";
  if (!["prod", "on", "off", "both"].includes(thinkingRaw)) {
    throw new Error(`--thinking: valor inválido '${thinkingRaw}' (prod|on|off|both).`);
  }

  const metricRaw = flagStr(flags, "metric") ?? "passRate";
  if (metricRaw !== "passRate" && metricRaw !== "macroPassRate") {
    throw new Error(`--metric: debe ser 'passRate' o 'macroPassRate', recibido: '${metricRaw}'.`);
  }

  const clientRaw = flagStr(flags, "client") ?? "real";
  if (clientRaw !== "real" && clientRaw !== "mock") {
    throw new Error(`--client: en modo --auto debe ser 'real' o 'mock', recibido: '${clientRaw}'.`);
  }

  let seedTop = dedupedCsv(flags, "seed-top");
  if (seedTop.length > 2) {
    throw new Error(`--seed-top admite como máximo 2 variantes (recibidas: ${seedTop.join(", ")}).`);
  }
  if (seedTop.some((v) => v.includes("+"))) {
    throw new Error("--seed-top: las variantes no se componen con '+'.");
  }

  const holdoutMargin = flagFloat(flags, "holdout-margin");
  if (holdoutMargin !== undefined) {
    if (!(holdoutMargin >= -1 && holdoutMargin <= 1)) {
      throw new Error(`--holdout-margin debe estar en [-1, 1] (ej. 0.10 = 10 puntos sobre prod, -0.02 = tolera 2 puntos menos), recibido: '${holdoutMargin}'.`);
    }
  }

  const modeRaw = flagStr(flags, "mode") ?? "rewrite";
  if (modeRaw !== "rewrite" && modeRaw !== "improve") {
    throw new Error(`--mode debe ser 'rewrite' o 'improve', recibido: '${modeRaw}'.`);
  }
  const baseFlag = flagStr(flags, "base");
  if (baseFlag !== undefined) {
    if (modeRaw !== "improve") throw new Error("--base solo vale con --mode=improve.");
    if (seedTop.length > 0) throw new Error("--base y --seed-top no se combinan: --base ya fija la variante inicial.");
    if (baseFlag.includes("+")) throw new Error("--base: las variantes no se componen con '+'.");
    seedTop = [baseFlag];
  }

  const { model, decisionModel } = resolveEvaluatedModels(flags);

  const optimizerApiKeyEnv = flagStr(flags, "optimizer-api-key-env");
  if (optimizerApiKeyEnv && !process.env[optimizerApiKeyEnv]?.trim()) {
    throw new Error(`--optimizer-api-key-env='${optimizerApiKeyEnv}': la variable de entorno no está definida o está vacía.`);
  }

  return {
    stage,
    maxLoops,
    target,
    optimizerModel,
    optimizerUrl: flagStr(flags, "optimizer-url") ?? DEFAULT_URL,
    optimizerApiKeyEnv,
    optimizerTimeoutMs: flagInt(flags, "optimizer-timeout", 1) ?? DEFAULT_OPTIMIZER_TIMEOUT_MS,
    optimizerThinking: optimizerThinkingRaw,
    ledgerPath: flagStr(flags, "ledger") ?? defaultLedgerPath(stage),
    datasetSpecs: dedupedCsv(flags, "dataset"),
    holdoutSpecs: dedupedCsv(flags, "holdout"),
    ...(holdoutMargin !== undefined ? { holdoutMargin } : {}),
    mode: modeRaw,
    model,
    decisionModel,
    url: flagStr(flags, "url") ?? DEFAULT_URL,
    decisionUrl: flagStr(flags, "decision-url") ?? DEFAULT_DECISION_URL,
    repeat: flagInt(flags, "repeat", 1) ?? 1,
    concurrency: flagInt(flags, "concurrency", 1) ?? 1,
    thinking: thinkingRaw as ThinkingMode,
    timeoutMs: flagInt(flags, "timeout", 1),
    metric: metricRaw,
    seedTop,
    archiveLosers: flagBool(flags, "archive-losers", true),
    client: clientRaw,
    includeShortcut: flagBool(flags, "include-shortcut", false),
  };
}

/** Convierte `AutoConfig` en `EvalConfig` estándar para ejecutar un lote en `eval/core/batch.ts`. */
export function toEvalConfig(
  cfg: AutoConfig,
  opts: {
    datasetSpecs: string[];
    variantSpecs: string[];
    baseline?: string;
    label?: string;
  },
): EvalConfig {
  return {
    datasetSpecs: opts.datasetSpecs,
    variantSpecs: opts.variantSpecs,
    baseline: opts.baseline ?? "prod",
    stages: [cfg.stage],
    tags: [],
    ids: [],
    repeat: cfg.repeat,
    concurrency: cfg.concurrency,
    model: cfg.model,
    url: cfg.url,
    decisionUrl: cfg.decisionUrl,
    decisionModel: cfg.decisionModel,
    thinking: cfg.thinking,
    timeoutMs: cfg.timeoutMs,
    client: cfg.client,
    dryRun: false,
    list: false,
    includeShortcut: cfg.includeShortcut,
    label: opts.label,
  };
}

export function printAutoHelp(): void {
  const stages = allStageNames().join(", ");
  console.log(`
eval --auto — Bucle autónomo de optimización de prompts

Uso:
  npm run eval -- --auto --stage=<etapa> --max-loops=<n> --target=<0..1> --optimizer-model=<llm> [flags]
  npx tsx eval/auto.ts --stage=<etapa> --max-loops=<n> --target=<0..1> --optimizer-model=<llm> [flags]

Ejemplo con modelo evaluado explícito:
  npm run eval -- --auto --stage=route --decision-model=${DEFAULT_DECISION_MODEL} --optimizer-model=qwen3:32b --max-loops=4 --target=0.95

Flags obligatorios:
  --stage=<etapa[,etapa]>       Una o varias etapas (${stages}) o all | decision | generative.
                                Con varias corren en serie (decisión primero) con los mismos --max-loops y --target;
                                no admiten --dataset, --seed-top, --base ni --ledger, y --holdout solo como --holdout=auto
                                (usa los *_holdout*.jsonl de cada etapa). Una etapa sin alcanzar el objetivo no corta a las demás
  --max-loops=<n>               Entero >= 1. Iteraciones máximas de generación + evaluación
  --target=<decimal>            Decimal en (0, 1] (ej. 0.80). Umbral sobre --metric
  --optimizer-model=<id>        Modelo LLM optimizador (coordina/propone variantes vía /v1/chat/completions)

Modelos evaluados (opcionales; por defecto toma jarvis-config.json):
  --decision-model=<id>         Modelo de decisión a evaluar (default: ${DEFAULT_DECISION_MODEL})
  --generative-model=<id>       Modelo generativo a evaluar (default: ${DEFAULT_MODEL})
  --model=<gen>[+<dec>]         Forma combinada equivalente (default: ${DEFAULT_MODEL}+${DEFAULT_DECISION_MODEL})
  --url=<url>                   Endpoint del modelo generativo evaluado
  --decision-url=<url>          Endpoint del modelo de decisión evaluado

Flags opcionales del optimizador y ejecución:
  --optimizer-url=<url>         Endpoint OpenAI-compatible del optimizador (default: ${DEFAULT_URL})
  --optimizer-api-key-env=<v>   Variable de entorno para Bearer token del optimizador
  --optimizer-timeout=<ms>      Timeout HTTP del optimizador en ms (default: ${DEFAULT_OPTIMIZER_TIMEOUT_MS})
  --optimizer-thinking=<off|on> Razonamiento del optimizador: off | on (default: off)
  --ledger=<ruta>               Registro de ideas probadas, escrito por el código (default: eval/variants/_auto/<stage>/ledger.jsonl)
  --dataset=<csv>               Datasets de trabajo (default: todos los de --stage, sin smoke ni holdout)
  --holdout=<csv>               Dataset(s) ocultos al feedback; confirman una variante que ya alcanzó --target en desarrollo.
                                Sin --dataset ni --holdout, el holdout son los *_holdout*.jsonl de la etapa (los casos fáciles)
  --holdout-margin=<decimal>    Con holdout: la variante se confirma si obtiene en él al menos lo de prod más este margen (default 0: no empeorar a prod;
                                negativo, p. ej. -0.02, tolera una caída pequeña)
  --mode=<rewrite|improve>      rewrite: prompts nuevos (default). improve: mejora un prompt base agregando y quitando, o cambiándolo entero si hace falta
  --base=<variante>             Solo con --mode=improve: prompt base inicial (equivale a --seed-top=<variante>; default: el mejor de la Vuelta 0)
  --repeat=<n>                  Repeticiones por caso (default: 1)
  --concurrency=<n>             Concurrencia del runner (default: 1)
  --thinking=<modo>             Thinking del generativo evaluado: prod | on | off | both (default: off)
  --timeout=<ms>                Timeout de llamadas evaluadas en ms
  --metric=<m>                  passRate | macroPassRate (default: passRate)
  --seed-top=<v1,v2>            Fija hasta 2 variantes iniciales (reutiliza caché compatible; si no hay, hace la Vuelta 0 solo con prod + ellas)
  --archive-losers=<bool>       Mueve perdedoras generadas a descartadas/ (default: true)
  --client=<real|mock>          Cliente evaluado (default: real)
  --include-shortcut            Incluye casos prod_shortcut en el bucket canonical
  --help, -h                    Muestra esta ayuda

Códigos de salida:
  0  Al menos una variante != prod alcanzó --target (y --holdout si se configuró)
  1  Se agotó --max-loops sin alcanzar --target
  2  Error de configuración, datasets/variantes inválidos o fallo total de infraestructura/transporte
`);
}
