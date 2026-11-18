/**
 * JARVIS Core — Escritura idempotente de `recalled` en `TaskContext` (`MEMORIA_CONTEXTO_DISENO.md` §7.2–§7.4).
 *
 * Los aportes de memoria externa (`user_memory`) y el hilo de la tarea anterior (`thread`) entran al contexto
 * por `apply` sin duplicar `(source, key)`.
 */

import type { Op, RecalledInput, TaskContext } from "../ctx/index.ts";
import { RECALLED_SOURCE_POLICY } from "../recalledPolicy.ts";
import type { EngineEnv } from "./env.ts";

/** Registra aportes nuevos en `recalled` en un único lote de `apply`, omitiendo `(source, key)` ya presentes. */
export function recordRecalled(ctx: TaskContext, entries: readonly RecalledInput[]): void {
  if (ctx.isClosed() || entries.length === 0) return;
  const existing = ctx.find("recalled", {});
  const seen = new Set(existing.map((r) => `${r.source}\u0000${r.key}`));
  const ops: Op[] = [];
  for (const entry of entries) {
    const k = `${entry.source}\u0000${entry.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ops.push({ op: "add", target: "recalled", value: entry });
  }
  if (ops.length > 0 && !ctx.isClosed()) {
    ctx.apply(ops);
  }
}

/** Consulta el proveedor de memoria externa con `text` y registra los hechos nuevos en `recalled`. */
export async function recordUserMemory(env: EngineEnv, text: string, stepId: string | null): Promise<void> {
  if (!env.memory || env.runtime.cancelled || env.ctx.isClosed()) return;
  const limit = RECALLED_SOURCE_POLICY.user_memory.maxPerPrompt;
  const facts = await env.memory.recall(text, limit);
  if (env.runtime.cancelled || env.ctx.isClosed() || facts.length === 0) return;
  recordRecalled(
    env.ctx,
    facts.map((f) => ({
      stepId,
      source: "user_memory" as const,
      key: f.key,
      value: f.value,
      from: null,
    })),
  );
}

/** Al iniciar la tarea: escribe en `recalled` los hechos del usuario para el `request` y, si hay hilo activo, ambas entradas de `thread`. */
export async function recordInitialRecalled(env: EngineEnv): Promise<void> {
  const entries: RecalledInput[] = [];
  if (env.memory && !env.runtime.cancelled && !env.ctx.isClosed()) {
    const facts = await env.memory.recall(env.ctx.task.request, RECALLED_SOURCE_POLICY.user_memory.maxPerPrompt);
    for (const f of facts) {
      entries.push({ stepId: null, source: "user_memory", key: f.key, value: f.value, from: null });
    }
  }
  if (env.runtime.cancelled || env.ctx.isClosed()) return;
  if (env.state.thread !== null) {
    const from = env.deps.previousTaskId ?? null;
    entries.push(
      { stepId: null, source: "thread", key: "previous_request", value: env.state.thread.request, from },
      { stepId: null, source: "thread", key: "previous_answer", value: env.state.thread.answer, from },
    );
  }
  recordRecalled(env.ctx, entries);
}
