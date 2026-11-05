/**
 * eval/core/variants/load.ts
 *
 * Carga variantes desde archivos `variants/<nombre>.ts` (sección 5.3).
 * - `name` del export default debe coincidir con el nombre del archivo.
 * - Hash de variante: sha256 (16 hex) del contenido del archivo.
 * - `prod.ts` es un archivo físico que exporta `{ name: "prod" }`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Variant } from "./types.ts";

/** Directorio donde viven las variantes (relativo al CWD). */
const VARIANTS_DIR = "eval/variants";

/**
 * Calcula el hash del contenido del archivo de variante.
 * Se usa para `variantHash` en `RunMeta`.
 */
export function variantFileHash(filePath: string): string {
  const content = readFileSync(filePath, "utf8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Hash combinado de varios archivos (para cadenas de variantes). */
export function combinedVariantHash(filePaths: string[]): string {
  const hash = createHash("sha256");
  for (const p of filePaths) {
    hash.update(readFileSync(p, "utf8"));
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Resuelve el nombre de un archivo de variante dado su nombre lógico.
 * Los nombres compuestos `a+b` se descomponen en sus partes antes de llamar aquí.
 */
export function variantFilePath(name: string): string {
  return resolve(`${VARIANTS_DIR}/${name}.ts`);
}

/** Nombres de las variantes disponibles (archivos `.ts` de la carpeta de variantes), ordenados. */
export function listVariantNames(): string[] {
  try {
    return readdirSync(VARIANTS_DIR).filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

/** Lanza con un mensaje de error de configuración si el archivo no existe. */
export function requireVariantFile(name: string): string {
  const path = variantFilePath(name);
  if (!existsSync(path)) {
    throw new Error(`Variante '${name}' no encontrada (${path}).`);
  }
  return path;
}

/**
 * Carga una variante desde su archivo mediante dynamic import.
 * Lanza si el archivo no existe o `name` no coincide con el del archivo.
 */
export async function loadVariant(name: string): Promise<Variant> {
  const path = requireVariantFile(name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // En Windows `import("E:\\...")` falla: el loader ESM toma "E:" como esquema de URL.
  // `pathToFileURL` produce un file:// válido en Windows y Linux.
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown;[k: string]: unknown };
  const v = mod.default ?? mod;
  if (!v || typeof v !== "object" || (v as Record<string, unknown>).name !== name) {
    throw new Error(
      `Variante '${name}': el export default debe ser un objeto con name="${name}".`,
    );
  }
  return v as Variant;
}

/**
 * Parsea la especificación de variantes del flag `--variant`.
 * Cada elemento separado por coma es independiente; `x+y` compone en orden.
 * Agrega `prod` si no está presente, salvo con `withBaseline = false` (`--no-baseline`).
 */
export function parseVariantSpecs(raw: string, withBaseline = true): string[] {
  const parts = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  // La baseline se compara por spec exacta: `prod+x` no la reemplaza, así que se agrega igual.
  if (withBaseline && !parts.includes("prod")) parts.unshift("prod");
  return parts;
}

/**
 * Carga y compone las variantes de una especificación compuesta (`a+b` o `a`).
 * Devuelve `{ variant, chain, parts, hash }`.
 *
 * - `parts`: las variantes individuales, en orden. El request SE APLICA con
 *   `applyVariantChain(case, parts)` (semántica secuencial correcta).
 * - `variant`: vista compuesta, solo válida para leer campos de parseo/params
 *   (`labelMap`, `answerMap`, `params`). NO usarla con `applyVariant` si hay más de una parte:
 *   sus ediciones de request no son equivalentes a aplicarlas en secuencia.
 */
export async function loadVariantSpec(spec: string): Promise<{
  variant: Variant;
  chain: string[];
  parts: Variant[];
  hash: string;
}> {
  const names = spec.split("+").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Especificación de variante vacía.");

  const paths = names.map(requireVariantFile);
  const hash = combinedVariantHash(paths);

  const variants = await Promise.all(names.map(loadVariant));
  const composed = composeParseView(variants);

  return { variant: { ...composed, name: spec }, chain: names, parts: variants, hash };
}

/**
 * Vista compuesta de una cadena de variantes, SOLO con lo que el runner lee de `variant`:
 *  - `decision[stage].labelMap` / `answerMap`  (parseo en `labels.ts`)
 *  - `generative[stage].params`                 (`expandThinking` en `runner.ts`)
 *
 * Las ediciones de request (`state`, `questions`, `system`, `user`, ...) NO se componen aquí:
 * se aplican en secuencia con `applyVariantChain(case, parts)`, que es la semántica correcta.
 * En los mapas gana la última variante de la cadena.
 */
function composeParseView(variants: Variant[]): Variant {
  type DecisionMap = NonNullable<Variant["decision"]>;
  type GenerativeMap = NonNullable<Variant["generative"]>;
  const decision: DecisionMap = {};
  const generative: GenerativeMap = {};

  for (const v of variants) {
    for (const stage of Object.keys(v.decision ?? {}) as (keyof DecisionMap)[]) {
      const sv = v.decision?.[stage];
      if (!sv || (!sv.labelMap && !sv.answerMap)) continue;
      const cur = decision[stage] ?? {};
      decision[stage] = {
        ...(sv.labelMap || cur.labelMap ? { labelMap: { ...cur.labelMap, ...sv.labelMap } } : {}),
        ...(sv.answerMap || cur.answerMap ? { answerMap: { ...cur.answerMap, ...sv.answerMap } } : {}),
      };
    }
    for (const stage of Object.keys(v.generative ?? {}) as (keyof GenerativeMap)[]) {
      const sv = v.generative?.[stage];
      if (!sv?.params) continue;
      generative[stage] = { params: { ...generative[stage]?.params, ...sv.params } };
    }
  }

  return { name: variants.map((v) => v.name).join("+"), decision, generative };
}