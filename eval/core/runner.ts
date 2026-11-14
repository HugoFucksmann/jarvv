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
import { estimateDecisionPromptTokens, DECISION_MAX_CONTEXT } from "./client/decision.ts";
import type { GenerativeClient, GenerativeCallContext } from "./client/generative.ts";
import { isTransportError } from "./client/generative.ts";
import type { EvalConfig } from "./config.ts";
import { resolveDecisionTimeout, resolveGenerativeTimeout } from "./config.ts";
import {
  LLM_INVALID_OUTPUT_RETRIES,
  RETRY_TEMPERATURE,
  RETRY_TOKEN_FACTOR,
  retryNote,
  TRUNCATED_ERROR,
} from "./contract.ts";
import { createCollector } from "./graders/common.ts";
import { collectStrings, usedRefIds } from "./graders/arguments.ts";
import type { DecisionStageEntry, GenerativeStageEntry } from "./stages/index.ts";
import { getStage, runGraders } from "./stages/index.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type {
  AnswerExpects,
  DecisionRequest,
  DecisionStage,
  Case,
  GenerativeRequest,
  GenerativeStage,
  QuestionResult,
  RunRecord,
  StageName,
} from "./types.ts";
import { analyzePowerShell, precheckCall } from "../../src/core/engine/precheck.ts";
import type { CommandAnalyzer } from "../../src/core/engine/precheck.ts";
import { buildQuestionResults, gradeExtraQuestions } from "./questions.ts";
import type { Variant } from "./variants/types.ts";
import { DECISION_STAGES, PROD_SHORTCUT_TAG } from "./case.ts";

// ───────────────────────── Helpers ─────────────────────────

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Parámetros generativos finales (sección 7.1): variante.params > valor del caso.
 *  No hay flag de temperatura: sale del caso o de `params.temperature` de la variante (ya aplicada). */
function resolveGenerativeRequest(
  req: GenerativeRequest,
  thinkingOverride?: boolean,
): GenerativeRequest {
  const out = { ...req };
  // thinking: la expansión de thinking ya respetó lo que fijó la variante
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
 * Devuelve las combinaciones de thinking para un caso, según --thinking y la etapa.
 * El runner itera sobre cada una.
 */
function expandThinking(
  stage: StageName,
  caseThinking: boolean,
  cfg: EvalConfig,
  variantFixedThinking?: boolean,
): ThinkingExpansion[] {
  // Decisión: stageKey = stage, no se expande
  if ((DECISION_STAGES as readonly string[]).includes(stage)) {
    return [{ thinking: false, stageKey: stage }];
  }

  // Si la variante fija params.thinking → no se expande, stageKey = stage
  if (variantFixedThinking !== undefined) {
    return [{ thinking: variantFixedThinking, stageKey: stage }];
  }

  const mode = cfg.thinking;

  if (mode === "prod") {
    return [{ thinking: caseThinking, stageKey: stage }];
  }
  if (mode === "on") {
    return [{ thinking: true, stageKey: stage }];
  }
  if (mode === "off") {
    return [{ thinking: false, stageKey: stage }];
  }
  if (mode === "both") {
    return [
      { thinking: true, stageKey: `${stage}[think=on]` },
      { thinking: false, stageKey: `${stage}[think=off]` },
    ];
  }
  // auto (default)
  if (stage === "final") {
    return [
      { thinking: true, stageKey: `${stage}[think=on]` },
      { thinking: false, stageKey: `${stage}[think=off]` },
    ];
  }
  // plan, arguments, question: valor del caso
  return [{ thinking: caseThinking, stageKey: stage }];
}

/** El analizador de producción, con caché por comando (cada análisis lanza un PowerShell). */
const analysisCache = new Map<string, ReturnType<CommandAnalyzer>>();
const cachedAnalyze: CommandAnalyzer = (command) => {
  let r = analysisCache.get(command);
  if (r === undefined) {
    r = analyzePowerShell(command);
    analysisCache.set(command, r);
  }
  return r;
};

/**
 * Los argumentos que llevan un token de ref (`{{ref:rN}}` o `ref:rN`), fuera. Producción los resuelve antes del pre-chequeo; el eval
 * no tiene el contenido de las refs, y comprobar el token literal rechazaría de más (una URL o ruta "sin origen", un comando que no
 * parsea). Ante la duda, silencio, como el propio pre-chequeo. Límite: esos valores no se comprueban.
 */
function argsWithoutRefs(args: Record<string, unknown>): Record<string, unknown> {
  const stringsOf = (v: unknown): string[] =>
    typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return Object.fromEntries(Object.entries(args).filter(([, v]) => usedRefIds(stringsOf(v)).length === 0));
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

  // El caso ya trae el request final: el cargador lo armó con los prompts de la variante.
  const stage = fc.stage;
  const isDecision = (DECISION_STAGES as readonly string[]).includes(stage);

  // ── Base del record ──
  const baseRecord: Omit<RunRecord, "rawInput" | "rawOutput" | "requestHash" | "durationMs" | "passed" | "errors" | "warnings" | "metrics" | "measurements" | "model"> = {
    schemaVersion: SCHEMA_VERSION,
    dataset: datasetName,
    caseId: fc.id,
    stage: stage as StageName,
    stageKey: thinkingExp.stageKey,
    iteration,
    variant: variantSpec,
    isRaw: fc.isRaw,
    prodShortcut: (fc.tags ?? []).includes(PROD_SHORTCUT_TAG),
    bucket,
    timestamp,
  };

  // ── Preparar y ejecutar ──
  if (isDecision) {
    return runDecision(task, cfg, decClient, dryRun, baseRecord);
  } else {
    return runGenerative(task, cfg, genClient, dryRun, baseRecord, thinkingExp.thinking);
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

// ── Decisión ──

async function runDecision(
  task: RunTask,
  cfg: EvalConfig,
  client: DecisionClient,
  dryRun: boolean,
  baseRecord: ReturnType<typeof buildBase>,
): Promise<RunResult> {
  const { fc, variant } = task;
  const sentReq = fc.request as DecisionRequest;
  const prepared = client.prepare(sentReq);
  const hash = requestHash(prepared.body);

  // dry-run
  if (dryRun) {
    console.log(`POST ${prepared.url}`);
    console.log(JSON.stringify(prepared.body, null, 2));
  }

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
  const entry = getStage(fc.stage as StageName) as DecisionStageEntry<unknown, unknown>;

  // Como producción (DN-3.4): las etapas de decisión usan 0 reintentos ante respuesta inválida.
  // Las fallas de transporte tampoco entran aquí (las reintenta `postJson`).
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
      tokensEstimated: true,
    });
  }

  const tokens = { ...result.tokens };
  let parsed: unknown;
  let parseError: string | undefined;
  try {
    parsed = entry.parseOutput(result.rawOutput, sentReq, variant.read);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  collector.check("client_call_ok", true, "");
  const rawOutput = result.rawOutput;

  // Parse
  const parseOk = parseError === undefined;
  if (!parseOk) collector.check("output_parse_ok", false, parseError as string);
  if (parseOk) collector.check("output_parse_ok", true, "");
  measurements.attempts = 1;

  // Labels (7.8)
  const labelInfo = entry.label(parsed, fc.expect as never);

  // Graders de la etapa (pregunta principal)
  const ctx = { rawOutput, durationMs };
  gradeWithGuard(entry, parsed, fc.expect, ctx, collector, metrics);

  // Todas las preguntas del request, una entrada por clave. Las adicionales con `expect.answers` se evalúan aparte.
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
    tokens,
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
  baseRecord: ReturnType<typeof buildBase>,
  thinking: boolean,
): Promise<RunResult> {
  const { fc } = task;

  // Resolver request final con precedencia (7.1)
  const reqRaw = fc.request as GenerativeRequest;
  const req = resolveGenerativeRequest(reqRaw, thinking);

  const callCtx: GenerativeCallContext = { toolSchema: fc.meta?.toolSchema, stage: fc.stage, expect: fc.expect };
  const prepared = client.prepare(req);
  const hash = requestHash(prepared.body);

  if (dryRun) {
    console.log(`POST ${prepared.url}`);
    console.log(JSON.stringify(prepared.body, null, 2));
  }

  // Ojo: `passed` del collector es un getter; desestructurarlo lo congelaba en `true`. Se calcula al final.
  const { collector, errors, warnings, metrics, measurements } = createCollector();

  /** Parámetros con que se envía un intento (`requestParams` del record). */
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

  const entry = getStage(fc.stage as StageName) as GenerativeStageEntry<unknown, unknown>;
  // Como producción (`dispatchValidated`): un reintento ante salida inválida o truncada, con ERROR_PREVIO,
  // 1.5x tokens y temperatura max(0.3, la del request). Las fallas de transporte no entran aquí (las reintenta `postJson`).
  const jsonStage = fc.stage === "plan" || fc.stage === "arguments" || fc.stage === "pending";

  let curReq = req;
  let result = await client.call(curReq, resolveGenerativeTimeout(cfg, curReq.thinking), callCtx);
  let durationMs = result.durationMs;
  let parsed: unknown;
  let parseError: string | undefined;
  const retryErrors: string[] = [];
  let tokens: { prompt?: number; completion?: number; total?: number } | undefined;

  for (let attempt = 0; ; attempt++) {
    if (result.ok) {
      if (result.tokens) {
        tokens = {
          prompt: (tokens?.prompt ?? 0) + (result.tokens.prompt ?? 0),
          completion: (tokens?.completion ?? 0) + (result.tokens.completion ?? 0),
          total: (tokens?.total ?? 0) + (result.tokens.total ?? 0),
        };
      }
      parsed = undefined;
      parseError = undefined;
      try {
        parsed = entry.parseOutput(result.rawOutput, curReq, fc.meta?.toolSchema);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
      const isLast = attempt >= LLM_INVALID_OUTPUT_RETRIES;
      const truncated = result.finishReason === "length";
      // final/question: en el último intento se acepta una salida truncada; plan/arguments nunca.
      let error: string | undefined;
      if (jsonStage) error = truncated ? TRUNCATED_ERROR : parseError;
      else error = parseError ?? (truncated && !isLast ? TRUNCATED_ERROR : undefined);
      if (!error || isLast) break;
      retryErrors.push(error);
      curReq = {
        ...req,
        user: req.user + retryNote(error),
        maxTokens: Math.ceil(req.maxTokens * RETRY_TOKEN_FACTOR),
        // Como producción: el reintento de `final` va sin thinking (un final vacío suele ser thinking que agotó el presupuesto).
        thinking: req.retryThinking ?? req.thinking,
        // Como producción: el reintento nunca baja la temperatura que fijó el request (p. ej. `params.temperature` de una variante).
        temperature: Math.max(RETRY_TEMPERATURE, req.temperature),
      };
      result = await client.call(curReq, resolveGenerativeTimeout(cfg, curReq.thinking), callCtx);
      durationMs += result.durationMs;
    } else break;
  }

  // `requestHash` es el del primer request (identifica el prompt del caso y no varía si hubo reintento); `rawInput` y
  // `requestParams` describen el último intento, el que produjo `rawOutput` (o el que falló).
  const usedBody = client.prepare(curReq).body;
  const requestParams = paramsOf(curReq);

  if (!result.ok) {
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
      requestParams,
    });
  }

  collector.check("client_call_ok", true, "");
  const rawOutput = result.rawOutput;
  const parseOk = parseError === undefined;
  if (!parseOk) collector.check("output_parse_ok", false, parseError as string);
  if (parseOk) collector.check("output_parse_ok", true, "");
  measurements.attempts = retryErrors.length + 1;
  retryErrors.forEach((e, i) => warnings.push(`Reintento ${i + 1} por salida inválida: ${e}`));

  const ctx = { rawOutput, finishReason: result.finishReason, durationMs };
  gradeWithGuard(entry, parsed, fc.expect, ctx, collector, metrics);

  // Como producción (6b): los argumentos generados pasan por el pre-chequeo determinista, con el `kind` y las fuentes del escenario.
  // Solo con el cliente real: `mock` y `oracle` fabrican valores (`"mock"`) sin origen en la tarea, y la regla del pre-chequeo es justo
  // que cada ruta/URL salga de la solicitud o de resultados previos; no tiene sentido exigírsela a una salida sintética.
  if (
    cfg.client === "real" && fc.stage === "arguments" && parsed !== undefined &&
    fc.meta?.toolName !== undefined && fc.meta.environment !== undefined && fc.meta.precheck !== undefined
  ) {
    // Como producción (refs sin resolver): una ref que no existe en el escenario es inventada, haya o no `allowedRefTokens`.
    const unknownRefs = usedRefIds(collectStrings((parsed as { args: Record<string, unknown> }).args))
      .filter((id) => !fc.meta!.precheck!.refIds.includes(id));
    collector.check("refs_exist", unknownRefs.length === 0, `Usa refs que no existen en el escenario: ${[...new Set(unknownRefs)].map((id) => `{{ref:${id}}}`).join(", ")}`);
    const finding = await precheckCall({
      tool: fc.meta.toolName,
      kind: fc.meta.precheck.kind,
      args: argsWithoutRefs((parsed as { args: Record<string, unknown> }).args),
      sources: fc.meta.precheck.sources,
      environment: fc.meta.environment,
    }, cachedAnalyze);
    collector.check("precheck_ok", finding === null, `El pre-chequeo de producción rechazaría estos argumentos: ${finding?.reason}`);
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

function buildBase(x: BaseRecord): BaseRecord { return x; }

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
    tokens?: { prompt?: number; completion?: number; total?: number };
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
  /** La variante: aporta cómo leer las respuestas (`read`) y los parámetros; los casos ya traen sus prompts. */
  variant: Variant;
  variantSpec: string;
  cfg: EvalConfig;
  genClient: GenerativeClient;
  decClient: DecisionClient;
  stageFilter: StageName[];     // vacío = todos
  onRecord?: (record: RunRecord) => void;
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
    genClient, decClient, stageFilter, onRecord, dryRun = false,
  } = input;

  // Filtrar por etapa
  const filtered = stageFilter.length > 0
    ? cases.filter((c) => stageFilter.includes(c.stage as StageName))
    : cases;

  // Generar tareas: por caso × repetición × expansión de thinking
  const tasks: RunTask[] = [];
  for (const fc of filtered) {
    // Determinar si la variante fija thinking (para generativas)
    let variantFixedThinking: boolean | undefined;
    if (!(DECISION_STAGES as readonly string[]).includes(fc.stage)) {
      variantFixedThinking = variant.params?.[fc.stage as GenerativeStage]?.thinking;
    }

    const caseThinking = fc.request.type === "generative" ? fc.request.thinking : false;
    const expansions = expandThinking(fc.stage as StageName, caseThinking, cfg, variantFixedThinking);

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
    // Detectar fallo de red
    if (!dryRun && result.record.metrics.client_call_ok === false) {
      const err = result.record.errors[result.record.errors.length - 1] ?? "";
      if (isTransportError(err)) networkFailCount++;
    }
    // Solo cuentan las corridas que llamaron al cliente: un desborde de contexto se rechaza antes de enviar.
    if (!dryRun && result.record.metrics.client_call_ok !== undefined) callCount++;
    onRecord?.(result.record);
    return result.record;
  });

  const records = await runWithConcurrency(fns, cfg.concurrency);

  return {
    records,
    allNetworkFailed: callCount > 0 && networkFailCount === callCount,
  };
}