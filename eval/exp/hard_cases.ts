/**
 * eval/exp/hard_cases.ts
 *
 * Experimento (no es una etapa): los casos que el 2B de decisión falla de forma sistemática (`hard_cases.jsonl`: 8 clases, cada una con su gemelo correcto para medir falsos
 * positivos). Para cada fila hace todas las preguntas candidatas en una consulta (las de producción, las de `question_sets_d4.ts` y cinco polares específicas), la pregunta de
 * ubicación (dos variantes), cuatro vistas de `cumple` y, en el cierre, las dos preguntas de D5. Después evalúa políticas (qué combinación de preguntas y qué umbral) contra el
 * veredicto esperado de cada fila.
 *
 * Uso: npx tsx eval/exp/hard_cases.ts [modelo]        (por defecto, el de decisión de la configuración)
 */

import { readFileSync } from "node:fs";
import { ConfigManager } from "../../src/core/config.ts";
import { DECISION_PROMPTS } from "../../src/core/models/prompts.ts";
import { PLACE_PROBE } from "../../src/core/tools/probes.ts";
import { DEFAULT_DECISION_URL } from "../core/config.ts";
import { materializeScenario } from "../core/scenario.ts";

const MODEL = process.argv[2] ?? ConfigManager.getConfig().decisionModel;
const ENDPOINT = `${DEFAULT_DECISION_URL.replace(/\/+$/, "")}/v1/systemone`;

interface Row {
  id: string;
  class: string;
  pair: "bad" | "good";
  description: string;
  kind: "write" | "read" | "close";
  scenario: Record<string, unknown>;
  expect: { verdict: "approve" | "reject"; path: string; bad_questions: string[] };
  place?: { tool: string; path: string };
}
const rows: Row[] = readFileSync(new URL("./hard_cases.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);

const noul = (instructions: string, t: string, f: string) => ({ type: "noul", instructions, criteria: { true: t, false: f } });
/** Preguntas candidatas. `bad`: la afirmativa es lo malo (se invierte para hablar siempre de «probabilidad de bien»). */
const CANDIDATES: Record<string, { q: ReturnType<typeof noul>; bad?: boolean }> = {
  answered: { q: noul("Does the result contain the specific information or effect that the step asks for?", "It contains what the step asks for.", "It does not.") },
  other: { bad: true, q: noul("Does the result show something different from what the step asks for (another file, folder or topic)?", "Something different.", "What the step asks for.") },
  missing: { bad: true, q: noul("Is any part of the step still not done?", "A part is not done.", "Everything is done.") },
  error: { bad: true, q: noul("Is the result an error, a failure message or empty?", "Error or empty.", "Real content.") },
  same_target: { q: noul("Does the result show the specific item the step names (the sheet, file, folder, period or item), not a default or a different one?", "It is the named item.", "It is a default or another item.") },
  covers_all: { q: noul("Does the search or command cover everything the step asks for (all items, not only a subset)?", "It covers everything.", "It covers only a subset.") },
  has_attrs: { q: noul("Does the result include every attribute needed to answer the step (such as dates, sizes or counts)?", "It includes them.", "An attribute is missing.") },
  finished: { q: noul("Has the work finished? A process that was only started, or is still running or waiting, is not finished.", "It finished.", "It is still running or only started.") },
  position: { q: noul("Is the new text placed where the step says (the start or the end of the file)?", "It is where the step says.", "It is in a different position.") },
};
const D5_1 = noul("Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.", "Every part of the REQUEST is done.", "Some part of the REQUEST is missing or not done yet.");
const D5_2 = noul(
  "Check each part of REQUEST against DONE: every target and every item of a list, the quantity, the exact values written, and any final action (save, delete, report). Is every part of REQUEST done?",
  "Every part of REQUEST is shown as done in DONE, with the right targets and values.",
  "A part is missing: a target, an item, a value, a save or delete, or only a read or copy where a change was requested.",
);

async function ask(state: string, questions: Record<string, unknown>): Promise<Record<string, number>> {
  const r = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions, keep_alive: "10m" }) });
  const j = (await r.json()) as { answers: Record<string, { noul: number }> };
  return Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul]));
}

/** Probabilidades de «bien» de cada pregunta, por fila. */
const scores: Record<string, Record<string, number>> = {};
for (const row of rows) {
  const s: Record<string, number> = {};
  if (row.kind === "close") {
    const m = materializeScenario("pending", row.scenario as never);
    const req = m.request as unknown as { user: string };
    const a1 = await ask(req.user, { close_1: D5_1 });
    const a2 = await ask(req.user, { close_2: D5_2 });
    s.close_1 = a1.close_1;
    s.close_2 = a2.close_2;
  } else {
    const m = materializeScenario("result_verification", row.scenario as never);
    const req = m.request as unknown as { state: string; questions: Record<string, unknown> };
    const questions: Record<string, unknown> = { ...req.questions };
    for (const [k, c] of Object.entries(CANDIDATES)) questions[k] = c.q;
    const a = await ask(req.state, questions);
    for (const [k, v] of Object.entries(a)) s[k] = CANDIDATES[k]?.bad ? 1 - v : v;
    if (req.questions.ok === undefined) s.ok = 1; // `ok` lo responde el código en las lecturas deterministas con contenido
    // Cuatro vistas de `cumple`.
    const step = /^Step: (.*)$/m.exec(req.state)?.[1] ?? "";
    const result = /<obs>\n([\s\S]*?)\n<\/obs>/.exec(req.state)?.[1] ?? "";
    const cumple = { cumple: req.questions.cumple };
    s.v_full = s.cumple;
    s.v_min = (await ask(`Step: ${step}\nResult: ${result.slice(0, 500)}`, cumple)).cumple;
    s.v_rev = (await ask(`Result: ${result.slice(0, 1500)}\n\nTask the user asked for: ${step}`, cumple)).cumple;
    s.v_quo = (await ask(`The user asked: "${step}"\nThe tool answered: "${result.replace(/\s+/g, " ").slice(0, 600)}"`, cumple)).cumple;
    if (row.place) {
      const request = (row.scenario as { request: string }).request;
      const args = row.place.tool === "move_file" ? { destination: row.place.path } : { path: row.place.path };
      const stages = PLACE_PROBE.stages({ tool: row.place.tool, args, summary: null, request, step: request });
      for (const [i, st] of stages.entries()) s[`place${i + 1}`] = (await ask(st.state, { place: { type: "noul", ...st.question } })).place;
      s.place = Math.min(s.place1, s.place2);
    }
  }
  scores[row.id] = s;
}

const f = (v: number | undefined): string => (v === undefined ? "  · " : v.toFixed(2).padStart(4));
console.log(`RESULT modelo ${MODEL}`);
const cols = ["ok", "cumple", "place", "answered", "other", "missing", "error", "same_target", "covers_all", "has_attrs", "finished", "position", "close_1", "close_2"];
console.log("RESULT " + "fila".padEnd(9) + cols.map((c) => c.slice(0, 6).padStart(7)).join(""));
for (const row of rows) console.log("RESULT " + row.id.padEnd(9) + cols.map((c) => f(scores[row.id][c]).padStart(7)).join("") + (row.pair === "bad" ? `   ← debería marcar: ${row.expect.bad_questions.join(", ")}` : ""));

// ¿Cada pregunta marca lo que debe? bad_questions de cada fila malvada < 0,6 / umbrales
console.log("RESULT --- detección por pregunta específica en las filas malas (puntuación de «bien»; debe quedar baja) y en las buenas (debe quedar alta)");
for (const q of ["place", "position", "covers_all", "same_target", "has_attrs", "finished", "cumple", "close_1", "close_2"]) {
  const bad = rows.filter((r) => r.pair === "bad" && r.expect.bad_questions.includes(q));
  const good = rows.filter((r) => r.pair === "good" && scores[r.id][q] !== undefined && (r.kind === "close" ? q.startsWith("close") : !q.startsWith("close")));
  if (bad.length === 0) continue;
  console.log(`RESULT ${q.padEnd(12)} malas: ${bad.map((r) => `${r.id} ${f(scores[r.id][q]).trim()}`).join(", ")} | buenas (mín ${f(Math.min(...good.map((r) => scores[r.id][q]))).trim()}, n=${good.length})`);
}

// Políticas: ¿aprueba o rechaza? (esperado: malas → rechazar, buenas → aprobar)
type Policy = (id: string, row: Row, t: number) => boolean;
const s = (id: string): Record<string, number> => scores[id];
const isClose = (r: Row): boolean => r.kind === "close";
const policies: Record<string, Policy> = {
  "producción (ok, cumple; ubicación si es escritura; D5 = close_1)": (id, r, t) => (isClose(r) ? s(id).close_1 >= t : Math.min(s(id).ok, s(id).cumple, s(id).place ?? 1) >= t),
  "producción + las 5 polares específicas": (id, r, t) => (isClose(r) ? s(id).close_1 >= t : Math.min(s(id).ok, s(id).cumple, s(id).place ?? 1, s(id).same_target, s(id).covers_all, s(id).has_attrs, s(id).finished, s(id).position) >= t),
  "producción + polares + answered, other, missing, error": (id, r, t) => (isClose(r) ? Math.min(s(id).close_1, s(id).close_2) >= t : Math.min(s(id).ok, s(id).cumple, s(id).place ?? 1, s(id).same_target, s(id).covers_all, s(id).has_attrs, s(id).finished, s(id).position, s(id).answered, s(id).other, s(id).missing, s(id).error) >= t),
  "media de 4 vistas de cumple (+ubicación; D5 = media de las 2)": (id, r, t) => (isClose(r) ? (s(id).close_1 + s(id).close_2) / 2 >= t : Math.min((s(id).v_full + s(id).v_min + s(id).v_rev + s(id).v_quo) / 4, s(id).ok, s(id).place ?? 1) >= t),
  "vistas + polares (mín de todo lo anterior)": (id, r, t) => (isClose(r) ? (s(id).close_1 + s(id).close_2) / 2 >= t : Math.min((s(id).v_full + s(id).v_min + s(id).v_rev + s(id).v_quo) / 4, s(id).ok, s(id).place ?? 1, s(id).same_target, s(id).covers_all, s(id).has_attrs, s(id).finished, s(id).position) >= t),
};
console.log("RESULT --- políticas por umbral: ✗ = error (mala aprobada = falso positivo; buena rechazada = falso negativo)");
for (const [name, p] of Object.entries(policies)) {
  const line: string[] = [];
  for (const t of [0.6, 0.7, 0.8, 0.9]) {
    const fp = rows.filter((r) => r.pair === "bad" && p(r.id, r, t));
    const fn = rows.filter((r) => r.pair === "good" && !p(r.id, r, t));
    line.push(`t${t}: FP ${fp.length}${fp.length ? `[${fp.map((r) => r.id.replace("-bad", "")).join(" ")}]` : ""} FN ${fn.length}${fn.length ? `[${fn.map((r) => r.id.replace("-good", "")).join(" ")}]` : ""}`);
  }
  console.log(`RESULT ${name}\nRESULT    ${line.join(" | ")}`);
}
