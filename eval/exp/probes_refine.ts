/**
 * eval/exp/probes_refine.ts
 *
 * Experimento (no es una etapa): afina las sondas que fallaban en amplitud. `finished` solo cuando el resultado dice «en curso» (no cambia nada: producción ya rechaza esos casos) y
 * `attrs` en dos etapas (¿el paso pide ordenar o elegir por una propiedad? y, solo si sí, ¿el resultado la muestra?): FP 2→0 sin falsos rechazos.
 * Uso: npx tsx eval/exp/probes_refine.ts [modelo]
 */
import { readFileSync } from "node:fs";
import { loadDatasets } from "../core/datasets.ts";
import { materializeScenario } from "../core/scenario.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const noul = (instructions: string) => ({ type: "noul", instructions });
interface Call { tool: string; args: Record<string, unknown>; summary: string }
async function ask(state: string, q: unknown): Promise<number> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions: { q }, keep_alive: "10m" }) });
  return ((await r.json()) as { answers: { q: { noul: number } } }).answers.q.noul;
}
async function askAll(state: string, qs: Record<string, unknown>): Promise<Record<string, number>> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions: qs, keep_alive: "10m" }) });
  const j = (await r.json()) as { answers: Record<string, { noul: number }> };
  return Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul]));
}

interface Item { id: string; ds: string; label: boolean; prod: number; step: string; call: Call }
const items: Item[] = [];
const collect = async (id: string, ds: string, scenario: Record<string, unknown>, label: boolean): Promise<void> => {
  const m = materializeScenario("result_verification", scenario as never).request as unknown as { state: string; questions: Record<string, unknown> };
  const a = await askAll(m.state, m.questions);
  const calls = scenario.calls as Call[];
  const at = scenario.at as { call?: number } | undefined;
  const call = calls[typeof at?.call === "number" ? at.call : calls.length - 1];
  items.push({ id, ds, label, prod: Math.min(m.questions.ok === undefined ? 1 : a.ok, a.cumple), step: /^Step: (.*)$/m.exec(m.state)?.[1] ?? (scenario.request as string), call });
};
for (const ds of loadDatasets(["eval/datasets/d4/*.jsonl"], { stages: ["result_verification"] })) {
  const byId = new Map(readFileSync(ds.path, "utf8").split("\n").filter((l) => l.trim().startsWith("{")).map((l) => { const o = JSON.parse(l); return [o.id as string, o] as const; }));
  for (const c of ds.cases) { const o = byId.get(c.id); const e = c.expect as { expectedOk: boolean; expectedCumple: boolean }; if (o?.scenario) await collect(c.id, ds.name, o.scenario, e.expectedOk && e.expectedCumple); }
}
for (const l of readFileSync(new URL("./hard_cases.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); if (r.kind !== "close") await collect(r.id, "hard", r.scenario, r.pair === "good"); }

const rep = (title: string, rows: Item[], extra: (i: Item) => Promise<boolean>): Promise<void> => (async () => {
  let fp0 = 0, fn0 = 0, fp1 = 0, fn1 = 0, applied = 0, rightFlips = 0, wrongFlips = 0;
  for (const i of rows) {
    const base = i.prod >= 0.6;
    const ap = base && (await extra(i));
    if (base !== ap) { applied++; if (i.label) wrongFlips++; else rightFlips++; }
    if (base && !i.label) fp0++; if (!base && i.label) fn0++;
    if (ap && !i.label) fp1++; if (!ap && i.label) fn1++;
  }
  console.log(`RESULT ${title.padEnd(52)} n=${rows.length} | producción FP ${fp0} FN ${fn0} | con la sonda FP ${fp1} FN ${fn1} | rechaza bien ${rightFlips}, rechaza mal ${wrongFlips}`);
})();

const cmd = items.filter((i) => i.call.tool === "run_command");
const running = (c: Call): boolean => /\b(running|started|pid)\b/i.test(c.summary) && !/exit code|finished/i.test(c.summary);
console.log(`RESULT run_command: ${cmd.length} filas; con marca de proceso en curso: ${cmd.filter((i) => running(i.call)).length} (etiqueta «aprobar» en ${cmd.filter((i) => running(i.call) && i.label).length})`);
await rep("finished (todas las run_command), pregunta de hoy", cmd, async (i) => (await ask(`Step: ${i.step}\nResult:\n${i.call.summary.slice(0, 400)}`, noul("Has the work finished? A process that was only started, or is still running or waiting, is not finished."))) >= 0.6);
await rep("finished SOLO si el resultado dice «en curso»", cmd, async (i) => !running(i.call) || (await ask(`Step: ${i.step}\nResult:\n${i.call.summary.slice(0, 400)}`, noul("Has the work finished? A process that was only started, or is still running or waiting, is not finished."))) >= 0.6);
await rep("en curso + «¿el paso necesita que termine?»", cmd, async (i) => {
  if (!running(i.call)) return true;
  const needs = await ask(`Step: ${i.step}`, noul("Does the step need the result or output of the command (not just to start it)?"));
  return needs < 0.6;
});

const ls = items.filter((i) => i.call.tool === "list_directory");
await rep("attrs en una consulta (la de hoy)", ls, async (i) => (await ask(`Step: ${i.step}\nResult:\n${i.call.summary.slice(0, 400)}`, noul("To answer the step, do the items need dates, sizes or an order? If so, does the result show them?"))) >= 0.6);
await rep("attrs en dos etapas (¿pide ordenar?, ¿lo muestra?)", ls, async (i) => {
  const asks = await ask(`Step: ${i.step}`, noul("Does the step ask to choose or order the items by a property such as recent, large, old, by size or by date?"));
  if (asks < 0.6) return true;
  return (await ask(`Step: ${i.step}\nResult:\n${i.call.summary.slice(0, 400)}`, noul("Does the result show that property (dates or sizes) for the items?"))) >= 0.6;
});
