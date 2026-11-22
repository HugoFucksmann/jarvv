/** Modelos y transporte HTTP (`models/transport.ts`, `models/qwen.ts`, `models/decision.ts`): reintentos, abort, desborde de contexto, saneamiento de rawOutput y parsers. */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { ConfigManager, type JarvisConfig } from "../src/core/config.ts";
import {
  Decision20Engine,
  JUDGE_BATCH,
  buildDecisionRequest,
  parseAnswersObject,
  parseResponse,
  validateAnswer,
} from "../src/core/models/decision.ts";
import {
  QwenEngine,
  parseJsonObject,
  parsePendingList,
  parsePlanSteps,
  stripThink,
  validateArgs,
} from "../src/core/models/qwen.ts";
import {
  DecisionServiceUnavailableError,
  DecisionValidationError,
  LLMServiceUnavailableError,
  LLMValidationError,
  RequestAbortedError,
  TransportError,
  postJson,
} from "../src/core/models/transport.ts";
import type { DecisionQuestion, MCPTool } from "../src/core/types.ts";
import { cleanInputSchema } from "../src/core/utils.ts";

// ───────────────────────── Servidor HTTP efímero compartido ─────────────────────────

interface RecordedHttpCall {
  readonly method: string;
  readonly path: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly bodyText: string;
  readonly body: unknown;
}

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  call: RecordedHttpCall,
) => void | Promise<void>;

let server: http.Server;
let baseUrl = "";
let recorded: RecordedHttpCall[] = [];
let nextHandler: Handler = (_req, res) => {
  res.writeHead(404).end();
};

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      try {
        body = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        body = bodyText;
      }
      const call: RecordedHttpCall = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        bodyText,
        body,
      };
      recorded.push(call);
      void Promise.resolve(nextHandler(req, res, call)).catch((err) => {
        if (!res.headersSent) res.writeHead(500).end(String(err));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

function withHandler(fn: Handler): void {
  recorded = [];
  nextHandler = fn;
}

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return {
    ...ConfigManager.getConfig(),
    qwenUrl: baseUrl,
    qwenModel: "qwen-test",
    qwenNumCtx: 8192,
    qwenTimeoutMs: 5000,
    qwenThinkingTimeoutMs: 5000,
    decisionUrl: baseUrl,
    decisionModel: "decision-test",
    decisionMaxContext: 4096,
    decisionTimeoutMs: 5000,
    thinking: false,
    ...overrides,
  };
}

const FILE_TOOL: MCPTool = {
  name: "write_file",
  description: "Escribe un archivo",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      mode: { type: "string", enum: ["rewrite", "append"] },
      line: { type: ["integer", "null"] },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const ENV_WIN = { platform: "windows" as const, home: "C:\\Users\\Ana" };

// ───────────────────────── transport.ts (`postJson`) ─────────────────────────

test("postJson: reintenta una vez ante HTTP 503, no reintenta ante 500 y combina headers", async () => {
  let n = 0;
  withHandler((_req, res) => {
    n++;
    if (n === 1) {
      res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "busy" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    }
  });

  const ok = await postJson({
    url: `${baseUrl}/v1/chat/completions`,
    body: JSON.stringify({ ping: 1 }),
    timeoutMs: 5000,
    headers: { "X-Custom": "uno" },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 200);
  assert.equal(recorded.length, 2, "un único reintento tras 503");
  assert.equal(recorded[0].headers["x-custom"], "uno");
  assert.equal(recorded[0].headers["content-type"], "application/json");

  withHandler((_req, res) => {
    res.writeHead(500).end("fail");
  });
  const fail500 = await postJson({ url: `${baseUrl}/err`, body: "{}", timeoutMs: 2000 });
  assert.equal(fail500.ok, false);
  assert.equal(fail500.status, 500);
  assert.equal(recorded.length, 1, "500 no es 503 y no se reintenta");
});

test("postJson: nunca reintenta timeout y lanza TransportError('timeout')", async () => {
  const pending: http.ServerResponse[] = [];
  withHandler((_req, res) => {
    pending.push(res);
  });

  await assert.rejects(
    () => postJson({ url: `${baseUrl}/slow`, body: "{}", timeoutMs: 80 }),
    (err: unknown) => err instanceof TransportError && err.kind === "timeout",
  );
  assert.equal(recorded.length, 1, "el timeout no se reintenta");
  for (const res of pending) res.destroy();
});

test("postJson: reintenta una vez en error de red persistente y luego lanza TransportError('network')", async () => {
  // Puerto cerrado efímero sin servidor escuchando.
  const deadServer = http.createServer();
  await new Promise<void>((resolve) => deadServer.listen(0, "127.0.0.1", resolve));
  const deadPort = (deadServer.address() as AddressInfo).port;
  await new Promise<void>((resolve) => deadServer.close(() => resolve()));

  await assert.rejects(
    () => postJson({ url: `http://127.0.0.1:${deadPort}/v1/chat/completions`, body: "{}", timeoutMs: 5000 }),
    (err: unknown) => err instanceof TransportError && err.kind === "network",
  );
});

test("postJson: abortado durante la espera de backoff tras un 503 lanza RequestAbortedError sin reintentar", async () => {
  const ac = new AbortController();
  withHandler((_req, res) => {
    res.writeHead(503).end("busy");
    setTimeout(() => ac.abort(new Error("user_abort")), 40);
  });

  const t0 = Date.now();
  await assert.rejects(
    () => postJson({ url: `${baseUrl}/abort-backoff`, body: "{}", timeoutMs: 5000, signal: ac.signal }),
    (err: unknown) => err instanceof RequestAbortedError,
  );
  assert.equal(recorded.length, 1, "cancelado en el backoff no hace segundo intento");
  assert.ok(Date.now() - t0 < 800, "sale rápido al abortar sin esperar el backoff completo");
});

// ───────────────────────── QwenEngine: parsers puros ─────────────────────────

test("stripThink y parseJsonObject manejan <think> huérfanos, bloques ```json y strings con fences internos", () => {
  assert.equal(stripThink("<think>razona\n</think>  hola "), "hola");
  assert.equal(stripThink("pensamiento previo</think>{\"a\":1}"), '{"a":1}');
  assert.equal(stripThink("texto <think>sin cerrar"), "texto");

  // JSON directo cuyo string contiene markdown ```json``` (no debe romperse al extraer).
  const rawWithFenceInside = JSON.stringify({
    path: "C:\\doc.md",
    content: "Ejemplo:\n```json\n{\"nested\": true}\n```\nfin",
  });
  assert.deepEqual(parseJsonObject(rawWithFenceInside), {
    path: "C:\\doc.md",
    content: "Ejemplo:\n```json\n{\"nested\": true}\n```\nfin",
  });

  // Bloque ```json``` con explicación fuera y pensamiento previo.
  const noisy = '<think>dudo</think>Aquí tienes:\n```json\n{"pending": ["a"]}\n```\nListo.';
  assert.deepEqual(parseJsonObject(noisy), { pending: ["a"] });

  // Llaves balanceadas sin fence con ruido alrededor; arreglo raíz devuelve null.
  assert.deepEqual(parseJsonObject('prefacio {"k": "v {interno}"} sufijo'), { k: "v {interno}" });
  assert.equal(parseJsonObject("[1, 2, 3]"), null);
});

test("validateArgs, parsePlanSteps y parsePendingList validan contratos sin inferencias silenciosas", () => {
  assert.match(validateArgs({ path: "a" }, FILE_TOOL.inputSchema) ?? "", /faltan campos requeridos: content/);
  assert.match(validateArgs({ path: "a", content: "x", extra: 1 }, FILE_TOOL.inputSchema) ?? "", /parámetro no definido/);
  assert.match(validateArgs({ path: "a", content: "x", mode: "bad" }, FILE_TOOL.inputSchema) ?? "", /fuera del enum/);
  assert.match(validateArgs({ path: "a", content: "x", line: 1.5 }, FILE_TOOL.inputSchema) ?? "", /se esperaba integer\|null y se recibió number/);
  assert.equal(validateArgs({ path: "a", content: "x", mode: "append", line: null }, FILE_TOOL.inputSchema), null);

  assert.deepEqual(parsePendingList([" uno ", "dos"]), { pending: ["uno", "dos"] });
  assert.deepEqual(parsePendingList([]), { pending: [] });
  assert.ok("error" in parsePendingList(["ok", "  "]));
  assert.ok("error" in parsePendingList("no_array"));

  const okSteps = parsePlanSteps(
    [{ goal: "Leer", suggested_mcp: "files_read", expected_outcome: "Texto leído" }],
    3,
    false,
  );
  assert.deepEqual(okSteps, {
    steps: [{ id: "s3", instruction: "Leer", route: "files_read", expectedOutcome: "Texto leído" }],
  });
  assert.ok("error" in parsePlanSteps([], 1, false));
  assert.deepEqual(parsePlanSteps([], 1, true), { steps: [] });
  assert.ok("error" in parsePlanSteps([{ goal: "x", suggested_mcp: "invented", expected_outcome: "y" }], 1, false));
  const tooMany = Array.from({ length: BUDGET.maxSteps + 1 }, () => ({
    goal: "g",
    suggested_mcp: "files_read",
    expected_outcome: "e",
  }));
  assert.ok("error" in parsePlanSteps(tooMany, 1, false));
});

// ───────────────────────── QwenEngine: flujo HTTP y reintentos ─────────────────────────

test("QwenEngine: resolveUrl y reserveCompletionTokens rechazan URLs inválidas y desborde sin enviar HTTP", async () => {
  withHandler((_req, res) => {
    res.writeHead(200).end("{}");
  });

  const badEmpty = new QwenEngine(() => makeConfig({ qwenUrl: "   " }));
  await assert.rejects(
    () => badEmpty.generateQuestion({ view: "REQUEST: hola" }),
    (e: unknown) => e instanceof LLMServiceUnavailableError && e.retryable === false,
  );

  const badLegacy = new QwenEngine(() => makeConfig({ qwenUrl: `${baseUrl}/api/chat` }));
  await assert.rejects(
    () => badLegacy.generateQuestion({ view: "REQUEST: hola" }),
    (e: unknown) => e instanceof LLMServiceUnavailableError && e.retryable === false,
  );

  // Desborde previo al envío HTTP (`qwenNumCtx` insuficiente para prompt + MIN_COMPLETION_TOKENS).
  const tight = new QwenEngine(() => makeConfig({ qwenNumCtx: 300 }));
  await assert.rejects(
    () => tight.generateQuestion({ view: "x".repeat(2000) }),
    (e: unknown) => e instanceof LLMValidationError && e.overflow === true,
  );
  assert.equal(recorded.length, 0, "el desborde aborta antes de tocar la red");
});

test("QwenEngine: sanea rawOutput (sin reasoning/<think>), quita nulls opcionales y reintenta 1 vez si trunca o falla schema", async () => {
  let attempt = 0;
  withHandler((_req, res) => {
    attempt++;
    const payload =
      attempt === 1
        ? {
            id: "c1",
            model: "qwen-test",
            choices: [
              {
                index: 0,
                finish_reason: "length",
                reasoning: "RAZONAMIENTO_OCULTO_1",
                message: {
                  role: "assistant",
                  reasoning_content: "RAZONAMIENTO_OCULTO_2",
                  content: "<think>secreto</think>{\"path\": \"C:\\\\a.txt\"",
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }
        : {
            id: "c2",
            model: "qwen-test",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                reasoning: "NO_DEBE_APARECER",
                message: {
                  role: "assistant",
                  content: "<think>privado</think>{\"path\":\"C:\\\\a.txt\",\"content\":\"ok\",\"mode\":null}",
                },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 30 },
          };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  });

  const qwen = new QwenEngine(() => makeConfig({ qwenUrl: `${baseUrl}/v1` }));
  const result = await qwen.generateArgumentsFromView({
    tool: FILE_TOOL,
    cleanedSchema: cleanInputSchema(FILE_TOOL.inputSchema),
    environment: ENV_WIN,
    view: "STEP: escribir archivo",
  });

  assert.equal(recorded.length, 2, "primer intento truncado + 1 reintento");
  assert.equal(recorded[0].path, "/v1/chat/completions");
  const req1 = recorded[0].body as { max_tokens: number; temperature: number; messages: { content: string }[] };
  const req2 = recorded[1].body as { max_tokens: number; temperature: number; messages: { content: string }[] };
  assert.equal(req2.max_tokens, Math.ceil(req1.max_tokens * 1.5), "el reintento amplía el tope de salida x1.5");
  assert.ok(req2.temperature >= 0.3, "el reintento sube la temperatura");
  assert.match(req2.messages[1].content, /truncó/i, "el error previo entra al prompt del reintento");

  // `mode: null` opcional se elimina antes de validar; `rawOutput` y `failedAttempts` no filtran pensamiento.
  assert.deepEqual(result.args, { path: "C:\\a.txt", content: "ok" });
  assert.equal(result.failedAttempts?.length, 1);
  assert.equal(result.rawOutput.includes("NO_DEBE_APARECER"), false);
  assert.equal(result.rawOutput.includes("privado"), false);
  assert.equal(result.failedAttempts?.[0].rawOutput.includes("RAZONAMIENTO_OCULTO"), false);
  assert.equal(result.failedAttempts?.[0].rawOutput.includes("secreto"), false);
});

test("QwenEngine: generatePlanFromView rechaza plan que excede maxSteps tras reintento y generateFinalFromView marca truncado en último intento", async () => {
  withHandler((_req, res) => {
    const overSteps = [
      { goal: "1", suggested_mcp: "files_read", expected_outcome: "a" },
      { goal: "2", suggested_mcp: "files_read", expected_outcome: "b" },
      { goal: "3", suggested_mcp: "files_read", expected_outcome: "c" },
    ];
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        choices: [{ index: 0, finish_reason: "stop", message: { content: JSON.stringify({ steps: overSteps }) } }],
      }),
    );
  });

  const qwen = new QwenEngine(() => makeConfig({ thinking: true }));
  await assert.rejects(
    () => qwen.generatePlanFromView({ view: "REQUEST: algo", trigger: "initial", maxSteps: 2 }),
    (err: unknown) => err instanceof LLMValidationError && err.attempts?.length === 2,
  );
  assert.equal(recorded.length, 2);

  // `generateFinalFromView`: si ambos intentos vienen truncados con texto, el último añade aviso de truncado y apaga thinking en el reintento.
  withHandler((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        choices: [{ index: 0, finish_reason: "length", message: { content: "Resultado parcial" } }],
      }),
    );
  });
  const final = await qwen.generateFinalFromView({ view: "REQUEST: hola" });
  assert.equal(recorded.length, 2);
  assert.equal((recorded[0].body as { reasoning_effort: string }).reasoning_effort, "low");
  assert.equal((recorded[1].body as { reasoning_effort: string }).reasoning_effort, "none", "el reintento del final apaga thinking");
  assert.match(final.response, /Resultado parcial[\s\S]*\[Respuesta truncada por el límite de tokens\]/);
});

// ───────────────────────── Decision20Engine: parsers y flujo HTTP ─────────────────────────

test("Decision20Engine: buildDecisionRequest y parseResponse validan forma, criterios y rango noul", () => {
  const built = buildDecisionRequest(makeConfig({ decisionUrl: `${baseUrl}/` }), { state: "S", questions: {} });
  assert.equal(built.url, `${baseUrl}/v1/systemone`);
  const parsedBody = JSON.parse(built.body) as Record<string, unknown>;
  assert.equal(parsedBody.model, "decision-test");
  assert.equal(parsedBody.keep_alive, ConfigManager.getConfig().modelKeepAlive);

  assert.throws(() => parseAnswersObject("{malformed"), DecisionValidationError);
  assert.throws(() => parseAnswersObject("{}"), DecisionValidationError);

  const qChoice: DecisionQuestion = { type: "choice", instructions: "Elige", criteria: { a: "uno", b: "dos" } };
  const qNoul: DecisionQuestion = { type: "noul", instructions: "¿Sí?", criteria: { true: "sí", false: "no" } };
  assert.throws(() => validateAnswer("q", qChoice, { choice: "z" }), DecisionValidationError);
  assert.throws(() => validateAnswer("q", qNoul, { noul: 1.2 }), DecisionValidationError);
  assert.throws(() => validateAnswer("q", qNoul, { noul: Number.NaN }), DecisionValidationError);

  const ok = parseResponse(
    JSON.stringify({
      answers: {
        c: { choice: "a", probabilities: { a: 0.9, b: 0.1, bad: "x" } },
        n: { noul: 0.75 },
      },
    }),
    { c: qChoice, n: qNoul },
  );
  assert.deepEqual(ok, {
    c: { choice: "a", probabilities: { a: 0.9, b: 0.1 } },
    n: { noul: 0.75 },
  });
});

test("Decision20Engine: atajos de opción única, desborde, HTTP 500, verifyResult con known y lotes JUDGE_BATCH en score()", async () => {
  withHandler((_req, res) => {
    res.writeHead(200).end("{}");
  });

  // Sin URL => unavailable no reintentable
  const unconfigured = new Decision20Engine(() => makeConfig({ decisionUrl: "" }));
  await assert.rejects(
    () => unconfigured.checkCompletion({ view: "REQUEST: x" }),
    (e: unknown) => e instanceof DecisionServiceUnavailableError && e.retryable === false,
  );

  // Atajos de una sola ruta / una sola herramienta: 0 peticiones HTTP
  const engine = new Decision20Engine(() => makeConfig());
  const routeSingle = await engine.chooseRoute({
    routes: ["files_read"],
    step: { instruction: "leer", expected: null },
    lastResult: null,
    done: [],
    attempts: [],
    userInput: [],
    env: [],
    request: "leer",
  });
  assert.equal(routeSingle.route, "files_read");
  assert.equal(routeSingle.shortcut, true);

  const toolSingle = await engine.chooseTool({
    route: "files_read",
    tools: [FILE_TOOL],
    step: { instruction: "escribir", expected: null },
    lastResult: null,
    done: [],
    attempts: [],
    userInput: [],
    env: [],
  });
  assert.equal(toolSingle.tool.name, "write_file");
  assert.equal(toolSingle.shortcut, true);
  assert.equal(recorded.length, 0);

  // Desborde de decisionMaxContext: no envía petición HTTP
  const smallCtx = new Decision20Engine(() => makeConfig({ decisionMaxContext: 50 }));
  await assert.rejects(
    () => smallCtx.checkCompletion({ view: "x".repeat(400) }),
    (e: unknown) => e instanceof DecisionValidationError && e.overflow === true,
  );
  assert.equal(recorded.length, 0);

  // HTTP 500 => DecisionServiceUnavailableError
  withHandler((_req, res) => {
    res.writeHead(500).end("down");
  });
  await assert.rejects(
    () => engine.checkCompletion({ view: "REQUEST: x" }),
    (e: unknown) => e instanceof DecisionServiceUnavailableError,
  );

  // Respuesta malformada => DecisionValidationError con rawInput/rawOutput/timing
  withHandler((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" }).end("not-json");
  });
  await assert.rejects(
    () => engine.checkCompletion({ view: "REQUEST: x" }),
    (e: unknown) =>
      e instanceof DecisionValidationError &&
      e.raw?.rawOutput === "not-json" &&
      typeof e.raw.rawInput === "string" &&
      e.raw.timing !== undefined,
  );

  // verifyResult conserva `known.ok` y toma `cumple` del servidor
  withHandler((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ answers: { ok: { noul: 0.2 }, cumple: { noul: 0.91 } } }),
    );
  });
  const verified = await engine.verifyResult({
    criterion: { instruction: "escribir", expected: "creado" },
    call: "CALL write_file",
    done: [],
    userInput: [],
    recent: [],
    known: { ok: 1 },
  });
  assert.deepEqual(verified.answers, { ok: 1, cumple: 0.91 });

  // score() divide en lotes de JUDGE_BATCH (= 5): 7 fragmentos => 2 llamadas HTTP (5 + 2)
  const batchSizes: number[] = [];
  withHandler((_req, res, call) => {
    const body = call.body as { questions: Record<string, unknown> };
    const keys = Object.keys(body.questions);
    batchSizes.push(keys.length);
    const answers = Object.fromEntries(keys.map((k, idx) => [k, { noul: (batchSizes.length * 10 + idx) / 100 }]));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ answers }));
  });
  const fragments = Array.from({ length: JUDGE_BATCH + 2 }, (_, i) => `frag ${i}`);
  const scored = await engine.score("¿versión actual?", fragments);
  assert.deepEqual(batchSizes, [JUDGE_BATCH, 2]);
  assert.equal(scored.probabilities.length, JUDGE_BATCH + 2);
  assert.deepEqual(scored.probabilities, [0.1, 0.11, 0.12, 0.13, 0.14, 0.2, 0.21]);
});

test("Decision20Engine.score: una señal ya cancelada aborta incluso con la lista de fragmentos vacía", async () => {
  const engine = new Decision20Engine(() => makeConfig());
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => engine.score("necesidad", [], ctrl.signal), RequestAbortedError);
  const ok = await engine.score("necesidad", []);
  assert.deepEqual(ok.probabilities, []);
});
