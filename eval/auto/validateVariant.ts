/**
 * eval/auto/validateVariant.ts
 *
 * Validación previa de las variantes que arma el modo `--auto` (`patchVariant.ts`). El modelo optimizador solo escribe textos y el
 * código arma el archivo, así que acá no se analiza código ajeno: se comprueba que el archivo armado compile y cargue, que tenga la forma
 * de la etapa, que no repita una variante anterior y que cada caso del dataset se pueda materializar con ella.
 * 1. Compila con `esbuild` y evalúa en memoria (`node:vm`, `require` restringido a `src/core/**` y `eval/core/variants/types.ts`),
 *    sin tocar disco ni contaminar el registro de módulos ESM.
 * 2. Verifica la forma (`name`, y solo `prompts.<grupo>.<clave>` de la etapa) y la deduplicación por hash contra variantes previas/descartadas.
 * 3. Materializa los casos con `loadDatasets`, valida los invariantes de cada etapa (`getStage(stage).validateRequest`) y el presupuesto de
 *    contexto (`DECISION_MAX_CONTEXT` / `reserveCompletionTokens`). Solo escribe el `.ts` en disco si pasa todo.
 */

import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { DECISION_MAX_CONTEXT, estimateDecisionPromptTokens } from "../core/client/decision.ts";
import { reserveCompletionTokens } from "../core/client/generative.ts";
import { ConfigManager } from "../core/contract.ts";
import { createRawDatasetCache, loadDatasets, type RawDatasetCache } from "../core/datasets.ts";
import { getStage } from "../core/stages/index.ts";
import type { DecisionRequest, GenerativeRequest, StageName } from "../core/types.ts";
import { invalidateVariantCache, VARIANTS_DIR } from "../core/variants/load.ts";
import type { Variant } from "../core/variants/types.ts";
import { autoStageDir, winnersStageDir } from "./config.ts";
import { evaluateCjsVariantModule } from "./ephemeralVariant.ts";
import { getStageContract } from "./stageContract.ts";

export interface ValidationSuccess {
  ok: true;
  name: string;
  filePath: string;
  code: string;
  normalizedHash: string;
  variant: Variant;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

/** Hash del código ignorando el nombre de la variante y los espacios: dos variantes con los mismos textos tienen el mismo hash. */
export function normalizedVariantCodeHash(code: string, variantName?: string): string {
  const unnamed = variantName ? code.split(variantName).join("__VARIANT_NAME__") : code;
  return createHash("sha256").update(unnamed.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/** Recopila hashes normalizados de todas las variantes existentes de `stage` (activas, descartadas y ganadoras). */
export function collectKnownVariantHashes(
  stage: StageName,
  extraVariantPaths: string[] = [],
  variantsRoot = VARIANTS_DIR,
): Set<string> {
  const hashes = new Set<string>();
  const addFile = (filePath: string): void => {
    try {
      hashes.add(normalizedVariantCodeHash(readFileSync(filePath, "utf8"), basename(filePath, ".ts")));
    } catch {
      // Ignorar archivos ilegibles
    }
  };

  for (const p of extraVariantPaths) addFile(p);

  const stageDir = resolve(autoStageDir(stage, variantsRoot));
  for (const dir of [stageDir, resolve(stageDir, "descartadas"), resolve(winnersStageDir(stage, variantsRoot))]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        addFile(resolve(dir, entry.name));
      }
    }
  }
  return hashes;
}

/** Verifica si un specifier de import desde `targetFilePath` cae dentro de `src/core/` o es `eval/core/variants/types.ts`. */
function validateImportSpecifier(specifier: string, targetFilePath: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return `Import prohibido '${specifier}': solo se permiten rutas relativas hacia src/core/* o eval/core/variants/types.ts.`;
  }
  const targetDir = dirname(resolve(targetFilePath));
  const resolved = normalize(resolve(targetDir, specifier));
  const srcCoreRoot = realpathSync(resolve("src/core"));
  const variantTypesPath = realpathSync(resolve("eval/core/variants/types.ts"));

  const isPathAllowed = (candidate: string): boolean =>
    candidate.startsWith(`${srcCoreRoot}/`) ||
    candidate.startsWith(`${srcCoreRoot}\\`) ||
    candidate === variantTypesPath;

  if (existsSync(resolved)) {
    const realResolved = realpathSync(resolved);
    if (!isPathAllowed(realResolved)) {
      return `Import fuera de allowlist '${specifier}' (resuelve a '${realResolved}'): solo se permite src/core/* y eval/core/variants/types.ts.`;
    }
    return null;
  }

  const parentDir = dirname(resolved);
  const candidateForMissingCheck = existsSync(parentDir)
    ? join(realpathSync(parentDir), basename(resolved))
    : resolved;

  if (!isPathAllowed(candidateForMissingCheck)) {
    return `Import fuera de allowlist '${specifier}' (resuelve a '${candidateForMissingCheck}'): solo se permite src/core/* y eval/core/variants/types.ts.`;
  }
  return `Import inexistente '${specifier}' (no existe '${resolved}'). Verificá los niveles '../' desde eval/variants/_auto/<stage>/.`;
}

/** Compila el TypeScript del archivo a CommonJS. Un error de sintaxis se devuelve como texto. */
function compileToCjs(code: string, filePath: string): { cjs: string } | { error: string } {
  try {
    return { cjs: transformSync(code, { loader: "ts", format: "cjs", sourcefile: filePath }).code };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Error de sintaxis TypeScript: ${msg.split("\n").slice(0, 4).join(" | ")}` };
  }
}

function validateRuntimeVariantShape(variant: unknown, variantName: string, stage: StageName): string | null {
  if (!variant || typeof variant !== "object") {
    return "El export default debe ser un objeto Variant.";
  }
  const v = variant as Record<string, unknown>;
  if (v.name !== variantName) {
    return `Variant.name ('${String(v.name)}') no coincide con '${variantName}'.`;
  }
  if (("params" in v && v.params !== undefined) || ("read" in v && v.read !== undefined)) {
    return "Una variante generada solo puede definir `name` y `prompts` (no `params` ni `read`).";
  }
  const contract = getStageContract(stage);
  const prompts = v.prompts as Record<string, unknown> | undefined;
  if (!prompts || typeof prompts !== "object") {
    return `Variant.prompts es obligatorio y debe definir ${contract.promptGroup}.${contract.promptKey}.`;
  }
  const groupKeys = Object.keys(prompts);
  if (groupKeys.length !== 1 || groupKeys[0] !== contract.promptGroup) {
    return `Variant.prompts solo puede definir '${contract.promptGroup}' (recibido: ${groupKeys.join(", ") || "ninguno"}).`;
  }
  const group = prompts[contract.promptGroup] as Record<string, unknown> | undefined;
  if (!group || typeof group !== "object") {
    return `Variant.prompts.${contract.promptGroup} debe ser un objeto.`;
  }
  const stageKeys = Object.keys(group);
  if (stageKeys.length !== 1 || stageKeys[0] !== contract.promptKey || group[contract.promptKey] === undefined) {
    return `Variant.prompts.${contract.promptGroup} solo puede definir '${contract.promptKey}' (recibido: ${stageKeys.join(", ") || "ninguno"}).`;
  }
  if (contract.promptGroup === "DECISION_PROMPTS" && typeof group[contract.promptKey] !== "function") {
    return `Variant.prompts.DECISION_PROMPTS.${contract.promptKey} debe ser una función.`;
  }
  if (contract.promptGroup === "PROMPTS") {
    const view = group[contract.promptKey] as Record<string, unknown>;
    if (!view || typeof view !== "object" || typeof view.SYSTEM !== "string" || typeof view.buildUserPrompt !== "function") {
      return `Variant.prompts.PROMPTS.${contract.promptKey} debe incluir SYSTEM (string) y buildUserPrompt (función).`;
    }
  }
  return null;
}

function validateStageRequestsAndContext(
  stage: StageName,
  devPaths: string[],
  variant: Variant,
  rawCache: RawDatasetCache,
): string | null {
  const datasets = loadDatasets(devPaths, { stages: [stage] }, variant, rawCache);
  const numCtx = ConfigManager.getConfig().qwenNumCtx;
  const stageEntry = getStage(stage);
  const overflowCases: string[] = [];

  for (const ds of datasets) {
    for (const fc of ds.cases) {
      if (fc.request.type === "decision") {
        const req: DecisionRequest = fc.request;
        if (!req.state || !req.state.trim()) {
          return `Caso '${ds.name}/${fc.id}': DecisionRequest.state quedó vacío.`;
        }
        if (Object.keys(req.questions ?? {}).length === 0) {
          return `Caso '${ds.name}/${fc.id}': DecisionRequest.questions quedó vacío.`;
        }
        if (stageEntry.requestType === "decision" && stageEntry.validateRequest) {
          const err = stageEntry.validateRequest(req, fc);
          if (err) return `Caso '${ds.name}/${fc.id}': ${err}`;
        }
        if (!fc.isRaw) {
          const est = estimateDecisionPromptTokens(req);
          if (est > DECISION_MAX_CONTEXT) {
            overflowCases.push(`${fc.id}(${est}>${DECISION_MAX_CONTEXT})`);
          }
        }
      } else {
        const req: GenerativeRequest = fc.request;
        if (!req.system || !req.system.trim()) {
          return `Caso '${ds.name}/${fc.id}': GenerativeRequest.system quedó vacío.`;
        }
        if (!req.user || !req.user.trim()) {
          return `Caso '${ds.name}/${fc.id}': GenerativeRequest.user quedó vacío.`;
        }
        if (stageEntry.requestType === "generative" && stageEntry.validateRequest) {
          const err = stageEntry.validateRequest(req, fc);
          if (err) return `Caso '${ds.name}/${fc.id}': ${err}`;
        }
        if (!fc.isRaw && reserveCompletionTokens(req, numCtx) === null) {
          overflowCases.push(`${fc.id}(sin margen en qwenNumCtx=${numCtx})`);
        }
      }
    }
  }

  if (overflowCases.length > 0) {
    return `Exceso de contexto en ${overflowCases.length} caso(s): ${overflowCases.slice(0, 4).join(", ")}. Acortá el prompt.`;
  }

  return null;
}

/**
 * Compila, evalúa en memoria, verifica forma, duplicado y materialización de los casos, y solo escribe
 * `<variantsRoot>/_auto/<stage>/<variantName>.ts` si pasa todo.
 */
export async function validateAndWriteVariant(opts: {
  stage: StageName;
  variantName: string;
  rawCode: string;
  devDatasetPaths: string[];
  knownHashes: Set<string>;
  variantsRoot?: string;
  rawCache?: RawDatasetCache;
}): Promise<ValidationSuccess | ValidationFailure> {
  const { stage, variantName, rawCode, devDatasetPaths, knownHashes, variantsRoot } = opts;

  if (!rawCode || !rawCode.trim()) {
    return { ok: false, error: "El código de la variante está vacío." };
  }

  const stageDir = resolve(autoStageDir(stage, variantsRoot));
  const filePath = resolve(stageDir, `${variantName}.ts`);
  const code = `${rawCode.trim()}\n`;

  const compiled = compileToCjs(code, filePath);
  if ("error" in compiled) return { ok: false, error: compiled.error };

  const normalizedHash = normalizedVariantCodeHash(code, variantName);
  if (knownHashes.has(normalizedHash)) {
    return {
      ok: false,
      error: `Variante duplicada (hash ${normalizedHash}): ya existe otra variante idéntica en esta etapa o en esta misma vuelta.`,
    };
  }

  try {
    const loaded = evaluateCjsVariantModule(compiled.cjs, filePath, validateImportSpecifier);

    const shapeErr = validateRuntimeVariantShape(loaded, variantName, stage);
    if (shapeErr) return { ok: false, error: shapeErr };

    const variant = loaded as Variant;
    const reqErr = validateStageRequestsAndContext(stage, devDatasetPaths, variant, opts.rawCache ?? createRawDatasetCache());
    if (reqErr) return { ok: false, error: reqErr };

    mkdirSync(stageDir, { recursive: true });
    writeFileSync(filePath, code, "utf8");
    invalidateVariantCache(variantsRoot);

    return { ok: true, name: variantName, filePath, code, normalizedHash, variant };
  } catch (e) {
    return {
      ok: false,
      error: `Error cargando o materializando la variante '${variantName}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
