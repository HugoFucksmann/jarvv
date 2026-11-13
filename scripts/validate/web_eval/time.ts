/** Latencia en frío, una llamada por vez (sin caché: max_age_hours 0): search, research depth 3, fetch de una página y compare de 3 páginas. */
import { ConfigManager } from "../../../src/core/config.ts";
import { FreeSearchMCPServer } from "../../../src/core/mcp/freeSearchMcp.ts";
const server = new FreeSearchMCPServer(ConfigManager.getConfig.bind(ConfigManager));
const t = async (tool: string, args: Record<string, unknown>): Promise<{ ms: number; text: string }> => {
  const t0 = Date.now();
  const r = await server.callTool(tool, args);
  return { ms: Date.now() - t0, text: r.content.map((i) => i.text ?? "").join("\n") };
};
const qs = ["when was python 3.12 released", "¿cuál es el último modelo de Claude?", "what is the default page size of SQLite?", "latest react version", "¿cuál es la capital de Australia?", "how many requests per hour GitHub REST API authenticated"];
const rows: Record<string, number[]> = { search: [], fetch1: [], research3: [], compare3: [] };
for (const q of qs) {
  const s = await t("search", { query: q, max_results: 8, format: "json", max_age_hours: 0 });
  const urls = (JSON.parse(s.text).results as { url: string }[]).filter((r) => !r.url.includes("pypi.org")).slice(0, 3).map((r) => r.url);
  const f = await t("fetch", { url: urls[0], format: "json", max_age_hours: 0 });
  const r = await t("research", { question: q, depth: 3, format: "json", max_age_hours: 0 });
  const c = await t("compare", { question: q, urls, format: "json" });
  rows.search.push(s.ms); rows.fetch1.push(f.ms); rows.research3.push(r.ms); rows.compare3.push(c.ms);
  console.log(q.padEnd(60), `search ${s.ms}  fetch1 ${f.ms}  research3 ${r.ms}  compare3 ${c.ms}  (compare ${c.text.length} chars)`);
}
const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("mediana ms:", Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, med(v)])));
await server.close();
process.exit(0);
