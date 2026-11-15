/**
 * eval/real/reconstructTrace.ts
 *
 * Lee trazas reales (`trace.json`, `full.json`, `full.json.gz` o carpeta de tarea) y reconstruye
 * un snapshot invariante-válido (`parseSnapshot`) justo antes de la consulta objetivo (`seq` o `atN`),
 * extrayendo el `StageTarget` con los datos reales de esa etapa.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Call, ContextData, ErrorEntry, Fact, JsonObject, JsonValue, Plan, Ref, SectionName, Step } from "../../src/core/ctx/index.ts";

const PREFIX_SECTION: Record<string, SectionName> = {
  p: "plans",
  s: "steps",
  c: "calls",
  e: "errors",
  r: "refs",
};

function parseId(id: string): { section: SectionName; index: number } | null {
  const m = /^([pscer])(\d+)$/.exec(id);
  if (!m) return null;
  const section = PREFIX_SECTION[m[1]];
  return section ? { section, index: Number(m[2]) } : null;
}

function toJsonValue(v: unknown): JsonValue {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (typeof v === "object") {
    const out: JsonObject = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = toJsonValue(val);
    }
    return out;
  }
  return String(v);
}

function toJsonObject(obj: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = toJsonValue(val);
  }
  return out;
}
import { EXECUTABLE_ROUTES, isExecutableRoute } from "../../src/core/types/routes.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import type { StageId } from "../../src/core/types/stages.ts";
import type { ProbeQuery } from "../../src/core/contracts.ts";
import { parseJsonObject } from "../../src/core/models/qwen.ts";
import type { StageName } from "../core/types.ts";
import { migrateSnapshot, parseMigratedSnapshot } from "./migrateSnapshot.ts";
import type { FrozenStageCapture, StageTarget } from "./types.ts";

export interface TraceQueryRecord {
  seq: number;
  stage: string;
  step: string | null;
  n: number;
  startedAt: number;
  link: {
    call: string | null;
    plan: string | null;
    fact: string | null;
    result: boolean;
  };
  offered?: string[] | null;
  input?: string | null;
  output?: unknown;
}

export interface LoadedTrace {
  kind: "full" | "slim";
  path: string;
  snapshot: ContextData;
  queries: TraceQueryRecord[];
  tools: Array<{
    call: string | null;
    mcp: string;
    tool: string;
    args: Record<string, unknown>;
    startedAt: number;
  }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const STAGE_TO_EVAL: Record<StageId, StageName> = {
  first_query: "d0",
  continuation: "continuation",
  pending: "pending",
  plan: "plan",
  route: "route",
  tool: "tool_choice",
  args: "arguments",
  review: "args_review",
  verify: "result_verification",
  probe: "probe",
  completion: "completion",
  question: "question",
  final: "final",
  fragment_judge: "fragment_judge",
};

const EVAL_TO_STAGE: Record<StageName, StageId> = {
  d0: "first_query",
  continuation: "continuation",
  pending: "pending",
  plan: "plan",
  route: "route",
  tool_choice: "tool",
  arguments: "args",
  args_review: "review",
  result_verification: "verify",
  probe: "probe",
  completion: "completion",
  question: "question",
  final: "final",
  fragment_judge: "fragment_judge",
};

export function stageIdToEvalStage(stage: string): StageName {
  if (Object.hasOwn(STAGE_TO_EVAL, stage)) return STAGE_TO_EVAL[stage as StageId];
  if (Object.hasOwn(EVAL_TO_STAGE, stage)) return stage as StageName;
  throw new Error(`Etapa de traza desconocida: '${stage}'.`);
}

export function evalStageToStageId(stage: StageName): StageId {
  return EVAL_TO_STAGE[stage];
}

export function resolveTraceFilePath(specPath: string): string {
  const abs = resolve(specPath);
  if (!existsSync(abs)) {
    throw new Error(`No existe la traza '${specPath}'.`);
  }
  if (statSync(abs).isDirectory()) {
    for (const candidate of ["full.json.gz", "full.json", "trace.json"]) {
      const p = join(abs, candidate);
      if (existsSync(p)) return p;
    }
    throw new Error(`La carpeta '${specPath}' no contiene full.json.gz, full.json ni trace.json.`);
  }
  return abs;
}

export function loadTraceFile(specPath: string): LoadedTrace {
  const filePath = resolveTraceFilePath(specPath);
  const rawBytes = readFileSync(filePath);
  const jsonText = filePath.endsWith(".gz") ? gunzipSync(rawBytes).toString("utf8") : rawBytes.toString("utf8");
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed)) {
    throw new Error(`Traza inválida en '${filePath}': se esperaba un objeto JSON.`);
  }

  const snapshot = parseMigratedSnapshot(parsed.snapshot);
  const rawQueries = parsed.kind === "full" || Array.isArray(parsed.models) ? parsed.models : parsed.queries;
  if (!Array.isArray(rawQueries)) {
    throw new Error(`Traza inválida en '${filePath}': falta 'models' o 'queries'.`);
  }

  const queries: TraceQueryRecord[] = rawQueries
    .filter(isRecord)
    .map((q) => {
      const linkObj = isRecord(q.link) ? q.link : {};
      return {
        seq: Number(q.seq ?? 0),
        stage: String(q.stage ?? ""),
        step: typeof q.step === "string" ? q.step : null,
        n: Number(q.n ?? 0),
        startedAt: Number(q.startedAt ?? 0),
        link: {
          call: typeof linkObj.call === "string" ? linkObj.call : null,
          plan: typeof linkObj.plan === "string" ? linkObj.plan : null,
          fact: typeof linkObj.fact === "string" ? linkObj.fact : null,
          result: linkObj.result === true,
        },
        offered: Array.isArray(q.offered) ? q.offered.filter((x): x is string => typeof x === "string") : null,
        input: typeof q.input === "string" ? q.input : null,
        output: q.output,
      };
    });

  const rawTools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const tools = rawTools
    .filter(isRecord)
    .map((t) => ({
      call: typeof t.call === "string" ? t.call : null,
      mcp: String(t.mcp ?? ""),
      tool: String(t.tool ?? ""),
      args: isRecord(t.args) ? t.args : {},
      startedAt: Number(t.startedAt ?? 0),
    }));

  return {
    kind: parsed.kind === "slim" ? "slim" : "full",
    path: filePath,
    snapshot,
    queries,
    tools,
  };
}

function parseJsonString(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function contiguousPrefix<T>(items: readonly T[], keep: (item: T) => boolean): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (!keep(item)) break;
    out.push(item);
  }
  return out;
}

/**
 * Reconstruye el `ContextData` al momento exacto de la consulta `query`.
 * Preserva las invariantes de `parseSnapshot` (solo un paso vigente `running`, refs/calls/steps contiguos).
 */
export function reconstructSnapshotAtQuery(snapshot: ContextData, query: TraceQueryRecord): ContextData {
  const evalStage = stageIdToEvalStage(query.stage);
  const cutoffMs = query.startedAt;

  // 1. Planes existentes antes de la consulta (ids 1-based: p1, p2...).
  let plans: Plan[];
  if (evalStage === "plan" && query.link.plan !== null) {
    const parsedPlan = parseId(query.link.plan);
    const stopIdx = parsedPlan?.section === "plans" ? Math.max(0, parsedPlan.index - 1) : snapshot.plans.length;
    plans = snapshot.plans.slice(0, stopIdx);
  } else {
    plans = contiguousPrefix(snapshot.plans, (p) => p.at <= cutoffMs);
  }
  const keptPlanIds = new Set(plans.map((p) => p.id));

  // 2. Pasos pertenecientes a planes conservados (o reactivo hasta query.step / timestamp).
  const activeStepParsed = query.step ? parseId(query.step) : null;
  const activeStepIdx = activeStepParsed?.section === "steps" ? activeStepParsed.index : null;
  let steps: Step[] = contiguousPrefix(snapshot.steps, (s) => {
    if (s.planId !== null && !keptPlanIds.has(s.planId)) return false;
    if (snapshot.task.mode === "reactive" && activeStepIdx !== null) {
      const p = parseId(s.id);
      if (p && p.index > activeStepIdx) return false;
    }
    return s.at <= cutoffMs;
  });

  // 3. Llamadas existentes al iniciar la consulta (ids 1-based: c1, c2...).
  let callCutoff = snapshot.calls.length;
  const linkedCallParsed = query.link.call ? parseId(query.link.call) : null;
  if (linkedCallParsed?.section === "calls") {
    if (evalStage === "result_verification" || evalStage === "probe") {
      callCutoff = linkedCallParsed.index;
    } else {
      callCutoff = Math.max(0, linkedCallParsed.index - 1);
    }
  } else {
    callCutoff = contiguousPrefix(snapshot.calls, (c) => c.at <= cutoffMs).length;
  }

  const keptStepIds = new Set(steps.map((s) => s.id));
  const rawCalls = contiguousPrefix(
    snapshot.calls.slice(0, callCutoff),
    (c) =>
      keptStepIds.has(c.stepId) &&
      (c.at <= cutoffMs ||
        (query.link.call !== null && c.id === query.link.call && (evalStage === "result_verification" || evalStage === "probe"))),
  );

  // En verify / probe la llamada evaluada aún no recibió veredicto definitivo.
  const calls: Call[] = rawCalls.map((c) => {
    if ((evalStage === "result_verification" || evalStage === "probe") && query.link.call !== null && c.id === query.link.call) {
      return { ...c, verdict: null, reason: null };
    }
    return c;
  });

  // 4. Refs referenciadas por llamadas conservadas (ids 1-based: r1, r2... → prefijo contiguo).
  let maxRefCount = 0;
  for (const c of calls) {
    if (c.ref !== null) {
      const parsed = parseId(c.ref);
      if (parsed?.section === "refs") maxRefCount = Math.max(maxRefCount, parsed.index);
    }
  }
  const refs: Ref[] = snapshot.refs.slice(0, maxRefCount).filter((r) => keptStepIds.has(r.stepId));

  // 5. Errores ocurridos hasta `cutoffMs` sobre pasos conservados (prefijo contiguo).
  const errors: ErrorEntry[] = contiguousPrefix(snapshot.errors, (e) => e.at <= cutoffMs && keptStepIds.has(e.stepId));

  // 6. Hechos hasta `cutoffMs`, excluyendo la respuesta generada por `question`.
  const facts: Record<string, Fact> = {};
  for (const [k, f] of Object.entries(snapshot.facts)) {
    if (!keptStepIds.has(f.stepId)) continue;
    if (evalStage === "question" && query.link.fact === k) continue;
    if (f.at <= cutoffMs) facts[k] = f;
  }

  // 7. Reparación de estados de pasos y tarea para respetar invariantes de `parseSnapshot`.
  const isFinal = evalStage === "final";
  if (!isFinal) {
    const activePlanId = plans.length > 0 ? plans[plans.length - 1].id : null;
    let foundRunning = false;
    steps = steps.map((s) => {
      const isSuperseded = activePlanId !== null && s.planId !== null && s.planId !== activePlanId;
      if (query.step !== null && s.id === query.step) {
        foundRunning = true;
        return { ...s, state: "running", superseded: false };
      }
      if (isSuperseded) {
        return { ...s, state: s.state === "completed" ? "failed" : s.state === "running" ? "failed" : s.state, superseded: true };
      }
      if (query.step !== null && activeStepIdx !== null) {
        const p = parseId(s.id);
        if (p && p.index > activeStepIdx) {
          return { ...s, state: "pending" };
        }
      }
      if (s.state === "running") {
        if (foundRunning) return { ...s, state: "pending" };
        foundRunning = true;
      }
      return s;
    });
  }

  const reconstructedRaw: Record<string, unknown> = {
    v: snapshot.v,
    task: isFinal ? snapshot.task : { ...snapshot.task, state: "running", stopReason: null },
    plans,
    steps,
    calls,
    errors,
    facts,
    refs,
    result: null,
  };

  return parseMigratedSnapshot(reconstructedRaw);
}

function extractPendingOutput(q: TraceQueryRecord): string[] | null {
  if (typeof q.output === "string") {
    const obj = parseJsonObject(q.output);
    const choices = isRecord(obj) && Array.isArray(obj.choices) ? obj.choices : null;
    if (choices && isRecord(choices[0]) && isRecord(choices[0].message) && typeof choices[0].message.content === "string") {
      const inner = parseJsonObject(choices[0].message.content);
      if (inner && Array.isArray(inner.pending) && inner.pending.every((x): x is string => typeof x === "string")) {
        return inner.pending;
      }
    }
    if (obj && Array.isArray(obj.pending) && obj.pending.every((x): x is string => typeof x === "string")) {
      return obj.pending;
    }
  } else if (isRecord(q.output) && Array.isArray(q.output.pending) && q.output.pending.every((x): x is string => typeof x === "string")) {
    return q.output.pending;
  }
  return null;
}

/** Extrae el `StageTarget` real desde la consulta y la traza sin inventar campos sintéticos. */
export function extractStageTarget(trace: LoadedTrace, query: TraceQueryRecord, reconstructed: ContextData): StageTarget {
  const evalStage = stageIdToEvalStage(query.stage);
  const rawInput = parseJsonString(query.input);
  const questions = rawInput && isRecord(rawInput.questions) ? rawInput.questions : null;
  const target: StageTarget = {};

  if (evalStage === "route") {
    const offered =
      query.offered ??
      (questions && isRecord(questions.route) && isRecord(questions.route.criteria) ? Object.keys(questions.route.criteria) : null);
    if (offered) {
      target.routes = offered.filter((r): r is ExecutableRoute => isExecutableRoute(r));
    } else {
      target.routes = [...EXECUTABLE_ROUTES];
    }
  }

  if (evalStage === "tool_choice") {
    const linkedCall = query.link.call ? trace.snapshot.calls.find((c) => c.id === query.link.call) : undefined;
    if (linkedCall && isExecutableRoute(linkedCall.route)) {
      target.route = linkedCall.route;
    }
    const offered =
      query.offered ??
      (questions && isRecord(questions.selected_tool) && isRecord(questions.selected_tool.criteria)
        ? Object.keys(questions.selected_tool.criteria)
        : null);
    if (offered) target.tools = offered;
  }

  if (evalStage === "arguments" || evalStage === "args_review") {
    const linkedCall = query.link.call ? trace.snapshot.calls.find((c) => c.id === query.link.call) : undefined;
    const toolExec = query.link.call ? trace.tools.find((t) => t.call === query.link.call) : undefined;
    if (linkedCall && isExecutableRoute(linkedCall.route)) {
      target.route = linkedCall.route;
      target.tool = linkedCall.tool;
      if (evalStage === "args_review") target.args = linkedCall.args ?? {};
    } else if (toolExec) {
      target.tool = toolExec.tool;
      if (evalStage === "args_review") target.args = toJsonObject(toolExec.args);
    } else {
      // Si la llamada falló antes de registrarse o no quedó enlazada, buscamos la elección de herramienta inmediatamente previa.
      const prevTool = [...trace.queries].reverse().find((q) => q.seq < query.seq && stageIdToEvalStage(q.stage) === "tool_choice" && q.step === query.step);
      if (prevTool) {
        const chosen = isRecord(prevTool.output)
          ? (isRecord(prevTool.output.selected_tool) ? prevTool.output.selected_tool.choice : undefined)
          : undefined;
        if (typeof chosen === "string") target.tool = chosen;
      }
      const prevRoute = [...trace.queries].reverse().find((q) => q.seq < query.seq && stageIdToEvalStage(q.stage) === "route" && q.step === query.step);
      if (prevRoute) {
        const chosen = isRecord(prevRoute.output)
          ? (isRecord(prevRoute.output.route) ? prevRoute.output.route.choice : undefined)
          : undefined;
        if (typeof chosen === "string" && isExecutableRoute(chosen)) target.route = chosen;
      }
    }
  }

  if (evalStage === "result_verification") {
    if (query.link.call) target.callId = query.link.call;
  }

  if (evalStage === "probe") {
    if (query.link.call) target.callId = query.link.call;
    if (rawInput && typeof rawInput.state === "string" && questions && isRecord(questions.probe)) {
      const p = questions.probe;
      const crit = isRecord(p.criteria) ? p.criteria : {};
      if (typeof p.instructions === "string" && typeof crit.true === "string" && typeof crit.false === "string") {
        const pq: ProbeQuery = {
          state: rawInput.state,
          question: {
            instructions: p.instructions,
            criteria: { true: crit.true, false: crit.false },
          },
        };
        target.probeQuery = pq;
      }
    }
  }

  if (evalStage === "plan") {
    const linkedPlan = query.link.plan ? trace.snapshot.plans.find((p) => p.id === query.link.plan) : undefined;
    if (linkedPlan) target.feedback = linkedPlan.feedback;
  }

  if (evalStage === "pending") {
    const prevPending = [...trace.queries]
      .reverse()
      .find((q) => q.seq < query.seq && stageIdToEvalStage(q.stage) === "pending");
    target.previous = prevPending ? (extractPendingOutput(prevPending) ?? []) : [];
  }

  if (evalStage === "continuation" && rawInput && typeof rawInput.state === "string") {
    const m = /^Previous request:\s*(.*)\nPrevious answer:\s*([\s\S]*?)\nNew request:/m.exec(rawInput.state);
    if (m) {
      target.previousTask = { request: m[1].trim(), answer: m[2].trim() };
    }
  }

  if (evalStage === "fragment_judge" && rawInput && typeof rawInput.state === "string" && questions) {
    const needMatch = /^QUESTION:\s*([\s\S]*)$/.exec(rawInput.state);
    if (needMatch) target.need = needMatch[1].trim();
    const fragments: string[] = [];
    for (let i = 0; ; i++) {
      const q = questions[`f${i}`];
      if (!isRecord(q) || typeof q.instructions !== "string") break;
      const body = /"""\n([\s\S]*?)\n"""/.exec(q.instructions);
      fragments.push(body ? body[1] : q.instructions);
    }
    if (fragments.length > 0) target.fragments = fragments;
  }

  // Preservamos la fecha original de la consulta cuando existe.
  if (query.startedAt > 0) target.now = query.startedAt;
  else if (reconstructed.task.startedAt > 0) target.now = reconstructed.task.startedAt;

  return target;
}

export function selectTraceQuery(
  trace: LoadedTrace,
  selector: { seq?: number; atN?: number; stage?: StageName },
): TraceQueryRecord {
  if (selector.seq !== undefined) {
    const bySeq = trace.queries.find((q) => q.seq === selector.seq);
    if (!bySeq) throw new Error(`No existe ninguna consulta con seq=${selector.seq} en '${trace.path}'.`);
    if (selector.stage !== undefined && stageIdToEvalStage(bySeq.stage) !== selector.stage) {
      throw new Error(`La consulta seq=${selector.seq} es '${stageIdToEvalStage(bySeq.stage)}', no '${selector.stage}'.`);
    }
    return bySeq;
  }

  let candidates = trace.queries;
  if (selector.atN !== undefined) {
    candidates = candidates.filter((q) => q.n === selector.atN);
    if (candidates.length === 0) {
      throw new Error(`No existe ninguna consulta en n=${selector.atN} en '${trace.path}'.`);
    }
  }
  if (selector.stage !== undefined) {
    const stageId = evalStageToStageId(selector.stage);
    candidates = candidates.filter((q) => q.stage === stageId || stageIdToEvalStage(q.stage) === selector.stage);
    if (candidates.length === 0) {
      throw new Error(`No existe ninguna consulta de la etapa '${selector.stage}' en '${trace.path}'.`);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`La traza '${trace.path}' no contiene consultas a modelos.`);
  }
  return candidates[0];
}

export function reconstructStageFromTrace(
  traceOrPath: LoadedTrace | string,
  selector: { seq?: number; atN?: number; stage?: StageName } = {},
  overrides: StageTarget = {},
): FrozenStageCapture {
  const trace = typeof traceOrPath === "string" ? loadTraceFile(traceOrPath) : traceOrPath;
  const query = selectTraceQuery(trace, selector);
  const evalStage = selector.stage ?? stageIdToEvalStage(query.stage);
  const snapshot = reconstructSnapshotAtQuery(trace.snapshot, query);
  const extracted = extractStageTarget(trace, query, snapshot);

  return {
    stage: evalStage,
    snapshot,
    target: { ...extracted, ...overrides },
    sourceInfo: {
      kind: "trace",
      tracePath: trace.path,
      seq: query.seq,
      n: query.n,
    },
  };
}
