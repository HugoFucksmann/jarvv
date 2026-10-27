import fs from "node:fs";
import path from "node:path";
import { QwenEvalClient } from "./core/qwenClient.ts";
import { evaluateTestCase } from "./core/qwenEvaluator.ts";
import { qwenCases } from "./datasets/qwen_cases_v1.ts";
import type {
  QwenTestCase,
  QwenRunRecord,
  QwenScoresSummary,
  QwenEvalStage,
} from "./core/qwenTypes.ts";
import { PLAN_JSON_SCHEMA, REPLAN_JSON_SCHEMA } from "../../src/core/reasoner/qwen.ts";
import { estimateTokens } from "../../src/core/llmTransport.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    url: "http://127.0.0.1:11434",
    model: "qwen2.5:7b",
    stage: "all",           // plan | replan | arguments | final_response | all
    tag: "",
    timeout: "90000",
    thinkingTimeout: "180000",
  };

  for (const a of args) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (k && v !== undefined) params[k] = v;
      else if (k) params[k] = "true";
    }
  }
  return params;
}

async function main() {
  const p = parseArgs();

  console.log("===============================================================================");
  console.log("JARVIS — Qwen Evaluation Runner");
  console.log(`Endpoint:         ${p.url}`);
  console.log(`Modelo:           ${p.model}`);
  console.log(`Filtro de Etapa:  ${p.stage}`);
  console.log("===============================================================================\n");

  const client = new QwenEvalClient({
    url: p.url,
    model: p.model,
    defaultTimeoutMs: Number(p.timeout),
    thinkingTimeoutMs: Number(p.thinkingTimeout),
  });

  const selectedCases = qwenCases.filter((c) => {
    if (p.stage === "all") return true;
    return c.stage === p.stage;
  });

  if (selectedCases.length === 0) {
    console.error(`No hay casos configurados para la etapa '${p.stage}'.`);
    process.exit(1);
  }

  console.log(`Total de casos a evaluar: ${selectedCases.length}\n`);

  const TODAY = new Date().toISOString().split("T")[0];
  const tagSuffix = p.tag ? `_${p.tag}` : "";
  const sanitizedModel = p.model.replace(/[:\/]/g, "_");
  const outputDir = path.resolve(
    process.cwd(),
    `scripts/results/qwen_eval/${sanitizedModel}/${TODAY}${tagSuffix}`
  );

  fs.mkdirSync(outputDir, { recursive: true });
  const runsFile = path.join(outputDir, "runs.jsonl");
  const scoresFile = path.join(outputDir, "scores.json");

  // Limpiar corridas previas en este directorio
  if (fs.existsSync(runsFile)) fs.unlinkSync(runsFile);

  const runRecords: QwenRunRecord[] = [];
  const runsWriteStream = fs.createWriteStream(runsFile, { flags: "a", encoding: "utf-8" });

  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let totalLatency = 0;

  const stageStats: Record<QwenEvalStage, { total: number; passed: number; latency: number; metrics: Record<string, { pass: number; total: number }> }> = {
    plan: { total: 0, passed: 0, latency: 0, metrics: {} },
    replan: { total: 0, passed: 0, latency: 0, metrics: {} },
    arguments: { total: 0, passed: 0, latency: 0, metrics: {} },
    final_response: { total: 0, passed: 0, latency: 0, metrics: {} },
  };

  for (let idx = 0; idx < selectedCases.length; idx++) {
    const c = selectedCases[idx];
    const caseNum = `[${idx + 1}/${selectedCases.length}]`;
    console.log(`${caseNum} Evaluando ${c.id} (${c.stage.toUpperCase()}) - ${c.description}...`);

    const estInTokens = estimateTokens(c.input.system || "") + estimateTokens(c.input.user);

    // Schema condicional
    let schemaToPass: Record<string, unknown> | undefined;
    let jsonExpected = true;

    if (c.stage === "plan") {
      schemaToPass = PLAN_JSON_SCHEMA;
    } else if (c.stage === "replan") {
      schemaToPass = REPLAN_JSON_SCHEMA;
    } else if (c.stage === "arguments") {
      schemaToPass = undefined; // Arguments usa json_object
    } else if (c.stage === "final_response") {
      jsonExpected = false;
    }

    try {
      const res = await client.infer({
        stage: c.stage,
        system: c.input.system || "",
        user: c.input.user,
        json: jsonExpected,
        schema: schemaToPass,
        thinking: c.input.thinking ?? false,
      });

      totalLatency += res.durationMs;
      stageStats[c.stage].total++;
      stageStats[c.stage].latency += res.durationMs;

      const evalResult = evaluateTestCase(c, res.content);

      for (const [k, v] of Object.entries(evalResult.metrics)) {
        if (!stageStats[c.stage].metrics[k]) {
          stageStats[c.stage].metrics[k] = { pass: 0, total: 0 };
        }
        stageStats[c.stage].metrics[k].total++;
        if (v === true || (typeof v === "number" && v > 0)) {
          stageStats[c.stage].metrics[k].pass++;
        }
      }

      if (evalResult.passed) {
        passedCount++;
        stageStats[c.stage].passed++;
        console.log(`    ✅ PASS (${res.durationMs}ms, ${res.completionTokens} tokens out)`);
      } else {
        failedCount++;
        console.log(`    ❌ FAIL (${res.durationMs}ms)`);
        for (const err of evalResult.errors) {
          console.log(`       ⚠️  ${err}`);
        }
      }

      const record: QwenRunRecord = {
        case_id: c.id,
        stage: c.stage,
        category: c.category,
        status: evalResult.passed ? "pass" : "fail",
        latency_ms: res.durationMs,
        prompt_tokens_est: estInTokens,
        completion_tokens: res.completionTokens,
        raw_output: res.content,
        parsed_output: evalResult.parsedOutput,
        metrics: evalResult.metrics,
        errors: evalResult.errors,
      };

      runRecords.push(record);
      runsWriteStream.write(JSON.stringify(record) + "\n");
    } catch (err: any) {
      errorCount++;
      stageStats[c.stage].total++;
      console.log(`    💥 ERROR: ${err.message}`);

      const record: QwenRunRecord = {
        case_id: c.id,
        stage: c.stage,
        category: c.category,
        status: "error",
        latency_ms: 0,
        prompt_tokens_est: estInTokens,
        metrics: {},
        errors: [err.message],
      };
      runRecords.push(record);
      runsWriteStream.write(JSON.stringify(record) + "\n");
    }
  }

  runsWriteStream.end();

  // Armar scores.json
  const byStageScores: any = {};
  for (const [stg, data] of Object.entries(stageStats)) {
    if (data.total > 0) {
      byStageScores[stg] = {
        total: data.total,
        passed: data.passed,
        pass_rate: Number((data.passed / data.total).toFixed(3)),
        avg_latency_ms: Math.round(data.latency / data.total),
        metrics_breakdown: data.metrics,
      };
    }
  }

  const totalRuns = selectedCases.length;
  const summary: QwenScoresSummary = {
    total: totalRuns,
    passed: passedCount,
    failed: failedCount,
    errors: errorCount,
    pass_rate: totalRuns > 0 ? Number((passedCount / totalRuns).toFixed(3)) : 0,
    avg_latency_ms: totalRuns - errorCount > 0 ? Math.round(totalLatency / (totalRuns - errorCount)) : 0,
    by_stage: byStageScores,
  };

  fs.writeFileSync(scoresFile, JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n===============================================================================");
  console.log("RESUMEN DE EVALUACIÓN — QWEN");
  console.log("===============================================================================");
  console.log(`Total Casos:        ${summary.total}`);
  console.log(`Aprobados (PASS):   ${summary.passed} (${(summary.pass_rate * 100).toFixed(1)}%)`);
  console.log(`Fallados (FAIL):    ${summary.failed}`);
  console.log(`Errores ejecución:  ${summary.errors}`);
  console.log(`Latencia Promedio:  ${summary.avg_latency_ms} ms`);
  console.log("-------------------------------------------------------------------------------");
  for (const [stg, stgData] of Object.entries(summary.by_stage)) {
    console.log(`Etapa [${stg.toUpperCase()}]: ${stgData.passed}/${stgData.total} (${(stgData.pass_rate * 100).toFixed(1)}%) | Latencia avg: ${stgData.avg_latency_ms}ms`);
  }
  console.log("-------------------------------------------------------------------------------");
  console.log(`Resultados guardados en:\n  ${runsFile}\n  ${scoresFile}`);
  console.log("===============================================================================\n");
}

main().catch((err) => {
  console.error("Fallo general en runner de Qwen:", err);
  process.exit(1);
});
