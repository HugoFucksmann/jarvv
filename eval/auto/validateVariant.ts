/**
 * eval/auto/validateVariant.ts
 *
 * Validación previa de variantes TypeScript generadas por el optimizador (`§2.4`, `§5.3`, `§9`):
 * 1. Normaliza/inyecta `name` exacto en el export default mediante tokens léxicos oficiales de TS 7.
 * 2. Valida sintaxis TypeScript con `esbuild.transformSync` y prohíbe imports fuera de `src/core/**` y `eval/core/variants/types.ts`.
 * 3. Prohíbe APIs inseguras (`eval`, `Function`, `require`, `import()`, `process`, `fetch`, etc.) y las propiedades `params` y `read`.
 * 4. Verifica deduplicación por hash normalizado de código/prompt contra variantes previas/descartadas.
 * 5. Evalúa en memoria (`node:vm`) sin tocar disco ni contaminar ESM, valida forma runtime y los invariantes
 *    de cada etapa vía `getStage(stage).validateRequest`, materializa casos con `loadDatasets` y chequea presupuesto
 *    de contexto (`DECISION_MAX_CONTEXT` / `reserveCompletionTokens`). Solo escribe el `.ts` en disco si pasa todo.
 */

import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, normalize, resolve } from "node:path";
import vm from "node:vm";
import { DECISION_MAX_CONTEXT, estimateDecisionPromptTokens } from "../core/client/decision.ts";
import { reserveCompletionTokens } from "../core/client/generative.ts";
import { ConfigManager, PROMPTS_MODULE_EXPORTS } from "../core/contract.ts";
import { createRawDatasetCache, loadDatasets, type RawDatasetCache } from "../core/datasets.ts";
import { getStage } from "../core/stages/index.ts";
import type { DecisionRequest, GenerativeRequest, StageName } from "../core/types.ts";
import { invalidateVariantCache, VARIANTS_DIR } from "../core/variants/load.ts";
import type { Variant } from "../core/variants/types.ts";
import { autoStageDir } from "./config.ts";
import { getStageContract } from "./stageContract.ts";
import { findMatchingBraceToken, SyntaxKind, tokenizeTs, type TsToken } from "./tsScanner.ts";

const BANNED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "require",
  "process",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "globalThis",
  "Bun",
  "Deno",
]);

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

export type ValidationResult = ValidationSuccess | ValidationFailure;

/** Hash normalizado del código fuente ignorando comentarios, espacios y el nombre de la variante. */
export function normalizedVariantCodeHash(code: string, variantName?: string): string {
  const tokens = tokenizeTs(code);
  const normalizedTokens = tokens.map((t) => {
    if (!variantName) return t.text;
    if (t.kind === SyntaxKind.Identifier && t.text === variantName) {
      return "__VARIANT_NAME__";
    }
    if (
      (t.kind === SyntaxKind.StringLiteral || t.kind === SyntaxKind.NoSubstitutionTemplateLiteral) &&
      t.text.slice(1, -1) === variantName
    ) {
      return JSON.stringify("__VARIANT_NAME__");
    }
    return t.text;
  });
  return createHash("sha256").update(normalizedTokens.join(" ")).digest("hex").slice(0, 16);
}

/** Recopila hashes normalizados de todas las variantes existentes de `stage` (activas + descartadas). */
export function collectKnownVariantHashes(
  stage: StageName,
  extraVariantPaths: string[] = [],
  variantsRoot = VARIANTS_DIR,
): Set<string> {
  const hashes = new Set<string>();
  const addFile = (filePath: string): void => {
    try {
      const code = readFileSync(filePath, "utf8");
      hashes.add(normalizedVariantCodeHash(code, basename(filePath, ".ts")));
    } catch {
      // Ignorar archivos ilegibles
    }
  };

  for (const p of extraVariantPaths) addFile(p);

  const stageDir = resolve(autoStageDir(stage, variantsRoot));
  for (const dir of [stageDir, resolve(stageDir, "descartadas")]) {
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

interface ObjectEntry {
  kind: "prop" | "method" | "shorthand" | "spread" | "computed";
  key?: string;
  keyStart: number;
  keyEnd: number;
  valueTokIdx?: number;
  valueStart?: number;
  valueEnd?: number;
}

function unquoteToken(t: TsToken): string {
  if (t.kind === SyntaxKind.StringLiteral || t.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return t.text.slice(1, -1);
  }
  return t.text;
}

function isPropertyKeyToken(t: TsToken): boolean {
  return (
    t.kind === SyntaxKind.Identifier ||
    t.kind === SyntaxKind.StringLiteral ||
    t.kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    t.kind === SyntaxKind.DefaultKeyword ||
    t.kind === SyntaxKind.TypeKeyword
  );
}

function parseTopLevelObjectEntries(tokens: readonly TsToken[], openBraceTokIdx: number): ObjectEntry[] {
  const closeTokIdx = findMatchingBraceToken(tokens, openBraceTokIdx);
  if (closeTokIdx === -1) return [];

  const entries: ObjectEntry[] = [];
  let i = openBraceTokIdx + 1;

  const advanceToCommaOrEnd = (startIdx: number): number => {
    let idx = startIdx;
    let brace = 0;
    let paren = 0;
    let bracket = 0;
    while (idx < closeTokIdx) {
      const k = tokens[idx].kind;
      if (k === SyntaxKind.OpenBraceToken) brace++;
      else if (k === SyntaxKind.CloseBraceToken) brace--;
      else if (k === SyntaxKind.OpenParenToken) paren++;
      else if (k === SyntaxKind.CloseParenToken) paren--;
      else if (k === SyntaxKind.OpenBracketToken) bracket++;
      else if (k === SyntaxKind.CloseBracketToken) bracket--;
      else if (k === SyntaxKind.CommaToken && brace === 0 && paren === 0 && bracket === 0) break;
      idx++;
    }
    return idx;
  };

  while (i < closeTokIdx) {
    const t = tokens[i];
    if (t.kind === SyntaxKind.CommaToken) {
      i++;
      continue;
    }

    if (t.kind === SyntaxKind.DotDotDotToken) {
      const end = advanceToCommaOrEnd(i);
      entries.push({ kind: "spread", keyStart: t.start, keyEnd: tokens[end - 1].end });
      i = end;
      continue;
    }

    if (t.kind === SyntaxKind.OpenBracketToken) {
      const end = advanceToCommaOrEnd(i);
      entries.push({ kind: "computed", keyStart: t.start, keyEnd: tokens[end - 1].end });
      i = end;
      continue;
    }

    if (!isPropertyKeyToken(t)) break;
    const key = unquoteToken(t);
    const keyStart = t.start;
    const keyEnd = t.end;
    const next = tokens[i + 1];

    if (next && next.kind === SyntaxKind.OpenParenToken && i + 1 < closeTokIdx) {
      // Method declaration foo(...) { ... }
      let idx = i + 1;
      let pDepth = 0;
      for (; idx < closeTokIdx; idx++) {
        if (tokens[idx].kind === SyntaxKind.OpenParenToken) pDepth++;
        else if (tokens[idx].kind === SyntaxKind.CloseParenToken) {
          pDepth--;
          if (pDepth === 0) break;
        }
      }
      // Buscar el `{` del cuerpo del método y cerrarlo
      let bIdx = idx + 1;
      while (bIdx < closeTokIdx && tokens[bIdx].kind !== SyntaxKind.OpenBraceToken) bIdx++;
      if (bIdx < closeTokIdx && tokens[bIdx].kind === SyntaxKind.OpenBraceToken) {
        const bClose = findMatchingBraceToken(tokens, bIdx);
        i = bClose !== -1 && bClose < closeTokIdx ? bClose + 1 : closeTokIdx;
      } else {
        i = closeTokIdx;
      }
      entries.push({ kind: "method", key, keyStart, keyEnd });
      continue;
    }

    if (!next || next.kind === SyntaxKind.CommaToken || i + 1 >= closeTokIdx) {
      entries.push({ kind: "shorthand", key, keyStart, keyEnd });
      i++;
      continue;
    }

    if (next.kind !== SyntaxKind.ColonToken) break;

    const valueTokIdx = i + 2;
    const endIdx = advanceToCommaOrEnd(valueTokIdx);
    const valueLastTok = tokens[Math.max(valueTokIdx, endIdx - 1)];
    entries.push({
      kind: "prop",
      key,
      keyStart,
      keyEnd,
      valueTokIdx,
      valueStart: tokens[valueTokIdx]?.start,
      valueEnd: valueLastTok?.end,
    });
    i = endIdx;
  }

  return entries;
}

function skipLeadingParens(tokens: readonly TsToken[], idx: number): number {
  let p = idx;
  while (p < tokens.length && tokens[p].kind === SyntaxKind.OpenParenToken) p++;
  return p;
}

function findExportedVariantObjectBrace(tokens: readonly TsToken[]): number {
  let braceDepth = 0;
  let expDefaultIdx = -1;

  for (let i = 0; i + 1 < tokens.length; i++) {
    const k = tokens[i].kind;
    if (k === SyntaxKind.OpenBraceToken) braceDepth++;
    else if (k === SyntaxKind.CloseBraceToken) braceDepth = Math.max(0, braceDepth - 1);
    else if (braceDepth === 0 && k === SyntaxKind.ExportKeyword && tokens[i + 1].kind === SyntaxKind.DefaultKeyword) {
      expDefaultIdx = i;
      break;
    }
  }
  if (expDefaultIdx === -1) return -1;

  const rhsStart = skipLeadingParens(tokens, expDefaultIdx + 2);
  if (tokens[rhsStart]?.kind === SyntaxKind.OpenBraceToken) {
    return rhsStart;
  }
  if (tokens[rhsStart]?.kind !== SyntaxKind.Identifier) return -1;
  const varName = tokens[rhsStart].text;

  // Buscar `const|let|var <varName> [: Type] = (`*` {` a nivel superior
  let depth = 0;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const k = tokens[i].kind;
    if (k === SyntaxKind.OpenBraceToken) {
      depth++;
      continue;
    }
    if (k === SyntaxKind.CloseBraceToken) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;

    if (
      (k === SyntaxKind.ConstKeyword || k === SyntaxKind.LetKeyword || k === SyntaxKind.VarKeyword) &&
      tokens[i + 1].kind === SyntaxKind.Identifier &&
      tokens[i + 1].text === varName
    ) {
      let p = i + 2;
      let angle = 0;
      let paren = 0;
      let brace = 0;
      let bracket = 0;
      let eqIdx = -1;
      while (p < tokens.length) {
        const pk = tokens[p].kind;
        if (pk === SyntaxKind.LessThanToken) angle++;
        else if (pk === SyntaxKind.GreaterThanToken) angle = Math.max(0, angle - 1);
        else if (pk === SyntaxKind.OpenParenToken) paren++;
        else if (pk === SyntaxKind.CloseParenToken) paren = Math.max(0, paren - 1);
        else if (pk === SyntaxKind.OpenBraceToken) brace++;
        else if (pk === SyntaxKind.CloseBraceToken) brace = Math.max(0, brace - 1);
        else if (pk === SyntaxKind.OpenBracketToken) bracket++;
        else if (pk === SyntaxKind.CloseBracketToken) bracket = Math.max(0, bracket - 1);
        else if (pk === SyntaxKind.EqualsToken && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
          eqIdx = p;
          break;
        } else if (pk === SyntaxKind.SemicolonToken && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
          break;
        }
        p++;
      }
      if (eqIdx !== -1) {
        const valIdx = skipLeadingParens(tokens, eqIdx + 1);
        if (tokens[valIdx]?.kind === SyntaxKind.OpenBraceToken) {
          return valIdx;
        }
      }
    }
  }

  return -1;
}

function applyNameOverride(code: string, tokens: readonly TsToken[], variantName: string): { code: string; error?: string } {
  const openBraceTokIdx = findExportedVariantObjectBrace(tokens);
  if (openBraceTokIdx === -1) {
    return { code, error: "El archivo debe tener `export default` de un objeto `Variant` (literal o variable const)." };
  }

  const entries = parseTopLevelObjectEntries(tokens, openBraceTokIdx);
  for (const entry of entries) {
    if (entry.key !== "name") continue;
    if (entry.kind === "prop" && entry.valueTokIdx !== undefined && entry.valueStart !== undefined && entry.valueEnd !== undefined) {
      const valTok = tokens[entry.valueTokIdx];
      const nextAfterVal = tokens[entry.valueTokIdx + 1];
      const isSingleString =
        (valTok?.kind === SyntaxKind.StringLiteral || valTok?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) &&
        (!nextAfterVal || nextAfterVal.kind === SyntaxKind.CommaToken || nextAfterVal.kind === SyntaxKind.CloseBraceToken);
      if (isSingleString) {
        const patched = `${code.slice(0, entry.valueStart)}${JSON.stringify(variantName)}${code.slice(entry.valueEnd)}`;
        return { code: patched };
      }
      return { code, error: "La propiedad `name` del export default debe ser un string literal." };
    }
    if (entry.kind === "shorthand") {
      const patched = `${code.slice(0, entry.keyStart)}name: ${JSON.stringify(variantName)}${code.slice(entry.keyEnd)}`;
      return { code: patched };
    }
  }

  const insertAt = tokens[openBraceTokIdx].end;
  const patched = `${code.slice(0, insertAt)}\n  name: ${JSON.stringify(variantName)},${code.slice(insertAt)}`;
  return { code: patched };
}

let cachedPromptsExportedTypes: Set<string> | null = null;
function getPromptsExportedTypes(): Set<string> {
  if (cachedPromptsExportedTypes) return cachedPromptsExportedTypes;
  const set = new Set<string>();
  try {
    const src = readFileSync(resolve("src/core/models/prompts.ts"), "utf8");
    const tokens = tokenizeTs(src);
    let braceDepth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === SyntaxKind.OpenBraceToken) {
        braceDepth++;
        continue;
      }
      if (t.kind === SyntaxKind.CloseBraceToken) {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (braceDepth !== 0 || t.kind !== SyntaxKind.ExportKeyword) continue;

      const t1 = tokens[i + 1];
      if (!t1) continue;

      if ((t1.kind === SyntaxKind.TypeKeyword || t1.kind === SyntaxKind.InterfaceKeyword) && tokens[i + 2]?.kind === SyntaxKind.Identifier) {
        set.add(tokens[i + 2].text);
        continue;
      }

      // `export type { A, B as C }` o `export { type A, B }`
      const isTypeBlock = t1.kind === SyntaxKind.TypeKeyword && tokens[i + 2]?.kind === SyntaxKind.OpenBraceToken;
      const braceIdx = isTypeBlock ? i + 2 : t1.kind === SyntaxKind.OpenBraceToken ? i + 1 : -1;
      if (braceIdx !== -1) {
        const closeIdx = findMatchingBraceToken(tokens, braceIdx);
        if (closeIdx !== -1) {
          let k = braceIdx + 1;
          while (k < closeIdx) {
            let itemIsType = isTypeBlock;
            if (tokens[k].kind === SyntaxKind.TypeKeyword) {
              itemIsType = true;
              k++;
            }
            if (k < closeIdx && tokens[k].kind === SyntaxKind.Identifier) {
              let exportedName = tokens[k].text;
              k++;
              if (k + 1 < closeIdx && tokens[k].kind === SyntaxKind.AsKeyword && tokens[k + 1].kind === SyntaxKind.Identifier) {
                exportedName = tokens[k + 1].text;
                k += 2;
              }
              if (itemIsType) set.add(exportedName);
            }
            while (k < closeIdx && tokens[k].kind !== SyntaxKind.CommaToken) k++;
            if (tokens[k]?.kind === SyntaxKind.CommaToken) k++;
          }
          i = closeIdx;
        }
      }
    }
  } catch {
    // fallback vacío
  }
  cachedPromptsExportedTypes = set;
  return set;
}

function isFromKeywordToken(t: TsToken | undefined): boolean {
  return Boolean(t && (t.kind === SyntaxKind.FromKeyword || (t.kind === SyntaxKind.Identifier && t.text === "from")));
}

function checkImportsAndExports(tokens: readonly TsToken[], targetFilePath: string): string | null {
  let braceDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === SyntaxKind.OpenBraceToken) {
      braceDepth++;
      continue;
    }
    if (t.kind === SyntaxKind.CloseBraceToken) {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (t.kind === SyntaxKind.ImportKeyword) {
      const next = tokens[i + 1];
      if (!next) continue;
      if (next.kind === SyntaxKind.OpenParenToken) {
        return "Prohibido usar dynamic `import(...)` en variantes generadas.";
      }
      if (next.kind === SyntaxKind.DotToken) {
        continue; // import.meta
      }
      if (
        next.kind === SyntaxKind.Identifier &&
        tokens[i + 2]?.kind === SyntaxKind.EqualsToken &&
        tokens[i + 3]?.kind === SyntaxKind.Identifier &&
        tokens[i + 3]?.text === "require"
      ) {
        return "Prohibido usar `import = require(...)` en variantes generadas.";
      }

      if (braceDepth !== 0) continue;

      const isTypeOnlyImport = next.kind === SyntaxKind.TypeKeyword;

      // Side-effect import: `import "spec";`
      if (next.kind === SyntaxKind.StringLiteral) {
        const specErr = validateImportSpecifier(unquoteToken(next), targetFilePath);
        if (specErr) return specErr;
        continue;
      }

      // Cláusula `import ... from "spec"`
      let k = i + 1;
      let localDepth = 0;
      let braceStart = -1;
      let braceEnd = -1;
      let specToken: TsToken | null = null;
      while (k < tokens.length) {
        const kt = tokens[k];
        if (kt.kind === SyntaxKind.OpenBraceToken) {
          if (localDepth === 0) braceStart = k;
          localDepth++;
        } else if (kt.kind === SyntaxKind.CloseBraceToken) {
          localDepth = Math.max(0, localDepth - 1);
          if (localDepth === 0 && braceStart !== -1 && braceEnd === -1) braceEnd = k;
        } else if (localDepth === 0 && isFromKeywordToken(kt) && tokens[k + 1]?.kind === SyntaxKind.StringLiteral) {
          specToken = tokens[k + 1];
          break;
        } else if (localDepth === 0 && (kt.kind === SyntaxKind.SemicolonToken || kt.kind === SyntaxKind.ImportKeyword || kt.kind === SyntaxKind.ExportKeyword)) {
          break;
        }
        k++;
      }

      if (!specToken) continue;
      const specifier = unquoteToken(specToken);
      const specErr = validateImportSpecifier(specifier, targetFilePath);
      if (specErr) return specErr;

      if (!isTypeOnlyImport && specifier.endsWith("/models/prompts.ts") && braceStart !== -1 && braceEnd !== -1) {
        const exportedTypes = getPromptsExportedTypes();
        let b = braceStart + 1;
        while (b < braceEnd) {
          if (tokens[b].kind === SyntaxKind.CommaToken) {
            b++;
            continue;
          }
          if (tokens[b].kind === SyntaxKind.TypeKeyword) {
            // `import { type Foo [as Bar] }`
            while (b < braceEnd && tokens[b].kind !== SyntaxKind.CommaToken) b++;
            continue;
          }
          if (tokens[b].kind === SyntaxKind.Identifier) {
            const importedName = tokens[b].text;
            if (!PROMPTS_MODULE_EXPORTS.has(importedName) && !exportedTypes.has(importedName)) {
              return `'${importedName}' NO está exportado desde src/core/models/prompts.ts; definilo como const local en tu variante.`;
            }
          }
          while (b < braceEnd && tokens[b].kind !== SyntaxKind.CommaToken) b++;
        }
      }
      continue;
    }

    if (braceDepth === 0 && t.kind === SyntaxKind.ExportKeyword) {
      const t1 = tokens[i + 1];
      if (!t1) continue;
      if (t1.kind === SyntaxKind.AsteriskToken) {
        return "Prohibido re-exportar módulos desde variantes generadas.";
      }
      const braceIdx = t1.kind === SyntaxKind.TypeKeyword && tokens[i + 2]?.kind === SyntaxKind.OpenBraceToken
        ? i + 2
        : t1.kind === SyntaxKind.OpenBraceToken
          ? i + 1
          : -1;
      if (braceIdx !== -1) {
        const closeIdx = findMatchingBraceToken(tokens, braceIdx);
        if (closeIdx !== -1 && isFromKeywordToken(tokens[closeIdx + 1]) && tokens[closeIdx + 2]?.kind === SyntaxKind.StringLiteral) {
          return "Prohibido re-exportar módulos desde variantes generadas.";
        }
      }
    }
  }

  return null;
}

function runStaticAstValidation(
  code: string,
  tokens: readonly TsToken[],
  targetFilePath: string,
  stage: StageName,
): { error: string } | { error: null; cjsCode: string } {
  // 1. Chequeo de sintaxis TypeScript y borrado de tipos vía esbuild (ESM para inspección + CJS para sandbox VM)
  let esmCode: string;
  let cjsCode: string;
  try {
    esmCode = transformSync(code, {
      loader: "ts",
      format: "esm",
      sourcefile: targetFilePath,
    }).code;
    cjsCode = transformSync(code, {
      loader: "ts",
      format: "cjs",
      sourcefile: targetFilePath,
    }).code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Error de sintaxis TypeScript: ${msg.split("\n").slice(0, 4).join(" | ")}` };
  }

  // 2. Allowlist de imports/re-exports sobre el TS original (cubre `import type` y runtime)
  const importErr = checkImportsAndExports(tokens, targetFilePath);
  if (importErr) return { error: importErr };

  // 3. Estructura estática del objeto Variant en `export default`
  const rootOpenBrace = findExportedVariantObjectBrace(tokens);
  if (rootOpenBrace === -1) {
    return { error: "Debe exportar un objeto `Variant` válido en `export default`." };
  }

  const contract = getStageContract(stage);
  const rootEntries = parseTopLevelObjectEntries(tokens, rootOpenBrace);
  for (const prop of rootEntries) {
    if (prop.kind === "spread" || prop.kind === "computed") {
      return { error: "No se permiten spreads dinámicos ni propiedades computadas en el objeto raíz `Variant`." };
    }
    const key = prop.key;
    if (key === "params") {
      return { error: "Prohibido definir `params`: el optimizador solo puede editar texto/estructura del prompt." };
    }
    if (key === "read") {
      return { error: "Prohibido definir `read`: el optimizador solo puede editar texto/estructura del prompt sin cambiar el esquema de preguntas." };
    }
    if (key && key !== "name" && key !== "prompts") {
      return { error: `Propiedad no permitida en Variant: '${key}'. Solo se permiten 'name' y 'prompts'.` };
    }
    if (key === "prompts" && prop.valueTokIdx !== undefined) {
      const pBrace = skipLeadingParens(tokens, prop.valueTokIdx);
      if (tokens[pBrace]?.kind === SyntaxKind.OpenBraceToken) {
        const grpEntries = parseTopLevelObjectEntries(tokens, pBrace);
        for (const grpProp of grpEntries) {
          const grpKey = grpProp.key;
          if (grpKey !== contract.promptGroup) {
            return {
              error: `Para la etapa '${stage}', ` +
                `\`prompts\` solo puede definir \`${contract.promptGroup}.${contract.promptKey}\` (recibido '${grpKey ?? "dinámico"}').`,
            };
          }
          if (grpProp.valueTokIdx !== undefined) {
            const gBrace = skipLeadingParens(tokens, grpProp.valueTokIdx);
            if (tokens[gBrace]?.kind === SyntaxKind.OpenBraceToken) {
              const stEntries = parseTopLevelObjectEntries(tokens, gBrace);
              for (const stProp of stEntries) {
                if (stProp.key !== contract.promptKey) {
                  return {
                    error: `Para la etapa '${stage}', ` +
                      `solo se puede definir \`${contract.promptKey}\` dentro de \`${contract.promptGroup}\` (recibido '${stProp.key ?? "dinámico"}').`,
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. Escaneo léxico de seguridad sobre el JS emitido por esbuild
  const jsTokens = tokenizeTs(esmCode);
  for (let i = 0; i < jsTokens.length; i++) {
    const t = jsTokens[i];
    const next = jsTokens[i + 1];
    const prev = jsTokens[i - 1];

    if (t.kind === SyntaxKind.ImportKeyword && next?.kind === SyntaxKind.OpenParenToken) {
      return { error: "Prohibido usar dynamic `import(...)` en variantes generadas." };
    }

    if (t.kind === SyntaxKind.Identifier && BANNED_IDENTIFIERS.has(t.text)) {
      // Ignorar acceso a propiedad `obj.fetch` / `obj?.fetch` o clave literal de objeto `{ process: 1 }`
      if (prev?.kind === SyntaxKind.DotToken || prev?.kind === SyntaxKind.QuestionDotToken) continue;
      if (
        (prev?.kind === SyntaxKind.OpenBraceToken || prev?.kind === SyntaxKind.CommaToken) &&
        next?.kind === SyntaxKind.ColonToken
      ) {
        continue;
      }
      return { error: `Identificador prohibido en variante generada: '${t.text}'.` };
    }
  }

  return { error: null, cjsCode };
}

/**
 * Evalúa el CJS compilado dentro de un contexto `node:vm` efímero y con `require` restringido,
 * sin escribir a disco ni ensuciar el registro de módulos ESM de V8 en intentos rechazados.
 */
function loadVariantInSandbox(cjsCode: string, virtualFilePath: string): unknown {
  const hostRequire = createRequire(virtualFilePath);
  const safeRequire = (specifier: string): unknown => {
    const specErr = validateImportSpecifier(specifier, virtualFilePath);
    if (specErr) throw new Error(specErr);
    return hostRequire(specifier);
  };
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  vm.runInNewContext(
    cjsCode,
    {
      module: mod,
      exports: mod.exports,
      require: safeRequire,
    },
    { filename: virtualFilePath, timeout: 2000 },
  );
  return mod.exports.default ?? mod.exports;
}

function validateRuntimeVariantShape(variant: unknown, variantName: string, stage: StageName): string | null {
  if (!variant || typeof variant !== "object") {
    return "El export default debe ser un objeto Variant.";
  }
  const v = variant as Record<string, unknown>;
  if (v.name !== variantName) {
    return `Variant.name ('${String(v.name)}') no coincide con '${variantName}'.`;
  }
  if ("params" in v && v.params !== undefined) {
    return "Variant.params está prohibido en variantes generadas.";
  }
  if ("read" in v && v.read !== undefined) {
    return "Variant.read está prohibido en variantes generadas.";
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
    if (stage === "arguments" && (typeof view.osLine !== "function" || typeof view.buildSystemPrompt !== "function")) {
      return "Variant.prompts.PROMPTS.ARGUMENTS_VIEW debe incluir osLine y buildSystemPrompt (puedes usar `...PROMPTS.ARGUMENTS_VIEW`).";
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
 * Valida, normaliza, evalúa en memoria (sandbox `node:vm` + CJS sin contaminar ESM ni disco),
 * verifica `loadDatasets` + presupuesto de contexto, y solo escribe `<variantsRoot>/_auto/<stage>/<variantName>.ts` si pasa todo.
 */
export async function validateAndWriteVariant(opts: {
  stage: StageName;
  variantName: string;
  rawCode: string;
  devDatasetPaths: string[];
  knownHashes: Set<string>;
  variantsRoot?: string;
  rawCache?: RawDatasetCache;
}): Promise<ValidationResult> {
  const { stage, variantName, rawCode, devDatasetPaths, knownHashes, variantsRoot } = opts;

  if (!rawCode || !rawCode.trim()) {
    return { ok: false, error: "El código de la variante está vacío." };
  }

  const stageDir = resolve(autoStageDir(stage, variantsRoot));
  const filePath = resolve(stageDir, `${variantName}.ts`);

  const sourceWithNewline = `${rawCode.trim()}\n`;
  const rawTokens = tokenizeTs(sourceWithNewline);
  const patched = applyNameOverride(sourceWithNewline, rawTokens, variantName);
  if (patched.error) {
    return { ok: false, error: patched.error };
  }

  const patchedTokens = tokenizeTs(patched.code);
  const staticRes = runStaticAstValidation(patched.code, patchedTokens, filePath, stage);
  if (staticRes.error !== null) {
    return { ok: false, error: staticRes.error };
  }

  const normalizedHash = normalizedVariantCodeHash(patched.code, variantName);
  if (knownHashes.has(normalizedHash)) {
    return {
      ok: false,
      error: `Variante duplicada (hash ${normalizedHash}): ya existe otra variante idéntica en esta etapa o en esta misma vuelta.`,
    };
  }

  try {
    const loaded = loadVariantInSandbox(staticRes.cjsCode, filePath);

    const runtimeErr = validateRuntimeVariantShape(loaded, variantName, stage);
    if (runtimeErr) {
      return { ok: false, error: runtimeErr };
    }

    const variant = loaded as Variant;
    const rawCache = opts.rawCache ?? createRawDatasetCache();
    const reqErr = validateStageRequestsAndContext(stage, devDatasetPaths, variant, rawCache);
    if (reqErr) {
      return { ok: false, error: reqErr };
    }

    mkdirSync(stageDir, { recursive: true });
    writeFileSync(filePath, patched.code, "utf8");
    invalidateVariantCache(variantsRoot);

    return {
      ok: true,
      name: variantName,
      filePath,
      code: patched.code,
      normalizedHash,
      variant,
    };
  } catch (e) {
    return {
      ok: false,
      error: `Error cargando o materializando la variante '${variantName}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
