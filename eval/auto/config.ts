/**
 * eval/auto/config.ts
 *
 * Parseo y validación de flags CLI para `eval/cli.ts --auto` (y `eval/auto.ts`), reutilizando
 * las primitivas compartidas de `eval/core/config.ts` para evitar duplicación.
 */

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
  parseModelSpec,
  type EvalConfig,
} from "../core/config.ts";
import { allStageNames } from "../core/stages/index.ts";
import type { StageName, ThinkingMode } from "../core/types.ts";

export type AutoMetric = "passRate" | "macroPassRate";

export interface AutoConfig {
  stage: StageName;
  maxLoops: number;
  target: number;
  optimizerModel: string;
  optimizerUrl: string;
  optimizerApiKeyEnv?: string;
  optimizerTimeoutMs: number;
  conclusionsPath: string;
  datasetSpecs: string[];
  holdoutSpecs: string[];
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

const DEFAULT_OPTIMIZER_TIMEOUT_MS = 120_000;

const KNOWN_FLAGS = new Set([
  "stage",
  "max-loops",
  "target",
  "optimizer-model",
  "optimizer-url",
  "optimizer-api-key-env",
  "optimizer-timeout",
  "conclusions",
  "dataset",
  "holdout",
  "model",
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

function dedupedCsv(flags: Map<string, string | true>, key: string): string[] {
  return [...new Set(flagCsv(flags, key))];
}

export function defaultConclusionsPath(stage: StageName): string {
  return `eval/variants/_auto/${stage}/conclusiones.md`;
}

export function autoStageDir(stage: StageName): string {
  return `eval/variants/_auto/${stage}`;
}

export function autoStatePath(stage: StageName): string {
  return `${autoStageDir(stage)}/auto_state.json`;
}

/** Parsea `argv` (sin `--auto`, binario ni script) y devuelve `AutoConfig`. Lanza ante errores de configuración. */
export function parseAutoConfig(argv: string[]): AutoConfig {
  const flags = parseArgvFlags(argv, KNOWN_FLAGS);
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

  const seedTop = dedupedCsv(flags, "seed-top");
  if (seedTop.length > 2) {
    throw new Error(`--seed-top admite como máximo 2 variantes (recibidas: ${seedTop.join(", ")}).`);
  }
  if (seedTop.some((v) => v.includes("+"))) {
    throw new Error("--seed-top: las variantes no se componen con '+'.");
  }

  const modelRaw = flagStr(flags, "model");
  const { model, decisionModel } = modelRaw !== undefined
    ? parseModelSpec(modelRaw)
    : { model: DEFAULT_MODEL, decisionModel: DEFAULT_DECISION_MODEL };

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
    conclusionsPath: flagStr(flags, "conclusions") ?? defaultConclusionsPath(stage),
    datasetSpecs: dedupedCsv(flags, "dataset"),
    holdoutSpecs: dedupedCsv(flags, "holdout"),
    model,
    decisionModel,
    url: flagStr(flags, "url") ?? DEFAULT_URL,
    decisionUrl: flagStr(flags, "decision-url") ?? DEFAULT_DECISION_URL,
    repeat: flagInt(flags, "repeat", 1) ?? 1,
    concurrency: flagInt(flags, "concurrency", 1) ?? 3,
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

Flags obligatorios:
  --stage=<etapa>             Etapa única (${stages})
  --max-loops=<n>             Entero >= 1. Iteraciones máximas de generación + evaluación
  --target=<decimal>          Decimal en (0, 1] (ej. 0.80). Umbral sobre --metric
  --optimizer-model=<id>      Modelo LLM optimizador compatible con /v1/chat/completions

Flags opcionales:
  --optimizer-url=<url>       Endpoint OpenAI-compatible (default: ${DEFAULT_URL})
  --optimizer-api-key-env=<v> Variable de entorno para Bearer token del optimizador
  --optimizer-timeout=<ms>    Timeout HTTP del optimizador en ms (default: ${DEFAULT_OPTIMIZER_TIMEOUT_MS})
  --conclusions=<ruta>        Markdown por etapa (default: eval/variants/_auto/<stage>/conclusiones.md)
  --dataset=<csv>             Datasets de trabajo (default: todos los de --stage, sin smoke ni holdout)
  --holdout=<csv>             Dataset(s) ocultos al feedback; confirman solo al alcanzar --target
  --model=<gen>[+<dec>]       Modelos evaluados (default: ${DEFAULT_MODEL}+${DEFAULT_DECISION_MODEL})
  --url=<url>                 Endpoint del modelo generativo evaluado
  --decision-url=<url>        Endpoint del modelo de decisión evaluado
  --repeat=<n>                Repeticiones por caso (default: 1)
  --concurrency=<n>           Concurrencia del runner (default: 3)
  --thinking=<modo>           prod | on | off | both (default: off)
  --timeout=<ms>              Timeout de llamadas evaluadas en ms
  --metric=<m>                passRate | macroPassRate (default: passRate)
  --seed-top=<v1,v2>          Salta Vuelta 0 fijando hasta 2 variantes iniciales
  --archive-losers=<bool>     Mueve perdedoras generadas a descartadas/ (default: true)
  --client=<real|mock>        Cliente evaluado (default: real)
  --include-shortcut          Incluye casos prod_shortcut en el bucket canonical
  --help, -h                  Muestra esta ayuda

Códigos de salida:
  0  Al menos una variante != prod alcanzó --target (y --holdout si se configuró)
  1  Se agotó --max-loops sin alcanzar --target
  2  Error de configuración, datasets/variantes inválidos o fallo total de infraestructura/transporte
`);
}
