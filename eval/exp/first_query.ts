/**
 * eval/exp/first_query.ts
 *
 * Experimento (no es una etapa): qué sale de la primera consulta `pending` del reactivo con distintos formatos de salida.
 * Consulta directa al modelo generativo con el mismo request que arma el eval (`materializeScenario`) y cambiando solo `system` y `schema`.
 * Sobre dos pools: los casos de `pending` de primera vuelta (sin llamadas ni lista previa) y los casos de `route` (`expectedRoute`).
 * Uso: npx tsx eval/exp/first_query.ts [--methods=a,b] [--concurrency=3]
 */
import fs from "node:fs";
import { PROMPTS } from "../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../src/core/tools/manifest.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { createGenerativeClient } from "../core/client/generative.ts";
import { materializeScenario } from "../core/scenario.ts";
import { parseJsonObject } from "../core/contract.ts";
import { PendingGrader } from "../core/graders/pending.ts";
import { createCollector, norm } from "../core/graders/common.ts";
import pending2_exp from "../variants/Pending/pending2_exp.ts";

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const CONC = Number(arg("concurrency", "3"));
const ONLY = arg("methods", "").split(",").filter(Boolean);

// ───────── Pools ─────────
const readJsonl = (f: string): any[] =>
  fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => JSON.parse(l));

/** Rango de ítems razonable por caso (criterio mío, a mano): 0 = nada por hacer. */
const GOLD: Record<string, [number, number]> = {
  "001": [1, 1], "002": [1, 2], "003": [1, 1], "004": [1, 1], "005": [1, 1], "006": [2, 2], "007": [1, 1], "008": [2, 2], "009": [1, 2], "010": [1, 1],
  "011": [1, 1], "012": [1, 1], "013": [1, 2], "014": [1, 1], "015": [1, 1], "016": [1, 1], "017": [2, 2], "018": [1, 2], "019": [1, 1], "020": [2, 2],
  "021": [1, 1], "022": [1, 2], "023": [1, 1], "024": [0, 0], "025": [0, 0], "026": [0, 0],
  "hard-001": [3, 4], "hard-002": [1, 1], "hard-003": [1, 3], "hard-004": [1, 2], "hard-005": [1, 2], "hard-006": [2, 2], "hard-007": [1, 2], "hard-008": [1, 2],
  "hard-009": [1, 1], "hard-010": [1, 1], "hard-011": [1, 1], "hard-012": [1, 1], "hard-013": [0, 0], "hard-014": [0, 0], "hard-015": [0, 0], "hard-016": [2, 2],
  "hard-017": [1, 3], "hard-018": [1, 1], "hard-019": [1, 2], "hard-030": [1, 1], "hard-031": [1, 2], "hard-032": [1, 2], "hard-033": [1, 2], "hard-034": [2, 2],
  "hard-035": [1, 1], "hard-036": [1, 2], "hard-037": [1, 2],
};
const NEEDS_ASK = new Set(["hard-004", "hard-032", "hard-037"]); // pedidos vagos: sin carpeta, criterio ni alcance

interface PCase { id: string; request: string; expect: any; gold: [number, number] }
const pcases: PCase[] = [];
for (const f of ["llm_pending", "llm_pending_hard", "llm_gemai"]) {
  for (const c of readJsonl(`eval/datasets/pending/${f}.jsonl`)) {
    if ((c.scenario.calls ?? []).length || (c.scenario.at?.previous ?? []).length) continue;
    const key = c.id.replace(/^pending-/, "");
    if (!GOLD[key]) throw new Error(`sin gold para ${c.id}`);
    pcases.push({ id: key, request: c.scenario.request, expect: c.expect, gold: GOLD[key] });
  }
}
const rcases: { id: string; request: string; route: string }[] = [];
for (const f of ["route_16_cases", "route_gemai"]) {
  for (const c of readJsonl(`eval/datasets/route_D1/${f}.jsonl`)) rcases.push({ id: c.id, request: c.scenario.request, route: c.expect.expectedRoute });
}

// ───────── Métodos ─────────
const ROUTES = ["files", "locate", "terminal", "web"] as const;
const ROUTE_HINTS: Record<string, string> = {
  files: "Not for opening or launching applications.",
  terminal: "Opening an application such as Notepad or the calculator belongs here.",
  locate: "Also use it after a file was not found at the path that was tried.",
};
const catalog = ROUTES.map((r) => `  - ${r}: ${DESTINATIONS[r].description}${ROUTE_HINTS[r] ? " " + ROUTE_HINTS[r] : ""}`).join("\n");

const OBJ_SYSTEM = pending2_exp.prompts!.PROMPTS!.PENDING_VIEW!.SYSTEM as string;
const OBJ_SCHEMA = pending2_exp.params!.pending!.schema as any;
const KIND = { type: "string", enum: ["search", "read", "write", "execute", "other"] };
const schemaOf = (props: Record<string, unknown>) => ({
  type: "object",
  properties: { pending: { type: "array", items: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false } } },
  required: ["pending"],
  additionalProperties: false,
});
/** Inserta reglas antes de `Follow USER.` del prompt de pending2_exp y, si se pasa, cambia la forma del JSON de ejemplo. */
const withRules = (rules: string, shape?: string): string => {
  let s = OBJ_SYSTEM.replace("Follow USER.", `${rules}\nFollow USER.`);
  if (shape) s = s.replace(/\{"pending":\[\{[^\n]*\}\]\}/, shape);
  return s;
};
const SHAPE_ROUTE = '{"pending":[{"kind":"search|read|write|execute|other","route":"files|locate|terminal|web","goal":"...","done_when":"..."}]}';
const SPLIT_RULE =
  "- Split REQUEST into one item per independent result the user asked for, in the order they must happen (an item that needs the result of another goes after it). Do not split one action into sub-steps. At most 5 items.";
const ROUTE_RULE = `- route: where the item runs, one of:\n${catalog}\n  Choose the route that can do the item by itself. It is a suggestion for a later step.`;

const EMPTY_RULE =
  "- Greetings, thanks, small talk, jokes and questions about general knowledge or about what you can do need no computer: reply with an empty list.";
const prodWith = (rules: string): string => PROMPTS.PENDING_VIEW.SYSTEM.replace("Follow USER.", `${rules}\nFollow USER.`);

interface Method { name: string; system: string; schema: any; note: string }
const METHODS: Method[] = [
  { name: "prod", system: PROMPTS.PENDING_VIEW.SYSTEM, schema: undefined, note: "strings (producción)" },
  { name: "prod_split", system: prodWith(SPLIT_RULE), schema: undefined, note: "prod (strings) + regla de descomposición" },
  { name: "prod_empty", system: prodWith(EMPTY_RULE), schema: undefined, note: "prod (strings) + regla explícita de lista vacía" },
  { name: "prod_both", system: prodWith(`${SPLIT_RULE}\n${EMPTY_RULE}`), schema: undefined, note: "prod (strings) + las dos reglas" },
  { name: "obj3", system: OBJ_SYSTEM, schema: OBJ_SCHEMA, note: "kind, goal, done_when (pending2_exp)" },
  {
    name: "hints",
    system: withRules(
      "- hints: 0 to 4 concrete terms that a correct result would contain (entity names, units, file names, strings in the output). Never the answer you expect to find and never invented data. Empty list if unsure.",
      '{"pending":[{"kind":"search|read|write|execute|other","goal":"...","done_when":"...","hints":["..."]}]}',
    ),
    schema: schemaOf({ kind: KIND, goal: { type: "string" }, done_when: { type: "string" }, hints: { type: "array", items: { type: "string" }, maxItems: 4 } }),
    note: "obj3 + hints (0-4 términos)",
  },
  { name: "decomp", system: withRules(SPLIT_RULE), schema: OBJ_SCHEMA, note: "obj3 + regla explícita de descomposición" },
  {
    name: "route",
    system: withRules(ROUTE_RULE, SHAPE_ROUTE),
    schema: schemaOf({ kind: KIND, route: { type: "string", enum: [...ROUTES] }, goal: { type: "string" }, done_when: { type: "string" } }),
    note: "obj3 + route con el catálogo de rutas (D1)",
  },
  {
    name: "route_decomp",
    system: withRules(`${SPLIT_RULE}\n${ROUTE_RULE}`, SHAPE_ROUTE),
    schema: schemaOf({ kind: KIND, route: { type: "string", enum: [...ROUTES] }, goal: { type: "string" }, done_when: { type: "string" } }),
    note: "route + descomposición",
  },
  {
    name: "ask",
    system: withRules(
      "- ask: a short question for the user, in the language of REQUEST, only when REQUEST lacks data needed to start (which folder, which file, what criterion). Otherwise an empty string.",
      '{"pending":[{"kind":"search|read|write|execute|other","goal":"...","done_when":"...","ask":"..."}]}',
    ),
    schema: schemaOf({ kind: KIND, goal: { type: "string" }, done_when: { type: "string" }, ask: { type: "string" } }),
    note: "obj3 + ask (pregunta al usuario si falta un dato)",
  },
];

// ───────── Ejecución ─────────
const cfg = ConfigManager.getConfig() as any;
const client = createGenerativeClient({ url: cfg.qwenUrl ?? cfg.url ?? "http://127.0.0.1:11434", model: cfg.qwenModel ?? cfg.model ?? "qwen3.5:4b" });
const baseReq = (request: string) =>
  materializeScenario("pending", { mode: "reactive", request, at: { previous: [] } } as never, undefined).request as any;

interface Out { raw: string; items: any[] | null; ms: number; tokens: number; error?: string }
const cache = new Map<string, Out>();
async function query(m: Method, request: string): Promise<Out> {
  const key = `${m.name}\u0000${request}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = baseReq(request);
  const req = { ...r, system: m.system, ...(m.schema ? { schema: m.schema } : {}) };
  const res = await client.call(req, 120000);
  let out: Out;
  if (!res.ok) out = { raw: "", items: null, ms: res.durationMs, tokens: 0, error: res.error };
  else {
    const obj = parseJsonObject(res.rawOutput);
    const list = obj && Array.isArray((obj as any).pending) ? (obj as any).pending : null;
    out = { raw: res.rawOutput, items: list, ms: res.durationMs, tokens: res.tokens?.completion ?? 0, error: list ? undefined : "salida no válida" };
  }
  cache.set(key, out);
  return out;
}
async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); }));
}

const goalOf = (it: any): string => (typeof it === "string" ? it : typeof it?.goal === "string" ? it.goal : "");
const KEY_RE = /[\w.\\:/-]*\w\.[a-z0-9]{2,5}\b|\b\d+\b|'[^']+'/g;
/** Fracción de datos duros del pedido (nombres de archivo, números, textos entre comillas) que quedan en algún goal. */
function retention(request: string, goals: string[]): number | null {
  const keys = [...new Set((request.match(KEY_RE) ?? []).map((k) => norm(k.replace(/^'|'$/g, ""))))].filter((k) => k.length > 0);
  if (keys.length === 0) return null;
  const hay = norm(goals.join(" "));
  return keys.filter((k) => hay.includes(k)).length / keys.length;
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

const results: any = { when: new Date().toISOString(), methods: {} };
const methods = METHODS.filter((m) => ONLY.length === 0 || ONLY.includes(m.name));

for (const m of methods) {
  const t0 = Date.now();
  const rows: any[] = [];
  await pool(pcases, CONC, async (c) => { rows.push({ c, o: await query(m, c.request) }); });
  const routeRows: any[] = [];
  await pool(rcases, CONC, async (c) => { routeRows.push({ c, o: await query(m, c.request) }); });

  let valid = 0, graderPass = 0, inRange = 0, over = 0, under = 0, nonEmptyGold = 0, items = 0;
  const ret: number[] = [];
  let hintN = 0, hintGrounded = 0, itemsWithHints = 0;
  const hintEx: string[] = [];
  let askTP = 0, askFP = 0, askFN = 0, askTN = 0;
  const fails: string[] = [];
  for (const { c, o } of rows) {
    if (!o.items) { fails.push(`${c.id}: ${o.error}`); continue; }
    valid++;
    const list = o.items;
    const goals = list.map(goalOf).filter((g: string) => g.trim());
    items += goals.length;
    const rich = list.some((x: any) => typeof x !== "string")
      ? list.map((x: any) => (typeof x === "object" && x ? { kind: x.kind, goal: x.goal, done_when: x.done_when } : x))
      : undefined;
    const { collector, errors } = createCollector();
    PendingGrader.grade({ pending: goals, ...(rich ? { rich } : {}) } as any, c.expect, { rawOutput: o.raw, durationMs: o.ms }, collector);
    if (errors.length === 0) graderPass++; else fails.push(`${c.id}: ${errors[0].slice(0, 90)}`);
    const n = goals.length;
    if (c.gold[1] > 0) {
      nonEmptyGold++;
      if (n >= c.gold[0] && n <= c.gold[1]) inRange++; else if (n > c.gold[1]) over++; else under++;
      const r = retention(c.request, goals);
      if (r !== null) ret.push(r);
    }
    if (m.name === "hints") {
      for (const it of list) {
        const hs: string[] = Array.isArray(it?.hints) ? it.hints : [];
        if (hs.length) itemsWithHints++;
        for (const h of hs) {
          hintN++;
          if (norm(c.request).includes(norm(h))) hintGrounded++;
          else if (hintEx.length < 16) hintEx.push(`${c.id}: "${h}"`);
        }
      }
    }
    if (m.name === "ask") {
      const asked = list.some((it: any) => typeof it?.ask === "string" && it.ask.trim());
      const need = NEEDS_ASK.has(c.id);
      if (need && asked) askTP++; else if (need) askFN++; else if (asked) askFP++; else askTN++;
    }
  }
  const all = [...rows, ...routeRows];
  const summary: any = {
    note: m.note,
    pending_cases: rows.length, valid,
    grader_pass: graderPass,
    in_range: inRange, over_split: over, under_split: under, non_empty: nonEmptyGold,
    avg_items: +(items / Math.max(valid, 1)).toFixed(2),
    retention: +mean(ret).toFixed(3),
    avg_ms: Math.round(mean(all.map((x: any) => x.o.ms))),
    avg_tokens: Math.round(mean(all.map((x: any) => x.o.tokens))),
    failures: fails,
  };
  if (m.name === "route" || m.name === "route_decomp") {
    let ok = 0, n = 0;
    const bad: string[] = [];
    const byRoute: Record<string, [number, number]> = {};
    for (const { c, o } of routeRows) {
      n++;
      const got = o.items?.[0]?.route ?? null;
      (byRoute[c.route] ??= [0, 0])[1]++;
      if (got === c.route) { ok++; byRoute[c.route][0]++; } else bad.push(`${c.id} esperado ${c.route} dio ${got}`);
    }
    summary.route_acc = `${ok}/${n}`; summary.route_by = byRoute; summary.route_miss = bad;
  }
  if (m.name === "hints") summary.hints = { total: hintN, grounded: hintGrounded, items_with_hints: itemsWithHints, ungrounded_examples: hintEx };
  if (m.name === "ask") summary.ask = { TP: askTP, FN: askFN, FP: askFP, TN: askTN };
  summary.raw = {
    pending: rows.map((r) => ({ id: r.c.id, request: r.c.request, out: r.o.raw })),
    route: routeRows.map((r) => ({ id: r.c.id, out: r.o.raw })),
  };
  results.methods[m.name] = summary;
  console.log(`\n== ${m.name} (${Math.round((Date.now() - t0) / 1000)}s) ${m.note}`);
  const { raw: _raw, failures, route_miss, ...show } = summary;
  console.log(JSON.stringify(show));
  console.log("  fallas:", failures.slice(0, 12).join(" | "));
  if (route_miss) console.log("  rutas mal:", route_miss.join(" | "));
}
fs.mkdirSync("eval/results/_exp", { recursive: true });
const out = `eval/results/_exp/first_query_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log("\nguardado:", out);
