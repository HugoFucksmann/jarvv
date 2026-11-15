/**
 * Pruebas deterministas de paridad `src/` ↔ `eval/` (Etapa 3 del Eval V2, sin red ni cambios en `eval/core/client/*`):
 * - `applyVariantPrompts`: fusión fiel de vistas/constructores enteros y parámetros por etapa entre `scenario.ts` y motores reales.
 * - Paridad de payload enviado (`url`, `messages`, `temperature`, `max_tokens`, `reasoning_effort`, `response_format`, `state`, `questions`)
 *   entre `materializeScenario` + `createGenerativeClient`/`createDecisionClient` y `QwenEngine` / `Decision20Engine`.
 * - Paridad de reserva de contexto (`reserveCompletionTokens`), validadores (`validateArgs`, `parsePlanSteps`, `parsePendingList`) y umbrales.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigManager, type ConfigSource, type JarvisConfig } from "../src/core/config.ts";
import { COMPLETION_KEY } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { completionInput, pendingInput, planInput, renderArgsView, reviewInput, reviewViewOptions, routeInput, routeViewOptions, toolInput, verifyInput } from "../src/core/engine/adapters.ts";
import { COMPLETION_APPROVE } from "../src/core/engine/completion.ts";
import { firstQueryKind } from "../src/core/engine/firstQuery.ts";
import { codeAnswersOk, postconditionOf } from "../src/core/engine/postcondition.ts";
import { CONTINUATION_APPROVE } from "../src/core/engine/thread.ts";
import { verdictOf } from "../src/core/engine/verify.ts";
import { Decision20Engine, buildDecisionRequest } from "../src/core/models/decision.ts";
import { DECISION_PROMPTS, PROMPTS } from "../src/core/models/prompts.ts";
import {
  MIN_COMPLETION_TOKENS,
  QwenEngine,
  parsePendingList as prodParsePendingList,
  parsePlanSteps as prodParsePlanSteps,
  reserveCompletionTokens as prodReserveCompletionTokens,
  validateArgs as prodValidateArgs,
} from "../src/core/models/qwen.ts";
import { renderAsk, renderFinal } from "../src/core/render/index.ts";
import { askRenderOptions, finalRenderOptions, finalViewOptions } from "../src/core/engine/adapters.ts";
import { SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import { GATE_MIN, PLACE_PROBE } from "../src/core/tools/probes.ts";
import { JUDGE_FOUND } from "../src/tools/web/webSearchProvider.ts";

import { createDecisionClient } from "../eval/core/client/decision.ts";
import { createGenerativeClient, reserveCompletionTokens as evalReserveCompletionTokens } from "../eval/core/client/generative.ts";
import { parsePlanSteps, validateArgs } from "../eval/core/contract.ts";
import { materializeScenario, type Scenario } from "../eval/core/scenario.ts";
import type { DecisionRequest, GenerativeRequest, Variant } from "../eval/core/types.ts";
import {
  parseArgsReviewDecision,
  parseCompletionDecision,
  parseContinuationDecision,
  parseD0Decision,
  parseFragmentJudgeDecision,
  parseProbeDecision,
  parseResultVerificationDecision,
  parseRouteDecision,
  parseToolChoiceDecision,
} from "../eval/core/variants/labels.ts";
import { applyVariantPrompts } from "../eval/core/variants/prompts.ts";

function testConfig(overrides: Partial<JarvisConfig> = {}): ConfigSource {
  const cfg: JarvisConfig = {
    ...ConfigManager.getConfig(),
    qwenUrl: "http://127.0.0.1:19999",
    qwenModel: "qwen-test",
    qwenNumCtx: 8192,
    decisionUrl: "http://127.0.0.1:19998",
    decisionModel: "d3-test",
    modelKeepAlive: "10m",
    ...overrides,
  };
  return () => cfg;
}

function withFakeFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function omitKeepAlive(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.keep_alive;
  return copy;
}

test("Etapa 3: applyVariantPrompts conserva prompts no sobrescritos y aplica stageParams en escenario y QwenEngine", async () => {
  const customVariant: Variant = {
    name: "custom_parity",
    prompts: {
      PROMPTS: {
        QUESTION: {
          SYSTEM: "Ask very briefly.",
          buildUserPrompt: ({ view }) => `ASK_CUSTOM:\n${view}`,
        },
      },
      DECISION_PROMPTS: {
        buildFirstQuery: ({ request }) => ({
          state: `CUSTOM_D0: ${request}`,
          questions: {
            kind: {
              type: "choice",
              instructions: "Classify custom.",
              criteria: { chat: "chat", single: "single", multi: "multi" },
            },
            multi: { type: "noul", instructions: "Multiple actions?" },
          },
        }),
      },
    },
    params: {
      question: { temperature: 0.27, maxTokens: 111, reasoningEffort: "none" },
    },
  };

  const applied = applyVariantPrompts(customVariant);
  assert.equal(applied.prompts.PLAN_VIEW.SYSTEM, PROMPTS.PLAN_VIEW.SYSTEM);
  assert.equal(applied.prompts.QUESTION.SYSTEM, "Ask very briefly.");
  assert.equal(applied.decisionPrompts.buildRouteChoice, DECISION_PROMPTS.buildRouteChoice);
  assert.equal(applied.stageParams.question?.temperature, 0.27);
  assert.equal(applied.stageParams.question?.maxTokens, 111);

  const sc: Scenario = {
    mode: "reactive",
    request: "Abrí el informe",
  };
  const matQ = materializeScenario("question", sc, customVariant);
  assert.equal(matQ.request.type, "generative");
  if (matQ.request.type === "generative") {
    assert.equal(matQ.request.system, "Ask very briefly.");
    assert.ok(matQ.request.user.startsWith("ASK_CUSTOM:\n"));
    assert.equal(matQ.request.temperature, 0.27);
    assert.equal(matQ.request.maxTokens, 111);
    assert.equal(matQ.request.reasoningEffort, "none");
  }

  const matD0 = materializeScenario("d0", sc, customVariant);
  assert.equal(matD0.request.type, "decision");
  if (matD0.request.type === "decision") {
    assert.equal(matD0.request.state, "CUSTOM_D0: Abrí el informe");
  }
});

test("Etapa 3: paridad exacta de payload generativo entre scenario + GenerativeClient y QwenEngine", async () => {
  const cfgSource = testConfig();
  const cfg = cfgSource();
  const env = {
    platform: "windows" as const,
    home: "C:/Users/hugof",
    desktop: "C:/Users/hugof/Desktop",
    documents: "C:/Users/hugof/Documents",
    downloads: "C:/Users/hugof/Downloads",
  };

  const readToolDef = SYSTEM_TOOL_MANIFEST.find((t) => t.name === "read_file" && t.route === "files")!;
  const readTool = {
    name: readToolDef.name,
    description: readToolDef.description,
    inputSchema: { type: "object", properties: {} },
  };

  // Construimos un contexto deliberativo rico (plan + llamada fallida + ref + facts + userInput) y uno reactivo
  const buildRichCtx = (mode: "reactive" | "deliberative") => {
    let n = 1_700_000_000_000;
    const ctx = create.context(
      { id: `parity_${mode}`, request: "Busca notas.txt en Documentos y resumilo", mode },
      { now: () => (n += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
    );
    const planId =
      mode === "deliberative"
        ? ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0]
        : null;
    const stepId = ctx.apply({
      op: "add",
      target: "steps",
      value:
        mode === "deliberative"
          ? { planId, instruction: "Leer notas.txt", route: "files", expected: "contenido de notas.txt" }
          : { planId: null, instruction: "Busca notas.txt en Documentos y resumilo", route: null, expected: null },
    }).ids[0];
    if (mode === "deliberative") ctx.apply({ op: "update", target: stepId, value: { state: "running" } });
    ctx.apply({ op: "set", target: "facts.answer_s1_1", value: { value: "está en Documentos", stepId } });
    return { ctx, stepId };
  };

  const scReactive: Scenario = {
    mode: "reactive",
    request: "Busca notas.txt en Documentos y resumilo",
    steps: [{ state: "running" }],
    userInput: ["está en Documentos"],
    at: { route: "files", tool: "read_file", environment: env },
  };
  const scDelib: Scenario = {
    mode: "deliberative",
    request: "Busca notas.txt en Documentos y resumilo",
    steps: [{ instruction: "Leer notas.txt", route: "files", expected: "contenido de notas.txt", state: "running" }],
    userInput: ["está en Documentos"],
    at: { route: "files", tool: "read_file", environment: env, feedback: "Usa Documentos" },
  };

  const genClient = createGenerativeClient({ url: cfg.qwenUrl, model: cfg.qwenModel, numCtx: cfg.qwenNumCtx });
  const qwen = new QwenEngine(cfgSource, PROMPTS);

  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  await withFakeFetch(
    async (url, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      captured.push({ url, body: parsed });
      const msgContent =
        captured.length === 1
          ? JSON.stringify({ steps: [{ goal: "Leer notas", suggested_mcp: "files", expected_outcome: "contenido leído" }] })
          : captured.length === 2
            ? JSON.stringify({ path: "C:/Users/hugof/Documents/notas.txt" })
            : captured.length === 3
              ? "¿En qué subcarpeta está?"
              : captured.length === 4
                ? JSON.stringify({ pending: ["Leer notas.txt"] })
                : "Listo.";
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: msgContent } }], usage: {} }),
        { status: 200 },
      );
    },
    async () => {
      const delibCtx = buildRichCtx("deliberative").ctx;
      await qwen.generatePlanFromView(planInput(delibCtx, "Usa Documentos"));

      const reactCtx = buildRichCtx("reactive").ctx;
      await qwen.generateArgumentsFromView({
        tool: readTool,
        cleanedSchema: { type: "object", properties: {} },
        environment: env,
        view: renderArgsView(reactCtx, "read_file").text,
      });
      await qwen.generateQuestion({ view: renderAsk(reactCtx.view.forAsk(), askRenderOptions()) });
      await qwen.generatePendingFromView(pendingInput(reactCtx, []));
      await qwen.generateFinalFromView({ view: renderFinal(reactCtx.view.forFinal(finalViewOptions()), finalRenderOptions()).text });
    },
  );

  const scenarios: Array<[string, Scenario]> = [
    ["plan", scDelib],
    ["arguments", scReactive],
    ["question", scReactive],
    ["pending", scReactive],
    ["final", scReactive],
  ];

  assert.equal(captured.length, scenarios.length);
  scenarios.forEach(([stage, sc], idx) => {
    const mat = materializeScenario(stage, sc);
    const prepared = genClient.prepare(mat.request as GenerativeRequest);
    assert.equal(captured[idx].url, prepared.url, `URL mismatch en ${stage}`);
    assert.deepEqual(omitKeepAlive(captured[idx].body), prepared.body, `Body mismatch en ${stage}`);
  });

  // Paridad de reserveCompletionTokens (incluyendo overflow < MIN_COMPLETION_TOKENS)
  const smallReq = materializeScenario("question", scReactive).request as GenerativeRequest;
  assert.equal(evalReserveCompletionTokens(smallReq, 8192), prodReserveCompletionTokens(smallReq, 8192));
  const hugePromptTokens = MIN_COMPLETION_TOKENS - 1;
  const tightCtx = Math.ceil((smallReq.system.length + smallReq.user.length) / 3) + hugePromptTokens;
  assert.equal(evalReserveCompletionTokens(smallReq, tightCtx), null);
  assert.equal(prodReserveCompletionTokens(smallReq, tightCtx), null);
});

test("Etapa 3: paridad exacta de payload de decisión entre scenario + DecisionClient y Decision20Engine", async () => {
  const cfgSource = testConfig();
  const cfg = cfgSource();
  const decClient = createDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel });
  const decEngine = new Decision20Engine(cfgSource, DECISION_PROMPTS);

  let n = 1_700_000_000_000;
  const ctx = create.context(
    { id: "dec_parity", request: "Lee notas.txt y guardalo en resumen.md", mode: "reactive" },
    { now: () => (n += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Lee notas.txt y guardalo en resumen.md", route: null, expected: null } }).ids[0];
  const callId = ctx.apply({
    op: "add",
    target: "calls",
    value: {
      stepId,
      route: "files",
      tool: "read_file",
      kind: "read",
      args: { path: "C:/Users/hugof/notas.txt" },
      sig: "s1",
      status: "ok",
      summary: "contenido de prueba",
      ref: null,
    },
  }).ids[0];

  const scBase: Scenario = {
    mode: "reactive",
    request: "Lee notas.txt y guardalo en resumen.md",
    steps: [{ state: "running" }],
    calls: [
      {
        route: "files",
        tool: "read_file",
        kind: "read",
        status: "ok",
        args: { path: "C:/Users/hugof/notas.txt" },
        summary: "contenido de prueba",
      },
    ],
  };

  const readToolDef = SYSTEM_TOOL_MANIFEST.find((t) => t.name === "read_file" && t.route === "files")!;
  const filesTools = SYSTEM_TOOL_MANIFEST.filter((t) => t.route === "files").map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: { type: "object", properties: {} },
  }));

  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const nextAnswers = [
    { kind: { choice: "multi", probabilities: { chat: 0.05, single: 0.2, multi: 0.75 } }, multi: { noul: 0.8 } },
    { follow: { noul: 0.75 } },
    { route: { choice: "files", probabilities: { files: 0.9, terminal: 0.05, web: 0.05 } } },
    { selected_tool: { choice: "read_file", probabilities: Object.fromEntries(filesTools.map((t) => [t.name, t.name === "read_file" ? 0.9 : 0.01])) } },
    { review: { choice: "approved", probabilities: { approved: 0.85, args_invalid: 0.1, info_missing: 0.05 } } },
    { cumple: { noul: 0.88 } },
    { [COMPLETION_KEY]: { noul: 0.82 } },
    { f0: { noul: 0.9 }, f1: { noul: 0.2 } },
    { probe: { noul: 0.15 } },
  ];

  await withFakeFetch(
    async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const answers = nextAnswers[captured.length];
      captured.push({ url, body });
      return new Response(JSON.stringify({ answers }), { status: 200 });
    },
    async () => {
      await decEngine.firstQuery({ request: scBase.request });
      await decEngine.continuation({ previous: { request: "Busca TS", answer: "TS 5.8" }, request: scBase.request });
      await decEngine.chooseRoute(routeInput(ctx.view.forRoute(routeViewOptions()), { routes: ["files", "terminal", "web"] }));
      await decEngine.chooseTool(toolInput(ctx.view.forRoute(routeViewOptions("files")), "files", filesTools));
      await decEngine.reviewArgs(reviewInput(ctx.view.forReview(reviewViewOptions()), "files", { name: readToolDef.name, description: readToolDef.description, inputSchema: { type: "object", properties: {} } }, { path: "C:/Users/hugof/notas.txt" }));
      const evaluated = ctx.find("calls", { id: callId })[0];
      const known = codeAnswersOk(evaluated.tool, evaluated.status, evaluated.summary) ? { ok: 1 } : undefined;
      await decEngine.verifyResult({ ...verifyInput(ctx.view.forVerify(callId)), ...(known ? { known } : {}) });
      await decEngine.checkCompletion(completionInput(ctx));
      await decEngine.score("¿Cuándo salió TS 5.8?", ["TS 5.8 salió en marzo", "Otro texto"]);

      const writeProbeStage = PLACE_PROBE.stages({
        tool: "write_file",
        args: { path: "C:/Users/hugof/Downloads/a.txt", content: "x", mode: "rewrite" },
        summary: "ok",
        request: "Guarda a.txt en Documentos",
        step: "Guarda a.txt en Documentos",
      })[0];
      await decEngine.probe({ state: writeProbeStage.state, question: writeProbeStage.question });
    },
  );

  const probeReq = buildDecisionRequest(cfg, {
    state: "Step: Guarda a.txt en Documentos",
    questions: {},
  });
  assert.equal(probeReq.url, `${cfg.decisionUrl}/v1/systemone`);

  const pairs: Array<[string, Scenario]> = [
    ["d0", scBase],
    ["continuation", { ...scBase, at: { previousTask: { request: "Busca TS", answer: "TS 5.8" } } }],
    ["route", { ...scBase, at: { routes: ["files", "terminal", "web"] } }],
    ["tool_choice", { ...scBase, at: { route: "files" } }],
    ["args_review", { ...scBase, at: { route: "files", tool: "read_file", args: { path: "C:/Users/hugof/notas.txt" } } }],
    ["result_verification", scBase],
    ["completion", scBase],
    ["fragment_judge", { mode: "reactive", request: "x", at: { need: "¿Cuándo salió TS 5.8?", fragments: ["TS 5.8 salió en marzo", "Otro texto"] } }],
    [
      "probe",
      {
        mode: "reactive",
        request: "Guarda a.txt en Documentos",
        calls: [{ route: "files", tool: "write_file", kind: "write", status: "ok", args: { path: "C:/Users/hugof/Downloads/a.txt", content: "x", mode: "rewrite" }, summary: "ok" }],
        at: { probe: "place", probeStage: 0 },
      },
    ],
  ];

  assert.equal(captured.length, pairs.length);
  pairs.forEach(([stage, sc], idx) => {
    const mat = materializeScenario(stage, sc);
    const prepared = decClient.prepare(mat.request as DecisionRequest);
    assert.equal(captured[idx].url, prepared.url, `Decision URL mismatch en ${stage}`);
    assert.deepEqual(omitKeepAlive(captured[idx].body), prepared.body, `Decision body mismatch en ${stage}`);
  });
});

test("Etapa 3: paridad de parsers, validadores y umbrales entre eval/ y src/", () => {
  // 1. D0 threshold parity
  const d0Req: DecisionRequest = {
    type: "decision",
    state: "Request: Busca algo",
    questions: {
      kind: { type: "choice", instructions: "?", criteria: { chat: "c", single: "s", multi: "m" } },
      multi: { type: "noul", instructions: "?" },
    },
  };
  const d0Raw = JSON.stringify({
    answers: {
      kind: { choice: "single", probabilities: { chat: 0.71, single: 0.2, multi: 0.09 } },
      multi: { noul: 0.1 },
    },
  });
  assert.equal(parseD0Decision(d0Raw, d0Req).kind, firstQueryKind(0.71, 0.1));

  // 2. route & tool_choice
  const routeReq: DecisionRequest = {
    type: "decision",
    state: "s",
    questions: { route: { type: "choice", instructions: "?", criteria: { files: "f", web: "w" } } },
  };
  assert.equal(parseRouteDecision(JSON.stringify({ answers: { route: { choice: "web", probabilities: { files: 0.1, web: 0.9 } } } }), routeReq).route, "web");

  const toolReq: DecisionRequest = {
    type: "decision",
    state: "s",
    questions: { selected_tool: { type: "choice", instructions: "?", criteria: { read_file: "r", list_directory: "l" } } },
  };
  assert.equal(parseToolChoiceDecision(JSON.stringify({ answers: { selected_tool: { choice: "read_file", probabilities: { read_file: 0.95, list_directory: 0.05 } } } }), toolReq).selected, "read_file");

  // 3. args_review threshold parity
  const revReq: DecisionRequest = {
    type: "decision",
    state: "s",
    questions: { review: { type: "choice", instructions: "?", criteria: { approved: "a", args_invalid: "b", info_missing: "c" } } },
  };
  assert.equal(
    parseArgsReviewDecision(JSON.stringify({ answers: { review: { choice: "approved", probabilities: { approved: 0.55, args_invalid: 0.35, info_missing: 0.1 } } } }), revReq).review,
    "args_invalid",
  );

  // 4. result_verification & verdictOf parity
  const rvReq: DecisionRequest = {
    type: "decision",
    state: "s",
    questions: {
      ok: { type: "noul", instructions: "ok?" },
      cumple: { type: "noul", instructions: "cumple?" },
    },
  };
  const rvOut = parseResultVerificationDecision(JSON.stringify({ answers: { ok: { noul: 0.7 }, cumple: { noul: 0.45 } } }), rvReq);
  assert.equal(rvOut.ok && rvOut.cumple, verdictOf({ ok: 0.7, cumple: 0.45 }).verdict === "approved");

  // 5. probe, continuation, completion, fragment_judge thresholds
  const probeReq: DecisionRequest = { type: "decision", state: "s", questions: { probe: { type: "noul", instructions: "?" } } };
  assert.equal(parseProbeDecision(JSON.stringify({ answers: { probe: { noul: GATE_MIN } } }), probeReq).yes, true);
  assert.equal(parseProbeDecision(JSON.stringify({ answers: { probe: { noul: GATE_MIN - 0.01 } } }), probeReq).yes, false);

  const contReq: DecisionRequest = { type: "decision", state: "s", questions: { follow: { type: "noul", instructions: "?" } } };
  assert.equal(parseContinuationDecision(JSON.stringify({ answers: { follow: { noul: CONTINUATION_APPROVE } } }), contReq).follows, true);
  assert.equal(parseContinuationDecision(JSON.stringify({ answers: { follow: { noul: CONTINUATION_APPROVE - 0.01 } } }), contReq).follows, false);

  const compReq: DecisionRequest = { type: "decision", state: "s", questions: { [COMPLETION_KEY]: { type: "noul", instructions: "?" } } };
  assert.equal(parseCompletionDecision(JSON.stringify({ answers: { [COMPLETION_KEY]: { noul: COMPLETION_APPROVE } } }), compReq).complete, true);
  assert.equal(parseCompletionDecision(JSON.stringify({ answers: { [COMPLETION_KEY]: { noul: COMPLETION_APPROVE - 0.01 } } }), compReq).complete, false);

  const fjReq: DecisionRequest = { type: "decision", state: "s", questions: { f0: { type: "noul", instructions: "?" }, f1: { type: "noul", instructions: "?" } } };
  assert.deepEqual(
    parseFragmentJudgeDecision(JSON.stringify({ answers: { f0: { noul: JUDGE_FOUND }, f1: { noul: JUDGE_FOUND - 0.01 } } }), fjReq).relevant,
    [true, false],
  );

  // 6. validateArgs & parsePlanSteps & parsePendingList parity
  const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false };
  assert.equal(validateArgs({ path: "/tmp/a" }, schema).length === 0, prodValidateArgs({ path: "/tmp/a" }, schema) === null);
  assert.equal(validateArgs({}, schema).join("; "), prodValidateArgs({}, schema));

  const rawSteps = [{ goal: "g", suggested_mcp: "files", expected_outcome: "ok" }];
  const prodPlan = prodParsePlanSteps(rawSteps, 1, false);
  assert.ok(!("error" in prodPlan));
  assert.deepEqual(parsePlanSteps(rawSteps, 1, false), prodPlan.steps);

  assert.deepEqual(prodParsePendingList(["a", "b"]), { pending: ["a", "b"] });

  // 7. postconditionOf parity on synthetic DiskView
  const post = postconditionOf("write_file", { path: "/v/a.txt", content: "hi", mode: "rewrite" }, {
    exists: (p) => p === "/v/a.txt",
    isDirectory: () => false,
    size: () => 2,
  });
  assert.equal(post, "met");
});
