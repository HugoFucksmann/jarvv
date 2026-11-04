/**
 * scripts/eval-next/tests/run.ts
 *
 * Suite de tests unitarios y de integración para scripts/eval-next.
 * Ejecutable offline vía: npm run test:eval  o  npx tsx scripts/eval-next/tests/run.ts
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

// 1. Acoplamiento real con producción: si producción cambia, esto debe fallar.
import { PROMPTS, DECISION_PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import { PLAN_JSON_SCHEMA, parseJsonObject, parsePlanSteps, stripThink, validateArgs } from "../../../src/core/reasoner/qwen.ts";
import { renderArgs } from "../../../src/core/render/args.ts";
import { renderPlan } from "../../../src/core/render/plan.ts";
import { renderFinal } from "../../../src/core/render/final.ts";
import { renderAsk } from "../../../src/core/render/ask.ts";
import { buildCompactCatalog } from "../../../src/core/tools/manifest.ts";
import { planRenderOptions, argsRenderOptions, finalRenderOptions, askRenderOptions } from "../../../src/core/engine/adapters.ts";

import { MockModelClient } from "../core/clients/mock.ts";
import { getStageDefinition, getAllStageNames } from "../core/stages/index.ts";
import { runEvaluation } from "../core/runner.ts";
import { parseCliArgs } from "../core/config.ts";
import { createCollector } from "../core/graders/common.ts";
import { PlanStepsGrader } from "../core/graders/plan.ts";
import { RouteLabelGrader, ToolChoiceLabelGrader, ArgsReviewLabelGrader, ResultVerificationGrader } from "../core/graders/label.ts";
import { QuestionGrader } from "../core/graders/question.ts";
import { FinalResponseGrader } from "../core/graders/final.ts";
import { SCHEMA_VERSION } from "../core/types.ts";

let passedCount = 0;
let failedCount = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message || err}`);
    failedCount++;
  }
}

const SAMPLE_DATASET = path.resolve(process.cwd(), "scripts/eval-next/datasets/sample.jsonl");

async function main() {
  console.log("===============================================================================");
  console.log(" EVAL-NEXT TEST SUITE");
  console.log("===============================================================================\n");

  // -------------------------------------------------------------------------
  // Test 1: Prueba de Acoplamiento Real con Producción
  // -------------------------------------------------------------------------
  await test("Producción: Prompts de vistas y decisiones exportados", () => {
    assert.ok(PROMPTS.PLAN_VIEW, "PROMPTS.PLAN_VIEW debe existir");
    assert.ok(PROMPTS.ARGUMENTS_VIEW, "PROMPTS.ARGUMENTS_VIEW debe existir");
    assert.ok(PROMPTS.FINAL_VIEW, "PROMPTS.FINAL_VIEW debe existir");
    assert.ok(PROMPTS.QUESTION, "PROMPTS.QUESTION debe existir");

    assert.ok(typeof DECISION_PROMPTS.buildRouteChoice === "function", "buildRouteChoice debe ser función");
    assert.ok(typeof DECISION_PROMPTS.buildToolChoice === "function", "buildToolChoice debe ser función");
    assert.ok(typeof DECISION_PROMPTS.buildArgsReview === "function", "buildArgsReview debe ser función");
    assert.ok(typeof DECISION_PROMPTS.buildResultVerification === "function", "buildResultVerification debe ser función");
  });

  await test("Producción: Renderizadores y adaptadores exportados", () => {
    assert.ok(typeof renderPlan === "function");
    assert.ok(typeof renderArgs === "function");
    assert.ok(typeof renderFinal === "function");
    assert.ok(typeof renderAsk === "function");

    assert.ok(typeof planRenderOptions === "function");
    assert.ok(typeof argsRenderOptions === "function");
    assert.ok(typeof finalRenderOptions === "function");
    assert.ok(typeof askRenderOptions === "function");

    assert.ok(typeof buildCompactCatalog === "function");
    assert.ok(typeof parsePlanSteps === "function");
    assert.ok(PLAN_JSON_SCHEMA && typeof PLAN_JSON_SCHEMA === "object");
  });

  // -------------------------------------------------------------------------
  // Test 2: Limpieza de <think> y Parseo JSON
  // -------------------------------------------------------------------------
  await test("Utilidades: stripThink y parseJsonObject", () => {
    const rawWithThink = "<think>Analizando paso 1...</think>\n{\"steps\":[]}";
    const cleaned = stripThink(rawWithThink).trim();
    assert.strictEqual(cleaned, '{"steps":[]}');

    const parsed = parseJsonObject(cleaned);
    assert.deepStrictEqual(parsed, { steps: [] });

    const invalid = parseJsonObject("No es un json");
    assert.strictEqual(invalid, null);
  });

  // -------------------------------------------------------------------------
  // Test 3: Grader de Plan y Replan (Casos Pass y Fail)
  // -------------------------------------------------------------------------
  await test("Plan Grader: Replan rechaza metas fallidas y efectos repetidos", () => {
    const dummyCtx = { rawOutput: "", durationMs: 50, modelResponse: { rawOutput: "", durationMs: 50 } };

    // Falla por repetir meta fallida
    const outputFailed = {
      steps: [{ goal: "ejecutar nmap rapido en localhost", suggested_mcp: "terminal", expected_outcome: "escaneo listo" }],
    };
    const col1 = createCollector();
    PlanStepsGrader.grade(outputFailed, { forbiddenRepeatedGoals: ["nmap rapido"] }, dummyCtx, col1.collector);
    assert.strictEqual(col1.passed, false, "Debe fallar al repetir meta prohibida");
    assert.ok(col1.errors.some((e) => e.includes("metas fallidas")));

    // Falla por no reflejar feedback
    const col2 = createCollector();
    PlanStepsGrader.grade(outputFailed, { mustReflectFeedback: ["json", "exportar"] }, dummyCtx, col2.collector);
    assert.strictEqual(col2.passed, false, "Debe fallar al omitir feedback");
    assert.ok(col2.errors.some((e) => e.includes("feedback")));

    // Falla por no devolver steps: [] cuando expectEmpty = true
    const col3 = createCollector();
    PlanStepsGrader.grade(outputFailed, { expectEmpty: true }, dummyCtx, col3.collector);
    assert.strictEqual(col3.passed, false, "Debe fallar si steps no está vacío cuando expectEmpty=true");

    // Pass en expectEmpty
    const col4 = createCollector();
    PlanStepsGrader.grade({ steps: [] }, { expectEmpty: true }, dummyCtx, col4.collector);
    assert.strictEqual(col4.passed, true, "Debe pasar cuando steps: [] y expectEmpty=true");
  });

  // -------------------------------------------------------------------------
  // Test 4: Graders de Decisión (Detección de Fallos)
  // -------------------------------------------------------------------------
  await test("Decision Graders: Detección estricta de etiquetas erróneas", () => {
    const dummyCtx = { rawOutput: "", durationMs: 20, modelResponse: { rawOutput: "", durationMs: 20 } };

    // Route: fallar con ruta incorrecta
    const colRoute = createCollector();
    RouteLabelGrader.grade({ action: "route", route: "terminal" }, { expectedAction: "route", expectedRoute: "files" }, dummyCtx, colRoute.collector);
    assert.strictEqual(colRoute.passed, false, "RouteLabelGrader debe fallar con ruta incorrecta");

    // ToolChoice: fallar con herramienta incorrecta
    const colTool = createCollector();
    ToolChoiceLabelGrader.grade({ selected: "write_file" }, { expectedTool: "read_file" }, dummyCtx, colTool.collector);
    assert.strictEqual(colTool.passed, false, "ToolChoiceLabelGrader debe fallar con tool incorrecta");

    // ArgsReview: fallar con veredicto incorrecto
    const colReview = createCollector();
    ArgsReviewLabelGrader.grade({ review: "args_invalid" }, { expectedReview: "approved" }, dummyCtx, colReview.collector);
    assert.strictEqual(colReview.passed, false, "ArgsReviewLabelGrader debe fallar con review incorrecta");

    // ResultVerification: fallar con verificación no cumplida
    const colVerify = createCollector();
    ResultVerificationGrader.grade(
      { ok: false, cumple: false, okProbability: 0.1, cumpleProbability: 0.1 },
      { expectedOk: true, expectedCumple: true },
      dummyCtx,
      colVerify.collector
    );
    assert.strictEqual(colVerify.passed, false, "ResultVerificationGrader debe fallar cuando ok=false");
  });

  // -------------------------------------------------------------------------
  // Test 5: Grader de Question (Fugas internas y límites)
  // -------------------------------------------------------------------------
  await test("Question Grader: Falla ante fugas de nombres internos o límites", () => {
    const dummyCtx = { rawOutput: "", durationMs: 25, modelResponse: { rawOutput: "", durationMs: 25 } };

    // Fuga de nombre de tool interno
    const colLeak = createCollector();
    QuestionGrader.grade({ question: "¿Deseas ejecutar read_file sobre el archivo?" }, { forbiddenKeywords: ["read_file"] }, dummyCtx, colLeak.collector);
    assert.strictEqual(colLeak.passed, false, "Debe fallar cuando filtra nombres internos");

    // Excede longitud máxima
    const colLen = createCollector();
    QuestionGrader.grade({ question: "Pregunta ".repeat(50) }, { maxChars: 50 }, dummyCtx, colLen.collector);
    assert.strictEqual(colLen.passed, false, "Debe fallar si excede maxChars");

    // Preguntas múltiples cuando se exige una sola
    const colMulti = createCollector();
    QuestionGrader.grade({ question: "¿Quieres continuar? ¿Estás seguro?" }, { singleQuestionOnly: true }, dummyCtx, colMulti.collector);
    assert.strictEqual(colMulti.passed, false, "Debe fallar si contiene múltiples preguntas");
  });

  // -------------------------------------------------------------------------
  // Test 6: Grader de Final (Hechos y Alucinaciones)
  // -------------------------------------------------------------------------
  await test("Final Grader: Falla ante hechos faltantes o alucinaciones prohibidas", () => {
    const dummyCtx = { rawOutput: "", durationMs: 30, modelResponse: { rawOutput: "", durationMs: 30 } };

    // Falta hecho requerido
    const colMissing = createCollector();
    FinalResponseGrader.grade({ response: "La tarea se completó sin datos." }, { mustContainFacts: ["5432"] }, dummyCtx, colMissing.collector);
    assert.strictEqual(colMissing.passed, false, "Debe fallar cuando falta un hecho requerido");

    // Alucinación prohibida presente
    const colHallucination = createCollector();
    FinalResponseGrader.grade(
      { response: "El archivo contenía la contraseña secreta123." },
      { forbiddenHallucinations: ["secreta123"] },
      dummyCtx,
      colHallucination.collector
    );
    assert.strictEqual(colHallucination.passed, false, "Debe fallar cuando aparece una alucinación prohibida");
  });

  // -------------------------------------------------------------------------
  // Test 7: Validación de imports de producción (validateArgs)
  // -------------------------------------------------------------------------
  await test("Producción: validateArgs importado y funcional", () => {
    assert.ok(typeof validateArgs === "function", "validateArgs debe ser función");
  });

  // -------------------------------------------------------------------------
  // Test 8: Ejecución completa con MockModelClient y verificación de archivos
  // -------------------------------------------------------------------------
  await test("Runner: Corrida completa con Mock escribe runs.jsonl, scores.json y meta.json enriquecidos", async () => {
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=all",
      "--label=testrun",
    ]);

    const writer = await runEvaluation(config);

    assert.ok(fs.existsSync(writer.runsFile), "runs.jsonl debe existir");
    assert.ok(fs.existsSync(writer.scoresFile), "scores.json debe existir");
    assert.ok(fs.existsSync(writer.metaFile), "meta.json debe existir");

    const runsLines = fs.readFileSync(writer.runsFile, "utf-8").trim().split("\n");
    assert.strictEqual(runsLines.length, 10, "sample.jsonl tiene 10 casos estructurados; debe haber 10 ejecuciones registradas");

    // Verificar formato de primer nivel en runs.jsonl
    const firstRun = JSON.parse(runsLines[0]);
    assert.ok("predictedLabel" in firstRun, "runs.jsonl debe incluir 'predictedLabel' de primer nivel");
    assert.ok("expectedLabel" in firstRun, "runs.jsonl debe incluir 'expectedLabel' de primer nivel");
    assert.ok("requestParams" in firstRun, "runs.jsonl debe incluir 'requestParams'");
    assert.ok("requestHash" in firstRun, "runs.jsonl debe incluir 'requestHash'");
    assert.strictEqual(firstRun.schemaVersion, SCHEMA_VERSION, "runs.jsonl debe incluir schemaVersion");

    // Verificar percentiles, accuracy y variance en scores.json
    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));
    assert.strictEqual(scores.totalRuns, 10);
    assert.ok(scores.passedRuns >= 8, "Los casos canónicos estructurados deben pasar con mock");
    assert.ok("p50DurationMs" in scores, "scores.json debe incluir p50DurationMs");
    assert.ok("p95DurationMs" in scores, "scores.json debe incluir p95DurationMs");
    assert.ok("passAllRate" in scores, "scores.json debe incluir passAllRate");
    assert.ok("rawPassRate" in scores, "scores.json debe incluir rawPassRate");
    assert.strictEqual(scores.schemaVersion, SCHEMA_VERSION, "scores.json debe incluir schemaVersion");

    // Verificar meta.json enriquecido
    const meta = JSON.parse(fs.readFileSync(writer.metaFile, "utf-8"));
    assert.strictEqual(meta.model, "mock");
    assert.strictEqual(meta.variant, "prod");
    assert.ok("gitCommit" in meta, "meta.json debe incluir gitCommit");
    assert.ok("gitDirty" in meta, "meta.json debe incluir gitDirty");
    assert.ok("promptHashes" in meta, "meta.json debe incluir promptHashes");
    assert.ok(meta.promptHashes.plan_view, "meta.promptHashes debe incluir hash de plan_view");
    assert.ok("sourceHashes" in meta, "meta.json debe incluir sourceHashes");
    assert.ok(Object.keys(meta.sourceHashes).length > 0, "sourceHashes debe tener entradas");
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION, "meta.json debe incluir schemaVersion");
  });

  // -------------------------------------------------------------------------
  // Test 9: Runner con JSON roto marca fallo
  // -------------------------------------------------------------------------
  await test("Runner: JSON roto marca fallo y registra error", async () => {
    const badMock = new MockModelClient(() => ({
      rawOutput: "{not json at all",
      durationMs: 10,
      finishReason: "stop",
    }));
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
    ]);
    const writer = await runEvaluation(config, { generativeClient: badMock, decisionClient: badMock });
    const lines = fs.readFileSync(writer.runsFile, "utf-8").trim().split("\n");
    const runs = lines.map((l) => JSON.parse(l));
    assert.ok(runs.every((r: any) => !r.passed), "Todos los runs de plan con JSON roto deben fallar");
    assert.ok(runs.every((r: any) => r.errors.length > 0), "Todos deben tener errores registrados");
  });

  // -------------------------------------------------------------------------
  // Test 10: finish_reason=length marca fallo (not_truncated)
  // -------------------------------------------------------------------------
  await test("Runner: finish_reason=length marca fallo (not_truncated)", async () => {
    const truncMock = new MockModelClient(() => ({
      rawOutput: '{"steps":[{"goal":"ok","suggested_mcp":"files","expected_outcome":"done"}]}',
      durationMs: 15,
      finishReason: "length",
    }));
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
    ]);
    const writer = await runEvaluation(config, { generativeClient: truncMock, decisionClient: truncMock });
    const lines = fs.readFileSync(writer.runsFile, "utf-8").trim().split("\n");
    const runs = lines.map((l) => JSON.parse(l));
    assert.ok(runs.every((r: any) => !r.passed), "finish_reason=length debe marcar todos como fallidos");
    assert.ok(
      runs.every((r: any) => r.errors.some((e: string) => e.toLowerCase().includes("truncad"))),
      "El error debe mencionar truncado"
    );
  });

  // -------------------------------------------------------------------------
  // Test 11: Etiqueta equivocada en decisión baja passRate
  // -------------------------------------------------------------------------
  await test("Runner: etiqueta equivocada en decisión baja passRate", async () => {
    // Mock que siempre retorna 'terminal' para route cuando el caso espera 'files'
    const wrongLabelMock = new MockModelClient((req) => {
      if (req.type === "decision") {
        const questions = req.questions as Record<string, { type: string }>;
        const answers: Record<string, unknown> = {};
        for (const [key, q] of Object.entries(questions)) {
          if (q.type === "choice" && key === "route") {
            answers[key] = { choice: "terminal", probabilities: { terminal: 0.9, files: 0.1 } };
          } else if (q.type === "choice") {
            answers[key] = { choice: "approved", probabilities: { approved: 0.9 } };
          } else {
            answers[key] = { noul: 0.9, answer: "yes" };
          }
        }
        return { rawOutput: JSON.stringify({ answers }), durationMs: 20, finishReason: "stop" };
      }
      return {
        rawOutput: '{"steps":[{"goal":"x","suggested_mcp":"files","expected_outcome":"y"}]}',
        durationMs: 20,
        finishReason: "stop",
      };
    });
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=route",
    ]);
    const writer = await runEvaluation(config, {
      generativeClient: wrongLabelMock,
      decisionClient: wrongLabelMock,
    });
    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));
    const routeStage = scores.stages?.route;
    assert.ok(routeStage, "El stage route debe existir en scores");
    assert.ok(
      routeStage.passRate < 1,
      `passRate para route debe ser < 1 con etiqueta equivocada, got ${routeStage.passRate}`
    );
  });

  // -------------------------------------------------------------------------
  // Test 12: Varianza es null con repeat=1
  // -------------------------------------------------------------------------
  await test("Scores: varianza es null con repeat=1", async () => {
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
      "--repeat=1",
    ]);
    const writer = await runEvaluation(config);
    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));
    const planStage = scores.stages?.plan;
    assert.ok(planStage, "El stage plan debe existir");
    for (const c of planStage.cases) {
      assert.strictEqual(
        c.variance,
        null,
        `variance debe ser null con repeat=1, got ${c.variance} para ${c.caseId}`
      );
    }
  });

  // -------------------------------------------------------------------------
  // Test 13: passAllRate=0 cuando mock alterna pass/fail en --repeat=2
  // -------------------------------------------------------------------------
  await test("Scores: passAllRate=0 cuando mock alterna pass/fail en --repeat=2", async () => {
    let callCount = 0;
    const alternatingMock = new MockModelClient(() => {
      callCount++;
      // Pares → falla (JSON roto), impares → pasa
      if (callCount % 2 === 0) {
        return { rawOutput: "{bad", durationMs: 10, finishReason: "stop" };
      }
      return {
        rawOutput: '{"steps":[{"goal":"ok","suggested_mcp":"files","expected_outcome":"y"}]}',
        durationMs: 20,
        finishReason: "stop",
      };
    });
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
      "--repeat=2",
    ]);
    const writer = await runEvaluation(config, {
      generativeClient: alternatingMock,
      decisionClient: alternatingMock,
    });
    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));
    const planStage = scores.stages?.plan;
    assert.ok(planStage, "El stage plan debe existir");
    // passAllRate debe ser 0: ningún caso pasa en AMBAS repeticiones
    assert.strictEqual(
      planStage.passAllRate,
      0,
      `passAllRate debe ser 0 con mock alternante, got ${planStage.passAllRate}`
    );
    // passRate debe ser > 0 y < 1
    assert.ok(
      planStage.passRate > 0 && planStage.passRate < 1,
      `passRate debe ser intermedio, got ${planStage.passRate}`
    );
  });

  // -------------------------------------------------------------------------
  // Test 14: Mismo request → mismo requestHash; distintos → distinto hash
  // -------------------------------------------------------------------------
  await test("Trazabilidad: mismo request produce mismo requestHash", async () => {
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
      "--repeat=2",
    ]);
    const writer = await runEvaluation(config);
    const lines = fs.readFileSync(writer.runsFile, "utf-8").trim().split("\n");
    const runs = lines.map((l) => JSON.parse(l));

    // Agrupar por caseId
    const byCaseId: Record<string, any[]> = {};
    for (const r of runs) {
      byCaseId[r.caseId] = byCaseId[r.caseId] || [];
      byCaseId[r.caseId].push(r);
    }

    // Cada caso debe tener el mismo requestHash en todas sus repeticiones
    for (const [caseId, caseRuns] of Object.entries(byCaseId)) {
      if (caseRuns.length > 1) {
        const hashes = caseRuns.map((r: any) => r.requestHash);
        assert.ok(
          hashes.every((h: string) => h === hashes[0]),
          `requestHash debe ser idéntico entre repeticiones para ${caseId}: ${hashes.join(", ")}`
        );
      }
    }

    // Dos casos distintos deben tener distinto hash
    const allCaseIds = Object.keys(byCaseId);
    if (allCaseIds.length >= 2) {
      const h1 = byCaseId[allCaseIds[0]][0].requestHash;
      const h2 = byCaseId[allCaseIds[1]][0].requestHash;
      assert.notStrictEqual(h1, h2, "Casos distintos deben tener requestHash distintos");
    }
  });

  // -------------------------------------------------------------------------
  // Test 15: Scores raw no afecta passRate canónico, pero aparece en rawPassRate
  // -------------------------------------------------------------------------
  await test("Scores: rawPassRate y rawTotalRuns presentes en scores.json", async () => {
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=all",
    ]);
    const writer = await runEvaluation(config);
    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));

    assert.ok("rawPassRate" in scores, "scores.json debe tener rawPassRate");
    assert.ok("rawTotalRuns" in scores, "scores.json debe tener rawTotalRuns");
    assert.ok("rawPassedRuns" in scores, "scores.json debe tener rawPassedRuns");
    assert.ok(typeof scores.rawTotalRuns === "number", "rawTotalRuns debe ser number");
    assert.ok(typeof scores.rawPassRate === "number", "rawPassRate debe ser number");

    // sample.jsonl no tiene casos raw → rawTotalRuns = 0
    assert.strictEqual(scores.rawTotalRuns, 0, "sample.jsonl no tiene casos raw → rawTotalRuns debe ser 0");
  });

  // -------------------------------------------------------------------------
  // Test 16: schemaVersion y sourceHashes presentes
  // -------------------------------------------------------------------------
  await test("Meta: schemaVersion y sourceHashes presentes en todos los archivos de salida", async () => {
    const config = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
    ]);
    const writer = await runEvaluation(config);

    const meta = JSON.parse(fs.readFileSync(writer.metaFile, "utf-8"));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION, "meta.json debe tener schemaVersion correcto");
    assert.ok(meta.sourceHashes && typeof meta.sourceHashes === "object", "meta.json debe tener sourceHashes");
    assert.ok(Object.keys(meta.sourceHashes).length > 0, "sourceHashes debe tener al menos una entrada");

    const scores = JSON.parse(fs.readFileSync(writer.scoresFile, "utf-8"));
    assert.strictEqual(scores.schemaVersion, SCHEMA_VERSION, "scores.json debe tener schemaVersion correcto");

    const lines = fs.readFileSync(writer.runsFile, "utf-8").trim().split("\n");
    const run = JSON.parse(lines[0]);
    assert.strictEqual(run.schemaVersion, SCHEMA_VERSION, "runs.jsonl debe tener schemaVersion en cada línea");
    assert.ok(typeof run.requestHash === "string" && run.requestHash.length > 0, "runs.jsonl debe tener requestHash");
  });

  // -------------------------------------------------------------------------
  // Test 17: --minPassRate exit code 1 / 0
  // -------------------------------------------------------------------------
  await test("Runner: --minPassRate sube exitCode=1 cuando no se cumple, deja 0 cuando sí", async () => {
    const failMock = new MockModelClient(() => ({
      rawOutput: "{bad",
      durationMs: 10,
      finishReason: "stop",
    }));

    const prevExitCode = process.exitCode;

    // Caso: passRate=0 < minPassRate=0.5 → debe setear exitCode=1
    process.exitCode = 0;
    const failConfig = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
      "--minPassRate=0.5",
    ]);
    await runEvaluation(failConfig, { generativeClient: failMock, decisionClient: failMock });
    assert.strictEqual(process.exitCode, 1, "process.exitCode debe ser 1 cuando passRate < minPassRate");

    // Caso: passRate=1 > minPassRate=0.5 → no debe tocar exitCode
    process.exitCode = 0;
    const passConfig = parseCliArgs([
      "--model=mock",
      `--dataset=${SAMPLE_DATASET}`,
      "--stage=plan",
      "--minPassRate=0.5",
    ]);
    await runEvaluation(passConfig);
    assert.strictEqual(process.exitCode, 0, "process.exitCode debe quedar 0 cuando passRate >= minPassRate");

    // Restaurar
    process.exitCode = prevExitCode;
  });

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------------");
  console.log(` Tests finalizados: ${passedCount} pasados, ${failedCount} fallados.`);
  console.log("===============================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

void main();
