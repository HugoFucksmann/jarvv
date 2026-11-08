/**
 * eval/core/variants/load.ts
 *
 * Carga variantes desde archivos `variants/<nombre>.ts`.
 * - `name` del export default debe coincidir con el nombre del archivo.
 * - Hash de variante: sha256 (16 hex) del contenido del archivo.
 * - `prod.ts` es la variante de producción: apunta a los prompts de `src`, sin cambios.
 * - Una variante es un solo archivo con prompts enteros: no se componen (`a+b` no existe).
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Variant } from "./types.ts";

/** Directorio donde viven las variantes (relativo al CWD). */
const VARIANTS_DIR = "eval/variants";

/** Hash del contenido del archivo de variante (`variantHash` en `RunMeta`). */
export function variantFileHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex").slice(0, 16);
}

/** Ruta del archivo de una variante dado su nombre. */
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
  if (!existsSync(path)) throw new Error(`Variante '${name}' no encontrada (${path}).`);
  return path;
}

/** Carga una variante desde su archivo mediante dynamic import. Lanza si no existe o `name` no coincide con el archivo. */
export async function loadVariant(name: string): Promise<Variant> {
  const path = requireVariantFile(name);
  // En Windows `import("E:\\...")` falla: el loader ESM toma "E:" como esquema de URL. `pathToFileURL` produce un file:// válido.
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown; [k: string]: unknown };
  const v = mod.default ?? mod;
  if (!v || typeof v !== "object" || (v as Record<string, unknown>).name !== name) {
    throw new Error(`Variante '${name}': el export default debe ser un objeto con name="${name}".`);
  }
  return v as Variant;
}

/**
 * Parsea `--variant`: nombres separados por coma. Agrega `prod` si no está, salvo con `withBaseline = false` (`--no-baseline`).
 * Una variante con `+` era una composición de varias: ya no existe, y se avisa en vez de buscar un archivo que no está.
 */
export function parseVariantSpecs(raw: string, withBaseline = true): string[] {
  const parts = Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
  const composed = parts.find((p) => p.includes("+"));
  if (composed) {
    throw new Error(`--variant: '${composed}' compone variantes con '+', y eso ya no existe: cada variante es un archivo con prompts enteros.`);
  }
  if (withBaseline && !parts.includes("prod")) parts.unshift("prod");
  return parts;
}

/** Carga una variante y su hash. */
export async function loadVariantSpec(spec: string): Promise<{ variant: Variant; hash: string }> {
  const variant = await loadVariant(spec);
  return { variant, hash: variantFileHash(requireVariantFile(spec)) };
}
