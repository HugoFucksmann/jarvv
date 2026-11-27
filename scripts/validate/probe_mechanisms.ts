/**
 * Mide contra el modelo de decisión real dos preguntas candidatas a mecanismo, con datos de trazas guardadas (no toca el motor):
 *
 * 1. Dependencia entre ítems de la lista: «¿el ítem B necesita el resultado del ítem A?» (`noul`), una consulta con un par por pregunta.
 * 2. Respaldo del contenido de una escritura: tipo de texto (`choice`) y si lo que afirma sale de las lecturas (`noul`).
 *
 *   npx tsx scripts/validate/probe_mechanisms.ts
 *
 * Necesita el servicio de decisión en marcha.
 */

import fs from "node:fs";

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import type { DecisionQuestion } from "../../src/core/types.ts";

const engine = new Decision20Engine(() => ConfigManager.getConfig());
const noul = (r: Record<string, { noul?: number }>, k: string): number => r[k].noul ?? NaN;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ───────────────────────── 1. Dependencia entre ítems ─────────────────────────

const DEPENDS: DecisionQuestion = {
  type: "noul",
  instructions: "",
  criteria: {
    true: "B uses something that A produces, finds or creates, so A has to be done first.",
    false: "B can be done without A: they are separate things to do.",
  },
};

async function dependencies(request: string, a: string, bs: readonly string[]): Promise<number[]> {
  const questions: Record<string, DecisionQuestion> = {};
  bs.forEach((b, i) => {
    questions[`b${i}`] = { ...DEPENDS, instructions: `ITEM A: "${a}"\nITEM B: "${b}"\nDoes ITEM B need the result of ITEM A?` } as DecisionQuestion;
  });
  const response = await engine.systemOne(`REQUEST: ${request}`, questions);
  return bs.map((_, i) => noul(response.answers as never, `b${i}`));
}

const UShuaia = "quiero organizar un viaje a ushuaia. yo estoy en santa fe. crea un md dentro de la carpeta jarvis y recopila toda la informacion para el viaje.";
const BA = "Quiero organizar un viaje a la provincia de buenos aires, Argentina. Recopila información de hospedaje, pasajes, lugares para recorrer y guárdalo en un md en la carpeta jarvis del escritorio.";

console.log("\n== 1. ¿B necesita el resultado de A? (esperado: independientes bajo, dependientes alto)");
const cases: { name: string; request: string; a: string; bs: { text: string; expect: "dep" | "indep" }[] }[] = [
  {
    name: "Ushuaia: A = crear el archivo con el título",
    request: UShuaia,
    a: "Crear archivo markdown en la carpeta Jarvis con el título 'Viaje a Ushuaia'",
    bs: [
      { text: "Recopilar información sobre vuelos desde Santa Fe a Ushuaia", expect: "indep" },
      { text: "Recopilar información sobre hoteles en Ushuaia", expect: "indep" },
      { text: "Recopilar información sobre clima esperado para el viaje", expect: "indep" },
      { text: "Recopilar información sobre requisitos de documentación para viajar a Ushuaia", expect: "indep" },
    ],
  },
  {
    name: "Buenos Aires: A = recopilar pasajes",
    request: BA,
    a: "Recopilar información de pasajes aéreos o terrestres hacia Buenos Aires",
    bs: [
      { text: "Recopilar información de hospedaje en Buenos Aires", expect: "indep" },
      { text: "Recopilar información de lugares turísticos para recorrer en Buenos Aires", expect: "indep" },
      { text: "Agregar la información de pasajes al archivo md", expect: "dep" },
      { text: "Crear archivo markdown en la carpeta jarvis del escritorio con la información recopilada", expect: "dep" },
    ],
  },
  {
    name: "Gemini/GPT: A = información del último modelo de Gemini",
    request: "busca el ultimo modelo de gemini y gpt. guarda en un md dentro de la carpeta jarvis del escritorio la informacion completa",
    a: "Obtener información sobre el último modelo de Gemini",
    bs: [
      { text: "Obtener información sobre el último modelo de GPT", expect: "indep" },
      { text: "Guardar la información recopilada en un archivo markdown dentro de la carpeta 'jarvis' del escritorio", expect: "dep" },
    ],
  },
  {
    name: "Mover y renombrar: A = mover el archivo",
    request: "mueve informe.pdf a documentos y después renómbralo como informe_final.pdf, y también lista mi escritorio",
    a: "Mover informe.pdf a la carpeta Documentos",
    bs: [
      { text: "Renombrar informe.pdf como informe_final.pdf", expect: "dep" },
      { text: "Listar los archivos del escritorio", expect: "indep" },
    ],
  },
];
for (const c of cases) {
  const started = Date.now();
  const p = await dependencies(c.request, c.a, c.bs.map((b) => b.text));
  console.log(`\n${c.name}  (${Date.now() - started} ms)`);
  c.bs.forEach((b, i) => console.log(`   ${p[i].toFixed(2)}  esperado ${b.expect === "dep" ? "ALTO " : "bajo "}  ${clip(b.text, 80)}`));
}

// ───────────────────────── 2. Respaldo del contenido ─────────────────────────

console.log("\n== 2. ¿El contenido que se escribe sale de las lecturas? (esperado: sin lecturas bajo; con lecturas alto)");
async function grounding(request: string, reads: string, content: string): Promise<{ doc: number; supported: number }> {
  const state = `REQUEST: ${request}\n\nREADS:\n${reads}\n\nCONTENT:\n${clip(content, 1500)}`;
  const response = await engine.systemOne(state, {
    t: {
      type: "choice",
      instructions: "What is CONTENT?",
      criteria: {
        document: "Written information for the user: facts, names, prices, places, dates or recommendations.",
        other: "Code, a command, configuration, or a short label or title.",
      },
    },
    s: {
      type: "noul",
      instructions: "Is the information stated in CONTENT supported by READS?",
      criteria: {
        true: "The facts, names and figures in CONTENT appear in READS or follow directly from them.",
        false: "CONTENT states facts, names or figures that READS do not contain, or READS is empty.",
      },
    },
  });
  const t = response.answers.t as { probabilities: Record<string, number> };
  return { doc: t.probabilities.document ?? 0, supported: noul(response.answers as never, "s") };
}

function traceCase(file: string, pick: (calls: { tool: string; kind: string; status: string; args: Record<string, unknown>; summary: string | null }[]) => { request: string; reads: string; content: string }): Promise<{ doc: number; supported: number }> {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")).snapshot;
  const { request, reads, content } = pick(snap.calls);
  return grounding(request, reads, content);
}

const root = "jarvis-traces/";
const readsOf = (calls: { tool: string; kind: string; status: string; summary: string | null; args: Record<string, unknown> }[]): string =>
  calls
    .filter((c) => c.kind === "read" && c.status === "ok" && c.summary)
    .map((c) => `- ${c.tool} ${clip(JSON.stringify(c.args), 100)} => ${clip(c.summary!.replace(/\s+/g, " "), 350)}`)
    .join("\n") || "(none)";
const firstWrite = (calls: { kind: string; args: Record<string, unknown> }[]): string => String(calls.find((c) => c.kind === "write")?.args.content ?? "");

const gr: { name: string; expect: string; run: () => Promise<{ doc: number; supported: number }> }[] = [
  {
    name: "Ushuaia c1: itinerario escrito sin ninguna lectura",
    expect: "BAJO",
    run: () => traceCase(`${root}20261124-153754_task_1795545474135_9xel/trace.json`, (calls) => ({ request: UShuaia, reads: "(none)", content: firstWrite(calls) })),
  },
  {
    name: "Mendoza 8dav c1: hoteles con precios inventados, sin lecturas",
    expect: "BAJO",
    run: () => traceCase(`${root}20261124-133951_task_1795538391890_8dav/trace.json`, (calls) => ({ request: "viaje a mendoza: hospedaje, pasajes, lugares", reads: "(none)", content: firstWrite(calls) })),
  },
  {
    name: "Gemini/GPT c4: resumen escrito con las dos búsquedas hechas",
    expect: "ALTO",
    run: () => traceCase(`${root}20261124-152953_task_1795544993997_jua4/trace.json`, (calls) => ({ request: "busca el ultimo modelo de gemini y gpt. guarda en un md la informacion completa", reads: readsOf(calls), content: firstWrite(calls) })),
  },
  {
    name: "Mendoza fn8i c3: hospedaje escrito con la búsqueda de hospedaje hecha",
    expect: "ALTO",
    run: () => traceCase(`${root}20261124-134515_task_1795538715970_fn8i/trace.json`, (calls) => ({ request: "viaje a mendoza: hospedaje, pasajes, lugares", reads: readsOf(calls.slice(0, 1)), content: String(calls.filter((c) => c.kind === "write")[1]?.args.content ?? "") })),
  },
];
for (const g of gr) {
  const started = Date.now();
  const r = await g.run();
  console.log(`\n${g.name}  (${Date.now() - started} ms)\n   documento=${r.doc.toFixed(2)}  respaldado=${r.supported.toFixed(2)}   esperado ${g.expect}`);
}
