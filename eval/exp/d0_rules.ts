/**
 * eval/exp/d0_rules.ts
 *
 * Análisis offline de las reglas con que D0 decide `chat` / `single` / `multi` a partir de sus dos preguntas: `kind` (choice: probabilidades de `chat`, `single` y `multi`) y `multi` (noul).
 * La regla de producción (`firstQueryKind`, `src/core/types/firstQuery.ts`) usa solo la probabilidad de `chat` de `kind` y, si no es charla, la `noul` `multi` con corte 0,5: la
 * probabilidad de `multi` de `kind` no se usa. En las trazas reales las dos preguntas se contradicen en un tercio de las consultas, así que acá se comparan reglas de combinación. No llama a ningún modelo.
 *
 * Uso: npx tsx eval/exp/d0_rules.ts <carpeta de resultados> [--variant=prod] [--dataset=texto] [--bucket=canonical|raw|all]
 *   Lee los `runs.jsonl` de la etapa `d0` (carpetas `<variante>__<dataset>`). Por omisión, la variante `prod` y el bucket `canonical`.
 *
 * Para cada regla informa: acierto, falsos `chat` (el error caro: una tarea que necesita herramientas se contesta sin ellas), `multi` de más y `multi` perdido.
 */

import fs from "node:fs";
import path from "node:path";

import { FIRST_QUERY_CHAT_APPROVE, FIRST_QUERY_MULTI_APPROVE, type FirstQueryKind } from "../core/contract.ts";

interface Sample {
  readonly id: string;
  readonly chat: number;
  readonly kindMulti: number;
  readonly multiNoul: number;
  readonly expected: FirstQueryKind;
}

interface Rule {
  readonly name: string;
  readonly decide: (s: Sample) => FirstQueryKind;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isKind = (v: unknown): v is FirstQueryKind => v === "chat" || v === "single" || v === "multi";

/** Charla solo con la probabilidad de producción; el resto de las reglas cambia cómo se decide entre una acción y varias. */
const withChat = (s: Sample, otherwise: () => FirstQueryKind): FirstQueryKind => (s.chat >= FIRST_QUERY_CHAT_APPROVE ? "chat" : otherwise());

const RULES: readonly Rule[] = [
  { name: "producción: `chat` ≥ 0,7; si no, `multi` (noul) ≥ 0,5", decide: (s) => withChat(s, () => (s.multiNoul >= FIRST_QUERY_MULTI_APPROVE ? "multi" : "single")) },
  ...[0.5, 0.6, 0.7, 0.8, 0.9].map<Rule>((t) => ({
    name: `solo \`kind\`: \`multi\` (choice) ≥ ${t}`,
    decide: (s) => withChat(s, () => (s.kindMulti >= t ? "multi" : "single")),
  })),
  { name: "O: `multi` (noul) ≥ 0,5 o `multi` (choice) ≥ 0,9", decide: (s) => withChat(s, () => (s.multiNoul >= 0.5 || s.kindMulti >= 0.9 ? "multi" : "single")) },
  { name: "O: `multi` (noul) ≥ 0,5 o `multi` (choice) ≥ 0,8", decide: (s) => withChat(s, () => (s.multiNoul >= 0.5 || s.kindMulti >= 0.8 ? "multi" : "single")) },
  { name: "Y: `multi` (noul) ≥ 0,5 y `multi` (choice) ≥ 0,5", decide: (s) => withChat(s, () => (s.multiNoul >= 0.5 && s.kindMulti >= 0.5 ? "multi" : "single")) },
  { name: "promedio de `multi` (noul) y `multi` (choice) ≥ 0,5", decide: (s) => withChat(s, () => ((s.multiNoul + s.kindMulti) / 2 >= 0.5 ? "multi" : "single")) },
  { name: "promedio de `multi` (noul) y `multi` (choice) ≥ 0,4", decide: (s) => withChat(s, () => ((s.multiNoul + s.kindMulti) / 2 >= 0.4 ? "multi" : "single")) },
];

interface Options {
  readonly root: string;
  readonly variant: string;
  readonly dataset: string | undefined;
  readonly bucket: string;
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
    console.error("Uso: npx tsx eval/exp/d0_rules.ts <carpeta de resultados> [--variant=prod] [--dataset=texto] [--bucket=canonical|raw|all]");
    process.exit(2);
  }
  return { root: positional[0], variant: flags.get("variant") ?? "prod", dataset: flags.get("dataset"), bucket: flags.get("bucket") ?? "canonical" };
}

function findRuns(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRuns(full));
    else if (entry.name === "runs.jsonl") out.push(full);
  }
  return out;
}

function collect(options: Options): Sample[] {
  const samples: Sample[] = [];
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
      if (!isRecord(run) || run.stage !== "d0" || run.iteration !== 1) continue;
      if (options.bucket !== "all" && run.bucket !== options.bucket) continue;
      const out = run.parsedOutput;
      if (!isRecord(out) || !isRecord(out.probabilities) || typeof out.multi !== "number" || !isKind(run.expectedLabel)) continue;
      const { chat, multi } = out.probabilities;
      if (typeof chat !== "number" || typeof multi !== "number") continue;
      samples.push({ id: `${dataset}:${String(run.caseId)}`, chat, kindMulti: multi, multiNoul: out.multi, expected: run.expectedLabel });
    }
  }
  return samples;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  if (!fs.existsSync(options.root)) {
    console.error(`No existe la carpeta '${options.root}'.`);
    process.exit(2);
  }
  const samples = collect(options);
  if (samples.length === 0) {
    console.error(`No hay corridas de la etapa d0 con probabilidades en '${options.root}' (variante '${options.variant}', bucket '${options.bucket}').`);
    process.exit(2);
  }

  const byKind = (k: FirstQueryKind): number => samples.filter((s) => s.expected === k).length;
  console.log(`# Reglas de D0\n\nCarpeta: \`${options.root}\` · variante: \`${options.variant}\` · bucket: \`${options.bucket}\` · ${samples.length} casos (${byKind("chat")} charla, ${byKind("single")} una acción, ${byKind("multi")} varias)\n`);

  const production = RULES[0];
  const disagree = samples.filter((s) => (s.kindMulti >= 0.5) !== (s.multiNoul >= FIRST_QUERY_MULTI_APPROVE) && s.chat < FIRST_QUERY_CHAT_APPROVE);
  console.log(`Fuera de la charla, \`multi\` (choice) y \`multi\` (noul) se contradicen en ${disagree.length} de ${samples.filter((s) => s.chat < FIRST_QUERY_CHAT_APPROVE).length} casos.\n`);

  console.log("| Regla | Acierto | Falsos `chat` | `multi` de más | `multi` perdido |\n|---|---:|---:|---:|---:|");
  for (const rule of RULES) {
    const decided = samples.map((s) => ({ s, kind: rule.decide(s) }));
    const hits = decided.filter(({ s, kind }) => kind === s.expected).length;
    const falseChat = decided.filter(({ s, kind }) => kind === "chat" && s.expected !== "chat").length;
    const extraMulti = decided.filter(({ s, kind }) => kind === "multi" && s.expected !== "multi").length;
    const missedMulti = decided.filter(({ s, kind }) => kind !== "multi" && s.expected === "multi").length;
    console.log(`| ${rule.name} | ${hits}/${samples.length} (${((100 * hits) / samples.length).toFixed(1)} %) | ${falseChat} | ${extraMulti} | ${missedMulti} |`);
  }

  console.log("\n## Casos en que las dos preguntas se contradicen (con la regla de producción)\n");
  console.log("| Caso | Esperado | `multi` (noul) | `multi` (choice) | Producción decide |\n|---|---|---:|---:|---|");
  for (const s of disagree.slice(0, 25)) {
    console.log(`| ${s.id} | ${s.expected} | ${s.multiNoul.toFixed(2)} | ${s.kindMulti.toFixed(2)} | ${production.decide(s)} |`);
  }
  if (disagree.length > 25) console.log(`\n… y ${disagree.length - 25} más.`);
}

main();
