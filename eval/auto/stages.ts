/**
 * eval/auto/stages.ts
 *
 * `--auto` con varias etapas: `--stage=route,d0`, `--stage=decision`, `--stage=generative` o `--stage=all`. Las etapas corren en serie, con los mismos
 * `--max-loops` y `--target`, las de decisión primero (así el servidor de modelos no cambia de modelo en cada etapa). Acá están las piezas puras:
 * expandir la lista, validar los flags, armar el `argv` de cada etapa, buscar su holdout y resumir el resultado.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATASETS_DIR } from "../core/datasets.ts";
import { fmtPct } from "../core/report-format.ts";
import { allStageNames, hasStage, isDecisionStage, stageNamesByType } from "../core/stages/index.ts";
import type { StageName } from "../core/types.ts";
import { HOLDOUT_FILENAME_RE } from "./discover.ts";

/** Flags que describen una sola etapa: con varias etapas no tienen sentido. */
export const SINGLE_STAGE_ONLY_FLAGS = ["dataset", "seed-top", "base", "ledger"] as const;

const STAGE_KEYWORDS = ["all", "decision", "generative"];

/** El valor de `--stage=` pide más de una etapa (lista con comas o una palabra clave). */
export function isMultiStageArg(raw: string): boolean {
  return raw.includes(",") || STAGE_KEYWORDS.includes(raw);
}

/** Expande `--stage` a la lista de etapas, sin repetidas y con las de decisión primero (cada grupo conserva el orden pedido). */
export function expandStages(raw: string): StageName[] {
  const names: StageName[] = [];
  for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (token === "all") names.push(...allStageNames());
    else if (token === "decision" || token === "generative") names.push(...stageNamesByType(token));
    else if (hasStage(token)) names.push(token);
    else throw new Error(`--stage: etapa '${token}' desconocida (válidas: ${allStageNames().join(", ")}, o all, decision, generative).`);
  }
  const unique = [...new Set(names)];
  if (unique.length === 0) throw new Error("--stage: la lista de etapas está vacía.");
  return [...unique.filter((s) => isDecisionStage(s)), ...unique.filter((s) => !isDecisionStage(s))];
}

/** Rechaza los flags de una sola etapa y deja `--holdout` solo como `--holdout=auto`. */
export function checkMultiStageFlags(argv: string[]): void {
  const used = (flag: string): string | undefined => argv.find((a) => a === `--${flag}` || a.startsWith(`--${flag}=`));
  for (const flag of SINGLE_STAGE_ONLY_FLAGS) {
    if (used(flag)) throw new Error(`--${flag} es de una sola etapa: no se puede usar con varias (cada una usa sus datasets, historial y variantes).`);
  }
  const holdout = used("holdout");
  if (holdout !== undefined && holdout !== "--holdout=auto") {
    throw new Error("Con varias etapas, --holdout solo admite --holdout=auto (usa los *_holdout*.jsonl de cada etapa).");
  }
}

/** El `argv` de una etapa: el mismo, con `--stage=<etapa>` y sin `--holdout=auto` (el holdout se resuelve aparte). */
export function argvForStage(argv: string[], stage: StageName): string[] {
  return argv.filter((a) => a !== "--holdout=auto").map((a) => (a.startsWith("--stage=") ? `--stage=${stage}` : a));
}

/** Archivos de holdout de una etapa: los `*_holdout*.jsonl` de `eval/datasets/<etapa>/`. */
export function holdoutFilesOf(stage: StageName, datasetsDir = DATASETS_DIR): string[] {
  const dir = resolve(datasetsDir, stage);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => HOLDOUT_FILENAME_RE.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export interface StageOutcome {
  stage: StageName;
  /** Código de salida de la etapa, o `skipped` si no tiene datasets con casos. */
  code: 0 | 1 | 2 | "skipped";
  prodScore?: number;
  best?: { variant: string; score: number };
}

/** 0 si todas las etapas corridas llegaron al objetivo, 1 si alguna no, 2 si alguna falló (o no corrió ninguna). */
export function combineExitCodes(outcomes: readonly StageOutcome[]): number {
  const ran = outcomes.filter((o) => o.code !== "skipped");
  if (ran.length === 0 || ran.some((o) => o.code === 2)) return 2;
  return ran.some((o) => o.code === 1) ? 1 : 0;
}

const RESULT_TEXT: Record<StageOutcome["code"] & (string | number), string> = {
  0: "objetivo alcanzado",
  1: "sin alcanzar el objetivo",
  2: "error",
  skipped: "sin datasets",
};

/** Tabla de resultados al terminar todas las etapas. */
export function formatStageSummary(outcomes: readonly StageOutcome[]): string {
  const width = Math.max(...outcomes.map((o) => o.stage.length), 5);
  const head = `  ${"etapa".padEnd(width)}  ${"resultado".padEnd(26)}  prod    mejor variante`;
  const rows = outcomes.map((o) => {
    const prod = o.prodScore !== undefined ? fmtPct(o.prodScore) : "—";
    const best = o.best ? `${fmtPct(o.best.score)}  ${o.best.variant}` : "—";
    return `  ${o.stage.padEnd(width)}  ${RESULT_TEXT[o.code].padEnd(26)}  ${prod.padEnd(6)}  ${best}`;
  });
  return [head, ...rows].join("\n");
}
