/**
 * eval/auto/discover.ts
 *
 * Descubrimiento automático de datasets y variantes aplicables a `--stage`.
 * - Excluye `smoke.jsonl` y `*_holdout*.jsonl` del conjunto de entrenamiento salvo que se pasen explícitamente.
 * - Excluye `prod`, `_archivo_*`, `_auto/<otra_etapa>/` y `descartadas/`
 *   al descubrir variantes activas iniciales para Vuelta 0.
 */

import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { loadDatasets, resolveDatasetPaths, type Dataset, type RawDatasetCache } from "../core/datasets.ts";
import { forEachJsonlLineSync } from "../core/io.ts";
import { objectHash } from "../core/results.ts";
import type { StageName } from "../core/types.ts";
import { listActiveVariantFiles, VARIANTS_DIR } from "../core/variants/load.ts";
import { loadVariantSpecEphemeral } from "./ephemeralVariant.ts";
import { getStageContract } from "./stageContract.ts";

export const HOLDOUT_FILENAME_RE = /(?:^|[_-])holdout\d*\.jsonl$/i;

export interface DiscoveredDatasets {
  dev: Dataset[];
  holdout: Dataset[];
  /** Mapa `datasetName -> datasetHash` para verificar compatibilidad de resultados cacheados. */
  devHashes: Record<string, string>;
  /** Mapa `datasetName -> casesHash` (igual a `RunMeta.cases.hash`) para comparar huellas exactas. */
  devCasesHashes: Record<string, string>;
}

export interface DiscoveredVariant {
  name: string;
  path: string;
  hash: string;
  isAuto: boolean;
}

const STOP_STAGE_SCAN = Symbol("STOP_STAGE_SCAN");

/** Verifica rápidamente si un `.jsonl` tiene al menos un caso de `stage` sin cargar todo el archivo en RAM ni materializar escenarios. */
function jsonlContainsStage(filePath: string, stage: StageName): boolean {
  try {
    forEachJsonlLineSync(filePath, (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      try {
        const parsed = JSON.parse(trimmed) as { stage?: unknown };
        if (parsed.stage === stage) throw STOP_STAGE_SCAN;
      } catch (err) {
        if (err === STOP_STAGE_SCAN) throw err;
        // Si hay una línea inválida en el archivo, dejamos que loadDatasets la reporte normalmente.
        throw STOP_STAGE_SCAN;
      }
    });
    return false;
  } catch (err) {
    if (err === STOP_STAGE_SCAN) return true;
    throw err;
  }
}

/**
 * Descubre y carga los datasets de trabajo (`dev`) y los opcionales de `--holdout` para `stage`.
 * Lanza error descriptivo si no quedan datasets o si `dev` y `holdout` se solapan.
 */
export function discoverStageDatasets(
  stage: StageName,
  explicitDatasets: string[],
  holdoutSpecs: string[],
  rawCache?: RawDatasetCache,
): DiscoveredDatasets {
  const holdoutPaths = holdoutSpecs.length > 0 ? resolveDatasetPaths(holdoutSpecs).map((p) => resolve(p)) : [];
  const holdoutPathSet = new Set(holdoutPaths);

  let devPaths: string[];
  if (explicitDatasets.length > 0) {
    devPaths = resolveDatasetPaths(explicitDatasets);
    const overlap = devPaths.filter((p) => holdoutPathSet.has(resolve(p)));
    if (overlap.length > 0) {
      throw new Error(
        `Los datasets de --dataset y --holdout no pueden solaparse: ${overlap.join(", ")}.`,
      );
    }
  } else {
    const allJsonl = resolveDatasetPaths(["eval/datasets/"]);
    devPaths = allJsonl.filter((p) => {
      const fileName = basename(p);
      if (fileName === "smoke.jsonl") return false;
      if (HOLDOUT_FILENAME_RE.test(fileName)) return false;
      if (holdoutPathSet.has(resolve(p))) return false;
      return jsonlContainsStage(p, stage);
    });
  }

  if (devPaths.length === 0) {
    throw new Error(
      `No se encontraron datasets de trabajo para la etapa '${stage}' en eval/datasets/ (excluyendo smoke y holdout).`,
    );
  }

  const devLoaded = loadDatasets(devPaths, { stages: [stage] }, undefined, rawCache);
  const dev = devLoaded.filter((d) => d.cases.length > 0);
  if (explicitDatasets.length > 0) {
    const empty = devLoaded.filter((d) => d.cases.length === 0).map((d) => d.name);
    if (empty.length > 0) {
      throw new Error(
        `Los siguientes datasets de --dataset no tienen casos de la etapa '${stage}': ${empty.join(", ")}.`,
      );
    }
  }
  if (dev.length === 0) {
    throw new Error(`Ninguno de los datasets cargados contiene casos de la etapa '${stage}'.`);
  }

  let holdout: Dataset[] = [];
  if (holdoutPaths.length > 0) {
    const holdoutLoaded = loadDatasets(holdoutPaths, { stages: [stage] }, undefined, rawCache);
    const emptyHoldout = holdoutLoaded.filter((d) => d.cases.length === 0).map((d) => d.name);
    if (emptyHoldout.length > 0) {
      throw new Error(
        `Los siguientes datasets de --holdout no tienen casos de la etapa '${stage}': ${emptyHoldout.join(", ")}.`,
      );
    }
    holdout = holdoutLoaded;
  }

  const devHashes: Record<string, string> = {};
  const devCasesHashes: Record<string, string> = {};
  for (const ds of dev) {
    devHashes[ds.name] = ds.hash;
    devCasesHashes[ds.name] = objectHash(ds.cases.map((c) => c.id).sort());
  }

  return { dev, holdout, devHashes, devCasesHashes };
}

/** True si el archivo pertenece al directorio aislado de variantes generadas para `stage`. */
export function isAutoVariantPathForStage(filePath: string, stage: StageName, variantsRoot = VARIANTS_DIR): boolean {
  const rel = relative(resolve(variantsRoot), resolve(filePath)).replace(/\\/g, "/");
  return rel.startsWith(`_auto/${stage}/`) && !rel.includes("/descartadas/");
}

function belongsToOtherAutoStage(filePath: string, stage: StageName, variantsRoot = VARIANTS_DIR): boolean {
  const rel = relative(resolve(variantsRoot), resolve(filePath)).replace(/\\/g, "/");
  if (!rel.startsWith("_auto/")) return false;
  return !rel.startsWith(`_auto/${stage}/`);
}

/**
 * Descubre todas las variantes activas en `variantsRoot` que definen el prompt de `stage`
 * (excluyendo `prod`, `descartadas/`, `_archivo_*` y `_auto/<otra_etapa>/`).
 */
export async function discoverStageVariants(stage: StageName, variantsRoot = VARIANTS_DIR): Promise<DiscoveredVariant[]> {
  const contract = getStageContract(stage);
  const files = listActiveVariantFiles(variantsRoot);
  const discovered: DiscoveredVariant[] = [];

  for (const filePath of files) {
    const name = basename(filePath, ".ts");
    if (name === "prod") continue;
    if (belongsToOtherAutoStage(filePath, stage, variantsRoot)) continue;

    // Filtro rápido por texto antes de importar dinámicamente módulos de otras etapas.
    const raw = readFileSync(filePath, "utf8");
    if (!raw.includes(contract.promptKey)) continue;

    try {
      const { variant, hash } = loadVariantSpecEphemeral(name, filePath, variantsRoot);
      const groupObj = variant.prompts?.[contract.promptGroup] as Record<string, unknown> | undefined;
      if (!groupObj || !(contract.promptKey in groupObj) || groupObj[contract.promptKey] === undefined) {
        continue;
      }
      discovered.push({
        name,
        path: resolve(filePath),
        hash,
        isAuto: isAutoVariantPathForStage(filePath, stage, variantsRoot),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[eval/auto] Variante '${name}' (${filePath}) omitida por error de carga: ${msg}`);
    }
  }

  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}
