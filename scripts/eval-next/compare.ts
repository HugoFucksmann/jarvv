#!/usr/bin/env node
/**
 * scripts/eval-next/compare.ts
 *
 * Comparación de corridas de eval-next. Solo lee resultados (meta.json, scores.json,
 * runs.jsonl); no importa nada de src/ ni ejecuta modelos.
 *
 * Modos:
 *   A) A vs B (baseline vs candidato):
 *        npx tsx scripts/eval-next/compare.ts <A> <B> [flags]
 *   B) Leaderboard de modelos (última corrida de cada uno):
 *        npx tsx scripts/eval-next/compare.ts --models=mock,qwen2.5_7b,d3 [flags]
 *   C) Listar corridas disponibles:
 *        npx tsx scripts/eval-next/compare.ts --list [--model=<m>]
 *
 * Referencia de corrida (<A>/<B>):
 *   - ruta a una carpeta de corrida (absoluta o relativa al cwd)
 *   - `<modelo>`              → última corrida de ese modelo
 *   - `<modelo>/<runId>`      → corrida concreta (runId = nombre de carpeta)
 *   - `<modelo>/<prefijo>`    → corrida cuyo runId empieza con el prefijo
 *   - `<modelo>#<label>`      → última corrida del modelo cuyo runId termina en _<label>
 *   El modelo puede escribirse con ":" (qwen2.5:7b); se sanitiza como en results.ts.
 *
 * Flags:
 *   --dataset=<nombre>       Al resolver "última corrida", exigir este dataset (basename sin extensión)
 *   --variant=<nombre>       Idem para la variante
 *   --label=<texto>          Idem para el sufijo de label del runId
 *   --threshold=<0..1>       Caída mínima de passRate para contar como regresión (default 0.05)
 *   --failOnRegression       Exit 1 si hay regresión (global, por etapa o por caso)
 *   --requireComparable      Exit 1 si las corridas no son comparables (dataset/stages/prompts distintos)
 *   --json                   Salida JSON en vez de Markdown
 *   --out=<archivo>          Escribir el reporte en archivo además de stdout
 *   --maxCases=<N>           Máx. de casos listados por sección (default 20)
 *
 * Exit codes: 0 OK · 1 regresión / no comparable (según flags) · 2 error de entrada o infraestructura
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Tipos mínimos (solo lo que se lee de los archivos de salida, schemaVersion 1)
// ============================================================================

const SUPPORTED_SCHEMA = 1;
const RESULTS_ROOT = path.resolve(process.cwd(), "scripts/eval-next/results");

interface Meta {
  schemaVersion?: number;
  runId: string;
  timestamp: string;
  model: string;
  variant: string;
  stages: string[];
  datasetPath: string;
  repeat: number;
  gitCommit?: string;
  gitDirty?: boolean;
  promptHashes?: Record<string, string>;
  sourceHashes?: Record<string, string>;
  params?: Record<string, unknown>;
}

interface StageScore {
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  passAllRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  accuracy?: number;
  confusionMatrix?: Record<string, Record<string, number>>;
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
}

interface Scores {
  schemaVersion?: number;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  passAllRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  stages: Record<string, StageScore>;
}

interface RunLine {
  schemaVersion?: number;
  caseId: string;
  stage: string;
  iteration: number;
  passed: boolean;
  isRaw?: boolean;
  errors?: string[];
  predictedLabel?: string | null;
  expectedLabel?: string | null;
  requestHash?: string;
  durationMs?: number;
}

interface LoadedRun {
  dir: string;
  label: string; // "<modelDir>/<runId>"
  meta: Meta;
  scores: Scores;
  runs: RunLine[];
}

interface CaseAgg {
  key: string; // "<stage>/<caseId>"
  stage: string;
  caseId: string;
  isRaw: boolean;
  n: number;
  passed: number;
  rate: number;
  topError?: string;
  predicted: Record<string, number>;
  expectedLabel?: string | null;
  hashes: Set<string>;
}

// ============================================================================
// CLI
// ============================================================================

interface Opts {
  positional: string[];
  models?: string[];
  list: boolean;
  model?: string;
  dataset?: string;
  variant?: string;
  label?: string;
  threshold: number;
  failOnRegression: boolean;
  requireComparable: boolean;
  json: boolean;
  out?: string;
  maxCases: number;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    positional: [],
    list: false,
    threshold: 0.05,
    failOnRegression: false,
    requireComparable: false,
    json: false,
    maxCases: 20,
  };
  for (const a of argv) {
    if (!a.startsWith("--")) {
      o.positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const v = eq === -1 ? "" : a.slice(eq + 1);
    switch (k) {
      case "models":
        o.models = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "list": o.list = true; break;
      case "model": o.model = v; break;
      case "dataset": o.dataset = v; break;
      case "variant": o.variant = v; break;
      case "label": o.label = v; break;
      case "threshold": {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1) throw new UsageError("--threshold debe estar en 0..1");
        o.threshold = n;
        break;
      }
      case "failOnRegression": o.failOnRegression = true; break;
      case "requireComparable": o.requireComparable = true; break;
      case "json": o.json = true; break;
      case "out": o.out = v; break;
      case "maxCases": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new UsageError("--maxCases debe ser entero >= 1");
        o.maxCases = n;
        break;
      }
      default:
        throw new UsageError(`Flag desconocido: --${k}`);
    }
  }
  return o;
}

// ============================================================================
// Carga y resolución de corridas
// ============================================================================

const sanitizeModel = (m: string) => m.replace(/[:/]/g, "_");

function listRunDirs(modelDir: string): string[] {
  if (!fs.existsSync(modelDir)) return [];
  return fs
    .readdirSync(modelDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(modelDir, d.name, "meta.json")))
    .map((d) => d.name)
    .sort(); // runId empieza con timestamp → orden lexicográfico = cronológico
}

function readJson<T>(file: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (e: any) {
    throw new Error(`No se pudo leer ${file}: ${e.message}`);
  }
}

function loadRun(dir: string): LoadedRun {
  const metaFile = path.join(dir, "meta.json");
  const scoresFile = path.join(dir, "scores.json");
  const runsFile = path.join(dir, "runs.jsonl");
  for (const f of [metaFile, scoresFile, runsFile]) {
    if (!fs.existsSync(f)) {
      throw new Error(`Corrida incompleta (falta ${path.basename(f)}): ${dir}. ¿Se interrumpió?`);
    }
  }
  const meta = readJson<Meta>(metaFile);
  const scores = readJson<Scores>(scoresFile);
  for (const [name, sv] of [["meta.json", meta.schemaVersion], ["scores.json", scores.schemaVersion]] as const) {
    if (sv !== SUPPORTED_SCHEMA) {
      throw new Error(`${name} de ${dir} tiene schemaVersion=${sv ?? "ausente"}; se soporta ${SUPPORTED_SCHEMA}.`);
    }
  }
  const runs: RunLine[] = [];
  const lines = fs.readFileSync(runsFile, "utf-8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = JSON.parse(line) as RunLine;
      if (r.schemaVersion !== SUPPORTED_SCHEMA) {
        throw new Error(`schemaVersion=${r.schemaVersion ?? "ausente"}`);
      }
      runs.push(r);
    } catch (e: any) {
      throw new Error(`runs.jsonl inválido en ${dir} línea ${i + 1}: ${e.message}`);
    }
  });
  const rel = path.relative(RESULTS_ROOT, dir);
  const label = rel.startsWith("..") ? dir : rel.split(path.sep).join("/");
  return { dir, label, meta, scores, runs };
}

function datasetName(meta: Meta): string {
  const base = meta.datasetPath.split(/[\\/]/).pop() ?? meta.datasetPath;
  return base.replace(/\.[^.]+$/, "");
}

function resolveRun(rawRef: string, o: Opts): LoadedRun {
  const hash = rawRef.indexOf("#");
  const ref = hash === -1 ? rawRef : rawRef.slice(0, hash);
  const refLabel = hash === -1 ? o.label : rawRef.slice(hash + 1);
  // 1) ruta directa a carpeta de corrida
  const asPath = path.resolve(process.cwd(), ref);
  if (fs.existsSync(path.join(asPath, "meta.json"))) return loadRun(asPath);

  // 2) <modelo> o <modelo>/<runId|prefijo>
  const slash = ref.indexOf("/");
  const modelPart = slash === -1 ? ref : ref.slice(0, slash);
  const runPart = slash === -1 ? undefined : ref.slice(slash + 1);
  const modelDir = path.join(RESULTS_ROOT, sanitizeModel(modelPart));
  const ids = listRunDirs(modelDir);
  if (ids.length === 0) {
    throw new UsageError(`No hay corridas para "${ref}" (buscado en ${modelDir}). Usá --list para ver las disponibles.`);
  }

  if (runPart) {
    const exact = ids.find((id) => id === runPart);
    const prefixed = ids.filter((id) => id.startsWith(runPart));
    if (exact) return loadRun(path.join(modelDir, exact));
    if (prefixed.length === 1) return loadRun(path.join(modelDir, prefixed[0]));
    if (prefixed.length > 1) {
      throw new UsageError(`"${ref}" es ambiguo (${prefixed.length} corridas):\n  ${prefixed.join("\n  ")}`);
    }
    throw new UsageError(`No existe la corrida "${runPart}" para el modelo ${modelPart}.`);
  }

  // última que cumpla los filtros
  for (let i = ids.length - 1; i >= 0; i--) {
    const dir = path.join(modelDir, ids[i]);
    let run: LoadedRun;
    try {
      run = loadRun(dir);
    } catch {
      continue; // corrida incompleta/ilegible: se salta al resolver "última"
    }
    if (o.dataset && datasetName(run.meta) !== o.dataset) continue;
    if (o.variant && run.meta.variant !== o.variant) continue;
    if (refLabel && !run.meta.runId.endsWith(`_${refLabel}`)) continue;
    return run;
  }
  throw new UsageError(`No hay corridas completas de "${ref}" que cumplan los filtros (dataset/variant/label).`);
}

// ============================================================================
// Agregación por caso
// ============================================================================

function aggregateCases(run: LoadedRun): Map<string, CaseAgg> {
  const map = new Map<string, CaseAgg>();
  const errCount = new Map<string, Map<string, number>>();
  for (const r of run.runs) {
    const key = `${r.stage}/${r.caseId}`;
    let a = map.get(key);
    if (!a) {
      a = {
        key, stage: r.stage, caseId: r.caseId, isRaw: !!r.isRaw,
        n: 0, passed: 0, rate: 0, predicted: {}, expectedLabel: r.expectedLabel, hashes: new Set(),
      };
      map.set(key, a);
    }
    a.n++;
    if (r.passed) a.passed++;
    if (r.predictedLabel) a.predicted[r.predictedLabel] = (a.predicted[r.predictedLabel] ?? 0) + 1;
    if (r.requestHash) a.hashes.add(r.requestHash);
    if (!r.passed && r.errors?.length) {
      const m = errCount.get(key) ?? new Map<string, number>();
      m.set(r.errors[0], (m.get(r.errors[0]) ?? 0) + 1);
      errCount.set(key, m);
    }
  }
  for (const a of map.values()) {
    a.rate = a.n > 0 ? a.passed / a.n : 0;
    const m = errCount.get(a.key);
    if (m) a.topError = [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
  }
  return map;
}

// ============================================================================
// Comparabilidad
// ============================================================================

interface Issue { level: "blocker" | "warning"; text: string }

function diffRecords(a: Record<string, string> = {}, b: Record<string, string> = {}): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

function checkComparable(A: LoadedRun, B: LoadedRun, ca: Map<string, CaseAgg>, cb: Map<string, CaseAgg>): Issue[] {
  const issues: Issue[] = [];
  const dsA = datasetName(A.meta), dsB = datasetName(B.meta);
  if (dsA !== dsB) issues.push({ level: "blocker", text: `Datasets distintos: ${dsA} vs ${dsB}` });

  const onlyA = [...ca.keys()].filter((k) => !cb.has(k));
  const onlyB = [...cb.keys()].filter((k) => !ca.has(k));
  if (onlyA.length || onlyB.length) {
    issues.push({
      level: "blocker",
      text: `Conjunto de casos distinto: ${onlyA.length} solo en A, ${onlyB.length} solo en B (se comparan solo los comunes)`,
    });
  }

  const stA = [...A.meta.stages].sort().join(","), stB = [...B.meta.stages].sort().join(",");
  if (stA !== stB) issues.push({ level: "warning", text: `Etapas distintas: [${stA}] vs [${stB}]` });
  if (A.meta.repeat !== B.meta.repeat) {
    issues.push({ level: "warning", text: `repeat distinto: ${A.meta.repeat} vs ${B.meta.repeat} (passRate por caso menos comparable)` });
  }
  if (A.meta.variant !== B.meta.variant) {
    issues.push({ level: "warning", text: `Variante distinta: ${A.meta.variant} vs ${B.meta.variant} (esperable si se compara variantes)` });
  }
  if (A.meta.model !== B.meta.model) {
    issues.push({ level: "warning", text: `Modelo distinto: ${A.meta.model} vs ${B.meta.model} (esperable si se compara modelos)` });
  }

  const ph = diffRecords(A.meta.promptHashes, B.meta.promptHashes);
  const sh = diffRecords(A.meta.sourceHashes, B.meta.sourceHashes);
  if (ph.length) issues.push({ level: "blocker", text: `Prompts de producción distintos (promptHashes): ${ph.join(", ")}` });
  if (sh.length) issues.push({ level: "blocker", text: `Código src/ distinto (sourceHashes): ${sh.join(", ")}` });

  // Mismo caso+iteración con distinto requestHash ⇒ el input enviado no fue idéntico
  // (el requestHash incluye el prompt; con variantes/modelos distintos puede diferir legítimamente).
  let hashMismatch = 0;
  for (const [k, a] of ca) {
    const b = cb.get(k);
    if (!b) continue;
    if (a.hashes.size && b.hashes.size && ![...a.hashes].some((h) => b.hashes.has(h))) hashMismatch++;
  }
  if (hashMismatch) {
    issues.push({
      level: "warning",
      text: `${hashMismatch} caso(s) recibieron una request distinta (requestHash) — la diferencia puede venir del prompt, no solo del modelo`,
    });
  }

  if (A.meta.gitDirty) issues.push({ level: "warning", text: `A (${A.meta.gitCommit ?? "?"}) corrió con gitDirty=true: no reproducible solo con el commit` });
  if (B.meta.gitDirty) issues.push({ level: "warning", text: `B (${B.meta.gitCommit ?? "?"}) corrió con gitDirty=true: no reproducible solo con el commit` });
  if (A.meta.params?.isMock || B.meta.params?.isMock) {
    issues.push({ level: "warning", text: "Alguna corrida es Mock: los números no reflejan un modelo real" });
  }
  return issues;
}

// ============================================================================
// Comparación A vs B
// ============================================================================

interface StageDelta {
  stage: string;
  a?: StageScore;
  b?: StageScore;
  dPass?: number;
  dPassAll?: number;
  dAcc?: number;
  dP95?: number;
  dRaw?: number;
  regression: boolean;
}

interface CaseChange {
  key: string;
  kind: "regression" | "improvement";
  rateA: number;
  rateB: number;
  isRaw: boolean;
  error?: string;
  labelA?: string;
  labelB?: string;
}

interface Comparison {
  A: LoadedRun;
  B: LoadedRun;
  issues: Issue[];
  comparable: boolean;
  global: { dPass: number; dPassAll: number; dP95: number; dAvg: number; dRaw: number };
  stages: StageDelta[];
  changes: CaseChange[];
  stableFail: string[];
  regressions: number;
  improvements: number;
  hasRegression: boolean;
}

const topLabel = (p: Record<string, number>): string | undefined =>
  Object.entries(p).sort((x, y) => y[1] - x[1])[0]?.[0];

function compare(A: LoadedRun, B: LoadedRun, threshold: number): Comparison {
  const ca = aggregateCases(A), cb = aggregateCases(B);
  const issues = checkComparable(A, B, ca, cb);
  const comparable = !issues.some((i) => i.level === "blocker");

  const stageNames = [...new Set([...Object.keys(A.scores.stages), ...Object.keys(B.scores.stages)])].sort();
  const stages: StageDelta[] = stageNames.map((stage) => {
    const a = A.scores.stages[stage], b = B.scores.stages[stage];
    const d: StageDelta = { stage, a, b, regression: false };
    if (a && b) {
      d.dPass = b.passRate - a.passRate;
      d.dPassAll = b.passAllRate - a.passAllRate;
      d.dAcc = a.accuracy !== undefined && b.accuracy !== undefined ? b.accuracy - a.accuracy : undefined;
      d.dP95 = b.p95DurationMs - a.p95DurationMs;
      d.dRaw = a.rawTotalRuns > 0 && b.rawTotalRuns > 0 ? b.rawPassRate - a.rawPassRate : undefined;
      d.regression = d.dPass < -threshold || (d.dRaw !== undefined && d.dRaw < -threshold);
    }
    return d;
  });

  const changes: CaseChange[] = [];
  const stableFail: string[] = [];
  for (const [key, a] of ca) {
    const b = cb.get(key);
    if (!b) continue;
    const diff = b.rate - a.rate;
    if (Math.abs(diff) < 1e-9) {
      if (a.rate === 0) stableFail.push(key);
      continue;
    }
    changes.push({
      key,
      kind: diff < 0 ? "regression" : "improvement",
      rateA: a.rate,
      rateB: b.rate,
      isRaw: a.isRaw || b.isRaw,
      error: diff < 0 ? b.topError : undefined,
      labelA: topLabel(a.predicted),
      labelB: topLabel(b.predicted),
    });
  }
  changes.sort((x, y) => Math.abs(y.rateB - y.rateA) - Math.abs(x.rateB - x.rateA) || x.key.localeCompare(y.key));

  const regressions = changes.filter((c) => c.kind === "regression").length;
  const improvements = changes.length - regressions;
  const global = {
    dPass: B.scores.passRate - A.scores.passRate,
    dPassAll: B.scores.passAllRate - A.scores.passAllRate,
    dP95: B.scores.p95DurationMs - A.scores.p95DurationMs,
    dAvg: B.scores.avgDurationMs - A.scores.avgDurationMs,
    dRaw: B.scores.rawPassRate - A.scores.rawPassRate,
  };
  const hasRegression =
    global.dPass < -threshold || stages.some((s) => s.regression) || regressions > 0;

  return { A, B, issues, comparable, global, stages, changes, stableFail, regressions, improvements, hasRegression };
}

// ============================================================================
// Formato Markdown
// ============================================================================

const pct = (x: number | undefined) => (x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);
const dpct = (x: number | undefined) =>
  x === undefined ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`;
const dms = (x: number | undefined) => (x === undefined ? "—" : `${x > 0 ? "+" : ""}${Math.round(x)} ms`);
const mark = (x: number | undefined, th: number) =>
  x === undefined ? "" : x < -th ? " ⚠️" : x > th ? " ✅" : "";

function table(headers: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

function runHeader(tag: string, r: LoadedRun): string {
  const m = r.meta;
  return `- **${tag}** \`${r.label}\` — modelo \`${m.model}\`, variante \`${m.variant}\`, dataset \`${datasetName(m)}\`, repeat ${m.repeat}, commit \`${m.gitCommit ?? "?"}\`${m.gitDirty ? " (dirty)" : ""}`;
}

function formatCompare(c: Comparison, o: Opts): string {
  const th = o.threshold;
  const L: string[] = [];
  L.push(`# Comparación eval-next`, "");
  L.push(runHeader("A (baseline)", c.A), runHeader("B (candidato)", c.B), "");

  L.push(`## Comparabilidad`, "");
  if (c.issues.length === 0) {
    L.push("✅ Corridas comparables: mismo dataset, etapas, prompts y código.", "");
  } else {
    for (const i of c.issues) L.push(`- ${i.level === "blocker" ? "⛔" : "⚠️"} ${i.text}`);
    L.push("");
    if (!c.comparable) L.push("> ⛔ Hay bloqueantes: las diferencias de abajo pueden no deberse al modelo.", "");
  }

  L.push(`## Global`, "");
  L.push(table(
    ["Métrica", "A", "B", "Δ"],
    [
      ["passRate", pct(c.A.scores.passRate), pct(c.B.scores.passRate), dpct(c.global.dPass) + mark(c.global.dPass, th)],
      ["passAllRate", pct(c.A.scores.passAllRate), pct(c.B.scores.passAllRate), dpct(c.global.dPassAll) + mark(c.global.dPassAll, th)],
      [
        `rawPassRate (${c.A.scores.rawTotalRuns}/${c.B.scores.rawTotalRuns} runs)`,
        c.A.scores.rawTotalRuns ? pct(c.A.scores.rawPassRate) : "—",
        c.B.scores.rawTotalRuns ? pct(c.B.scores.rawPassRate) : "—",
        c.A.scores.rawTotalRuns && c.B.scores.rawTotalRuns ? dpct(c.global.dRaw) + mark(c.global.dRaw, th) : "—",
      ],
      ["latencia avg", `${c.A.scores.avgDurationMs} ms`, `${c.B.scores.avgDurationMs} ms`, dms(c.global.dAvg)],
      ["latencia p95", `${c.A.scores.p95DurationMs} ms`, `${c.B.scores.p95DurationMs} ms`, dms(c.global.dP95)],
      ["runs", String(c.A.scores.totalRuns), String(c.B.scores.totalRuns), ""],
    ],
  ), "");

  L.push(`## Por etapa`, "");
  L.push(table(
    ["Etapa", "passRate A", "passRate B", "Δ passRate", "Δ passAll", "Δ accuracy", "Δ raw", "Δ p95"],
    c.stages.map((s) => {
      if (!s.a || !s.b) return [s.stage, s.a ? pct(s.a.passRate) : "—", s.b ? pct(s.b.passRate) : "—", "solo en una corrida", "", "", "", ""];
      return [
        s.stage,
        pct(s.a.passRate),
        pct(s.b.passRate),
        dpct(s.dPass) + mark(s.dPass, th),
        dpct(s.dPassAll),
        dpct(s.dAcc),
        dpct(s.dRaw),
        dms(s.dP95),
      ];
    }),
  ), "");

  // Matrices de confusión que cambiaron
  const confDiffs: string[] = [];
  const sameRepeat = c.A.meta.repeat === c.B.meta.repeat;
  for (const s of sameRepeat ? c.stages : []) {
    const ma = s.a?.confusionMatrix, mb = s.b?.confusionMatrix;
    if (!ma || !mb) continue;
    const cells: string[] = [];
    const exp = new Set([...Object.keys(ma), ...Object.keys(mb)]);
    for (const e of [...exp].sort()) {
      const pred = new Set([...Object.keys(ma[e] ?? {}), ...Object.keys(mb[e] ?? {})]);
      for (const p of [...pred].sort()) {
        const va = ma[e]?.[p] ?? 0, vb = mb[e]?.[p] ?? 0;
        if (va !== vb) cells.push(`esperado \`${e}\` → predicho \`${p}\`: ${va} → ${vb}${e !== p && vb > va ? " ⚠️" : ""}`);
      }
    }
    if (cells.length) confDiffs.push(`**${s.stage}**`, ...cells.map((x) => `- ${x}`), "");
  }
  if (confDiffs.length) L.push(`## Cambios en matrices de confusión`, "", ...confDiffs);

  const regs = c.changes.filter((x) => x.kind === "regression");
  const imps = c.changes.filter((x) => x.kind === "improvement");
  const fmtChange = (x: CaseChange) =>
    [
      `\`${x.key}\`${x.isRaw ? " (raw)" : ""}`,
      pct(x.rateA),
      pct(x.rateB),
      x.labelA !== x.labelB && (x.labelA || x.labelB) ? `${x.labelA ?? "—"} → ${x.labelB ?? "—"}` : "",
      x.error ?? "",
    ];
  const caseTable = (list: CaseChange[]) =>
    table(["Caso", "A", "B", "Etiqueta", "Error principal en B"], list.slice(0, o.maxCases).map(fmtChange)) +
    (list.length > o.maxCases ? `\n\n… y ${list.length - o.maxCases} más (usá --maxCases).` : "");

  L.push(`## Regresiones por caso (${regs.length})`, "");
  L.push(regs.length ? caseTable(regs) : "Ninguna.", "");
  L.push(`## Mejoras por caso (${imps.length})`, "");
  L.push(imps.length ? caseTable(imps) : "Ninguna.", "");
  if (c.stableFail.length) {
    L.push(`## Fallan en A y B (${c.stableFail.length})`, "");
    L.push(c.stableFail.slice(0, o.maxCases).map((k) => `- \`${k}\``).join("\n"));
    if (c.stableFail.length > o.maxCases) L.push(`- … y ${c.stableFail.length - o.maxCases} más`);
    L.push("");
  }

  L.push(`## Veredicto`, "");
  const verdict = c.hasRegression ? "⚠️ **REGRESIÓN**" : "✅ **Sin regresión**";
  L.push(
    `${verdict} (umbral ${dpct(-th)} sobre passRate global/por etapa; cualquier caso que baje cuenta) — ` +
      `${c.regressions} caso(s) peor, ${c.improvements} mejor.` +
      (c.comparable ? "" : " Corridas **no comparables**: tomalo como orientativo."),
    "",
  );
  if (c.A.scores.totalRuns < 30 || c.B.scores.totalRuns < 30) {
    L.push("> Nota: pocos runs (<30). Las diferencias no son estadísticamente significativas; con `sample.jsonl` (smoke test) solo sirven para detectar roturas.", "");
  }
  return L.join("\n");
}

// ============================================================================
// Leaderboard de modelos
// ============================================================================

function formatLeaderboard(runs: LoadedRun[], o: Opts): { text: string; json: unknown; blockers: boolean } {
  const L: string[] = [];
  L.push(`# Leaderboard eval-next`, "");
  const ref = runs[0];
  const issues: Issue[] = [];
  const hasPrompts = (r: LoadedRun) => r.meta.promptHashes && Object.keys(r.meta.promptHashes).length > 0;
  for (const r of runs.slice(1)) {
    if (datasetName(r.meta) !== datasetName(ref.meta)) {
      issues.push({ level: "blocker", text: `\`${r.label}\` usa dataset ${datasetName(r.meta)} (≠ ${datasetName(ref.meta)})` });
    }
    if (r.meta.variant !== ref.meta.variant) {
      issues.push({ level: "warning", text: `\`${r.label}\` usa variante ${r.meta.variant} (≠ ${ref.meta.variant})` });
    }
    if (hasPrompts(r) && hasPrompts(ref)) {
      const ph = diffRecords(r.meta.promptHashes, ref.meta.promptHashes);
      const sh = diffRecords(r.meta.sourceHashes, ref.meta.sourceHashes);
      if (ph.length || sh.length) {
        issues.push({ level: "blocker", text: `\`${r.label}\` corrió con prompts/código de producción distintos (${[...ph, ...sh].join(", ")})` });
      }
    }
    if (r.meta.repeat !== ref.meta.repeat) {
      issues.push({ level: "warning", text: `\`${r.label}\` usa repeat=${r.meta.repeat} (≠ ${ref.meta.repeat})` });
    }
  }
  for (const r of runs) {
    if (r.meta.params?.isMock) issues.push({ level: "warning", text: `\`${r.label}\` es Mock` });
    if (r.meta.gitDirty) issues.push({ level: "warning", text: `\`${r.label}\` con gitDirty=true` });
    if (r.scores.totalRuns < 30) issues.push({ level: "warning", text: `\`${r.label}\` tiene pocos runs (${r.scores.totalRuns})` });
  }
  if (issues.length) {
    L.push(`## Comparabilidad`, "");
    for (const i of issues) L.push(`- ${i.level === "blocker" ? "⛔" : "⚠️"} ${i.text}`);
    L.push("");
  }

  const sorted = [...runs].sort((a, b) => b.scores.passRate - a.scores.passRate || a.scores.p95DurationMs - b.scores.p95DurationMs);
  L.push(`## Global`, "");
  L.push(table(
    ["#", "Modelo", "Corrida", "passRate", "passAllRate", "raw", "avg", "p95", "runs"],
    sorted.map((r, i) => [
      String(i + 1),
      `\`${r.meta.model}\``,
      `\`${r.meta.runId}\``,
      pct(r.scores.passRate),
      pct(r.scores.passAllRate),
      r.scores.rawTotalRuns ? pct(r.scores.rawPassRate) : "—",
      `${r.scores.avgDurationMs} ms`,
      `${r.scores.p95DurationMs} ms`,
      String(r.scores.totalRuns),
    ]),
  ), "");

  const stageNames = [...new Set(runs.flatMap((r) => Object.keys(r.scores.stages)))].sort();
  L.push(`## passRate por etapa`, "");
  L.push(table(
    ["Etapa", ...sorted.map((r) => `\`${r.meta.model}\``)],
    stageNames.map((st) => {
      const vals = sorted.map((r) => r.scores.stages[st]?.passRate);
      const best = Math.max(...vals.filter((v): v is number => v !== undefined));
      return [st, ...vals.map((v) => (v === undefined ? "—" : `${pct(v)}${v === best && vals.filter((x) => x === best).length < vals.length ? " 🏆" : ""}`))];
    }),
  ), "");

  L.push(`## Latencia p95 por etapa`, "");
  L.push(table(
    ["Etapa", ...sorted.map((r) => `\`${r.meta.model}\``)],
    stageNames.map((st) => [st, ...sorted.map((r) => (r.scores.stages[st] ? `${r.scores.stages[st].p95DurationMs} ms` : "—"))]),
  ), "");

  // Casos que ningún modelo resuelve / en los que los modelos discrepan
  const aggs = sorted.map((r) => aggregateCases(r));
  const keys = [...new Set(aggs.flatMap((m) => [...m.keys()]))].sort();
  const allFail: string[] = [];
  const disagree: string[] = [];
  for (const k of keys) {
    const rates = aggs.map((m) => m.get(k)?.rate).filter((v): v is number => v !== undefined);
    if (rates.length < 2) continue;
    if (rates.every((v) => v === 0)) allFail.push(k);
    else if (Math.min(...rates) !== Math.max(...rates)) disagree.push(k);
  }
  L.push(`## Casos que ningún modelo resuelve (${allFail.length})`, "");
  L.push(allFail.length ? allFail.slice(0, o.maxCases).map((k) => `- \`${k}\``).join("\n") : "Ninguno.", "");
  L.push(`## Casos donde los modelos discrepan (${disagree.length})`, "");
  L.push(
    disagree.length
      ? table(
          ["Caso", ...sorted.map((r) => `\`${r.meta.model}\``)],
          disagree.slice(0, o.maxCases).map((k) => [`\`${k}\``, ...aggs.map((m) => (m.has(k) ? pct(m.get(k)!.rate) : "—"))]),
        )
      : "Ninguno.",
    "",
  );

  const json = {
    issues,
    runs: sorted.map((r) => ({ runId: r.meta.runId, model: r.meta.model, passRate: r.scores.passRate, passAllRate: r.scores.passAllRate, rawPassRate: r.scores.rawPassRate, p95DurationMs: r.scores.p95DurationMs, stages: Object.fromEntries(Object.entries(r.scores.stages).map(([k, v]) => [k, { passRate: v.passRate, p95DurationMs: v.p95DurationMs }])) })),
    allFail,
    disagree,
  };
  return { text: L.join("\n"), json, blockers: issues.some((i) => i.level === "blocker") };
}

// ============================================================================
// --list
// ============================================================================

function formatList(o: Opts): string {
  if (!fs.existsSync(RESULTS_ROOT)) return "No hay resultados todavía (scripts/eval-next/results/ no existe).";
  const models = o.model
    ? [sanitizeModel(o.model)]
    : fs.readdirSync(RESULTS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const rows: string[][] = [];
  for (const m of models) {
    for (const id of listRunDirs(path.join(RESULTS_ROOT, m))) {
      try {
        const r = loadRun(path.join(RESULTS_ROOT, m, id));
        rows.push([
          `${m}/${id}`,
          datasetName(r.meta),
          r.meta.variant,
          String(r.meta.repeat),
          pct(r.scores.passRate),
          String(r.scores.totalRuns),
          `${r.meta.gitCommit ?? "?"}${r.meta.gitDirty ? "*" : ""}`,
        ]);
      } catch {
        rows.push([`${m}/${id}`, "(ilegible/incompleta)", "", "", "", "", ""]);
      }
    }
  }
  if (!rows.length) return "No hay corridas.";
  return table(["Corrida", "Dataset", "Variante", "Repeat", "passRate", "Runs", "Commit"], rows);
}

// ============================================================================
// main
// ============================================================================

function emit(text: string, o: Opts) {
  console.log(text);
  if (o.out) {
    const file = path.resolve(process.cwd(), o.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text + "\n", "utf-8");
  }
}

function main(): number {
  const o = parseArgs(process.argv.slice(2));

  if (o.list) {
    console.log(formatList(o));
    return 0;
  }

  if (o.models) {
    if (o.positional.length) throw new UsageError("--models no se combina con referencias posicionales.");
    if (o.models.length < 2) throw new UsageError("--models necesita al menos 2 modelos (separados por coma).");
    const runs = o.models.map((m) => resolveRun(m, o));
    const lb = formatLeaderboard(runs, o);
    emit(o.json ? JSON.stringify(lb.json, null, 2) : lb.text, o);
    return o.requireComparable && lb.blockers ? 1 : 0;
  }

  if (o.positional.length !== 2) {
    throw new UsageError("Uso: compare.ts <A> <B> | --models=a,b,c | --list   (ver cabecera del archivo)");
  }
  const A = resolveRun(o.positional[0], o);
  const B = resolveRun(o.positional[1], o);
  if (A.dir === B.dir) throw new UsageError("A y B son la misma corrida.");

  const c = compare(A, B, o.threshold);
  const out = o.json
    ? JSON.stringify(
        {
          A: A.meta.runId, B: B.meta.runId, comparable: c.comparable, issues: c.issues,
          global: c.global, stages: c.stages.map((s) => ({ stage: s.stage, dPass: s.dPass, dPassAll: s.dPassAll, dAcc: s.dAcc, dP95: s.dP95, dRaw: s.dRaw, regression: s.regression })),
          changes: c.changes, stableFail: c.stableFail, hasRegression: c.hasRegression,
        },
        null,
        2,
      )
    : formatCompare(c, o);
  emit(out, o);

  if (o.requireComparable && !c.comparable) return 1;
  if (o.failOnRegression && c.hasRegression) return 1;
  return 0;
}

try {
  process.exitCode = main();
} catch (err: any) {
  console.error(`\n💥 ${err.message}\n`);
  process.exitCode = 2;
}
