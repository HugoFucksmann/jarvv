/**
 * eval/auto/eval_auto.test.ts
 *
 * Pruebas unitarias y end-to-end (con `--client=mock` y optimizador mockeado) del bucle autónomo (`eval:auto`).
 * Ejecución: `npx tsx --test eval/auto/eval_auto.test.ts`
 */

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { runAutoLoop, runAutoStages } from "../auto.ts";
import { argvForStage, checkMultiStageFlags, combineExitCodes, expandStages, formatStageSummary, holdoutFilesOf, isMultiStageArg } from "./stages.ts";
import { autoStageDir, autoStatePath, parseAutoConfig, toEvalConfig, winnersStageDir, type AutoConfig } from "./config.ts";
import { appendLedger, clipSummary, formatLedgerForPrompt, LEDGER_PROMPT_ENTRIES, readLedger } from "./ledger.ts";
import { discoverStageDatasets, discoverStageVariants } from "./discover.ts";
import { extractConfusions, formatConfusions } from "./feedback.ts";
import { buildPatchedVariantSource, buildSystemVariantSource, collectDecisionRequests, currentSystemText, formatCurrentTexts, mergePatch, patchFromRaw, patchFromRequests, shapeFromRequests, systemFromRaw } from "./patchVariant.ts";
import { loadVariantSpecEphemeral } from "./ephemeralVariant.ts";
import { extractFailureKinds, failureKindOf, formatFailureKinds } from "./feedback.ts";
import {
  defaultOptimizerLlmCall,
  generateVariantsForRound,
  OptimizerTransportError,
  type OptimizerLlmCaller,
} from "./optimizer.ts";
import { archiveLosingAutoVariants, promoteWinningAutoVariants, rankParticipants, reusableResultsDirs, scanReusableInitialRanking } from "./ranking.ts";
import { getStageContract } from "./stageContract.ts";
import { collectKnownVariantHashes, validateAndWriteVariant } from "./validateVariant.ts";
import { createMockDecisionClient, createMockGenerativeClient } from "../core/client/mock.ts";
import { generateComparisonReport, type InputCell } from "../core/report.ts";
import { allStageNames, isDecisionStage } from "../core/stages/index.ts";
import type { GlobalScoreSummary, RunRecord, StageName } from "../core/types.ts";
import { invalidateVariantCache, listVariantNames, loadVariantSpec } from "../core/variants/load.ts";

const tempPathsToClean: string[] = [];

/** Código válido de una variante de decisión, armado como lo hace el modo auto a partir de textos. `key` es la pregunta cuya instrucción se reemplaza. */
const decisionVariantCode = (stage: StageName, variantName: string, instruction = "Pick one.", key = "route"): string =>
  buildPatchedVariantSource({ promptKey: getStageContract(stage).promptKey, variantName, patch: { instructions: { [key]: instruction } } });

const FIXTURE_DATASETS_SRC = resolve("eval/auto/fixtures/datasets");
const installedFixtures: string[] = [];

// Los datasets de trabajo reales los carga el usuario aparte: las pruebas traen los suyos mínimos y los instalan solo mientras corren.
before(() => {
  for (const file of readdirSync(FIXTURE_DATASETS_SRC)) {
    const dest = resolve("eval/datasets", file);
    if (existsSync(dest)) continue;
    copyFileSync(join(FIXTURE_DATASETS_SRC, file), dest);
    installedFixtures.push(dest);
  }
});

after(() => {
  while (installedFixtures.length > 0) rmSync(installedFixtures.pop()!, { force: true });
});

function trackTemp(p: string): string {
  tempPathsToClean.push(p);
  return p;
}

function setupIsolatedVariantsRoot(tag: string): string {
  const tmpRoot = trackTemp(mkdtempSync(join(tmpdir(), `jarvis-eval-vroot-${tag}-`)));
  symlinkSync(resolve("src"), join(tmpRoot, "src"), process.platform === "win32" ? "junction" : "dir");
  mkdirSync(join(tmpRoot, "eval", "variants"), { recursive: true });
  symlinkSync(resolve("eval/core"), join(tmpRoot, "eval", "core"), process.platform === "win32" ? "junction" : "dir");
  const variantsRoot = join(tmpRoot, "eval", "variants");
  copyFileSync(resolve("eval/variants/prod.ts"), join(variantsRoot, "prod.ts"));
  return variantsRoot;
}

/** Directorios temporales aislados de un E2E de `runAutoLoop`: historial, resultados y raíz de variantes. */
function setupTempAutoDir(_stage: StageName, tag: string): { ledgerPath: string; resultsRoot: string; variantsRoot: string } {
  const variantsRoot = setupIsolatedVariantsRoot(`e2e-${tag}`);
  const tmpDir = trackTemp(mkdtempSync(join(tmpdir(), `jarvis-eval-auto-${tag}-`)));
  const resultsRoot = join(tmpDir, "results");
  mkdirSync(resultsRoot, { recursive: true });
  return { ledgerPath: join(tmpDir, "ledger.jsonl"), resultsRoot, variantsRoot };
}

afterEach(() => {
  while (tempPathsToClean.length > 0) {
    const p = tempPathsToClean.pop()!;
    invalidateVariantCache(join(p, "eval", "variants"));
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // Ignorar fallos de limpieza
    }
  }
  invalidateVariantCache();
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
    const variantsRoot = setupIsolatedVariantsRoot("discover");
    const tmpArchiveDir = join(variantsRoot, "_archivo_test_tmp");
    const tmpActiveDir = join(variantsRoot, "recovery");
    const tmpDescartadasDir = join(autoStageDir("recovery", variantsRoot), "descartadas");
    mkdirSync(tmpArchiveDir, { recursive: true });
    mkdirSync(tmpActiveDir, { recursive: true });
    mkdirSync(tmpDescartadasDir, { recursive: true });

    const tplArchive = decisionVariantCode("recovery", "_tmp_archived_variant");
    const tplDesc = decisionVariantCode("recovery", "_tmp_discarded_variant");
    copyFileSync(
      resolve("eval/auto/fixtures/variants/recovery_three_options_nobehind.ts.txt"),
      join(tmpActiveDir, "recovery_three_options_nobehind.ts"),
    );
    writeFileSync(join(tmpArchiveDir, "_tmp_archived_variant.ts"), tplArchive, "utf8");
    writeFileSync(join(tmpDescartadasDir, "_tmp_discarded_variant.ts"), tplDesc, "utf8");

    const names = listVariantNames(variantsRoot);
    assert.equal(names.includes("recovery_three_options_nobehind"), true);
    assert.equal(names.includes("_tmp_archived_variant"), false);
    assert.equal(names.includes("_tmp_discarded_variant"), false);

    const recoveryVariants = await discoverStageVariants("recovery", variantsRoot);
    assert.ok(recoveryVariants.some((v) => v.name === "recovery_three_options_nobehind"));
    assert.equal(recoveryVariants.some((v) => v.name === "_tmp_archived_variant" || v.name === "_tmp_discarded_variant"), false);
  });
});

describe("eval/auto stageContract", () => {
  it("cubre las 14 etapas registradas (decisión: clave del constructor; generativas: contrato y texto SYSTEM de prod)", () => {
    const stages = allStageNames();
    assert.equal(stages.length, 14);
    for (const s of stages) {
      const c = getStageContract(s);
      assert.equal(c.stage, s);
      if (c.requestType === "generative") {
        // Las generativas cambian solo el texto SYSTEM: tiene que existir en prod, y el contrato dice qué formato exige.
        assert.equal(c.promptGroup, "PROMPTS");
        assert.ok(c.outputContract.length > 20 && c.graderRules.length > 20);
        assert.ok(currentSystemText(c.promptKey).length > 30, `prod SYSTEM missing for ${s}`);
      } else {
        assert.equal(c.promptGroup, "DECISION_PROMPTS");
        assert.match(c.promptKey, /^build[A-Z]/);
      }
    }
  });
});

describe("eval/auto validateVariant", () => {
  it("rechaza lo que no compila, no carga o no tiene la forma de la etapa, sin dejar archivos en disco", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("badcases");
    const devPaths = discoverStageDatasets("args_review", ["args_review_16_cases"], []).dev.map((d) => d.path);
    const validCode = decisionVariantCode("args_review", "auto_args_review_unittest_r1_a", "Review the call.", "review");

    const badCases: Array<{ code: string; expectRe: RegExp; name?: string; stage?: StageName; devPathsOverride?: string[] }> = [
      { code: "const x: = ;", expectRe: /Error de sintaxis TypeScript/ },
      { code: `import { readFileSync } from "node:fs";\nvoid readFileSync;\n${validCode}`, expectRe: /Import prohibido/ },
      {
        code: validCode.replace("prompts: { DECISION_PROMPTS: { buildArgsReview } },", 'prompts: { DECISION_PROMPTS: { buildArgsReview } },\n  read: { args_review: () => ({ choice: "approved", probabilities: { approved: 1 } }) },'),
        expectRe: /no `params` ni `read`/,
      },
      {
        // Un archivo de decisión no sirve para una etapa generativa.
        code: validCode.replaceAll("auto_args_review_unittest_r1_a", "auto_pending_badtest_1"),
        name: "auto_pending_badtest_1",
        stage: "pending",
        devPathsOverride: discoverStageDatasets("pending", ["pending_min"], []).dev.map((d) => d.path),
        expectRe: /solo puede definir 'PROMPTS'/,
      },
      {
        code: buildSystemVariantSource({ promptKey: "PENDING_VIEW", variantName: "otro_nombre", system: "Texto de prueba." }),
        name: "auto_pending_badtest_4",
        stage: "pending",
        devPathsOverride: discoverStageDatasets("pending", ["pending_min"], []).dev.map((d) => d.path),
        expectRe: /no coincide/,
      },
    ];

    for (let i = 0; i < badCases.length; i++) {
      const bc = badCases[i];
      const stage = bc.stage ?? "args_review";
      const vName = bc.name ?? "auto_args_review_unittest_r1_a";
      const expectedFile = resolve(autoStageDir(stage, variantsRoot), `${vName}.ts`);
      const res = await validateAndWriteVariant({
        stage,
        variantName: vName,
        rawCode: bc.code,
        devDatasetPaths: bc.devPathsOverride ?? devPaths,
        knownHashes: new Set<string>(),
        variantsRoot,
      });
      assert.equal(res.ok, false, `caso ${i}`);
      assert.match(res.error, bc.expectRe, `caso ${i}`);
      assert.equal(existsSync(expectedFile), false, "un archivo inválido debe limpiarse");
    }
  });

  it("valida el archivo armado, lo escribe y detecta como duplicada una variante con los mismos textos aunque tenga otro nombre", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("validtest");
    const devPaths = discoverStageDatasets("args_review", ["args_review_16_cases"], []).dev.map((d) => d.path);
    const known = new Set<string>();

    const vName = "auto_args_review_validtest_a";
    const ok1 = await validateAndWriteVariant({
      stage: "args_review",
      variantName: vName,
      rawCode: decisionVariantCode("args_review", vName, "Review the call.", "review"),
      devDatasetPaths: devPaths,
      knownHashes: known,
      variantsRoot,
    });
    assert.equal(ok1.ok, true);
    assert.equal(ok1.variant.name, vName);
    assert.equal(existsSync(ok1.filePath), true);
    known.add(ok1.normalizedHash);

    const vDup = "auto_args_review_validtest_b";
    const dup = await validateAndWriteVariant({
      stage: "args_review",
      variantName: vDup,
      rawCode: decisionVariantCode("args_review", vDup, "Review the call.", "review"),
      devDatasetPaths: devPaths,
      knownHashes: known,
      variantsRoot,
    });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /duplicada/i);

    const other = await validateAndWriteVariant({
      stage: "args_review",
      variantName: "auto_args_review_validtest_c",
      rawCode: decisionVariantCode("args_review", "auto_args_review_validtest_c", "Review the call carefully.", "review"),
      devDatasetPaths: devPaths,
      knownHashes: known,
      variantsRoot,
    });
    assert.equal(other.ok, true, other.ok ? "" : other.error);
  });

  it("carga todas las variantes activas en eval/variants/, rechaza recovery de 2 ejes y no toca disco si falla al materializar los casos", async () => {
    const names = listVariantNames();
    for (const name of names) {
      const loaded = await loadVariantSpec(name);
      assert.equal(loaded.variant.name, name);
    }

    const variantsRoot = setupIsolatedVariantsRoot("recoveryval");
    const recoveryPaths = discoverStageDatasets("recovery", ["recovery_casos"], []).dev.map((d) => d.path);
    const recoveryStageDir = autoStageDir("recovery", variantsRoot);

    // El formato legado de 2 ejes (blocked/prereq sin action) debe ser rechazado por recoveryStage.validateRequest
    const twoAxesCode = `import type { RecoveryDecisionInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  return {
    state: data.failed,
    questions: {
      blocked: { type: "noul", instructions: "Is it blocked?" },
      prereq: { type: "noul", instructions: "Missing prerequisite?" },
    },
  };
}

const auto_recovery_twoaxes_legacy: Variant = {
  name: "auto_recovery_twoaxes_legacy",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default auto_recovery_twoaxes_legacy;`;
    const legacyRes = await validateAndWriteVariant({
      stage: "recovery",
      variantName: "auto_recovery_twoaxes_legacy",
      rawCode: twoAxesCode,
      devDatasetPaths: recoveryPaths,
      knownHashes: new Set(),
      variantsRoot,
    });
    assert.equal(legacyRes.ok, false);
    assert.match(legacyRes.error, /cambia la estructura de la decisión|recovery requiere pregunta choice/);

    // Un constructor que lanza al ejecutarse sobre los casos: la validación debe rechazarlo sin escribir nada.
    const badRtName = "auto_recovery_badrt_test_a";
    const badRtFile = resolve(recoveryStageDir, `${badRtName}.ts`);
    const badRtCode = decisionVariantCode("recovery", badRtName, "Pick one.", "action").replace(
      "const base = DECISION_PROMPTS.buildRecovery(data);",
      'const base = DECISION_PROMPTS.buildRecovery(data);\n  if (data) throw new Error("falla simulada");',
    );
    assert.ok(badRtCode.includes("falla simulada"));
    const badRtRes = await validateAndWriteVariant({
      stage: "recovery",
      variantName: badRtName,
      rawCode: badRtCode,
      devDatasetPaths: recoveryPaths,
      knownHashes: new Set(),
      variantsRoot,
    });
    assert.equal(badRtRes.ok, false);
    assert.equal(existsSync(badRtFile), false, "variante fallida al materializar los casos no debe escribirse en disco");
  });
});

describe("eval/auto: variantes ganadoras", () => {
  const row = (variant: string, score: number) => ({ variant, passRate: score, macroPassRate: score, score, passedRuns: score * 10, totalRuns: 10, clientFailedRuns: 0, retriedRuns: 0, regressions: 0, improvements: 0 });

  it("mueve a _ganadoras/<etapa>/ solo las que superan a prod, sin pisar archivos ni tocar las demás", () => {
    const variantsRoot = setupIsolatedVariantsRoot("winners");
    const dir = resolve(autoStageDir("d0", variantsRoot));
    mkdirSync(dir, { recursive: true });
    const files = ["auto_d0_w_a", "auto_d0_w_b", "auto_d0_w_c", "auto_d0_w_d"].map((name) => {
      const filePath = resolve(dir, `${name}.ts`);
      writeFileSync(filePath, `export default { name: "${name}" };\n`, "utf8");
      return { name, filePath };
    });
    // Ya hay un archivo con el nombre de la d en _ganadoras: no se pisa.
    mkdirSync(winnersStageDir("d0", variantsRoot), { recursive: true });
    writeFileSync(join(winnersStageDir("d0", variantsRoot), "auto_d0_w_d.ts"), "// anterior\n", "utf8");

    const moved = promoteWinningAutoVariants({
      stage: "d0",
      candidateFiles: files,
      ranked: [row("prod", 0.8), row("auto_d0_w_a", 0.9), row("auto_d0_w_b", 0.8), row("auto_d0_w_c", 0.7), row("auto_d0_w_d", 0.95)],
      variantsRoot,
    });
    assert.deepEqual(moved, ["auto_d0_w_a"]);
    assert.equal(existsSync(join(winnersStageDir("d0", variantsRoot), "auto_d0_w_a.ts")), true);
    assert.equal(existsSync(files[0].filePath), false);
    // Empata con prod (b), pierde (c) o ya existe el destino (d): quedan donde estaban.
    for (const i of [1, 2, 3]) assert.equal(existsSync(files[i].filePath), true);
    assert.equal(readFileSync(join(winnersStageDir("d0", variantsRoot), "auto_d0_w_d.ts"), "utf8"), "// anterior\n");
  });

  it("los hashes de las ganadoras cuentan como conocidos, así no se vuelve a probar el mismo texto", () => {
    const variantsRoot = setupIsolatedVariantsRoot("winnerhash");
    const winners = winnersStageDir("d0", variantsRoot);
    mkdirSync(winners, { recursive: true });
    const code = decisionVariantCode("d0", "auto_d0_h_a", "Pick one.", "kind");
    writeFileSync(join(winners, "auto_d0_h_a.ts"), code, "utf8");
    assert.equal(collectKnownVariantHashes("d0", [], variantsRoot).size, 1);
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

  it("resume tipos de fallo sin holdout ni casos y archiva sin colisiones invalidando caché", () => {
    const recordWithErrors = (variant: string, dataset: string, caseId: string, errors: string[]) => ({
      ...mkRecord({ variant, dataset, caseId, passed: errors.length === 0, durationMs: 50 }),
      errors,
    });
    const kinds = extractFailureKinds({
      focusVariant: "v1",
      cells: [
        {
          variantSpec: "v1",
          datasetName: "dev_ds",
          scores: {} as GlobalScoreSummary,
          records: [
            recordWithErrors("v1", "dev_ds", "c1", ["Pasos generados (1) menor al mínimo esperado (2).", "Rutas requeridas faltantes: files_write"]),
            recordWithErrors("v1", "dev_ds", "c2", ["Pasos generados (1) menor al mínimo esperado (3)."]),
            recordWithErrors("v1", "dev_ds", "c3", []),
          ],
        },
        { variantSpec: "v1", datasetName: "hold_ds", scores: {} as GlobalScoreSummary, records: [recordWithErrors("v1", "hold_ds", "h1", ["Error de holdout"])] },
      ],
      devDatasetNames: new Set(["dev_ds"]),
    });
    assert.deepEqual(kinds, [
      { kind: "Pasos generados (N) menor al mínimo esperado (N).", count: 2, total: 3 },
      { kind: "Rutas requeridas faltantes", count: 1, total: 3 },
    ]);
    assert.equal(failureKindOf('Pregunta no contiene la palabra clave esperada: "ubuntu"'), "Pregunta no contiene la palabra clave esperada");
    assert.equal(failureKindOf("Primer paso usa 'web' en vez de 'files_read'."), "Primer paso usa … en vez de ….");
    const text = formatFailureKinds(kinds);
    assert.match(text, /2 de 3 casos/);
    assert.doesNotMatch(text, /files_write|holdout/);

    const variantsRoot = setupIsolatedVariantsRoot("archive");
    const stageDir = resolve(autoStageDir("d0", variantsRoot));
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(resolve(stageDir, "descartadas"), { recursive: true });
    const loserFile = resolve(stageDir, "auto_d0_losertest_b.ts");
    const existingDiscarded = resolve(stageDir, "descartadas", "auto_d0_losertest_b.ts");
    const destWithSuffix = resolve(stageDir, "descartadas", "auto_d0_losertest_b-2.ts");
    writeFileSync(loserFile, 'export default { name: "auto_d0_losertest_b" };\n', "utf8");
    writeFileSync(existingDiscarded, 'export default { name: "auto_d0_losertest_b" };\n', "utf8");
    // Poblar caché antes de archivar
    assert.equal(listVariantNames(variantsRoot).includes("auto_d0_losertest_b"), true);

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
      variantsRoot,
    });
    assert.deepEqual(moved, ["auto_d0_losertest_b"]);
    assert.equal(existsSync(loserFile), false);
    assert.equal(existsSync(existingDiscarded), true);
    assert.equal(existsSync(destWithSuffix), true);
    assert.equal(listVariantNames(variantsRoot).includes("auto_d0_losertest_b"), false);
  });
});

describe("eval/auto optimizer reparación", () => {
  it("reintenta reparación cuando una variante de decisión falla validación y conserva la válida", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("repair");
    const devPath = resolve("eval/auto/fixtures/datasets/d0_variedad.jsonl");
    const shape = shapeFromRequests(collectDecisionRequests("d0", [devPath]));
    const cfg = parseAutoConfig(["--stage=d0", "--max-loops=2", "--target=0.90", "--optimizer-model=mock-opt", "--client=mock"]);

    let calls = 0;
    const repairs: string[] = [];
    const mockCaller: OptimizerLlmCaller = async ({ messages }) => {
      calls++;
      if (calls === 1) {
        return JSON.stringify({
          analysis: "Intento 1",
          variants: [
            { suffix: "a", hypothesis: "Válida A", instructions: { kind: "Classify the request." } },
            { suffix: "b", hypothesis: "Inválida: pregunta inexistente", instructions: { no_existe: "x" } },
          ],
        });
      }
      repairs.push(messages[messages.length - 1].content);
      return JSON.stringify({
        analysis: "Reparación",
        variants: [{ suffix: "b", hypothesis: "Reparada B", instructions: { kind: "Classify the request as chat, single or multi." } }],
      });
    };

    const res = await generateVariantsForRound({
      cfg,
      round: 1,
      runTag: "repairtest",
      ledgerText: "(vacío)",
      top2Contexts: [],
      allRanked: [],
      decision: { shape, mode: "rewrite", topTexts: "### Top-1: `prod`" },
      devDatasetPaths: [devPath],
      knownHashes: collectKnownVariantHashes("d0", [], variantsRoot),
      variantsRoot,
      callLlm: mockCaller,
    });

    assert.equal(calls, 2);
    assert.match(repairs[0], /la pregunta no existe/, "la reparación le devuelve el error exacto");
    assert.equal(res.validVariants.length, 2);
    assert.equal(res.validVariants[0].name, "auto_d0_repairtest_r1_a");
    assert.equal(res.validVariants[1].name, "auto_d0_repairtest_r1_b");
  });

  it("exige el contexto de textos para las etapas de decisión", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("needctx");
    await assert.rejects(
      () =>
        generateVariantsForRound({
          cfg: parseAutoConfig(["--stage=d0", "--max-loops=1", "--target=0.90", "--optimizer-model=mock-opt", "--client=mock"]),
          round: 1,
          runTag: "needctx",
          ledgerText: "(vacío)",
          top2Contexts: [],
          allRanked: [],
              devDatasetPaths: [resolve("eval/auto/fixtures/datasets/d0_variedad.jsonl")],
          knownHashes: new Set(),
          variantsRoot,
          callLlm: async () => "{}",
        }),
      /requiere el contexto de textos/,
    );
  });

  it("etapas generativas: el modelo escribe solo el texto SYSTEM, el código arma el archivo y rechaza lo que no cambia nada", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("systext");
    const devPath = resolve("eval/datasets/pending/pending_v1.jsonl");
    const cfg = parseAutoConfig(["--stage=pending", "--max-loops=1", "--target=0.90", "--optimizer-model=mock-opt", "--client=mock"]);
    const current = currentSystemText("PENDING_VIEW");
    const inject = 'texto con ``` comillas " y ${no_se_evalua}';
    const caller: OptimizerLlmCaller = async () =>
      JSON.stringify({
        analysis: "Prueba",
        variants: [
          { suffix: "a", hypothesis: "Igual al vigente", system: current },
          { suffix: "b", hypothesis: "Distinto", system: `${current}\nExtra: ${inject}` },
        ],
      });
    const res = await generateVariantsForRound({
      cfg,
      round: 1,
      runTag: "systext",
      ledgerText: "(vacío)",
      top2Contexts: [],
      allRanked: [],
      generative: { topTexts: JSON.stringify(current), current, mode: "rewrite", failures: "(sin fallos)" },
      devDatasetPaths: [devPath],
      knownHashes: collectKnownVariantHashes("pending", [], variantsRoot),
      variantsRoot,
      callLlm: caller,
    });
    assert.equal(res.validVariants.length, 1, "la igual al vigente se rechaza y la distinta se acepta");
    assert.ok(res.validVariants[0].code.includes(JSON.stringify(`${current}\nExtra: ${inject}`)), "el texto va incrustado como cadena");
    assert.ok(res.rejectedNotes.some((n) => /igual al texto vigente/.test(n)));
    assert.equal(systemFromRaw("", current).error !== undefined, true);
    assert.match(systemFromRaw("Hacé una lista.", current, ["\"pending\""]).error ?? "", /conservar el formato/);
    assert.equal(systemFromRaw(`${current} "pending"`, current, ["\"pending\""]).error, undefined);
    assert.equal(systemFromRaw("x".repeat(7000), current).error !== undefined, true);
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

  it("termina con exit 0 cuando variante != prod alcanza --target, registra el historial y archiva perdedora", async () => {
    const { ledgerPath, resultsRoot, variantsRoot } = setupTempAutoDir("route", "hit");
    const cfg: AutoConfig = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.80",
      "--optimizer-model=mock-opt",
      `--ledger=${ledgerPath}`,
      "--dataset=route_16_cases",
      "--seed-top=prod",
      "--client=mock",
      "--concurrency=2",
    ]);


    const mockOptimizer: OptimizerLlmCaller = async ({ schemaName }) => {
      if (schemaName === "optimizer_variants") {
        return JSON.stringify({
          analysis: "Enfocar criterios por ruta",
          variants: [
            { suffix: "a", hypothesis: "Ganadora A", instructions: { route: "MOCK_WIN_MARKER: Prioritize the exact matching route." } },
            { suffix: "b", hypothesis: "Perdedora B", instructions: { route: "MOCK_LOSE_MARKER: Broad route check." } },
          ],
        });
      }
      throw new Error(`esquema de optimizador inesperado: ${schemaName}`);
    };

    const smartMakeClients = (c: AutoConfig) => ({
      genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
      decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_prepared, req) => {
        const inst = req.questions.route?.instructions ?? "";
        if (inst.includes("MOCK_WIN_MARKER")) {
          const isWeb = /internet|noticia|python|cotización/i.test(req.state);
          const pick = isWeb ? "web" : "files_read";
          return JSON.stringify({ answers: { route: { choice: pick, probabilities: { [pick]: 0.9 } } } });
        }
        if (inst.includes("MOCK_LOSE_MARKER")) {
          return JSON.stringify({ answers: { route: { choice: "web", probabilities: { web: 0.9 } } } });
        }
        return JSON.stringify({ answers: { route: { choice: "files_read", probabilities: { files_read: 0.9 } } } });
      }),
    });
    cfg.target = 0.40;

    const code = await runAutoLoop(cfg, {
      callOptimizer: mockOptimizer,
      makeClients: smartMakeClients,
      resultsRoot,
      variantsRoot,
      silent: true,
    });

    assert.equal(code, 0);
    const entries = readLedger(ledgerPath);
    assert.ok(entries.some((e) => e.summary === "Ganadora A" && e.status === "top2" && typeof e.score === "number"), "el ledger registra la ganadora con su nota medida");
    assert.ok(entries.some((e) => e.summary === "Perdedora B" && e.status === "perdio"), "y la perdedora");
    assert.equal(existsSync(resolve(autoStatePath("route", variantsRoot))), true);

    // La que superó a prod sale de _auto/ hacia _ganadoras/<etapa>/ y la perdedora va a descartadas/.
    const winnerName = entries.find((e) => e.summary === "Ganadora A")!.variant;
    const loserName = entries.find((e) => e.summary === "Perdedora B")!.variant;
    assert.equal(existsSync(join(winnersStageDir("route", variantsRoot), `${winnerName}.ts`)), true, "la ganadora queda en _ganadoras/route/");
    assert.equal(existsSync(join(autoStageDir("route", variantsRoot), `${winnerName}.ts`)), false, "y ya no está en _auto/route/");
    assert.equal(existsSync(join(autoStageDir("route", variantsRoot), "descartadas", `${loserName}.ts`)), true);
  });

  it("con --holdout: sobreajuste en holdout queda en el historial (sin cifras) y continúa hasta --max-loops (exit 1)", async () => {
    const { ledgerPath, resultsRoot, variantsRoot } = setupTempAutoDir("route", "overfit");
    const cfg: AutoConfig = parseAutoConfig([
      "--stage=route",
      "--max-loops=1",
      "--target=0.35",
      "--optimizer-model=mock-opt",
      `--ledger=${ledgerPath}`,
      "--dataset=route_16_cases",
      "--holdout=route_gemai",
      "--seed-top=prod",
      "--client=mock",
      "--concurrency=2",
    ]);


    const mockOptimizer: OptimizerLlmCaller = async ({ schemaName }) => {
      if (schemaName === "optimizer_variants") {
        return JSON.stringify({
          analysis: "Sobreajuste simulado",
          variants: [
            { suffix: "a", hypothesis: "Overfit A", instructions: { route: "MOCK_DEV_ONLY_WIN" } },
            { suffix: "b", hypothesis: "Alt B", instructions: { route: "MOCK_ALT" } },
          ],
        });
      }
      throw new Error(`esquema de optimizador inesperado: ${schemaName}`);
    };

    // En route_16_cases acierta mucho; en route_gemai (o en cualquier otro) responde una ruta minoritaria para simular caída < target
    const makeClients = (c: AutoConfig) => ({
      genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
      decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_prepared, req) => {
        const inst = req.questions.route?.instructions ?? "";
        if (inst.includes("MOCK_DEV_ONLY_WIN")) {
          // Acierta >50% en route_16_cases (web+files+terminal keywords), pero falla cuando aparece "gem" o en holdout usando heuristic de route_gemai
          const looksLike16 = /package\.json|README|notepad|desktop|calc|downloads/i.test(req.state);
          const pick = looksLike16 ? (/notepad|calc|cmd|git|node/i.test(req.state) ? "terminal" : /http|search|version/i.test(req.state) ? "web" : "files_read") : "web";
          return JSON.stringify({ answers: { route: { choice: pick, probabilities: { [pick]: 0.9 } } } });
        }
        return JSON.stringify({ answers: { route: { choice: "web", probabilities: { web: 0.9 } } } });
      }),
    });

    const code = await runAutoLoop(cfg, {
      callOptimizer: mockOptimizer,
      makeClients,
      resultsRoot,
      variantsRoot,
      silent: true,
    });

    assert.equal(code, 1);
    const failed = readLedger(ledgerPath).filter((e) => e.status === "fallo_holdout");
    assert.ok(failed.length >= 1, "el historial anota que la variante falló el holdout");
    assert.ok(failed.every((e) => !/holdout/i.test(e.summary)), "el resumen no mezcla datos del holdout");
  });

  it("aborta con exit 2 sin escribir historial ni auto_state.json si falla transporte del optimizador", async () => {
    const { ledgerPath, resultsRoot, variantsRoot } = setupTempAutoDir("route", "infra");
    const cfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.80",
      "--optimizer-model=mock-opt",
      `--ledger=${ledgerPath}`,
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
      variantsRoot,
      silent: true,
    });

    assert.equal(code, 2);
    assert.equal(existsSync(ledgerPath), false);
    assert.equal(existsSync(resolve(autoStatePath("route", variantsRoot))), false);
    // EV-004: con --seed-top y sin caché se corre una Vuelta 0 real (no se inventan métricas 0/0 para el optimizador).
    assert.ok(existsSync(join(resultsRoot, "r0", "run.json")), "debe existir la corrida de la Vuelta 0 dentro de la sesión");
    const session = JSON.parse(readFileSync(join(resultsRoot, "session.json"), "utf8")) as { status: string; exitCode: number; stage: string; runs: string[] };
    assert.equal(session.exitCode, 2);
    assert.equal(session.status, "error");
    assert.equal(session.stage, "route");
    assert.ok(session.runs.includes("r0"));
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
      output += `${args.map(String).join(" ")}\n`;
    };
    console.error = (...args: unknown[]) => {
      output += `${args.map(String).join(" ")}\n`;
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

  it("evita re-evaluar holdout sobre la misma variante y registra vueltas sin válidas", async () => {
    // 1) Vuelta sin variantes válidas registra progreso y una entrada en el historial
    const { ledgerPath: invLedger, resultsRoot: invRoot, variantsRoot: invVariants } = setupTempAutoDir("route", "invalidround");
    const invCfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=1",
      "--target=0.95",
      "--optimizer-model=mock-opt",
      `--ledger=${invLedger}`,
      "--dataset=route_16_cases",
      "--seed-top=prod",
      "--client=mock",
    ]);
    const invCode = await runAutoLoop(invCfg, {
      callOptimizer: async () =>
        JSON.stringify({
          analysis: "Solo inválidas",
          variants: [{ suffix: "a", hypothesis: "Pregunta inexistente", instructions: { no_existe: "x" } }],
        }),
      resultsRoot: invRoot,
      variantsRoot: invVariants,
      silent: true,
    });
    assert.equal(invCode, 1);
    assert.ok(readLedger(invLedger).some((e) => e.status === "invalida"), "queda anotada la vuelta sin variantes válidas");

    // 2) Holdout fallido en R1 no se re-evalúa en R2 sobre la misma variante
    const { ledgerPath: hoLedger, resultsRoot: hoRoot, variantsRoot: hoVariants } = setupTempAutoDir("route", "holdoutonce");
    const hoCfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=2",
      "--target=0.50",
      "--optimizer-model=mock-opt",
      `--ledger=${hoLedger}`,
      "--dataset=route_16_cases",
      "--holdout=route_gemai",
      "--seed-top=prod",
      "--client=mock",
      "--concurrency=2",
    ]);
    let holdoutEvalCalls = 0;
    let roundOpt = 0;
    const hoOpt: OptimizerLlmCaller = async ({ schemaName }) => {
      if (schemaName === "optimizer_variants") {
        roundOpt++;
        const tag = roundOpt === 1 ? "MOCK_DEV_ONLY_WIN_R1" : `MOCK_ALT_R${roundOpt}`;
        return JSON.stringify({
          analysis: `Round ${roundOpt}`,
          variants: [
            { suffix: "a", hypothesis: `Hyp A ${roundOpt}`, instructions: { route: tag } },
            { suffix: "b", hypothesis: `Hyp B ${roundOpt}`, instructions: { route: `MOCK_LOSE_B_R${roundOpt}` } },
          ],
        });
      }
      throw new Error(`esquema de optimizador inesperado: ${schemaName}`);
    };
    const isHoldoutGemRequest = (state: string): boolean =>
      /docker-compose|build:ci|rotados|Stripe|origin\/main|nginx|monorepo|zustand|RAM|\.gitignore|\.spec\.tsx|OpenSSL|prisma|localhost:8080|\.whl|changelog/i.test(
        state,
      );
    const hoMakeClients = (c: AutoConfig) => ({
      genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
      decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_prepared, req) => {
        const inst = req.questions.route?.instructions ?? "";
        const inHoldout = isHoldoutGemRequest(req.state);
        if (inst.includes("MOCK_DEV_ONLY_WIN_R1") && inHoldout) {
          holdoutEvalCalls++;
        }
        if (inst.includes("MOCK_DEV_ONLY_WIN_R1")) {
          if (inHoldout) {
            return JSON.stringify({ answers: { route: { choice: "web", probabilities: { web: 0.9 } } } });
          }
          const pick = /Buenos Aires|inteligencia artificial|asyncio|dólar oficial/i.test(req.state)
            ? "web"
            : /calculadora|npm run build|puertos TCP|PID 1420/i.test(req.state)
              ? "terminal"
              : /package\.json|escritorio|resumen\.txt|config\.default/i.test(req.state)
                ? "files_read"
                : "web";
          return JSON.stringify({ answers: { route: { choice: pick, probabilities: { [pick]: 0.9 } } } });
        }
        return JSON.stringify({ answers: { route: { choice: "web", probabilities: { web: 0.9 } } } });
      }),
    });

    const hoCode = await runAutoLoop(hoCfg, {
      callOptimizer: hoOpt,
      makeClients: hoMakeClients,
      resultsRoot: hoRoot,
      variantsRoot: hoVariants,
      silent: true,
    });
    assert.equal(hoCode, 1);
    const holdoutFailures = readLedger(hoLedger).filter((e) => e.status === "fallo_holdout");
    assert.equal(holdoutFailures.length, 1, "No debe duplicar el fallo de holdout para la misma variante");
    assert.equal(holdoutEvalCalls, 16, "Solo debe evaluar los 16 casos de holdout una única vez en R1");
  });

  it("carga variantes de forma efímera sin caché ESM y aísla corridas en Worker cuando no hay makeClients", async () => {
    // 1) loadVariantSpecEphemeral tiene paridad de hash con loadVariantSpec y recarga cambios sin quedar fijada en ESM ModuleMap
    const variantsRoot = setupIsolatedVariantsRoot("ephemeral");
    const prodEphemeral = loadVariantSpecEphemeral("prod", undefined, variantsRoot);
    const prodEsm = await loadVariantSpec("prod", undefined, variantsRoot);
    assert.equal(prodEphemeral.variant.name, "prod");
    assert.equal(prodEphemeral.hash, prodEsm.hash);

    const dynDir = autoStageDir("route", variantsRoot);
    mkdirSync(dynDir, { recursive: true });
    const dynName = "auto_route_ephemeral_tmp";
    const dynPath = join(dynDir, `${dynName}.ts`);
    const tpl1 = decisionVariantCode("route", dynName, "EPHEMERAL_V1");
    writeFileSync(dynPath, tpl1, "utf8");
    const sampleRouteInput = {
      routes: ["files_read", "terminal", "web"],
      request: "hola",
      step: { instruction: "hola" },
      done: [],
      attempts: [],
      userInput: [],
      env: [],
    } as never;
    const loaded1 = loadVariantSpecEphemeral(dynName, dynPath, variantsRoot);
    const fn1 = loaded1.variant.prompts?.DECISION_PROMPTS?.buildRouteChoice;
    assert.ok(typeof fn1 === "function");
    assert.match(fn1(sampleRouteInput).questions.route.instructions, /EPHEMERAL_V1/);

    const tpl2 = decisionVariantCode("route", dynName, "EPHEMERAL_V2");
    writeFileSync(dynPath, tpl2, "utf8");
    const loaded2 = loadVariantSpecEphemeral(dynName, dynPath, variantsRoot);
    assert.notEqual(loaded2.hash, loaded1.hash);
    const fn2 = loaded2.variant.prompts?.DECISION_PROMPTS?.buildRouteChoice;
    assert.ok(typeof fn2 === "function");
    assert.match(fn2(sampleRouteInput).questions.route.instructions, /EPHEMERAL_V2/);

    // 2) runAutoLoop sin deps.makeClients ejecuta Vuelta 0 y Vuelta 1 dentro de Workers efímeros
    const { ledgerPath: wLedger, resultsRoot: wRoot, variantsRoot: wVariants } = setupTempAutoDir("route", "worker");
    const wCfg = parseAutoConfig([
      "--stage=route",
      "--max-loops=1",
      "--target=0.99",
      "--optimizer-model=mock-opt",
      `--ledger=${wLedger}`,
      "--dataset=route_16_cases",
      "--client=mock",
      "--concurrency=2",
    ]);
    let wCalls = 0;
    const wCode = await runAutoLoop(wCfg, {
      callOptimizer: async ({ schemaName }) => {
        if (schemaName === "optimizer_variants") {
          wCalls++;
          return JSON.stringify({
            analysis: "Worker test",
            variants: [
              { suffix: "a", hypothesis: "Worker A", instructions: { route: "WORKER_A" } },
              { suffix: "b", hypothesis: "Worker B", instructions: { route: "WORKER_B" } },
            ],
          });
        }
        throw new Error(`esquema de optimizador inesperado: ${schemaName}`);
      },
      resultsRoot: wRoot,
      variantsRoot: wVariants,
      silent: true,
    });
    assert.equal(wCode, 1);
    assert.equal(wCalls, 1);
    assert.ok(existsSync(autoStatePath("route", wVariants)));
    const state = JSON.parse(readFileSync(autoStatePath("route", wVariants), "utf8")) as { completedRounds: number; top2: string[] };
    assert.equal(state.completedRounds, 1);
    assert.equal(state.top2.length, 2);
    assert.ok(state.top2.some((v) => v.includes("_r1_")));
  });
});

describe("eval/auto ledger (historial de ideas probadas)", () => {
  it("clipSummary deja una sola línea y recorta a 120 caracteres", () => {
    assert.equal(clipSummary("a\n  b\tc"), "a b c");
    assert.equal(clipSummary("x".repeat(500)).length, 120);
    assert.equal(clipSummary("   "), "(sin resumen)");
  });

  it("guarda todo en disco pero al prompt solo van las últimas entradas, con la cantidad omitida", () => {
    const dir = trackTemp(mkdtempSync(join(tmpdir(), "jarvis-ledger-")));
    const file = join(dir, "sub", "ledger.jsonl");
    const entries = Array.from({ length: LEDGER_PROMPT_ENTRIES + 5 }, (_, i) => ({
      round: i + 1,
      variant: `v${i + 1}`,
      summary: `idea ${i + 1}`,
      score: 0.5,
      deltaVsProd: 0.05,
      improvements: 2,
      regressions: 1,
      status: "perdio" as const,
    }));
    appendLedger(file, entries);
    assert.equal(readLedger(file).length, entries.length);
    const text = formatLedgerForPrompt(file);
    assert.match(text, /5 entrada\(s\) anterior\(es\) no mostradas/);
    assert.ok(text.includes("idea 15") && !text.includes("idea 5`") && !text.includes("«idea 5»"));
    assert.equal(text.split("\n").length, LEDGER_PROMPT_ENTRIES + 1);
  });

  it("tolera líneas corruptas y un archivo inexistente", () => {
    const dir = trackTemp(mkdtempSync(join(tmpdir(), "jarvis-ledger-")));
    const file = join(dir, "ledger.jsonl");
    assert.match(formatLedgerForPrompt(file), /primera iteración/);
    appendLedger(file, [{ round: 1, variant: "a", summary: "ok", status: "top2" }]);
    writeFileSync(file, `${readFileSync(file, "utf8")}{no es json\n`, "utf8");
    assert.equal(readLedger(file).length, 1);
  });
});

describe("eval/auto variantes de decisión armadas por código (solo textos)", () => {
  const routeShape = () => shapeFromRequests(collectDecisionRequests("route", [resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl")]));

  it("conoce las preguntas y opciones reales de la etapa a partir de los casos", () => {
    const shape = routeShape();
    assert.deepEqual(shape.questions.map((q) => q.key), ["route"]);
    assert.ok(shape.questions[0].options.includes("files_read") && shape.questions[0].options.includes("web"));
    const texts = formatCurrentTexts(collectDecisionRequests("route", [resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl")]));
    assert.match(texts, /^instructions.route: "/m);
    assert.match(texts, /^criteria.route.web: "/m);
  });

  it("patchFromRaw rechaza preguntas u opciones inexistentes, textos vacíos o largos y variantes que no cambian nada", () => {
    const shape = routeShape();
    assert.match(patchFromRaw({ instructions: { pregunta: "x" } }, shape).errors.join(" "), /la pregunta no existe/);
    assert.match(patchFromRaw({ criteria: { route: { nube: "x" } } }, shape).errors.join(" "), /la opción no existe/);
    assert.match(patchFromRaw({ instructions: { route: "  " } }, shape).errors.join(" "), /texto no vacío/);
    assert.match(patchFromRaw({ instructions: { route: "x".repeat(5000) } }, shape).errors.join(" "), /máximo/);
    assert.match(patchFromRaw({}, shape).errors.join(" "), /no cambia nada/);
    const ok = patchFromRaw({ instructions: { route: " Pick one. " }, state_note: "Be specific." }, shape);
    assert.deepEqual(ok.patch, { instructions: { route: "Pick one." }, stateNote: "Be specific." });
  });

  it("el archivo generado pasa la validación, aplica solo los textos, conserva la marca de intento fallido y no ejecuta texto del modelo", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("patchbuild");
    const hostile = "Use `terminal` ${globalThis.hacked = true} */ process.exit(1) //";
    const { patch, errors } = patchFromRaw(
      { instructions: { route: hostile }, criteria: { route: { web: "Online lookups only." } }, state_note: "Be specific." },
      routeShape(),
    );
    assert.deepEqual(errors, []);
    const code = buildPatchedVariantSource({ promptKey: "buildRouteChoice", variantName: "auto_route_patchtest_r1_a", patch: patch! });
    const res = await validateAndWriteVariant({
      stage: "route",
      variantName: "auto_route_patchtest_r1_a",
      rawCode: code,
      devDatasetPaths: [resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl")],
      knownHashes: new Set<string>(),
      variantsRoot,
    });
    assert.equal(res.ok, true, res.ok ? "" : res.error);
    if (!res.ok) return;
    const build = res.variant.prompts?.DECISION_PROMPTS?.buildRouteChoice;
    assert.ok(typeof build === "function");
    const input = {
      routes: ["files_read", "terminal", "web"],
      request: "hola",
      step: { instruction: "hola" },
      done: [],
      attempts: [{ stepId: "s1", route: "web", tool: "x", status: "tool_error" }],
      userInput: [],
      env: [],
    } as never;
    const out = build(input);
    assert.equal(out.questions.route.instructions, hostile, "el texto queda literal, sin interpretarse");
    assert.equal((globalThis as Record<string, unknown>).hacked, undefined);
    assert.ok(out.state.startsWith("Be specific.\n"));
    const criteria = (out.questions.route as { criteria: Record<string, string> }).criteria;
    assert.match(criteria.web, /^Online lookups only./);
    assert.match(criteria.terminal, /Run commands and programs/, "las opciones sin cambio quedan como en producción");
  });
});

describe("eval/auto: umbral de holdout relativo a prod y modo improve", () => {
  const baseArgs = (extra: string[]) => ["--stage=route", "--max-loops=1", "--optimizer-model=mock-opt", "--client=mock", ...extra];

  it("valida las opciones --holdout-margin, --mode y --base", () => {
    assert.throws(() => parseAutoConfig(baseArgs(["--target=0.9", "--holdout-margin=0.1"])), /requiere --holdout/);
    assert.throws(() => parseAutoConfig(baseArgs(["--target=0.9", "--holdout=route_gemai", "--holdout-margin=2"])), /\(0, 1\]/);
    assert.throws(() => parseAutoConfig(baseArgs(["--target=0.9", "--mode=otro"])), /rewrite' o 'improve/);
    assert.throws(() => parseAutoConfig(baseArgs(["--target=0.9", "--base=prod"])), /solo vale con --mode=improve/);
    assert.throws(() => parseAutoConfig(baseArgs(["--target=0.9", "--mode=improve", "--base=prod", "--seed-top=prod"])), /no se combinan/);
    const ok = parseAutoConfig(baseArgs(["--target=0.9", "--mode=improve", "--base=route_v1", "--holdout=route_gemai", "--holdout-margin=0.1"]));
    assert.equal(ok.mode, "improve");
    assert.deepEqual(ok.seedTop, ["route_v1"]);
    assert.equal(ok.holdoutMargin, 0.1);
    assert.equal(parseAutoConfig(baseArgs(["--target=0.9"])).mode, "rewrite");
  });

  it("con --holdout-margin se confirma al superar a prod por el margen aunque no se llegue a --target", async () => {
    const run = async (margin: string): Promise<{ code: number; statuses: string[] }> => {
      const tag = `margin${margin.replace(".", "")}`;
      const { ledgerPath, resultsRoot, variantsRoot } = setupTempAutoDir("route", tag);
      const cfg = parseAutoConfig(baseArgs(["--target=0.01", `--ledger=${ledgerPath}`, "--dataset=route_16_cases", "--holdout=route_gemai", `--holdout-margin=${margin}`, "--concurrency=2"]));
      const pick = (req: { questions: Record<string, { criteria?: Record<string, string> }> }, wanted: string): string => {
        const options = Object.keys(req.questions.route?.criteria ?? {});
        return options.includes(wanted) ? wanted : options[0];
      };
      const makeClients = (c: AutoConfig) => ({
        genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
        decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }, (_p, req) => {
          const candidate = (req.questions.route?.instructions ?? "").includes("MOCK_CANDIDATE");
          const choice = pick(req as never, candidate ? "files_read" : "files_write");
          return JSON.stringify({ answers: { route: { choice, probabilities: { [choice]: 0.9 } } } });
        }),
      });
      const code = await runAutoLoop(cfg, {
        callOptimizer: async ({ schemaName }) =>
          schemaName === "optimizer_variants"
            ? JSON.stringify({ analysis: "x", variants: [{ suffix: "a", hypothesis: "Candidata", instructions: { route: "MOCK_CANDIDATE pick one." } }, { suffix: "b", hypothesis: "Otra", instructions: { route: "MOCK_OTHER pick one." } }] })
            : (() => { throw new Error("esquema de optimizador inesperado"); })(),
        makeClients,
        resultsRoot,
        variantsRoot,
        silent: true,
      });
      return { code, statuses: readLedger(ledgerPath).map((e) => e.status) };
    };
    const easy = await run("0.01");
    assert.equal(easy.code, 0, "supera a prod por >= 1 punto: se confirma");
    const hard = await run("0.9");
    assert.equal(hard.code, 1, "no supera a prod por 90 puntos: no se confirma");
    assert.ok(hard.statuses.includes("fallo_holdout"));
  });

  it("el modo improve muestra solo el prompt base, aplica los cambios sobre sus textos y el modo rewrite no", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("improvemode");
    const devPath = resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl");
    const requests = collectDecisionRequests("route", [devPath]);
    const shape = shapeFromRequests(requests);
    const base = patchFromRequests(requests);
    assert.ok(Object.keys(base.criteria?.route ?? {}).length >= 6, "el base incluye todas las opciones, no solo las de un caso");
    assert.deepEqual(mergePatch(base, { instructions: { route: "Nueva." } }).instructions, { route: "Nueva." });
    assert.equal(mergePatch({ stateNote: "base" }, { instructions: { route: "x" } }).stateNote, "base");

    const seen: string[] = [];
    const caller: OptimizerLlmCaller = async ({ messages }) => {
      seen.push(messages.map((m) => m.content).join("\n"));
      return JSON.stringify({
        analysis: "x",
        variants: [
          { suffix: "a", hypothesis: "A", instructions: { route: "Pick the best route A." } },
          { suffix: "b", hypothesis: "B", instructions: { route: "Pick the best route B." } },
        ],
      });
    };
    const make = (mode: "improve" | "rewrite") =>
      generateVariantsForRound({
        cfg: parseAutoConfig(baseArgs(["--target=0.9", `--mode=${mode}`])),
        round: 1,
        runTag: `mode${mode}`,
        ledgerText: "(vacío)",
        top2Contexts: [],
        allRanked: [],
          decision: { shape, mode, ...(mode === "improve" ? { base } : {}), topTexts: "### Base: `prod`\ninstructions.route: \"x\"" },
        devDatasetPaths: [devPath],
        knownHashes: collectKnownVariantHashes("route", [], variantsRoot),
        variantsRoot,
        callLlm: caller,
      });
    const improved = await make("improve");
    const rewritten = await make("rewrite");
    assert.equal(improved.validVariants.length, 2);
    assert.match(seen[0], /Te damos un prompt base/);
    assert.match(seen[0], /Prompt base \(el que tenés que mejorar\)/);
    assert.match(seen[1], /Proponé prompts nuevos/);
    assert.doesNotMatch(seen[1], /Te damos un prompt base/);
    // improve conserva los textos base de las opciones que el modelo no tocó; rewrite las deja a cargo de producción.
    const unchangedBaseText = base.criteria!.route.web;
    assert.ok(improved.validVariants[0].code.includes(JSON.stringify(unchangedBaseText).slice(1, -1)));
    assert.ok(!rewritten.validVariants[0].code.includes(JSON.stringify(unchangedBaseText).slice(1, -1)));
    for (const text of seen) assert.doesNotMatch(text, /Expected:|Predicted:|expectedRoute/, "no se le muestran casos ni respuestas esperadas");
  });
});

describe("eval/auto: resumen de confusiones para el optimizador (solo etiquetas)", () => {
  const rec = (expectedLabel: string | null, predictedLabel: string | null, passed: boolean, extra: Record<string, unknown> = {}) =>
    ({ bucket: "canonical", passed, expectedLabel, predictedLabel, metrics: { client_call_ok: true }, ...extra }) as never;

  it("cuenta errores por etiqueta de la variante enfocada, solo en desarrollo y sin casos ni textos", () => {
    const cells = [
      {
        variantSpec: "prod",
        datasetName: "route_dev",
        records: [
          rec("system", "terminal", false),
          rec("system", "terminal", false),
          rec("system", "system", true),
          rec("web", "web", true),
          rec("files_read", null, false), // sin respuesta válida
          rec("web", "web", false), // falló por otro motivo: no es una confusión de etiqueta
          rec("web", "terminal", false, { bucket: "raw" }), // raw: no cuenta
          rec("web", "terminal", false, { metrics: { client_call_ok: false } }), // falla de cliente: no cuenta
          rec(null, null, false), // sin etiqueta esperada: no cuenta
        ],
      },
      { variantSpec: "prod", datasetName: "route_holdout", records: [rec("web", "terminal", false), rec("web", "terminal", false), rec("web", "terminal", false)] },
      { variantSpec: "otra", datasetName: "route_dev", records: [rec("system", "web", false)] },
    ] as never;
    const confusions = extractConfusions({ focusVariant: "prod", cells, devDatasetNames: new Set(["route_dev"]) });
    assert.deepEqual(confusions, [
      { expected: "system", predicted: "terminal", count: 2, expectedTotal: 3 },
      { expected: "files_read", predicted: "(sin respuesta válida)", count: 1, expectedTotal: 1 },
    ]);
    const text = formatConfusions(confusions);
    assert.match(text, /Cuando lo correcto era `system`, eligió `terminal`: 2 de 3 casos\./);
    assert.match(formatConfusions([]), /no tiene errores de etiqueta/);
  });

  it("el prompt de decisión incluye el resumen de confusiones y ningún caso ni respuesta esperada", async () => {
    const variantsRoot = setupIsolatedVariantsRoot("confusions");
    const devPath = resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl");
    const requests = collectDecisionRequests("route", [devPath]);
    let prompt = "";
    await generateVariantsForRound({
      cfg: parseAutoConfig(["--stage=route", "--max-loops=1", "--target=0.9", "--optimizer-model=mock-opt", "--client=mock"]),
      round: 1,
      runTag: "conf",
      ledgerText: "(vacío)",
      top2Contexts: [],
      allRanked: [],
      decision: {
        shape: shapeFromRequests(requests),
        mode: "rewrite",
        topTexts: "### Top-1: `prod`",
        confusions: formatConfusions([{ expected: "system", predicted: "terminal", count: 3, expectedTotal: 7 }]),
      },
      devDatasetPaths: [devPath],
      knownHashes: collectKnownVariantHashes("route", [], variantsRoot),
      variantsRoot,
      callLlm: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({ analysis: "x", variants: [{ suffix: "a", hypothesis: "A", instructions: { route: "Pick A." } }, { suffix: "b", hypothesis: "B", instructions: { route: "Pick B." } }] });
      },
    });
    assert.match(prompt, /## Errores del Top-1 en desarrollo \(solo etiquetas; sin casos ni textos\)/);
    assert.match(prompt, /Cuando lo correcto era `system`, eligió `terminal`: 3 de 7 casos\./);
    assert.doesNotMatch(prompt, /Expected:|Predicted:|expectedRoute|route-v1-|Request:/);
  });
});

describe("eval/auto: dónde se buscan resultados reutilizables", () => {
  const cfgFor = (extra: string[] = []) => parseAutoConfig(["--stage=route", "--max-loops=1", "--target=0.9", "--optimizer-model=mock-opt", ...extra]);

  it("busca en las corridas manuales del modelo, en las sesiones --auto anteriores de la etapa y en la estructura anterior; las sesiones más recientes primero", () => {
    const root = trackTemp(mkdtempSync(join(tmpdir(), "jarvis-results-")));
    mkdirSync(join(root, "auto", "route", "2026-11-21_100000", "r0"), { recursive: true });
    mkdirSync(join(root, "auto", "route", "2026-11-21_120000", "r0"), { recursive: true });
    mkdirSync(join(root, "auto", "args_review", "2026-11-21_110000"), { recursive: true });
    writeFileSync(join(root, "auto", "route", "session.json"), "{}"); // un archivo suelto no es una sesión

    // Etapa de decisión con otro modelo generativo: se mira la carpeta de ambos modelos.
    const dirs = reusableResultsDirs(cfgFor(["--decision-model=dec-x", "--generative-model=gen-y"]), undefined, root);
    assert.deepEqual(dirs, [
      resolve(root, "evals", "dec-x"),
      resolve(root, "evals", "gen-y"),
      resolve(root, "auto", "route", "2026-11-21_120000"),
      resolve(root, "auto", "route", "2026-11-21_100000"),
      resolve(root, "dec-x"),
      resolve(root, "gen-y"),
    ]);
    assert.ok(!dirs.some((d) => d.includes("args_review")), "no mezcla sesiones de otra etapa");
  });

  it("con resultsRoot solo mira esa carpeta, y los clientes mock y oracle usan sin-modelo/", () => {
    const root = "raiz-falsa";
    assert.deepEqual(reusableResultsDirs(cfgFor(), "una/carpeta", root), [resolve("una/carpeta")]);
    assert.deepEqual(reusableResultsDirs(cfgFor(["--client=mock"]), undefined, root), [resolve(root, "sin-modelo", "mock"), resolve(root, "_mock")]);
  });
});

describe("eval/auto: bucle completo en las 14 etapas (cliente y optimizador simulados)", () => {
  for (const stage of allStageNames()) {
    it(`${stage}: genera variantes válidas, las evalúa y registra el historial sin errores`, async () => {
      const { ledgerPath, resultsRoot, variantsRoot } = setupTempAutoDir(stage, `all-${stage}`);
      // El humo trae un caso por etapa: el bucle se prueba sin depender de los datasets de trabajo, que se rehacen aparte.
      const datasetPath = resolve("eval/datasets/smoke.jsonl");
      const cfg: AutoConfig = parseAutoConfig([
        `--stage=${stage}`,
        "--max-loops=1",
        "--target=0.99",
        "--optimizer-model=mock-opt",
        `--ledger=${ledgerPath}`,
        "--dataset=smoke",
        "--seed-top=prod",
        "--client=mock",
        "--concurrency=2",
      ]);

      let variantsAsked: unknown[];
      if (isDecisionStage(stage)) {
        const shape = shapeFromRequests(collectDecisionRequests(stage, [datasetPath]));
        const firstKey = shape.questions[0].key;
        const mark = shape.dynamic?.[firstKey] ? ` ${"{{DATA}}"}` : "";
        variantsAsked = ["a", "b"].map((suffix) => ({ suffix, hypothesis: `Prueba ${suffix}`, instructions: { [firstKey]: `Variante ${suffix}: elegí con cuidado la opción correcta.${mark}` } }));
      } else {
        const current = currentSystemText(getStageContract(stage).promptKey);
        variantsAsked = ["a", "b"].map((suffix) => ({ suffix, hypothesis: `Prueba ${suffix}`, system: `${current}\nVariante ${suffix}: sé preciso.` }));
      }
      const mockOptimizer: OptimizerLlmCaller = async () => JSON.stringify({ analysis: "Prueba", variants: variantsAsked });

      const code = await runAutoLoop(cfg, {
        callOptimizer: mockOptimizer,
        makeClients: (c: AutoConfig) => ({
          genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
          decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }),
        }),
        resultsRoot,
        variantsRoot,
        silent: true,
      });

      assert.ok(code === 0 || code === 1, `terminó con código ${code}`);
      const entries = readLedger(ledgerPath);
      assert.ok(entries.length >= 1, "el historial registra las variantes probadas");
      assert.ok(entries.every((e) => e.status !== "invalida"), "ninguna variante fue inválida");
    });
  }
});

describe("eval/auto: instrucciones con texto propio de cada caso", () => {
  const devPath = resolve("eval/auto/fixtures/datasets/fragment_judge_min.jsonl");

  it("el texto editable no trae datos de casos: lleva {{DATA}} y agrupa f0, f1… bajo f*", () => {
    const reqs = collectDecisionRequests("fragment_judge", [devPath]);
    const shape = shapeFromRequests(reqs);
    assert.deepEqual(shape.questions.map((q) => q.key), ["f*"]);
    const texts = formatCurrentTexts(reqs);
    assert.match(texts, /\{\{DATA\}\}/);
    assert.doesNotMatch(texts, /etanol|boletín|postgresql/i, "ningún fragmento de caso llega al optimizador");
  });

  it("exige conservar {{DATA}} y la variante generada conserva el fragmento de cada caso", async () => {
    const reqs = collectDecisionRequests("fragment_judge", [devPath]);
    const shape = shapeFromRequests(reqs);
    assert.ok(patchFromRaw({ instructions: { "f*": "Sin marcador." } }, shape).errors.length > 0);
    const { patch } = patchFromRaw({ instructions: { "f*": 'NUEVO\n"""\n{{DATA}}\n"""\nFIN?' } }, shape);
    assert.ok(patch);
    const variantsRoot = setupIsolatedVariantsRoot("dyn");
    const res = await validateAndWriteVariant({
      stage: "fragment_judge",
      variantName: "auto_fragment_judge_dyn_r1_a",
      rawCode: buildPatchedVariantSource({ promptKey: "buildFragmentJudge", variantName: "auto_fragment_judge_dyn_r1_a", patch: patch!, dynamic: shape.dynamic }),
      devDatasetPaths: [devPath],
      knownHashes: new Set(),
      variantsRoot,
    });
    assert.ok(res.ok, res.ok ? "" : res.error);
    const variant = loadVariantSpecEphemeral("auto_fragment_judge_dyn_r1_a", undefined, variantsRoot).variant;
    const patched = collectDecisionRequests("fragment_judge", [devPath], variant);
    assert.match(patched[0].questions.f0.instructions, /^NUEVO\n"""\nEl etanol puro/);
    assert.match(patched[0].questions.f0.instructions, /\n"""\nFIN\?$/);
    assert.notEqual(patched[0].questions.f0.instructions, patched[1].questions.f0.instructions);
  });
});

describe("eval/auto: varias etapas en una corrida", () => {
  it("expande la lista con las etapas de decisión primero, sin repetidas, y entiende all, decision y generative", () => {
    assert.deepEqual(expandStages("pending,d0,route,d0"), ["d0", "route", "pending"]);
    assert.deepEqual(expandStages("generative").every((s) => !isDecisionStage(s)), true);
    const all = expandStages("all");
    assert.equal(all.length, 14);
    assert.equal(all.slice(0, 9).every((s) => isDecisionStage(s)), true, "las 9 de decisión van primero");
    assert.equal(isMultiStageArg("route"), false);
    assert.equal(isMultiStageArg("route,d0"), true);
    assert.equal(isMultiStageArg("all"), true);
    assert.throws(() => expandStages("route,nada"), /etapa 'nada' desconocida/);
  });

  it("rechaza los flags de una sola etapa y deja --holdout solo como --holdout=auto", () => {
    for (const flag of ["--dataset=route_v1", "--seed-top=prod", "--base=prod", "--ledger=x.jsonl"]) {
      assert.throws(() => checkMultiStageFlags(["--stage=route,d0", flag]), /es de una sola etapa/);
    }
    assert.throws(() => checkMultiStageFlags(["--stage=route,d0", "--holdout=route_v1_holdout"]), /solo admite --holdout=auto/);
    assert.doesNotThrow(() => checkMultiStageFlags(["--stage=route,d0", "--holdout=auto"]));
    assert.deepEqual(argvForStage(["--stage=route,d0", "--max-loops=2", "--holdout=auto"], "d0"), ["--stage=d0", "--max-loops=2"]);
  });

  it("holdoutFilesOf solo devuelve los *_holdout*.jsonl de la etapa", () => {
    const dir = trackTemp(mkdtempSync(join(tmpdir(), "jarvis-eval-holdouts-")));
    mkdirSync(join(dir, "route"));
    for (const name of ["route_v1.jsonl", "route_v1_holdout.jsonl", "route_v2-holdout2.jsonl"]) writeFileSync(join(dir, "route", name), "", "utf8");
    const files = holdoutFilesOf("route", dir);
    assert.deepEqual(files.map((f) => basename(f)), ["route_v1_holdout.jsonl", "route_v2-holdout2.jsonl"]);
    assert.deepEqual(holdoutFilesOf("route", "carpeta/que/no/existe"), []);
  });

  it("corre las etapas en serie con decisión primero y sigue con la siguiente aunque una no alcance el objetivo", async () => {
    // Los datasets de trabajo se rehacen aparte: la prueba usa los fixtures que `before()` instala en eval/datasets.
    const multiStageFixtures: Record<string, string> = {
      d0: resolve("eval/auto/fixtures/datasets/d0_variedad.jsonl"),
      route: resolve("eval/auto/fixtures/datasets/route_16_cases.jsonl"),
    };
    const { resultsRoot, variantsRoot } = setupTempAutoDir("d0", "multi");
    const order: string[] = [];
    const mockOptimizer: OptimizerLlmCaller = async ({ messages }) => {
      const stage = /Etapa\n- `(\w+)`/.exec(messages.at(-1)?.content ?? "")?.[1] ?? "";
      const shape = isDecisionStage(stage as StageName) ? shapeFromRequests(collectDecisionRequests(stage as StageName, [multiStageFixtures[stage]])) : undefined;
      const firstKey = shape?.questions[0].key ?? "";
      const text = (suffix: string) => `Variante ${suffix}: elegí con cuidado la opción correcta.${firstKey && shape?.dynamic?.[firstKey] ? " {{DATA}}" : ""}`;
      const variants = isDecisionStage(stage as StageName)
        ? ["a", "b"].map((suffix) => ({ suffix, hypothesis: `Prueba ${suffix}`, instructions: { [firstKey]: text(suffix) } }))
        : ["a", "b"].map((suffix) => ({ suffix, hypothesis: `Prueba ${suffix}`, system: `${currentSystemText(getStageContract(stage as StageName).promptKey)}\nVariante ${suffix}.` }));
      return JSON.stringify({ analysis: "Prueba", variants });
    };

    const code = await runAutoStages(
      ["--stage=pending,d0,route", "--max-loops=1", "--target=0.99", "--optimizer-model=mock-opt", "--client=mock", "--concurrency=2"],
      {
        callOptimizer: mockOptimizer,
        makeClients: (c: AutoConfig) => {
          if (order[order.length - 1] !== c.stage) order.push(c.stage);
          return {
            genClient: createMockGenerativeClient({ url: c.url, model: c.model }),
            decClient: createMockDecisionClient({ url: c.decisionUrl, model: c.decisionModel }),
          };
        },
        resultsRoot,
        variantsRoot,
        silent: true,
      },
    );

    assert.deepEqual(order, ["d0", "route", "pending"], "decisión primero y las tres corrieron");
    assert.equal(code, 1, "ninguna llegó al 99 %: código 1, pero ninguna cortó a las demás");
    for (const stage of ["d0", "route", "pending"]) {
      assert.equal(existsSync(autoStatePath(stage as StageName, variantsRoot)), true, `${stage} guardó su estado`);
    }
  });

  it("combina los códigos de salida y arma la tabla de resumen", () => {
    assert.equal(combineExitCodes([{ stage: "d0", code: 0 }, { stage: "route", code: 0 }]), 0);
    assert.equal(combineExitCodes([{ stage: "d0", code: 0 }, { stage: "route", code: 1 }]), 1);
    assert.equal(combineExitCodes([{ stage: "d0", code: 1 }, { stage: "route", code: 2 }]), 2);
    assert.equal(combineExitCodes([{ stage: "d0", code: "skipped" }, { stage: "route", code: 0 }]), 0);
    assert.equal(combineExitCodes([{ stage: "d0", code: "skipped" }]), 2, "si no corrió ninguna, es error");
    const table = formatStageSummary([{ stage: "d0", code: 0, prodScore: 0.9, best: { variant: "auto_d0_x", score: 1 } }, { stage: "route", code: "skipped" }]);
    assert.match(table, /d0\s+objetivo alcanzado\s+90\.0%\s+100\.0%\s+auto_d0_x/);
    assert.match(table, /route\s+sin datasets/);
  });
});
