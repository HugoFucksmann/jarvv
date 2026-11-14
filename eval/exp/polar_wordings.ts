/**
 * eval/exp/polar_wordings.ts
 *
 * Experimento (no es una etapa): redacciones alternativas de las preguntas específicas (posición, alcance, ítem, atributo) sobre las filas de `hard_cases.jsonl`. Lo que separó:
 * explicar la semántica de la herramienta en el estado («mode append agrega al FINAL»), poner lado a lado lo pedido y lo hecho en dos líneas, y mostrar el nombre del ítem devuelto.
 * Uso: npx tsx eval/exp/polar_wordings.ts [modelo]
 */
import { readFileSync } from "node:fs";
import { materializeScenario } from "../core/scenario.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const rows = readFileSync(new URL("./hard_cases.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const noul = (instructions: string) => ({ type: "noul", instructions });
async function ask(state: string, q: unknown): Promise<number> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions: { q }, keep_alive: "10m" }) });
  return ((await r.json()) as { answers: { q: { noul: number } } }).answers.q.noul;
}
const stateOf = (row: { scenario: unknown }): string => (materializeScenario("result_verification", row.scenario as never).request as unknown as { state: string }).state;
const lastCall = (row: { scenario: { calls: { args: Record<string, unknown>; tool: string; summary: string }[] } }) => row.scenario.calls[row.scenario.calls.length - 1];

// Cada variante: [clase, nombre, función(row) → {state, question, bad?}]
type V = { cls: string; name: string; bad?: boolean; build: (row: any) => { state: string; q: unknown; bad?: boolean } };
const variants: V[] = [
  // posición (c3)
  { cls: "c3", name: "base (hoy)", build: (r) => ({ state: stateOf(r), q: noul("Is the new text placed where the step says (the start or the end of the file)?") }) },
  {
    cls: "c3", name: "con el modo explicado",
    build: (r) => {
      const c = lastCall(r); const step = r.scenario.request as string;
      const where = c.args.mode === "append" ? "The text was ADDED AT THE END of the file (mode append)." : `The file was REWRITTEN as a whole; its content now starts with: ${JSON.stringify(String(c.args.content).slice(0, 60))}`;
      return { state: `Step: ${step}\n${where}`, q: noul("Is the text where the step says (the start or the end of the file)?") };
    },
  },
  {
    cls: "c3", name: "pregunta sobre el comienzo",
    build: (r) => {
      const c = lastCall(r); const step = r.scenario.request as string;
      const where = c.args.mode === "append" ? "Text added at the END of the file." : `New file content (first line): ${JSON.stringify(String(c.args.content).split("\n")[0])}`;
      return { state: `Step: ${step}\n${where}`, q: noul("If the step asks for the START of the file, is the text at the start? If the step asks for the end, is it at the end?") };
    },
  },
  // alcance (c4)
  { cls: "c4", name: "base (hoy)", build: (r) => ({ state: stateOf(r), q: noul("Does the search or command cover everything the step asks for (all items, not only a subset)?") }) },
  {
    cls: "c4", name: "patrón explícito",
    build: (r) => { const c = lastCall(r); const step = r.scenario.request as string; return { state: `Step: ${step}\nSearch pattern used: ${c.args.pattern}\nFiles found:\n${c.summary}`, q: noul("Does the search pattern match every file the step asks for?") }; },
  },
  {
    cls: "c4", name: "¿el patrón es más angosto?", bad: true,
    build: (r) => { const c = lastCall(r); const step = r.scenario.request as string; return { state: `Step: ${step}\nSearch pattern used: ${c.args.pattern}\nFiles found:\n${c.summary}`, q: noul("Is the search pattern narrower than what the step asks for (it would miss some of the files)?") }; },
  },
  {
    cls: "c4", name: "restricción no pedida", bad: true,
    build: (r) => { const c = lastCall(r); const step = r.scenario.request as string; return { state: `Step: ${step}
Search pattern used: ${c.args.pattern}`, q: noul("Does the search pattern add a restriction (a name prefix, a name part or an extension) that the step does not ask for?") }; },
  },
  {
    cls: "c4", name: "¿el pedido nombra ese prefijo?",
    build: (r) => { const c = lastCall(r); const step = r.scenario.request as string; return { state: `Step: ${step}
Search pattern used: ${c.args.pattern}`, q: noul("Does everything in the search pattern come from the step (every name part and the extension are named in the step)?") }; },
  },
  {
    cls: "c4", name: "pedido vs patrón, dos líneas",
    build: (r) => { const c = lastCall(r); const step = r.scenario.request as string; return { state: `The user asked for: ${step}
The search looked only for names matching: ${c.args.pattern}`, q: noul("Are the two the same set of files?") }; },
  },
  // ítem (c5)
  { cls: "c5", name: "base (hoy)", build: (r) => ({ state: stateOf(r), q: noul("Does the result show the specific item the step names (the sheet, file, folder, period or item), not a default or a different one?") }) },
  {
    cls: "c5", name: "cabecera = nombre pedido",
    build: (r) => { const step = r.scenario.request as string; const c = lastCall(r); return { state: `Step: ${step}\nWhat the tool returned (first lines):\n${c.summary}`, q: noul("Does the first line of the result show the same name that the step asks for?") }; },
  },
  {
    cls: "c5", name: "¿se leyó un ítem por defecto?", bad: true,
    build: (r) => { const step = r.scenario.request as string; const c = lastCall(r); return { state: `Step: ${step}\nArguments sent: ${JSON.stringify(c.args)}\nWhat the tool returned (first lines):\n${c.summary}`, q: noul("The step names a specific item. Was a default or a different item read instead?") }; },
  },
  // atributo (c6)
  { cls: "c6", name: "base (hoy)", build: (r) => ({ state: stateOf(r), q: noul("Does the result include every attribute needed to answer the step (such as dates, sizes or counts)?") }) },
  {
    cls: "c6", name: "¿trae fechas o tamaños?",
    build: (r) => { const step = r.scenario.request as string; const c = lastCall(r); return { state: `Step: ${step}\nResult:\n${c.summary}`, q: noul("To answer the step, do the items need dates, sizes or an order? If so, does the result show them?") }; },
  },
  {
    cls: "c6", name: "¿falta lo que se ordena?", bad: true,
    build: (r) => { const step = r.scenario.request as string; const c = lastCall(r); return { state: `Step: ${step}\nResult:\n${c.summary}`, q: noul("The step asks to choose or order items by some property (recent, large, old). Is that property missing from the result?") }; },
  },
];

const classes = ["c4"];
for (const cls of classes) {
  for (const v of variants.filter((x) => x.cls === cls)) {
    const out: string[] = [];
    for (const pair of ["bad", "good"] as const) {
      const row = rows.find((r) => r.id === `${cls}-${pair}`);
      const { state, q, bad } = v.build(row);
      const p = await ask(state, q);
      out.push(`${pair} ${(v.bad || bad ? 1 - p : p).toFixed(2)}`);
    }
    const [b, g] = out.map((s) => Number(s.split(" ")[1]));
    console.log(`RESULT ${cls} ${v.name.padEnd(30)} «bien»: ${out.join(" | ")}  separación ${(g - b).toFixed(2)}`);
  }
}
