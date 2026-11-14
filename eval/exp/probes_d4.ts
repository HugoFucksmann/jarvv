/**
 * eval/exp/probes_d4.ts
 *
 * Experimento (no es una etapa): sondas por herramienta (posición en `write_file`, ítem en Excel, alcance en `start_search`, atributo en `list_directory`, terminado en `run_command`)
 * aplicadas solo donde corresponde, sobre los 184 casos de D4 y las filas de `hard_cases.jsonl`. Mide cuánto cambian los falsos positivos y negativos de producción.
 * Uso: npx tsx eval/exp/probes_d4.ts [modelo] [salida.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadDatasets } from "../core/datasets.ts";
import { materializeScenario } from "../core/scenario.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const OUT = process.argv[3] ?? "probes_rows.json";
const noul = (instructions: string) => ({ type: "noul", instructions });

interface Call { tool: string; args: Record<string, unknown>; summary: string; status: string }
type Probe = { name: string; applies: (c: Call) => boolean; build: (step: string, c: Call) => { state: string; q: unknown; bad?: boolean } };
const probes: Probe[] = [
  {
    name: "position", applies: (c) => c.tool === "write_file" && (c.args.mode === "append" || c.args.mode === "rewrite" || c.args.mode === undefined),
    build: (step, c) => ({
      state: `Step: ${step}\n${c.args.mode === "append" ? "Text added at the END of the file." : `New file content (first line): ${JSON.stringify(String(c.args.content ?? "").split("\n")[0])}`}`,
      q: noul("If the step asks for the START of the file, is the text at the start? If the step asks for the end, is it at the end?"),
    }),
  },
  {
    name: "item", applies: (c) => c.tool === "read_file" && /\.(xlsx|xls|xlsm)$/i.test(String(c.args.path ?? "")),
    build: (step, c) => ({ state: `Step: ${step}\nArguments sent: ${JSON.stringify(c.args)}\nWhat the tool returned (first lines):\n${c.summary.slice(0, 300)}`, q: noul("The step names a specific item. Was a default or a different item read instead?"), bad: true }),
  },
  {
    name: "scope", applies: (c) => c.tool === "start_search",
    build: (step, c) => ({ state: `The user asked for: ${step}\nThe search looked only for names matching: ${c.args.pattern}`, q: noul("Are the two the same set of files?") }),
  },
  {
    name: "attrs", applies: (c) => c.tool === "list_directory",
    build: (step, c) => ({ state: `Step: ${step}\nResult:\n${c.summary.slice(0, 400)}`, q: noul("To answer the step, do the items need dates, sizes or an order? If so, does the result show them?") }),
  },
  {
    name: "finished", applies: (c) => c.tool === "run_command",
    build: (step, c) => ({ state: `Step: ${step}\nResult:\n${c.summary.slice(0, 400)}`, q: noul("Has the work finished? A process that was only started, or is still running or waiting, is not finished.") }),
  },
];

async function ask(state: string, questions: Record<string, unknown>): Promise<Record<string, number>> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions, keep_alive: "10m" }) });
  const j = (await r.json()) as { answers: Record<string, { noul: number }> };
  return Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul]));
}

type Out = { id: string; dataset: string; label: boolean; ok: number; cumple: number; probe?: string; p?: number };
const outRows: Out[] = [];
const add = async (id: string, dataset: string, scenario: Record<string, unknown>, ok: boolean, cumple: boolean): Promise<void> => {
  const m = materializeScenario("result_verification", scenario as never).request as unknown as { state: string; questions: Record<string, unknown> };
  const a = await ask(m.state, m.questions);
  const calls = (scenario.calls as Call[]) ?? [];
  const idx = typeof (scenario.at as { call?: number } | undefined)?.call === "number" ? (scenario.at as { call: number }).call : calls.length - 1;
  const call = calls[idx];
  const step = /^Step: (.*)$/m.exec(m.state)?.[1] ?? (scenario.request as string);
  const row: Out = { id, dataset, label: ok && cumple, ok: m.questions.ok === undefined ? 1 : a.ok, cumple: a.cumple };
  const probe = call === undefined ? undefined : probes.find((p) => p.applies(call));
  if (probe !== undefined && call !== undefined) {
    const b = probe.build(step, call);
    const p = (await ask(b.state, { q: b.q })).q;
    row.probe = probe.name;
    row.p = b.bad ? 1 - p : p;
  }
  outRows.push(row);
};

// 1) los 184 casos de D4
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
// 2) los casos difíciles
for (const l of readFileSync(new URL("./hard_cases.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.kind === "close") continue;
  await add(r.id, "hard", r.scenario, r.pair === "good", r.pair === "good");
}
writeFileSync(OUT, JSON.stringify(outRows));

const report = (name: string, rows: Out[], f: (r: Out) => boolean): void => {
  let fp = 0, fn = 0;
  for (const r of rows) { const ap = f(r); if (ap && !r.label) fp++; if (!ap && r.label) fn++; }
  const neg = rows.filter((r) => !r.label).length, pos = rows.length - neg;
  console.log(`RESULT ${name.padEnd(46)} FP ${String(fp).padStart(2)}/${neg} FN ${String(fn).padStart(2)}/${pos} aciertos ${rows.length - fp - fn}/${rows.length}`);
};
for (const [title, rows] of [["D4 (184 casos)", outRows.filter((r) => r.dataset !== "hard")], ["difíciles (14 filas con herramienta)", outRows.filter((r) => r.dataset === "hard")]] as const) {
  console.log(`RESULT ===== ${title}`);
  const prod = (r: Out): boolean => Math.min(r.ok, r.cumple) >= 0.6;
  report("producción (ok, cumple ≥ 0,6)", rows, prod);
  report("producción a 0,8", rows, (r) => Math.min(r.ok, r.cumple) >= 0.8);
  for (const t of [0.6, 0.8]) report(`producción + sondas por herramienta ≥ ${t}`, rows, (r) => prod(r) && (r.p === undefined || r.p >= t));
  for (const name of probes.map((p) => p.name)) {
    const withProbe = rows.filter((r) => r.probe === name);
    if (withProbe.length === 0) continue;
    const flipRight = withProbe.filter((r) => prod(r) && (r.p as number) < 0.6 && !r.label).length;
    const flipWrong = withProbe.filter((r) => prod(r) && (r.p as number) < 0.6 && r.label).length;
    const missed = withProbe.filter((r) => prod(r) && (r.p as number) >= 0.6 && !r.label).length;
    console.log(`RESULT    sonda ${name.padEnd(9)} aplica a ${String(withProbe.length).padStart(2)} filas | rechaza bien ${flipRight}, rechaza mal ${flipWrong} | malas que deja pasar ${missed}`);
  }
}
