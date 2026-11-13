/**
 * Captura para la ronda 3 (¿search + fetch de a una página en vez de research?): por caso, `search` (JSON) y `fetch` (JSON) de las primeras 3 URLs, con el tiempo de cada llamada.
 *   npx tsx scripts/validate/web_eval/capture2.ts [--force] [--only=id,id] [--probe]
 * `--probe`: una sola consulta, imprime la forma de search/fetch/compare (para ver qué devuelve cada herramienta).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager } from "../../../src/core/config.ts";
import { FreeSearchMCPServer } from "../../../src/core/mcp/freeSearchMcp.ts";
import { searchQuestion } from "../../../src/tools/web/args.ts";
import { CASES } from "./cases.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures2");
fs.mkdirSync(dir, { recursive: true });
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const server = new FreeSearchMCPServer(ConfigManager.getConfig.bind(ConfigManager));
const text = (r: { content: { type: string; text?: string }[] }): string => r.content.filter((i) => i.type === "text").map((i) => i.text as string).join("\n");

async function timed(tool: string, args: Record<string, unknown>): Promise<{ ms: number; isError: boolean; text: string }> {
  const t0 = Date.now();
  try {
    const r = await server.callTool(tool, args);
    return { ms: Date.now() - t0, isError: r.isError === true, text: text(r) };
  } catch (e) {
    return { ms: Date.now() - t0, isError: true, text: `EXCEPTION ${(e as Error).message}` };
  }
}

if (process.argv.includes("--probe")) {
  const s = await timed("search", { query: "latest gemini model", max_results: 8, format: "json", max_age_hours: 24 });
  console.log("search", s.ms, "ms\n", s.text.slice(0, 2500));
  const urls = (JSON.parse(s.text).results as { url: string }[]).slice(0, 3).map((r) => r.url);
  const f = await timed("fetch", { url: urls[0], format: "json", max_age_hours: 24 });
  console.log("\nfetch", f.ms, "ms", f.text.length, "chars\n", f.text.slice(0, 600));
  const c = await timed("compare", { question: "latest gemini model", urls: urls.slice(0, 3), format: "json" });
  console.log("\ncompare", c.ms, "ms", c.text.length, "chars\n", c.text.slice(0, 1800));
  await server.close();
  process.exit(0);
}

const jobs = CASES.filter((c) => only === undefined || only.includes(c.id));
let next = 0;
async function worker(): Promise<void> {
  while (next < jobs.length) {
    const c = jobs[next++];
    const file = path.join(dir, `${c.id}.json`);
    if (!force && fs.existsSync(file)) continue;
    const search = await timed("search", { query: searchQuestion(c.need), max_results: 8, format: "json", max_age_hours: 24 });
    let urls: string[] = [];
    try { urls = (JSON.parse(search.text).results as { url: string }[]).slice(0, 3).map((r) => r.url); } catch { /* sin resultados */ }
    const fetches = await Promise.all(urls.map(async (url) => ({ url, ...(await timed("fetch", { url, format: "json", max_age_hours: 24 })) })));
    fs.writeFileSync(file, JSON.stringify({ search, fetches }, null, 1));
    console.log(`ok ${c.id} search ${search.ms} ms, fetch ${fetches.map((f) => f.ms).join("/")} ms`);
  }
}
try {
  await Promise.all([worker(), worker()]);
} finally {
  await server.close();
  process.exit(0);
}
