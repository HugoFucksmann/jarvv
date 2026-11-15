/**
 * eval/real/realStageLoader.ts
 *
 * Cargador del modo `--source=real-stage`:
 * - Acepta archivos `.jsonl` con especificaciones (`trace`, `frozen`, `executable`), carpetas
 *   con `.jsonl`/trazas, o trazas individuales (`trace.json`, `full.json`, `full.json.gz`) en `--dry-run`.
 * - Rehidrata/captura cada entrada en `FrozenStageCapture`, materializa con `materializeRealStage`
 *   y entrega `Dataset[]` estándar compatibles con `runDataset`, `RunRecord`, `scores.json` y `comparison.md`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { ALL_STAGES, validateCase } from "../core/case.ts";
import { filterCases } from "../core/datasets.ts";
import type { CaseFilters, Dataset } from "../core/datasets.ts";
import { globBaseDir, isGlob, matchGlob, normalizePath } from "../core/glob.ts";
import type { Case, StageName, Variant } from "../core/types.ts";
import { captureExecutableScenario } from "./executableScenario.ts";
import { parseMigratedSnapshot } from "./migrateSnapshot.ts";
import { materializeRealStage } from "./realStageMaterialize.ts";
import { loadTraceFile, reconstructStageFromTrace, stageIdToEvalStage } from "./reconstructTrace.ts";
import type { ExecutableStopSpec, FrozenStageCapture, RealStageSpec, RealStageSpecBase, StageTarget } from "./types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStageName(v: unknown): StageName | undefined {
  if (typeof v !== "string") return undefined;
  return ALL_STAGES.find((s) => s === v);
}

function parseStringArray(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new Error(`'${field}' debe ser un array de strings.`);
  }
  return v;
}

function parseStringRecord(v: unknown, field: string): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v) || Object.values(v).some((x) => typeof x !== "string")) {
    throw new Error(`'${field}' debe ser un objeto de strings.`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function parseTarget(raw: unknown): StageTarget | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error("'target' debe ser un objeto.");
  return raw satisfies StageTarget;
}

function parseExecutableStopSpec(raw: unknown): ExecutableStopSpec {
  if (!isRecord(raw)) throw new Error("'executable' debe ser un objeto.");
  if (typeof raw.request !== "string" || raw.request.length === 0) {
    throw new Error("'executable.request' debe ser un string no vacío.");
  }
  if (raw.mode !== "reactive" && raw.mode !== "deliberative") {
    throw new Error("'executable.mode' debe ser 'reactive' o 'deliberative'.");
  }
  if (!isRecord(raw.stopAt)) throw new Error("'executable.stopAt' debe ser un objeto.");
  const stopStage = asStageName(raw.stopAt.stage);
  if (!stopStage) throw new Error(`'executable.stopAt.stage' inválido: '${String(raw.stopAt.stage)}'.`);
  const occurrence = raw.stopAt.occurrence === undefined ? undefined : typeof raw.stopAt.occurrence === "number" ? raw.stopAt.occurrence : (() => { throw new Error("'executable.stopAt.occurrence' debe ser numérico."); })();
  const files = parseStringRecord(raw.files, "executable.files");
  const now = raw.now === undefined ? undefined : typeof raw.now === "string" ? raw.now : (() => { throw new Error("'executable.now' debe ser string ISO."); })();
  const previousTask = isRecord(raw.previousTask) && typeof raw.previousTask.request === "string" && typeof raw.previousTask.answer === "string"
    ? { request: raw.previousTask.request, answer: raw.previousTask.answer }
    : undefined;
  const memory = Array.isArray(raw.memory)
    ? raw.memory
        .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.key === "string" && typeof m.value === "string")
        .map((m) => ({
          key: String(m.key),
          value: String(m.value),
          ...(typeof m.source === "string" ? { source: m.source } : {}),
        }))
    : undefined;
  const script = isRecord(raw.script) ? (raw.script satisfies ExecutableStopSpec["script"]) : undefined;
  return {
    request: raw.request,
    mode: raw.mode,
    stopAt: { stage: stopStage, ...(occurrence !== undefined ? { occurrence } : {}) },
    ...(files !== undefined ? { files } : {}),
    ...(previousTask !== undefined ? { previousTask } : {}),
    ...(memory !== undefined ? { memory } : {}),
    ...(now !== undefined ? { now } : {}),
    ...(script !== undefined ? { script } : {}),
  };
}

function parseRealStageSpec(raw: Record<string, unknown>): RealStageSpec {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error("falta 'id'.");
  }
  const stage = raw.stage === undefined ? undefined : asStageName(raw.stage) ?? (() => { throw new Error(`stage inválido '${String(raw.stage)}'.`); })();
  const tags = parseStringArray(raw.tags, "tags");
  const isRaw = raw.isRaw === undefined ? undefined : typeof raw.isRaw === "boolean" ? raw.isRaw : (() => { throw new Error("'isRaw' debe ser booleano."); })();
  const expect = raw.expect === undefined ? undefined : isRecord(raw.expect) ? raw.expect : (() => { throw new Error("'expect' debe ser un objeto."); })();
  const target = parseTarget(raw.target);

  const base: RealStageSpecBase = {
    id: raw.id,
    ...(stage !== undefined ? { stage } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(isRaw !== undefined ? { isRaw } : {}),
    ...(expect !== undefined ? { expect } : {}),
    ...(target !== undefined ? { target } : {}),
  };

  if (raw.kind === "trace") {
    if (typeof raw.tracePath !== "string" || raw.tracePath.length === 0) {
      throw new Error("kind='trace' requiere 'tracePath'.");
    }
    const seq = raw.seq === undefined ? undefined : typeof raw.seq === "number" ? raw.seq : (() => { throw new Error("'seq' debe ser numérico."); })();
    const atN = raw.atN === undefined ? undefined : typeof raw.atN === "number" ? raw.atN : (() => { throw new Error("'atN' debe ser numérico."); })();
    return { ...base, kind: "trace", tracePath: raw.tracePath, ...(seq !== undefined ? { seq } : {}), ...(atN !== undefined ? { atN } : {}) };
  }
  if (raw.kind === "frozen") {
    if (!isRecord(raw.snapshot)) throw new Error("kind='frozen' requiere 'snapshot' objeto.");
    return { ...base, kind: "frozen", snapshot: raw.snapshot };
  }
  if (raw.kind === "executable") {
    return { ...base, kind: "executable", executable: parseExecutableStopSpec(raw.executable) };
  }
  throw new Error("'kind' debe ser 'trace', 'frozen' o 'executable'.");
}

function isTracePath(p: string): boolean {
  const name = basename(p);
  return name === "trace.json" || name === "full.json" || name === "full.json.gz";
}

function walkRealStageFiles(dir: string, maxDepth = Infinity): string[] {
  const out: string[] = [];
  const visit = (d: string, depth: number): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = d === "." ? entry.name : `${d}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git" && depth < maxDepth) visit(full, depth + 1);
      } else if (entry.isFile()) {
        if (full.endsWith(".jsonl") || isTracePath(full)) out.push(full);
      }
    }
  };
  visit(normalizePath(dir).replace(/\/+$/, "") || ".", 0);
  return out;
}

export function resolveRealStageSpecs(specs: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (p: string): void => {
    const norm = normalizePath(p);
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  };

  for (const rawSpec of specs) {
    const trimmed = normalizePath(rawSpec.trim());
    if (!trimmed) continue;
    if (isGlob(trimmed)) {
      const base = globBaseDir(trimmed);
      if (!existsSync(base) || !statSync(base).isDirectory()) {
        throw new Error(`Glob '${rawSpec}': el directorio base '${base}' no existe.`);
      }
      const maxDepth = trimmed.includes("**") ? Infinity : trimmed.split("/").length - (base === "." ? 0 : base.split("/").length) - 1;
      const matches = walkRealStageFiles(base, maxDepth).filter((f) => matchGlob(trimmed, f)).sort();
      if (matches.length === 0) throw new Error(`Glob '${rawSpec}' no coincide con ningún archivo .jsonl o traza.`);
      matches.forEach(add);
    } else if (existsSync(trimmed)) {
      if (statSync(trimmed).isDirectory()) {
        // Si es una carpeta de tarea individual (`full.json.gz` / `trace.json` adentro), se trata como una traza.
        if (existsSync(`${trimmed}/full.json.gz`) || existsSync(`${trimmed}/full.json`) || existsSync(`${trimmed}/trace.json`)) {
          add(trimmed);
        } else {
          const files = walkRealStageFiles(trimmed).sort();
          if (files.length === 0) throw new Error(`La carpeta '${rawSpec}' no contiene archivos .jsonl ni trazas.`);
          files.forEach(add);
        }
      } else {
        add(trimmed);
      }
    } else {
      throw new Error(`No existe '${rawSpec}' para --source=real-stage.`);
    }
  }
  return result;
}

async function resolveCapture(spec: RealStageSpec, specDir: string): Promise<FrozenStageCapture> {
  if (spec.kind === "trace") {
    const resolvedTrace = existsSync(spec.tracePath) ? spec.tracePath : resolve(specDir, spec.tracePath);
    return reconstructStageFromTrace(resolvedTrace, { seq: spec.seq, atN: spec.atN, stage: spec.stage }, spec.target ?? {});
  }
  if (spec.kind === "frozen") {
    if (!spec.stage) throw new Error(`${spec.id}: kind='frozen' requiere 'stage'.`);
    return {
      stage: spec.stage,
      snapshot: parseMigratedSnapshot(spec.snapshot),
      target: spec.target ?? {},
      sourceInfo: { kind: "snapshot" },
    };
  }
  if (spec.kind === "executable") {
    const captured = await captureExecutableScenario(spec.executable);
    if (spec.target) {
      return { ...captured, target: { ...captured.target, ...spec.target } };
    }
    return captured;
  }
  throw new Error(`kind desconocido en real-stage spec: '${String((spec as Record<string, unknown>).kind)}'.`);
}

function datasetDisplayName(path: string): string {
  const clean = normalizePath(path).replace(/\/+$/, "");
  if (existsSync(clean) && statSync(clean).isDirectory()) return basename(clean);
  if (clean.endsWith(".json.gz")) return basename(clean, ".json.gz");
  return basename(clean, extname(clean));
}

/**
 * Carga archivos real-stage (`.jsonl` o trazas crudas cuando `allowRawDryRun=true`),
 * los materializa con `variant` y devuelve `Dataset[]` estándar.
 */
export async function loadRealStageDatasets(
  specs: string[],
  filters: CaseFilters = {},
  variant?: Variant,
  allowRawDryRun = false,
): Promise<Dataset[]> {
  const paths = resolveRealStageSpecs(specs);
  const errors: string[] = [];
  const datasets: Dataset[] = [];

  for (const p of paths) {
    const isDir = existsSync(p) && statSync(p).isDirectory();
    if (isDir || isTracePath(p)) {
      const trace = loadTraceFile(p);
      const hash = createHash("sha256").update(trace.path + ":" + trace.snapshot.task.id).digest("hex").slice(0, 16);
      const cases: Case[] = [];
      for (const q of trace.queries) {
        const stage = stageIdToEvalStage(q.stage);
        if (filters.stages && filters.stages.length > 0 && !filters.stages.includes(stage)) continue;
        if (!allowRawDryRun) {
          errors.push(`${trace.path}: una traza suelta sin archivo .jsonl de especificación (y 'expect') solo puede inspeccionarse con --dry-run.`);
          break;
        }
        const capture = reconstructStageFromTrace(trace, { seq: q.seq });
        const mat = materializeRealStage(capture, variant);
        cases.push({
          id: `${trace.snapshot.task.id}_seq${q.seq}_${stage}`,
          stage,
          request: mat.request,
          expect: {},
          tags: ["real_trace"],
          ...(mat.toolSchema ? { meta: { toolSchema: mat.toolSchema, toolName: mat.toolName, environment: mat.environment, precheck: mat.precheck } } : {}),
        });
      }
      datasets.push({ name: datasetDisplayName(p), path: trace.path, hash, cases: filterCases(cases, filters) });
      continue;
    }

    const content = readFileSync(p, "utf8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const specDir = dirname(resolve(p));
    const cases: Case[] = [];
    const idLines = new Map<string, number>();

    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch (e) {
        errors.push(`${p}:${lineNo}: JSON inválido (${e instanceof Error ? e.message : String(e)}).`);
        continue;
      }
      if (!isRecord(raw)) {
        errors.push(`${p}:${lineNo}: la línea debe ser un objeto JSON.`);
        continue;
      }

      let spec: RealStageSpec;
      try {
        spec = parseRealStageSpec(raw);
      } catch (e) {
        errors.push(`${p}:${lineNo}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      let capture: FrozenStageCapture;
      try {
        capture = await resolveCapture(spec, specDir);
      } catch (e) {
        errors.push(`${p}:${lineNo}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const mat = materializeRealStage(capture, variant);
      const rawCase = {
        id: spec.id,
        stage: capture.stage,
        ...(spec.tags ? { tags: spec.tags } : {}),
        ...(spec.isRaw !== undefined ? { isRaw: spec.isRaw } : {}),
        request: mat.request,
        expect: spec.expect ?? {},
        ...(mat.toolSchema ? { meta: { toolSchema: mat.toolSchema, toolName: mat.toolName, environment: mat.environment, precheck: mat.precheck } } : {}),
      };

      if (allowRawDryRun && spec.expect === undefined) {
        cases.push({
          id: spec.id,
          stage: capture.stage,
          ...(spec.tags ? { tags: spec.tags } : {}),
          ...(spec.isRaw !== undefined ? { isRaw: spec.isRaw } : {}),
          request: mat.request,
          expect: {},
          ...(mat.toolSchema ? { meta: { toolSchema: mat.toolSchema, toolName: mat.toolName, environment: mat.environment, precheck: mat.precheck } } : {}),
        });
        continue;
      }

      const v = validateCase(rawCase);
      if (!v.ok) {
        for (const msg of v.errors) errors.push(`${p}:${lineNo}: ${msg}`);
        continue;
      }

      const prevLine = idLines.get(v.case.id);
      if (prevLine !== undefined) {
        errors.push(`${p}:${lineNo}: id '${v.case.id}' duplicado (línea ${prevLine}).`);
        continue;
      }
      idLines.set(v.case.id, lineNo);
      cases.push(v.case);
    }

    datasets.push({
      name: datasetDisplayName(p),
      path: p,
      hash,
      cases: filterCases(cases, filters),
    });
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));

  if (filters.ids && filters.ids.length > 0) {
    const known = new Set(datasets.flatMap((d) => d.cases.map((c) => c.id)));
    const unknown = filters.ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`--ids: no existe ningún caso con id ${unknown.map((i) => `'${i}'`).join(", ")}.`);
    }
  }

  return datasets;
}

export function deriveStageListFromReal(datasets: Dataset[]): StageName[] {
  const seen = new Set<StageName>();
  for (const ds of datasets) {
    for (const c of ds.cases) seen.add(c.stage as StageName);
  }
  return [...seen];
}
