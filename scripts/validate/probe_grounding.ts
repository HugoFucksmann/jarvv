/**
 * Variantes de la pregunta «¿lo que se escribe sale de las lecturas?» contra el modelo de decisión real, con contenido de trazas y un control de escritura creativa
 * (un poema sin lecturas no debe bloquearse). Resultado medido (2026-11-24): con datos inventados concretos (Mendoza) `supported` da 0,05; con lecturas, 0,88 a 0,91; pero
 * con contenido genérico (itinerario de Ushuaia) da 0,65 y la condición «el pedido pide recopilar» da 0,57: todavía no alcanza para una compuerta que rechace. Sin integrar al motor.
 *
 *   npx tsx scripts/validate/probe_grounding.ts
 */

import fs from "node:fs";
import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";

const engine = new Decision20Engine(() => ConfigManager.getConfig());
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const snap = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")).snapshot;
const write = (f: string, i = 0): string => String(snap(f).calls.filter((c: { kind: string }) => c.kind === "write")[i]?.args.content ?? "");
const U = "quiero organizar un viaje a ushuaia. yo estoy en santa fe. crea un md dentro de la carpeta jarvis y recopila toda la informacion para el viaje.";
const POEM = "escribe un poema corto sobre el mar y guárdalo en poema.md en el escritorio";
const cases = [
  { name: "Ushuaia c1 (inventado, sin lecturas)", request: U, reads: "(none)", content: write("jarvis-traces/20261124-153754_task_1795545474135_9xel/trace.json"), want: "BAJO" },
  { name: "Mendoza 8dav c1 (inventado)", request: "viaje a mendoza: hospedaje, pasajes y lugares, guárdalo en un md", reads: "(none)", content: write("jarvis-traces/20261124-133951_task_1795538391890_8dav/trace.json"), want: "BAJO" },
  { name: "Poema (creativo, sin lecturas)", request: POEM, reads: "(none)", content: "# El mar\n\nEl mar respira en la noche,\nlas olas cuentan su historia,\ny la sal guarda en silencio\nel eco de la memoria.\n", want: "OK (no bloquear)" },
  { name: "Gemini/GPT c4 (con lecturas)", request: "busca el ultimo modelo de gemini y gpt. guarda en un md la informacion completa", reads: "- web_search => Google lanzó Gemini 4 Carbon el 10 de noviembre de 2026. OpenAI lanzó GPT-6.2 Astra y Sol el 17 de noviembre de 2026.", content: write("jarvis-traces/20261124-152953_task_1795544993997_jua4/trace.json"), want: "OK" },
];
for (const c of cases) {
  const state = `REQUEST: ${c.request}\n\nREADS:\n${c.reads}\n\nCONTENT:\n${clip(c.content, 1500)}`;
  const r = await engine.systemOne(state, {
    gather: { type: "noul", instructions: "Does the REQUEST ask to look up, search or collect information (from the web or the computer), as opposed to writing something from scratch?", criteria: { true: "The request asks to find, research or collect information that is not already given in it.", false: "The request asks to write or create something from the user's own words or from imagination, with nothing to look up." } },
    supported: { type: "noul", instructions: "Is the information stated in CONTENT supported by READS?", criteria: { true: "The facts, names and figures in CONTENT appear in READS or follow directly from them.", false: "CONTENT states facts, names or figures that READS do not contain, or READS is empty." } },
    unsupported: { type: "noul", instructions: "Does CONTENT state facts, figures, names or recommendations that are not in READS?", criteria: { true: "CONTENT includes specific facts, figures, names or recommendations that READS do not contain.", false: "Everything specific in CONTENT is in READS, or CONTENT has no factual claims." } },
    level: { type: "score", instructions: "How much of the factual information in CONTENT comes from READS?", criteria: ["None of it: READS is empty or unrelated.", "A little of it.", "About half.", "Most of it.", "All of it."] },
  });
  const a = r.answers as Record<string, { noul?: number; probabilities?: Record<string, number> }>;
  const p = a.level.probabilities ?? {};
  const upper = (p["2"] ?? 0) + (p["3"] ?? 0) + (p["4"] ?? 0);
  console.log(`${c.name.padEnd(42)} want ${c.want.padEnd(17)} gather=${a.gather.noul?.toFixed(2)} supported=${a.supported.noul?.toFixed(2)} unsupported=${a.unsupported.noul?.toFixed(2)} level_upper=${upper.toFixed(2)}`);
}
