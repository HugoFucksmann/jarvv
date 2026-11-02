/**
 * JARVIS Core — Resolvedor determinista de referencias (PLAN_CONTEXT v0.29, 5.2).
 * Sustituye `{{ref:rN}}` en los argumentos propuestos por el modelo, antes de Guard y del despacho MCP, por el
 * texto crudo guardado en disco.
 *
 * Formas aceptadas (el prefijo `ref:` es obligatorio):
 * - Embebida en cualquier string: `{{ref:r1}}`
 * - Valor completo del argumento:  `{{ref:r1}}` o `ref:r1`
 *
 * Un `r1` desnudo NO es una referencia. Solo se aceptan ids `r<número>` de la propia tarea: el `lookup` que recibe
 * quien llama es el de esa tarea. El contenido sustituido nunca se vuelve a escanear (sin referencias anidadas).
 * Una referencia desconocida o ilegible queda literal en el resultado y se informa en `unresolvedRefs`: quien llama la
 * trata como `status = refs_unresolved`.
 *
 * El resolvedor no conoce el contexto ni el disco: recibe un `RefLookup` (id → texto). `createRefLookup` arma uno a
 * partir de `ctx.get(rN).where` y `vault.readAll`.
 */

import type { ContextElement, Ref } from "../ctx/index.ts";
import { isRecord } from "../utils.ts";
import type { RefVault } from "./refVault.ts";

/** Objeto mínimo que el resolvedor necesita: el texto de una ref por id, o `undefined` si no existe o no se puede leer. */
export interface RefLookup {
  get(id: string): Promise<string | undefined>;
}

export interface ReferenceResolutionResult {
  resolvedArgs: Record<string, unknown>;
  replacedCount: number;
  resolvedRefs: string[];
  /** Referencias desconocidas o ilegibles; permanecen literales en `resolvedArgs`. El llamador debe tratarlas como error. */
  unresolvedRefs: string[];
}

/** Lo que `createRefLookup` usa del contexto (lo cumple `TaskContext`). */
export interface RefElementSource {
  get(id: string): Readonly<ContextElement> | undefined;
}

const EMBEDDED_REF = /\{\{ref:(r\d+)\}\}/gi;
const WHOLE_REF = /^(?:\{\{ref:(r\d+)\}\}|ref:(r\d+))$/i;

/** ¿El valor completo es un token de referencia (`{{ref:rX}}` o `ref:rX`)? */
export const isWholeRefToken = (value: unknown): boolean =>
  typeof value === "string" && WHOLE_REF.test(value.trim());

function isRefElement(element: Readonly<ContextElement>): element is Readonly<Ref> {
  return "where" in element && typeof element.where === "string";
}

/** Une `ctx.get(id)` (para obtener `where`) con `vault.readAll` (para leer el texto). Cualquier fallo da `undefined`. */
export function createRefLookup(source: RefElementSource, vault: Pick<RefVault, "readAll">): RefLookup {
  return {
    async get(id: string): Promise<string | undefined> {
      const element = source.get(id);
      if (element === undefined || !isRefElement(element)) return undefined;
      try {
        return await vault.readAll(element.where);
      } catch (error) {
        console.warn(`[RefResolver] No se pudo leer la referencia '${id}': ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    },
  };
}

interface ResolutionState {
  lookup: RefLookup;
  /** Cada ref se lee una sola vez por llamada a `resolveRefs`. */
  cache: Map<string, string | undefined>;
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

async function fetchRef(key: string, state: ResolutionState): Promise<string | undefined> {
  if (state.cache.has(key)) return state.cache.get(key);
  const content = await state.lookup.get(key);
  state.cache.set(key, content);
  if (content === undefined) {
    state.unresolved.add(key);
    console.warn(`[RefResolver] Referencia '${key}' no encontrada o ilegible.`);
  } else {
    state.resolved.add(key);
  }
  return content;
}

async function resolveString(value: string, schema: unknown, state: ResolutionState): Promise<unknown> {
  const whole = WHOLE_REF.exec(value.trim());
  if (whole) {
    const content = await fetchRef((whole[1] ?? whole[2]).toLowerCase(), state);
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

  const keys = [...value.matchAll(EMBEDDED_REF)].map((m) => m[1].toLowerCase());
  if (keys.length === 0) return value;
  const contents = new Map<string, string | undefined>();
  for (const key of keys) {
    if (!contents.has(key)) contents.set(key, await fetchRef(key, state));
  }
  return value.replace(EMBEDDED_REF, (match, rawKey: string) => {
    const content = contents.get(rawKey.toLowerCase());
    if (content === undefined) return match;
    state.replaced++;
    return content;
  });
}

async function resolveValue(value: unknown, schema: unknown, state: ResolutionState): Promise<unknown> {
  if (typeof value === "string") return resolveString(value, schema, state);

  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema) ? schema.items : undefined;
    const items: unknown[] = [];
    for (const item of value) items.push(await resolveValue(item, itemSchema, state));
    return items;
  }

  if (isRecord(value)) {
    const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
    const entries: [string, unknown][] = [];
    for (const [k, v] of Object.entries(value)) {
      entries.push([k, await resolveValue(v, Object.hasOwn(props, k) ? props[k] : undefined, state)]);
    }
    return Object.fromEntries(entries);
  }

  return value;
}

/**
 * @param lookup Texto de las refs de la propia tarea (ver `createRefLookup`).
 * @param inputSchema Schema real de la tool (`inputSchema`). Sin schema para una propiedad,
 *   el contenido del ref se entrega siempre como string.
 *   No se resuelven `$ref` internos del schema: esas propiedades se tratan como "sin schema".
 */
export async function resolveRefs(
  args: Record<string, unknown>,
  lookup: RefLookup,
  inputSchema?: Record<string, unknown>,
): Promise<ReferenceResolutionResult> {
  const state: ResolutionState = {
    lookup,
    cache: new Map(),
    resolved: new Set(),
    unresolved: new Set(),
    replaced: 0,
  };

  const resolvedArgs = (await resolveValue(args, inputSchema, state)) as Record<string, unknown>;

  return {
    resolvedArgs,
    replacedCount: state.replaced,
    resolvedRefs: [...state.resolved],
    unresolvedRefs: [...state.unresolved],
  };
}
