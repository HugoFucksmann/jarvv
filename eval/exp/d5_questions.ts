/**
 * eval/exp/d5_questions.ts
 *
 * Experimento offline de Decisión 5 (cierre del reactivo): qué pasa si, sobre el MISMO estado, se le hacen a D varias preguntas en formatos distintos y el código las combina.
 * Una sola consulta por caso con cuatro preguntas que D responde por separado (el servidor repite el estado por pregunta):
 *   - `request_complete` (`noul`): la de producción, sin cambios (línea base).
 *   - `missing` (`noul` invertida, `true` = hay un problema): ¿algún pedido sin hacer?
 *   - `level` (`score`, 5 niveles): cuánto del pedido está hecho.
 *   - `kind` (`choice`): todo hecho / falta algo / hecho distinto de lo pedido.
 * Con las respuestas guardadas (deterministas: D trabaja a temperatura 0) calcula, para cada regla de decisión (una pregunta o una combinación en código), el mejor corte sobre el conjunto
 * de DESARROLLO y lo evalúa sin tocarlo sobre los HOLDOUTS. Reporta aciertos, falsos «sí» (cierra una tarea incompleta: el error caro) y falsos «no».
 *
 * Uso: npx tsx eval/exp/d5_questions.ts [--cache=ruta.json] [--fresh]
 * No toca `src/`: lo que gane se pasa a código aparte.
 */

import fs from "node:fs";
import zlib from "node:zlib";

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import type { DecisionAnswer, DecisionQuestion } from "../../src/core/types.ts";
import { COMPLETION_APPROVE, COMPLETION_KEY } from "../core/contract.ts";
import { loadDatasets } from "../core/datasets.ts";
import type { DecisionRequest } from "../core/types.ts";

const LEVELS = [
  "Nothing of the REQUEST was done.",
  "Only a small part of the REQUEST was done.",
  "About half of the REQUEST was done.",
  "Most of the REQUEST was done, but a part is missing.",
  "All of the REQUEST was done.",
] as const;

const EXTRA: Record<string, DecisionQuestion> = {
  missing: {
    type: "noul",
    instructions: "Is there any part of REQUEST that DONE does not show as done?",
    criteria: {
      true: "At least one part of the REQUEST has no matching result in DONE, or was done differently from what was asked (for example copied instead of moved).",
      false: "Every part of the REQUEST has a matching result in DONE, or is a conditional part whose condition DONE shows was not met.",
    },
  },
  level: { type: "score", instructions: "According to DONE, how much of REQUEST is done?", criteria: LEVELS },
  kind: {
    type: "choice",
    instructions: "Compare DONE with REQUEST. Which one is true?",
    criteria: {
      all_done: "Every part of the REQUEST was done as asked, or a conditional part did not apply because its condition was not met.",
      part_missing: "A part of the REQUEST was not done.",
      done_differently: "A part of the REQUEST was done differently from what was asked (for example copied instead of moved) or gave an unusable result.",
    },
  },
};

interface Answers {
  readonly complete: number;
  readonly missing: number;
  readonly level: readonly number[];
  readonly kind: Readonly<Record<string, number>>;
}

interface Sample {
  readonly id: string;
  readonly set: "dev" | "holdout";
  readonly expected: boolean;
  readonly a: Answers;
}

const argv = process.argv.slice(2);
const cachePath = argv.find((x) => x.startsWith("--cache="))?.slice(8) ?? "d5_questions_cache.json";
const fresh = argv.includes("--fresh");

const live = argv.includes("--live");
/** Con `--compact`, el DONE de cada estado real se reduce a una línea por llamada (herramienta, argumentos y veredicto), sin el texto del resultado (que llega truncado). */
const compact = argv.includes("--compact");
const compactState = (state: string): string =>
  state.replace(/^(c\d+ s\d+ .*?) \| .*$/gm, "$1");

/** Una consulta por pregunta sobre el mismo estado: un estado largo repetido por cada pregunta de una sola consulta desborda el contexto de D. Las respuestas son las mismas. */
async function askEach(engine: Decision20Engine, state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>> {
  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, question] of Object.entries(questions)) Object.assign(answers, (await engine.systemOne(state, { [key]: question })).answers);
  return answers;
}

const noul = (a: DecisionAnswer | undefined): number => (a !== undefined && "noul" in a ? a.noul : NaN);

/**
 * Estados reales de D5 sacados de las trazas (`jarvis-traces/*`, etapa `completion`): la tarea «revisá mi PC: virus y procesos viejos». La etiqueta la pone una regla que lee el DONE
 * del propio estado: cumplida si hay una consulta de Defender (`Get-MpComputerStatus`) Y una lista de procesos con su hora de inicio (`StartTime`); si no, incompleta.
 */
async function collectLive(): Promise<Sample[]> {
  const engine = new Decision20Engine(() => ConfigManager.getConfig());
  const samples: Sample[] = [];
  const root = "jarvis-traces";
  for (const dir of fs.readdirSync(root)) {
    const file = `${root}/${dir}/full.json.gz`;
    if (!fs.existsSync(file)) continue;
    const full = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as { models: { stage: string; seq: number; input: string | null }[] };
    for (const m of full.models) {
      if (m.stage !== "completion" || m.input === null) continue;
      const input = JSON.parse(m.input) as { state: string; questions: Record<string, DecisionQuestion> };
      if (!/virus/i.test(input.state)) continue;
      const done = input.state.split("### COMPLETED TASKS (DONE):")[1] ?? "";
      const defender = /Get-MpComputerStatus/.test(done);
      const ages = /Get-Process.{0,80}StartTime/.test(done);
      const answers = await askEach(engine, compact ? compactState(input.state) : input.state, { ...input.questions, ...EXTRA });
      const level = answers.level;
      const kind = answers.kind;
      samples.push({
        id: `${dir.slice(0, 15)}#${m.seq}`,
        set: "holdout",
        expected: defender && ages,
        a: {
          complete: noul(answers[COMPLETION_KEY]),
          missing: noul(answers.missing),
          level: level !== undefined && "score" in level ? LEVELS.map((_, i) => level.probabilities[String(i)] ?? 0) : [],
          kind: kind !== undefined && "choice" in kind ? kind.probabilities : {},
        },
      });
    }
  }
  return samples;
}

async function collect(): Promise<Sample[]> {
  if (live) return collectLive();
  if (!fresh && fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, "utf8")) as Sample[];
  const engine = new Decision20Engine(() => ConfigManager.getConfig());
  const dev = new Set(["d5_1", "d5_2", "d5_hard_1", "d5_hard_2"]);
  const samples: Sample[] = [];
  for (const ds of loadDatasets(["eval/datasets/d5"], { stages: ["d5"] })) {
    for (const c of ds.cases) {
      if (c.isRaw === true || c.request.type !== "decision") continue;
      const req = c.request as DecisionRequest;
      const response = await engine.systemOne(req.state, { ...(req.questions as Record<string, DecisionQuestion>), ...EXTRA });
      const level = response.answers.level;
      const kind = response.answers.kind;
      samples.push({
        id: c.id,
        set: dev.has(ds.name) ? "dev" : "holdout",
        expected: (c.expect as { expectedComplete: boolean }).expectedComplete,
        a: {
          complete: noul(response.answers[COMPLETION_KEY]),
          missing: noul(response.answers.missing),
          level: level !== undefined && "score" in level ? LEVELS.map((_, i) => level.probabilities[String(i)] ?? 0) : [],
          kind: kind !== undefined && "choice" in kind ? kind.probabilities : {},
        },
      });
    }
    console.error(`${ds.name}: ${ds.cases.length} casos`);
  }
  fs.writeFileSync(cachePath, JSON.stringify(samples));
  return samples;
}

/** Probabilidad de «cumplido» según cada regla (0 a 1). */
const RULES: Readonly<Record<string, (a: Answers) => number>> = {
  "A prod: noul complete": (a) => a.complete,
  "B noul invertida: 1 - missing": (a) => 1 - a.missing,
  "C score: P(nivel 4)": (a) => a.level[4] ?? 0,
  "C2 score: P(nivel>=3)": (a) => (a.level[3] ?? 0) + (a.level[4] ?? 0),
  "D choice: P(all_done)": (a) => a.kind.all_done ?? 0,
  "A+B  min": (a) => Math.min(a.complete, 1 - a.missing),
  "A+B  media": (a) => (a.complete + 1 - a.missing) / 2,
  "A+C  min": (a) => Math.min(a.complete, a.level[4] ?? 0),
  "A+D  min": (a) => Math.min(a.complete, a.kind.all_done ?? 0),
  "B+D  min": (a) => Math.min(1 - a.missing, a.kind.all_done ?? 0),
  "B+C  min": (a) => Math.min(1 - a.missing, a.level[4] ?? 0),
  "C+D  min": (a) => Math.min(a.level[4] ?? 0, a.kind.all_done ?? 0),
  "A+B+D min": (a) => Math.min(a.complete, 1 - a.missing, a.kind.all_done ?? 0),
  "A+B+C+D media": (a) => (a.complete + (1 - a.missing) + (a.level[4] ?? 0) + (a.kind.all_done ?? 0)) / 4,
  "B+D  media": (a) => (1 - a.missing + (a.kind.all_done ?? 0)) / 2,
  "B+C+D media": (a) => (1 - a.missing + (a.level[4] ?? 0) + (a.kind.all_done ?? 0)) / 3,
};

interface Score {
  readonly acc: number;
  readonly falseYes: number;
  readonly falseNo: number;
  readonly n: number;
}

function score(samples: readonly Sample[], rule: (a: Answers) => number, cut: number): Score {
  let ok = 0;
  let falseYes = 0;
  let falseNo = 0;
  for (const s of samples) {
    const said = rule(s.a) >= cut;
    if (said === s.expected) ok++;
    else if (said) falseYes++;
    else falseNo++;
  }
  return { acc: ok / samples.length, falseYes, falseNo, n: samples.length };
}

/** Área bajo la curva ROC: probabilidad de que un caso cumplido puntúe más alto que uno incompleto (0,5 = no separa, 1 = separa del todo). */
function auc(set: readonly Sample[], rule: (a: Answers) => number): number {
  const yes = set.filter((s) => s.expected).map((s) => rule(s.a));
  const no = set.filter((s) => !s.expected).map((s) => rule(s.a));
  if (yes.length === 0 || no.length === 0) return NaN;
  let wins = 0;
  for (const y of yes) for (const n of no) wins += y > n ? 1 : y === n ? 0.5 : 0;
  return wins / (yes.length * no.length);
}

/**
 * El corte más bajo de `dev` con a lo sumo `maxFalseYes` de los casos incompletos aprobados (el error caro: cerrar una tarea incompleta en silencio). Con el más bajo se aprueban
 * cuantos más cumplidos se pueda dentro de ese límite. Si ninguno lo cumple, 1,0 (no aprueba nada).
 */
function constrainedCut(dev: readonly Sample[], rule: (a: Answers) => number, maxFalseYes: number): number {
  const incomplete = dev.filter((s) => !s.expected);
  for (let c = 0.02; c <= 1.0001; c += 0.01) {
    const fy = incomplete.filter((s) => rule(s.a) >= c).length;
    if (incomplete.length === 0 || fy / incomplete.length <= maxFalseYes) return Math.round(c * 100) / 100;
  }
  return 1;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const samples = await collect();
const dev = samples.filter((s) => s.set === "dev");
const hold = samples.filter((s) => s.set === "holdout");
const MAX_FALSE_YES = Number(argv.find((x) => x.startsWith("--max-false-yes="))?.slice(16) ?? "0.1");
const countNo = (set: readonly Sample[]): number => set.filter((s) => !s.expected).length;
console.log(`casos: dev ${dev.length} (completos ${dev.filter((s) => s.expected).length}), holdout ${hold.length} (completos ${hold.filter((s) => s.expected).length})`);
console.log(`corte elegido en dev: el más bajo con a lo sumo ${pct(MAX_FALSE_YES)} de falsos «sí» sobre los incompletos (${countNo(dev)} en dev, ${countNo(hold)} en holdout)`);
console.log("");
console.log("regla".padEnd(32), "AUCdev AUChold | corte | dev: acc   fY  fN | holdout: acc   fY  fN | prod 0.75 dev / hold");
for (const [name, rule] of Object.entries(RULES)) {
  const cut = constrainedCut(dev, rule, MAX_FALSE_YES);
  const d = score(dev, rule, cut);
  const h = score(hold, rule, cut);
  const pd = score(dev, rule, COMPLETION_APPROVE);
  const ph = score(hold, rule, COMPLETION_APPROVE);
  console.log(
    name.padEnd(32),
    auc(dev, rule).toFixed(3).padStart(6),
    auc(hold, rule).toFixed(3).padStart(7),
    "|",
    cut.toFixed(2).padStart(5),
    `|      ${pct(d.acc).padStart(6)} ${String(d.falseYes).padStart(3)} ${String(d.falseNo).padStart(3)} |        ${pct(h.acc).padStart(6)} ${String(h.falseYes).padStart(3)} ${String(h.falseNo).padStart(3)} | ${pct(pd.acc)} / ${pct(ph.acc)}`,
  );
}

if (live) {
  console.log("");
  console.log("ESTADOS REALES (tarea de revisar la PC): id, esperado, y la probabilidad de «cumplido» de cada regla");
  const names = Object.keys(RULES);
  console.log("id".padEnd(22), "esp", names.map((n) => n.split(":")[0].split(" ")[0].padEnd(6)).join(" "));
  for (const smp of samples) {
    console.log(smp.id.padEnd(22), smp.expected ? "sí " : "no ", names.map((n) => RULES[n](smp.a).toFixed(2).padEnd(6)).join(" "));
  }
}
