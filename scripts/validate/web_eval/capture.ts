/**
 * Captura respuestas REALES de Free Search (format=json) para los casos de cases.ts. Se guardan en captures/ y la evaluación (run.ts) no necesita red.
 *   npx tsx scripts/validate/web_eval/capture.ts [--force] [--only=id,id]
 * Variantes: need@3 (pregunta tal cual, depth 3) · terms@3 (los términos como pregunta) · need@5.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager } from "../../../src/core/config.ts";
import { FreeSearchMCPServer } from "../../../src/core/mcp/freeSearchMcp.ts";
import { searchQuestion } from "../../../src/tools/web/args.ts";
import { CASES } from "./cases.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures");
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

const server = new FreeSearchMCPServer(ConfigManager.getConfig.bind(ConfigManager));
const variants = [
  { key: "need3", question: (c: (typeof CASES)[number]) => searchQuestion(c.need), depth: 3 },
  { key: "terms3", question: (c: (typeof CASES)[number]) => c.terms.join(" "), depth: 3 },
  { key: "need5", question: (c: (typeof CASES)[number]) => searchQuestion(c.need), depth: 5 },
];
const jobs = CASES.filter((c) => only === undefined || only.includes(c.id)).flatMap((c) => variants.map((v) => ({ c, v })));
let next = 0;
async function worker(): Promise<void> {
  while (next < jobs.length) {
    const { c, v } = jobs[next++];
    const file = path.join(dir, `${c.id}.${v.key}.json`);
    if (!force && fs.existsSync(file)) continue;
    const t0 = Date.now();
    try {
      const r = await server.callTool("research", { question: v.question(c), depth: v.depth, format: "json", max_age_hours: 24 });
      const text = r.content.filter((i) => i.type === "text").map((i) => i.text as string).join("\n");
      fs.writeFileSync(file, JSON.stringify({ ms: Date.now() - t0, isError: r.isError === true, question: v.question(c), depth: v.depth, text }, null, 1));
      console.log(`ok ${c.id}.${v.key} ${Date.now() - t0} ms ${text.length} chars${r.isError ? " ERROR" : ""}`);
    } catch (e) {
      console.log(`FALLO ${c.id}.${v.key}: ${(e as Error).message}`);
    }
  }
}
try {
  await Promise.all([worker(), worker(), worker()]);
} finally {
  await server.close();
  process.exit(0);
}
