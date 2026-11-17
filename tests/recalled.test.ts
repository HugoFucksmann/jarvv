/**
 * Memoria externa y sección `recalled` (`MEMORIA_CONTEXTO_DISENO.md` §7 y §8): el paquete de memoria (aliases, plurales, prioridad por especificidad, independencia),
 * la escritura idempotente en el contexto, la política de fuentes y qué vistas leen `recalled` en v1.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ContextError } from "../src/core/ctx/errors.ts";
import type { RecalledInput } from "../src/core/ctx/index.ts";
import { argsViewOptions, finalViewOptions } from "../src/core/engine/adapters.ts";
import type { EngineEnv } from "../src/core/engine/env.ts";
import { collectSources, precheckCall } from "../src/core/engine/precheck.ts";
import { recordInitialRecalled, recordRecalled, recordUserMemory } from "../src/core/engine/recalled.ts";
import { renderArgs } from "../src/core/render/index.ts";
import { argsRenderOptions } from "../src/core/engine/adapters.ts";
import { RECALLED_SOURCE_POLICY, isPrecheckSource, recalledFilterFor } from "../src/core/recalledPolicy.ts";
import { BUDGET } from "../src/core/budget.ts";
import { MAX_FACTS_PER_PROMPT, createJsonMemoryProvider, parseFacts, selectFacts, stemsOf } from "../src/memory/index.ts";
import type { MemoryProvider } from "../src/memory/index.ts";
import { newContext } from "./fixtures.ts";

const memory = (value: Partial<RecalledInput> = {}): RecalledInput => ({ stepId: null, source: "user_memory", key: "carpeta jarvis", value: "C:\\Users\\Ana\\jarvis", from: null, ...value });
const addMemory = (value: Partial<RecalledInput> = {}) => ({ op: "add", target: "recalled", value: memory(value) }) as const;

// ───────────────────────── Paquete de memoria ─────────────────────────

test("memoria: los alias de un hecho también lo seleccionan", () => {
  const facts = parseFacts([{ key: "carpeta jarvis", value: "C:\\jarvis", aliases: ["mi repo", "proyecto principal"] }]);
  assert.deepEqual(selectFacts("abrí mi repo", facts).map((f) => f.key), ["carpeta jarvis"]);
  assert.deepEqual(selectFacts("listá el proyecto principal", facts).map((f) => f.key), ["carpeta jarvis"]);
  assert.deepEqual(selectFacts("abrí otro repositorio ajeno", facts), []);
});

test("memoria: los alias inválidos o repetidos se descartan y un hecho sin alias sigue igual", () => {
  const [fact] = parseFacts([{ key: "mi editor", value: "code", aliases: ["", "mi editor", "ide", "ide", 5, "x".repeat(81)] }]);
  assert.deepEqual(fact.aliases, ["ide"]);
  assert.equal(parseFacts([{ key: "mi editor", value: "code" }])[0].aliases, undefined);
});

test("memoria: los plurales regulares coinciden con el singular, sin tocar palabras cortas ni terminadas en -ss/-us/-is", () => {
  const facts = parseFacts([{ key: "repo trabajo", value: "D:\\w" }]);
  assert.equal(selectFacts("listá mis repos de trabajos", facts).length, 1, "repos ~ repo, trabajos ~ trabajo");
  assert.deepEqual([...stemsOf("status")], ["statu"], "-us no se recorta");
  assert.deepEqual([...stemsOf("analisis")], ["anali"], "-is no se recorta");
  assert.ok(stemsOf("los gps").size === 0 || !stemsOf("los gps").has("gp"), "palabras de menos de 4 letras no se tocan");
});

test("memoria: gana la clave más específica y el desempate es el orden del archivo", () => {
  const facts = parseFacts([
    { key: "carpeta jarvis", value: "general" },
    { key: "carpeta jarvis backup", value: "específica" },
    { key: "jarvis", value: "corta" },
  ]);
  assert.deepEqual(selectFacts("copiá la carpeta jarvis backup", facts).map((f) => f.value), ["específica", "general", "corta"]);
  assert.deepEqual(selectFacts("copiá la carpeta jarvis backup", facts, 1).map((f) => f.value), ["específica"], "con un solo cupo, la específica");
  // Misma especificidad: orden del archivo.
  const empate = parseFacts([{ key: "carpeta alfa", value: "1" }, { key: "carpeta beta", value: "2" }]);
  assert.deepEqual(selectFacts("carpeta alfa y carpeta beta", empate).map((f) => f.value), ["1", "2"]);
});

test("memoria: el proveedor es asíncrono, respeta el tope y no depende de src/core ni conoce el contexto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-prov-"));
  const file = path.join(dir, "memory.json");
  fs.writeFileSync(file, JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ key: "carpeta jarvis", value: `v${i}` }))));
  const provider: MemoryProvider = createJsonMemoryProvider(file);
  const recalled = await provider.recall("la carpeta jarvis");
  assert.equal(recalled.length, MAX_FACTS_PER_PROMPT);
  assert.equal((await provider.recall("la carpeta jarvis", 2)).length, 2);
  assert.deepEqual(await provider.recall("otra cosa"), []);
  assert.deepEqual(await createJsonMemoryProvider(path.join(dir, "no-existe.json")).recall("carpeta jarvis"), [], "archivo ausente: memoria vacía, nunca un error");
  fs.rmSync(dir, { recursive: true, force: true });

  const source = fs.readFileSync(new URL("../src/memory/index.ts", import.meta.url), "utf8");
  assert.equal(/from\s+["'][^"']*core\//.test(source), false, "el paquete no importa nada de src/core");
});

// ───────────────────────── Escritura en el contexto ─────────────────────────

test("recalled: un aporte válido entra por `apply` con id propio e instante, y no se puede modificar después", () => {
  const ctx = newContext("reactive");
  const { ids } = ctx.apply(addMemory());
  const [entry] = ctx.find("recalled", {});
  assert.equal(entry.id, ids[0]);
  assert.equal(entry.key, "carpeta jarvis");
  assert.equal(typeof entry.at, "number");
  assert.throws(() => ctx.apply({ op: "update", target: entry.id, value: { value: "otro" } } as never), ContextError);
});

test("recalled: se valida fuente, topes por fuente, pasos inexistentes y campos desconocidos (sin recortar)", () => {
  const ctx = newContext("reactive");
  assert.throws(() => ctx.apply(addMemory({ source: "inventada" as never })), ContextError);
  assert.throws(() => ctx.apply(addMemory({ key: "k".repeat(BUDGET.recalledKeyMax + 1) })), /tope/);
  assert.throws(() => ctx.apply(addMemory({ value: "v".repeat(BUDGET.recalledValueMax + 1) })), /tope/, "los hechos del usuario tienen el tope de 300");
  assert.doesNotThrow(() => ctx.apply(addMemory({ source: "thread", key: "previous_answer", value: "v".repeat(BUDGET.recalledValueMax + 1) })), "el hilo tiene su propio tope");
  assert.throws(() => ctx.apply(addMemory({ source: "thread", key: "previous_answer", value: "v".repeat(BUDGET.threadValueMax + 1) })), /tope/);
  assert.throws(() => ctx.apply(addMemory({ stepId: "s9" })), ContextError, "el paso no existe");
  assert.throws(() => ctx.apply({ op: "add", target: "recalled", value: { ...memory(), extra: 1 } } as never), ContextError);
  assert.equal(ctx.find("recalled", {}).length, 1, "lo rechazado no deja nada");
});

test("recordRecalled: no duplica (fuente, clave), escribe todo lo nuevo en un solo lote y no hace nada con la tarea cerrada", () => {
  const ctx = newContext("reactive");
  recordRecalled(ctx, [memory(), memory({ key: "mi editor", value: "code" })]);
  assert.equal(ctx.find("recalled", {}).length, 2);
  const n = ctx.n;
  recordRecalled(ctx, [memory({ value: "otro valor" }), memory({ source: "thread", key: "carpeta jarvis" })]);
  assert.equal(ctx.find("recalled", {}).length, 3, "solo entra la que cambia de fuente");
  assert.equal(ctx.n, n + 1, "un solo apply para lo nuevo");
  recordRecalled(ctx, [memory({ value: "otro valor" })]);
  assert.equal(ctx.n, n + 1, "sin aportes nuevos no hay apply");
  assert.equal(ctx.find("recalled", {}).find((r) => r.key === "carpeta jarvis" && r.source === "user_memory")?.value, "C:\\Users\\Ana\\jarvis", "los valores quedan congelados");

  ctx.apply({ op: "finish", target: "task", value: { state: "completed", stopReason: null } });
  recordRecalled(ctx, [memory({ key: "otra" })]);
  assert.equal(ctx.find("recalled", {}).length, 3, "tarea cerrada: no escribe");
});

/** Un `EngineEnv` mínimo para las funciones de `engine/recalled.ts`. */
function recallEnv(options: { readonly provider?: MemoryProvider; readonly thread?: { request: string; answer: string }; readonly previousTaskId?: string; readonly cancelled?: boolean } = {}) {
  const ctx = newContext("reactive");
  const env = {
    ctx,
    runtime: { cancelled: options.cancelled === true },
    memory: options.provider,
    follow: { thread: options.thread ?? null },
    deps: { previousTaskId: options.previousTaskId ?? null },
  } as unknown as EngineEnv;
  return { env, ctx };
}

test("recordInitialRecalled: escribe los hechos del pedido y el hilo (dos entradas con `from`) al iniciar la tarea", async () => {
  const asked: { text: string; limit: number | undefined }[] = [];
  const provider: MemoryProvider = { recall: async (text, limit) => (asked.push({ text, limit }), [{ key: "carpeta jarvis", value: "C:\\jarvis" }]) };
  const { env, ctx } = recallEnv({ provider, thread: { request: "antes", answer: "respuesta de antes" }, previousTaskId: "task_1_prev" });
  await recordInitialRecalled(env);
  assert.deepEqual(asked, [{ text: ctx.task.request, limit: RECALLED_SOURCE_POLICY.user_memory.maxPerPrompt }]);
  const entries = ctx.find("recalled", {}).map((r) => ({ source: r.source, key: r.key, value: r.value, from: r.from, stepId: r.stepId }));
  assert.deepEqual(entries, [
    { source: "user_memory", key: "carpeta jarvis", value: "C:\\jarvis", from: null, stepId: null },
    { source: "thread", key: "previous_request", value: "antes", from: "task_1_prev", stepId: null },
    { source: "thread", key: "previous_answer", value: "respuesta de antes", from: "task_1_prev", stepId: null },
  ]);
});

test("recordInitialRecalled y recordUserMemory: sin proveedor, sin hilo o con la tarea cancelada no escriben nada", async () => {
  const none = recallEnv();
  await recordInitialRecalled(none.env);
  await recordUserMemory(none.env, "x", null);
  assert.equal(none.ctx.find("recalled", {}).length, 0);

  const provider: MemoryProvider = { recall: async () => [{ key: "k", value: "v" }] };
  const cancelled = recallEnv({ provider, thread: { request: "a", answer: "b" }, cancelled: true });
  await recordInitialRecalled(cancelled.env);
  await recordUserMemory(cancelled.env, "x", null);
  assert.equal(cancelled.ctx.find("recalled", {}).length, 0);
});

test("recordUserMemory: en cada paso solo agrega lo nuevo, atado al paso", async () => {
  const provider: MemoryProvider = { recall: async (text) => (text.includes("editor") ? [{ key: "mi editor", value: "code" }] : [{ key: "carpeta jarvis", value: "C:\\jarvis" }]) };
  const { env, ctx } = recallEnv({ provider });
  ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "abrir", route: null, expected: null } });
  await recordUserMemory(env, "carpeta", null);
  await recordUserMemory(env, "carpeta", "s1");
  await recordUserMemory(env, "abrir el editor", "s1");
  assert.deepEqual(
    ctx.find("recalled", {}).map((r) => [r.key, r.stepId]),
    [["carpeta jarvis", null], ["mi editor", "s1"]],
    "lo repetido no se vuelve a escribir y cada aporte lleva el paso donde entró",
  );
});

// ───────────────────────── Política y vistas ─────────────────────────

test("política de fuentes: la confianza sale de la fuente, y en v1 solo `forArgs` y `forFinal` leen `recalled`", () => {
  assert.equal(RECALLED_SOURCE_POLICY.user_memory.trust, "user");
  assert.equal(RECALLED_SOURCE_POLICY.thread.trust, "assistant_history");
  assert.equal(RECALLED_SOURCE_POLICY.user_memory.maxPerPrompt, BUDGET.caps.recalled);
  assert.ok(isPrecheckSource("user_memory") && isPrecheckSource("thread"));
  for (const view of ["forArgs", "forFinal"] as const) assert.deepEqual(recalledFilterFor(view).sources, ["user_memory", "thread"], view);
  for (const view of ["forPlan", "forPending"] as const) assert.deepEqual(recalledFilterFor(view).sources, [], `${view} se habilita después, con eval`);
});

test("vistas: `forArgs` y `forFinal` muestran `recalled`; `forReview` (D3) no, y la vista de pendientes y plan tampoco tienen la sección", () => {
  const ctx = newContext("reactive");
  ctx.apply([addMemory(), addMemory({ source: "thread", key: "previous_request", value: "antes" }), addMemory({ source: "thread", key: "previous_answer", value: "respuesta" })]);
  assert.equal(ctx.view.forArgs(argsViewOptions()).recalled.length, 3);
  assert.equal(ctx.view.forFinal(finalViewOptions()).recalled.length, 3);
  assert.equal("recalled" in ctx.view.forReview({ recentWindows: BUDGET.recentWindows, lastReads: BUDGET.caps.lastReads }), false);
  assert.equal("recalled" in ctx.view.forPending([], { recentWindows: BUDGET.recentWindows } as never), false);
  assert.equal("recalled" in ctx.view.forPlan({ recentWindows: BUDGET.recentWindows, feedback: null, previousFeedback: 0, stepsDone: 0 } as never), false);
});

test("vistas: el tope por fuente recorta lo que se muestra pero no lo que se guarda", () => {
  const ctx = newContext("reactive");
  ctx.apply(Array.from({ length: 5 }, (_, i) => addMemory({ key: `clave ${i}`, value: `valor ${i}` })));
  assert.equal(ctx.find("recalled", {}).length, 5);
  const shown = ctx.view.forArgs(argsViewOptions()).recalled.map((r) => r.key);
  assert.equal(shown.length, RECALLED_SOURCE_POLICY.user_memory.maxPerPrompt);
});

test("render: el prompt de argumentos muestra el bloque MEMORY con hechos y con el hilo; sin aportes no cambia ni una línea", () => {
  const ctx = newContext("reactive");
  const without = renderArgs(ctx.view.forArgs(argsViewOptions()), argsRenderOptions()).text;
  assert.equal(without.includes("MEMORY"), false);
  ctx.apply([addMemory(), addMemory({ source: "thread", key: "previous_answer", value: "la respuesta" })]);
  const withFacts = renderArgs(ctx.view.forArgs(argsViewOptions()), argsRenderOptions()).text;
  assert.ok(withFacts.includes("MEMORY") && withFacts.includes("carpeta jarvis: C:\\Users\\Ana\\jarvis") && withFacts.includes("previous answer: la respuesta"));
});

test("pre-chequeo: una ruta que solo está en `recalled` (hecho del usuario o hilo) tiene origen; sin ella se rechaza", async () => {
  const environment = { platform: "windows", home: "C:\\Users\\Ana", desktop: "C:\\Users\\Ana\\Desktop" } as never;
  const args = { path: "D:\\trabajo\\facturas-app" };
  const ask = async (ctx: ReturnType<typeof newContext>) => precheckCall({ tool: "list_directory", kind: "read", args, sources: collectSources(ctx), environment });

  assert.equal((await ask(newContext("reactive")))?.review, "args_invalid", "sin el aporte, la ruta parece inventada");
  const fromMemory = newContext("reactive");
  fromMemory.apply(addMemory({ key: "proyecto de facturación", value: "D:\\trabajo\\facturas-app" }));
  assert.equal(await ask(fromMemory), null);
  const fromThread = newContext("reactive");
  fromThread.apply(addMemory({ source: "thread", key: "previous_answer", value: "Está en D:\\trabajo\\facturas-app" }));
  assert.equal(await ask(fromThread), null);
});
