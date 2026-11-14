/**
 * eval/exp/question_sets_d4.ts
 *
 * Experimento (no es una etapa): ¿agregar preguntas `noul` a la verificación (D4) sobre el MISMO estado mejora los falsos positivos y negativos? Mide los 184 casos de
 * `eval/datasets/d4/` con la pregunta de producción y 4 extra (`error`, `answered`, `other`, `missing`) en una sola consulta y vuelca las respuestas a un JSON;
 * `question_sets_report.cjs` calcula los conjuntos y los umbrales. Resultado (2026-11-14, d3:2b-text): ninguna combinación pasa de 81-82 % (+/- 1 caso).
 * Uso: npx tsx eval/exp/question_sets_d4.ts [modelo] [salida.json]
 */
import { writeFileSync } from "node:fs";
import { loadDatasets } from "../core/datasets.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";

const extra: Record<string, { instructions: string; goodWhenTrue: boolean }> = {
  error: { instructions: "Is the result an error, a failure message or empty?", goodWhenTrue: false },
  answered: { instructions: "Does the result contain the specific information or effect that the step asks for?", goodWhenTrue: true },
  other: { instructions: "Does the result show something different from what the step asks for (another file, folder or topic)?", goodWhenTrue: false },
  missing: { instructions: "Is any part of the step still not done?", goodWhenTrue: false },
};
const noul = (instructions: string) => ({ type: "noul", instructions });

type Row = { id: string; dataset: string; ok: boolean; cumple: boolean; a: Record<string, number> };
const rows: Row[] = [];
const datasets = loadDatasets(["eval/datasets/d4/*.jsonl"], { stages: ["result_verification"] });
for (const ds of datasets) {
  for (const c of ds.cases) {
    if (c.request.type !== "decision") continue;
    const e = c.expect as { expectedOk: boolean; expectedCumple: boolean };
    const questions: Record<string, unknown> = { ...c.request.questions };
    for (const [k, v] of Object.entries(extra)) questions[k] = noul(v.instructions);
    const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state: c.request.state, questions, keep_alive: "10m" }) });
    const j = (await r.json()) as { answers: Record<string, { noul: number }> };
    const a: Record<string, number> = {};
    for (const k of Object.keys(j.answers)) a[k] = j.answers[k].noul;
    rows.push({ id: c.id, dataset: ds.name, ok: e.expectedOk, cumple: e.expectedCumple, a });
  }
}
writeFileSync(process.argv[3] ?? "d4_rows.json", JSON.stringify(rows));
const T = 0.6;
const good = (r: Row, k: string): number => (extra[k]?.goodWhenTrue === false ? 1 - r.a[k] : r.a[k]); // probabilidad de «bien» de cada pregunta
const label = (r: Row): boolean => r.ok && r.cumple;
const sets: Record<string, string[]> = {
  "prod: ok + cumple": ["ok", "cumple"],
  "+ error": ["ok", "cumple", "error"],
  "+ answered": ["ok", "cumple", "answered"],
  "+ other": ["ok", "cumple", "other"],
  "+ missing": ["ok", "cumple", "missing"],
  "+ error + other": ["ok", "cumple", "error", "other"],
  "+ answered + missing": ["ok", "cumple", "answered", "missing"],
  "las 6": ["ok", "cumple", "error", "answered", "other", "missing"],
  "solo cumple": ["cumple"],
  "cumple + answered": ["cumple", "answered"],
};
const pos = rows.filter(label).length;
console.log(`RESULT n=${rows.length} (con veredicto «aprobar» ${pos}, «rechazar» ${rows.length - pos}) modelo ${MODEL}`);
console.log("RESULT " + "set".padEnd(24) + "FP(aprueba mal)  FN(rechaza bien)  aciertos");
for (const [name, keys] of Object.entries(sets)) {
  let fp = 0, fn = 0;
  for (const r of rows) {
    const approve = keys.every((k) => good(r, k) >= T);
    if (approve && !label(r)) fp++;
    if (!approve && label(r)) fn++;
  }
  console.log(`RESULT ${name.padEnd(24)}${String(fp).padStart(4)}/${rows.length - pos}${" ".repeat(11)}${String(fn).padStart(4)}/${pos}${" ".repeat(11)}${rows.length - fp - fn}/${rows.length}`);
}
// Umbral sobre el mínimo de las probabilidades de «bien»: ¿hay un umbral que separe mejor?
console.log("RESULT --- umbral sobre el mínimo de las preguntas (set «las 6» y set prod)");
for (const [name, keys] of [["prod", sets["prod: ok + cumple"]], ["las 6", sets["las 6"]], ["+ answered + missing", sets["+ answered + missing"]]] as const) {
  const line: string[] = [];
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    let fp = 0, fn = 0;
    for (const r of rows) {
      const approve = Math.min(...keys.map((k) => good(r, k))) >= t;
      if (approve && !label(r)) fp++;
      if (!approve && label(r)) fn++;
    }
    line.push(`t${t}: FP${fp} FN${fn}`);
  }
  console.log(`RESULT ${name.padEnd(22)} ${line.join(" | ")}`);
}
// Dónde discrepan las preguntas con el veredicto de producción
const disagree = rows.filter((r) => (good(r, "ok") >= T && good(r, "cumple") >= T) !== (["error", "answered", "other", "missing"].every((k) => good(r, k) >= T)));
console.log(`RESULT casos en que producción y las 4 extra discrepan: ${disagree.length}; de ellos el veredicto correcto lo da: producción ${disagree.filter((r) => (good(r, "ok") >= T && good(r, "cumple") >= T) === label(r)).length}, extra ${disagree.filter((r) => (["error", "answered", "other", "missing"].every((k) => good(r, k) >= T)) === label(r)).length}`);
