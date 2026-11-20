/**
 * eval/auto/eval_auto.test.ts
 *
 * Pruebas unitarias y end-to-end (con `--client=mock` y optimizador mockeado) del bucle autónomo (`eval:auto`).
 * Ejecución: `npx tsx --test eval/auto/eval_auto.test.ts`
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { runAutoLoop } from "../auto.ts";
import { autoStageDir, autoStatePath, parseAutoConfig, toEvalConfig, type AutoConfig } from "./config.ts";
import { readConclusionsBounded } from "./conclusions.ts";
import { discoverStageDatasets, discoverStageVariants } from "./discover.ts";
import { extractFailureSamples } from "./feedback.ts";
import {
  defaultOptimizerLlmCall,
  generateVariantsForRound,
  OptimizerTransportError,
  type OptimizerLlmCaller,
} from "./optimizer.ts";
import { archiveLosingAutoVariants, rankParticipants, scanReusableInitialRanking } from "./ranking.ts";
import { extractProdPromptSource, getStageContract } from "./stageContract.ts";
import { collectKnownVariantHashes, validateAndWriteVariant } from "./validateVariant.ts";
import { createMockDecisionClient, createMockGenerativeClient } from "../core/client/mock.ts";
import { generateComparisonReport, type InputCell } from "../core/report.ts";
import { allStageNames } from "../core/stages/index.ts";
import type { GlobalScoreSummary, RunRecord, StageName } from "../core/types.ts";
import { listVariantNames } from "../core/variants/load.ts";

const tempPathsToClean: string[] = [];

function trackTemp(p: string): string {
  tempPathsToClean.push(p);
  return p;
}

function trackDirIfCreated(dirPath: string): void {
  const abs = resolve(dirPath);
  if (!existsSync(abs)) {
    tempPathsToClean.push(abs);
  }
}

afterEach(() => {
  while (tempPathsToClean.length > 0) {
    const p = tempPathsToClean.pop()!;
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // Ignorar fallos de limpieza
    }
  }
  const autoRoot = resolve("eval/variants/_auto");
  try {
    if (existsSync(autoRoot)) rmdirSync(autoRoot);
  } catch {
    // Solo se elimina si quedó vacío
  }
});

describe("eval/auto config", () => {
  it("rechaza flags faltantes, rangos inválidos y --client=oracle", () => {
    assert.throws(() => parseAutoConfig([]), /Falta --stage/);
    assert.throws(() => parseAutoConfig(["--stage=unknown", "--max-loops=2", "--target=0.8", "--optimizer-model=m"]), /desconocida/);
    assert.throws(() => parseAutoConfig(["--stage=d0", "--max-loops=0", "--target=0.8", "--optimizer-model=m"]), /entero >= 1/);
    assert.throws(() => parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=1.2", "--optimizer-model=m"]), /en \(0, 1\]/);
    assert.throws(() => parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=0", "--optimizer-model=m"]), /en \(0, 1\]/);
    assert.throws(() => parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=0.8", "--optimizer-model=m", "--client=oracle"]), /real.*mock/);
    assert.throws(() => parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=0.8", "--optimizer-model=m", "--seed-top=a,b,c"]), /máximo 2/);
    assert.throws(
      () => parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=0.8", "--optimizer-model=m", "--optimizer-api-key-env=MISSING_AUTO_TEST_KEY"]),
      /no está definida/,
    );
  });

  it("parsea las 14 etapas (incluyendo continuation) y arma EvalConfig", () => {
    const cfg = parseAutoConfig([
      "--stage=continuation",
      "--max-loops=4",
      "--target=0.85",
      "--optimizer-model=qwen3:32b",
      "--metric=macroPassRate",
      "--archive-losers=false",
      "--client=mock",
      "--repeat=2",
    ]);
    assert.equal(cfg.stage, "continuation");
    assert.equal(cfg.maxLoops, 4);
    assert.equal(cfg.target, 0.85);
    assert.equal(cfg.metric, "macroPassRate");
    assert.equal(cfg.archiveLosers, false);
    assert.equal(cfg.client, "mock");
    assert.equal(cfg.repeat, 2);

    const evalCfg = toEvalConfig(cfg, { datasetSpecs: ["continuation_dev"], variantSpecs: ["prod"] });
    assert.deepEqual(evalCfg.stages, ["continuation"]);
    assert.equal(evalCfg.client, "mock");
    assert.equal(evalCfg.repeat, 2);
  });

  it("soporta --decision-model, --generative-model, --optimizer-thinking y detecta conflictos con --model", () => {
    const cfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.90",
      "--decision-model=d3:2b-custom",
      "--generative-model=qwen-custom",
      "--optimizer-model=qwen3.5:4b-text",
      "--optimizer-thinking=on",
    ]);
    assert.equal(cfg.decisionModel, "d3:2b-custom");
    assert.equal(cfg.model, "qwen-custom");
    assert.equal(cfg.optimizerThinking, "on");

    // --model con lado vacío permite complementar sin conflicto
    const merged = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.90",
      "--model=qwen-gen+",
      "--decision-model=d3:2b-custom",
      "--optimizer-model=opt-m",
    ]);
    assert.equal(merged.model, "qwen-gen");
    assert.equal(merged.decisionModel, "d3:2b-custom");

    assert.throws(
      () =>
        parseAutoConfig([
          "--stage=route",
          "--max-loops=2",
          "--target=0.90",
          "--model=gen1+dec1",
          "--decision-model=dec2",
          "--optimizer-model=opt-m",
        ]),
      /entra en conflicto/,
    );
    assert.throws(
      () =>
        parseAutoConfig([
          "--stage=plan",
          "--max-loops=2",
          "--target=0.90",
          "--model=gen1+dec1",
          "--generative-model=gen2",
          "--optimizer-model=opt-m",
        ]),
      /entra en conflicto/,
    );
    assert.throws(
      () =>
        parseAutoConfig([
          "--stage=route",
          "--max-loops=2",
          "--target=0.90",
          "--optimizer-model=opt-m",
          "--optimizer-thinking=maybe",
        ]),
      /--optimizer-thinking/,
    );
    assert.throws(
      () => parseAutoConfig(["--stage=route", "--max-loops=2", "--target=0.90", "--d-model=x", "--optimizer-model=m"]),
      /Ahora se llama '--decision-model=<id>'/,
    );
  });
});

describe("eval/auto discover y exclusiones", () => {
  it("excluye smoke.jsonl y *_holdout*.jsonl por defecto en dev", () => {
    const res = discoverStageDatasets("continuation", [], []);
    const devNames = res.dev.map((d) => d.name);
    assert.ok(devNames.includes("continuation_dev"));
    assert.ok(devNames.every((n) => n !== "smoke" && !/holdout/i.test(n)));
    assert.equal(res.holdout.length, 0);
  });

  it("rechaza solapamiento entre --dataset y --holdout", () => {
    assert.throws(
      () => discoverStageDatasets("continuation", ["continuation_holdout"], ["continuation_holdout"]),
      /no pueden solaparse/,
    );
  });

  it("excluye _archivo_* y descartadas/ de listVariantNames y discoverStageVariants", async () => {
    const tmpArchiveDir = resolve("eval/variants/_archivo_test_tmp");
    const tmpDescartadasDir = join(autoStageDir("recovery"), "descartadas");
    trackDirIfCreated("eval/variants/_auto");
    trackDirIfCreated(autoStageDir("recovery"));
    trackDirIfCreated(tmpArchiveDir);
    trackDirIfCreated(tmpDescartadasDir);
    mkdirSync(tmpArchiveDir, { recursive: true });
    mkdirSync(tmpDescartadasDir, { recursive: true });
    const tplArchive = getStageContract("recovery").minimalTemplate("_tmp_archived_variant");
    const tplDesc = getStageContract("recovery").minimalTemplate("_tmp_discarded_variant");
    writeFileSync(join(tmpArchiveDir, "_tmp_archived_variant.ts"), tplArchive, "utf8");
    writeFileSync(join(tmpDescartadasDir, "_tmp_discarded_variant.ts"), tplDesc, "utf8");
    const names = listVariantNames();
    assert.equal(names.includes("_tmp_archived_variant"), false);
    assert.equal(names.includes("_tmp_discarded_variant"), false);
    const recoveryVariants = await discoverStageVariants("recovery");
    assert.ok(recoveryVariants.some((v) => v.name === "recovery_three_options_nobehind"));
    assert.equal(recoveryVariants.some((v) => v.name === "_tmp_archived_variant" || v.name === "_tmp_discarded_variant"), false);
  });
});

describe("eval/auto stageContract", () => {
  it("cubre las 14 etapas registradas con plantilla y código prod en vivo", () => {
    const stages = allStageNames();
    assert.equal(stages.length, 14);
    for (const s of stages) {
      const c = getStageContract(s);
      assert.equal(c.stage, s);
      const tpl = c.minimalTemplate(`auto_${s}_test_r1_a`);
      assert.ok(tpl.includes("export default"));
      const prodSrc = extractProdPromptSource(s);
      assert.ok(prodSrc.length > 30 && !prodSrc.startsWith("// No se pudo extraer"), `prod source missing for ${s}`);
    }
  });
});

describe("eval/auto validateVariant", () => {
  const testStageDir = autoStageDir("args_review");

  it("rechaza imports prohibidos, params, read, POWERSHELL_RULES no exportado y código inseguro sin dejar basura en disco", async () => {
    trackDirIfCreated(testStageDir);
    const devDs = discoverStageDatasets("args_review", ["args_review_16_cases"], []);
    const devPaths = devDs.dev.map((d) => d.path);
    const known = new Set<string>();
    const validCode = getStageContract("args_review").minimalTemplate("auto_args_review_unittest_r1_a");

    const badCases: Array<{ code: string; expectRe: RegExp; stage?: StageName; devPathsOverride?: string[] }> = [
      {
        code: `import { readFileSync } from "node:fs";\n${validCode}`,
        expectRe: /Import prohibido/,
      },
      {
        code: `import {\n  readFileSync\n} from "node:fs";\n${validCode}`,
        expectRe: /Import prohibido/,
      },
      {
        code: `import { ROUTE_HINTS } from "../../../../src/core/models/prompts.ts";\n${validCode}`,
        expectRe: /NO está exportado/,
      },
      {
        code: `import {\n  ROUTE_HINTS\n} from "../../../../src/core/models/prompts.ts";\n${validCode}`,
        expectRe: /NO está exportado/,
      },
      {
        code: validCode.replace("export default", "const x = eval('1');\nexport default"),
        expectRe: /Identificador prohibido.*eval/,
      },
      {
        code: validCode.replace(
          'prompts: { DECISION_PROMPTS: { buildArgsReview } },',
          'prompts: { DECISION_PROMPTS: { buildArgsReview } },\n  read: { args_review: () => ({ choice: "approved", probabilities: { approved: 1 } }) },',
        ),
        expectRe: /Prohibido definir `read`/,
      },
      {
        code: getStageContract("pending")
          .minimalTemplate("auto_pending_unittest_r1_b")
          .replace("prompts: {", 'params: { pending: { temperature: 0.2 } },\n  prompts: {'),
        stage: "pending",
        devPathsOverride: discoverStageDatasets("pending", ["llm_gemai"], []).dev.map((d) => d.path),
        expectRe: /Prohibido definir `params`/,
      },
    ];

    for (let i = 0; i < badCases.length; i++) {
      const bc = badCases[i];
      const stage = bc.stage ?? "args_review";
      trackDirIfCreated(autoStageDir(stage));
      const vName = `auto_${stage}_badtest_${i}`;
      const expectedFile = resolve(autoStageDir(stage), `${vName}.ts`);
      trackTemp(expectedFile);
      const res = await validateAndWriteVariant({
        stage,
        variantName: vName,
        rawCode: bc.code,
        devDatasetPaths: bc.devPathsOverride ?? devPaths,
        knownHashes: known,
      });
      assert.equal(res.ok, false);
      assert.match(res.error, bc.expectRe);
      assert.equal(existsSync(expectedFile), false, "un archivo inválido debe limpiarse");
    }
  });

  it("inyecta name, valida plantilla ESM + loadDatasets + deduplicación por hash", async () => {
    const devDs = discoverStageDatasets("args_review", ["args_review_16_cases"], []);
    const devPaths = devDs.dev.map((d) => d.path);
    const known = new Set<string>();

    trackDirIfCreated(testStageDir);
    const vName = "auto_args_review_validtest_a";
    trackTemp(resolve(testStageDir, `${vName}.ts`));
    const code = getStageContract("args_review").minimalTemplate("wrong_name_from_llm");

    const ok1 = await validateAndWriteVariant({
      stage: "args_review",
      variantName: vName,
      rawCode: code,
      devDatasetPaths: devPaths,
      knownHashes: known,
    });
    assert.equal(ok1.ok, true);
    assert.equal(ok1.variant.name, vName);
    known.add(ok1.normalizedHash);

    // El mismo código con otro nombre debe detectarse como duplicado
    const vDup = "auto_args_review_validtest_b";
    trackTemp(resolve(testStageDir, `${vDup}.ts`));
    const dup = await validateAndWriteVariant({
      stage: "args_review",
      variantName: vDup,
      rawCode: code,
      devDatasetPaths: devPaths,
      knownHashes: known,
    });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /duplicada/i);
  });
});

describe("eval/auto ranking, archiving y feedback", () => {
  function mkRecord(opts: { variant: string; dataset: string; caseId: string; passed: boolean; durationMs: number; retried?: boolean; promptTokens?: number }): RunRecord {
    return {
      schemaVersion: 3,
      dataset: opts.dataset,
      caseId: opts.caseId,
      stage: "d0",
      stageKey: "d0",
      iteration: 1,
      variant: opts.variant,
      model: "d3:2b-text",
      passed: opts.passed,
      bucket: "canonical",
      errors: opts.passed ? [] : ["mismatch"],
      warnings: [],
      metrics: { client_call_ok: true, kind_match: opts.passed },
      measurements: { attempts: opts.retried ? 2 : 1 },
      requestHash: "abcd1234abcd1234",
      rawInput: { state: `Request: case ${opts.caseId}`, questions: { kind: { type: "choice", criteria: { chat: "c", single: "s", multi: "m" } } } },
      rawOutput: '{"kind":{"choice":"single"}}',
      durationMs: opts.durationMs,
      ...(opts.promptTokens !== undefined ? { tokens: { prompt: opts.promptTokens, completion: 10, total: opts.promptTokens + 10 } } : {}),
      timestamp: "2026-11-19T00:00:00.000Z",
    };
  }

  it("desempata correctamente por score, retries, ventaja neta vs prod, p50 y prompt tokens", () => {
    const mkScores = (recs: RunRecord[]): GlobalScoreSummary => {
      const passed = recs.filter((r) => r.passed).length;
      const pr = recs.length > 0 ? passed / recs.length : 0;
      return {
        schemaVersion: 3,
        totalRuns: recs.length,
        passedRuns: passed,
        passRate: pr,
        passAllRate: pr,
        avgDurationMs: 50,
        p50DurationMs: recs[0]?.durationMs ?? 0,
        p95DurationMs: recs[0]?.durationMs ?? 0,
        latencySamples: recs.length,
        clientFailedRuns: 0,
        rawTotalRuns: 0,
        rawPassedRuns: 0,
        rawPassRate: 0,
        stages: {
          d0: {
            stageKey: "d0",
            totalRuns: recs.length,
            passedRuns: passed,
            passRate: pr,
            passAllRate: pr,
            avgDurationMs: 50,
            p50DurationMs: recs[0]?.durationMs ?? 0,
            p95DurationMs: recs[0]?.durationMs ?? 0,
            latencySamples: recs.length,
            clientFailedRuns: 0,
            rawTotalRuns: 0,
            rawPassedRuns: 0,
            rawPassRate: 0,
            cases: [],
          },
        },
      };
    };

    const prodRecs = [
      mkRecord({ variant: "prod", dataset: "ds1", caseId: "c1", passed: true, durationMs: 80, promptTokens: 200 }),
      mkRecord({ variant: "prod", dataset: "ds1", caseId: "c2", passed: false, durationMs: 80, promptTokens: 200 }),
    ];
    const fastBetter = [
      mkRecord({ variant: "v_fast", dataset: "ds1", caseId: "c1", passed: true, durationMs: 30, promptTokens: 120 }),
      mkRecord({ variant: "v_fast", dataset: "ds1", caseId: "c2", passed: false, durationMs: 30, promptTokens: 120 }),
    ];
    const slowSame = [
      mkRecord({ variant: "v_slow", dataset: "ds1", caseId: "c1", passed: true, durationMs: 90, promptTokens: 150 }),
      mkRecord({ variant: "v_slow", dataset: "ds1", caseId: "c2", passed: false, durationMs: 90, promptTokens: 150 }),
    ];
    const retriedSame = [
      mkRecord({ variant: "v_retry", dataset: "ds1", caseId: "c1", passed: true, durationMs: 20, retried: true, promptTokens: 100 }),
      mkRecord({ variant: "v_retry", dataset: "ds1", caseId: "c2", passed: false, durationMs: 20, promptTokens: 100 }),
    ];

    const cells: InputCell[] = [
      { variantSpec: "prod", datasetName: "ds1", scores: mkScores(prodRecs), records: prodRecs },
      { variantSpec: "v_slow", datasetName: "ds1", scores: mkScores(slowSame), records: slowSame },
      { variantSpec: "v_fast", datasetName: "ds1", scores: mkScores(fastBetter), records: fastBetter },
      { variantSpec: "v_retry", datasetName: "ds1", scores: mkScores(retriedSame), records: retriedSame },
    ];

    const report = generateComparisonReport({ baseline: "prod", cells, concurrency: 1 });
    const ranked = rankParticipants(report, "passRate", cells);
    assert.deepEqual(
      ranked.map((r) => r.variant),
      ["v_fast", "prod", "v_slow", "v_retry"],
    );
  });

  it("filtra holdout de muestras de fallo y archiva perdedoras en descartadas/", () => {
    const prodRecs = [
      mkRecord({ variant: "prod", dataset: "dev_ds", caseId: "c1", passed: true, durationMs: 50 }),
      mkRecord({ variant: "prod", dataset: "hold_ds", caseId: "h1", passed: true, durationMs: 50 }),
    ];
    const v1Recs = [
      mkRecord({ variant: "v1", dataset: "dev_ds", caseId: "c1", passed: false, durationMs: 50 }),
      mkRecord({ variant: "v1", dataset: "hold_ds", caseId: "h1", passed: false, durationMs: 50 }),
    ];
    const samples = extractFailureSamples({
      focusVariant: "v1",
      cells: [
        { variantSpec: "prod", datasetName: "dev_ds", scores: {} as GlobalScoreSummary, records: prodRecs.slice(0, 1) },
        { variantSpec: "prod", datasetName: "hold_ds", scores: {} as GlobalScoreSummary, records: prodRecs.slice(1) },
        { variantSpec: "v1", datasetName: "dev_ds", scores: {} as GlobalScoreSummary, records: v1Recs.slice(0, 1) },
        { variantSpec: "v1", datasetName: "hold_ds", scores: {} as GlobalScoreSummary, records: v1Recs.slice(1) },
      ],
      devDatasetNames: new Set(["dev_ds"]),
    });
    assert.equal(samples.length, 1);
    assert.equal(samples[0].id, "c1");
    assert.equal(samples[0].priority, "regression_vs_prod");

    const stageDir = resolve(autoStageDir("d0"));
    trackDirIfCreated(stageDir);
    mkdirSync(stageDir, { recursive: true });
    const loserFile = resolve(stageDir, "auto_d0_losertest_b.ts");
    const destFile = resolve(stageDir, "descartadas", "auto_d0_losertest_b.ts");
    writeFileSync(loserFile, "export default {};\n", "utf8");
    trackTemp(loserFile);
    trackTemp(destFile);

    const moved = archiveLosingAutoVariants({
      stage: "d0",
      candidateFiles: [{ name: "auto_d0_losertest_b", filePath: loserFile }],
      top2: ["prod", "auto_d0_losertest_a"],
      ranked: [
        { variant: "prod", passRate: 0.8, macroPassRate: 0.8, score: 0.8, passedRuns: 8, totalRuns: 10, clientFailedRuns: 0, retriedRuns: 0, regressions: 0, improvements: 0 },
        { variant: "auto_d0_losertest_a", passRate: 0.75, macroPassRate: 0.75, score: 0.75, passedRuns: 7, totalRuns: 10, clientFailedRuns: 0, retriedRuns: 0, regressions: 1, improvements: 0 },
        { variant: "auto_d0_losertest_b", passRate: 0.6, macroPassRate: 0.6, score: 0.6, passedRuns: 6, totalRuns: 10, clientFailedRuns: 0, retriedRuns: 0, regressions: 2, improvements: 0 },
      ],
      archiveLosers: true,
    });
    assert.deepEqual(moved, ["auto_d0_losertest_b"]);
    assert.equal(existsSync(loserFile), false);
    assert.equal(existsSync(destFile), true);
  });
});

describe("eval/auto optimizer reparación", () => {
  it("reintenta reparación cuando una variante falla validación y conserva la válida", async () => {
    trackDirIfCreated(autoStageDir("d0"));
    const devDs = discoverStageDatasets("d0", ["d0_variedad"], []);
    const cfg = parseAutoConfig([
      "--stage=d0",
      "--max-loops=2",
      "--target=0.90",
      "--optimizer-model=mock-opt",
      "--client=mock",
    ]);

    const tpl = getStageContract("d0").minimalTemplate("placeholder");
    let calls = 0;
    const mockCaller: OptimizerLlmCaller = async () => {
      calls++;
      if (calls === 1) {
        return JSON.stringify({
          analysis: "Intento 1",
          variants: [
            { suffix: "a", hypothesis: "Válida A", code: tpl },
            { suffix: "b", hypothesis: "Inválida con fs", code: `import { existsSync } from "node:fs";\n${tpl}` },
          ],
        });
      }
      return JSON.stringify({
        analysis: "Reparación",
        variants: [
          {
            suffix: "b",
            hypothesis: "Reparada B",
            code: tpl.replace("One single action is enough.", "Exactly one action is enough."),
          },
        ],
      });
    };

    const res = await generateVariantsForRound({
      cfg,
      round: 1,
      runTag: "repairtest",
      conclusionsText: "(vacío)",
      top2Contexts: [],
      allRanked: [],
      failureSamples: [],
      devDatasetPaths: devDs.dev.map((d) => d.path),
      knownHashes: collectKnownVariantHashes("d0"),
      callLlm: mockCaller,
    });

    for (const v of res.validVariants) trackTemp(v.filePath);

    assert.equal(calls, 2);
    assert.equal(res.validVariants.length, 2);
    assert.equal(res.validVariants[0].name, "auto_d0_repairtest_r1_a");
    assert.equal(res.validVariants[1].name, "auto_d0_repairtest_r1_b");
  });

  it("limpia fences ```ts en code cuando el optimizador envuelve el código dentro del JSON", async () => {
    trackDirIfCreated(autoStageDir("d0"));
    const devDs = discoverStageDatasets("d0", ["d0_variedad"], []);
    const cfg = parseAutoConfig([
      "--stage=d0",
      "--max-loops=1",
      "--target=0.90",
      "--optimizer-model=mock-opt",
      "--client=mock",
    ]);

    const tpl = getStageContract("d0").minimalTemplate("placeholder");
    const fencedCaller: OptimizerLlmCaller = async () =>
      JSON.stringify({
        analysis: "Con fence ts",
        variants: [
          { suffix: "a", hypothesis: "Con fence", code: `\`\`\`ts\n${tpl}\n\`\`\`` },
          {
            suffix: "b",
            hypothesis: "Sin fence",
            code: tpl.replace("One single action is enough.", "Single action is enough."),
          },
        ],
      });

    const res = await generateVariantsForRound({
      cfg,
      round: 1,
      runTag: "fencetest",
      conclusionsText: "(vacío)",
      top2Contexts: [],
      allRanked: [],
      failureSamples: [],
      devDatasetPaths: devDs.dev.map((d) => d.path),
      knownHashes: collectKnownVariantHashes("d0"),
      callLlm: fencedCaller,
    });

    for (const v of res.validVariants) trackTemp(v.filePath);
    assert.equal(res.validVariants.length, 2);
    assert.equal(res.validVariants[0].code.includes("```"), false);
  });

  it("defaultOptimizerLlmCall envía reasoning_effort='none', degrada cuando json_schema devuelve vacío y reintenta si reasoning_effort es rechazado", async () => {
    const receivedBodies: Array<Record<string, unknown>> = [];
    let scenario: "empty_schema_then_ok" | "reject_reasoning_effort" | "always_empty" = "empty_schema_then_ok";

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        receivedBodies.push(body);

        if (scenario === "empty_schema_then_ok") {
          const fmt = (body.response_format as { type?: string } | undefined)?.type;
          res.writeHead(200, { "Content-Type": "application/json" });
          if (fmt === "json_schema") {
            res.end(
              JSON.stringify({
                choices: [{ finish_reason: "stop", message: { content: "", reasoning: "thinking..." } }],
              }),
            );
          } else {
            res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
          }
          return;
        }

        if (scenario === "reject_reasoning_effort") {
          if ("reasoning_effort" in body) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Unknown field: reasoning_effort" } }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "   ", reasoning: "abc" } }] }));
      });
    });

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const baseCall = {
        url: baseUrl,
        model: "qwen3.5:4b-text",
        timeoutMs: 5000,
        messages: [{ role: "user" as const, content: "hola" }],
        schemaName: "test_schema",
        schema: { type: "object" },
        reasoningEffort: "none" as const,
        maxTokens: 1024,
      };

      const out1 = await defaultOptimizerLlmCall(baseCall);
      assert.equal(out1, '{"ok":true}');
      assert.equal(receivedBodies.length, 2);
      assert.equal(receivedBodies[0].reasoning_effort, "none");
      assert.equal(receivedBodies[0].max_tokens, 1024);
      assert.equal((receivedBodies[0].response_format as { type: string }).type, "json_schema");
      assert.equal((receivedBodies[1].response_format as { type: string }).type, "json_object");

      receivedBodies.length = 0;
      scenario = "reject_reasoning_effort";
      const out2 = await defaultOptimizerLlmCall(baseCall);
      assert.equal(out2, '{"ok":true}');
      assert.equal(receivedBodies.some((b) => "reasoning_effort" in b), true);
      assert.equal(receivedBodies.some((b) => !("reasoning_effort" in b)), true);

      receivedBodies.length = 0;
      scenario = "always_empty";
      await assert.rejects(
        () => defaultOptimizerLlmCall(baseCall),
        (err: unknown) =>
          err instanceof OptimizerTransportError &&
          /respuesta vacía/.test(err.message) &&
          /reasoning=3 chars sin content/.test(err.message),
      );
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});

describe("eval/auto E2E runAutoLoop", () => {
  function setupTempAutoDir(stage: StageName, tag: string): { conclusionsPath: string; resultsRoot: string } {
    const tmpDir = trackTemp(mkdtempSync(join(tmpdir(), `jarvis-eval-auto-${tag}-`)));
    const resultsRoot = join(tmpDir, "results");
    mkdirSync(resultsRoot, { recursive: true });
    trackDirIfCreated(autoStageDir(stage));
    tempPathsToClean.push(resolve(autoStatePath(stage)));
    return { conclusionsPath: join(tmpDir, "conclusiones.md"), resultsRoot };
  }

  it("termina con exit 0 cuando variante != prod alcanza --target, actualiza conclusiones y archiva perdedora", async () => {
    const { conclusionsPath, resultsRoot } = setupTempAutoDir("route", "hit");
    const cfg: AutoConfig = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.80",
      "--optimizer-model=mock-opt",
      `--conclusions=${conclusionsPath}`,
      "--dataset=route_16_cases",
      "--seed-top=prod",
      "--client=mock",
      "--concurrency=2",
    ]);

    const baseTpl = getStageContract("route").minimalTemplate("base");
    // Truco limpio: una variante pone la respuesta esperada primero según instrucción para simular mejora real en mock
    const winCode = baseTpl.replace(
      "Choose the route that handles the next step.",
      "MOCK_WIN_MARKER: Prioritize the exact matching route.",
    );
    const loseCode = baseTpl.replace(
      "Choose the route that handles the next step.",
      "MOCK_LOSE_MARKER: Broad route check.",
    );

    const mockOptimizer: OptimizerLlmCaller = async ({ schemaName }) => {
      if (schemaName === "optimizer_variants") {
        return JSON.stringify({
          analysis: "Enfocar criterios por ruta",
          variants: [
            { suffix: "a", hypothesis: "Ganadora A", code: winCode },
            { suffix: "b", hypothesis: "Perdedora B", code: loseCode },
          ],
        });
      }
      return JSON.stringify({
        update: true,
        reason: "Nueva variante ganadora superó target",
        markdown: "# Conclusiones — route\n\n## Estado actual (auto-actualizado)\n- Top 1: ganadora >= 80%\n",
      });
    };

    const smartMakeClients = (c: AutoConfig) => ({
      genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
      decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_prepared, req) => {
        const inst = req.questions.route?.instructions ?? "";
        if (inst.includes("MOCK_WIN_MARKER")) {
          const isWeb = /internet|noticia|python|cotización/i.test(req.state);
          const pick = isWeb ? "web" : "files";
          return JSON.stringify({ answers: { route: { choice: pick, probabilities: { [pick]: 0.9 } } } });
        }
        if (inst.includes("MOCK_LOSE_MARKER")) {
          return JSON.stringify({ answers: { route: { choice: "locate", probabilities: { locate: 0.9 } } } });
        }
        return JSON.stringify({ answers: { route: { choice: "files", probabilities: { files: 0.9 } } } });
      }),
    });
    cfg.target = 0.40;

    const code = await runAutoLoop(cfg, {
      callOptimizer: mockOptimizer,
      makeClients: smartMakeClients,
      resultsRoot,
      silent: true,
    });

    assert.equal(code, 0);
    assert.equal(readConclusionsBounded(conclusionsPath).content.includes("# Conclusiones — route"), true);
    assert.equal(existsSync(resolve(autoStatePath("route"))), true);
  });

  it("con --holdout: sobreajuste en holdout alerta conclusiones y continúa hasta --max-loops (exit 1)", async () => {
    const { conclusionsPath, resultsRoot } = setupTempAutoDir("route", "overfit");
    const cfg: AutoConfig = parseAutoConfig([
      "--stage=route",
      "--max-loops=1",
      "--target=0.50",
      "--optimizer-model=mock-opt",
      `--conclusions=${conclusionsPath}`,
      "--dataset=route_16_cases",
      "--holdout=route_gemai",
      "--seed-top=prod",
      "--client=mock",
      "--concurrency=2",
    ]);

    const baseTpl = getStageContract("route").minimalTemplate("base");
    const devOverfitCode = baseTpl.replace("Choose the route that handles the next step.", "MOCK_DEV_ONLY_WIN");
    const altCode = baseTpl.replace("Choose the route that handles the next step.", "MOCK_ALT");

    const mockOptimizer: OptimizerLlmCaller = async ({ schemaName }) => {
      if (schemaName === "optimizer_variants") {
        return JSON.stringify({
          analysis: "Sobreajuste simulado",
          variants: [
            { suffix: "a", hypothesis: "Overfit A", code: devOverfitCode },
            { suffix: "b", hypothesis: "Alt B", code: altCode },
          ],
        });
      }
      return JSON.stringify({ update: false, reason: "sin cambios aún" });
    };

    // En route_16_cases acierta mucho; en route_gemai (o en cualquier otro) responde una ruta minoritaria para simular caída < target
    const makeClients = (c: AutoConfig) => ({
      genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
      decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_prepared, req) => {
        const inst = req.questions.route?.instructions ?? "";
        if (inst.includes("MOCK_DEV_ONLY_WIN")) {
          // Acierta >50% en route_16_cases (web+files+terminal keywords), pero falla cuando aparece "gem" o en holdout usando heuristic de route_gemai
          const looksLike16 = /package\.json|README|notepad|desktop|calc|downloads/i.test(req.state);
          const pick = looksLike16 ? (/notepad|calc|cmd|git|node/i.test(req.state) ? "terminal" : /http|search|version/i.test(req.state) ? "web" : "files") : "locate";
          return JSON.stringify({ answers: { route: { choice: pick, probabilities: { [pick]: 0.9 } } } });
        }
        return JSON.stringify({ answers: { route: { choice: "locate", probabilities: { locate: 0.9 } } } });
      }),
    });

    const code = await runAutoLoop(cfg, {
      callOptimizer: mockOptimizer,
      makeClients,
      resultsRoot,
      silent: true,
    });

    assert.equal(code, 1);
    const md = readConclusionsBounded(conclusionsPath).content;
    assert.match(md, /Alerta holdout|sobreajuste|Alcanzado maxLoops/i);
  });

  it("aborta con exit 2 sin tocar conclusiones.md ni auto_state.json si falla transporte del optimizador", async () => {
    const { conclusionsPath, resultsRoot } = setupTempAutoDir("route", "infra");
    const cfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.80",
      "--optimizer-model=mock-opt",
      `--conclusions=${conclusionsPath}`,
      "--dataset=route_16_cases",
      "--seed-top=prod",
      "--client=mock",
    ]);

    const failingOptimizer: OptimizerLlmCaller = async () => {
      throw new OptimizerTransportError("Connection refused (simulated)");
    };

    const code = await runAutoLoop(cfg, {
      callOptimizer: failingOptimizer,
      resultsRoot,
      silent: true,
    });

    assert.equal(code, 2);
    assert.equal(existsSync(conclusionsPath), false);
    assert.equal(existsSync(resolve(autoStatePath("route"))), false);
  });

  it("reutiliza resultados cacheados en disco si coincide exactamente la huella Meta", async () => {
    const resultsDir = trackTemp(mkdtempSync(join(tmpdir(), "jarvis-eval-cache-")));
    const cfg = parseAutoConfig([
      "--stage=d0",
      "--max-loops=1",
      "--target=0.90",
      "--optimizer-model=mock-opt",
      "--dataset=d0_variedad",
      "--client=mock",
    ]);

    const ds = discoverStageDatasets("d0", ["d0_variedad"], []).dev[0];
    const runDir = resolve(resultsDir, "2026-11-19_120000", `prod__${ds.name}`);
    mkdirSync(runDir, { recursive: true });

    const { loadVariantSpec } = await import("../core/variants/load.ts");
    const { objectHash } = await import("../core/results.ts");
    const { promptEnvironment } = await import("../core/scenario.ts");
    const prodSpec = await loadVariantSpec("prod");

    const mockRec: RunRecord = {
      schemaVersion: 3,
      dataset: ds.name,
      caseId: ds.cases[0].id,
      stage: "d0",
      stageKey: "d0",
      iteration: 1,
      variant: "prod",
      model: cfg.decisionModel,
      passed: true,
      bucket: "canonical",
      errors: [],
      warnings: [],
      metrics: { client_call_ok: true, kind_match: true },
      measurements: { attempts: 1 },
      requestHash: "1111222233334444",
      rawInput: {},
      rawOutput: "{}",
      durationMs: 42,
      timestamp: "2026-11-19T12:00:00.000Z",
    };

    const meta = {
      schemaVersion: 3,
      runId: "cached-run-id",
      timestamp: "2026-11-19T12:00:00.000Z",
      model: cfg.model,
      decisionModel: cfg.decisionModel,
      url: cfg.url,
      decisionUrl: cfg.decisionUrl,
      variantHash: prodSpec.hash,
      datasetPath: ds.path,
      datasetHash: ds.hash,
      stages: ["d0"],
      filters: { tags: [], ids: [], limit: null },
      cases: { count: ds.cases.length, hash: objectHash(ds.cases.map((c) => c.id).sort()) },
      promptEnv: promptEnvironment(),
      repeat: cfg.repeat,
      params: {
        concurrency: cfg.concurrency,
        thinking: cfg.thinking,
        client: cfg.client,
        includeShortcut: cfg.includeShortcut,
      },
    };

    const scores: GlobalScoreSummary = {
      schemaVersion: 3,
      totalRuns: 1,
      passedRuns: 1,
      passRate: 1,
      passAllRate: 1,
      avgDurationMs: 42,
      p50DurationMs: 42,
      p95DurationMs: 42,
      latencySamples: 1,
      clientFailedRuns: 0,
      rawTotalRuns: 0,
      rawPassedRuns: 0,
      rawPassRate: 0,
      stages: {
        d0: {
          stageKey: "d0",
          totalRuns: 1,
          passedRuns: 1,
          passRate: 1,
          passAllRate: 1,
          avgDurationMs: 42,
          p50DurationMs: 42,
          p95DurationMs: 42,
          latencySamples: 1,
          clientFailedRuns: 0,
          rawTotalRuns: 0,
          rawPassedRuns: 0,
          rawPassRate: 0,
          cases: [],
        },
      },
    };

    writeFileSync(resolve(runDir, "meta.json"), JSON.stringify(meta), "utf8");
    writeFileSync(resolve(runDir, "scores.json"), JSON.stringify(scores), "utf8");
    writeFileSync(resolve(runDir, "runs.jsonl"), `${JSON.stringify(mockRec)}\n`, "utf8");

    const reused = scanReusableInitialRanking({
      cfg,
      variants: [{ name: "prod", hash: prodSpec.hash }],
      datasets: [{ name: ds.name, hash: ds.hash, casesHash: meta.cases.hash }],
      resultsRoot: resultsDir,
    });

    assert.ok(reused !== null);
    assert.equal(reused.ranked[0].variant, "prod");
    assert.equal(reused.ranked[0].passRate, 1);

    // Si cambia thinking o modelo en cfg, NO debe reutilizar el caché
    const mismatch = scanReusableInitialRanking({
      cfg: { ...cfg, decisionModel: "otro:2b" },
      variants: [{ name: "prod", hash: prodSpec.hash }],
      datasets: [{ name: ds.name, hash: ds.hash, casesHash: meta.cases.hash }],
      resultsRoot: resultsDir,
    });
    assert.equal(mismatch, null);

    // Si runs.jsonl mezcla varias etapas (ej. smoke), recalcula scores solo para cfg.stage
    const otherStageRec: RunRecord = {
      ...mockRec,
      caseId: "other-route-1",
      stage: "route",
      stageKey: "route",
      passed: false,
    };
    const mixedScores: GlobalScoreSummary = {
      ...scores,
      totalRuns: 2,
      passedRuns: 1,
      passRate: 0.5,
      passAllRate: 0.5,
    };
    writeFileSync(resolve(runDir, "scores.json"), JSON.stringify(mixedScores), "utf8");
    writeFileSync(
      resolve(runDir, "runs.jsonl"),
      `${JSON.stringify(mockRec)}\n${JSON.stringify(otherStageRec)}\n`,
      "utf8",
    );
    const mixedReused = scanReusableInitialRanking({
      cfg,
      variants: [{ name: "prod", hash: prodSpec.hash }],
      datasets: [{ name: ds.name, hash: ds.hash, casesHash: meta.cases.hash }],
      resultsRoot: resultsDir,
    });
    assert.ok(mixedReused !== null);
    assert.equal(mixedReused.ranked[0].passRate, 1);
    assert.equal(mixedReused.ranked[0].totalRuns, 1);
    void basename(runDir);
  });

  it("runAutoCli soporta --help devolviendo exit 0 y validando errores con exit 2", async () => {
    const { runAutoCli } = await import("../auto.ts");
    const origLog = console.log;
    const origErr = console.error;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.map(String).join(" ") + "\n";
    };
    console.error = (...args: unknown[]) => {
      output += args.map(String).join(" ") + "\n";
    };
    try {
      const helpCode = await runAutoCli(["--help"]);
      assert.equal(helpCode, 0);
      assert.match(output, /eval --auto/);

      const badCode = await runAutoCli(["--unknown-flag=1"]);
      assert.equal(badCode, 2);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });
});
