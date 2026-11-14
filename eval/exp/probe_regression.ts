/**
 * eval/exp/probe_regression.ts
 *
 * Experimento (no es una etapa): regresión de las sondas de PRODUCCIÓN (`src/core/tools/probes.ts`, las del catálogo) sobre los 184 casos de D4 y las filas de `hard_cases.jsonl`.
 * Para cada caso arma la llamada evaluada como la ve el motor (pedido, argumentos, resumen), corre las sondas que el catálogo declara para su herramienta con el mismo cálculo que
 * `engine/probes.ts` (compuerta, `badWhenTrue`, umbral) y las suma al veredicto base de D4 (`ok` y `cumple` ≥ 0,6). Cuenta los falsos negativos que añaden (casos buenos que antes se
 * aprobaban y ahora se rechazan) y los falsos positivos que quitan. Uso: npx tsx eval/exp/probe_regression.ts [modelo] [salida.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadDatasets } from "../core/datasets.ts";
import { materializeScenario } from "../core/scenario.ts";
import { probesOf } from "../../src/core/tools/manifest.ts";
import { GATE_MIN, type Probe, type ProbeCall } from "../../src/core/tools/probes.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const OUT = process.argv[3] ?? "probe_regression_rows.json";

interface RawCall { tool: string; args: Record<string, unknown> | null; summary: string | null; status: string }

async function ask(state: string, questions: Record<string, unknown>): Promise<Record<string, number>> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions, keep_alive: "10m" }) });
  const j = (await r.json()) as { answers: Record<string, { noul: number }> };
  return Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul]));
}

/** Como `engine/probes.ts`: el valor de «bien» de una sonda (mínimo de sus etapas sin compuerta); 1 si la compuerta la deja sin aplicar. */
async function probeValue(call: ProbeCall, probe: Probe): Promise<number> {
  let value = 1;
  for (const stage of probe.stages(call)) {
    const p = (await ask(stage.state, { q: { type: "noul", instructions: stage.question.instructions, criteria: stage.question.criteria } })).q;
    if (stage.gate === true) {
      if (p < GATE_MIN) return 1;
      continue;
    }
    value = Math.min(value, stage.badWhenTrue === true ? 1 - p : p);
  }
  return value;
}

interface Row { id: string; dataset: string; label: boolean; base: number; probes: Record<string, number> }
const rows: Row[] = [];
const add = async (id: string, dataset: string, scenario: Record<string, unknown>, ok: boolean, cumple: boolean): Promise<void> => {
  const m = materializeScenario("result_verification", scenario as never).request as unknown as { state: string; questions: Record<string, unknown> };
  const a = await ask(m.state, m.questions);
  const calls = (scenario.calls as RawCall[]) ?? [];
  const idx = typeof (scenario.at as { call?: number } | undefined)?.call === "number" ? (scenario.at as { call: number }).call : calls.length - 1;
  const raw = calls[idx];
  const row: Row = { id, dataset, label: ok && cumple, base: Math.min(m.questions.ok === undefined ? 1 : a.ok, a.cumple), probes: {} };
  if (raw !== undefined) {
    const request = String(scenario.request ?? /^Step: (.*)$/m.exec(m.state)?.[1] ?? "");
    const call: ProbeCall = { tool: raw.tool, args: raw.args, summary: raw.summary, request, step: request };
    for (const probe of probesOf("desktop_commander", raw.tool)) {
      if (probe.applies(call)) row.probes[probe.id] = await probeValue(call, probe);
    }
  }
  rows.push(row);
};

for (const ds of loadDatasets(["eval/datasets/d4/*.jsonl"], { stages: ["result_verification"] })) {
  const raw = readFileSync(ds.path, "utf8").split("\n").filter((l) => l.trim().startsWith("{"));
  const byId = new Map(raw.map((l) => { const o = JSON.parse(l); return [o.id as string, o] as const; }));
  for (const c of ds.cases) {
    const o = byId.get(c.id);
    if (o === undefined || o.scenario === undefined) continue;
    const e = c.expect as { expectedOk: boolean; expectedCumple: boolean };
    await add(c.id, ds.name, o.scenario, e.expectedOk, e.expectedCumple);
  }
}
for (const l of readFileSync(new URL("./hard_cases.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.kind === "close") continue;
  await add(r.id, "hard", r.scenario, r.pair === "good", r.pair === "good");
}
writeFileSync(OUT, JSON.stringify(rows));

const T = 0.6;
const probed = (r: Row): boolean => Object.values(r.probes).every((v) => v >= T);
const report = (name: string, set: Row[], f: (r: Row) => boolean): void => {
  let fp = 0, fn = 0;
  for (const r of set) { const ap = f(r); if (ap && !r.label) fp++; if (!ap && r.label) fn++; }
  const neg = set.filter((r) => !r.label).length;
  console.log(`RESULT ${name.padEnd(36)} FP ${String(fp).padStart(2)}/${neg} FN ${String(fn).padStart(2)}/${set.length - neg} aciertos ${set.length - fp - fn}/${set.length}`);
};
for (const [title, set] of [["D4 (184 casos)", rows.filter((r) => r.dataset !== "hard")], ["difíciles", rows.filter((r) => r.dataset === "hard")]] as const) {
  console.log(`RESULT ===== ${title}: ${set.length} filas, ${set.filter((r) => Object.keys(r.probes).length > 0).length} con alguna sonda aplicable`);
  report("producción (ok, cumple ≥ 0,6)", set, (r) => r.base >= T);
  report("producción + sondas (≥ 0,6)", set, (r) => r.base >= T && probed(r));
  const ids = [...new Set(set.flatMap((r) => Object.keys(r.probes)))];
  for (const id of ids) {
    const w = set.filter((r) => r.probes[id] !== undefined);
    const approved = w.filter((r) => r.base >= T);
    console.log(`RESULT    sonda ${id.padEnd(9)} aplica a ${String(w.length).padStart(2)} | rechaza bien ${approved.filter((r) => r.probes[id] < T && !r.label).length}, rechaza MAL (falso negativo nuevo) ${approved.filter((r) => r.probes[id] < T && r.label).length} | malas que deja pasar ${approved.filter((r) => r.probes[id] >= T && !r.label).length}`);
  }
  for (const r of set) for (const [id, v] of Object.entries(r.probes)) if (r.base >= T && v < T && r.label) console.log(`RESULT      FN nuevo: ${r.id} (${r.dataset}) sonda ${id} = ${v.toFixed(2)}`);
}
