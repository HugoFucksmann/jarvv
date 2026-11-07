/**
 * eval/gen/repeticiones.ts — ¿El LLM de argumentos cambia la llamada cuando la anterior fue descartada o bloqueada?
 *
 * Uso: npx tsx eval/gen/repeticiones.ts → escribe eval/datasets/repeticiones.jsonl
 *
 * Caso real (traza `task_1794078908929_fa38`, "último modelo de gpt y de gemini"): un `research` de Gemini devolvió páginas de
 * pronósticos de baloncesto; D4 lo descartó y el modelo repitió la misma pregunta tres veces (`loop_blocked`) y dos veces la
 * misma URL inventada (`args_invalid`). Cada caso arma lo que el modelo veía en ese momento; el grader falla si repite la
 * pregunta o la URL prohibida. Se mide con la etapa `arguments`.
 */

import { writeFileSync } from "node:fs";

const QUESTION = "¿Cuál es el último modelo de Gemini disponible actualmente?";

/** El resumen que vio el modelo del `research` descartado (principio de la traza real, con fuentes irrelevantes). */
const JUNK_SUMMARY = `Research: ${QUESTION} · 3 fuentes · ~6943 tokens
Fuentes:
[1] All Gemini Models - Pro, Ultra, Flash (2026) | LM Market Cap: https://lmmarketcap.com/google-gemini-models [2026-11-07] - Every Google Gemini model ranked: Pro, Ultra, and Flash compared by scores, pricing, and capabilities. Find the best Gemini for your use case.
[2] Linz W vs UBSC-DBBC Graz W — Predicción de baloncesto con IA: https://betbrothers.ai/es/basketball/match/linz-w-vs-ubsc-dbbc-graz-w [2026-11-07] - Linz W vs UBSC-DBBC Graz W: pronósticos de ChatGPT, Claude, Gemini , Grok y otros modelos de IA frente al mercado — ganador, hándicap y total.
[3] BC Nokia II W vs Lappeenranta W: pronóstico IA - betbrothers.ai: https://betbrothers.ai/es/basketball/match/bc-nokia-ii-w-vs-lappeenranta-w [2026-10-29] - BC Nokia II W vs Lappeenranta W: pronósticos de ChatGPT, Claude, Gemini , Grok y otros modelos de IA frente al mercado — ganador, hándicap y total.
Extractos de las páginas:
[1] The complete Google Gemini model lineup: 45 models spanning from the lightweight Gemini Flash series to the flagship Gemini Pro. Google's Gemini family is known for industry-leading context windows (up to 1.0M tokens), strong multimodal…
[2] Guía de forma: Linz W y UBSC-DBBC Graz W llegan a este partido con una forma reciente complicada. Linz W ha perdido sus últimos cinco partidos…
[… omitidos: 26506 caracteres de las páginas]`;

const RESEARCH_SCHEMA = { type: "object", properties: { question: { type: "string" } }, required: ["question"] };
const FETCH_SCHEMA = { type: "object", properties: { url: { type: "string" }, force_refresh: { type: "boolean" } }, required: ["url"] };
const REQUEST = "busca el ultimo modelo de gpt y de gemini. guarda la info en un md en la carpeta jarvis del escritorio";
const INSTRUCTION = "Obtener la información del último modelo de Gemini";

const gptCall = {
  route: "web", tool: "research", kind: "read", status: "ok", step: 0, verdict: "approved",
  args: { question: "¿Cuál es el último modelo de GPT disponible actualmente?" },
  summary: "Research: ¿Cuál es el último modelo de GPT disponible actualmente? · 3 fuentes · ~9483 tokens\nFuentes:\n[1] All OpenAI Models - GPT-5, GPT-4o, o3 & More (2026): https://lmmarketcap.com/openai-models [2026-11-07]\n[2] Compara los modelos de ChatGPT: GPT-6 Astra, Sol, Luna: https://chagpt.org/es/models [2026-07-09]",
};
const junkCall = { route: "web", tool: "research", kind: "read", status: "ok", step: 1, verdict: "rejected", reason: "no_usable_data", args: { question: QUESTION }, summary: JUNK_SUMMARY };
const blockedResearch = { route: "web", tool: "research", kind: "read", status: "loop_blocked", step: 1, args: { question: QUESTION } };
const badUrl = (n: number) => ({
  route: "web", tool: "fetch", kind: "read", status: "args_invalid", step: 1, args: { url: "https://gemini.google.com", force_refresh: false },
  summary: `The URL 'https://gemini.google.com' does not appear in the request or in earlier results. Use a URL from the results, or search first.${n === 0 ? "" : ""}`,
});

const steps = [{ state: "completed", instruction: "Buscar el último modelo de GPT" }, { state: "running", instruction: INSTRUCTION }];
const forbidQuestion = { requiredFields: ["question"], forbiddenHardcodedValues: [QUESTION] };

const cases = [
  { id: "rep-research-descartado", description: "El research de Gemini devolvió páginas irrelevantes y D4 lo descartó: la pregunta debe cambiar.", tool: "research", schema: RESEARCH_SCHEMA, calls: [gptCall, junkCall], expect: forbidQuestion },
  { id: "rep-research-bloqueado", description: "Además, repetir la pregunta quedó bloqueado una vez.", tool: "research", schema: RESEARCH_SCHEMA, calls: [gptCall, junkCall, blockedResearch], expect: forbidQuestion },
  { id: "rep-research-doble-bloqueo", description: "Repetir la pregunta quedó bloqueado dos veces.", tool: "research", schema: RESEARCH_SCHEMA, calls: [gptCall, junkCall, blockedResearch, blockedResearch], expect: forbidQuestion },
  { id: "rep-url-inventada-doble", description: "La misma URL inventada se rechazó dos veces: debe usar otra o una de las fuentes.", tool: "fetch", schema: FETCH_SCHEMA, calls: [gptCall, junkCall, badUrl(0), badUrl(1)], expect: { requiredFields: ["url"], forbiddenHardcodedValues: ["gemini.google.com"] } },
];

const lines = ["# Repeticiones tras una llamada descartada o bloqueada (generado por eval/gen/repeticiones.ts; no editar a mano)."];
for (const c of cases) {
  lines.push(
    JSON.stringify({
      id: c.id,
      stage: "arguments",
      tags: ["escenario", "arguments", "repeticion", c.tool],
      description: c.description,
      scenario: { mode: "reactive", request: REQUEST, steps, calls: c.calls, at: { route: "web", tool: c.tool, inputSchema: c.schema } },
      expect: c.expect,
    }),
  );
}
writeFileSync("eval/datasets/repeticiones.jsonl", `${lines.join("\n")}\n`);
console.log(`${cases.length} casos → eval/datasets/repeticiones.jsonl`);
