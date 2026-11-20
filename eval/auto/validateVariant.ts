/**
 * eval/auto/validateVariant.ts
 *
 * Validación previa de variantes TypeScript generadas por el optimizador (`§2.4`, `§5.3`, `§9`):
 * 1. Normaliza/inyecta `name` exacto en el export default mediante análisis léxico/estructural.
 * 2. Valida sintaxis TypeScript con `esbuild.transformSync` y prohíbe imports fuera de `src/core/**` y `eval/core/variants/types.ts`.
 * 3. Prohíbe APIs inseguras (`eval`, `Function`, `require`, `import()`, `process`, `fetch`, etc.) y las propiedades `params` y `read`.
 * 4. Verifica deduplicación por hash normalizado de código/prompt contra variantes previas/descartadas.
 * 5. Escribe el archivo en `eval/variants/_auto/<stage>/`, hace import ESM con cache-busting, valida forma runtime,
 *    materializa todos los casos con `loadDatasets` y chequea presupuesto de contexto (`DECISION_MAX_CONTEXT` / `reserveCompletionTokens`).
 *    Si falla algún paso, elimina el archivo temporal para mantener `eval/variants/` y `tsc` limpios.
 */

import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, normalize, resolve } from "node:path";
import vm from "node:vm";
import { ConfigManager } from "../../src/core/config.ts";
import * as PROMPTS_MOD from "../../src/core/models/prompts.ts";
import { DECISION_MAX_CONTEXT, estimateDecisionPromptTokens } from "../core/client/decision.ts";
import { reserveCompletionTokens } from "../core/client/generative.ts";
import { COMPLETION_KEY, CONTINUATION_KEY, RECOVERY_KEY } from "../core/contract.ts";
import { loadDatasets } from "../core/datasets.ts";
import type { DecisionRequest, GenerativeRequest, StageName } from "../core/types.ts";
import { fragmentKeys } from "../core/variants/labels.ts";
import type { Variant } from "../core/variants/types.ts";
import { autoStageDir } from "./config.ts";
import { getStageContract } from "./stageContract.ts";

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

const REGEX_PRE_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "in",
  "of",
  "typeof",
  "void",
  "delete",
  "await",
  "yield",
  "else",
  "do",
  "new",
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
  let stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  if (variantName) {
    const escaped = variantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    stripped = stripped.replace(new RegExp(`\\b${escaped}\\b`, "g"), "__VARIANT_NAME__");
  }
  stripped = stripped.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(stripped).digest("hex").slice(0, 16);
}

/** Recopila hashes normalizados de todas las variantes existentes de `stage` (activas + descartadas). */
export function collectKnownVariantHashes(stage: StageName, extraVariantPaths: string[] = []): Set<string> {
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

  const stageDir = resolve(autoStageDir(stage));
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
  const srcCoreRoot = resolve("src/core");
  const variantTypesPath = resolve("eval/core/variants/types.ts");

  const inSrcCore = resolved.startsWith(`${srcCoreRoot}/`) || resolved.startsWith(`${srcCoreRoot}\\`);
  const isVariantTypes = resolved === variantTypesPath;

  if (!inSrcCore && !isVariantTypes) {
    return `Import fuera de allowlist '${specifier}' (resuelve a '${resolved}'): solo se permite src/core/* y eval/core/variants/types.ts.`;
  }
  if (!existsSync(resolved)) {
    return `Import inexistente '${specifier}' (no existe '${resolved}'). Verificá los niveles '../' desde eval/variants/_auto/<stage>/.`;
  }
  return null;
}

/**
 * Detecta si `/` en la posición actual inicia un literal RegExp (y no un operador de división).
 */
function isRegexStart(src: string, maskedOut: string[], slashIdx: number): boolean {
  let p = slashIdx - 1;
  while (p >= 0 && /\s/.test(src[p])) p--;
  if (p < 0) return true;

  // Mirar el carácter anterior en la salida ya procesada (para saltar comentarios previos)
  while (p >= 0 && /\s/.test(maskedOut[p])) p--;
  if (p < 0) return true;

  const ch = maskedOut[p];
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let start = p;
    while (start > 0 && /[A-Za-z0-9_$]/.test(maskedOut[start - 1])) start--;
    const word = maskedOut.slice(start, p + 1).join("");
    return REGEX_PRE_KEYWORDS.has(word);
  }
  if (ch === ")" || ch === "]") return false;
  if (ch === "+" && p > 0 && maskedOut[p - 1] === "+") return false;
  if (ch === "-" && p > 0 && maskedOut[p - 1] === "-") return false;
  return true;
}

/**
 * Enmascara comentarios, RegExp literals y contenido de strings/plantillas estáticas con espacios
 * preservando longitudes e índices exactos; las expresiones `${...}` dentro de templates se conservan.
 */
function maskCodePreserveOffsets(src: string): string {
  const out = new Array<string>(src.length);
  const templateDepthStack: number[] = [];
  let inTemplateText = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inTemplateText) {
      if (ch === "\\" && i + 1 < src.length) {
        out[i] = " ";
        out[i + 1] = src[i + 1] === "\n" ? "\n" : " ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        out[i] = "`";
        inTemplateText = false;
        i++;
        continue;
      }
      if (ch === "$" && src[i + 1] === "{") {
        out[i] = "$";
        out[i + 1] = "{";
        templateDepthStack.push(1);
        inTemplateText = false;
        i += 2;
        continue;
      }
      out[i] = ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }

    // Comentario de línea
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out[i++] = " ";
      }
      continue;
    }

    // Comentario de bloque
    if (ch === "/" && src[i + 1] === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }

    // Literal RegExp: preserva delimitadores `/`, enmascara patrón interno (respetando escapes y `[...]`)
    if (ch === "/" && isRegexStart(src, out, i)) {
      out[i++] = "/";
      let inClass = false;
      while (i < src.length) {
        const rc = src[i];
        if (rc === "\n") break;
        if (rc === "\\" && i + 1 < src.length) {
          out[i] = " ";
          out[i + 1] = src[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        if (rc === "[" && !inClass) {
          inClass = true;
          out[i++] = " ";
          continue;
        }
        if (rc === "]" && inClass) {
          inClass = false;
          out[i++] = " ";
          continue;
        }
        if (rc === "/" && !inClass) {
          out[i++] = "/";
          break;
        }
        out[i++] = " ";
      }
      continue;
    }

    // Strings simples / dobles: preserva delimitadores, enmascara contenido
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out[i++] = quote;
      while (i < src.length) {
        if (src[i] === "\\" && i + 1 < src.length) {
          out[i] = " ";
          out[i + 1] = src[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out[i++] = quote;
          break;
        }
        out[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    // Inicio de template literal
    if (ch === "`") {
      out[i++] = "`";
      inTemplateText = true;
      continue;
    }

    // Control de llaves dentro de ${ ... }
    if (templateDepthStack.length > 0) {
      if (ch === "{") {
        templateDepthStack[templateDepthStack.length - 1]++;
      } else if (ch === "}") {
        templateDepthStack[templateDepthStack.length - 1]--;
        if (templateDepthStack[templateDepthStack.length - 1] === 0) {
          templateDepthStack.pop();
          out[i++] = "}";
          inTemplateText = true;
          continue;
        }
      }
    }

    out[i] = ch;
    i++;
  }

  return out.join("");
}

function findMatchingBrace(masked: string, openBraceIdx: number): number {
  let depth = 0;
  for (let i = openBraceIdx; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

interface ObjectEntry {
  kind: "prop" | "method" | "shorthand" | "spread" | "computed";
  key?: string;
  keyStart: number;
  keyEnd: number;
  valueStart?: number;
  valueEnd?: number;
}

function parseTopLevelObjectEntries(raw: string, masked: string, openBraceIdx: number): ObjectEntry[] {
  const closeIdx = findMatchingBrace(masked, openBraceIdx);
  if (closeIdx === -1) return [];

  const entries: ObjectEntry[] = [];
  let i = openBraceIdx + 1;

  while (i < closeIdx) {
    i = skipWs(masked, i);
    if (i >= closeIdx) break;
    if (masked[i] === ",") {
      i++;
      continue;
    }

    if (masked.startsWith("...", i)) {
      const start = i;
      let depth = 0;
      while (i < closeIdx) {
        const c = masked[i];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (c === "," && depth === 0) break;
        i++;
      }
      entries.push({ kind: "spread", keyStart: start, keyEnd: i });
      continue;
    }

    if (masked[i] === "[") {
      const start = i;
      let depth = 0;
      while (i < closeIdx) {
        const c = masked[i];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (c === "," && depth === 0) break;
        i++;
      }
      entries.push({ kind: "computed", keyStart: start, keyEnd: i });
      continue;
    }

    const keyStart = i;
    let key: string | undefined;
    if (masked[i] === "'" || masked[i] === '"' || masked[i] === "`") {
      const quote = masked[i];
      const endQ = masked.indexOf(quote, i + 1);
      if (endQ === -1 || endQ >= closeIdx) break;
      key = raw.slice(i + 1, endQ);
      i = endQ + 1;
    } else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(masked.slice(i, closeIdx));
      if (!m) break;
      key = m[0];
      i += m[0].length;
    }
    const keyEnd = i;
    i = skipWs(masked, i);

    if (i < closeIdx && masked[i] === "(") {
      // Method declaration foo(...) { ... }
      let depth = 0;
      while (i < closeIdx) {
        const c = masked[i];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") {
          depth--;
          if (depth === 0 && c === "}") {
            i++;
            break;
          }
        }
        i++;
      }
      entries.push({ kind: "method", key, keyStart, keyEnd });
      continue;
    }

    if (i >= closeIdx || masked[i] === ",") {
      entries.push({ kind: "shorthand", key, keyStart, keyEnd });
      continue;
    }

    if (masked[i] !== ":") break;
    i++; // saltar ':'
    const valueStart = skipWs(masked, i);
    let depth = 0;
    while (i < closeIdx) {
      const c = masked[i];
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) break;
      i++;
    }
    let valueEnd = i;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1])) valueEnd--;
    entries.push({ kind: "prop", key, keyStart, keyEnd, valueStart, valueEnd });
  }

  return entries;
}

function findExportedVariantObjectBrace(raw: string): { openBraceIdx: number; masked: string } | null {
  const masked = maskCodePreserveOffsets(raw);
  const expMatch = /\bexport\s+default\b/.exec(masked);
  if (!expMatch) return null;

  let pos = skipWs(masked, expMatch.index + expMatch[0].length);
  while (pos < masked.length && masked[pos] === "(") {
    pos = skipWs(masked, pos + 1);
  }

  if (masked[pos] === "{") {
    return { openBraceIdx: pos, masked };
  }

  const idMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(masked.slice(pos));
  if (!idMatch) return null;
  const varName = idMatch[1];

  // Buscar `const|let|var <varName> [: Type] = (`*` {`
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${varName}\\b`);
  let searchFrom = 0;
  while (searchFrom < masked.length) {
    const m = declRe.exec(masked.slice(searchFrom));
    if (!m) break;
    const afterName = searchFrom + m.index + m[0].length;
    // Saltar anotación de tipo hasta '=' top-level
    let p = afterName;
    let angle = 0;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    let eqIdx = -1;
    while (p < masked.length) {
      const ch = masked[p];
      if (ch === "<") angle++;
      else if (ch === ">") angle = Math.max(0, angle - 1);
      else if (ch === "(") paren++;
      else if (ch === ")") paren--;
      else if (ch === "{") brace++;
      else if (ch === "}") brace--;
      else if (ch === "[") bracket++;
      else if (ch === "]") bracket--;
      else if (ch === "=" && masked[p + 1] !== ">" && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
        eqIdx = p;
        break;
      } else if ((ch === ";" || ch === "\n") && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
        break;
      }
      p++;
    }
    if (eqIdx !== -1) {
      let rhs = skipWs(masked, eqIdx + 1);
      while (rhs < masked.length && masked[rhs] === "(") rhs = skipWs(masked, rhs + 1);
      if (masked[rhs] === "{") {
        return { openBraceIdx: rhs, masked };
      }
    }
    searchFrom = afterName;
  }

  return null;
}

function applyNameOverride(code: string, variantName: string): { code: string; error?: string } {
  const found = findExportedVariantObjectBrace(code);
  if (!found) {
    return { code, error: "El archivo debe tener `export default` de un objeto `Variant` (literal o variable const)." };
  }

  const entries = parseTopLevelObjectEntries(code, found.masked, found.openBraceIdx);
  for (const entry of entries) {
    if (entry.key !== "name") continue;
    if (entry.kind === "prop" && entry.valueStart !== undefined && entry.valueEnd !== undefined) {
      const valMasked = found.masked.slice(entry.valueStart, entry.valueEnd).trim();
      const first = valMasked[0];
      const last = valMasked[valMasked.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
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

  const insertAt = found.openBraceIdx + 1;
  const patched = `${code.slice(0, insertAt)}\n  name: ${JSON.stringify(variantName)},${code.slice(insertAt)}`;
  return { code: patched };
}

let cachedPromptsExportedTypes: Set<string> | null = null;
function getPromptsExportedTypes(): Set<string> {
  if (cachedPromptsExportedTypes) return cachedPromptsExportedTypes;
  const set = new Set<string>();
  try {
    const src = readFileSync(resolve("src/core/models/prompts.ts"), "utf8");
    const re = /^export\s+(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) set.add(m[1]);
  } catch {
    // fallback vacío
  }
  cachedPromptsExportedTypes = set;
  return set;
}

function checkImportsAndExports(
  rawCode: string,
  targetFilePath: string,
): string | null {
  const masked = maskCodePreserveOffsets(rawCode);

  if (/\bimport\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*require\s*\(/.test(masked)) {
    return "Prohibido usar `import = require(...)` en variantes generadas.";
  }

  const reExportRe = /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+(['"`][^'"`]*['"`])/g;
  if (reExportRe.test(masked)) {
    return "Prohibido re-exportar módulos desde variantes generadas.";
  }

  // Chequear todas las cláusulas `import ... from "<spec>"` o `import "<spec>"` (incluyendo multilínea).
  const importHeadRe = /(?:^|[;\n}])\s*import\b/gm;
  let m: RegExpExecArray | null;
  while ((m = importHeadRe.exec(masked)) !== null) {
    const kwIdx = masked.indexOf("import", m.index);
    const afterKw = skipWs(masked, kwIdx + "import".length);

    if (masked[afterKw] === "(") {
      return "Prohibido usar dynamic `import(...)` en variantes generadas.";
    }
    if (masked[afterKw] === ".") {
      // `import.meta`
      continue;
    }

    // Avanzar hasta `;` o fin de línea tras `from "..."` / `import "..."`
    let end = afterKw;
    let braceDepth = 0;
    while (end < masked.length) {
      const ch = masked[end];
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === ";" && braceDepth === 0) {
        end++;
        break;
      } else if (ch === "\n" && braceDepth === 0) {
        const soFar = masked.slice(kwIdx, end);
        if (/\bfrom\s*(['"])[^'"]*\1/.test(soFar) || /^import\s*(['"])[^'"]*\1/.test(soFar)) {
          break;
        }
      }
      end++;
    }

    const rawStmt = rawCode.slice(kwIdx, end);
    const maskedStmt = masked.slice(kwIdx, end);
    importHeadRe.lastIndex = Math.max(importHeadRe.lastIndex, end);

    const fromMatch = /\bfrom\s*(['"])([^'"]*)\1/.exec(maskedStmt);
    const sideEffectMatch = /^import\s*(['"])([^'"]*)\1/.exec(maskedStmt);
    const specSpan = fromMatch ?? sideEffectMatch;
    if (!specSpan) continue;

    const specIdxInStmt = specSpan.index + specSpan[0].indexOf(specSpan[1]) + 1;
    const specEndInStmt = specIdxInStmt + specSpan[2].length;
    const specifier = rawStmt.slice(specIdxInStmt, specEndInStmt);

    const specErr = validateImportSpecifier(specifier, targetFilePath);
    if (specErr) return specErr;

    if (specifier.endsWith("/models/prompts.ts") && !/^import\s+type\b/.test(rawStmt)) {
      const namedBrace = rawStmt.match(/\{([^}]*)\}/);
      if (namedBrace) {
        const exportedTypes = getPromptsExportedTypes();
        const items = namedBrace[1].split(",").map((s) => s.trim()).filter(Boolean);
        for (const item of items) {
          if (/^type\s+/.test(item)) continue;
          const importedName = item.split(/\s+as\s+/)[0].trim();
          if (
            importedName &&
            !Object.prototype.hasOwnProperty.call(PROMPTS_MOD, importedName) &&
            !exportedTypes.has(importedName)
          ) {
            return `'${importedName}' NO está exportado desde src/core/models/prompts.ts; definilo como const local en tu variante.`;
          }
        }
      }
    }
  }

  return null;
}

function stripAsAndParensStart(masked: string, idx: number): number {
  let p = skipWs(masked, idx);
  while (p < masked.length && masked[p] === "(") p = skipWs(masked, p + 1);
  return p;
}

function runStaticAstValidation(
  code: string,
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

  // 2. Allowlist de imports (sobre el TS original para cubrir `import type` y runtime)
  const importErr = checkImportsAndExports(code, targetFilePath);
  if (importErr) return { error: importErr };

  // 3. Estructura estática del objeto Variant en `export default`
  const found = findExportedVariantObjectBrace(code);
  if (!found) {
    return { error: "Debe exportar un objeto `Variant` válido en `export default`." };
  }

  const contract = getStageContract(stage);
  const rootEntries = parseTopLevelObjectEntries(code, found.masked, found.openBraceIdx);
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
    if (key === "prompts" && prop.valueStart !== undefined) {
      const pBrace = stripAsAndParensStart(found.masked, prop.valueStart);
      if (found.masked[pBrace] === "{") {
        const grpEntries = parseTopLevelObjectEntries(code, found.masked, pBrace);
        for (const grpProp of grpEntries) {
          const grpKey = grpProp.key;
          if (grpKey !== contract.promptGroup) {
            return {
              error: `Para la etapa '${stage}', ` +
                `\`prompts\` solo puede definir \`${contract.promptGroup}.${contract.promptKey}\` (recibido '${grpKey ?? "dinámico"}').`,
            };
          }
          if (grpProp.valueStart !== undefined) {
            const gBrace = stripAsAndParensStart(found.masked, grpProp.valueStart);
            if (found.masked[gBrace] === "{") {
              const stEntries = parseTopLevelObjectEntries(code, found.masked, gBrace);
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

  // 4. Escaneo de seguridad sobre el JS sin anotaciones de tipo ni strings/comentarios
  const maskedJs = maskCodePreserveOffsets(esmCode);
  if (/\bimport\s*\(/.test(maskedJs)) {
    return { error: "Prohibido usar dynamic `import(...)` en variantes generadas." };
  }

  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRe.exec(maskedJs)) !== null) {
    const id = idMatch[0];
    if (!BANNED_IDENTIFIERS.has(id)) continue;

    // Ignorar propiedad de acceso `obj.fetch` o clave de objeto `{ process: 1 }`
    let prev = idMatch.index - 1;
    while (prev >= 0 && /\s/.test(maskedJs[prev])) prev--;
    if (prev >= 0 && maskedJs[prev] === ".") continue;

    let next = idMatch.index + id.length;
    while (next < maskedJs.length && /\s/.test(maskedJs[next])) next++;
    if (next < maskedJs.length && maskedJs[next] === ":" && !(prev >= 0 && maskedJs[prev] === "?")) {
      continue;
    }

    return { error: `Identificador prohibido en variante generada: '${id}'.` };
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

function validateStageRequestsAndContext(stage: StageName, devPaths: string[], variant: Variant): string | null {
  const datasets = loadDatasets(devPaths, { stages: [stage] }, variant);
  const numCtx = ConfigManager.getConfig().qwenNumCtx;
  const overflowCases: string[] = [];

  for (const ds of datasets) {
    for (const fc of ds.cases) {
      if (fc.request.type === "decision") {
        const req: DecisionRequest = fc.request;
        if (!req.state || !req.state.trim()) {
          return `Caso '${ds.name}/${fc.id}': DecisionRequest.state quedó vacío.`;
        }
        const qKeys = Object.keys(req.questions ?? {});
        if (qKeys.length === 0) {
          return `Caso '${ds.name}/${fc.id}': DecisionRequest.questions quedó vacío.`;
        }
        if (stage === "d0") {
          const kindQ = req.questions.kind;
          if (!kindQ || kindQ.type !== "choice") return `Caso '${ds.name}/${fc.id}': d0 requiere pregunta choice 'kind'.`;
          for (const k of ["chat", "single", "multi"]) {
            if (!(k in kindQ.criteria)) return `Caso '${ds.name}/${fc.id}': kind.criteria debe incluir '${k}'.`;
          }
          if (!req.questions.multi || req.questions.multi.type !== "noul") {
            return `Caso '${ds.name}/${fc.id}': d0 requiere pregunta noul 'multi'.`;
          }
        } else if (stage === "route") {
          if (!req.questions.route || req.questions.route.type !== "choice") {
            return `Caso '${ds.name}/${fc.id}': route requiere pregunta choice 'route'.`;
          }
        } else if (stage === "tool_choice") {
          if (!req.questions.selected_tool || req.questions.selected_tool.type !== "choice") {
            return `Caso '${ds.name}/${fc.id}': tool_choice requiere pregunta choice 'selected_tool'.`;
          }
        } else if (stage === "args_review") {
          const rev = req.questions.review;
          if (!rev || rev.type !== "choice") {
            return `Caso '${ds.name}/${fc.id}': args_review requiere pregunta choice 'review'.`;
          }
          for (const opt of ["approved", "args_invalid", "info_missing"]) {
            if (!(opt in rev.criteria)) {
              return `Caso '${ds.name}/${fc.id}': questions.review.criteria debe incluir '${opt}'.`;
            }
          }
        } else if (stage === "result_verification") {
          if (!req.questions.cumple || req.questions.cumple.type !== "noul") {
            return `Caso '${ds.name}/${fc.id}': result_verification requiere pregunta noul 'cumple'.`;
          }
          if (req.questions.ok !== undefined && req.questions.ok.type !== "noul") {
            return `Caso '${ds.name}/${fc.id}': la pregunta 'ok' debe ser type: 'noul'.`;
          }
        } else if (stage === "fragment_judge") {
          const fKeys = fragmentKeys(req);
          if (fKeys.length === 0 || fKeys.some((k) => req.questions[k]?.type !== "noul")) {
            return `Caso '${ds.name}/${fc.id}': fragment_judge requiere preguntas noul f0, f1...`;
          }
          const expectedRelevant = (fc.expect as { expectedRelevant?: unknown }).expectedRelevant;
          if (Array.isArray(expectedRelevant)) {
            if (fKeys.length !== expectedRelevant.length) {
              return `Caso '${ds.name}/${fc.id}': fragment_judge generó ${fKeys.length} preguntas y el caso tiene ${expectedRelevant.length} fragmentos.`;
            }
            for (let fi = 0; fi < expectedRelevant.length; fi++) {
              if (!req.questions[`f${fi}`] || req.questions[`f${fi}`].type !== "noul") {
                return `Caso '${ds.name}/${fc.id}': falta la pregunta noul 'f${fi}'.`;
              }
            }
          }
        } else if (stage === "d5") {
          if (!req.questions[COMPLETION_KEY] || req.questions[COMPLETION_KEY].type !== "noul") {
            return `Caso '${ds.name}/${fc.id}': d5 requiere pregunta noul '${COMPLETION_KEY}'.`;
          }
        } else if (stage === "recovery") {
          const act = req.questions[RECOVERY_KEY];
          const twoAxes = req.questions.blocked?.type === "noul" && req.questions.prereq?.type === "noul";
          if (act !== undefined) {
            if (act.type !== "choice") {
              return `Caso '${ds.name}/${fc.id}': recovery requiere pregunta choice '${RECOVERY_KEY}'.`;
            }
            for (const opt of ["close", "rewrite_item", "replan"]) {
              if (!(opt in act.criteria)) {
                return `Caso '${ds.name}/${fc.id}': recovery.action.criteria debe incluir '${opt}'.`;
              }
            }
          } else if (!twoAxes) {
            return `Caso '${ds.name}/${fc.id}': recovery requiere pregunta choice '${RECOVERY_KEY}' o los ejes noul 'blocked' y 'prereq'.`;
          }
        } else if (stage === "continuation") {
          if (!req.questions[CONTINUATION_KEY] || req.questions[CONTINUATION_KEY].type !== "noul") {
            return `Caso '${ds.name}/${fc.id}': continuation requiere pregunta noul '${CONTINUATION_KEY}'.`;
          }
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
 * verifica `loadDatasets` + presupuesto de contexto, y solo escribe `eval/variants/_auto/<stage>/<variantName>.ts` si pasa todo.
 */
export async function validateAndWriteVariant(opts: {
  stage: StageName;
  variantName: string;
  rawCode: string;
  devDatasetPaths: string[];
  knownHashes: Set<string>;
}): Promise<ValidationResult> {
  const { stage, variantName, rawCode, devDatasetPaths, knownHashes } = opts;

  if (!rawCode || !rawCode.trim()) {
    return { ok: false, error: "El código de la variante está vacío." };
  }

  const stageDir = resolve(autoStageDir(stage));
  const filePath = resolve(stageDir, `${variantName}.ts`);

  const patched = applyNameOverride(rawCode.trim() + "\n", variantName);
  if (patched.error) {
    return { ok: false, error: patched.error };
  }

  const staticRes = runStaticAstValidation(patched.code, filePath, stage);
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
    const reqErr = validateStageRequestsAndContext(stage, devDatasetPaths, variant);
    if (reqErr) {
      return { ok: false, error: reqErr };
    }

    mkdirSync(stageDir, { recursive: true });
    writeFileSync(filePath, patched.code, "utf8");

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
