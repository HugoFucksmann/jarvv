/**
 * JARVIS Lab — Runner de Benchmarks
 *
 * Ejecución secuencial de repeticiones sobre los casos de una etapa.
 * NO importa de src/. Solo importa de ./types.ts y ./adapter.ts.
 *
 * Uso:
 *   npx tsx lab/run.ts <etapa> <stable|variantId> [--split dev|test]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  argumentsStage,
  assertStageImplemented,
  decisionOneStage,
  decisionTwoStage,
  eosStage,
  finalResponseStage,
  planStage,
  replanStage,
  stageVerificationStage,
  stepVerificationStage,
  warmupQwen,
  LabConnectionError,
  LabValidationError,
} from "./adapter.ts";
import {
  NOUL_APPROVE,
  type CaseCheck,
  type CaseInputArguments,
  type CaseInputDecisionOne,
  type CaseInputEos,
  type CaseInputQwen,
  type CaseRunResult,
  type CheckChoiceEquals,
  type CheckNoulApproved,
  type CheckResult,
  type FidelityWarning,
  type LabCase,
  type ModelParametersRecord,
  type RunRepetition,
  type RunResult,
  type RunResultSummary,
  type Split,
  type Stage,
  type VariantDecisionEos,
  type VariantStepVerification,
  type WarmupResult,
} from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LabConfig {
  repetitions?: Record<string, number>;
}

function loadConfig(): LabConfig {
  const configPath = path.resolve(__dirname, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // Fallback
    }
  }
  return {};
}

function getRepetitions(stage: string): number {
  const cfg = loadConfig();
  if (cfg.repetitions) {
    if (typeof cfg.repetitions[stage] === "number") return cfg.repetitions[stage];
    if (typeof cfg.repetitions.default === "number") return cfg.repetitions.default;
  }
  if (stage === "decision_one" || stage === "decision_two" || stage === "step_verification") {
    return 1;
  }
  return 3;
}

function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function getByPath(obj: any, pathStr: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = pathStr.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function evaluateChecks(
  checks: CaseCheck[],
  parsedOutput: any,
  jsonValid: boolean,
  schemaValid: boolean,
  schemaError?: string
): CheckResult[] {
  const results: CheckResult[] = [];

  for (const check of checks) {
    if (check.type === "valid_json") {
      results.push({
        check: "valid_json",
        passed: jsonValid,
        message: jsonValid ? undefined : "La salida no es un JSON válido.",
      });
      continue;
    }

    if (check.type === "matches_schema") {
      results.push({
        check: "matches_schema",
        passed: schemaValid,
        message: schemaValid ? undefined : (schemaError || "Los argumentos no cumplen el schema."),
      });
      continue;
    }

    if (check.type === "choice_equals") {
      const qKey = check.questionKey || "route";
      const choice = parsedOutput?.answers?.[qKey]?.choice;
      const passed = choice === check.expected;
      results.push({
        check: `choice_equals(${qKey} === "${check.expected}")`,
        passed,
        message: passed ? undefined : `Se esperaba choice="${check.expected}", recibido="${choice ?? "indefinido"}"`,
      });
      continue;
    }

    if (check.type === "noul_approved") {
      const qKey = check.questionKey;
      const noulProb = parsedOutput?.answers?.[qKey]?.noul;
      const isApproved = typeof noulProb === "number" && noulProb > NOUL_APPROVE;
      const passed = isApproved === check.expected;
      results.push({
        check: `noul_approved(${qKey} === ${check.expected})`,
        passed,
        message: passed
          ? undefined
          : `Se esperaba ${qKey} aprobado=${check.expected}, pero p=${noulProb !== undefined ? noulProb : "indefinido"} (aprobado=${isApproved})`,
      });
      continue;
    }

    if (check.type === "field_equals") {
      const actualVal = getByPath(parsedOutput, check.path);
      const passed = JSON.stringify(actualVal) === JSON.stringify(check.expected);
      results.push({
        check: `field_equals(${check.path} === ${JSON.stringify(check.expected)})`,
        passed,
        message: passed
          ? undefined
          : `Campo '${check.path}' esperado: ${JSON.stringify(check.expected)}, recibido: ${JSON.stringify(actualVal)}`,
      });
      continue;
    }

    if (check.type === "status_equals") {
      const actualStatus = parsedOutput?.status;
      const passed = actualStatus === check.expected;
      results.push({
        check: `status_equals("${check.expected}")`,
        passed,
        message: passed
          ? undefined
          : `Status esperado: "${check.expected}", recibido: "${actualStatus ?? "indefinido"}"`,
      });
      continue;
    }

    if (check.type === "has_question_for_user") {
      const q = parsedOutput?.question_for_user;
      const hasQ = typeof q === "string" && q.trim().length > 0;
      const passed = hasQ === check.expected;
      results.push({
        check: `has_question_for_user(${check.expected})`,
        passed,
        message: passed
          ? undefined
          : `Se esperaba pregunta al usuario=${check.expected}, recibido question_for_user=${JSON.stringify(q ?? "")}`,
      });
      continue;
    }

    if (check.type === "action_equals") {
      const actualAction = parsedOutput?.action;
      const passed = actualAction === check.expected;
      results.push({
        check: `action_equals("${check.expected}")`,
        passed,
        message: passed
          ? undefined
          : `Acción esperada: "${check.expected}", recibida: "${actualAction ?? "indefinida"}"`,
      });
      continue;
    }

    if (check.type === "min_steps") {
      const steps = Array.isArray(parsedOutput?.steps) ? parsedOutput.steps : [];
      const passed = steps.length >= check.count;
      results.push({
        check: `min_steps(>= ${check.count})`,
        passed,
        message: passed ? undefined : `Pasos mínimos requeridos: ${check.count}, pasos generados: ${steps.length}`,
      });
      continue;
    }

    if (check.type === "max_steps") {
      const steps = Array.isArray(parsedOutput?.steps) ? parsedOutput.steps : [];
      const passed = steps.length <= check.count;
      results.push({
        check: `max_steps(<= ${check.count})`,
        passed,
        message: passed ? undefined : `Pasos máximos permitidos: ${check.count}, pasos generados: ${steps.length}`,
      });
      continue;
    }

    if (check.type === "routes_allowed") {
      const allowed = check.allowedRoutes || ["files", "locate", "terminal", "web"];
      const steps = Array.isArray(parsedOutput?.steps) ? parsedOutput.steps : [];
      const routes = steps.map((s: any) => s.route || s.suggested_mcp);
      const invalidRoutes = routes.filter((r: any) => typeof r !== "string" || !allowed.includes(r));
      const passed = steps.length === 0 || invalidRoutes.length === 0;
      results.push({
        check: `routes_allowed([${allowed.join(", ")}])`,
        passed,
        message: passed
          ? undefined
          : `Rutas no permitidas detectadas: [${invalidRoutes.join(", ")}]. Rutas en plan: [${routes.join(", ")}]`,
      });
      continue;
    }

    if (check.type === "contains_text") {
      const text = typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput ?? "");
      const missing = check.keywords.filter((kw) =>
        check.caseSensitive ? !text.includes(kw) : !text.toLowerCase().includes(kw.toLowerCase())
      );
      const passed = missing.length === 0;
      results.push({
        check: `contains_text([${check.keywords.join(", ")}])`,
        passed,
        message: passed ? undefined : `Faltan las siguientes palabras en la salida: [${missing.join(", ")}]`,
      });
      continue;
    }

    if (check.type === "not_empty") {
      const passed =
        parsedOutput !== null &&
        parsedOutput !== undefined &&
        (typeof parsedOutput === "string"
          ? parsedOutput.trim().length > 0
          : Object.keys(parsedOutput).length > 0);
      results.push({
        check: "not_empty",
        passed,
        message: passed ? undefined : "La salida está vacía.",
      });
      continue;
    }

    if (check.type === "min_length") {
      const str =
        typeof parsedOutput === "string"
          ? parsedOutput
          : typeof parsedOutput?.response === "string"
          ? parsedOutput.response
          : JSON.stringify(parsedOutput ?? "");
      const passed = str.length >= check.minChars;
      results.push({
        check: `min_length(>= ${check.minChars})`,
        passed,
        message: passed ? undefined : `Longitud mínima esperada: ${check.minChars}, caracteres actuales: ${str.length}`,
      });
      continue;
    }
  }

  return results;
}

async function loadVariant(stage: Stage, variantId: string): Promise<{ content: any; rawText: string }> {
  if (
    stage === "arguments" ||
    stage === "stage_verification" ||
    stage === "plan" ||
    stage === "replan" ||
    stage === "final_response"
  ) {
    const ext = variantId.endsWith(".md") ? "" : ".md";
    const filePath = path.resolve(__dirname, "prompts", "variants", stage, `${variantId}${ext}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo de variante en: ${filePath}`);
    }
    const rawText = fs.readFileSync(filePath, "utf-8");
    if (!rawText.trim()) {
      throw new Error(`El archivo de variante '${filePath}' está vacío.`);
    }
    return { content: rawText, rawText };
  }

  if (stage === "decision_one" || stage === "decision_two" || stage === "step_verification") {
    const ext = variantId.endsWith(".json") ? "" : ".json";
    const filePath = path.resolve(__dirname, "prompts", "variants", stage, `${variantId}${ext}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo de variante en: ${filePath}`);
    }
    const rawText = fs.readFileSync(filePath, "utf-8");
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`El archivo de variante '${filePath}' no es un JSON legible.`);
    }
    return { content: parsed, rawText };
  }

  throw new Error(`Carga de variante no soportada para etapa '${stage}'.`);
}

function findCases(stage: Stage, targetSplit?: Split): { runnable: LabCase[]; pending: LabCase[] } {
  const casesDir = path.resolve(__dirname, "cases", stage);
  if (!fs.existsSync(casesDir)) {
    return { runnable: [], pending: [] };
  }

  const runnable: LabCase[] = [];
  const pending: LabCase[] = [];

  const files = fs.readdirSync(casesDir);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(casesDir, file);
    try {
      const caseData: LabCase = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      if (targetSplit && caseData.split !== targetSplit) {
        continue;
      }
      if (caseData.expect === null) {
        pending.push(caseData);
      } else {
        runnable.push(caseData);
      }
    } catch (e) {
      console.warn(`[run] No se pudo leer el caso '${fullPath}':`, e);
    }
  }

  return { runnable, pending };
}

export async function runBenchmark(
  stageInput: string,
  targetPrompt: string,
  targetSplit?: Split,
  targetCaseId?: string
): Promise<RunResult> {
  assertStageImplemented(stageInput);
  const stage = stageInput.toLowerCase() as Stage;
  const isStable = targetPrompt.toLowerCase() === "stable";
  const variantId = isStable ? undefined : targetPrompt;

  const repetitions = getRepetitions(stage);

  console.log(`\n============================================================`);
  console.log(`JARVIS Lab Benchmark: ${stage} [${isStable ? "STABLE" : `VARIANTE: ${variantId}`}]`);
  console.log(`Split filtrado: ${targetSplit ?? "todos"}${targetCaseId ? ` | Caso: ${targetCaseId}` : ""} | Repeticiones por caso: ${repetitions}`);
  console.log(`============================================================\n`);

  // Cargar variante si aplica
  let variantData: { content: any; rawText: string } | undefined;
  if (!isStable && variantId) {
    variantData = await loadVariant(stage, variantId);
    console.log(`Variante cargada exitosamente: ${variantId}`);
  }

  // Buscar casos
  let { runnable, pending } = findCases(stage, targetSplit);

  if (targetCaseId) {
    const matched = runnable.filter((c) => c.id === targetCaseId);
    if (matched.length > 0) {
      runnable = matched;
    } else {
      const isPending = pending.some((c) => c.id === targetCaseId);
      if (isPending) {
        throw new Error(`El caso '${targetCaseId}' está en estado pendiente ('expect: null') y no puede ejecutarse.`);
      }
      throw new Error(`No se encontró el caso '${targetCaseId}' en la etapa '${stage}'.`);
    }
  }

  if (pending.length > 0 && !targetCaseId) {
    console.log(`ℹ Casos con 'expect: null' (omitidos/pendientes de verificación):`);
    for (const p of pending) {
      console.log(`  - [PENDIENTE] ${p.id} (split: ${p.split || "dev"})`);
    }
  }

  if (runnable.length === 0) {
    console.warn(`\n[run] No se encontraron casos con expectativas activas para correr en '${stage}'.`);
    throw new Error(`Sin casos ejecutables para la etapa '${stage}'.`);
  }

  // Validación previa para variantes de decision_two:
  // Es error si una variante con criterios definidos no coincide con ninguna herramienta de ningún caso
  if (!isStable && stage === "decision_two" && variantData?.content?.questions?.selected_tool?.criteria) {
    const varToolNames = Object.keys(variantData.content.questions.selected_tool.criteria);
    if (varToolNames.length > 0) {
      let matchedAcrossAnyCase = false;
      for (const c of runnable) {
        const caseQuestions = (c.input as CaseInputEos)?.questions;
        const caseCriteria = (caseQuestions?.selected_tool as any)?.criteria || {};
        if (varToolNames.some((t) => Object.hasOwn(caseCriteria, t))) {
          matchedAcrossAnyCase = true;
          break;
        }
      }
      if (!matchedAcrossAnyCase) {
        throw new LabValidationError(
          `La variante de decision_two no coincide con ninguna herramienta de ningún caso evaluado. Herramientas en variante: ${varToolNames.join(", ")}.`
        );
      }
    }
  }

  console.log(`\nIniciando corrida sobre ${runnable.length} caso(s) activos...\n`);

  const isEos = stage === "decision_one" || stage === "decision_two" || stage === "step_verification";
  const isQwen =
    stage === "arguments" ||
    stage === "stage_verification" ||
    stage === "plan" ||
    stage === "replan" ||
    stage === "final_response";

  const qwenStageHandlers = {
    arguments: argumentsStage,
    stage_verification: stageVerificationStage,
    plan: planStage,
    replan: replanStage,
    final_response: finalResponseStage,
  };
  const qwenHandler = isQwen ? qwenStageHandlers[stage as keyof typeof qwenStageHandlers] : undefined;

  // Calentamiento (Warmup) — llamada mínima sin pensamiento descartada de las métricas
  console.log(`Ejecutando llamada de calentamiento (warmup) para '${stage}'...`);
  let warmupResult: WarmupResult | undefined;
  try {
    const tWarmup0 = Date.now();
    if (isQwen) {
      const warmupRes = await warmupQwen();
      warmupResult = { latencyMs: warmupRes.latencyMs, ok: true };
      console.log(`✓ Warmup Qwen completado en ${warmupRes.latencyMs}ms (descartado de las métricas).\n`);
    } else if (isEos) {
      const warmupInput = runnable[0].input as CaseInputEos;
      const promptRes = variantData
        ? eosStage.applyVariant(stage, warmupInput, variantData.content, runnable[0].id)
        : { state: warmupInput.state, questions: warmupInput.questions };
      await eosStage.callModel(promptRes.state, promptRes.questions);
      const warmupLatencyMs = Date.now() - tWarmup0;
      warmupResult = { latencyMs: warmupLatencyMs, ok: true };
      console.log(`✓ Warmup Eos completado en ${warmupLatencyMs}ms (descartado de las métricas).\n`);
    }
  } catch (err: any) {
    if (err instanceof LabConnectionError && err.isNetwork) {
      console.error(`\n[FATAL] Error de conexión irrecuperable en warmup con el endpoint de ${stage}: ${err.message}`);
      console.error(`Corrida abortada inmediatamente. No se escribió ningún archivo en lab/results/.\n`);
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    warmupResult = { latencyMs: 0, ok: false, error: errMsg };
    console.warn(`⚠ Warmup falló (${errMsg}), continuando con la medición...\n`);
  }

  const initialModelParams = isEos
    ? eosStage.getModelParameters()
    : qwenHandler!.getModelParameters();

  const casePromptHashes: Record<string, string> = {};
  let stablePromptHash = "";

  if (isQwen && qwenHandler) {
    stablePromptHash = crypto
      .createHash("sha256")
      .update(qwenHandler.getStableSystemPrompt())
      .digest("hex")
      .slice(0, 16);
  } else if (isEos) {
    const sortedCases = [...runnable].sort((a, b) => a.id.localeCompare(b.id));
    for (const c of sortedCases) {
      const stablePrompt = eosStage.getStablePrompt(c.input as CaseInputEos);
      const cHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(stablePrompt))
        .digest("hex")
        .slice(0, 16);
      casePromptHashes[c.id] = cHash;
    }
    const globalStableStr = sortedCases.map((c) => `${c.id}:${casePromptHashes[c.id]}`).join("|");
    stablePromptHash = crypto
      .createHash("sha256")
      .update(globalStableStr)
      .digest("hex")
      .slice(0, 16);
  }

  const effectivePromptsByCase: Record<string, unknown> = {};
  const caseResults: CaseRunResult[] = [];
  const fidelityWarnings: FidelityWarning[] = [];
  let totalRepetitions = 0;
  let successfulRepetitions = 0;
  let totalLatencyMs = 0;
  let jsonErrors = 0;
  let schemaErrors = 0;
  let truncatedCount = 0;
  let lastModelParams: ModelParametersRecord = initialModelParams;

  for (const [caseIdx, caseItem] of runnable.entries()) {
    console.log(`[${caseIdx + 1}/${runnable.length}] Caso: ${caseItem.id} (split: ${caseItem.split})`);
    const reps: RunRepetition[] = [];
    let passedReps = 0;
    let caseLatencySum = 0;

    for (let rep = 1; rep <= repetitions; rep++) {
      totalRepetitions++;
      let repRawOutput = "";
      let repParsedOutput: any = null;
      let repLatency = 0;
      let repError: string | undefined;
      let checkResults: CheckResult[] = [];
      let allPassed = false;
      let expectedChoiceProb: number | undefined;
      let repNoulProbs: Record<string, number> | undefined;
      let repNoulApproved: boolean | undefined;
      let repPlanStepCount: number | undefined;
      let repPlanRoutes: string[] | undefined;
      let repReplanAction: "continue" | "abort" | undefined;
      let repStageVerificationStatus: string | undefined;
      let repFinalResponseText: string | undefined;

      try {
        if (isQwen && qwenHandler) {
          const input = caseItem.input as CaseInputQwen;
          const { systemPrompt, userPrompt } = qwenHandler.preparePrompt(
            input,
            variantData ? variantData.rawText : undefined
          );

          // Chequeo de fidelidad para Qwen en prompt estable (primera repetición) con soporte B2
          if (rep === 1 && isStable) {
            const liveSystem = qwenHandler.getStableSystemPrompt();
            if (input.system && input.system.trim() !== liveSystem.trim()) {
              const msg = `El prompt SYSTEM vivo de prompts.ts difiere del grabado en la traza (el caso puede ser anterior a un cambio en prompts.ts).`;
              console.warn(`⚠ [FIDELIDAD] Desviación en SYSTEM (caso ${caseItem.id}): ${msg}`);
              fidelityWarnings.push({
                caseId: caseItem.id,
                parameter: "system",
                recorded: input.system,
                current: liveSystem,
                message: msg,
              });
            }

            const rec = caseItem.reference?.recordedParams;
            if (!rec || Object.keys(rec).length === 0) {
              const msg = "sin recordedParams: no se pudo verificar la fidelidad";
              console.warn(`⚠ [FIDELIDAD] Caso ${caseItem.id}: ${msg}`);
              fidelityWarnings.push({
                caseId: caseItem.id,
                parameter: "recordedParams",
                recorded: null,
                current: initialModelParams,
                message: msg,
              });
            } else {
              if (rec.temperature !== undefined && rec.temperature !== initialModelParams.temperature) {
                const msg = `temperature grabado=${rec.temperature} vs adapter=${initialModelParams.temperature}`;
                console.warn(`⚠ [FIDELIDAD] Desviación en parámetro (caso ${caseItem.id}): ${msg}`);
                fidelityWarnings.push({
                  caseId: caseItem.id,
                  parameter: "temperature",
                  recorded: rec.temperature,
                  current: initialModelParams.temperature,
                  message: msg,
                });
              }
              if (rec.max_tokens !== undefined && rec.max_tokens !== initialModelParams.maxTokens) {
                const msg = `max_tokens grabado=${rec.max_tokens} vs adapter=${initialModelParams.maxTokens}`;
                console.warn(`⚠ [FIDELIDAD] Desviación en parámetro (caso ${caseItem.id}): ${msg}`);
                fidelityWarnings.push({
                  caseId: caseItem.id,
                  parameter: "max_tokens",
                  recorded: rec.max_tokens,
                  current: initialModelParams.maxTokens,
                  message: msg,
                });
              }
              if (rec.reasoning_effort !== undefined && rec.reasoning_effort !== initialModelParams.reasoningEffort) {
                const msg = `reasoning_effort grabado=${rec.reasoning_effort} vs adapter=${initialModelParams.reasoningEffort}`;
                console.warn(`⚠ [FIDELIDAD] Desviación en parámetro (caso ${caseItem.id}): ${msg}`);
                fidelityWarnings.push({
                  caseId: caseItem.id,
                  parameter: "reasoning_effort",
                  recorded: rec.reasoning_effort,
                  current: initialModelParams.reasoningEffort,
                  message: msg,
                });
              }
            }
          }

          console.log(`   Rep ${rep}/${repetitions}: ejecutando llamada al modelo...`);
          const callRes = await qwenHandler.callModel(systemPrompt, userPrompt);
          lastModelParams = callRes.params;
          repRawOutput = callRes.rawOutput;
          repLatency = callRes.latencyMs;
          if (callRes.truncated) truncatedCount++;

          let valRes: {
            parsedJson: Record<string, unknown> | null;
            jsonValid: boolean;
            schemaValid: boolean;
            schemaError?: string;
          };

          if (stage === "arguments") {
            const hasMatchesSchemaCheck = caseItem.expect?.some((c) => c.type === "matches_schema");
            const isSchemaMissingOrEmpty = !input.schema || Object.keys(input.schema).length === 0;

            valRes = argumentsStage.parseAndValidate(callRes.parsedContent, input.schema ?? {});
            if (!valRes.jsonValid) jsonErrors++;

            if (hasMatchesSchemaCheck && isSchemaMissingOrEmpty) {
              valRes.schemaValid = false;
              valRes.schemaError =
                "El caso requiere check 'matches_schema' pero no tiene schema definido (o quedó vacío por fallo de extracción).";
            }
          } else if (stage === "final_response") {
            const finalRes = finalResponseStage.parseAndValidate(callRes.parsedContent, callRes.truncated);
            valRes = {
              parsedJson: finalRes.parsedJson,
              jsonValid: finalRes.jsonValid,
              schemaValid: finalRes.schemaValid,
              schemaError: finalRes.schemaError,
            };
            repFinalResponseText = finalRes.text;
          } else {
            valRes = (qwenHandler as any).parseAndValidate(callRes.parsedContent);
            if (!valRes.jsonValid) jsonErrors++;
          }

          if (valRes.jsonValid && !valRes.schemaValid) schemaErrors++;

          repParsedOutput = valRes.parsedJson;
          checkResults = evaluateChecks(
            caseItem.expect || [],
            valRes.parsedJson,
            valRes.jsonValid,
            valRes.schemaValid,
            valRes.schemaError
          );

          allPassed = checkResults.length > 0 && checkResults.every((c) => c.passed);
          if (allPassed) {
            passedReps++;
            successfulRepetitions++;
          }

          if (stage === "plan" || stage === "replan") {
            if (Array.isArray(valRes.parsedJson?.steps)) {
              repPlanStepCount = valRes.parsedJson.steps.length;
              repPlanRoutes = valRes.parsedJson.steps.map((s: any) => s.route || s.suggested_mcp);
            }
            if (stage === "replan") {
              repReplanAction = valRes.parsedJson?.action as any;
            }
          } else if (stage === "stage_verification") {
            repStageVerificationStatus = typeof valRes.parsedJson?.status === "string" ? valRes.parsedJson.status : undefined;
          }

          reps.push({
            rep,
            latencyMs: repLatency,
            rawOutput: repRawOutput,
            parsedOutput: repParsedOutput,
            checks: checkResults,
            allPassed,
            planStepCount: repPlanStepCount,
            planRoutes: repPlanRoutes,
            replanAction: repReplanAction,
            stageVerificationStatus: repStageVerificationStatus,
            finalResponseText: repFinalResponseText,
            error: repError,
            finishReason: callRes.finishReason,
            usage: callRes.usage,
            truncated: callRes.truncated,
          });
        } else if (isEos) {
          const input = caseItem.input as CaseInputEos;
          const promptRes = variantData
            ? eosStage.applyVariant(stage, input, variantData.content, caseItem.id)
            : { state: input.state, questions: input.questions };

          effectivePromptsByCase[caseItem.id] = promptRes.questions;

          console.log(`   Rep ${rep}/${repetitions}: ejecutando llamada a Eos...`);
          const callRes = await eosStage.callModel(promptRes.state, promptRes.questions);
          lastModelParams = callRes.params;
          repRawOutput = callRes.rawOutput;
          repLatency = callRes.latencyMs;

          const parseRes = eosStage.parseOutput(callRes.rawOutput, promptRes.questions);
          if (!parseRes.jsonValid) jsonErrors++;
          if (parseRes.jsonValid && !parseRes.schemaValid) schemaErrors++;

          repParsedOutput = parseRes.answers ? { answers: parseRes.answers } : null;
          checkResults = evaluateChecks(
            caseItem.expect || [],
            repParsedOutput,
            parseRes.jsonValid,
            parseRes.schemaValid,
            parseRes.error
          );

          allPassed = checkResults.length > 0 && checkResults.every((c) => c.passed);
          if (allPassed) {
            passedReps++;
            successfulRepetitions++;
          }

          // Captura de métricas por etapa Eos:
          if (stage === "decision_one" || stage === "decision_two") {
            const choiceCheck = caseItem.expect?.find((c) => c.type === "choice_equals") as CheckChoiceEquals | undefined;
            if (choiceCheck && repParsedOutput?.answers) {
              const defaultKey = stage === "decision_two" ? "selected_tool" : "route";
              const qKey = choiceCheck.questionKey || defaultKey;
              const probs = repParsedOutput.answers[qKey]?.probabilities;
              if (probs && typeof probs[choiceCheck.expected] === "number") {
                expectedChoiceProb = probs[choiceCheck.expected];
              }
            }
          } else if (stage === "step_verification") {
            const okVal = repParsedOutput?.answers?.ok?.noul;
            const cumpleVal = repParsedOutput?.answers?.cumple?.noul;
            if (typeof okVal === "number" || typeof cumpleVal === "number") {
              repNoulProbs = {};
              if (typeof okVal === "number") repNoulProbs.ok = okVal;
              if (typeof cumpleVal === "number") repNoulProbs.cumple = cumpleVal;
              repNoulApproved = typeof okVal === "number" && okVal > NOUL_APPROVE && typeof cumpleVal === "number" && cumpleVal > NOUL_APPROVE;
            }
          }

          reps.push({
            rep,
            latencyMs: repLatency,
            rawOutput: repRawOutput,
            parsedOutput: repParsedOutput,
            checks: checkResults,
            allPassed,
            expectedChoiceProbability: expectedChoiceProb,
            noulProbabilities: repNoulProbs,
            noulApproved: repNoulApproved,
            error: repError,
          });
        }
      } catch (err: any) {
        if (err instanceof LabConnectionError && err.isNetwork) {
          console.error(`\n[FATAL] Error de conexión irrecuperable con el endpoint de ${stage}: ${err.message}`);
          console.error(`Corrida abortada inmediatamente. No se escribió ningún archivo en lab/results/.\n`);
          throw err;
        }
        repError = err instanceof Error ? err.message : String(err);
        console.error(`   Repetición ${rep}/${repetitions} FALLÓ con error: ${repError}`);
        reps.push({
          rep,
          latencyMs: repLatency,
          rawOutput: repRawOutput,
          parsedOutput: repParsedOutput,
          checks: checkResults,
          allPassed: false,
          error: repError,
        });
      }

      caseLatencySum += repLatency;
      totalLatencyMs += repLatency;

      const repStatus = allPassed ? "✓ Acierto" : "✗ Fallo";
      let extraInfo = "";
      if (expectedChoiceProb !== undefined) {
        extraInfo = ` [p=${(expectedChoiceProb * 100).toFixed(1)}%]`;
      } else if (repNoulProbs) {
        const okP = repNoulProbs.ok !== undefined ? `ok=${(repNoulProbs.ok * 100).toFixed(1)}%` : "";
        const cP = repNoulProbs.cumple !== undefined ? `cumple=${(repNoulProbs.cumple * 100).toFixed(1)}%` : "";
        extraInfo = ` [${[okP, cP].filter(Boolean).join(", ")} | ${repNoulApproved ? "APROBADO" : "RECHAZADO"}]`;
      } else if (repPlanStepCount !== undefined) {
        const routesStr = repPlanRoutes ? ` -> [${repPlanRoutes.join(", ")}]` : "";
        extraInfo = ` [pasos=${repPlanStepCount}${routesStr}${repReplanAction ? ` | action=${repReplanAction}` : ""}]`;
      } else if (repStageVerificationStatus !== undefined) {
        extraInfo = ` [status=${repStageVerificationStatus}]`;
      }
      console.log(`   Rep ${rep}/${repetitions}: ${repStatus} (${repLatency}ms)${extraInfo}`);
    }

    const caseLatencies = reps.map((r) => r.latencyMs);
    const avgCaseLatency = Math.round(caseLatencySum / repetitions);
    const medianCaseLatency = calculateMedian(caseLatencies);

    // Promedios por caso
    const probList = reps
      .map((r) => r.expectedChoiceProbability)
      .filter((p): p is number => typeof p === "number");
    const caseExpectedChoiceProb =
      probList.length > 0
        ? Number((probList.reduce((acc, v) => acc + v, 0) / probList.length).toFixed(4))
        : undefined;

    let caseNoulProbs: Record<string, number> | undefined;
    let caseNoulApproved: boolean | undefined;

    if (stage === "step_verification") {
      const okList = reps.map((r) => r.noulProbabilities?.ok).filter((p): p is number => typeof p === "number");
      const cumpleList = reps.map((r) => r.noulProbabilities?.cumple).filter((p): p is number => typeof p === "number");
      if (okList.length > 0 || cumpleList.length > 0) {
        caseNoulProbs = {};
        if (okList.length > 0) {
          caseNoulProbs.ok = Number((okList.reduce((acc, v) => acc + v, 0) / okList.length).toFixed(4));
        }
        if (cumpleList.length > 0) {
          caseNoulProbs.cumple = Number((cumpleList.reduce((acc, v) => acc + v, 0) / cumpleList.length).toFixed(4));
        }
        caseNoulApproved =
          (caseNoulProbs.ok ?? 0) > NOUL_APPROVE && (caseNoulProbs.cumple ?? 0) > NOUL_APPROVE;
      }
    }

    const lastRep = reps[reps.length - 1];
    caseResults.push({
      caseId: caseItem.id,
      split: caseItem.split,
      passedReps,
      totalReps: repetitions,
      avgLatencyMs: avgCaseLatency,
      medianLatencyMs: medianCaseLatency,
      expectedChoiceProbability: caseExpectedChoiceProb,
      noulProbabilities: caseNoulProbs,
      noulApproved: caseNoulApproved,
      planStepCount: lastRep?.planStepCount,
      planRoutes: lastRep?.planRoutes,
      replanAction: lastRep?.replanAction,
      stageVerificationStatus: lastRep?.stageVerificationStatus,
      finalResponseText: reps[0]?.finalResponseText,
      repetitions: reps,
    });

    let caseSummaryMsg = "";
    if (caseExpectedChoiceProb !== undefined) {
      caseSummaryMsg = ` (p_media: ${(caseExpectedChoiceProb * 100).toFixed(1)}%)`;
    } else if (caseNoulProbs) {
      const okStr = caseNoulProbs.ok !== undefined ? `ok: ${(caseNoulProbs.ok * 100).toFixed(1)}%` : "";
      const cStr = caseNoulProbs.cumple !== undefined ? `cumple: ${(caseNoulProbs.cumple * 100).toFixed(1)}%` : "";
      caseSummaryMsg = ` (${[okStr, cStr].filter(Boolean).join(", ")} | ${caseNoulApproved ? "APROBADO" : "RECHAZADO"})`;
    } else if (lastRep?.planStepCount !== undefined) {
      caseSummaryMsg = ` (pasos: ${lastRep.planStepCount}${lastRep.replanAction ? `, action: ${lastRep.replanAction}` : ""})`;
    } else if (lastRep?.stageVerificationStatus !== undefined) {
      caseSummaryMsg = ` (status: ${lastRep.stageVerificationStatus})`;
    } else if (lastRep?.finalResponseText !== undefined) {
      caseSummaryMsg = ` (${lastRep.finalResponseText.length} caracteres)`;
    }
    console.log(`   Resultado caso: ${passedReps}/${repetitions} aciertos (latencia media: ${avgCaseLatency}ms, mediana: ${medianCaseLatency}ms)${caseSummaryMsg}\n`);
  }

  const successRatePct = Number(((successfulRepetitions / totalRepetitions) * 100).toFixed(1));
  const avgLatencyMs = Math.round(totalLatencyMs / Math.max(1, totalRepetitions));
  const allLatencies = caseResults.flatMap((c) => c.repetitions.map((r) => r.latencyMs));
  const medianLatencyMs = calculateMedian(allLatencies);

  const summary: RunResultSummary = {
    totalCasesRun: runnable.length,
    pendingCasesSkipped: pending.length,
    totalRepetitions,
    successfulRepetitions,
    successRatePct,
    avgLatencyMs,
    medianLatencyMs,
    jsonErrors,
    schemaErrors,
    truncatedCount: isQwen ? truncatedCount : 0,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `run_${timestamp}_${stage}_${isStable ? "stable" : variantId}`;

  let promptUsedRecord: unknown;
  if (isStable) {
    promptUsedRecord = "stable";
  } else if (isEos) {
    promptUsedRecord = {
      variantId,
      effectivePromptsByCase,
      rawOverride: variantData?.content,
    };
  } else {
    promptUsedRecord = variantData ? variantData.content : null;
  }

  const finalResult: RunResult = {
    id: runId,
    timestamp: new Date().toISOString(),
    stage,
    promptType: isStable ? "stable" : "variant",
    variantId,
    split: targetSplit,
    promptUsed: promptUsedRecord,
    stablePromptHash,
    casePromptHashes: Object.keys(casePromptHashes).length > 0 ? casePromptHashes : undefined,
    modelParameters: lastModelParams,
    repetitionsConfig: repetitions,
    warmup: warmupResult,
    cases: caseResults,
    summary,
    fidelityWarnings: fidelityWarnings.length > 0 ? fidelityWarnings : undefined,
  };

  // Guardar resultado de forma atómica y sin sobrescribir (flag: wx)
  const resultsDir = path.resolve(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const resultFileName = `${timestamp}-${stage}-${isStable ? "stable" : variantId}.json`;
  const resultFilePath = path.join(resultsDir, resultFileName);

  fs.writeFileSync(resultFilePath, JSON.stringify(finalResult, null, 2), { encoding: "utf-8", flag: "wx" });

  console.log(`============================================================`);
  console.log(`RESUMEN DE CORRIDA:`);
  console.log(` - Tasa de éxito: ${successRatePct}% (${successfulRepetitions}/${totalRepetitions} repeticiones)`);
  console.log(` - Latencia promedio: ${avgLatencyMs}ms (Mediana: ${medianLatencyMs}ms)`);
  if (warmupResult) {
    console.log(` - Warmup inicial: ${warmupResult.ok ? `${warmupResult.latencyMs}ms` : `falló (${warmupResult.error})`}`);
  }
  console.log(` - Errores de JSON: ${jsonErrors}`);
  console.log(` - Errores de Schema / Validación: ${schemaErrors}`);
  if (isQwen) {
    console.log(` - Salidas truncadas (max_tokens): ${truncatedCount}`);
  }
  if (fidelityWarnings.length > 0) {
    console.log(` - Advertencias de fidelidad: ${fidelityWarnings.length}`);
  }
  console.log(` - Archivo de resultado guardado en: ${resultFilePath}`);
  console.log(`============================================================\n`);

  return finalResult;
}

// Ejecución CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Uso: npx tsx lab/run.ts <etapa> <stable|variantId> [--split dev|test] [--case <id>]");
    process.exit(1);
  }

  const stageArg = args[0];
  const targetPromptArg = args[1];

  let splitArg: Split | undefined;
  const splitIndex = args.indexOf("--split");
  if (splitIndex >= 0 && args[splitIndex + 1]) {
    const s = args[splitIndex + 1].toLowerCase();
    if (s === "dev" || s === "test") {
      splitArg = s;
    } else {
      console.error("Error: --split debe ser 'dev' o 'test'.");
      process.exit(1);
    }
  }

  let caseArg: string | undefined;
  const caseIndex = args.indexOf("--case");
  if (caseIndex >= 0 && args[caseIndex + 1]) {
    caseArg = args[caseIndex + 1];
  }

  runBenchmark(stageArg, targetPromptArg, splitArg, caseArg).catch((err) => {
    console.error(`\n[FATAL] Error en la ejecución del benchmark: ${err.message}`);
    process.exit(1);
  });
}
