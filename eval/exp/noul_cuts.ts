/**
 * eval/exp/noul_cuts.ts
 *
 * Análisis offline de los cortes de las preguntas `noul`. Una `noul` devuelve la probabilidad del «sí»: 0,5 es «no sé» y la confianza crece con la distancia a 0,5. El código decide
 * comparando esa probabilidad con un corte propio de cada pregunta; este script mide, con las respuestas ya guardadas en `runs.jsonl`, qué pasa con cada corte. No llama a ningún modelo.
 *
 * Por pregunta (`ok` y `cumple` de la verificación, cierre D5, `multi` de D0, continuación del hilo y juez de fragmentos) imprime:
 *   1. cuántos casos caen en cada tramo de 0,1 y qué porcentaje de ellos son realmente «sí»;
 *   2. para cada corte de 0,10 a 0,90 (paso 0,05): «malas aprobadas» (corte alcanzado y esperado «no») y «buenas rechazadas» (corte no alcanzado y esperado «sí»);
 *   3. el comparativo de tres juegos de cortes: producción actual, mejor medido y mejor medido menos 5 puntos.
 *
 * Uso: npx tsx eval/exp/noul_cuts.ts <carpeta de resultados> [--variant=prod] [--dataset=texto] [--bucket=canonical|raw|all] [--best-range=0.25-0.75]
 *   - `<carpeta de resultados>`: una corrida (`eval/results/<modelo>/<corrida>/`) o la carpeta de un modelo; se buscan todos los `runs.jsonl` por debajo.
 *   - `--variant`: solo las celdas de esa variante (el nombre de la carpeta es `<variante>__<dataset>`). Por omisión, `prod`.
 *   - `--dataset`: solo las celdas cuyo nombre de dataset contiene ese texto.
 *   - `--bucket`: por omisión, `canonical` (los adversariales `isRaw` quedan fuera).
 *   - `--best-range`: tramo de cortes donde se busca el «mejor medido»; evita elegir extremos (por omisión 0.25-0.75).
 */

import fs from "node:fs";
import path from "node:path";

import { COMPLETION_APPROVE, CONTINUATION_APPROVE, FIRST_QUERY_MULTI_APPROVE, JUDGE_FOUND, VERIFY_APPROVE } from "../core/contract.ts";

/** Una respuesta `noul` con su respuesta esperada. */
interface Sample {
  readonly p: number;
  readonly yes: boolean;
  readonly id: string;
}

type Family = "D4 ok" | "D4 cumple" | "D5 cierre" | "D0 multi" | "Continuación" | "Juez de fragmentos";

/** Cortes de producción, leídos de `src/` (no se copian). */
const PRODUCTION_CUTS: Readonly<Record<Family, number>> = {
  "D4 ok": VERIFY_APPROVE.ok,
  "D4 cumple": VERIFY_APPROVE.cumple,
  "D5 cierre": COMPLETION_APPROVE,
  "D0 multi": FIRST_QUERY_MULTI_APPROVE,
  Continuación: CONTINUATION_APPROVE,
  "Juez de fragmentos": JUDGE_FOUND,
};
const FAMILIES = Object.keys(PRODUCTION_CUTS) as Family[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round = (x: number): number => Math.round(x * 100) / 100;

interface Options {
  readonly root: string;
  readonly variant: string;
  readonly dataset: string | undefined;
  readonly bucket: string;
  readonly bestRange: readonly [number, number];
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (m) flags.set(m[1], m[2]);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error("Uso: npx tsx eval/exp/noul_cuts.ts <carpeta de resultados> [--variant=prod] [--dataset=texto] [--bucket=canonical|raw|all] [--best-range=0.25-0.75]");
    process.exit(2);
  }
  const range = /^(\d(?:\.\d+)?)-(\d(?:\.\d+)?)$/.exec(flags.get("best-range") ?? "0.25-0.75");
  if (!range || Number(range[1]) >= Number(range[2])) {
    console.error("--best-range debe ser `min-max`, por ejemplo 0.25-0.75.");
    process.exit(2);
  }
  return {
    root: positional[0],
    variant: flags.get("variant") ?? "prod",
    dataset: flags.get("dataset"),
    bucket: flags.get("bucket") ?? "canonical",
    bestRange: [Number(range[1]), Number(range[2])],
  };
}

/** Todos los `runs.jsonl` por debajo de `dir`. */
function findRuns(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRuns(full));
    else if (entry.name === "runs.jsonl") out.push(full);
  }
  return out;
}

/** Una pregunta `noul` de un run: su probabilidad y la respuesta esperada (`yes`/`no`), si las tiene. */
function noulOf(run: Record<string, unknown>, key: string): Sample | null {
  const questions = run.questions;
  if (!isRecord(questions)) return null;
  const q = questions[key];
  if (!isRecord(q) || q.type !== "noul" || typeof q.noul !== "number") return null;
  if (q.expected !== "yes" && q.expected !== "no") return null;
  return { p: q.noul, yes: q.expected === "yes", id: String(run.caseId) };
}

function collect(options: Options): Map<Family, Sample[]> {
  const byFamily = new Map<Family, Sample[]>(FAMILIES.map((f) => [f, []]));
  const add = (family: Family, sample: Sample | null, dataset: string): void => {
    if (sample !== null) byFamily.get(family)!.push({ ...sample, id: `${dataset}:${sample.id}` });
  };

  for (const file of findRuns(options.root)) {
    const cell = path.basename(path.dirname(file));
    const sep = cell.lastIndexOf("__");
    if (sep < 0 || cell.slice(0, sep) !== options.variant) continue;
    const dataset = cell.slice(sep + 2);
    if (options.dataset !== undefined && !dataset.includes(options.dataset)) continue;

    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      let run: unknown;
      try {
        run = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(run) || run.iteration !== 1) continue;
      if (options.bucket !== "all" && run.bucket !== options.bucket) continue;

      switch (run.stage) {
        case "result_verification":
          add("D4 ok", noulOf(run, "ok"), dataset);
          add("D4 cumple", noulOf(run, "cumple"), dataset);
          break;
        case "d5":
          add("D5 cierre", noulOf(run, "request_complete"), dataset);
          break;
        case "continuation":
          add("Continuación", noulOf(run, "follow"), dataset);
          break;
        case "fragment_judge":
          if (isRecord(run.questions)) {
            const fKeys = Object.keys(run.questions)
              .filter((k) => /^f\d+$/.test(k))
              .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
            for (const key of fKeys) add("Juez de fragmentos", noulOf(run, key), dataset);
          }
          break;
        case "d0": {
          // La respuesta esperada de `multi` sale de la etiqueta del caso (`expectedKind`).
          const out = run.parsedOutput;
          if (isRecord(out) && typeof out.multi === "number" && typeof run.expectedLabel === "string") {
            add("D0 multi", { p: out.multi, yes: run.expectedLabel === "multi", id: String(run.caseId) }, dataset);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return byFamily;
}

interface CutResult {
  readonly cut: number;
  readonly badApproved: number;
  readonly goodRejected: number;
}

const errorsOf = (r: CutResult): number => r.badApproved + r.goodRejected;

function evaluate(samples: readonly Sample[], cut: number): CutResult {
  let badApproved = 0;
  let goodRejected = 0;
  for (const s of samples) {
    if (s.p >= cut && !s.yes) badApproved++;
    if (s.p < cut && s.yes) goodRejected++;
  }
  return { cut, badApproved, goodRejected };
}

/** El corte con menos errores dentro de `range`; ante un empate, el más cercano al de producción. */
function bestCut(samples: readonly Sample[], range: readonly [number, number], production: number): CutResult {
  let best: CutResult | null = null;
  for (let c = Math.round(range[0] * 100); c <= Math.round(range[1] * 100); c += 5) {
    const result = evaluate(samples, c / 100);
    if (
      best === null ||
      errorsOf(result) < errorsOf(best) ||
      (errorsOf(result) === errorsOf(best) && Math.abs(result.cut - production) < Math.abs(best.cut - production))
    ) {
      best = result;
    }
  }
  return best!;
}

function printFamily(family: Family, samples: readonly Sample[], options: Options): { readonly best: CutResult } {
  const production = PRODUCTION_CUTS[family];
  const yes = samples.filter((s) => s.yes).length;
  console.log(`\n## ${family} (n=${samples.length}: ${yes} «sí» y ${samples.length - yes} «no»; corte de producción ${production})`);

  console.log("\n| Tramo de p | Casos | % que son «sí» |\n|---|---:|---:|");
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const inBand = samples.filter((s) => s.p >= lo && (i === 9 ? s.p <= hi : s.p < hi));
    const pct = inBand.length === 0 ? "—" : `${Math.round((100 * inBand.filter((s) => s.yes).length) / inBand.length)} %`;
    console.log(`| ${lo.toFixed(1)} a ${hi.toFixed(1)} | ${inBand.length} | ${pct} |`);
  }

  const best = bestCut(samples, options.bestRange, production);
  console.log("\n| Corte | Malas aprobadas | Buenas rechazadas | Errores | |\n|---:|---:|---:|---:|---|");
  for (let c = 10; c <= 90; c += 5) {
    const r = evaluate(samples, c / 100);
    const marks = [Math.abs(r.cut - production) < 1e-9 ? "producción" : "", Math.abs(r.cut - best.cut) < 1e-9 ? "mejor medido" : ""].filter((m) => m !== "");
    console.log(`| ${r.cut.toFixed(2)} | ${r.badApproved} | ${r.goodRejected} | ${errorsOf(r)} | ${marks.join(", ")} |`);
  }
  return { best };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  if (!fs.existsSync(options.root)) {
    console.error(`No existe la carpeta '${options.root}'.`);
    process.exit(2);
  }
  const byFamily = collect(options);
  const present = FAMILIES.filter((f) => byFamily.get(f)!.length > 0);
  if (present.length === 0) {
    console.error(`No hay respuestas \`noul\` con respuesta esperada en '${options.root}' (variante '${options.variant}', bucket '${options.bucket}').`);
    process.exit(2);
  }

  console.log(`# Cortes de las preguntas noul\n\nCarpeta: \`${options.root}\` · variante: \`${options.variant}\` · bucket: \`${options.bucket}\`${options.dataset ? ` · dataset: \`${options.dataset}\`` : ""} · rango del «mejor medido»: ${options.bestRange[0]} a ${options.bestRange[1]}`);

  const bests = new Map<Family, CutResult>();
  for (const family of present) bests.set(family, printFamily(family, byFamily.get(family)!, options).best);

  console.log("\n## Comparativo de tres juegos de cortes\n");
  console.log("| Pregunta | Producción: corte (malas / buenas) | Mejor medido: corte (malas / buenas) | Mejor menos 5 puntos: corte (malas / buenas) |\n|---|---|---|---|");
  const totals = [
    { bad: 0, good: 0 },
    { bad: 0, good: 0 },
    { bad: 0, good: 0 },
  ];
  for (const family of present) {
    const samples = byFamily.get(family)!;
    const best = bests.get(family)!;
    const sets = [evaluate(samples, PRODUCTION_CUTS[family]), best, evaluate(samples, round(best.cut - 0.05))];
    sets.forEach((r, i) => {
      totals[i].bad += r.badApproved;
      totals[i].good += r.goodRejected;
    });
    console.log(`| ${family} | ${sets.map((r) => `${r.cut.toFixed(2)} (${r.badApproved} / ${r.goodRejected})`).join(" | ")} |`);
  }
  console.log(`| **Total** | ${totals.map((t) => `${t.bad} malas, ${t.good} buenas = ${t.bad + t.good} errores`).join(" | ")} |`);
  console.log("\nLectura: «malas aprobadas» es el error caro (pasa algo que no debía); «buenas rechazadas» se paga con una tarea que no avanza. Un total parecido con más malas aprobadas NO es una mejora.");
}

main();
