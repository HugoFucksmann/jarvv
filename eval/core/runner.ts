/**
 * eval/core/runner.ts
 *
 * Corre los casos de un dataset con una variante, respetando concurrencia,
 * repeat y la semántica de thinking (7.5). Produce RunRecord por cada ejecución.
 *
 * Secciones: 7.1–7.9.
 */

import { createHash } from "node:crypto";
import type { DecisionClient } from "./client/decision.ts";
import { DECISION_MAX_CONTEXT, estimateDecisionPromptTokens } from "./client/decision.ts";
import type { GenerativeCallContext, GenerativeClient, PreparedRequest } from "./client/generative.ts";
import { isFatalClientError } from "./client/generative.ts";
import type { EvalConfig } from "./config.ts";
import { resolveDecisionTimeout, resolveGenerativeTimeout } from "./config.ts";
import {
  LLM_INVALID_OUTPUT_RETRIES,
  RETRY_TEMPERATURE,
  RETRY_TOKEN_FACTOR,
  retryNote,
  TRUNCATED_ERROR,
} from "./contract.ts";
import { PROD_SHORTCUT_TAG } from "./case.ts";
import { createCollector } from "./graders/common.ts";
import { buildQuestionResults, gradeExtraQuestions } from "./questions.ts";
import { getStage, isDecisionStage, runGraders } from "./stages/index.ts";
import type { DecisionStageEntry, GenerativeStageEntry } from "./stages/types.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type {
  AnswerExpects,
  Case,
  DecisionRequest,
  DecisionStage,
  GenerativeRequest,
  QuestionResult,
  RunRecord,
  StageName,
} from "./types.ts";
import type { Variant } from "./variants/types.ts";

// ───────────────────────── Helpers ─────────────────────────

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

function isoNow(): string {
  return new Date().toISOString();
}

function logDryRun(prepared: PreparedRequest): void {
  console.log(`POST ${prepared.url}`);
  console.log(JSON.stringify(prepared.body, null, 2));
}

type TokenTotals = { prompt?: number; completion?: number; total?: number };

function addTokens(acc: TokenTotals | undefined, next: TokenTotals | undefined): TokenTotals | undefined {
  if (!next) return acc;
  return {
    prompt: (acc?.prompt ?? 0) + (next.prompt ?? 0),
    completion: (acc?.completion ?? 0) + (next.completion ?? 0),
    total: (acc?.total ?? 0) + (next.total ?? 0),
  };
}

/** Parámetros generativos finales: override de `--thinking` sobre el caso. */
function resolveGenerativeRequest(
  req: GenerativeRequest,
  thinkingOverride?: boolean,
): GenerativeRequest {
  const out = { ...req };
  if (thinkingOverride !== undefined) out.thinking = thinkingOverride;
  return out;
}

// ───────────────────────── Expansión de thinking (7.5) ─────────────────────────

interface ThinkingExpansion {
  /** thinking efectivo para esta ejecución */
  thinking: boolean;
  /** stageKey para scoring */
  stageKey: string;
}

/**
 * Devuelve las combinaciones de thinking para un caso, según --thinking y el registro de la etapa.
 * El runner itera sobre cada una.
 */
function expandThinking(
  stage: StageName,
  caseThinking: boolean,
  cfg: EvalConfig,
): ThinkingExpansion[] {
  const entry = getStage(stage);
  if (entry.requestType === "decision") {
    return [{ thinking: false, stageKey: stage }];
  }

  const mode = cfg.thinking;

  if (mode === "prod") return [{ thinking: caseThinking, stageKey: stage }];
  if (mode === "on") return [{ thinking: true, stageKey: stage }];
  if (mode === "off") return [{ thinking: false, stageKey: stage }];
  return [
    { thinking: true, stageKey: `${stage}[think=on]` },
    { thinking: false, stageKey: `${stage}[think=off]` },
  ];
}

// ───────────────────────── Bucket (7.9, 5.4) ─────────────────────────

function resolveBucket(fc: Case, cfg: EvalConfig): "canonical" | "raw" {
  if (fc.isRaw) return "raw";
  if ((fc.tags ?? []).includes(PROD_SHORTCUT_TAG) && !cfg.includeShortcut) return "raw";
  return "canonical";
}

// ───────────────────────── Runner ─────────────────────────

export interface RunTask {
  fc: Case;
  variant: Variant;
  variantSpec: string;
  datasetName: string;
  iteration: number;
  thinkingExp: ThinkingExpansion;
}

export interface RunResult {
  record: RunRecord;
}

/** Corre un único caso (una iteración, un thinking). */
async function runOne(
  task: RunTask,
  cfg: EvalConfig,
  genClient: GenerativeClient,
  decClient: DecisionClient,
  dryRun: boolean,
): Promise<RunResult> {
  const { fc, variantSpec, datasetName, iteration, thinkingExp } = task;
  const timestamp = isoNow();
  const bucket = resolveBucket(fc, cfg);
  const stage = fc.stage;

  const baseRecord: BaseRecord = {
    schemaVersion: SCHEMA_VERSION,
    dataset: datasetName,
    caseId: fc.id,
    stage,
    stageKey: thinkingExp.stageKey,
    iteration,
    variant: variantSpec,
    isRaw: fc.isRaw,
    prodShortcut: (fc.tags ?? []).includes(PROD_SHORTCUT_TAG),
    bucket,
    timestamp,
  };

  try {
    if (isDecisionStage(stage)) {
      return await runDecision(task, cfg, decClient, dryRun, baseRecord);
    }
    return await runGenerative(task, cfg, genClient, dryRun, baseRecord, thinkingExp.thinking);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return makeRecord(baseRecord, {
      rawInput: null,
      rawOutput: "",
      requestHash: "",
      durationMs: 0,
      model: isDecisionStage(stage) ? cfg.decisionModel : cfg.model,
      passed: false,
      errors: [`exception: ${message}`],
      warnings: [],
      metrics: { client_call_ok: false },
      measurements: {},
    });
  }
}

/**
 * Ejecuta los graders y falla el caso si ninguno registró un check: un `expect` vacío o con claves
 * desconocidas no puede contar como "pasó".
 */
function gradeWithGuard(
  entry: DecisionStageEntry<unknown, unknown> | GenerativeStageEntry<unknown, unknown>,
  parsed: unknown,
  expectObj: unknown,
  ctx: { rawOutput: string; finishReason?: string; durationMs: number },
  collector: ReturnType<typeof createCollector>["collector"],
  metrics: Record<string, boolean>,
): void {
  // `not_truncated` lo registra siempre un grader base: no cuenta como check del caso.
  const countChecks = () => Object.keys(metrics).filter((k) => k !== "not_truncated").length;
  const before = countChecks();
  runGraders(entry, parsed, expectObj, ctx, collector);
  if (countChecks() === before) {
    collector.check("graders_ran_checks", false, "Ningún grader ejecutó checks: `expect` vacío o con claves no reconocidas.");
  }
}

function finalizeAttemptChecks(
  collector: ReturnType<typeof createCollector>["collector"],
  measurements: Record<string, number | string>,
  warnings: string[],
  retryErrors: string[],
  parseError: string | undefined,
  retryKindLabel: string,
): void {
  collector.check("client_call_ok", true, "");
  const parseOk = parseError === undefined;
  collector.check("output_parse_ok", parseOk, parseOk ? "" : parseError);
  measurements.attempts = retryErrors.length + 1;
  retryErrors.forEach((e, i) => warnings.push(`Reintento ${i + 1} por ${retryKindLabel}: ${e}`));
}

// ── Decisión ──

async function runDecision(
  task: RunTask,
  cfg: EvalConfig,
  client: DecisionClient,
  dryRun: boolean,
  baseRecord: BaseRecord,
): Promise<RunResult> {
  const { fc } = task;
  const sentReq = fc.request as DecisionRequest;
  const prepared = client.prepare(sentReq);
  const hash = requestHash(prepared.body);

  if (dryRun) logDryRun(prepared);

  // Ojo: `passed` del collector es un getter; desestructurarlo lo congelaba en `true`. Se calcula al final.
  const { collector, errors, warnings, metrics, measurements } = createCollector();

  // Como producción (`systemOne`): un payload que excede `decisionMaxContext` no se envía (desborde, sin reintento).
  const ctxTokens = estimateDecisionPromptTokens(sentReq);
  const fitsContext = ctxTokens <= DECISION_MAX_CONTEXT;
  collector.check(
    "decision_context_ok",
    fitsContext,
    `Tokens estimados (${ctxTokens}) superan decisionMaxContext (${DECISION_MAX_CONTEXT}): producción no enviaría esta consulta.`,
  );

  if (dryRun || !fitsContext) {
    return makeRecord(baseRecord, {
      rawInput: prepared.body,
      rawOutput: "",
      requestHash: hash,
      durationMs: 0,
      model: cfg.decisionModel,
      passed: false,
      errors,
      warnings,
      metrics,
      measurements,
    });
  }

  const timeoutMs = resolveDecisionTimeout(cfg);
  const callCtx = { stage: fc.stage, expect: fc.expect };
  const entry = getStage(fc.stage) as DecisionStageEntry<unknown, unknown>;

  // Una sola consulta por caso (sin reintento por respuesta inválida, alineado con producción).
  const result = await client.call(sentReq, timeoutMs, callCtx);
  const durationMs = result.durationMs;

  if (!result.ok) {
    collector.check("client_call_ok", false, result.error);
    return makeRecord(baseRecord, {
      rawInput: prepared.body,
      rawOutput: "",
      requestHash: hash,
      durationMs,
      model: cfg.decisionModel,
      passed: false,
      errors,
      warnings,
      metrics,
      measurements,
    });
  }

  let parsed: unknown;
  let parseError: string | undefined;
  try {
    parsed = entry.parseOutput(result.rawOutput, sentReq, fc);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const tokens: TokenTotals | undefined = result.tokens;
  const rawOutput = result.rawOutput;
  finalizeAttemptChecks(collector, measurements, warnings, [], parseError, "respuesta inválida");

  const labelInfo = entry.label(parsed, fc.expect as never);
  gradeWithGuard(entry, parsed, fc.expect, { rawOutput, durationMs }, collector, metrics);

  const expectRec = fc.expect as unknown as Record<string, unknown>;
  const questions = buildQuestionResults({
    rawOutput,
    sentReq,
    stage: fc.stage as DecisionStage,
    expect: expectRec,
    canonicalExpected: labelInfo.expected,
  });
  gradeExtraQuestions(questions, expectRec.answers as AnswerExpects | undefined, collector);

  return makeRecord(baseRecord, {
    rawInput: prepared.body,
    rawOutput,
    requestHash: hash,
    durationMs,
    model: cfg.decisionModel,
    passed: errors.length === 0,
    errors,
    warnings,
    metrics,
    measurements,
    parsedOutput: parsed,
    tokens: tokens as { prompt: number; completion: number; total: number } | undefined,
    tokensEstimated: true,
    predictedLabel: labelInfo.predicted,
    expectedLabel: labelInfo.expected,
    rawScore: labelInfo.rawScore,
    probabilities: labelInfo.probabilities,
    questions,
  });
}

// ── Generativa ──

async function runGenerative(
  task: RunTask,
  cfg: EvalConfig,
  client: GenerativeClient,
  dryRun: boolean,
  baseRecord: BaseRecord,
  thinking: boolean,
): Promise<RunResult> {
  const { fc } = task;
  const req = resolveGenerativeRequest(fc.request as GenerativeRequest, thinking);
  const callCtx: GenerativeCallContext = { toolSchema: fc.meta?.toolSchema, stage: fc.stage, expect: fc.expect };
  const prepared = client.prepare(req);
  const hash = requestHash(prepared.body);

  if (dryRun) logDryRun(prepared);

  // Ojo: `passed` del collector es un getter; desestructurarlo lo congelaba en `true`. Se calcula al final.
  const { collector, errors, warnings, metrics, measurements } = createCollector();

  const paramsOf = (r: GenerativeRequest) => ({
    temperature: r.temperature,
    thinking: r.thinking,
    maxTokens: r.maxTokens,
    timeoutMs: resolveGenerativeTimeout(cfg, r.thinking),
  });

  if (dryRun) {
    return makeRecord(baseRecord, {
      rawInput: prepared.body,
      rawOutput: "",
      requestHash: hash,
      durationMs: 0,
      model: cfg.model,
      passed: false,
      errors,
      warnings,
      metrics,
      measurements,
      requestParams: paramsOf(req),
    });
  }

  const entry = getStage(fc.stage) as GenerativeStageEntry<unknown, unknown>;

  let curReq = req;
  let result = await client.call(curReq, resolveGenerativeTimeout(cfg, curReq.thinking), callCtx);
  let durationMs = result.durationMs;
  let parsed: unknown;
  let parseError: string | undefined;
  const retryErrors: string[] = [];
  let tokens: TokenTotals | undefined;
  let tokensEstimated = false;

  for (let attempt = 0; ; attempt++) {
    if (!result.ok) break;
    tokens = addTokens(tokens, result.tokens);
    if (result.tokensEstimated) tokensEstimated = true;
    parsed = undefined;
    parseError = undefined;
    try {
      parsed = entry.parseOutput(result.rawOutput, curReq, fc.meta?.toolSchema);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
    const isLast = attempt >= LLM_INVALID_OUTPUT_RETRIES;
    const truncated = result.finishReason === "length";
    const error = entry.rejectTruncated
      ? (truncated ? TRUNCATED_ERROR : parseError)
      : (truncated && !isLast ? TRUNCATED_ERROR : parseError);
    if (!error || isLast) break;
    retryErrors.push(error);
    curReq = {
      ...req,
      user: req.user + retryNote(error),
      maxTokens: Math.ceil(req.maxTokens * RETRY_TOKEN_FACTOR),
      thinking: req.retryThinking ?? req.thinking,
      temperature: Math.max(RETRY_TEMPERATURE, req.temperature),
    };
    result = await client.call(curReq, resolveGenerativeTimeout(cfg, curReq.thinking), callCtx);
    durationMs += result.durationMs;
  }

  const usedBody = client.prepare(curReq).body;
  const requestParams = paramsOf(curReq);

  if (!result.ok) {
    retryErrors.forEach((e, i) => warnings.push(`Reintento ${i + 1} por salida inválida: ${e}`));
    if (retryErrors.length > 0) measurements.attempts = retryErrors.length + 1;
    collector.check("client_call_ok", false, result.error);
    return makeRecord(baseRecord, {
      rawInput: usedBody,
      rawOutput: "",
      requestHash: hash,
      durationMs,
      model: cfg.model,
      passed: false,
      errors,
      warnings,
      metrics,
      measurements,
      ...(tokens ? { tokens } : {}),
      ...(tokensEstimated ? { tokensEstimated: true } : {}),
      requestParams,
    });
  }

  const rawOutput = result.rawOutput;
  finalizeAttemptChecks(collector, measurements, warnings, retryErrors, parseError, "salida inválida");

  const ctx = { rawOutput, finishReason: result.finishReason, durationMs };
  gradeWithGuard(entry, parsed, fc.expect, ctx, collector, metrics);

  if (cfg.client === "real" && parsed !== undefined && entry.postCheck) {
    await entry.postCheck({ parsed, fc, collector });
  }

  return makeRecord(baseRecord, {
    rawInput: usedBody,
    rawOutput,
    requestHash: hash,
    durationMs,
    model: cfg.model,
    passed: errors.length === 0,
    errors,
    warnings,
    metrics,
    measurements,
    parsedOutput: parsed,
    tokens,
    ...(result.tokensEstimated ? { tokensEstimated: true } : {}),
    finishReason: result.finishReason,
    requestParams,
  });
}

// ───────────────────────── Helpers de record ─────────────────────────

type BaseRecord = Omit<RunRecord, "rawInput" | "rawOutput" | "requestHash" | "durationMs" | "passed" | "errors" | "warnings" | "metrics" | "measurements" | "model">;

function makeRecord(
  base: BaseRecord,
  extra: {
    rawInput: unknown;
    rawOutput: string;
    requestHash: string;
    durationMs: number;
    model: string;
    passed: boolean;
    errors: string[];
    warnings: string[];
    metrics: Record<string, boolean>;
    measurements: Record<string, number | string>;
    parsedOutput?: unknown;
    tokens?: TokenTotals;
    tokensEstimated?: boolean;
    finishReason?: string;
    requestParams?: { temperature?: number; thinking?: boolean; maxTokens?: number; timeoutMs?: number };
    predictedLabel?: string | null;
    expectedLabel?: string | null;
    rawScore?: number | null;
    probabilities?: Record<string, number> | null;
    questions?: Record<string, QuestionResult>;
  },
): RunResult {
  const record: RunRecord = {
    ...base,
    model: extra.model,
    passed: extra.passed,
    errors: extra.errors,
    warnings: extra.warnings,
    metrics: extra.metrics,
    measurements: extra.measurements,
    requestHash: extra.requestHash,
    rawInput: extra.rawInput,
    rawOutput: extra.rawOutput,
    durationMs: extra.durationMs,
    ...(extra.parsedOutput !== undefined ? { parsedOutput: extra.parsedOutput } : {}),
    ...(extra.tokens ? { tokens: extra.tokens } : {}),
    ...(extra.tokensEstimated ? { tokensEstimated: extra.tokensEstimated } : {}),
    ...(extra.finishReason ? { finishReason: extra.finishReason } : {}),
    ...(extra.requestParams ? { requestParams: extra.requestParams } : {}),
    ...(extra.predictedLabel !== undefined ? { predictedLabel: extra.predictedLabel } : {}),
    ...(extra.expectedLabel !== undefined ? { expectedLabel: extra.expectedLabel } : {}),
    ...(extra.rawScore !== undefined ? { rawScore: extra.rawScore } : {}),
    ...(extra.probabilities !== undefined ? { probabilities: extra.probabilities } : {}),
    ...(extra.questions !== undefined ? { questions: extra.questions } : {}),
  };
  return { record };
}

// ───────────────────────── Concurrencia ─────────────────────────

/** Ejecuta `tasks` en paralelo con concurrencia máxima `limit`. */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ───────────────────────── Punto de entrada ─────────────────────────

export interface RunnerInput {
  cases: Case[];
  datasetName: string;
  /** La variante usada en la ejecución; los casos ya traen sus prompts materializados. */
  variant: Variant;
  variantSpec: string;
  cfg: EvalConfig;
  genClient: GenerativeClient;
  decClient: DecisionClient;
  stageFilter: StageName[];     // vacío = todos
  onRecord?: (record: RunRecord) => void;
  /** Si es `false` y se usa `onRecord`, evita duplicar `records` en el retorno. Por defecto `true`. */
  collectRecords?: boolean;
  dryRun?: boolean;
}

export interface RunnerOutput {
  records: RunRecord[];
  /** true si TODAS las llamadas fallaron por el cliente (red, timeout o HTTP) */
  allNetworkFailed: boolean;
}

export async function runDataset(input: RunnerInput): Promise<RunnerOutput> {
  const {
    cases, datasetName, variant, variantSpec, cfg,
    genClient, decClient, stageFilter, onRecord, collectRecords = true, dryRun = false,
  } = input;

  const filtered = stageFilter.length > 0
    ? cases.filter((c) => stageFilter.includes(c.stage))
    : cases;

  const tasks: RunTask[] = [];
  for (const fc of filtered) {
    const caseThinking = fc.request.type === "generative" ? fc.request.thinking : false;
    const expansions = expandThinking(fc.stage, caseThinking, cfg);

    for (const exp of expansions) {
      for (let iter = 1; iter <= cfg.repeat; iter++) {
        tasks.push({ fc, variant, variantSpec, datasetName, iteration: iter, thinkingExp: exp });
      }
    }
  }

  let networkFailCount = 0;
  let callCount = 0;

  const fns = tasks.map((task) => async () => {
    const result = await runOne(task, cfg, genClient, decClient, dryRun);
    if (!dryRun && result.record.metrics.client_call_ok === false) {
      const err = result.record.errors[result.record.errors.length - 1] ?? "";
      if (isFatalClientError(err)) networkFailCount++;
    }
    if (!dryRun && result.record.metrics.client_call_ok !== undefined) callCount++;
    onRecord?.(result.record);
    return collectRecords ? result.record : (undefined as unknown as RunRecord);
  });

  const collected = await runWithConcurrency(fns, cfg.concurrency);

  return {
    records: collectRecords ? collected : [],
    allNetworkFailed: callCount > 0 && networkFailCount === callCount,
  };
}