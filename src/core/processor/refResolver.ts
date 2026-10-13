/**
 * JARVIS Core — Deterministic Reference Resolver (RefResolver)
 * Replaces temporal memory references {{ref:rX}} or {{rX}} from RefStore
 * before Guard security evaluation and tool dispatch (§3, §10.4, §12 Criterio 7).
 */

import { RefStore } from "./resultProcessor.ts";

export interface ReferenceResolutionResult {
  resolvedArgs: Record<string, unknown>;
  replacedCount: number;
  resolvedRefs: string[];
  unresolvedRefs: string[];
}

/**
 * Regex patterns matching temporal reference tokens
 * Standard format: {{ref:r1}}, {{r1}}, or standalone ref:r1
 */
const REF_TOKEN_REGEX = /\{\{(?:ref:)?(r\d+)\}\}/gi;
const STANDALONE_REF_REGEX = /^(?:ref:)?(r\d+)$/i;

/**
 * Recursively resolves reference placeholders in an arbitrary value
 */
function resolveValue(
  value: unknown,
  taskId: string,
  resolvedRefs: Set<string>,
  unresolvedRefs: Set<string>
): { val: unknown; count: number } {
  if (value === null || value === undefined) {
    return { val: value, count: 0 };
  }

  if (typeof value === "string") {
    // 1. Caso exacto: el valor es un token completo (ej. "{{ref:r1}}" o "ref:r1")
    const standaloneMatch = value.trim().match(STANDALONE_REF_REGEX) || value.trim().match(/^\{\{(?:ref:)?(r\d+)\}\}$/i);
    if (standaloneMatch) {
      const refKey = standaloneMatch[1].toLowerCase();
      const content = RefStore.get(refKey, taskId);
      if (content !== undefined) {
        resolvedRefs.add(refKey);
        // Si el contenido almacenado es JSON válido, intentar parsearlo
        if (content.startsWith("{") || content.startsWith("[")) {
          try {
            const parsedJson = JSON.parse(content);
            return { val: parsedJson, count: 1 };
          } catch {
            // No era JSON válido, devolver como string
          }
        }
        return { val: content, count: 1 };
      } else {
        unresolvedRefs.add(refKey);
        console.warn(`[RefResolver] Referencia '${refKey}' no encontrada en RefStore para tarea '${taskId}'.`);
        return { val: value, count: 0 };
      }
    }

    // 2. Caso embebido: el string contiene uno o más tokens {{ref:rX}} o {{rX}}
    let replacedCountInString = 0;
    const replacedString = value.replace(REF_TOKEN_REGEX, (_match, rawKey) => {
      const refKey = String(rawKey).toLowerCase();
      const content = RefStore.get(refKey, taskId);
      if (content !== undefined) {
        resolvedRefs.add(refKey);
        replacedCountInString++;
        return content;
      } else {
        unresolvedRefs.add(refKey);
        console.warn(`[RefResolver] Referencia embebida '${refKey}' no encontrada en RefStore para tarea '${taskId}'.`);
        return _match;
      }
    });

    return { val: replacedString, count: replacedCountInString };
  }

  if (Array.isArray(value)) {
    let arrayReplacedCount = 0;
    const resolvedArray = value.map((item) => {
      const res = resolveValue(item, taskId, resolvedRefs, unresolvedRefs);
      arrayReplacedCount += res.count;
      return res.val;
    });
    return { val: resolvedArray, count: arrayReplacedCount };
  }

  if (typeof value === "object") {
    let objReplacedCount = 0;
    const resolvedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const res = resolveValue(v, taskId, resolvedRefs, unresolvedRefs);
      objReplacedCount += res.count;
      resolvedObj[k] = res.val;
    }
    return { val: resolvedObj, count: objReplacedCount };
  }

  return { val: value, count: 0 };
}

/**
 * Resolves all temporal references {{ref:rX}} inside an arguments object
 * before passing to Guard and tool execution.
 */
export function resolveReferences(
  args: Record<string, unknown>,
  taskId: string
): ReferenceResolutionResult {
  const resolvedRefs = new Set<string>();
  const unresolvedRefs = new Set<string>();

  const { val, count } = resolveValue(args, taskId, resolvedRefs, unresolvedRefs);

  return {
    resolvedArgs: (val as Record<string, unknown>) || {},
    replacedCount: count,
    resolvedRefs: Array.from(resolvedRefs),
    unresolvedRefs: Array.from(unresolvedRefs),
  };
}
