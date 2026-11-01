/**
 * Utilidades de JSON plano (regla 3 de la sección 6). Sin dependencias.
 */

import type { JsonValue } from "./types.ts";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface JsonProblem {
  /** `shape`: no es JSON plano. `limit`: un string supera el tope o la anidación supera la profundidad máxima. */
  kind: "shape" | "limit";
  path: string;
  detail: string;
}

export interface JsonCheckOptions {
  maxDepth: number;
  /** Largo máximo de cualquier string del valor; null = sin tope. */
  maxString: number | null;
}

/** Devuelve null si `value` es JSON plano dentro de los topes; si no, el primer problema encontrado. */
export function jsonProblem(value: unknown, options: JsonCheckOptions, path = "$", depth = 0): JsonProblem | null {
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "string") {
    if (options.maxString !== null && value.length > options.maxString) {
      return { kind: "limit", path, detail: `string de ${value.length} caracteres (tope ${options.maxString})` };
    }
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : { kind: "shape", path, detail: "número no finito" };
  }
  if (Array.isArray(value)) {
    if (depth >= options.maxDepth) return { kind: "limit", path, detail: `anidación mayor a ${options.maxDepth}` };
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return { kind: "shape", path: `${path}[${i}]`, detail: "hueco en el arreglo" };
      const problem = jsonProblem(value[i], options, `${path}[${i}]`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (isPlainObject(value)) {
    if (depth >= options.maxDepth) return { kind: "limit", path, detail: `anidación mayor a ${options.maxDepth}` };
    for (const key of Object.keys(value)) {
      const problem = jsonProblem(value[key], options, `${path}.${key}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  return { kind: "shape", path, detail: `tipo no permitido (${value === undefined ? "undefined" : typeof value})` };
}

/**
 * Congela un valor en profundidad. Los elementos del contexto se congelan al crearse: se reemplazan en cada
 * `update` (copia al escribir), así que nadie puede mutar lo que ya leyó.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Copia profunda de un valor que ya se comprobó como JSON plano. */
export function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  const copy: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value)) copy[key] = cloneJson((value as { [key: string]: JsonValue })[key]);
  return copy as T;
}
