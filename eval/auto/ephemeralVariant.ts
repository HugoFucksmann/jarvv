/**
 * eval/auto/ephemeralVariant.ts
 *
 * Cargador efímero de variantes `.ts` vía `esbuild.transformSync` (TS -> CJS) + `node:vm`,
 * evitando `await import(file://...)` en `eval/auto` para no poblar la caché ESM (`ModuleMap`) de V8.
 */

import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { requireVariantFile, VARIANTS_DIR } from "../core/variants/load.ts";
import type { Variant } from "../core/variants/types.ts";

export type SpecifierValidator = (specifier: string, targetFilePath: string) => string | null;

/**
 * Evalúa código CJS compilado dentro de un contexto `node:vm` efímero con `require` opcionalmente
 * restringido, devolviendo `exports.default ?? exports` sin registrar el módulo en el `ModuleMap` ESM de V8.
 */
export function evaluateCjsVariantModule(
  cjsCode: string,
  filePath: string,
  validateSpecifier?: SpecifierValidator,
): unknown {
  const absPath = resolve(filePath);
  const hostRequire = createRequire(absPath);
  const safeRequire = validateSpecifier
    ? (specifier: string): unknown => {
        const err = validateSpecifier(specifier, absPath);
        if (err) throw new Error(err);
        return hostRequire(specifier);
      }
    : (specifier: string): unknown => hostRequire(specifier);

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  vm.runInNewContext(
    cjsCode,
    {
      module: mod,
      exports: mod.exports,
      require: safeRequire,
    },
    { filename: absPath, timeout: 2000 },
  );
  return mod.exports.default ?? mod.exports;
}

/**
 * Carga una variante `.ts` y su sha256 (16 hex) de forma efímera (CJS en `node:vm`) sin usar dynamic `import()`.
 * Lanza si el archivo no existe, no compila o `export default.name !== spec`.
 */
export function loadVariantSpecEphemeral(
  spec: string,
  resolvedPath?: string,
  variantsRoot = VARIANTS_DIR,
): { variant: Variant; hash: string; filePath: string } {
  const filePath = resolvedPath ? resolve(resolvedPath) : requireVariantFile(spec, variantsRoot);
  const code = readFileSync(filePath, "utf8");
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  const cjsCode = transformSync(code, {
    loader: "ts",
    format: "cjs",
    sourcefile: filePath,
  }).code;

  const loaded = evaluateCjsVariantModule(cjsCode, filePath);
  if (!loaded || typeof loaded !== "object" || (loaded as Record<string, unknown>).name !== spec) {
    throw new Error(`Variante '${spec}': el export default debe ser un objeto con name="${spec}".`);
  }

  return { variant: loaded as Variant, hash, filePath };
}
