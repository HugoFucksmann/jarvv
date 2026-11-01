/**
 * Lectura (sección 6, "Lectura"): `get`, `find` y `current`. Funciones puras sobre `ContextData`; no mutan nada.
 * Cualquier consulta más rica es una vista derivada (Fase 2).
 */

import { parseId } from "./ids.ts";
import type { ContextData, ContextElement, CurrentView, ElementOf, SectionName } from "./types.ts";

const FACT_PREFIX = "facts.";

/** `ctx.get(id)`: un elemento por `id`; `facts.<clave>` para un hecho. `undefined` si no existe. */
export function getElement(data: ContextData, id: string): ContextElement | undefined {
  if (id.startsWith(FACT_PREFIX)) {
    const key = id.slice(FACT_PREFIX.length);
    return Object.prototype.hasOwnProperty.call(data.facts, key) ? data.facts[key] : undefined;
  }
  const parsed = parseId(id);
  if (parsed === null) return undefined;
  const element: ContextElement | undefined = data[parsed.section][parsed.index];
  return element !== undefined && "id" in element && element.id === id ? element : undefined;
}

/**
 * `ctx.find(sección, where)`: elementos de una sección que cumplen la igualdad (`===`) de todos los campos de
 * `where`, incluidos los reemplazados por un replan. Un campo `undefined` en `where` se ignora.
 */
export function findElements<S extends SectionName>(
  data: ContextData,
  section: S,
  where: Partial<ElementOf<S>>,
): ElementOf<S>[] {
  const elements = data[section] as unknown as ElementOf<S>[];
  const conditions = Object.entries(where as unknown as Record<string, unknown>).filter(([, expected]) => expected !== undefined);
  return elements.filter((element) =>
    conditions.every(([field, expected]) => (element as unknown as Record<string, unknown>)[field] === expected),
  );
}

/**
 * `ctx.current()`: `step` es el paso vigente `running` o, si no hay, el primer vigente `pending`;
 * `lastCall` es el último elemento de `calls`.
 */
export function currentOf(data: ContextData): CurrentView {
  let firstPending: ContextData["steps"][number] | null = null;
  let running: ContextData["steps"][number] | null = null;
  for (const step of data.steps) {
    if (step.superseded) continue;
    if (step.state === "running") {
      running = step;
      break;
    }
    if (step.state === "pending" && firstPending === null) firstPending = step;
  }
  const lastCall = data.calls.length > 0 ? data.calls[data.calls.length - 1] : null;
  return { step: running ?? firstPending, lastCall };
}
