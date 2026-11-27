/**
 * eval/exp/list_coverage.ts
 *
 * ¿Sirve la pregunta de cobertura de la lista (`checkCoverage`: «¿la lista cubre todo lo que pide la solicitud?») para dejar de consultar a Decisión 5 cuando la lista se vació
 * porque todos sus ítems se cumplieron? Se mide con listas armadas con la verdad conocida:
 *   - COMPLETA: los pasos de un caso de `d5` cumplido (los ítems que, hechos, cumplen el pedido).
 *   - INCOMPLETA: la misma lista sin uno de sus ítems (el pedido pide una parte que la lista ya no tiene).
 * Un caso de `d5` cumplido con 2 o más pasos da una lista completa y tantas incompletas como ítems. Los pedidos repetidos entre datasets se cuentan una vez.
 *
 * Uso: npx tsx eval/exp/list_coverage.ts
 * No toca `src/`.
 */

import fs from "node:fs";
import path from "node:path";

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import { DECISION_PROMPTS } from "../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../src/core/types.ts";

interface Raw { id: string; scenario: { request: string; steps?: { instruction?: string }[] }; expect: { expectedComplete: boolean } }
interface Item { readonly id: string; readonly set: string; readonly request: string; readonly list: readonly string[]; readonly covers: boolean; readonly p: number; readonly alt: Record<string, number> }

const dir = "eval/datasets/d5";
const seen = new Set<string>();
const items: Omit<Item, "p" | "alt">[] = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const set = /_traces_/.test(file) ? "real" : /_syn_/.test(file) ? "syn" : /holdout/.test(file) ? "holdout" : "dev";
  for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as Raw;
    const steps = (r.scenario.steps ?? []).map((s) => s.instruction ?? "").filter((s) => s !== "");
    if (!r.expect.expectedComplete || steps.length < 2 || seen.has(r.scenario.request)) continue;
    seen.add(r.scenario.request);
    items.push({ id: `${r.id}:full`, set, request: r.scenario.request, list: steps, covers: true });
    steps.forEach((_, i) => items.push({ id: `${r.id}:sin${i + 1}`, set, request: r.scenario.request, list: steps.filter((_, j) => j !== i), covers: false }));
  }
}

const engine = new Decision20Engine(() => ConfigManager.getConfig());
const LEVELS = ["None of what the REQUEST asks to do is in the list.", "A little of it is in the list.", "About half of it is in the list.", "Most of it is in the list.", "All of it is in the list."];
const ALT: Record<string, DecisionQuestion> = {
  missing: { type: "noul", instructions: "Is there anything the REQUEST asks to do that no item of the TO-DO LIST does?", criteria: { true: "At least one thing the request asks for has no item in the list.", false: "Every thing the request asks for has an item in the list." } },
  level: { type: "score", instructions: "How much of what the REQUEST asks to do is handled by the TO-DO LIST?", criteria: LEVELS },
  kind: { type: "choice", instructions: "Compare the TO-DO LIST with the REQUEST. Which one is true?", criteria: { complete: "Every thing the request asks to do has an item in the list.", missing_part: "A thing the request asks to do has no item in the list.", other: "The list is about something else." } },
};
const cacheFile = process.argv.find((a) => a.startsWith("--cache="))?.slice(8);
const all: Item[] = cacheFile !== undefined && fs.existsSync(cacheFile) ? (JSON.parse(fs.readFileSync(cacheFile, "utf8")) as Item[]) : [];
for (const it of all.length > 0 ? [] : items) {
  const input = { request: it.request.replace(/\s+/g, " ").trim(), list: it.list };
  const { state } = DECISION_PROMPTS.buildCoverage(input);
  const { covers } = await engine.checkCoverage(input);
  const alt: Record<string, number> = {};
  const m = (await engine.systemOne(state, { missing: ALT.missing })).answers.missing;
  alt.inv = m !== undefined && "noul" in m ? 1 - m.noul : NaN;
  const l = (await engine.systemOne(state, { level: ALT.level })).answers.level;
  alt.lvl4 = l !== undefined && "score" in l ? (l.probabilities["4"] ?? 0) : NaN;
  alt.lvl3 = l !== undefined && "score" in l ? (l.probabilities["3"] ?? 0) + (l.probabilities["4"] ?? 0) : NaN;
  const k = (await engine.systemOne(state, { kind: ALT.kind })).answers.kind;
  alt.kind = k !== undefined && "choice" in k ? (k.probabilities.complete ?? 0) : NaN;
  alt.mean = (covers + alt.inv + alt.kind) / 3;
  all.push({ ...it, p: covers, alt });
}

const sets = ["dev", "holdout", "real", "syn"];
console.log(`pedidos: ${new Set(all.map((a) => a.request)).size}; listas completas ${all.filter((a) => a.covers).length}, incompletas ${all.filter((a) => !a.covers).length}`);
console.log("corte   " + sets.map((s) => s.padEnd(30)).join("") + "TOTAL");
if (cacheFile !== undefined && !fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, JSON.stringify(all));
for (const cut of [0.5, 0.75, 0.8, 0.9, 0.95, 0.96, 0.97, 0.98, 0.985, 0.99, 0.995]) {
  const cells = [...sets, "all"].map((s) => {
    const rows = s === "all" ? all : all.filter((a) => a.set === s);
    const fy = rows.filter((a) => !a.covers && a.p >= cut).length; // acepta una lista a la que le falta una parte
    const fn = rows.filter((a) => a.covers && a.p < cut).length; // rechaza una lista completa
    const pos = rows.filter((a) => a.covers).length;
    const neg = rows.length - pos;
    return `lista incompleta aceptada ${fy}/${neg}, completa rechazada ${fn}/${pos}`.padEnd(30);
  });
  console.log(cut.toFixed(2).padEnd(8) + cells.join(""));
}
const q = (xs: number[]): string => [...xs].sort((a, b) => a - b).map((x) => x.toFixed(2)).filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2) || i === a.length - 1).join(" / ");
console.log("\np (mín / mediana / máx) completas:", q(all.filter((a) => a.covers).map((a) => a.p)), "| incompletas:", q(all.filter((a) => !a.covers).map((a) => a.p)));

// Todas las formas de preguntar, con la misma verdad: AUC y, con un corte que acepte a lo sumo 10 % de las listas incompletas, cuántas completas se rechazan.
const auc = (score: (a: Item) => number): number => {
  const yes = all.filter((a) => a.covers).map(score), no = all.filter((a) => !a.covers).map(score);
  let w = 0;
  for (const y of yes) for (const n of no) w += y > n ? 1 : y === n ? 0.5 : 0;
  return w / (yes.length * no.length);
};
const forms: Record<string, (a: Item) => number> = { "covers (prod)": (a) => a.p, "1-missing (noul invertida)": (a) => a.alt.inv, "score P(nivel 4)": (a) => a.alt.lvl4, "score P(nivel>=3)": (a) => a.alt.lvl3, "choice P(complete)": (a) => a.alt.kind, "media covers+inv+choice": (a) => a.alt.mean };
console.log("\nforma".padEnd(30), "AUC   | corte (<=10% incompletas aceptadas) | completas rechazadas | incompletas aceptadas");
for (const [name, f] of Object.entries(forms)) {
  const neg = all.filter((a) => !a.covers);
  let cut = 1.0;
  for (let c = 0.01; c <= 1.0001; c += 0.01) if (neg.filter((a) => f(a) >= c).length / neg.length <= 0.1) { cut = c; break; }
  const fn = all.filter((a) => a.covers && f(a) < cut).length;
  const fy = neg.filter((a) => f(a) >= cut).length;
  console.log(name.padEnd(30), auc(f).toFixed(3), "|", cut.toFixed(2).padStart(6), "|", `${fn}/${all.length - neg.length}`.padStart(8), "|", `${fy}/${neg.length}`);
}
