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
  LabConnectionError,
} from "./adapter.ts";
import type {
  CaseCheck,
  CaseInputArguments,
  CaseInputDecisionOne,
  CaseRunResult,
  CheckResult,
  LabCase,
  ModelParametersRecord,
  RunRepetition,
  RunResult,
  RunResultSummary,
  Split,
  Stage,
  VariantDecisionOne,
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
  return 3;
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
  }

  return results;
}

async function loadVariant(stage: Stage, variantId: string): Promise<{ content: any; rawText: string }> {
  if (stage === "arguments") {
    const ext = variantId.endsWith(".md") ? "" : ".md";
    const filePath = path.resolve(__dirname, "prompts", "variants", "arguments", `${variantId}${ext}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo de variante en: ${filePath}`);
    }
    const rawText = fs.readFileSync(filePath, "utf-8");
    return { content: rawText, rawText };
  }

  if (stage === "decision_one") {
    const ext = variantId.endsWith(".json") ? "" : ".json";
    const filePath = path.resolve(__dirname, "prompts", "variants", "decision_one", `${variantId}${ext}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo de variante en: ${filePath}`);
    }
    const rawText = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(rawText) as VariantDecisionOne;
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
  targetSplit?: Split
): Promise<RunResult> {
  assertStageImplemented(stageInput);
  const stage = stageInput.toLowerCase() as Stage;
  const isStable = targetPrompt.toLowerCase() === "stable";
  const variantId = isStable ? undefined : targetPrompt;

  const repetitions = getRepetitions(stage);

  console.log(`\n============================================================`);
  console.log(`JARVIS Lab Benchmark: ${stage} [${isStable ? "STABLE" : `VARIANTE: ${variantId}`}]`);
  console.log(`Split filtrado: ${targetSplit ?? "todos"} | Repeticiones por caso: ${repetitions}`);
  console.log(`============================================================\n`);

  // Cargar variante si aplica
  let variantData: { content: any; rawText: string } | undefined;
  if (!isStable && variantId) {
    variantData = await loadVariant(stage, variantId);
    console.log(`Variante cargada exitosamente: ${variantId}`);
  }

  // Buscar casos
  const { runnable, pending } = findCases(stage, targetSplit);

  if (pending.length > 0) {
    console.log(`ℹ Casos con 'expect: null' (omitidos/pendientes de verificación):`);
    for (const p of pending) {
      console.log(`  - [PENDIENTE] ${p.id} (split: ${p.split || "dev"})`);
    }
  }

  if (runnable.length === 0) {
    console.warn(`\n[run] No se encontraron casos con expectativas activas para correr en '${stage}'.`);
    throw new Error(`Sin casos ejecutables para la etapa '${stage}'.`);
  }

  console.log(`\nIniciando corrida sobre ${runnable.length} caso(s) activos...\n`);

  const initialModelParams =
    stage === "arguments"
      ? argumentsStage.getModelParameters()
      : decisionOneStage.getModelParameters();

  const casePromptHashes: Record<string, string> = {};
  let stablePromptHash = "";

  if (stage === "arguments") {
    stablePromptHash = crypto
      .createHash("sha256")
      .update(argumentsStage.getStableSystemPrompt())
      .digest("hex")
      .slice(0, 16);
  } else if (stage === "decision_one") {
    const sortedCases = [...runnable].sort((a, b) => a.id.localeCompare(b.id));
    for (const c of sortedCases) {
      const stablePrompt = decisionOneStage.getStablePrompt(c.input as CaseInputDecisionOne);
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

      try {
        if (stage === "arguments") {
          const input = caseItem.input as CaseInputArguments;
          const { systemPrompt, userPrompt } = argumentsStage.preparePrompt(
            input,
            variantData ? variantData.rawText : undefined
          );

          const callRes = await argumentsStage.callModel(systemPrompt, userPrompt);
          lastModelParams = callRes.params;
          repRawOutput = callRes.rawOutput;
          repLatency = callRes.latencyMs;
          if (callRes.truncated) truncatedCount++;

          const valRes = argumentsStage.parseAndValidate(callRes.parsedContent, input.schema);
          if (!valRes.jsonValid) jsonErrors++;
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

          reps.push({
            rep,
            latencyMs: repLatency,
            rawOutput: repRawOutput,
            parsedOutput: repParsedOutput,
            checks: checkResults,
            allPassed,
            error: repError,
            finishReason: callRes.finishReason,
            usage: callRes.usage,
            truncated: callRes.truncated,
          });
        } else if (stage === "decision_one") {
          const input = caseItem.input as CaseInputDecisionOne;
          const prompt = variantData
            ? decisionOneStage.applyVariant(input, variantData.content)
            : decisionOneStage.getStablePrompt(input);

          effectivePromptsByCase[caseItem.id] = prompt.questions;

          const callRes = await decisionOneStage.callModel(prompt.state, prompt.questions);
          lastModelParams = callRes.params;
          repRawOutput = callRes.rawOutput;
          repLatency = callRes.latencyMs;

          const parseRes = decisionOneStage.parseOutput(callRes.rawOutput, prompt.questions);
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

          reps.push({
            rep,
            latencyMs: repLatency,
            rawOutput: repRawOutput,
            parsedOutput: repParsedOutput,
            checks: checkResults,
            allPassed,
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
      console.log(`   Rep ${rep}/${repetitions}: ${repStatus} (${repLatency}ms)`);
    }

    const avgCaseLatency = Math.round(caseLatencySum / repetitions);
    caseResults.push({
      caseId: caseItem.id,
      split: caseItem.split,
      passedReps,
      totalReps: repetitions,
      avgLatencyMs: avgCaseLatency,
      repetitions: reps,
    });

    console.log(`   Resultado caso: ${passedReps}/${repetitions} aciertos (latencia media: ${avgCaseLatency}ms)\n`);
  }

  const successRatePct = Number(((successfulRepetitions / totalRepetitions) * 100).toFixed(1));
  const avgLatencyMs = Math.round(totalLatencyMs / Math.max(1, totalRepetitions));

  const summary: RunResultSummary = {
    totalCasesRun: runnable.length,
    pendingCasesSkipped: pending.length,
    totalRepetitions,
    successfulRepetitions,
    successRatePct,
    avgLatencyMs,
    jsonErrors,
    schemaErrors,
    truncatedCount: stage === "arguments" ? truncatedCount : 0,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `run_${timestamp}_${stage}_${isStable ? "stable" : variantId}`;

  let promptUsedRecord: unknown;
  if (isStable) {
    promptUsedRecord = "stable";
  } else if (stage === "decision_one") {
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
    cases: caseResults,
    summary,
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
  console.log(` - Latencia promedio: ${avgLatencyMs}ms`);
  console.log(` - Errores de JSON: ${jsonErrors}`);
  console.log(` - Errores de Schema / Validación: ${schemaErrors}`);
  if (stage === "arguments") {
    console.log(` - Salidas truncadas (max_tokens): ${truncatedCount}`);
  }
  console.log(` - Archivo de resultado guardado en: ${resultFilePath}`);
  console.log(`============================================================\n`);

  return finalResult;
}

// Ejecución CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Uso: npx tsx lab/run.ts <etapa> <stable|variantId> [--split dev|test]");
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

  runBenchmark(stageArg, targetPromptArg, splitArg).catch((err) => {
    console.error(`\n[FATAL] Error en la ejecución del benchmark: ${err.message}`);
    process.exit(1);
  });
}
