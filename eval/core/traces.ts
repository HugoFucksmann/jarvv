/**
 * eval/core/traces.ts
 *
 * Conversor de carpetas reales de `jarvis-traces/` (`trace.json` + opcional `full.json.gz`) a casos JSONL de `eval/`.
 * Reconstruye el escenario hasta el instante de cada consulta respetando las invariantes de `TaskContext`, genera un
 * `expect` borrador (etiquetado con `trace_draft` y `needs_review` para revisión humana) y valida cada caso contra
 * `materializeScenario` + `validateCase` antes de emitirlo.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { validateCase } from "./case.ts";
import {
  ARGS_REVIEWS,
  COMPLETION_APPROVE,
  CONTINUATION_APPROVE,
  EXECUTABLE_ROUTES,
  FIRST_QUERY_KINDS,
  NOUL_APPROVE,
  OK_APPROVE,
  RECOVERY_ACTIONS,
  STEP_FAILURE_CAUSES,
  SYSTEM_TOOL_MANIFEST,
  firstQueryKind,
  isExecutableRoute,
  isRecord,
} from "./contract.ts";
import type {
  CallStatus,
  ContextData,
  ExecutableRoute,
  JsonObject,
  StepFailureCause,
  StopReason,
  TerminalTaskState,
  ToolInputSchema,
  VerdictReason,
} from "./contract.ts";
import { materializeScenario } from "./scenario.ts";
import type { Scenario, ScenarioAt, ScenarioCall, ScenarioRecalled, ScenarioStep } from "./stages/types.ts";
import type { StageName } from "./types.ts";

// ───────────────────────── Tipos de traza ─────────────────────────

export interface TraceSlimQuery {
  seq: number;
  stage: string;
  step: string | null;
  n: number;
  startedAt: number;
  durationMs?: number;
  model?: string | null;
  offered?: string[] | null;
  output?: unknown;
  error?: string | null;
  link?: {
    call?: string | null;
    plan?: string | null;
    fact?: string | null;
    result?: boolean;
  };
  inputHash?: string | null;
}

export interface TraceSlimTool {
  call: string | null;
  mcp?: string;
  tool: string;
  args?: Record<string, unknown>;
  resultHead?: string | null;
  ref?: string | null;
  error?: string | null;
}

export interface TraceMeta {
  formatVersion?: number;
  gitSha?: string | null;
  environment?: Record<string, string> | null;
  toolSchemas?: Record<string, unknown>;
}

export interface TraceSlimFile {
  taskId?: string;
  meta?: TraceMeta;
  snapshot: ContextData;
  queries: TraceSlimQuery[];
  tools?: TraceSlimTool[];
}

export interface FullModelRecord {
  seq: number;
  stage: string;
  step?: string | null;
  n?: number;
  input: string | null;
  output?: string | null;
}

export interface TraceFullFile {
  models?: FullModelRecord[];
}

export interface TraceBundle {
  folder: string;
  tracePath: string;
  slim: TraceSlimFile;
  full?: TraceFullFile;
}

// ───────────────────────── Opciones y resultado ─────────────────────────

export interface ConvertTracesOptions {
  inputPath: string;
  outPath?: string;
  stages?: StageName[];
  taskFilters?: string[];
  limit?: number;
  dedupe?: boolean;
  anonymize?: boolean;
  useFull?: boolean;
  dryRun?: boolean;
}

export interface ConvertedTraceCase {
  id: string;
  stage: StageName;
  tags: string[];
  description: string;
  scenario: Scenario;
  expect: Record<string, unknown>;
  meta?: { origin: { id: string; commit?: string } };
}

export interface SkippedTraceQuery {
  taskId: string;
  seq: number;
  traceStage: string;
  reason: string;
}

export interface ConvertTracesResult {
  filesScanned: number;
  queriesSeen: number;
  cases: ConvertedTraceCase[];
  byStage: Record<string, number>;
  skipped: SkippedTraceQuery[];
  writtenFiles: string[];
}

// ───────────────────────── Mapeo de etapas ─────────────────────────

const TRACE_TO_EVAL_STAGE: Record<string, StageName> = {
  first_query: "d0",
  d0: "d0",
  continuation: "continuation",
  route: "route",
  tool: "tool_choice",
  tool_choice: "tool_choice",
  review: "args_review",
  args_review: "args_review",
  verify: "result_verification",
  result_verification: "result_verification",
  completion: "d5",
  d5: "d5",
  recovery: "recovery",
  args: "arguments",
  arguments: "arguments",
  question: "question",
  plan: "plan",
  final: "final",
  pending: "pending",
};

export function mapTraceStage(stage: string): StageName | null {
  return TRACE_TO_EVAL_STAGE[stage] ?? null;
}

// ───────────────────────── Descubrimiento y lectura ─────────────────────────

export function discoverTraceFiles(inputPath: string): string[] {
  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    throw new Error(`No existe la ruta de trazas '${inputPath}'.`);
  }
  const st = statSync(abs);
  if (st.isFile()) {
    return [abs];
  }
  const direct = join(abs, "trace.json");
  if (existsSync(direct) && statSync(direct).isFile()) {
    return [direct];
  }
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const candidate = join(abs, entry.name, "trace.json");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      out.push(candidate);
    }
  }
  if (out.length === 0) {
    throw new Error(`No se encontraron archivos 'trace.json' en '${inputPath}'.`);
  }
  return out;
}

export function readTraceBundle(tracePath: string, useFull = true): TraceBundle {
  const rawSlim = JSON.parse(readFileSync(tracePath, "utf8")) as unknown;
  if (!isRecord(rawSlim) || !isRecord(rawSlim.snapshot) || !Array.isArray(rawSlim.queries)) {
    throw new Error(`Formato inválido en '${tracePath}': se esperaba { snapshot, queries }.`);
  }
  const dir = dirname(tracePath);
  const fullPath = join(dir, "full.json.gz");
  let full: TraceFullFile | undefined;
  if (useFull && existsSync(fullPath)) {
    try {
      const text = gunzipSync(readFileSync(fullPath)).toString("utf8");
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed)) full = parsed as TraceFullFile;
    } catch {
      // Si full.json.gz está corrupto, seguimos con trace.json.
    }
  }
  return {
    folder: basename(dir),
    tracePath,
    slim: rawSlim as unknown as TraceSlimFile,
    full,
  };
}

// ───────────────────────── Helpers de saneamiento y parseo ─────────────────────────

const ANON_WIN_RE = /([A-Za-z]:[\\/]+Users[\\/]+)([^\\/:\s"'<>|]+)/gi;
const ANON_LINUX_RE = /(\/home\/)([^/\s"'<>|]+)/g;

function sanitizeText(text: string, anonymize: boolean): string {
  if (!anonymize) return text;
  return text.replace(ANON_WIN_RE, "$1usuario").replace(ANON_LINUX_RE, "$1usuario");
}

function sanitizeJson<T>(value: T, anonymize: boolean): T {
  if (!anonymize) return value;
  if (typeof value === "string") return sanitizeText(value, true) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeJson(v, true)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeJson(v, true);
    return out as T;
  }
  return value;
}

function extractRawStateText(rawInput: string | null): string | null {
  if (!rawInput) return null;
  try {
    const parsed = JSON.parse(rawInput) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.state === "string") return parsed.state;
    if (Array.isArray(parsed.messages)) {
      for (const m of parsed.messages) {
        if (isRecord(m) && m.role === "user" && typeof m.content === "string") return m.content;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractEnvAndSchemaFromInput(
  rawState: string | null,
): { env?: Record<string, string>; tool?: string; schema?: ToolInputSchema } {
  if (!rawState) return {};
  const out: { env?: Record<string, string>; tool?: string; schema?: ToolInputSchema } = {};
  const envBlock = /ENV:\n<obs>\n([\s\S]*?)\n<\/obs>/.exec(rawState)?.[1];
  if (envBlock) {
    const env: Record<string, string> = {};
    for (const line of envBlock.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    if (Object.keys(env).length > 0) out.env = env;
  }
  const toolMatch = /TOOL:\s*([\w-]+)/.exec(rawState)?.[1];
  if (toolMatch) out.tool = toolMatch;
  const schemaText = /SCHEMA:\s*(.*)/.exec(rawState)?.[1];
  if (schemaText) {
    try {
      const parsed = JSON.parse(schemaText) as unknown;
      if (isRecord(parsed)) out.schema = parsed as ToolInputSchema;
    } catch {
      // ignorar schema no parseable
    }
  }
  return out;
}

function extractPendingListFromState(rawState: string | null): string[] | null {
  if (!rawState) return null;
  const match = /(?:^|\n)PENDING:\n([\s\S]*?)(?=\n[A-Z_ ]+:\n|\n###|$)/.exec(rawState);
  if (!match) return null;
  const block = match[1].replace(/^<obs>\n?/, "").replace(/\n?<\/obs>$/, "").trim();
  if (!block || block === "(empty)" || block === "(none)") return [];
  const items: string[] = [];
  for (const line of block.split("\n")) {
    const clean = line.replace(/^\s*(?:\d+\.|[-*])\s+/, "").trim();
    if (clean) items.push(clean);
  }
  return items;
}

function extractRecoveryBlock(rawState: string | null): { failed?: string; cause?: string; attempts?: number } {
  if (!rawState) return {};
  const block = /### THE STEP THAT JUST FAILED\n([\s\S]*)$/.exec(rawState)?.[1];
  if (!block) return {};
  const failed = /^Item:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const cause = /^Why it failed:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const attemptsStr = /^Attempts so far:\s*(\d+)$/m.exec(block)?.[1];
  const attempts = attemptsStr ? Number(attemptsStr) : undefined;
  return {
    failed,
    cause: cause && cause !== "unknown" ? cause : undefined,
    attempts,
  };
}

function extractThreadFromState(rawState: string | null): { previous_request?: string; previous_answer?: string } | null {
  if (!rawState) return null;
  const req = /^Previous request:\s*(.*)$/m.exec(rawState)?.[1];
  const ansMatch = /^Previous answer:\s*([\s\S]*?)(?=\nNew request:|$)/m.exec(rawState);
  const ans = ansMatch?.[1]?.trim();
  if (req === undefined && ans === undefined) return null;
  return {
    ...(req !== undefined ? { previous_request: req.trim() } : {}),
    ...(ans !== undefined ? { previous_answer: ans } : {}),
  };
}

function buildEnvironment(raw: Record<string, string> | null | undefined, anonymize: boolean): ScenarioAt["environment"] | undefined {
  if (!raw || typeof raw.home !== "string" || raw.home.trim() === "") return undefined;
  const clean = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? sanitizeText(v.trim(), anonymize) : undefined);
  const home = clean(raw.home);
  if (!home) return undefined;
  return {
    home,
    ...(clean(raw.desktop) ? { desktop: clean(raw.desktop) } : {}),
    ...(clean(raw.documents) ? { documents: clean(raw.documents) } : {}),
    ...(clean(raw.downloads) ? { downloads: clean(raw.downloads) } : {}),
  };
}

function noulProb(output: unknown, key: string): number | undefined {
  if (!isRecord(output)) return undefined;
  const entry = output[key];
  if (!isRecord(entry)) return undefined;
  return typeof entry.noul === "number" && Number.isFinite(entry.noul) ? entry.noul : undefined;
}

function choiceLabel(output: unknown, key: string): string | undefined {
  if (!isRecord(output)) return undefined;
  const entry = output[key];
  if (!isRecord(entry)) return undefined;
  return typeof entry.choice === "string" && entry.choice.length > 0 ? entry.choice : undefined;
}

function toolForRoute(toolName: string, routeHint?: string): ExecutableRoute | undefined {
  if (routeHint && isExecutableRoute(routeHint)) {
    const match = SYSTEM_TOOL_MANIFEST.find((t) => t.name === toolName && t.route === routeHint);
    if (match) return match.route;
  }
  const found = SYSTEM_TOOL_MANIFEST.find((t) => t.name === toolName);
  return found ? found.route : undefined;
}

function oneLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function safeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_");
}

// ───────────────────────── Reconstrucción de contexto ─────────────────────────

interface ReconstructedSlice {
  mode: "reactive" | "deliberative";
  steps: ScenarioStep[];
  calls: ScenarioCall[];
  facts: Record<string, string>;
  userInput: string[];
  recalled: ScenarioRecalled;
  evaluatedCallIndex?: number;
}

function sliceSnapshotForQuery(
  snapshot: ContextData,
  q: TraceSlimQuery,
  stage: StageName,
  anonymize: boolean,
  fullInput: string | null,
): ReconstructedSlice {
  const mode: "reactive" | "deliberative" = snapshot.task.mode === "deliberative" ? "deliberative" : "reactive";
  const allSteps = (snapshot.steps ?? []).filter((s) => !s.superseded);
  const allCalls = snapshot.calls ?? [];
  const allRefs = new Map((snapshot.refs ?? []).map((r) => [r.id, r]));

  const linkedCallId = q.link?.call ?? null;
  const linkedCallIdx = linkedCallId ? allCalls.findIndex((c) => c.id === linkedCallId) : -1;

  // Llamadas que existían ANTES del punto de decisión (salvo verify, que evalúa linkedCall).
  const candidateCalls = allCalls.filter((c, idx) => {
    if (stage === "result_verification" && linkedCallId) {
      return idx <= (linkedCallIdx >= 0 ? linkedCallIdx : idx) && c.at <= q.startedAt + 60_000;
    }
    if (linkedCallIdx >= 0) {
      return idx < linkedCallIdx;
    }
    return c.at <= q.startedAt;
  });

  // Pasos vigentes hasta q.step o q.startedAt.
  let activeStepIdx = q.step ? allSteps.findIndex((s) => s.id === q.step) : -1;
  if (activeStepIdx < 0 && linkedCallIdx >= 0) {
    const callStepId = allCalls[linkedCallIdx]?.stepId;
    if (callStepId) activeStepIdx = allSteps.findIndex((s) => s.id === callStepId);
  }
  const rawSteps = allSteps.filter((s, idx) => {
    if (activeStepIdx >= 0) {
      if (stage === "plan" && idx >= activeStepIdx) return false;
      return mode === "deliberative" ? true : idx <= activeStepIdx;
    }
    return s.at <= q.startedAt;
  });

  const keptSteps = rawSteps.length > 0 ? rawSteps : allSteps.slice(0, 1);
  const stepIndexById = new Map(keptSteps.map((s, idx) => [s.id, idx]));

  const filteredCalls = candidateCalls.filter((c) => stepIndexById.has(c.stepId));
  let evaluatedCallIndex: number | undefined;
  if (stage === "result_verification") {
    evaluatedCallIndex = linkedCallId ? filteredCalls.findIndex((c) => c.id === linkedCallId) : filteredCalls.length - 1;
    if (evaluatedCallIndex < 0 && filteredCalls.length > 0) evaluatedCallIndex = filteredCalls.length - 1;
  }

  const calls: ScenarioCall[] = filteredCalls.map((c) => {
    const stepIdx = stepIndexById.get(c.stepId)!;
    const rawRef = c.ref ? allRefs.get(c.ref) : undefined;
    const args: JsonObject | null =
      c.args === null ? (c.status === "args_invalid" ? null : {}) : sanitizeJson(c.args, anonymize);
    const out: ScenarioCall = {
      step: stepIdx,
      route: c.route,
      tool: c.tool,
      kind: c.kind === "write" ? "write" : "read",
      status: c.status as CallStatus,
      args,
      ...(c.summary !== null ? { summary: sanitizeText(c.summary, anonymize) } : {}),
      ...(c.verdict === "approved" || c.verdict === "rejected" ? { verdict: c.verdict } : {}),
      ...(c.verdict === "rejected" && c.reason ? { reason: c.reason as VerdictReason } : {}),
      ...(rawRef
        ? {
            ref: {
              label: rawRef.label,
              size: rawRef.size,
              where: sanitizeText(rawRef.where, anonymize),
            },
          }
        : {}),
    };
    return out;
  });

  // Ajustar estados de pasos respetando invariantes de `ctx.apply`.
  const settledStateFor = (sIdx: number, origState: ScenarioStep["state"]): ScenarioStep["state"] => {
    if (origState === "completed" || origState === "failed") return origState;
    const stepCalls = calls.filter((c) => c.step === sIdx);
    return stepCalls.some((c) => c.verdict === "approved") ? "completed" : "failed";
  };

  const isActiveCallStage =
    stage === "route" ||
    stage === "tool_choice" ||
    stage === "args_review" ||
    stage === "arguments" ||
    stage === "question" ||
    stage === "result_verification";

  const steps: ScenarioStep[] = keptSteps.map((s, idx) => {
    const isLast = idx === keptSteps.length - 1;
    const isCurrent = activeStepIdx >= 0 ? idx === activeStepIdx : isLast;
    let state: ScenarioStep["state"] = s.state;

    if (mode === "reactive") {
      if (isActiveCallStage && isCurrent && isLast) {
        state = "running";
      } else if (stage === "recovery" && isLast) {
        state = "failed";
      } else if (stage === "d5" || stage === "final" || stage === "pending" || !isLast) {
        state = settledStateFor(idx, s.state);
      }
    } else {
      if (isActiveCallStage && idx === activeStepIdx) state = "running";
      else if (activeStepIdx >= 0 && idx < activeStepIdx) state = settledStateFor(idx, s.state);
      else if (activeStepIdx >= 0 && idx > activeStepIdx) state = "pending";
    }

    return {
      ...(s.instruction !== null ? { instruction: sanitizeText(s.instruction, anonymize) } : {}),
      ...(mode === "deliberative" && s.route ? { route: s.route } : {}),
      ...(s.expected !== null ? { expected: sanitizeText(s.expected, anonymize) } : {}),
      state,
    };
  });

  // En `d5`, `ctx.canFinish()` exige que `calls` esté vacío o tenga al menos una llamada `approved`.
  if (stage === "d5" && calls.length > 0 && !calls.some((c) => c.verdict === "approved")) {
    const okIdx = calls.findIndex((c) => c.status === "ok");
    if (okIdx >= 0) calls[okIdx] = { ...calls[okIdx], verdict: "approved" };
  }

  // Facts + userInput (`answer_*`)
  const facts: Record<string, string> = {};
  const answers: Array<{ at: number; value: string }> = [];
  for (const [key, entry] of Object.entries(snapshot.facts ?? {})) {
    if (!entry || entry.value === null || entry.at > q.startedAt) continue;
    if (key.startsWith("answer_")) {
      answers.push({ at: entry.at, value: sanitizeText(entry.value, anonymize) });
    } else {
      facts[key] = sanitizeText(entry.value, anonymize);
    }
  }
  answers.sort((a, b) => a.at - b.at);
  const userInput = answers.map((a) => a.value);

  // Recalled (`user_memory` y `thread`)
  const recalled: ScenarioRecalled = {};
  const userMemory: NonNullable<ScenarioRecalled["user_memory"]> = [];
  const thread: NonNullable<ScenarioRecalled["thread"]> = {};
  for (const r of snapshot.recalled ?? []) {
    if (r.at > q.startedAt) continue;
    if (r.source === "user_memory") {
      userMemory.push({
        key: r.key,
        value: sanitizeText(r.value, anonymize),
        ...(r.from ? { from: r.from } : {}),
      });
    } else if (r.source === "thread") {
      if (r.key === "previous_request") thread.previous_request = sanitizeText(r.value, anonymize);
      if (r.key === "previous_answer") thread.previous_answer = sanitizeText(r.value, anonymize);
    }
  }
  if (thread.previous_request === undefined && thread.previous_answer === undefined) {
    const fromFull = extractThreadFromState(fullInput);
    if (fromFull) {
      if (fromFull.previous_request !== undefined) thread.previous_request = sanitizeText(fromFull.previous_request, anonymize);
      if (fromFull.previous_answer !== undefined) thread.previous_answer = sanitizeText(fromFull.previous_answer, anonymize);
    }
  }
  if (userMemory.length > 0) recalled.user_memory = userMemory;
  if (thread.previous_request !== undefined || thread.previous_answer !== undefined) recalled.thread = thread;

  return { mode, steps, calls, facts, userInput, recalled, evaluatedCallIndex };
}

// ───────────────────────── Expect borrador por etapa ─────────────────────────

function buildDraftExpect(
  stage: StageName,
  q: TraceSlimQuery,
  slice: ReconstructedSlice,
  at: ScenarioAt,
  snapshot: ContextData,
): { expect: Record<string, unknown> } | { skipReason: string } {
  const out = q.output;

  switch (stage) {
    case "d0": {
      const chatP = isRecord(out) && isRecord(out.kind) && isRecord(out.kind.p) && typeof out.kind.p.chat === "number" ? out.kind.p.chat : undefined;
      const multiP = noulProb(out, "multi");
      const rawChoice = choiceLabel(out, "kind");
      let kind = chatP !== undefined && multiP !== undefined ? firstQueryKind(chatP, multiP) : rawChoice;
      if (!kind || !(FIRST_QUERY_KINDS as readonly string[]).includes(kind)) kind = "single";
      return { expect: { expectedKind: kind } };
    }
    case "continuation": {
      const p = noulProb(out, "follow");
      return { expect: { expectedFollows: p !== undefined ? p >= CONTINUATION_APPROVE : false } };
    }
    case "route": {
      const route = choiceLabel(out, "route");
      const fallback = (at.routes && at.routes[0]) ?? EXECUTABLE_ROUTES[0];
      return { expect: { expectedRoute: route && isExecutableRoute(route) ? route : fallback } };
    }
    case "tool_choice": {
      const selected = choiceLabel(out, "selected_tool");
      const fallback = at.tools?.[0] ?? SYSTEM_TOOL_MANIFEST.find((t) => t.route === at.route && t.internal !== true)?.name;
      const chosen = selected && SYSTEM_TOOL_MANIFEST.some((t) => t.name === selected && t.route === at.route) ? selected : fallback;
      if (!chosen) return { skipReason: "tool_choice sin herramienta válida para expectedTool" };
      return { expect: { expectedTool: chosen } };
    }
    case "args_review": {
      const rev = choiceLabel(out, "review");
      const valid = rev && (ARGS_REVIEWS as readonly string[]).includes(rev) ? rev : "approved";
      return { expect: { expectedReview: valid } };
    }
    case "result_verification": {
      const okP = noulProb(out, "ok");
      const cumpleP = noulProb(out, "cumple");
      return {
        expect: {
          expectedOk: okP !== undefined ? okP >= OK_APPROVE : true,
          expectedCumple: cumpleP !== undefined ? cumpleP >= NOUL_APPROVE : false,
        },
      };
    }
    case "d5": {
      const p = noulProb(out, "request_complete");
      return { expect: { expectedComplete: p !== undefined ? p >= COMPLETION_APPROVE : false } };
    }
    case "recovery": {
      const action = choiceLabel(out, "action");
      const valid = action && (RECOVERY_ACTIONS as readonly string[]).includes(action) ? action : "replan";
      return { expect: { expectedAction: valid } };
    }
    case "plan": {
      const rawSteps = isRecord(out) && Array.isArray(out.steps) ? out.steps : [];
      const routes = rawSteps
        .map((s) => (isRecord(s) && typeof s.suggested_mcp === "string" && isExecutableRoute(s.suggested_mcp) ? s.suggested_mcp : null))
        .filter((r): r is ExecutableRoute => r !== null);
      if (routes.length > 0) {
        return { expect: { minSteps: 1, requiredRoutes: [...new Set(routes)] } };
      }
      return { expect: { minSteps: 1 } };
    }
    case "arguments": {
      const required = Array.isArray(at.inputSchema?.required)
        ? at.inputSchema!.required.filter((r): r is string => typeof r === "string" && r.length > 0)
        : [];
      const outKeys = isRecord(out) ? Object.keys(out).filter((k) => k.length > 0) : [];
      const propKeys = isRecord(at.inputSchema?.properties) ? Object.keys(at.inputSchema!.properties) : [];
      const fields = required.length > 0 ? required : outKeys.length > 0 ? outKeys : propKeys.slice(0, 1);
      if (fields.length === 0) return { skipReason: "arguments sin propiedades en schema ni claves en salida" };
      return { expect: { requiredFields: fields } };
    }
    case "final": {
      // Buscar un token concreto de datos/respuesta para evitar placeholders vacíos.
      const text = typeof out === "string" ? out : snapshot.result?.text ?? "";
      const numMatch = /\b\d+(?:[.,]\d+)?\b/.exec(text);
      if (numMatch) return { expect: { mustContainFacts: [numMatch[0]] } };
      return { expect: { forbiddenHallucinations: ["ERROR_INTERNO_PLACEHOLDER"] } };
    }
    case "question": {
      return { expect: { maxChars: 250, singleQuestionOnly: true } };
    }
    case "pending": {
      const list = isRecord(out) && Array.isArray(out.pending) ? out.pending : null;
      if (list && list.length === 0) return { expect: { expectEmpty: true } };
      return { expect: { maxItems: Math.max(1, list?.length ?? 4) } };
    }
    default:
      return { skipReason: `etapa '${stage}' sin generador de expect borrador` };
  }
}

// ───────────────────────── Conversión de un bundle ─────────────────────────

export function convertTraceBundle(
  bundle: TraceBundle,
  options: Pick<ConvertTracesOptions, "stages" | "anonymize"> = {},
): { cases: ConvertedTraceCase[]; skipped: SkippedTraceQuery[]; queriesSeen: number } {
  const anonymize = options.anonymize ?? false;
  const stageFilter = options.stages && options.stages.length > 0 ? new Set(options.stages) : null;
  const { slim, full } = bundle;
  const snapshot = slim.snapshot;
  const taskId = slim.taskId ?? snapshot.task?.id ?? bundle.folder;
  const commit = slim.meta?.gitSha ?? undefined;
  const fullBySeq = new Map<number, string | null>((full?.models ?? []).map((m) => [m.seq, m.input]));
  const toolsByCall = new Map<string, TraceSlimTool>();
  for (const t of slim.tools ?? []) {
    if (t.call) toolsByCall.set(t.call, t);
  }
  const callsById = new Map((snapshot.calls ?? []).map((c) => [c.id, c]));

  const cases: ConvertedTraceCase[] = [];
  const skipped: SkippedTraceQuery[] = [];
  let queriesSeen = 0;

  let lastPendingOutput: string[] | null = null;

  for (const q of slim.queries) {
    if (q.stage === "pending" && isRecord(q.output) && Array.isArray(q.output.pending)) {
      lastPendingOutput = q.output.pending.filter((x): x is string => typeof x === "string");
    }

    const evalStage = mapTraceStage(q.stage);
    if (!evalStage) {
      skipped.push({ taskId, seq: q.seq, traceStage: q.stage, reason: `etapa de traza '${q.stage}' no evaluada` });
      continue;
    }
    if (stageFilter && !stageFilter.has(evalStage)) continue;
    queriesSeen++;

    if (q.error) {
      skipped.push({ taskId, seq: q.seq, traceStage: q.stage, reason: `consulta con error en traza: ${q.error}` });
      continue;
    }

    const fullInputRaw = fullBySeq.get(q.seq) ?? null;
    const fullStateText = extractRawStateText(fullInputRaw);
    const slice = sliceSnapshotForQuery(snapshot, q, evalStage, anonymize, fullStateText);

    const request = sanitizeText(snapshot.task.request, anonymize);
    const scenario: Scenario = {
      mode: slice.mode,
      request,
    };
    const at: ScenarioAt = {};

    if (evalStage !== "d0" && evalStage !== "continuation") {
      if (slice.steps.length > 0) scenario.steps = slice.steps;
      if (slice.calls.length > 0) scenario.calls = slice.calls;
      if (Object.keys(slice.facts).length > 0) scenario.facts = slice.facts;
      if (slice.userInput.length > 0) scenario.userInput = slice.userInput;
    }
    if (
      slice.recalled.user_memory !== undefined ||
      slice.recalled.thread !== undefined
    ) {
      scenario.recalled = slice.recalled;
    }

    // Construir `at` o campos específicos por etapa.
    let skipReason: string | null = null;

    if (evalStage === "d0") {
      if (scenario.mode !== "reactive") skipReason = "d0 solo existe en modo reactivo";
    } else if (evalStage === "continuation") {
      scenario.mode = "reactive";
      if (!scenario.recalled?.thread) {
        skipReason = "continuation sin contexto de hilo previo (recalled.thread)";
      }
    } else if (evalStage === "route") {
      const routes = (q.offered ?? []).filter((r): r is ExecutableRoute => isExecutableRoute(r));
      if (routes.length > 0) at.routes = routes;
    } else if (evalStage === "tool_choice") {
      const linkedCall = q.link?.call ? callsById.get(q.link.call) : undefined;
      const firstOffered = q.offered?.[0] ?? choiceLabel(q.output, "selected_tool");
      const route =
        (linkedCall && isExecutableRoute(linkedCall.route) ? linkedCall.route : undefined) ??
        (firstOffered ? toolForRoute(firstOffered) : undefined);
      if (!route) {
        skipReason = "tool_choice sin ruta determinable";
      } else {
        at.route = route;
        const offeredTools = (q.offered ?? []).filter((name) => SYSTEM_TOOL_MANIFEST.some((t) => t.route === route && t.name === name));
        if (offeredTools.length > 0) at.tools = offeredTools;
      }
    } else if (evalStage === "args_review") {
      const linkedCall = q.link?.call ? callsById.get(q.link.call) : undefined;
      const linkedTool = q.link?.call ? toolsByCall.get(q.link.call) : undefined;
      const rawArgs = linkedCall?.args ?? (linkedTool?.args && isRecord(linkedTool.args) ? (linkedTool.args as JsonObject) : undefined);
      const route = linkedCall && isExecutableRoute(linkedCall.route) ? linkedCall.route : undefined;
      const toolName = linkedCall?.tool ?? linkedTool?.tool;
      if (!route || !toolName) {
        skipReason = "args_review sin llamada vinculada (route/tool)";
      } else {
        at.route = route;
        at.tool = toolName;
        at.args = rawArgs ? sanitizeJson(rawArgs, anonymize) : {};
        const schema = slim.meta?.toolSchemas?.[toolName];
        if (isRecord(schema)) at.inputSchema = schema as ToolInputSchema;
      }
    } else if (evalStage === "arguments") {
      const parsedFull = extractEnvAndSchemaFromInput(fullStateText);
      const linkedCall = q.link?.call ? callsById.get(q.link.call) : undefined;
      const linkedTool = q.link?.call ? toolsByCall.get(q.link.call) : undefined;
      const toolName = linkedCall?.tool ?? linkedTool?.tool ?? parsedFull.tool;
      const route =
        (linkedCall && isExecutableRoute(linkedCall.route) ? linkedCall.route : undefined) ??
        (toolName ? toolForRoute(toolName) : undefined);
      const schemaRaw = (toolName ? slim.meta?.toolSchemas?.[toolName] : undefined) ?? parsedFull.schema;
      if (!route || !toolName) {
        skipReason = "arguments sin herramienta/ruta vinculada";
      } else if (!isRecord(schemaRaw)) {
        skipReason = `arguments sin meta.toolSchemas['${toolName}'] en la traza`;
      } else {
        at.route = route;
        at.tool = toolName;
        at.inputSchema = schemaRaw as ToolInputSchema;
        const env = buildEnvironment(slim.meta?.environment ?? parsedFull.env, anonymize);
        if (env) at.environment = env;
      }
    } else if (evalStage === "result_verification") {
      if (!slice.calls.length || slice.evaluatedCallIndex === undefined || slice.evaluatedCallIndex < 0) {
        skipReason = "result_verification sin llamada evaluable";
      } else {
        at.call = slice.evaluatedCallIndex;
        if (fullStateText && /^Request:/m.test(fullStateText)) at.lastItem = true;
      }
    } else if (evalStage === "d5") {
      if (scenario.mode !== "reactive") skipReason = "d5 solo existe en modo reactivo";
    } else if (evalStage === "pending") {
      if (scenario.mode !== "reactive") {
        skipReason = "pending solo existe en modo reactivo";
      } else {
        const prevFromFull = extractPendingListFromState(fullStateText);
        const prev = prevFromFull ?? lastPendingOutput;
        if (prev && prev.length > 0) at.previous = prev.map((p) => sanitizeText(p, anonymize));
      }
    } else if (evalStage === "recovery") {
      if (scenario.mode !== "reactive") {
        skipReason = "recovery solo existe en modo reactivo";
      } else {
        const recBlock = extractRecoveryBlock(fullStateText);
        const prevFromFull = extractPendingListFromState(fullStateText);
        const failedStepInst = slice.steps.at(-1)?.instruction;
        const rawPrev =
          prevFromFull && prevFromFull.length > 0
            ? prevFromFull
            : recBlock.failed
              ? [recBlock.failed]
              : lastPendingOutput && lastPendingOutput.length > 0
                ? lastPendingOutput
                : failedStepInst
                  ? [failedStepInst]
                  : [];
        if (rawPrev.length === 0) {
          skipReason = "recovery sin lista previous reconstruible";
        } else {
          at.previous = rawPrev.map((p) => sanitizeText(p, anonymize));
          if (recBlock.cause && (STEP_FAILURE_CAUSES as readonly string[]).includes(recBlock.cause)) {
            at.cause = recBlock.cause as StepFailureCause;
          }
          // Asegurar que `steps` al final tenga `attempts` pasos seguidos en `failed`.
          let consecutive = 0;
          for (let i = slice.steps.length - 1; i >= 0 && slice.steps[i].state === "failed"; i--) consecutive++;
          at.attempts = Math.max(1, consecutive || 1);
        }
      }
    } else if (evalStage === "final") {
      const st = snapshot.task.state;
      const terminalState: TerminalTaskState =
        st === "completed" || st === "partial" || st === "failed" || st === "cancelled" ? st : "completed";
      const reason =
        terminalState !== "completed" && snapshot.task.stopReason
          ? (snapshot.task.stopReason as StopReason)
          : undefined;
      scenario.finish = { state: terminalState, ...(reason ? { stopReason: reason } : {}) };
    }

    if (skipReason) {
      skipped.push({ taskId, seq: q.seq, traceStage: q.stage, reason: skipReason });
      continue;
    }

    if (Object.keys(at).length > 0) scenario.at = at;

    const draft = buildDraftExpect(evalStage, q, slice, at, snapshot);
    if ("skipReason" in draft) {
      skipped.push({ taskId, seq: q.seq, traceStage: q.stage, reason: draft.skipReason });
      continue;
    }

    const id = safeId(`tr-${taskId}-s${String(q.seq).padStart(2, "0")}-${evalStage}`);
    const candidate: ConvertedTraceCase = {
      id,
      stage: evalStage,
      tags: ["trace_draft", "needs_review", evalStage],
      description: `[BORRADOR TRAZA ${taskId} #seq=${q.seq} — revisar etiqueta humana] ${oneLine(request)}`,
      scenario,
      expect: draft.expect,
      meta: { origin: { id: `${taskId}#${q.seq}`, ...(commit ? { commit } : {}) } },
    };

    try {
      const m = materializeScenario(evalStage, scenario);
      const validation = validateCase({
        id: candidate.id,
        stage: candidate.stage,
        tags: candidate.tags,
        description: candidate.description,
        request: m.request,
        expect: candidate.expect,
        meta: {
          ...candidate.meta,
          ...(m.toolSchema
            ? { toolSchema: m.toolSchema, toolName: m.toolName, environment: m.environment, precheck: m.precheck }
            : {}),
        },
      });
      if (!validation.ok) {
        skipped.push({ taskId, seq: q.seq, traceStage: q.stage, reason: `validateCase: ${validation.errors.join("; ")}` });
        continue;
      }
      cases.push(candidate);
    } catch (e) {
      skipped.push({
        taskId,
        seq: q.seq,
        traceStage: q.stage,
        reason: `materializeScenario: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return { cases, skipped, queriesSeen };
}

// ───────────────────────── Pipeline completo ─────────────────────────

export function convertTraces(options: ConvertTracesOptions): ConvertTracesResult {
  const dedupe = options.dedupe ?? true;
  const anonymize = options.anonymize ?? false;
  const useFull = options.useFull ?? true;
  const dryRun = options.dryRun ?? false;

  let files = discoverTraceFiles(options.inputPath);
  if (options.taskFilters && options.taskFilters.length > 0) {
    files = files.filter((f) => options.taskFilters!.some((flt) => f.includes(flt)));
  }
  if (options.limit !== undefined) {
    files = files.slice(0, options.limit);
  }

  const allCases: ConvertedTraceCase[] = [];
  const allSkipped: SkippedTraceQuery[] = [];
  const seenKeys = new Set<string>();
  const usedIds = new Set<string>();
  let queriesSeen = 0;

  for (const file of files) {
    const bundle = readTraceBundle(file, useFull);
    const res = convertTraceBundle(bundle, { stages: options.stages, anonymize });
    queriesSeen += res.queriesSeen;
    allSkipped.push(...res.skipped);

    const queryBySeq = new Map(bundle.slim.queries.map((q) => [q.seq, q]));

    for (const c of res.cases) {
      const seqStr = c.meta?.origin.id.split("#").pop();
      const seq = seqStr ? Number(seqStr) : NaN;
      const q = Number.isFinite(seq) ? queryBySeq.get(seq) : undefined;
      if (dedupe) {
        const fingerprint = q?.inputHash
          ? `${c.stage}:hash:${q.inputHash}`
          : `${c.stage}:sc:${createHash("sha1").update(JSON.stringify(c.scenario)).digest("hex")}`;
        if (seenKeys.has(fingerprint)) {
          allSkipped.push({
            taskId: bundle.slim.taskId ?? bundle.folder,
            seq: q?.seq ?? 0,
            traceStage: q?.stage ?? c.stage,
            reason: "duplicado (inputHash/escenario idéntico)",
          });
          continue;
        }
        seenKeys.add(fingerprint);
      }

      let uniqueId = c.id;
      let suffix = 2;
      while (usedIds.has(uniqueId)) {
        uniqueId = `${c.id}_${suffix++}`;
      }
      usedIds.add(uniqueId);
      allCases.push(uniqueId === c.id ? c : { ...c, id: uniqueId });
    }
  }

  const byStage: Record<string, number> = {};
  for (const c of allCases) byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;

  const writtenFiles: string[] = [];
  if (!dryRun && allCases.length > 0) {
    const target = options.outPath ?? "eval/traces_export";
    if (target.endsWith(".jsonl")) {
      mkdirSync(dirname(target), { recursive: true });
      const lines = allCases.map((c) => JSON.stringify(c)).join("\n") + "\n";
      writeFileSync(target, lines, "utf8");
      writtenFiles.push(target);
    } else {
      mkdirSync(target, { recursive: true });
      const grouped = new Map<StageName, ConvertedTraceCase[]>();
      for (const c of allCases) {
        const list = grouped.get(c.stage) ?? [];
        list.push(c);
        grouped.set(c.stage, list);
      }
      for (const [st, list] of grouped) {
        const fileOut = join(target, `traces_${st}.jsonl`);
        writeFileSync(fileOut, list.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
        writtenFiles.push(fileOut);
      }
    }
  }

  return {
    filesScanned: files.length,
    queriesSeen,
    cases: allCases,
    byStage,
    skipped: allSkipped,
    writtenFiles,
  };
}
