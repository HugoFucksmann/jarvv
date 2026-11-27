/**
 * eval/exp/d4_questions.ts
 *
 * Experimento offline de Decisión 4 (verificación del resultado de una llamada, pregunta `cumple`): sobre el MISMO estado (`Step` + `Call result`), la pregunta de producción y otras
 * en los tres formatos, que D responde por separado, solas y combinadas en código:
 *   - `cumple` (`noul`): la de producción, tal cual está en el caso (línea base).
 *   - `has` (`noul`): ¿el resultado trae lo que pide el paso?
 *   - `missing` (`noul` invertida, `true` = hay un problema): ¿falta algo de lo que pide el paso?
 *   - `level` (`score`, 5 niveles): cuánto de lo que pide el paso muestra el resultado.
 *   - `kind` (`choice`): responde el paso / solo en parte / es de otra cosa, vacío o error.
 * Mide la separación (AUC) y, con el corte elegido en DESARROLLO (el más bajo con a lo sumo `--max-false-yes` de falsos «sí»), aciertos y errores en HOLDOUT. Con `--live=archivo.json`
 * mide sobre estados reales de las trazas (`[{ state, label, prod }]`, etiquetados a mano).
 *
 * Uso: npx tsx eval/exp/d4_questions.ts [--cache=ruta.json] [--live=ruta.json] [--max-false-yes=0.1]
 * No toca `src/`.
 */

import fs from "node:fs";

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import type { DecisionAnswer, DecisionQuestion } from "../../src/core/types.ts";
import { resultText } from "../../src/core/render/shared.ts";
import { loadDatasets } from "../core/datasets.ts";
import type { DecisionRequest } from "../core/types.ts";

const LEVELS = ["None of what the step asks is in the result.", "A little of what the step asks is in the result.", "Half of what the step asks is in the result.", "Most of what the step asks is in the result.", "All of what the step asks is in the result."] as const;

const EXTRA: Record<string, DecisionQuestion> = {
  has: {
    type: "noul",
    instructions: "Does the result contain the information or the confirmation that the step asks for?",
    criteria: {
      true: "The result shows the information or confirms the action that the step asks for.",
      false: "The result is about something else, or does not show what the step asks for.",
    },
  },
  missing: {
    type: "noul",
    instructions: "Is any part of what the step asks for missing in the result?",
    criteria: { true: "Something the step asks for is not in the result.", false: "Everything the step asks for is in the result." },
  },
  level: { type: "score", instructions: "How much of what the step asks does the result show?", criteria: LEVELS },
  kind: {
    type: "choice",
    instructions: "Compare the result with the step. Which one is true?",
    criteria: {
      answers_step: "The result shows the information or confirms the action that the step asks for.",
      only_part: "The result shows only a part of what the step asks for.",
      not_it: "The result is about something else, or it is empty, or it is an error.",
    },
  },
};

interface Answers {
  readonly cumple: number;
  readonly has: number;
  readonly missing: number;
  readonly level: readonly number[];
  readonly kind: Readonly<Record<string, number>>;
}
interface Sample {
  readonly id: string;
  readonly set: "dev" | "holdout" | "live" | "real" | "syn";
  readonly expected: boolean;
  readonly a: Answers;
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const cachePath = flag("cache") ?? "d4_questions_cache.json";
const livePath = flag("live");
const MAX_FALSE_YES = Number(flag("max-false-yes") ?? "0.1");

/**
 * `--clean`: el estado sin lo que no dice si el paso se cumplió: el id de la llamada y de paso (`c1 s1`), la ruta y el `read ok` (`Tool: system_info`), y el encabezado de ejecución del comando
 * (duración, PID, carpeta, «The command finished successfully.»), con las mismas reglas que la lista de pendientes (`resultText`).
 */
const clean = argv.includes("--clean");
const cleanState = (state: string): string =>
  state.replace(/<obs>\n([\s\S]*?)\n<\/obs>/, (_m, body: string) => {
    const lines = body.split("\n");
    const head = /^c\d+ s\d+ [^/\s]+\/(\S+) (?:read|write) \S+/.exec(lines[0] ?? "");
    const hasArgs = (lines[1] ?? "").startsWith("args=");
    const rest = lines.slice(hasArgs ? 2 : 1).join("\n");
    return `<obs>\nTool: ${head?.[1] ?? "?"}${hasArgs ? ` ${lines[1].slice(5)}` : ""}\n${resultText(rest)}\n</obs>`;
  });
const only = flag("only")?.split(",");

const noul = (a: DecisionAnswer | undefined): number => (a !== undefined && "noul" in a ? a.noul : NaN);

async function askEach(engine: Decision20Engine, state: string, questions: Record<string, DecisionQuestion>): Promise<Answers> {
  const answers: Record<string, DecisionAnswer> = {};
  const text = clean ? cleanState(state) : state;
  for (const [key, question] of Object.entries(questions)) {
    if (only !== undefined && !only.includes(key)) continue;
    Object.assign(answers, (await engine.systemOne(text, { [key]: question })).answers);
  }
  const level = answers.level;
  const kind = answers.kind;
  return {
    cumple: noul(answers.cumple),
    has: noul(answers.has),
    missing: noul(answers.missing),
    level: level !== undefined && "score" in level ? LEVELS.map((_, i) => level.probabilities[String(i)] ?? 0) : [],
    kind: kind !== undefined && "choice" in kind ? kind.probabilities : {},
  };
}

async function collect(): Promise<Sample[]> {
  const engine = new Decision20Engine(() => ConfigManager.getConfig());
  if (livePath !== undefined) {
    const live = JSON.parse(fs.readFileSync(livePath, "utf8")) as { state: string; label: boolean; step: string }[];
    const out: Sample[] = [];
    for (const [i, s] of live.entries()) {
      const base = `Step: ${s.step}`;
      void base;
      out.push({ id: `live${i}`, set: "live", expected: s.label, a: await askEach(engine, s.state, { cumple: { type: "noul", instructions: "Does the result accomplish the step?", criteria: { true: "Fully meets what was requested.", false: "Incomplete, failed, or different from request." } }, ...EXTRA }) });
    }
    fs.writeFileSync(`${livePath}.cache.json`, JSON.stringify(out));
    return out;
  }
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8")) as Sample[];
  const dev = new Set(["result_verification_1", "result_verification_2", "result_verification_hard_1", "result_verification_hard_2"]);
  const samples: Sample[] = [];
  const onlyNew = argv.includes("--new");
  for (const ds of loadDatasets(["eval/datasets/result_verification"], { stages: ["result_verification"] })) {
    const isNew = /_traces_|_syn_/.test(ds.name);
    if (isNew !== onlyNew) continue; // sin `--new`, los datasets de siempre; con `--new`, solo los de trazas reales (`traces`) y sintéticos (`syn`)
    for (const c of ds.cases) {
      if (c.isRaw === true || c.request.type !== "decision") continue;
      const req = c.request as DecisionRequest;
      const expected = (c.expect as { expectedCumple?: boolean }).expectedCumple;
      if (req.questions.cumple === undefined || expected === undefined) continue;
      samples.push({ id: c.id, set: isNew ? (ds.name.includes("_traces_") ? "real" : "syn") : dev.has(ds.name) ? "dev" : "holdout", expected, a: await askEach(engine, req.state, { cumple: req.questions.cumple as DecisionQuestion, ...EXTRA }) });
    }
    console.error(`${ds.name}: ${ds.cases.length} casos`);
  }
  fs.writeFileSync(cachePath, JSON.stringify(samples));
  return samples;
}

const RULES: Readonly<Record<string, (a: Answers) => number>> = {
  "A prod: cumple": (a) => a.cumple,
  "B noul: has": (a) => a.has,
  "C noul invertida: 1-missing": (a) => 1 - a.missing,
  "D score: P(nivel 4)": (a) => a.level[4] ?? 0,
  "D2 score: P(nivel>=3)": (a) => (a.level[3] ?? 0) + (a.level[4] ?? 0),
  "E choice: P(answers_step)": (a) => a.kind.answers_step ?? 0,
  "E2 choice: 1-P(not_it)": (a) => 1 - (a.kind.not_it ?? 0),
  "A+B media": (a) => (a.cumple + a.has) / 2,
  "A+C media": (a) => (a.cumple + 1 - a.missing) / 2,
  "A+E media": (a) => (a.cumple + (a.kind.answers_step ?? 0)) / 2,
  "B+E media": (a) => (a.has + (a.kind.answers_step ?? 0)) / 2,
  "B+C media": (a) => (a.has + 1 - a.missing) / 2,
  "A+D2 media": (a) => (a.cumple + (a.level[3] ?? 0) + (a.level[4] ?? 0)) / 2,
  "B+D2 media": (a) => (a.has + (a.level[3] ?? 0) + (a.level[4] ?? 0)) / 2,
  "A+B+E media": (a) => (a.cumple + a.has + (a.kind.answers_step ?? 0)) / 3,
  "todas media": (a) => (a.cumple + a.has + 1 - a.missing + (a.level[4] ?? 0) + (a.kind.answers_step ?? 0)) / 5,
  "B+E min": (a) => Math.min(a.has, a.kind.answers_step ?? 0),
  "A+B min": (a) => Math.min(a.cumple, a.has),
};

function score(set: readonly Sample[], rule: (a: Answers) => number, cut: number): { acc: number; fy: number; fn: number } {
  let ok = 0, fy = 0, fn = 0;
  for (const s of set) {
    const said = rule(s.a) >= cut;
    if (said === s.expected) ok++; else if (said) fy++; else fn++;
  }
  return { acc: set.length === 0 ? NaN : ok / set.length, fy, fn };
}

function auc(set: readonly Sample[], rule: (a: Answers) => number): number {
  const yes = set.filter((s) => s.expected).map((s) => rule(s.a));
  const no = set.filter((s) => !s.expected).map((s) => rule(s.a));
  if (yes.length === 0 || no.length === 0) return NaN;
  let wins = 0;
  for (const y of yes) for (const n of no) wins += y > n ? 1 : y === n ? 0.5 : 0;
  return wins / (yes.length * no.length);
}

function constrainedCut(dev: readonly Sample[], rule: (a: Answers) => number): number {
  const incomplete = dev.filter((s) => !s.expected);
  for (let c = 0.02; c <= 1.0001; c += 0.01) {
    if (incomplete.length === 0 || incomplete.filter((s) => rule(s.a) >= c).length / incomplete.length <= MAX_FALSE_YES) return Math.round(c * 100) / 100;
  }
  return 1;
}

const sweep = argv.includes("--sweep");
const pct = (x: number): string => (Number.isNaN(x) ? "  n/a" : `${(x * 100).toFixed(1)}%`);
const samples = sweep ? [...(JSON.parse(fs.readFileSync(cachePath, "utf8")) as Sample[]), ...(JSON.parse(fs.readFileSync(`${livePath}.cache.json`, "utf8")) as Sample[])] : await collect();
const dev = samples.filter((s) => s.set === "dev");
const hold = samples.filter((s) => s.set === "holdout");
const live = samples.filter((s) => s.set === "live");
const nNo = (set: readonly Sample[]): number => set.filter((s) => !s.expected).length;

if (sweep) {
  console.log("corte | regla".padEnd(30), "dev(hard, 112 incumplen): acc fY fN | holdout(fáciles): acc fY fN | reales(47): acc fY fN");
  for (const name of ["A prod: cumple", "B noul: has", "A+B media", "A+E media", "B+E min", "todas media"]) {
    for (const cut of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      const rule = RULES[name];
      const d = score(dev, rule, cut), h = score(hold, rule, cut), l = score(live, rule, cut);
      console.log(`${cut.toFixed(1)} ${name}`.padEnd(30), `|      ${pct(d.acc).padStart(6)} ${String(d.fy).padStart(3)} ${String(d.fn).padStart(3)} |      ${pct(h.acc).padStart(6)} ${String(h.fy).padStart(3)} ${String(h.fn).padStart(3)} |      ${pct(l.acc).padStart(6)} ${String(l.fy).padStart(3)} ${String(l.fn).padStart(3)}`);
    }
  }
} else if (livePath !== undefined) {
  console.log(`estados reales: ${live.length} (cumplen ${live.filter((s) => s.expected).length}, no ${nNo(live)})`);
  console.log("regla".padEnd(28), "AUC   | corte 0.6: acc   fY fN | corte 0.5: acc   fY fN");
  for (const [name, rule] of Object.entries(RULES)) {
    const a = score(live, rule, 0.6);
    const b = score(live, rule, 0.5);
    console.log(name.padEnd(28), auc(live, rule).toFixed(3).padStart(6), "|", pct(a.acc).padStart(10), String(a.fy).padStart(3), String(a.fn).padStart(2), "|", pct(b.acc).padStart(10), String(b.fy).padStart(3), String(b.fn).padStart(2));
  }
} else {
  console.log(`dev ${dev.length} (cumple ${dev.filter((s) => s.expected).length}), holdout ${hold.length} (cumple ${hold.filter((s) => s.expected).length}); corte de dev con a lo sumo ${pct(MAX_FALSE_YES)} de falsos «sí» (${nNo(dev)} incumplen en dev, ${nNo(hold)} en holdout)`);
  console.log("regla".padEnd(28), "AUCdev AUChold | corte | dev: acc   fY  fN | holdout: acc   fY  fN | prod 0.6: dev / holdout");
  for (const [name, rule] of Object.entries(RULES)) {
    const cut = constrainedCut(dev, rule);
    const d = score(dev, rule, cut);
    const h = score(hold, rule, cut);
    const pd = score(dev, rule, 0.6);
    const ph = score(hold, rule, 0.6);
    console.log(name.padEnd(28), auc(dev, rule).toFixed(3).padStart(6), auc(hold, rule).toFixed(3).padStart(7), "|", cut.toFixed(2).padStart(5), `|      ${pct(d.acc).padStart(6)} ${String(d.fy).padStart(3)} ${String(d.fn).padStart(3)} |        ${pct(h.acc).padStart(6)} ${String(h.fy).padStart(3)} ${String(h.fn).padStart(3)} | ${pct(pd.acc)} / ${pct(ph.acc)}`);
  }
}
