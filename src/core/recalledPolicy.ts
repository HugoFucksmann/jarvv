/**
 * JARVIS Core — Registro de política de fuentes para `recalled` (`MEMORIA_CONTEXTO_DISENO.md` §7.2 y §8).
 *
 * La confianza y visibilidad de cada aporte se derivan de su `source` en esta tabla única,
 * nunca se guardan por entrada ni las declara el proveedor externo.
 */

import { BUDGET } from "./budget.ts";
import type { RecalledFilterOptions, RecalledSource } from "./ctx/index.ts";

type RecalledTrust = "user" | "assistant_history";
type RecalledViewConsumer = "forArgs" | "forFinal" | "forPlan" | "forPending";

interface RecalledSourcePolicy {
  readonly trust: RecalledTrust;
  readonly views: readonly RecalledViewConsumer[];
  readonly maxPerPrompt: number;
  readonly precheckSource: boolean;
}

export const RECALLED_SOURCE_POLICY: Readonly<Record<RecalledSource, RecalledSourcePolicy>> = {
  user_memory: {
    trust: "user",
    views: ["forArgs", "forFinal"],
    maxPerPrompt: BUDGET.caps.recalled,
    precheckSource: true,
  },
  thread: {
    trust: "assistant_history",
    views: ["forArgs", "forFinal"],
    maxPerPrompt: 2,
    precheckSource: true,
  },
};

const ALL_SOURCES = Object.keys(RECALLED_SOURCE_POLICY) as RecalledSource[];

/** Filtro de `recalled` para una vista según el registro de políticas. */
export function recalledFilterFor(view: RecalledViewConsumer): RecalledFilterOptions {
  const sources: RecalledSource[] = [];
  const maxBySource: Partial<Record<RecalledSource, number>> = {};
  for (const source of ALL_SOURCES) {
    const policy = RECALLED_SOURCE_POLICY[source];
    if (!policy.views.includes(view)) continue;
    sources.push(source);
    maxBySource[source] = policy.maxPerPrompt;
  }
  return { sources, maxBySource };
}

/** ¿Esta fuente de `recalled` es válida como origen para el pre-chequeo determinista? */
export function isPrecheckSource(source: RecalledSource): boolean {
  return RECALLED_SOURCE_POLICY[source].precheckSource;
}
