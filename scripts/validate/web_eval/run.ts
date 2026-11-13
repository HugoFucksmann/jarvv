/**
 * Evaluación de web_search sobre capturas reales de Free Search (captures/, ver capture.ts). Sin red; con --judge usa el 2B real (Ollama).
 *   npx tsx scripts/validate/web_eval/run.ts [--judge] [--only=id,id] [--verbose]
 * Mide, por caso y variante, si la respuesta esperada llega al texto que vería el modelo (presupuesto de 1700 caracteres, como en producción).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager } from "../../../src/core/config.ts";
import { Decision20Engine } from "../../../src/core/models/decision.ts";
import { CANDIDATES, pickCandidates, rank, type Ranked } from "../../../src/tools/web/bm25.ts";
import { chunkDocs, snippetChunks, type Chunk } from "../../../src/tools/web/chunks.ts";
import type { Material } from "../../../src/tools/web/report.ts";
import { parseResearch } from "./research.ts";
import { CASES, type Case } from "./cases.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures");
const useJudge = process.argv.includes("--judge");
const verbose = process.argv.includes("--verbose");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const BUDGET = 1700;
const COVERAGE_PARTIAL = 0.34;

// ───────── JSON de Free Search → Material (lo que haría el parser JSON definitivo) ─────────
interface Capture { ms: number; isError: boolean; text: string }
const load = (id: string, key: string): Capture | null => {
  const f = path.join(dir, `${id}.${key}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Capture) : null;
};
/** Usa el parser de producción (report.ts): la evaluación también valida que lee las capturas reales. */
function material(cap: Capture): { m: Material; blocked: number; raw: any } | null {
  const parsed = parseResearch(cap.text);
  if (!parsed.ok) { console.log(`  (captura no reconocida: ${parsed.detail})`); return null; }
  return { m: parsed.value, blocked: parsed.value.blocked, raw: JSON.parse(cap.text) };
}

// ───────── Estrategias ─────────
interface Out { text: string; state: string; ids: number[]; ms: number; note?: string }
const clip = (t: string, n: number): string => (t.length <= n ? t : t.slice(0, n));
const fmt = (ps: { n: number; text: string; snippet?: boolean }[]): string => {
  const lines: string[] = []; let used = 0;
  for (const p of ps) {
    const line = `[${p.n}] ${p.snippet ? "(search result snippet) " : ""}${p.text}`;
    if (lines.length > 0 && used + line.length > BUDGET) continue;
    lines.push(clip(line, BUDGET)); used += line.length;
    if (lines.length >= 4) break;
  }
  return lines.join("\n");
};

/** Lo que el modelo vería si se le diera la salida del MCP sin procesar, cortada al mismo presupuesto. */
function rawSnippets(m: Material): Out {
  const t = m.sources.map((s) => `[${s.n}] ${s.title}${s.date ? ` (published ${s.date})` : ""} — ${s.snippet ?? ""}`).join("\n");
  return { text: clip(t, BUDGET), state: "n/a", ids: [], ms: 0 };
}
function rawHead(m: Material): Out { return { text: clip(m.docs.map((d) => d.body).join("\n"), BUDGET), state: "n/a", ids: [], ms: 0 }; }
function rawFull(m: Material): Out {
  return { text: m.sources.map((s) => `${s.title} ${s.snippet ?? ""} ${s.date ?? ""}`).join("\n") + "\n" + m.docs.map((d) => d.body).join("\n"), state: "n/a", ids: [], ms: 0 };
}

const allChunks = (m: Material): Chunk[] => { const pages = chunkDocs(m.docs); return [...pages, ...snippetChunks(m.sources, pages.length)]; };
const toP = (c: Ranked): { n: number; text: string; snippet?: boolean; id: number } => ({ n: c.chunk.n, text: c.chunk.text, id: c.chunk.id, ...(c.chunk.kind === "snippet" ? { snippet: true } : {}) });

interface Opts { terms: boolean; sel: "global" }
function lexical(m: Material, c: Case, o: Opts): Out {
  const t0 = Date.now();
  const chunks = allChunks(m);
  const { ranked } = rank(chunks, o.terms ? `${c.need} ${c.terms.join(" ")}` : c.need);
  const cands = pickCandidates(ranked, CANDIDATES);
  const withCov = cands.filter((r) => r.coverage >= COVERAGE_PARTIAL);
  const ps = withCov.slice(0, 4).map(toP);
  return { text: fmt(ps), state: ps.length ? "partial" : "not_found", ids: ps.map((p) => p.id), ms: Date.now() - t0 };
}

const decision = useJudge ? new Decision20Engine(ConfigManager.getConfig.bind(ConfigManager)) : null;
async function judged(m: Material, c: Case, o: Opts & { pool: "bm25" | "all" }): Promise<Out> {
  const t0 = Date.now();
  const chunks = allChunks(m);
  let cands: Ranked[];
  if (o.pool === "bm25") cands = pickCandidates(rank(chunks, o.terms ? `${c.need} ${c.terms.join(" ")}` : c.need).ranked, CANDIDATES);
  else cands = chunks.slice(0, 40).map((chunk, i) => ({ chunk, score: 0, coverage: 1, terms: new Set<string>([String(i)]) })); // sin ordenar: el modelo decide solo
  if (cands.length === 0) return { text: "", state: "not_found", ids: [], ms: 0 };
  const { probabilities: p } = await decision!.score(c.need, cands.map((x) => x.chunk.text));
  const scored = cands.map((x, i) => ({ x, p: p[i] })).sort((a, b) => b.p - a.p || b.x.score - a.x.score);
  const best = scored[0].p;
  const ok = scored.filter((s) => s.p >= 0.3);
  const chosen = ok.slice(0, 4).map((s) => toP(s.x));
  return { text: fmt(chosen), state: best >= 0.6 ? "found" : best >= 0.3 ? "partial" : "not_found", ids: chosen.map((q) => q.id), ms: Date.now() - t0, note: `best p=${best.toFixed(2)} (${cands.length} frag.)` };
}

// ───────── Ejecución ─────────
type Variant = { name: string; cap: string; run: (m: Material, c: Case) => Out | Promise<Out> };
const V: Variant[] = [
  { name: "RAW  extractos MCP (1700c)", cap: "need3", run: (m) => rawSnippets(m) },
  { name: "RAW  inicio de páginas (1700c)", cap: "need3", run: (m) => rawHead(m) },
  { name: "TECHO todo lo que trae el MCP", cap: "need3", run: (m) => rawFull(m) },
  { name: "BM25 need  global     d3", cap: "need3", run: (m, c) => lexical(m, c, { terms: false, sel: "global" }) },
  { name: "BM25 +terms global    d3", cap: "need3", run: (m, c) => lexical(m, c, { terms: true, sel: "global" }) },
  { name: "BM25 need  global     d5", cap: "need5", run: (m, c) => lexical(m, c, { terms: false, sel: "global" }) },
  { name: "BM25 need  global     MCP<-terms", cap: "terms3", run: (m, c) => lexical(m, c, { terms: false, sel: "global" }) },
  { name: "BM25 +terms global    MCP<-terms", cap: "terms3", run: (m, c) => lexical(m, c, { terms: true, sel: "global" }) },
];
if (useJudge) {
  V.push(
    { name: "2B   BM25>juez need  global d3", cap: "need3", run: (m, c) => judged(m, c, { terms: false, sel: "global", pool: "bm25" }) },
    { name: "2B   BM25>juez +terms global d3", cap: "need3", run: (m, c) => judged(m, c, { terms: true, sel: "global", pool: "bm25" }) },
    { name: "2B   SOLO juez (sin BM25) d3", cap: "need3", run: (m, c) => judged(m, c, { terms: false, sel: "global", pool: "all" }) },
  );
}

const cases = CASES.filter((c) => only === undefined || only.includes(c.id));
const score: Record<string, { hit: number; bad: number; n: number; fp: number; neg: number; chars: number; ms: number }> = {};
for (const c of cases) {
  const mats = new Map<string, ReturnType<typeof material>>();
  for (const k of ["need3", "terms3", "need5"]) { const cap = load(c.id, k); mats.set(k, cap ? material(cap) : null); }
  const m3 = mats.get("need3");
  const info = m3 ? `need3: ${m3.m.sources.length} fuentes, ${m3.m.docs.length} páginas, ${m3.blocked} bloqueadas, engines=${(m3.raw.engines ?? []).join(",")}` : "";
  console.log(`\n=== ${c.id}: ${c.need}  ${c.gold ? "" : "(sin respuesta correcta)"}  ${info}`);
  for (const v of V) {
    const mm = mats.get(v.cap);
    if (!mm) { console.log(`  ${v.name.padEnd(36)} (sin captura)`); continue; }
    const out = await v.run(mm.m, c);
    const hit = c.gold ? c.gold.test(out.text) : false;
    const bad = c.bad ? c.bad.test(out.text) : false;
    const answered = out.state === "found" || out.state === "partial";
    const s = (score[v.name] ??= { hit: 0, bad: 0, n: 0, fp: 0, neg: 0, chars: 0, ms: 0 });
    if (c.gold) { s.n++; if (hit) s.hit++; if (bad) s.bad++; } else { s.neg++; if (answered) s.fp++; }
    s.chars += out.text.length; s.ms += out.ms;
    const mark = c.gold ? (hit ? "OK" : "NO") + (bad ? " +VIEJO" : "") : out.state === "n/a" ? "·" : answered ? "NO (responde algo)" : "OK (no inventa)";
    console.log(`  ${v.name.padEnd(36)} ${mark.padEnd(18)} ${out.state.padEnd(9)} ${String(out.text.length).padStart(4)}c ${out.note ?? ""}`);
    if (verbose) console.log("      " + out.text.replace(/\n/g, "\n      ").slice(0, 900));
  }
}
console.log("\n=== RESUMEN (aciertos sobre casos con respuesta; falsos positivos sobre casos sin respuesta) ===");
for (const [name, s] of Object.entries(score)) {
  console.log(`${name.padEnd(36)} aciertos ${s.hit}/${s.n}  viejo ${s.bad}  falsos+ ${s.fp}/${s.neg}  chars/caso ${Math.round(s.chars / (s.n + s.neg))}  ms/caso ${Math.round(s.ms / (s.n + s.neg))}`);
}
process.exit(0);
