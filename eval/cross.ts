/**
 * eval/cross.ts — Cruza el pre-chequeo determinista con los resultados de D3 (`args_review`) de una corrida del eval.
 *
 * Uso:
 *   npm run eval:cross -- --dataset=scenarios_args_review,mut_args_review [--runs=<carpeta de la corrida>] [--label=x]
 *
 * Sin `--runs`: solo mide el pre-chequeo (falsos rechazos sobre las aprobadas y recall por modo de falla). Con `--runs`: además
 * compone, por variante y por caso, cuatro tuberías con las etiquetas guardadas de D3:
 *   - `d3`        solo D3 (como hoy).
 *   - `pre+d3`    pre-chequeo; si no rechaza, D3.
 *   - `pre+d3w`   pre-chequeo; D3 solo para escrituras (una lectura no rechazada se aprueba).
 *   - `pre`       solo el pre-chequeo (D3 nunca rechaza).
 * y compara cada una contra `d3` de `prod` con un test pareado exacto (discordantes). Las etiquetas de D3 se toman de la
 * primera repetición: D3 corre a temperatura 0 y repetir no agrega información.
 *
 * El pre-chequeo es el código de producción (`src/core/engine/precheck.ts`); no usa modelos.
 *
 * Con `--runs` también resume D4 (`result_verification`) de esa corrida: por variante, falsos aprobados (malos que pasan), falsos
 * rechazados (buenos que no pasan) y el peor caso malo (la mayor probabilidad de aprobar entre los malos: menos es mejor).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandReport } from "../src/core/engine/precheck.ts";
import { analyzePowerShell } from "../src/core/engine/precheck.ts";
import { getToolPolicy, serverOf } from "../src/core/tools/manifest.ts";
import type { Scenario } from "./core/scenario.ts";
import { scenarioPrecheck } from "./core/scenario.ts";
import { frozenPrecheck } from "./core/frozenPrecheck.ts";

// ───────────────────────── Entrada ─────────────────────────

interface RawCase {
  id: string;
  stage: string;
  tags?: string[];
  scenario?: Scenario;
  /** Caso fijo: el request ya armado (solo se usa `state`). */
  request?: { state?: string };
  expect?: { expectedReview?: string };
}

interface CaseRow {
  dataset: string;
  id: string;
  tags: string[];
  expected: string;
  kind: "read" | "write";
  pre: "args_invalid" | "info_missing" | null;
  reason: string | null;
}

function flag(name: string): string | undefined {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? undefined : a.slice(name.length + 3);
}

function loadCases(dataset: string): RawCase[] {
  const path = `eval/datasets/${dataset}.jsonl`;
  if (!existsSync(path)) throw new Error(`No existe el dataset ${path}`);
  const out: RawCase[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const c = JSON.parse(t) as RawCase;
    if (c.stage === "args_review" && (c.scenario !== undefined || typeof c.request?.state === "string") && c.expect?.expectedReview !== undefined) out.push(c);
  }
  return out;
}

// ───────────────────────── Estadística ─────────────────────────

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${((100 * n) / d).toFixed(0)} % (${n}/${d})`);

/** p exacto, dos colas, del test de signos sobre los discordantes (b = mejora, c = empeora). */
function signTestP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let cum = 0;
  let term = 0.5 ** n;
  for (let i = 0; i <= k; i++) {
    cum += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * cum);
}

// ───────────────────────── Pre-chequeo sobre los datasets ─────────────────────────

async function precheckRows(datasets: string[]): Promise<CaseRow[]> {
  const cache = new Map<string, Promise<CommandReport | null>>();
  const analyze = (command: string): Promise<CommandReport | null> => {
    let p = cache.get(command);
    if (p === undefined) {
      p = analyzePowerShell(command);
      cache.set(command, p);
    }
    return p;
  };
  const rows: CaseRow[] = [];
  for (const dataset of datasets) {
    for (const c of loadCases(dataset)) {
      const sc = c.scenario;
      const frozen = sc === undefined ? await frozenPrecheck(c.request?.state ?? "", analyze) : null;
      const tool = sc?.at?.tool ?? frozen?.tool ?? "";
      const route = sc?.at?.route ?? frozen?.route;
      const kind = route !== undefined && getToolPolicy(serverOf(route), tool).mutates ? "write" : "read";
      let finding = frozen?.finding ?? null;
      try {
        if (sc !== undefined) finding = await scenarioPrecheck(sc, analyze);
      } catch (e) {
        console.warn(`  ⚠ ${dataset}/${c.id}: no se pudo correr el pre-chequeo (${e instanceof Error ? e.message : String(e)})`);
      }
      rows.push({
        dataset,
        id: c.id,
        tags: c.tags ?? [],
        expected: c.expect?.expectedReview as string,
        kind,
        pre: finding?.review ?? null,
        reason: finding?.reason ?? null,
      });
    }
  }
  return rows;
}

// ───────────────────────── Tuberías ─────────────────────────

type Pipe = "d3" | "pre+d3" | "pre+d3w" | "pre";
const PIPES: Pipe[] = ["d3", "pre+d3", "pre+d3w", "pre"];

function label(pipe: Pipe, row: CaseRow, d3: string): string {
  if (pipe === "d3") return d3;
  if (row.pre !== null) return row.pre;
  if (pipe === "pre") return "approved";
  if (pipe === "pre+d3w" && row.kind === "read") return "approved";
  return d3;
}

interface D3Run {
  variant: string;
  dataset: string;
  byCase: Map<string, string>;
}

function loadRuns(dir: string): D3Run[] {
  const out: D3Run[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes("__")) continue;
    const i = entry.name.lastIndexOf("__");
    const file = join(dir, entry.name, "runs.jsonl");
    if (!existsSync(file)) continue;
    const byCase = new Map<string, string>();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const r = JSON.parse(line) as { stage: string; caseId: string; iteration: number; predictedLabel: string | null };
      if (r.stage === "args_review" && r.iteration === 1 && r.predictedLabel !== null) byCase.set(r.caseId, r.predictedLabel);
    }
    if (byCase.size > 0) out.push({ variant: entry.name.slice(0, i), dataset: entry.name.slice(i + 2), byCase });
  }
  return out;
}

// ───────────────────────── Informe ─────────────────────────

function preReport(rows: CaseRow[]): string[] {
  const md: string[] = ["## Pre-chequeo solo (código, sin modelo)", ""];
  md.push("| Dataset | Casos | Aprobadas marcadas (falsos rechazos) | Malas marcadas (recall) | Etiqueta correcta |");
  md.push("|---|---|---|---|---|");
  const sets = [...new Set(rows.map((r) => r.dataset))];
  const line = (name: string, rs: CaseRow[]): string => {
    const good = rs.filter((r) => r.expected === "approved");
    const bad = rs.filter((r) => r.expected !== "approved");
    const fp = good.filter((r) => r.pre !== null).length;
    const tp = bad.filter((r) => r.pre !== null).length;
    const right = bad.filter((r) => r.pre === r.expected).length;
    return `| ${name} | ${rs.length} | ${pct(fp, good.length)} | ${pct(tp, bad.length)} | ${pct(right, bad.length)} |`;
  };
  for (const d of sets) md.push(line(d, rows.filter((r) => r.dataset === d)));
  md.push(line("**todos**", rows), "");

  md.push("### Recall por modo de falla (etiqueta de tag)", "", "| Tag | Casos | Marcadas |", "|---|---|---|");
  const tags = new Map<string, CaseRow[]>();
  for (const r of rows.filter((x) => x.expected !== "approved")) {
    for (const t of r.tags.filter((x) => !["escenario", "args_review", "mutacion", "traza"].includes(x))) tags.set(t, [...(tags.get(t) ?? []), r]);
  }
  for (const [t, rs] of [...tags.entries()].sort((a, b) => b[1].length - a[1].length)) {
    md.push(`| ${t} | ${rs.length} | ${pct(rs.filter((r) => r.pre !== null).length, rs.length)} |`);
  }
  md.push("", "### Aprobadas que el pre-chequeo marcó (falsos rechazos)", "");
  const fps = rows.filter((r) => r.expected === "approved" && r.pre !== null);
  if (fps.length === 0) md.push("Ninguna.");
  for (const r of fps) md.push(`- \`${r.dataset}/${r.id}\`: ${r.reason}`);
  md.push("", "### Malas que el pre-chequeo no marcó", "");
  const miss = rows.filter((r) => r.expected !== "approved" && r.pre === null);
  if (miss.length === 0) md.push("Ninguna.");
  for (const r of miss) md.push(`- \`${r.dataset}/${r.id}\` (${r.expected}; ${r.tags.filter((t) => !["escenario", "args_review"].includes(t)).join(", ")})`);
  return md;
}

function crossReport(rows: CaseRow[], runs: D3Run[]): { md: string[]; json: unknown[] } {
  const md: string[] = ["", "## Tuberías con D3 (etiquetas de la primera repetición)", ""];
  const json: unknown[] = [];
  const index = new Map(rows.map((r) => [`${r.dataset}/${r.id}`, r]));
  const variants = [...new Set(runs.map((r) => r.variant))];
  const baseline = "prod";

  const outcome = (variant: string, pipe: Pipe): Map<string, { ok: boolean; got: string; row: CaseRow }> => {
    const m = new Map<string, { ok: boolean; got: string; row: CaseRow }>();
    for (const run of runs.filter((r) => r.variant === variant)) {
      for (const [id, d3] of run.byCase) {
        const row = index.get(`${run.dataset}/${id}`);
        if (row === undefined) continue;
        const got = label(pipe, row, d3);
        m.set(`${run.dataset}/${id}`, { ok: got === row.expected, got, row });
      }
    }
    return m;
  };

  md.push("| Variante | Tubería | Casos | Acierto | Falsos rechazos (aprobadas rechazadas) | Malas con la etiqueta correcta | Malas aprobadas | vs `prod`/`d3` (mejora/empeora, p) |");
  md.push("|---|---|---|---|---|---|---|---|");
  const base = outcome(baseline, "d3");
  for (const variant of variants) {
    for (const pipe of PIPES) {
      const res = outcome(variant, pipe);
      const all = [...res.values()];
      const good = all.filter((x) => x.row.expected === "approved");
      const bad = all.filter((x) => x.row.expected !== "approved");
      const fp = good.filter((x) => x.got !== "approved").length;
      const right = bad.filter((x) => x.ok).length;
      const passed = bad.filter((x) => x.got === "approved").length;
      let b = 0;
      let c = 0;
      for (const [k, x] of res) {
        const y = base.get(k);
        if (y === undefined || x.ok === y.ok) continue;
        if (x.ok) b++;
        else c++;
      }
      const cmp = variant === baseline && pipe === "d3" ? "—" : `${b}/${c}, p=${signTestP(b, c).toFixed(2)}`;
      md.push(`| ${variant} | ${pipe} | ${all.length} | ${pct(all.filter((x) => x.ok).length, all.length)} | ${pct(fp, good.length)} | ${pct(right, bad.length)} | ${pct(passed, bad.length)} | ${cmp} |`);
      json.push({ variant, pipe, n: all.length, acierto: all.filter((x) => x.ok).length, falsosRechazos: fp, aprobadas: good.length, malasCorrectas: right, malas: bad.length, malasAprobadas: passed, mejora: b, empeora: c });
    }
  }
  md.push("", "Falsos rechazos: de las aprobadas, cuántas terminan rechazadas. Malas aprobadas: de las malas, cuántas pasan sin rechazo. Con n pequeño, un p alto no significa que no haya diferencia.");
  return { md, json };
}

// ───────────────────────── D4 (result_verification) ─────────────────────────

function d4Report(dir: string): string[] {
  const md: string[] = ["", "## D4 (result_verification)", ""];
  const byVariant = new Map<string, { good: number[]; bad: number[]; dataset: Set<string> }>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes("__")) continue;
    const i = entry.name.lastIndexOf("__");
    const file = join(dir, entry.name, "runs.jsonl");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) {
      if (line.trim() === "") continue;
      const r = JSON.parse(line) as { stage: string; iteration: number; expectedLabel: string | null; parsedOutput?: { okProbability?: number; cumpleProbability?: number } };
      if (r.stage !== "result_verification" || r.iteration !== 1 || r.parsedOutput?.okProbability === undefined || r.parsedOutput.cumpleProbability === undefined) continue;
      const approve = Math.min(r.parsedOutput.okProbability, r.parsedOutput.cumpleProbability);
      const v = byVariant.get(entry.name.slice(0, i)) ?? { good: [], bad: [], dataset: new Set<string>() };
      (r.expectedLabel === "ok=true,cumple=true" ? v.good : v.bad).push(approve);
      v.dataset.add(entry.name.slice(i + 2));
      byVariant.set(entry.name.slice(0, i), v);
    }
  }
  if (byVariant.size === 0) return [];
  md.push("| Variante | Buenos | Buenos aprobados (> 0,5) | Buenos auto-aprobados (≥ 0,9) | Malos | Falsos aprobados (> 0,5) | Peor caso malo |");
  md.push("|---|---|---|---|---|---|---|");
  for (const [variant, v] of byVariant) {
    md.push(
      `| ${variant} | ${v.good.length} | ${pct(v.good.filter((p) => p > 0.5).length, v.good.length)} | ${pct(v.good.filter((p) => p >= 0.9).length, v.good.length)} | ${v.bad.length} | ${pct(v.bad.filter((p) => p > 0.5).length, v.bad.length)} | ${v.bad.length === 0 ? "—" : Math.max(...v.bad).toFixed(3)} |`,
    );
  }
  md.push("", "Aprobar = el mínimo entre `ok` y `cumple` supera el umbral. Buenos = esperado `ok` y `cumple`; malos = cualquier otro.");
  return md;
}

// ───────────────────────── Principal ─────────────────────────

async function main(): Promise<void> {
  const datasets = (flag("dataset") ?? "scenarios_args_review").split(",").map((s) => s.trim()).filter(Boolean);
  const runsDir = flag("runs");
  const label = flag("label") ?? "";
  console.log(`Pre-chequeo sobre ${datasets.join(", ")}…`);
  const rows = await precheckRows(datasets);

  const md = ["# Cruce del pre-chequeo con D3", "", `Datasets: ${datasets.join(", ")}${runsDir ? ` · corrida: \`${runsDir}\`` : ""}`, "", ...preReport(rows)];
  let json: unknown[] = [];
  if (runsDir !== undefined) {
    const runs = loadRuns(runsDir).filter((r) => datasets.includes(r.dataset));
    if (runs.length === 0) console.warn("⚠ La corrida no tiene resultados de args_review para esos datasets.");
    else {
      const x = crossReport(rows, runs);
      md.push(...x.md);
      json = x.json;
    }
    md.push(...d4Report(runsDir));
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const dir = join("eval/results", "_cross", `${stamp}${label ? `_${label}` : ""}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cross.md"), `${md.join("\n")}\n`);
  writeFileSync(join(dir, "cross.json"), JSON.stringify({ datasets, runsDir: runsDir ?? null, rows, pipelines: json }, null, 2));
  console.log(md.join("\n"));
  console.log(`\nGuardado en ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
