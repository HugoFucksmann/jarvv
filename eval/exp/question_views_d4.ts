/**
 * eval/exp/question_views_d4.ts
 *
 * Experimento (no es una etapa): la misma pregunta `cumple` de D4 sobre cuatro RENDERIZADOS del mismo resultado (completo, mínimo, resultado primero, entre comillas).
 * Resultado (2026-11-14, d3:2b-text, 184 casos): cada renderizado falla en 31 a 37 casos, los cuatro a la vez en 16 y alguno en 54: los errores se descorrelacionan en parte.
 * Cuando los cuatro coinciden el error es 11 %; cuando discrepan, 42 %. Uso: npx tsx eval/exp/question_views_d4.ts [modelo] [salida.json]
 */
import { writeFileSync } from "node:fs";
import { loadDatasets } from "../core/datasets.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const OUT = process.argv[3] ?? "d4_views.json";

// Misma pregunta (`cumple`) sobre tres RENDERIZADOS distintos del mismo resultado: ¿los errores se descorrelacionan?
const CUMPLE = (instruction: string, expected: string | null) => ({
  type: "noul",
  instructions: `${expected ? "Does the result meet the expected outcome?" : "Does the result accomplish the step?"}`,
  criteria: { true: "Fully meets what was requested.", false: "Incomplete, failed, or different from request." },
});

type Row = { id: string; dataset: string; ok: boolean; cumple: boolean; full: number; minimal: number; reversed: number; quoted: number };
const rows: Row[] = [];
async function ask(state: string, questions: unknown): Promise<number> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions, keep_alive: "10m" }) });
  const j = (await r.json()) as { answers: Record<string, { noul: number }> };
  return j.answers.cumple.noul;
}
for (const ds of loadDatasets(["eval/datasets/d4/*.jsonl"], { stages: ["result_verification"] })) {
  for (const c of ds.cases) {
    if (c.request.type !== "decision") continue;
    const e = c.expect as { expectedOk: boolean; expectedCumple: boolean };
    const state = c.request.state;
    const step = /^Step: (.*)$/m.exec(state)?.[1] ?? "";
    const expected = /^Expected: (.*)$/m.exec(state)?.[1] ?? null;
    const result = /<obs>\n([\s\S]*?)\n<\/obs>/.exec(state)?.[1] ?? "";
    const q = { cumple: (c.request.questions as Record<string, unknown>).cumple ?? CUMPLE(step, expected) };
    const full = await ask(state, q);
    const minimal = await ask(`Step: ${step}${expected ? `\nExpected: ${expected}` : ""}\nResult: ${result.slice(0, 500)}`, q);
    const reversed = await ask(`Result: ${result.slice(0, 1500)}\n\nTask the user asked for: ${step}${expected ? `\nExpected: ${expected}` : ""}`, q);
    const quoted = await ask(`The user asked: "${step}"\nThe tool answered: "${result.replace(/\s+/g, " ").slice(0, 600)}"`, q);
    rows.push({ id: c.id, dataset: ds.name, ok: e.expectedOk, cumple: e.expectedCumple, full, minimal, reversed, quoted });
  }
}
writeFileSync(OUT, JSON.stringify(rows));
const lab = (r: Row) => r.ok && r.cumple;
const pos = rows.filter(lab).length;
function auc(f: (r: Row) => number): number {
  const P = rows.filter(lab).map(f), N = rows.filter((r) => !lab(r)).map(f);
  let w = 0;
  for (const p of P) for (const n of N) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (P.length * N.length);
}
const report = (name: string, f: (r: Row) => number, t = 0.6): void => {
  let fp = 0, fn = 0;
  for (const r of rows) { const ap = f(r) >= t; if (ap && !lab(r)) fp++; if (!ap && lab(r)) fn++; }
  console.log(`RESULT ${name.padEnd(34)} AUC ${auc(f).toFixed(2)} | FP ${String(fp).padStart(2)}/${rows.length - pos} FN ${String(fn).padStart(2)}/${pos} | aciertos ${rows.length - fp - fn}/${rows.length}`);
};
console.log(`RESULT modelo ${MODEL}, n=${rows.length}`);
report("completo (el de producción)", (r) => r.full);
report("mínimo (paso + resultado corto)", (r) => r.minimal);
report("invertido (resultado primero)", (r) => r.reversed);
report("entre comillas (pedido / respuesta)", (r) => r.quoted);
report("mín(completo, mínimo)", (r) => Math.min(r.full, r.minimal));
report("mín(completo, invertido)", (r) => Math.min(r.full, r.reversed));
report("mín(completo, comillas)", (r) => Math.min(r.full, r.quoted));
report("mín de los 4", (r) => Math.min(r.full, r.minimal, r.reversed, r.quoted));
report("media de los 4", (r) => (r.full + r.minimal + r.reversed + r.quoted) / 4);
report("media de los 4 ≥ 0,7", (r) => (r.full + r.minimal + r.reversed + r.quoted) / 4, 0.7);
report("mediana de los 4", (r) => { const s = [r.full, r.minimal, r.reversed, r.quoted].sort((a, b) => a - b); return (s[1] + s[2]) / 2; });
// correlación entre renderizados (errores): cuántos casos fallan en cada uno y cuántos en todos
const wrong = (v: number, r: Row): boolean => (v >= 0.6) !== lab(r);
const w = { full: rows.filter((r) => wrong(r.full, r)).length, minimal: rows.filter((r) => wrong(r.minimal, r)).length, reversed: rows.filter((r) => wrong(r.reversed, r)).length, quoted: rows.filter((r) => wrong(r.quoted, r)).length };
const all4 = rows.filter((r) => wrong(r.full, r) && wrong(r.minimal, r) && wrong(r.reversed, r) && wrong(r.quoted, r)).length;
const any4 = rows.filter((r) => wrong(r.full, r) || wrong(r.minimal, r) || wrong(r.reversed, r) || wrong(r.quoted, r)).length;
console.log(`RESULT errores por renderizado: ${JSON.stringify(w)} | fallan en los 4: ${all4} | fallan en alguno: ${any4}`);
