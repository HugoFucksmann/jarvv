import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LlmEvalClient } from "./core/client.ts";
import { evaluateTestCase } from "./core/evaluator.ts";
import { buildPrompt, STAGE_SPECS } from "./core/promptBuilder.ts";
import { renderConsoleSummary, renderSummaryMd, STAGES, summarizeRuns } from "./core/report.ts";
import type { LlmEvalStage, LlmRunRecord, LlmRunSettings, LlmTestCase } from "./core/types.ts";
import { ConfigManager } from "../../../src/core/config.ts";
import { estimateTokens } from "../../../src/core/llmTransport.ts";

const FINAL_MODES = ["both", "on", "off", "config"] as const;
type FinalMode = (typeof FINAL_MODES)[number];

const RULE = "===============================================================================";

/**
 * Flags aceptados (--nombre=valor) y sus defaults. Vacío = valor de producción (config.ts / jarvis-config.json);
 * para url y model, vacío = variable de entorno (LLM_URL / LLM_MODEL) y luego el default del cliente.
 */
const DEFAULT_PARAMS: Record<string, string> = {
  url: "",
  model: "",
  stage: "all", // plan | replan | arguments | final_response | all
  dataset: "v2", // nombre corto (v2, v3...) o ruta a un .ts
  prompts: "prod", // prod | nombre en scripts/eval/llm/prompts | ruta a un .ts
  tag: "",
  timeout: "",
  thinkingTimeout: "",
  maxTokens: "",
  numCtx: "",
  finalThinking: "both", // both | on | off | config
};

function parseArgs(): Record<string, string> {
  const params = { ...DEFAULT_PARAMS };
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) fail(`Argumento no reconocido '${arg}'. Formato: --nombre=valor`);
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    if (!(name in DEFAULT_PARAMS)) fail(`Opción desconocida '--${name}'. Opciones: ${Object.keys(DEFAULT_PARAMS).join(", ")}`);
    params[name] = eq === -1 ? "true" : body.slice(eq + 1);
  }
  return params;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function optionalPositiveInt(name: string, value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`Valor inválido para --${name}: '${value}' (se espera un número positivo).`);
  return Math.floor(n);
}

const shortHash = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 12);

function thinkingVariants(c: LlmTestCase, finalMode: FinalMode, configThinking: boolean): boolean[] {
  if (c.stage !== "final_response") return [c.input.thinking ?? STAGE_SPECS[c.stage].thinking];
  switch (finalMode) {
    case "both":
      return [false, true];
    case "on":
      return [true];
    case "off":
      return [false];
    case "config":
      return [configThinking];
  }
}

// ------------------------------------------------------------
// Carga de dataset y prompts
// ------------------------------------------------------------

const firstExisting = (candidates: string[]): string | undefined => candidates.find((c) => fs.existsSync(c));
const importFile = (file: string) => import(pathToFileURL(file).href);
const fromCwd = (...parts: string[]): string => path.resolve(process.cwd(), ...parts);

async function loadDataset(name: string): Promise<{ file: string; cases: LlmTestCase[] }> {
  const candidates = [
    fromCwd(`scripts/eval/llm/datasets/cases_${name}.ts`),
    fromCwd(`scripts/eval/llm/datasets/${name}.ts`),
    fromCwd(`scripts/eval/llm/datasets/${name}`),
    fromCwd(`${name}.ts`),
    fromCwd(name),
  ];
  const file = firstExisting(candidates);
  if (!file) fail(`Dataset no encontrado para '--dataset=${name}'. Buscado en:\n${candidates.map((c) => `  - ${c}`).join("\n")}`);

  const mod = await importFile(file);
  const cases = mod.testCases;
  if (!Array.isArray(cases)) fail(`El dataset en '${file}' no exporta un array 'testCases' válido.`);
  return { file, cases };
}

async function loadPrompts(name: string): Promise<{ file?: string; prompts?: any }> {
  if (!name || name === "prod") return {};
  const candidates = [
    fromCwd(`scripts/eval/llm/prompts/${name}.ts`),
    fromCwd(`scripts/eval/llm/prompts/${name}`),
    fromCwd(name),
  ];
  const file = firstExisting(candidates);
  if (!file) fail(`Prompts no encontrados para '--prompts=${name}'. Buscado en:\n${candidates.map((c) => `  - ${c}`).join("\n")}`);

  const mod = await importFile(file);
  const prompts = mod.PROMPTS || mod.default;
  if (!prompts) fail(`El archivo de prompts '${file}' no exporta 'PROMPTS' ni default.`);
  return { file, prompts };
}

// ------------------------------------------------------------
// Ejecución de un caso
// ------------------------------------------------------------

interface RunContext {
  client: LlmEvalClient;
  customPrompts: any;
  maxTokensByStage: Record<LlmEvalStage, number>;
}

async function runOne(rc: RunContext, c: LlmTestCase, thinking: boolean): Promise<LlmRunRecord> {
  const spec = STAGE_SPECS[c.stage];
  const base = {
    case_id: c.id,
    stage: c.stage,
    category: c.category,
    thinking,
    // Hash de la definición del caso: detecta cambios de dataset entre corridas.
    case_hash: shortHash(JSON.stringify({ input: c.input, expect: c.expect })),
  };
  const prompt: Pick<LlmRunRecord, "prompt_source" | "system_hash" | "user_hash" | "prompt_tokens_est"> = {
    prompt_source: "raw",
    prompt_tokens_est: 0,
  };

  try {
    const built = buildPrompt(c, rc.customPrompts);
    prompt.prompt_source = built.source;
    prompt.system_hash = shortHash(built.system);
    prompt.user_hash = shortHash(built.user);
    prompt.prompt_tokens_est = estimateTokens(built.system) + estimateTokens(built.user);
    if (built.source === "raw") console.log("    ℹ️  prompt escrito a mano en el caso (no usa PROMPTS de producción)");

    const res = await rc.client.infer({
      stage: c.stage,
      system: built.system,
      user: built.user,
      json: spec.json,
      schema: spec.schema,
      maxTokens: rc.maxTokensByStage[c.stage],
      thinking,
    });

    const evalResult = evaluateTestCase(c, res.content, { finishReason: res.finishReason });
    const info = `${res.durationMs}ms, ${res.promptTokens} in / ${res.completionTokens} out (max ${res.maxTokens}), finish=${res.finishReason}`;

    if (evalResult.passed) {
      console.log(`    ✅ PASS (${info})`);
    } else {
      console.log(`    ❌ FAIL (${info})`);
      for (const err of evalResult.errors) console.log(`       ⚠️  ${err}`);
    }
    for (const w of evalResult.warnings) console.log(`       ℹ️  ${w}`);
    if (!thinking && res.reasoning.length > 0) {
      console.log(`       ℹ️  thinking desactivado pero el modelo devolvió reasoning (${res.reasoning.length} chars)`);
    }
    if (res.promptTokens + res.completionTokens >= rc.client.contextSize) {
      console.log(`       ℹ️  agotó el contexto (${res.promptTokens + res.completionTokens}/${rc.client.contextSize}); el servidor pudo recortar el prompt`);
    }

    return {
      ...base,
      ...prompt,
      status: evalResult.passed ? "pass" : "fail",
      latency_ms: res.durationMs,
      prompt_tokens: res.promptTokens,
      completion_tokens: res.completionTokens,
      max_tokens: res.maxTokens,
      finish_reason: res.finishReason,
      reasoning_chars: res.reasoning.length,
      raw_output: res.content,
      parsed_output: evalResult.parsedOutput,
      metrics: evalResult.metrics,
      soft_metrics: evalResult.softMetrics,
      measurements: evalResult.measurements,
      errors: evalResult.errors,
      warnings: evalResult.warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`    💥 ERROR: ${message}`);
    return {
      ...base,
      ...prompt,
      status: "error",
      latency_ms: 0,
      metrics: {},
      measurements: {},
      errors: [message],
      warnings: [],
    };
  }
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  const p = parseArgs();

  if (p.stage !== "all" && !STAGES.includes(p.stage as LlmEvalStage)) {
    fail(`Etapa inválida '${p.stage}'. Opciones: ${STAGES.join(" | ")} | all`);
  }
  if (!FINAL_MODES.includes(p.finalThinking as FinalMode)) {
    fail(`Valor inválido para --finalThinking: '${p.finalThinking}'. Opciones: ${FINAL_MODES.join(" | ")}`);
  }
  const finalMode = p.finalThinking as FinalMode;

  const cfg = ConfigManager.getConfig();
  const defaultTimeoutMs = optionalPositiveInt("timeout", p.timeout) ?? cfg.qwenTimeoutMs;
  const thinkingTimeoutMs = optionalPositiveInt("thinkingTimeout", p.thinkingTimeout) ?? cfg.qwenThinkingTimeoutMs;
  const numCtx = optionalPositiveInt("numCtx", p.numCtx) ?? cfg.qwenNumCtx;
  const maxTokensOverride = optionalPositiveInt("maxTokens", p.maxTokens);

  const maxTokensByStage = Object.fromEntries(
    STAGES.map((s) => [s, maxTokensOverride ?? cfg.qwenMaxTokens[STAGE_SPECS[s].maxTokensKey]])
  ) as Record<LlmEvalStage, number>;

  const client = new LlmEvalClient({
    url: p.url || undefined,
    model: p.model || undefined,
    numCtx,
    defaultTimeoutMs,
    thinkingTimeoutMs,
  });

  const dataset = await loadDataset(p.dataset);
  const customPrompts = await loadPrompts(p.prompts);

  const datasetName = path.basename(dataset.file, ".ts").replace(/^cases_/, "");
  // Q0 es el prompt base de Jarvis (prod).
  const promptName = customPrompts.file ? path.basename(customPrompts.file, ".ts") : "Q0";
  const promptsLabel =
    promptName === "Q0" ? "Q0 (producción: src/core/reasoner/prompts.ts)" : `${promptName} (${path.basename(customPrompts.file ?? p.prompts)})`;

  const tagSuffix = p.tag && p.tag !== promptName && p.tag !== p.prompts ? `_${p.tag}` : "";
  const outputDir = fromCwd(`scripts/results/llm/${client.modelName.replace(/[:\/\\]/g, "_")}/${datasetName}_${promptName}${tagSuffix}`);

  const settings: LlmRunSettings = {
    model: client.modelName,
    dataset: datasetName,
    prompts: promptName,
    tag: p.tag || undefined,
    url: client.endpoint,
    num_ctx: client.contextSize,
    timeout_ms: defaultTimeoutMs,
    thinking_timeout_ms: thinkingTimeoutMs,
    max_tokens: maxTokensByStage,
    final_thinking: finalMode,
  };

  const selectedCases = dataset.cases.filter((c) => p.stage === "all" || c.stage === p.stage);
  if (selectedCases.length === 0) fail(`No hay casos configurados para la etapa '${p.stage}'.`);

  const runs = selectedCases.flatMap((c) =>
    thinkingVariants(c, finalMode, cfg.thinking).map((thinking) => ({ c, thinking }))
  );

  console.log(RULE);
  console.log("JARVIS — LLM Stage Evaluation Runner");
  console.log(`Endpoint:         ${settings.url}`);
  console.log(`Modelo:           ${settings.model}`);
  console.log(`Dataset:          ${datasetName} (${path.basename(dataset.file)})`);
  console.log(`Prompts:          ${promptsLabel}`);
  console.log(`Salida:           ${outputDir}`);
  console.log(`Filtro de Etapa:  ${p.stage}`);
  console.log(`Timeouts:         ${defaultTimeoutMs}ms (sin thinking) / ${thinkingTimeoutMs}ms (thinking)`);
  console.log(`Contexto:         ${client.contextSize} tokens`);
  console.log(`Max tokens:       ${STAGES.map((s) => `${s}=${maxTokensByStage[s]}`).join(", ")}`);
  console.log(`Final thinking:   ${finalMode}${finalMode === "config" ? ` (config.thinking=${cfg.thinking})` : ""}`);
  console.log(`${RULE}\n`);
  console.log(`Casos: ${selectedCases.length} | Ejecuciones: ${runs.length}\n`);

  fs.mkdirSync(outputDir, { recursive: true });
  const runsFile = path.join(outputDir, "runs.jsonl");
  const scoresFile = path.join(outputDir, "scores.json");
  const summaryFile = path.join(outputDir, "summary.md");

  // "w": cada corrida reemplaza a la anterior en este directorio.
  const runsStream = fs.createWriteStream(runsFile, { flags: "w", encoding: "utf-8" });
  const rc: RunContext = { client, customPrompts: customPrompts.prompts, maxTokensByStage };
  const records: LlmRunRecord[] = [];

  for (let idx = 0; idx < runs.length; idx++) {
    const { c, thinking } = runs[idx];
    console.log(`[${idx + 1}/${runs.length}] Evaluando ${c.id} (${c.stage.toUpperCase()}, thinking=${thinking ? "on" : "off"}) - ${c.description}...`);
    const record = await runOne(rc, c, thinking);
    records.push(record);
    runsStream.write(JSON.stringify(record) + "\n");
  }
  await new Promise<void>((resolve) => runsStream.end(resolve));

  // scores.json y summary.md se derivan de los mismos registros que runs.jsonl.
  const summary = summarizeRuns(records, settings);
  fs.writeFileSync(scoresFile, JSON.stringify(summary, null, 2), "utf-8");
  fs.writeFileSync(
    summaryFile,
    renderSummaryMd(summary, records, { datasetFile: path.basename(dataset.file), promptsLabel, stageFilter: p.stage }),
    "utf-8"
  );

  console.log(`\n${renderConsoleSummary(summary, records)}`);
  console.log("-------------------------------------------------------------------------------");
  console.log(`Resultados guardados en:\n  ${runsFile}\n  ${scoresFile}\n  ${summaryFile}`);
  console.log(`${RULE}\n`);
}

main().catch((err) => {
  console.error("Fallo general en runner de LLM:", err);
  process.exit(1);
});