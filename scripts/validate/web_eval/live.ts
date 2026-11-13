/**
 * Prueba de punta a punta del proveedor REAL (WebSearchProvider) con Free Search y el 2B reales, sobre los casos de cases.ts. Mide acierto, falsos positivos, páginas leídas y tiempo.
 *   npx tsx scripts/validate/web_eval/live.ts [--only=id,id] [--verbose]      (necesita red, `uvx` y Ollama)
 */
import { ConfigManager } from "../../../src/core/config.ts";
import { DiscoveryEngine } from "../../../src/core/mcp/discovery.ts";
import { FreeSearchMCPServer } from "../../../src/core/mcp/freeSearchMcp.ts";
import { Decision20Engine } from "../../../src/core/models/decision.ts";
import { createToolHost } from "../../../src/core/tools/host.ts";
import { readToolResult } from "../../../src/core/tools/result.ts";
import { NULL_SINK } from "../../../src/core/trace/sink.ts";
import { WEB_DEPENDENCIES, WebSearchProvider } from "../../../src/tools/web/webSearchProvider.ts";
import { CASES } from "./cases.ts";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const verbose = process.argv.includes("--verbose");
const getConfig = ConfigManager.getConfig.bind(ConfigManager);
const server = new FreeSearchMCPServer(getConfig);
const discovery = new DiscoveryEngine([server]);
const decision = new Decision20Engine(getConfig);
const provider = new WebSearchProvider({ judge: () => decision });

let hit = 0, n = 0, bad = 0, fp = 0, neg = 0, ms = 0, pages = 0, errors = 0, answered = 0;
try {
  for (const c of CASES.filter((x) => only === undefined || only.includes(x.id))) {
    const host = createToolHost(discovery, WEB_DEPENDENCIES, NULL_SINK, "live");
    const t0 = Date.now();
    const result = await provider.callTool("web_search", { need: c.need }, { taskId: "live", host, timeoutMs: 150_000 });
    const took = Date.now() - t0;
    const native = readToolResult(result);
    if (native === null || result.isError) { errors++; console.log(`${c.id.padEnd(12)} ERROR ${native?.text.slice(0, 120)}`); continue; }
    const state = String(native.data.state);
    const read = Number((native.meta.judge as { pagesRead?: number }).pagesRead ?? native.data.read ?? 0);
    ms += took; pages += read;
    const isAnswer = state === "found" || state === "partial";
    if (isAnswer) answered++;
    let mark: string;
    if (c.gold) { n++; const h = c.gold.test(native.text); const b = c.bad?.test(native.text) ?? false; if (h) hit++; if (b) bad++; mark = (h ? "OK" : "NO") + (b ? " +VIEJO" : ""); }
    else { neg++; if (isAnswer) fp++; mark = isAnswer ? "NO (responde algo)" : "OK (no inventa)"; }
    console.log(`${c.id.padEnd(12)} ${mark.padEnd(20)} ${state.padEnd(9)} ${String(took).padStart(6)} ms  páginas=${read}  ${native.text.length}c`);
    if (verbose) console.log("   " + native.text.replace(/\n/g, "\n   ").slice(0, 600));
  }
} finally {
  await server.close();
}
console.log(`\nACIERTOS ${hit}/${n}  viejo ${bad}  falsos+ ${fp}/${neg}  errores ${errors}  páginas/caso ${(pages / (n + neg - errors)).toFixed(2)}  ms/caso ${Math.round(ms / (n + neg - errors))}`);
process.exit(0);
