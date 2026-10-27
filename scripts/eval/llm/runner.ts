import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LlmEvalClient } from "./core/client.ts";
import { evaluateTestCase } from "./core/evaluator.ts";
import { buildPrompt, STAGE_SPECS } from "./core/promptBuilder.ts";
import type {
  LlmRunRecord,
  LlmRunSettings,
  LlmScoresSummary,
  LlmStageSummary,
  LlmTestCase,
  LlmEvalStage,
} from "./core/types.ts";
import { ConfigManager } from "../../../src/core/config.ts";
import { estimateTokens } from "../../../src/core/llmTransport.ts";

const STAGES: LlmEvalStage[] = ["plan", "replan", "arguments", "final_response"];
const FINAL_MODES = ["both", "on", "off", "config"] as const;
type FinalMode = (typeof FINAL_MODES)[number];

type Bucket = {
  total: number;
  executed: number;
  passed: number;
  latency: number;
  completionTokens: number;
  metrics: Record<string, { pass: number; total: number }>;
};

const newBucket = (): Bucket => ({
  total: 0,
  executed: 0,
  passed: 0,
  latency: 0,
  completionTokens: 0,
  metrics: {},
});

const toStageSummary = (b: Bucket): LlmStageSummary => ({
  total: b.total,
  passed: b.passed,
  pass_rate: Number((b.passed / b.total).toFixed(3)),
  avg_latency_ms: b.executed > 0 ? Math.round(b.latency / b.executed) : 0,
  metrics_breakdown: b.metrics,
});

function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    url: "http://127.0.0.1:11434",
    model: "qwen2.5:7b",
    stage: "all", // plan | replan | arguments | final_response | all
    dataset: "v2", // v2 | ruta customizada a .ts
    prompts: "prod", // prod | Q1 | ruta customizada a .ts
    tag: "",
    // Vacío = valor de producción (config.ts / jarvis-config.json)
    timeout: "",
    thinkingTimeout: "",
    maxTokens: "",
    numCtx: "",
    finalThinking: "both", // both | on | off | config
  };

  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) params[body] = "true";
    else params[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return params;
}

function toPositiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Valor inválido para --${name}: '${value}' (se espera un número positivo).`);
    process.exit(1);
  }
  return Math.floor(n);
}

const shortHash = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 12);

const optionalInt = (name: string, value: string): number | undefined =>
  value ? toPositiveInt(name, value) : undefined;

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

async function main() {
  const p = parseArgs();

  if (p.stage !== "all" && !STAGES.includes(p.stage as LlmEvalStage)) {
    console.error(`Etapa inválida '${p.stage}'. Opciones: ${STAGES.join(" | ")} | all`);
    process.exit(1);
  }
  if (!FINAL_MODES.includes(p.finalThinking as FinalMode)) {
    console.error(`Valor inválido para --finalThinking: '${p.finalThinking}'. Opciones: ${FINAL_MODES.join(" | ")}`);
    process.exit(1);
  }
  const finalMode = p.finalThinking as FinalMode;

  const cfg = ConfigManager.getConfig();
  const defaultTimeoutMs = optionalInt("timeout", p.timeout) ?? cfg.qwenTimeoutMs;
  const thinkingTimeoutMs = optionalInt("thinkingTimeout", p.thinkingTimeout) ?? cfg.qwenThinkingTimeoutMs;
  const numCtx = optionalInt("numCtx", p.numCtx) ?? cfg.qwenNumCtx;
  const maxTokensOverride = optionalInt("maxTokens", p.maxTokens);

  const maxTokensByStage = Object.fromEntries(
    STAGES.map((s) => [s, maxTokensOverride ?? cfg.qwenMaxTokens[STAGE_SPECS[s].maxTokensKey]])
  ) as Record<LlmEvalStage, number>;

  const client = new LlmEvalClient({
    url: p.url,
    model: p.model,
    numCtx,
    defaultTimeoutMs,
    thinkingTimeoutMs,
  });

  // 1. Cargar Dataset dinámicamente
  let datasetFile: string;
  if (p.dataset === "v2") datasetFile = path.resolve(process.cwd(), "scripts/eval/llm/datasets/cases_v2.ts");
  else if (p.dataset === "v1") datasetFile = path.resolve(process.cwd(), "scripts/eval/llm/datasets/cases_v1.ts");
  else datasetFile = path.resolve(process.cwd(), p.dataset);

  if (!fs.existsSync(datasetFile)) {
    console.error(`Dataset no encontrado en: ${datasetFile}`);
    process.exit(1);
  }

  const casesModule = await import(`file://${datasetFile.replace(/\\/g, "/")}`);
  const allCases: LlmTestCase[] = casesModule.testCases || casesModule.qwenCases || casesModule.qwenCasesV2 || casesModule.default;
  if (!Array.isArray(allCases)) {
    console.error(`El dataset en '${datasetFile}' no exporta un array 'testCases' válido.`);
    process.exit(1);
  }

  // 2. Cargar Prompts dinámicamente (si no es prod)
  let promptsFile: string | undefined;
  let customPrompts: any = undefined;

  if (p.prompts && p.prompts !== "prod") {
    const candidates = [
      path.resolve(process.cwd(), `scripts/eval/llm/prompts/${p.prompts}.ts`),
      path.resolve(process.cwd(), `scripts/eval/llm/prompts/${p.prompts}`),
      path.resolve(process.cwd(), p.prompts),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        promptsFile = c;
        break;
      }
    }

    if (!promptsFile) {
      console.error(`Prompts no encontrados para '--prompts=${p.prompts}'. Buscado en:\n  - scripts/eval/llm/prompts/${p.prompts}.ts\n  - ${p.prompts}`);
      process.exit(1);
    }

    const promptsModule = await import(`file://${promptsFile.replace(/\\/g, "/")}`);
    customPrompts = promptsModule.PROMPTS || promptsModule.default;
    if (!customPrompts) {
      console.error(`El archivo de prompts '${promptsFile}' no exporta 'PROMPTS' ni default.`);
      process.exit(1);
    }
  }

  // Si se especificó --prompts y no se pasó --tag, etiquetar automáticamente con el nombre de los prompts
  if (!p.tag && p.prompts && p.prompts !== "prod") {
    p.tag = p.prompts;
  }

  const settings: LlmRunSettings = {
    model: p.model,
    url: p.url,
    num_ctx: client.contextSize,
    timeout_ms: defaultTimeoutMs,
    thinking_timeout_ms: thinkingTimeoutMs,
    max_tokens: maxTokensByStage,
    final_thinking: finalMode,
    prompts: p.prompts,
  };

  console.log("===============================================================================");
  console.log("JARVIS — LLM Stage Evaluation Runner");
  console.log(`Endpoint:         ${p.url}`);
  console.log(`Modelo:           ${p.model}`);
  console.log(`Dataset:          ${path.basename(datasetFile, ".ts")}`);
  console.log(`Prompts:          ${p.prompts}${promptsFile ? ` (${path.basename(promptsFile)})` : " (producción: src/core/reasoner/prompts.ts)"}`);
  console.log(`Filtro de Etapa:  ${p.stage}`);
  console.log(`Timeouts:         ${defaultTimeoutMs}ms (sin thinking) / ${thinkingTimeoutMs}ms (thinking)`);
  console.log(`Contexto:         ${client.contextSize} tokens`);
  console.log(`Max tokens:       ${STAGES.map((s) => `${s}=${maxTokensByStage[s]}`).join(", ")}`);
  console.log(`Final thinking:   ${finalMode}${finalMode === "config" ? ` (config.thinking=${cfg.thinking})` : ""}`);
  console.log("===============================================================================\n");

  const selectedCases = allCases.filter((c) => p.stage === "all" || c.stage === p.stage);

  if (selectedCases.length === 0) {
    console.error(`No hay casos configurados para la etapa '${p.stage}'.`);
    process.exit(1);
  }

  const runs = selectedCases.flatMap((c) =>
    thinkingVariants(c, finalMode, cfg.thinking).map((thinking) => ({ c, thinking }))
  );

  console.log(`Casos: ${selectedCases.length} | Ejecuciones: ${runs.length}\n`);

  const TODAY = new Date().toISOString().split("T")[0];
  const tagSuffix = p.tag ? `_${p.tag}` : "";
  const sanitizedModel = p.model.replace(/[:\/\\]/g, "_");
  const outputDir = path.resolve(
    process.cwd(),
    `scripts/results/llm/${sanitizedModel}/${TODAY}${tagSuffix}`
  );

  fs.mkdirSync(outputDir, { recursive: true });
  const runsFile = path.join(outputDir, "runs.jsonl");
  const scoresFile = path.join(outputDir, "scores.json");

  // Limpiar corridas previas en este directorio
  if (fs.existsSync(runsFile)) fs.unlinkSync(runsFile);

  const runsWriteStream = fs.createWriteStream(runsFile, { flags: "a", encoding: "utf-8" });

  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let totalLatency = 0;
  const finishReasons: Record<string, number> = {};

  const stageStats = Object.fromEntries(STAGES.map((s) => [s, newBucket()])) as Record<LlmEvalStage, Bucket>;
  const thinkStats = Object.fromEntries(
    STAGES.map((s) => [s, { off: newBucket(), on: newBucket() }])
  ) as Record<LlmEvalStage, { off: Bucket; on: Bucket }>;

  type Outcome = { status: LlmRunRecord["status"]; latencyMs: number; tokensOut?: number };
  const sideBySide = new Map<string, { stage: LlmEvalStage; off?: Outcome; on?: Outcome }>();

  const writeRecord = (record: LlmRunRecord) => {
    runsWriteStream.write(JSON.stringify(record) + "\n");
  };

  for (let idx = 0; idx < runs.length; idx++) {
    const { c, thinking } = runs[idx];
    const spec = STAGE_SPECS[c.stage];
    const buckets = [stageStats[c.stage], thinkStats[c.stage][thinking ? "on" : "off"]];
    const runNum = `[${idx + 1}/${runs.length}]`;
    console.log(`${runNum} Evaluando ${c.id} (${c.stage.toUpperCase()}, thinking=${thinking ? "on" : "off"}) - ${c.description}...`);

    for (const b of buckets) b.total++;

    let estInTokens = 0;
    let promptSource: "prod" | "raw" = "raw";
    let systemHash: string | undefined;
    let userHash: string | undefined;
    const caseHash = shortHash(JSON.stringify({ input: c.input, expect: c.expect }));
    const pair = sideBySide.get(c.id) ?? { stage: c.stage };
    sideBySide.set(c.id, pair);
    const slot = thinking ? "on" : "off";

    try {
      const built = buildPrompt(c, customPrompts);
      promptSource = built.source;
      systemHash = shortHash(built.system);
      userHash = shortHash(built.user);
      estInTokens = estimateTokens(built.system) + estimateTokens(built.user);
      if (built.source === "raw") {
        console.log("    ℹ️  prompt escrito a mano en el caso (no usa PROMPTS de producción)");
      }

      const res = await client.infer({
        stage: c.stage,
        system: built.system,
        user: built.user,
        json: spec.json,
        schema: spec.schema,
        maxTokens: maxTokensByStage[c.stage],
        thinking,
      });

      totalLatency += res.durationMs;
      finishReasons[res.finishReason] = (finishReasons[res.finishReason] ?? 0) + 1;

      const evalResult = evaluateTestCase(c, res.content, { finishReason: res.finishReason });

      for (const b of buckets) {
        b.executed++;
        b.latency += res.durationMs;
        b.completionTokens += res.completionTokens;
        for (const [k, v] of Object.entries(evalResult.metrics)) {
          const m = (b.metrics[k] ??= { pass: 0, total: 0 });
          m.total++;
          if (v) m.pass++;
        }
      }

      const info = `${res.durationMs}ms, ${res.promptTokens} in / ${res.completionTokens} out (max ${res.maxTokens}), finish=${res.finishReason}`;

      if (evalResult.passed) {
        passedCount++;
        for (const b of buckets) b.passed++;
        console.log(`    ✅ PASS (${info})`);
      } else {
        failedCount++;
        console.log(`    ❌ FAIL (${info})`);
        for (const err of evalResult.errors) {
          console.log(`       ⚠️  ${err}`);
        }
      }

      for (const w of evalResult.warnings) {
        console.log(`       ℹ️  ${w}`);
      }

      if (!thinking && res.reasoning.length > 0) {
        console.log(`       ℹ️  thinking desactivado pero el modelo devolvió reasoning (${res.reasoning.length} chars)`);
      }
      if (res.promptTokens + res.completionTokens >= client.contextSize) {
        console.log(`       ℹ️  agotó el contexto (${res.promptTokens + res.completionTokens}/${client.contextSize}); el servidor pudo recortar el prompt`);
      }

      pair[slot] = {
        status: evalResult.passed ? "pass" : "fail",
        latencyMs: res.durationMs,
        tokensOut: res.completionTokens,
      };

      writeRecord({
        case_id: c.id,
        stage: c.stage,
        category: c.category,
        status: evalResult.passed ? "pass" : "fail",
        thinking,
        prompt_source: promptSource,
        case_hash: caseHash,
        system_hash: systemHash,
        user_hash: userHash,
        latency_ms: res.durationMs,
        prompt_tokens_est: estInTokens,
        prompt_tokens: res.promptTokens,
        completion_tokens: res.completionTokens,
        max_tokens: res.maxTokens,
        finish_reason: res.finishReason,
        reasoning_chars: res.reasoning.length,
        raw_output: res.content,
        parsed_output: evalResult.parsedOutput,
        metrics: evalResult.metrics,
        measurements: evalResult.measurements,
        errors: evalResult.errors,
        warnings: evalResult.warnings,
      });
    } catch (err: any) {
      errorCount++;
      console.log(`    💥 ERROR: ${err.message}`);
      pair[slot] = { status: "error", latencyMs: 0 };

      writeRecord({
        case_id: c.id,
        stage: c.stage,
        category: c.category,
        status: "error",
        thinking,
        prompt_source: promptSource,
        case_hash: caseHash,
        system_hash: systemHash,
        user_hash: userHash,
        latency_ms: 0,
        prompt_tokens_est: estInTokens,
        metrics: {},
        measurements: {},
        errors: [err.message],
        warnings: [],
      });
    }
  }

  await new Promise<void>((resolve) => runsWriteStream.end(resolve));

  // Armar scores.json
  const byStageScores: LlmScoresSummary["by_stage"] = {};
  const thinkingComparison: LlmScoresSummary["thinking_comparison"] = {};
  for (const stg of STAGES) {
    if (stageStats[stg].total === 0) continue;
    byStageScores[stg] = toStageSummary(stageStats[stg]);

    const { off, on } = thinkStats[stg];
    if (off.total > 0 && on.total > 0) {
      const withTokens = (b: Bucket) => ({
        ...toStageSummary(b),
        avg_completion_tokens: b.executed > 0 ? Math.round(b.completionTokens / b.executed) : 0,
      });
      thinkingComparison[stg] = { off: withTokens(off), on: withTokens(on) };
    }
  }

  const totalRuns = runs.length;
  const summary: LlmScoresSummary = {
    total: totalRuns,
    passed: passedCount,
    failed: failedCount,
    errors: errorCount,
    pass_rate: totalRuns > 0 ? Number((passedCount / totalRuns).toFixed(3)) : 0,
    avg_latency_ms: totalRuns - errorCount > 0 ? Math.round(totalLatency / (totalRuns - errorCount)) : 0,
    finish_reasons: finishReasons,
    settings,
    by_stage: byStageScores,
    thinking_comparison: thinkingComparison,
  };

  fs.writeFileSync(scoresFile, JSON.stringify(summary, null, 2), "utf-8");

  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

  console.log("\n===============================================================================");
  console.log("RESUMEN DE EVALUACIÓN — LLM");
  console.log("===============================================================================");
  console.log(`Ejecuciones:        ${summary.total}`);
  console.log(`Aprobadas (PASS):   ${summary.passed} (${pct(summary.pass_rate)})`);
  console.log(`Falladas (FAIL):    ${summary.failed}`);
  console.log(`Errores ejecución:  ${summary.errors}`);
  console.log(`Latencia Promedio:  ${summary.avg_latency_ms} ms`);
  console.log(`Finish reasons:     ${JSON.stringify(summary.finish_reasons)}`);
  console.log("-------------------------------------------------------------------------------");
  for (const [stg, d] of Object.entries(summary.by_stage)) {
    if (!d) continue;
    console.log(`Etapa [${stg.toUpperCase()}]: ${d.passed}/${d.total} (${pct(d.pass_rate)}) | Latencia avg: ${d.avg_latency_ms}ms`);
  }

  for (const [stg, cmp] of Object.entries(summary.thinking_comparison)) {
    if (!cmp) continue;
    console.log("-------------------------------------------------------------------------------");
    console.log(`COMPARACIÓN THINKING — ${stg.toUpperCase()}`);
    for (const [label, d] of [["sin thinking", cmp.off], ["con thinking", cmp.on]] as const) {
      console.log(
        `  ${label}: ${d.passed}/${d.total} (${pct(d.pass_rate)}) | lat avg ${d.avg_latency_ms}ms | tokens out avg ${d.avg_completion_tokens}`
      );
    }
    for (const [caseId, pr] of sideBySide) {
      if (pr.stage !== stg || !pr.off || !pr.on) continue;
      const fmt = (o: Outcome) => `${o.status.toUpperCase()} ${o.latencyMs}ms`;
      console.log(`  ${caseId}: off=${fmt(pr.off)} | on=${fmt(pr.on)}`);
    }
  }

  console.log("-------------------------------------------------------------------------------");
  console.log(`Resultados guardados en:\n  ${runsFile}\n  ${scoresFile}`);
  console.log("===============================================================================\n");
}

main().catch((err) => {
  console.error("Fallo general en runner de LLM:", err);
  process.exit(1);
});