/**
 * eval/core/variants/load.ts
 *
 * Carga variantes desde archivos `.ts` bajo `eval/variants/` (raíz o subcarpetas).
 * - `name` del export default debe coincidir con el nombre del archivo (sin `.ts`).
 * - El nombre es único en todo `eval/variants/`: si dos subcarpetas tienen el mismo nombre, cargarlo es un error.
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

/** Busca recursivamente todos los archivos .ts bajo un directorio, en orden estable. */
function findVariantFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        results.push(...findVariantFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Si no existe el directorio, devuelve array vacío
  }
  return results.sort();
}

/** Archivos de `eval/variants` (raíz y subcarpetas) cuyo nombre sin extensión es `name`. */
function variantMatches(name: string): string[] {
  return findVariantFiles(VARIANTS_DIR).filter((f) => basename(f, ".ts") === name);
}

/** Hash del contenido del archivo de variante (`variantHash` en `RunMeta`). */
export function variantFileHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex").slice(0, 16);
}

/** Ruta del archivo de una variante dado su nombre (raíz o subcarpetas de eval/variants). Si no existe, la ruta esperada en la raíz. */
export function variantFilePath(name: string): string {
  const [first] = variantMatches(name);
  return resolve(first ?? `${VARIANTS_DIR}/${name}.ts`);
}

/** Nombres de las variantes disponibles (archivos `.ts` en eval/variants y subcarpetas), sin repetidos y ordenados. */
export function listVariantNames(): string[] {
  return [...new Set(findVariantFiles(VARIANTS_DIR).map((f) => basename(f, ".ts")))].sort();
}

/** Lanza con un mensaje de error de configuración si el archivo no existe o el nombre está en más de un archivo. */
export function requireVariantFile(name: string): string {
  const matches = variantMatches(name);
  if (matches.length > 1) {
    throw new Error(`Variante '${name}' ambigua: el nombre está en ${matches.length} archivos (${matches.join(", ")}). Los nombres deben ser únicos.`);
  }
  const path = variantFilePath(name);
  if (!existsSync(path)) throw new Error(`Variante '${name}' no encontrada (${path}).`);
  return path;
}

/** Carga una variante desde su archivo mediante dynamic import. Lanza si no existe o `name` no coincide con el archivo. */
export async function loadVariant(name: string): Promise<Variant> {
  const path = requireVariantFile(name);
  // En Windows `import("E:\\...")` falla: el loader ESM toma "E:" como esquema de URL. `pathToFileURL` produce un file:// válido.
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown;[k: string]: unknown };
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