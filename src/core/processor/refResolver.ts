/**
 * JARVIS Core — Resolvedor determinista de referencias.
 * Sustituye referencias temporales del RefStore antes de Guard y del despacho MCP.
 *
 * Formas aceptadas (el prefijo `ref:` es obligatorio):
 * - Embebida en cualquier string: `{{ref:r1}}`
 * - Valor completo del argumento:  `{{ref:r1}}` o `ref:r1`
 *
 * Un `r1` desnudo NO es una referencia.
 * El contenido sustituido nunca se vuelve a escanear (sin referencias anidadas).
 */

import { isRecord } from "../utils.ts";
import { RefStore } from "./refStore.ts";

export interface ReferenceResolutionResult {
  resolvedArgs: Record<string, unknown>;
  replacedCount: number;
  resolvedRefs: string[];
  /** Referencias que no existen en el RefStore; permanecen literales en `resolvedArgs`. El llamador debe tratarlas como error. */
  unresolvedRefs: string[];
}

const EMBEDDED_REF = /\{\{ref:(r\d+)\}\}/gi;
const WHOLE_REF = /^(?:\{\{ref:(r\d+)\}\}|ref:(r\d+))$/i;

/** ¿El valor completo es un token de referencia (`{{ref:rX}}` o `ref:rX`)? */
export const isWholeRefToken = (value: unknown): boolean =>
  typeof value === "string" && WHOLE_REF.test(value.trim());

interface ResolutionState {
  taskId: string;
  resolved: Set<string>;
  unresolved: Set<string>;
  replaced: number;
}

/** Tipos JSON-Schema que admite un nodo, incluyendo ramas anyOf/oneOf. */
export function schemaTypes(schema: unknown, out = new Set<string>()): Set<string> {
  if (!isRecord(schema)) return out;
  const t = schema.type;
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) branches.forEach((b) => schemaTypes(b, out));
  }
  return out;
}

/** Solo se parsea el JSON de un ref si el schema pide object/array y no admite string. */
function expectsStructured(schema: unknown): boolean {
  const types = schemaTypes(schema);
  return (types.has("object") || types.has("array")) && !types.has("string");
}

function lookup(key: string, state: ResolutionState): string | undefined {
  const content = RefStore.get(key, state.taskId);
  if (content === undefined) {
    state.unresolved.add(key);
    console.warn(`[RefResolver] Referencia '${key}' no encontrada en RefStore para tarea '${state.taskId}'.`);
    return undefined;
  }
  state.resolved.add(key);
  return content;
}

function resolveString(value: string, schema: unknown, state: ResolutionState): unknown {
  const whole = WHOLE_REF.exec(value.trim());
  if (whole) {
    const content = lookup((whole[1] ?? whole[2]).toLowerCase(), state);
    if (content === undefined) return value;
    state.replaced++;
    if (expectsStructured(schema)) {
      try {
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
        // No es JSON: se entrega como string y la validación del tool lo reportará.
      }
    }
    return content;
  }

  return value.replace(EMBEDDED_REF, (match, rawKey: string) => {
    const content = lookup(rawKey.toLowerCase(), state);
    if (content === undefined) return match;
    state.replaced++;
    return content;
  });
}

function resolveValue(value: unknown, schema: unknown, state: ResolutionState): unknown {
  if (typeof value === "string") return resolveString(value, schema, state);

  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema) ? schema.items : undefined;
    return value.map((item) => resolveValue(item, itemSchema, state));
  }

  if (isRecord(value)) {
    const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        resolveValue(v, Object.hasOwn(props, k) ? props[k] : undefined, state),
      ]),
    );
  }

  return value;
}

/**
 * @param inputSchema Schema real de la tool (`inputSchema`). Sin schema para una propiedad,
 *   el contenido del ref se entrega siempre como string.
 *   No se resuelven `$ref` internos del schema: esas propiedades se tratan como "sin schema".
 */
export function resolveReferences(
  args: Record<string, unknown>,
  taskId: string,
  inputSchema?: Record<string, unknown>,
): ReferenceResolutionResult {
  const state: ResolutionState = {
    taskId,
    resolved: new Set(),
    unresolved: new Set(),
    replaced: 0,
  };

  const resolvedArgs = resolveValue(args, inputSchema, state) as Record<string, unknown>;

  return {
    resolvedArgs,
    replacedCount: state.replaced,
    resolvedRefs: [...state.resolved],
    unresolvedRefs: [...state.unresolved],
  };
}