/**
 * scripts/eval-next/core/config.ts
 *
 * Parseo y validación de argumentos de línea de comandos para el runner de evaluación.
 *
 * Exit codes:
 *   0 = OK (pass rate cumplido o sin umbral)
 *   1 = Pass rate por debajo de --minPassRate
 *   2 = Error de infraestructura (dataset no encontrado, modelo inalcanzable, etc.)
 */

import path from "node:path";
import type { StageName } from "./types.ts";
import { getAllStageNames } from "./stages/index.ts";

export interface RunnerConfig {
  stages: StageName[];
  model: string;
  url?: string;
  device: "gpu" | "cpu" | "remote";
  dataset: string;
  variant: string;
  repeat: number;
  filter?: string;
  label?: string;
  tag?: string;
  thinking: "on" | "off" | "both" | "config";
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  numCtx?: number;
  minPassRate?: number;
  concurrency: number;
  isMock: boolean;
}

/**
 * Timeouts por defecto por etapa (ms).
 * Se usan cuando no se pasa --timeout. Las etapas generativas con thinking
 * tienen presupuestos mayores.
 */
export const STAGE_TIMEOUT_DEFAULTS_MS: Partial<Record<StageName, number>> = {
  plan: 60_000,
  arguments: 30_000,
  final: 45_000,
  question: 20_000,
  route: 15_000,
  tool_choice: 15_000,
  args_review: 15_000,
  result_verification: 15_000,
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): RunnerConfig {
  const flags: Record<string, string> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      flags[body] = "true";
    } else {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }

  // 1. Etapas
  const rawStage = flags.stage || "all";
  let stages: StageName[];
  if (rawStage === "all") {
    stages = getAllStageNames();
  } else {
    stages = rawStage.split(",").map((s) => s.trim()) as StageName[];
    const all = getAllStageNames();
    for (const st of stages) {
      if (!all.includes(st)) {
        throw new Error(`Etapa '${st}' desconocida. Etapas válidas: ${all.join(", ")}, all`);
      }
    }
  }

  // 2. Modelo
  const model = flags.model || "qwen3.5:4b";
  const isMock = model === "mock";

  // 3. Dataset
  const dataset = flags.dataset || path.resolve(process.cwd(), "scripts/eval-next/datasets/sample.jsonl");

  // 4. Repeticiones
  const repeat = flags.repeat ? Math.max(1, parseInt(flags.repeat, 10) || 1) : 1;

  // 5. Flags de ejecución
  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : undefined;
  const numCtx = flags.numCtx ? parseInt(flags.numCtx, 10) : undefined;
  const temperature = flags.temperature ? parseFloat(flags.temperature) : undefined;
  const seed = flags.seed ? parseInt(flags.seed, 10) : undefined;
  const minPassRate = flags.minPassRate ? parseFloat(flags.minPassRate) : undefined;
  const concurrency = flags.concurrency ? Math.max(1, parseInt(flags.concurrency, 10) || 1) : 1;
  const thinkingRaw = flags.thinking || "config";
  const thinking = (["on", "off", "both", "config"].includes(thinkingRaw) ? thinkingRaw : "config") as
    | "on"
    | "off"
    | "both"
    | "config";

  const filter = flags.filter || flags.tag;
  const label = flags.label || (flags.filter ? flags.tag : undefined);

  return {
    stages,
    model,
    url: flags.url,
    device: (flags.device as "gpu" | "cpu" | "remote") || "gpu",
    dataset,
    variant: flags.variant || "prod",
    repeat,
    filter,
    label,
    tag: flags.tag,
    thinking,
    temperature,
    seed,
    timeoutMs,
    numCtx,
    minPassRate,
    concurrency,
    isMock,
  };
}
