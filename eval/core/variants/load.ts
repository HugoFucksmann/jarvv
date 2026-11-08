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
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Variant } from "./types.ts";

/** Directorio donde viven las variantes (relativo al CWD). */
const VARIANTS_DIR = "eval/variants";

/** Busca recursivamente todos los archivos .ts bajo un directorio. */
function findVariantFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        results.push(...findVariantFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Si no existe el directorio, devuelve array vacío
  }
  return results;
}

/** Hash del contenido del archivo de variante (`variantHash` en `RunMeta`). */
export function variantFileHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex").slice(0, 16);
}

/** Ruta del archivo de una variante dado su nombre. Busca directamente y en subcarpetas de eval/variants. */
export function variantFilePath(name: string): string {
  // 1. Si se especificó una ruta relativa o existe directamente en la raíz
  const directPath = resolve(`${VARIANTS_DIR}/${name}.ts`);
  if (existsSync(directPath)) return directPath;

  // 2. Búsqueda recursiva en subcarpetas
  const allFiles = findVariantFiles(VARIANTS_DIR);
  const targetFileName = `${name}.ts`;
  const match = allFiles.find((f) => f.endsWith(`/${targetFileName}`) || f.endsWith(`\\${targetFileName}`));
  if (match) return resolve(match);

  return directPath;
}

/** Nombres de las variantes disponibles (archivos `.ts` en eval/variants y subcarpetas), ordenados. */
export function listVariantNames(): string[] {
  const allFiles = findVariantFiles(VARIANTS_DIR);
  return allFiles.map((f) => basename(f, ".ts")).sort();
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
