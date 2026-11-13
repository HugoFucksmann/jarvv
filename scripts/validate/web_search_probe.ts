/**
 * Sondas de `web_search`. No son pruebas (no afirman nada): muestran qué hace la tool con casos límite, para mirarlos a ojo.
 *
 *   npx tsx scripts/validate/web_search_probe.ts                  # sin red: tokenización, formato de Free Search, limpieza y URL internas
 *   npx tsx scripts/validate/web_search_probe.ts --live           # además, tres consultas reales con Free Search (necesita `uvx` y red)
 *   npx tsx scripts/validate/web_search_probe.ts --live --judge   # y las repite con el 2B real (necesita Ollama con el modelo de decisión)
 *
 * Qué mira cada caso está en `docs/REVISION_web_search.md` (hallazgos WS-xx).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigManager } from "../../src/core/config.ts";
import { DiscoveryEngine } from "../../src/core/mcp/discovery.ts";
import { FreeSearchMCPServer } from "../../src/core/mcp/freeSearchMcp.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import { createToolHost } from "../../src/core/tools/host.ts";
import { readToolResult } from "../../src/core/tools/result.ts";
import { NULL_SINK } from "../../src/core/trace/sink.ts";
import { isInternalHost } from "../../src/tools/web/args.ts";
import { tokenize } from "../../src/tools/web/bm25.ts";
import { chunkDocs, cleanLines } from "../../src/tools/web/chunks.ts";
import { parseFetch, parseSearch } from "../../src/tools/web/report.ts";
import { WEB_DEPENDENCIES, WebSearchProvider } from "../../src/tools/web/webSearchProvider.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes("--live");
const judge = process.argv.includes("--judge");

// ───────────────────────── Sin red ─────────────────────────

console.log("### Tokenización de otros alfabetos (WS-04): sin palabras no hay candidatos");
for (const question of ["Какая столица Австралии?", "澳大利亚的首都是哪里", "ما هي عاصمة أستراليا", "¿Cuál es la capital de Australia?", "Wann wurde Müller geboren? Straße"]) {
  console.log(`  ${JSON.stringify(question)} → ${JSON.stringify(tokenize(question))}`);
}

console.log("\n### Captura real de `search` de Free Search 0.18.0 en JSON (web_eval/captures2/)");
const capture = JSON.parse(fs.readFileSync(path.join(here, "web_eval", "captures2", "node22.json"), "utf8")) as { search: { text: string }; fetches: { url: string; text: string }[] };
const parsed = parseSearch(capture.search.text);
if (!parsed.ok) throw new Error(`la captura no se reconoce: ${parsed.detail}`);
console.log(`  fuentes: ${parsed.value.sources.length}`);
for (const source of parsed.value.sources) console.log(`  [${source.n}] ${source.title.slice(0, 60)} | fecha=${source.date ?? "-"} (${source.dateSource ?? "-"}) | extracto=${source.snippet === undefined ? "no" : "sí"}`);
const page = capture.fetches.map((f, i) => parseFetch(f.text, f.url, i + 1)).find((p) => p.ok && p.value !== null && !("blocked" in p.value));
if (page?.ok && page.value !== null && "doc" in page.value) console.log(`  página leída: ${page.value.doc.url.slice(0, 60)} → ${chunkDocs([page.value.doc]).length} fragmentos`);

console.log("\n### Si Free Search cambiara el formato (WS-05): se rechaza con la ruta, no se degrada en silencio");
for (const text of ["# Research brief: x\n## Sources\n- [1] **T** — <https://a.org>", JSON.stringify({ results: [{ title: "x" }] })]) {
  const drift = parseSearch(text);
  console.log(`  ${drift.ok ? "ACEPTADO (mal)" : `rechazado: ${drift.detail}`}`);
}

console.log("\n### Líneas que la limpieza descarta (WS-06)");
for (const line of [
  "Log in to the console with your account before continuing with the setup.",
  "Sign in with the CLI first: az login",
  "Search for the package in the registry and install it with npm install.",
  "Menu",
  "Share on Twitter",
]) {
  console.log(`  ${JSON.stringify(line)} → ${cleanLines(line).length === 0 ? "DESCARTADA" : "se conserva"}`);
}

console.log("\n### Hosts internos (WS-12)");
for (const host of ["localhost", "127.0.0.1", "2130706433", "0x7f.0.0.1", "10.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "metadata.google.internal", "intranet", "ejemplo.com"]) {
  let normalized = host;
  try {
    normalized = new URL(`http://${host}/`).hostname;
  } catch {
    // se deja tal cual
  }
  console.log(`  ${host.padEnd(26)} → ${normalized.padEnd(24)} interno: ${isInternalHost(normalized)}`);
}

// ───────────────────────── Con red ─────────────────────────

if (!live) {
  console.log("\n(sin --live: no se hicieron consultas reales)");
  process.exit(0);
}

const getConfig = ConfigManager.getConfig.bind(ConfigManager);
const freeSearch = new FreeSearchMCPServer(getConfig);
const discovery = new DiscoveryEngine([freeSearch]);
const decision = new Decision20Engine(getConfig);

async function ask(label: string, provider: WebSearchProvider, args: Record<string, unknown>): Promise<void> {
  const host = createToolHost(discovery, WEB_DEPENDENCIES, NULL_SINK, "probe");
  const started = Date.now();
  const result = await provider.callTool("web_search", args, { taskId: "probe", host, timeoutMs: 150_000 });
  const native = readToolResult(result);
  if (native === null) throw new Error(`'${label}': el resultado no es nativo`);
  const passages = native.data.passages as { n: number; probability?: number; score: number }[];
  console.log(`\n--- ${label} | ${Date.now() - started} ms | state=${String(native.data.state)} judge=${String(native.data.judge)} candidatos=${String(native.data.candidates)} texto=${native.text.length} caracteres`);
  console.log(`    fragmentos: ${passages.map((p) => `[${p.n}] p=${p.probability ?? "-"} bm25=${p.score}`).join("  ")}`);
  const judgeMeta = native.meta.judge as { error?: string; durationMs?: number; probabilities?: number[] };
  if (judgeMeta.error !== undefined) console.log(`    ERROR DEL JUEZ: ${judgeMeta.error}`);
  if (judgeMeta.probabilities !== undefined) console.log(`    probabilidades: ${judgeMeta.probabilities.join(" ")} | juez ${judgeMeta.durationMs} ms`);
  console.log(`    ${native.text.split("\n").slice(0, 4).join("\n    ").slice(0, 700)}`);
}

const questions: [string, Record<string, unknown>][] = [
  ["fecha de Node 22", { need: "¿En qué fecha se publicó Node.js 22.0.0?" }],
  ["respuesta que no está en las fuentes", { need: "¿Cuál es el nombre del perro del creador de Node.js, Ryan Dahl?" }],
  ["URL concreta", { need: "¿Cuál es la capital de Australia?", urls: ["https://es.wikipedia.org/wiki/Australia"] }],
];

try {
  const without = new WebSearchProvider();
  const withJudge = new WebSearchProvider({ judge: () => decision });
  for (const [label, args] of questions) {
    await ask(`${label} · SIN modelo`, without, args);
    if (judge) await ask(`${label} · CON el 2B`, withJudge, args);
  }
} finally {
  await freeSearch.close();
  process.exit(0);
}
