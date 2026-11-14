/**
 * Decision 2.0 y alineación del eval con producción:
 * - `DecisionValidationError` adjunta `raw` (`rawInput`, `rawOutput`, `timing`) cuando el modelo responde inválido o truncado,
 *   para que `captureDecision` lo registre en la traza; en desborde (`overflow: true`) no envía ni adjunta `raw`.
 * - `validateAnswer` rechaza tipos de pregunta no soportados (`switch` exhaustivo).
 * - `eval/core/runner.ts` (`runDecision`): 0 reintentos ante respuesta inválida (DN-3.4).
 * - `eval/core/scenario.ts`: `userInput` usa `answer_<stepId>_<n>`, como producción.
 * - `postconditionOf` y `Guard.evaluate`: manejan rutas Windows correctamente en cualquier SO anfitrión.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ConfigManager, type ConfigSource, type JarvisConfig } from "../src/core/config.ts";
import type { ReviewDecisionInput } from "../src/core/contracts.ts";
import { captureDecision, type CaptureSink, type LlmCapture } from "../src/core/engine/capture.ts";
import { postconditionOf } from "../src/core/engine/postcondition.ts";
import { Decision20Engine, validateAnswer } from "../src/core/models/decision.ts";
import { DecisionValidationError } from "../src/core/models/transport.ts";
import { Guard } from "../src/core/policy/guard.ts";
import type { DecisionQuestion } from "../src/core/types.ts";
import { validateCase } from "../eval/core/case.ts";
import { parseConfig } from "../eval/core/config.ts";
import type { DecisionClient } from "../eval/core/client/decision.ts";
import { createMockGenerativeClient } from "../eval/core/client/mock.ts";
import { runDataset } from "../eval/core/runner.ts";
import { materializeScenario } from "../eval/core/scenario.ts";
import { loadVariant } from "../eval/core/variants/load.ts";

function testConfig(overrides: Partial<JarvisConfig> = {}): ConfigSource {
  const cfg: JarvisConfig = {
    ...ConfigManager.getConfig(),
    qwenUrl: "http://127.0.0.1:11434",
    decisionUrl: "http://127.0.0.1:11434",
    decisionModel: "d3:2b",
    decisionTimeoutMs: 5000,
    decisionMaxContext: 4096,
    ...overrides,
  };
  return () => cfg;
}

function withFakeFetch(handler: () => Promise<Response>, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("validateAnswer: choice y noul válidos, inválidos y tipo desconocido rechazado explícitamente", () => {
  const choiceQ: DecisionQuestion = { type: "choice", instructions: "Elegí", criteria: { a: "A", b: "B" } };
  const noulQ: DecisionQuestion = { type: "noul", instructions: "¿Sí?" };

  assert.deepEqual(validateAnswer("q1", choiceQ, { choice: "a", probabilities: { a: 0.9, bad: "x" } }), { choice: "a", probabilities: { a: 0.9 } });
  assert.deepEqual(validateAnswer("q2", noulQ, { noul: 0.75 }), { noul: 0.75 });

  assert.throws(() => validateAnswer("q1", choiceQ, { choice: "c" }), DecisionValidationError);
  assert.throws(() => validateAnswer("q2", noulQ, { noul: 1.5 }), DecisionValidationError);
  assert.throws(() => validateAnswer("q2", noulQ, null), DecisionValidationError);

  const unsupported = { type: "score", instructions: "1-5" } as unknown as DecisionQuestion;
  assert.throws(
    () => validateAnswer("q3", unsupported, { score: 4 }),
    (err: unknown) => err instanceof DecisionValidationError && /tipo de pregunta no soportado/.test(err.message),
  );
});

test("Decision20Engine + captureDecision: adjunta rawInput/rawOutput cuando la salida es inválida o truncada y no en overflow", async () => {
  const engine = new Decision20Engine(testConfig());
  const captured: LlmCapture[] = [];
  const sink: CaptureSink = { llm: (e) => captured.push(e), tool: () => {} };
  const wrapped = captureDecision(engine, sink, () => 3);

  const reviewInput: ReviewDecisionInput = {
    candidate: {
      route: "files",
      tool: "write_file",
      description: "Write a file",
      schema: '{"type":"object"}',
      args: '{"path":"C:\\\\tmp\\\\a.txt"}',
    },
    step: { instruction: "Escribir archivo", expected: null },
    userInput: [],
    stepFailures: [],
    stepsDone: [],
    done: [],
    lastReads: [],
    env: [],
  };

  for (const badBody of [
    '{"answers":{"review":{"choice":"approved"}}}',
    '{"answers":{"review":',
    '{"wrong":1}',
    '{"answers":{"review":{"choice":"desconocida"}}}',
  ]) {
    const prevCount = captured.length;
    await withFakeFetch(async () => new Response(badBody, { status: 200 }), async () => {
      if (badBody === '{"answers":{"review":{"choice":"approved"}}}') {
        const ok = await wrapped.reviewArgs(reviewInput);
        assert.equal(ok.review, "approved");
        assert.equal(captured[prevCount].error, null);
        assert.equal(captured[prevCount].output, badBody);
      } else {
        await assert.rejects(
          () => wrapped.reviewArgs(reviewInput),
          (err: unknown) =>
            err instanceof DecisionValidationError &&
            err.overflow === false &&
            err.raw?.rawOutput === badBody &&
            typeof err.raw.rawInput === "string",
        );
        assert.equal(captured[prevCount].output, badBody);
        assert.ok(captured[prevCount].input?.includes("Escribir archivo"));
        assert.match(captured[prevCount].error ?? "", /Decision 2\.0 Validation/);
      }
    });
  }

  // Overflow: no llama a fetch y deja overflow=true con raw=undefined
  const smallEngine = new Decision20Engine(testConfig({ decisionMaxContext: 5 }));
  let fetched = false;
  await withFakeFetch(async () => {
    fetched = true;
    return new Response("{}");
  }, async () => {
    await assert.rejects(
      () => smallEngine.reviewArgs(reviewInput),
      (err: unknown) => err instanceof DecisionValidationError && err.overflow === true && err.raw === undefined,
    );
  });
  assert.equal(fetched, false);
});

test("eval runner (DN-3.4) y scenario userInput (P-09): 0 reintentos en decisión y respuesta en el estado", async () => {
  const mat = materializeScenario("route", {
    mode: "reactive",
    request: "Mostrá archivos del escritorio",
    userInput: ["la carpeta Desktop"],
    at: { routes: ["files", "terminal"] },
  });
  const checked = validateCase({
    id: "d1-invalid",
    stage: "route",
    request: mat.request,
    expect: { expectedRoute: "files" },
  });
  assert.equal(checked.ok, true, checked.ok ? "" : checked.errors.join("; "));
  const c = checked.case;
  assert.equal(c.request.type, "decision");
  assert.match(c.request.state, /la carpeta Desktop/);

  let calls = 0;
  const badDecClient: DecisionClient = {
    prepare: (req) => ({ url: "http://mock/v1/systemone", body: req as unknown as Record<string, unknown> }),
    call: async () => {
      calls++;
      return {
        ok: true,
        rawOutput: '{"answers":{"route":{"choice":',
        tokens: { prompt: 10, completion: 2, total: 12 },
        tokensEstimated: true,
        durationMs: 5,
      };
    },
  };
  const cfg = parseConfig(["--client=mock", "--stages=route", "--repeat=1"]);
  const variant = await loadVariant("prod");
  const out = await runDataset({
    cases: [c],
    datasetName: "test",
    variant,
    variantSpec: "prod",
    cfg,
    genClient: createMockGenerativeClient({ url: cfg.url, model: cfg.model }),
    decClient: badDecClient,
    stageFilter: ["route"],
  });

  assert.equal(calls, 1, "decisión hace 1 solo intento (sin reintento)");
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].measurements.attempts, 1);
  assert.equal(out.records[0].metrics.output_parse_ok, false);
  assert.equal(out.records[0].warnings.length, 0);
});

test("P-02: postconditionOf y Guard manejan rutas Windows correctamente en cualquier SO anfitrión", () => {
  const existing = new Set(["C:\\b", "C:\\b\\nota.txt"]);
  const disk = {
    exists: (p: string) => existing.has(p),
    isDirectory: (p: string) => p === "C:\\b",
    size: () => 10,
  };
  assert.equal(postconditionOf("move_file", { source: "C:\\a\\nota.txt", destination: "C:\\b" }, disk), "met");

  const deny = Guard.evaluate(
    "desktop_commander",
    "write_file",
    { path: "C:\\Users\\Ana\\refs\\r1.txt", content: "x" },
    { protectedDirs: ["C:\\Users\\Ana\\refs"], relativeBases: [] },
  );
  assert.equal(deny.decision, "DENY");
});
