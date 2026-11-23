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
import { VARIANT_MODES, type Variant, type VariantMode } from "./types.ts";

/** Directorio por defecto donde viven las variantes (relativo al CWD). */
export const VARIANTS_DIR = "eval/variants";

/** Caché del escaneo del directorio por ruta absoluta de raíz de variantes. */
const variantScanCache = new Map<string, { active: string[]; all: string[] }>();

/** Invalida el caché de escaneo de variantes (total o para una raíz puntual). */
export function invalidateVariantCache(variantsRoot?: string): void {
  if (variantsRoot === undefined) {
    variantScanCache.clear();
  } else {
    variantScanCache.delete(resolve(variantsRoot));
  }
}

/** Carpetas de archivo o descarte que se excluyen del listado automático de variantes activas. */
function isArchivedVariantDir(dirName: string): boolean {
  return dirName === "descartadas" || dirName.startsWith("_archivo_");
}

/** Busca recursivamente todos los archivos .ts bajo un directorio, en orden estable. */
function scanVariantFiles(dir: string, includeArchived = true): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!includeArchived && isArchivedVariantDir(entry.name)) continue;
        results.push(...scanVariantFiles(fullPath, includeArchived));
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Si no existe el directorio, devuelve array vacío
  }
  return results.sort();
}

function getScan(variantsRoot = VARIANTS_DIR): { active: string[]; all: string[] } {
  const key = resolve(variantsRoot);
  let entry = variantScanCache.get(key);
  if (!entry) {
    entry = {
      active: scanVariantFiles(variantsRoot, false),
      all: scanVariantFiles(variantsRoot, true),
    };
    variantScanCache.set(key, entry);
  }
  return entry;
}

/** Rutas `.ts` de variantes activas bajo `variantsRoot` (excluye `descartadas/` y `_archivo_*`). */
export function listActiveVariantFiles(variantsRoot = VARIANTS_DIR): string[] {
  return [...getScan(variantsRoot).active];
}

/** Archivos de `variantsRoot` (raíz y subcarpetas) cuyo nombre sin extensión es `name`. */
function variantMatches(name: string, variantsRoot = VARIANTS_DIR): string[] {
  return getScan(variantsRoot).all.filter((f) => basename(f, ".ts") === name);
}

/** Resuelve y valida en un único recorrido el archivo de una variante. */
function resolveUniqueVariantFile(name: string, variantsRoot = VARIANTS_DIR): string {
  const matches = variantMatches(name, variantsRoot);
  if (matches.length > 1) {
    throw new Error(`Variante '${name}' ambigua: el nombre está en ${matches.length} archivos (${matches.join(", ")}). Los nombres deben ser únicos.`);
  }
  const path = resolve(matches[0] ?? `${variantsRoot}/${name}.ts`);
  if (!existsSync(path)) throw new Error(`Variante '${name}' no encontrada (${path}).`);
  return path;
}

/** Hash del contenido del archivo de variante (`variantHash` en `RunMeta`). */
export function variantFileHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex").slice(0, 16);
}

/** Nombres de las variantes disponibles (archivos `.ts` activos en variantsRoot y subcarpetas, sin `descartadas/` ni `_archivo_*`), sin repetidos y ordenados. */
export function listVariantNames(variantsRoot = VARIANTS_DIR): string[] {
  return [...new Set(listActiveVariantFiles(variantsRoot).map((f) => basename(f, ".ts")))].sort();
}

/** Lanza con un mensaje de error de configuración si el archivo no existe o el nombre está en más de un archivo. */
export function requireVariantFile(name: string, variantsRoot = VARIANTS_DIR): string {
  return resolveUniqueVariantFile(name, variantsRoot);
}

/** Valida el export de un archivo de variante: `name` igual al del archivo y `mode` declarado. */
export function parseVariantExport(name: string, exported: unknown): Variant {
  if (!exported || typeof exported !== "object" || (exported as Record<string, unknown>).name !== name) {
    throw new Error(`Variante '${name}': el export default debe ser un objeto con name="${name}".`);
  }
  const mode = (exported as Record<string, unknown>).mode;
  if (!VARIANT_MODES.includes(mode as VariantMode)) {
    throw new Error(`Variante '${name}': falta \`mode\` o no es válido (recibido: ${JSON.stringify(mode)}; válidos: ${VARIANT_MODES.join(", ")}).`);
  }
  return exported as Variant;
}

async function importVariantFromPath(name: string, path: string): Promise<Variant> {
  // En Windows `import("E:\\...")` falla: el loader ESM toma "E:" como esquema de URL. `pathToFileURL` produce un file:// válido.
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown; [k: string]: unknown };
  return parseVariantExport(name, mod.default ?? mod);
}

/** Carga una variante desde su archivo mediante dynamic import. Lanza si no existe o `name` no coincide con el archivo. */
export async function loadVariant(name: string, variantsRoot = VARIANTS_DIR): Promise<Variant> {
  return importVariantFromPath(name, resolveUniqueVariantFile(name, variantsRoot));
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

/** Carga una variante y su hash sin recorrer `variantsRoot` múltiples veces. */
export async function loadVariantSpec(
  spec: string,
  resolvedPath?: string,
  variantsRoot = VARIANTS_DIR,
): Promise<{ variant: Variant; hash: string }> {
  const path = resolvedPath ? resolve(resolvedPath) : resolveUniqueVariantFile(spec, variantsRoot);
  const variant = await importVariantFromPath(spec, path);
  return { variant, hash: variantFileHash(path) };
}