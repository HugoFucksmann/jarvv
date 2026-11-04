/**
 * scripts/eval-next/core/runner.ts
 *
 * Orquestador principal de evaluación.
 * Ejecuta los casos a través del registro de etapas, clientes de modelo y evaluadores.
 */

import crypto from "node:crypto";
import type { RunnerConfig } from "./config.ts";
import { STAGE_TIMEOUT_DEFAULTS_MS } from "./config.ts";
import { loadDatasetFile } from "./dataset.ts";
import { ResultsWriter } from "./results.ts";
import { getStageDefinition } from "./stages/index.ts";
import type { EvalCase, ModelClient, PromptVariant, RunRecord, StageDefinition } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";
import { createCollector } from "./graders/common.ts";
import { MockModelClient } from "./clients/mock.ts";
import { OpenAiCompatClient } from "./clients/openai-compat.ts";
import { DecisionRemoteClient } from "./clients/decision-remote.ts";

export interface RunnerClients {
  generativeClient: ModelClient;
  decisionClient: ModelClient;
}

export function resolveClients(cfg: RunnerConfig): RunnerClients {
  if (cfg.isMock) {
    const mock = new MockModelClient();
    return { generativeClient: mock, decisionClient: mock };
  }

  const generativeClient = new OpenAiCompatClient({
    url: cfg.url,
    model: cfg.model,
    timeoutMs: cfg.timeoutMs,
  });

  const decisionClient = new DecisionRemoteClient({
    url: cfg.url,
    model: cfg.model,
    device: cfg.device,
    timeoutMs: cfg.timeoutMs,
  });

  return { generativeClient, decisionClient };
}

function hashRequest(req: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 16);
}

export async function runEvaluation(
  cfg: RunnerConfig,
  injectedClients?: RunnerClients
): Promise<ResultsWriter> {
  const tagFilter = cfg.filter ? cfg.filter.split(",").map((s) => s.trim()) : undefined;
  const cases = loadDatasetFile(cfg.dataset, { stageFilter: cfg.stages, tagFilter });
  if (cases.length === 0) {
    console.warn(`[Runner] No se encontraron casos que coincidan con las etapas: ${cfg.stages.join(", ")}`);
  }

  const writer = new ResultsWriter(cfg);
  const clients = injectedClients || resolveClients(cfg);

  const variant: PromptVariant = {
    name: cfg.variant,
  };

  console.log("===============================================================================");
  console.log(" JARVIS — Suite de Evaluación Next");
  console.log(` Modelo:       ${cfg.model} ${cfg.isMock ? "(MOCK)" : ""}`);
  console.log(` Dataset:      ${cfg.dataset} (${cases.length} casos)`);
  console.log(` Etapas:       ${cfg.stages.join(", ")}`);
  console.log(` Repeticiones: ${cfg.repeat}`);
  console.log(` Thinking:     ${cfg.thinking}`);
  console.log(` Salida:       ${writer.outputDir}`);
  console.log("===============================================================================\n");

  let totalExecuted = 0;
  let totalPassed = 0;

  for (let rep = 1; rep <= cfg.repeat; rep++) {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const stageDef = getStageDefinition(c.stage);
      const client =
        stageDef.defaultClient === "decision"
          ? clients.decisionClient
          : clients.generativeClient;

      // Timeout efectivo: parámetro CLI > default por etapa
      const effectiveTimeout = cfg.timeoutMs ?? STAGE_TIMEOUT_DEFAULTS_MS[c.stage];
      void effectiveTimeout; // Usado como referencia; propagación al cliente pendiente por diseño

      const progressLabel = `[${i + 1}/${cases.length}${cfg.repeat > 1 ? ` rep ${rep}` : ""}]`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let modelReq: any;
      let requestHash = "";
      try {
        modelReq = stageDef.build(c.input as any, variant);
        if (modelReq.type === "generative") {
          if (cfg.thinking === "on") modelReq.thinking = true;
          else if (cfg.thinking === "off") modelReq.thinking = false;
        }
        requestHash = hashRequest(modelReq);
      } catch (err: any) {
        console.error(`  ${progressLabel} 💥 Error construyendo prompt para '${c.id}': ${err.message}`);
        writer.append({
          schemaVersion: SCHEMA_VERSION,
          caseId: c.id,
          stage: c.stage,
          iteration: rep,
          variant: cfg.variant,
          model: cfg.model,
          passed: false,
          isRaw: c.isRaw,
          errors: [`Error construyendo prompt: ${err.message}`],
          warnings: [],
          metrics: { build_prompt_ok: false },
          measurements: {},
          requestHash: "",
          rawInput: null,
          rawOutput: "",
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const t0 = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let modelRes: any;
      let callError: string | null = null;

      try {
        modelRes = await client.call(modelReq);
      } catch (err: any) {
        callError = err.message || String(err);
        modelRes = {
          rawOutput: "",
          durationMs: Date.now() - t0,
          finishReason: "error",
        };
      }

      totalExecuted++;

      const { collector, metrics, measurements, errors, warnings, passed: graderPassed } = createCollector();
      void graderPassed; // passRate se calcula a partir de errors.length

      if (callError) {
        collector.check("client_call_ok", false, `Error de llamada al modelo: ${callError}`);
      }

      if (modelRes.finishReason === "length") {
        collector.check(
          "not_truncated",
          false,
          "Salida truncada: el modelo excedió el límite de tokens (finish_reason='length')"
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedVal: any = undefined;
      if (!callError) {
        const parseRes = stageDef.parse(modelRes.rawOutput, c.input as any);
        if (!parseRes.ok) {
          collector.check("output_parse_ok", false, parseRes.error);
        } else {
          parsedVal = parseRes.value;
        }

        const graderCtx = {
          rawOutput: modelRes.rawOutput,
          finishReason: modelRes.finishReason,
          durationMs: modelRes.durationMs,
          modelResponse: modelRes,
        };

        for (const g of stageDef.graders) {
          try {
            g.grade(parsedVal, c.expect as any, graderCtx, collector);
          } catch (gErr: any) {
            collector.check(`grader_${g.name}`, false, `Excepción en grader '${g.name}': ${gErr.message}`);
          }
        }
      }

      // Extracción de etiquetas para etapas de decisión
      let predictedLabel: string | null = null;
      let expectedLabel: string | null = null;
      let probabilities: Record<string, number> | null = null;
      let rawScore: number | null = null;

      if (c.stage === "route" && parsedVal) {
        predictedLabel = parsedVal.action === "route" ? parsedVal.route : parsedVal.action;
        expectedLabel =
          (c.expect as any).expectedAction === "route"
            ? (c.expect as any).expectedRoute
            : (c.expect as any).expectedAction;
        probabilities = parsedVal.probabilities || null;
        rawScore = predictedLabel && probabilities ? probabilities[predictedLabel] ?? null : null;
      } else if (c.stage === "tool_choice" && parsedVal) {
        predictedLabel = parsedVal.selected;
        expectedLabel = (c.expect as any).expectedTool || null;
        probabilities = parsedVal.probabilities || null;
        rawScore = predictedLabel && probabilities ? probabilities[predictedLabel] ?? null : null;
      } else if (c.stage === "args_review" && parsedVal) {
        predictedLabel = parsedVal.review;
        expectedLabel = (c.expect as any).expectedReview || null;
        probabilities = parsedVal.probabilities || null;
        rawScore = predictedLabel && probabilities ? probabilities[predictedLabel] ?? null : null;
      } else if (c.stage === "result_verification" && parsedVal) {
        predictedLabel = `ok=${parsedVal.ok},cumple=${parsedVal.cumple}`;
        expectedLabel = `ok=${(c.expect as any).expectedOk},cumple=${(c.expect as any).expectedCumple}`;
        probabilities = { ok: parsedVal.okProbability, cumple: parsedVal.cumpleProbability };
        rawScore = parsedVal.okProbability;
      }

      const isPassed = !callError && errors.length === 0;
      if (isPassed && !c.isRaw) totalPassed++;

      const statusIcon = isPassed ? "✓" : "✗";
      const rawTag = c.isRaw ? " [RAW]" : "";
      console.log(
        `  ${statusIcon} ${progressLabel} [${c.stage.toUpperCase()}]${rawTag} ${c.id} (${modelRes.durationMs}ms)${
          errors.length > 0 ? ` -> ${errors[0]}` : ""
        }`
      );

      const record: RunRecord = {
        schemaVersion: SCHEMA_VERSION,
        caseId: c.id,
        stage: c.stage,
        iteration: rep,
        variant: cfg.variant,
        model: cfg.model,
        passed: isPassed,
        isRaw: c.isRaw,
        errors,
        warnings,
        metrics,
        measurements,
        predictedLabel,
        expectedLabel,
        probabilities,
        rawScore,
        requestParams: {
          temperature: cfg.temperature,
          thinking: modelReq.type === "generative" ? modelReq.thinking : undefined,
          maxTokens: modelReq.type === "generative" ? modelReq.maxTokens : undefined,
          timeoutMs: cfg.timeoutMs,
          seed: cfg.seed,
        },
        requestHash,
        rawInput: modelReq,
        rawOutput: modelRes.rawOutput,
        parsedOutput: parsedVal,
        durationMs: modelRes.durationMs,
        tokens: modelRes.tokens,
        finishReason: modelRes.finishReason,
        timestamp: new Date().toISOString(),
      };

      writer.append(record);
    }
  }

  const summary = writer.finish();

  console.log("\n===============================================================================");
  console.log(" RESUMEN FINAL");
  console.log(` Ejecuciones totales: ${summary.totalRuns}`);
  console.log(` Aprobadas (PASS):    ${summary.passedRuns} (${(summary.passRate * 100).toFixed(1)}%)`);
  console.log(` PassAllRate:         ${(summary.passAllRate * 100).toFixed(1)}% (casos consistentes en todas las repeticiones)`);
  console.log(` Latencia promedio:   ${summary.avgDurationMs}ms (p50: ${summary.p50DurationMs}ms, p95: ${summary.p95DurationMs}ms)`);
  if (summary.rawTotalRuns > 0) {
    console.log(` Raw cases:           ${summary.rawPassedRuns}/${summary.rawTotalRuns} (${(summary.rawPassRate * 100).toFixed(1)}%) [excluidos del pass rate canónico]`);
  }
  console.log("-------------------------------------------------------------------------------");
  for (const [st, stSummary] of Object.entries(summary.stages)) {
    const accuracyStr = stSummary.accuracy !== undefined ? ` | acc: ${(stSummary.accuracy * 100).toFixed(1)}%` : "";
    console.log(
      ` [${st.toUpperCase()}]: ${stSummary.passedRuns}/${stSummary.totalRuns} (${(stSummary.passRate * 100).toFixed(1)}%) | p50: ${stSummary.p50DurationMs}ms${accuracyStr}`
    );
  }
  console.log("===============================================================================");
  console.log(` Resultados guardados en: ${writer.outputDir}\n`);

  if (cfg.minPassRate !== undefined && summary.passRate < cfg.minPassRate) {
    console.error(
      `💥 Pass rate global (${(summary.passRate * 100).toFixed(1)}%) inferior al umbral mínimo requerido (${(cfg.minPassRate * 100).toFixed(1)}%)\n`
    );
    process.exitCode = 1;
  }

  return writer;
}
