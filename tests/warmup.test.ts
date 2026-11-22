import assert from "node:assert/strict";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { isKeepAlive } from "../src/core/config.ts";
import { buildDecisionRequest } from "../src/core/models/decision.ts";
import { chatCompletionsUrl } from "../src/core/models/chatUrl.ts";
import { chatUrl, warmUpModels } from "../src/core/models/warmup.ts";

const config = { qwenUrl: "http://h:1/", qwenModel: "q", qwenTimeoutMs: 1000, decisionUrl: "http://h:2", decisionModel: "d", decisionTimeoutMs: 1000, modelKeepAlive: "30m" } as unknown as JarvisConfig;

test("isKeepAlive: acepta -1, 0 y duraciones con unidad; rechaza el resto", () => {
  for (const ok of ["-1", "0", "30m", "2h", "90s", "1.5h", "500ms"]) assert.ok(isKeepAlive(ok), ok);
  for (const bad of ["", "30", "abc", "m30", "-2", 5, null, undefined]) assert.ok(!isKeepAlive(bad), String(bad));
});

test("la consulta de decisión lleva keep_alive", () => {
  const { body } = buildDecisionRequest(config, { state: "s", questions: {} });
  assert.equal((JSON.parse(body) as { keep_alive: string }).keep_alive, "30m");
});

test("chatUrl: base del servidor o URL completa", () => {
  assert.equal(chatUrl("http://h:1/"), "http://h:1/v1/chat/completions");
  assert.equal(chatUrl("http://h:1/v1/chat/completions"), "http://h:1/v1/chat/completions");
});

test("warmUpModels: una consulta mínima a cada modelo con keep_alive, decisión primero; un fallo no lanza", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  await warmUpModels(() => config, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true, status: 200 };
  });
  assert.deepEqual(calls.map((c) => c.url), ["http://h:2/v1/systemone", "http://h:1/v1/chat/completions"]);
  assert.deepEqual(calls.map((c) => [c.body.model, c.body.keep_alive]), [["d", "30m"], ["q", "30m"]]);
  assert.equal(calls[1].body.max_tokens, 1);

  await warmUpModels(() => config, async () => {
    throw new Error("Ollama apagado");
  });
  await warmUpModels(() => config, async () => ({ ok: false, status: 404 }));
});

test("chatCompletionsUrl: base, base con /v1, URL completa; rechaza vacía y endpoints viejos", () => {
  assert.deepEqual(chatCompletionsUrl("http://h:1"), { ok: true, url: "http://h:1/v1/chat/completions" });
  assert.deepEqual(chatCompletionsUrl(" http://h:1/// "), { ok: true, url: "http://h:1/v1/chat/completions" });
  assert.deepEqual(chatCompletionsUrl("http://h:1/v1"), { ok: true, url: "http://h:1/v1/chat/completions" });
  assert.deepEqual(chatCompletionsUrl("http://h:1/v1/chat/completions/"), { ok: true, url: "http://h:1/v1/chat/completions" });
  assert.deepEqual(chatCompletionsUrl("   "), { ok: false, reason: "empty", base: "" });
  assert.deepEqual(chatCompletionsUrl("http://h:1/api/chat"), { ok: false, reason: "unsupported", base: "http://h:1/api/chat" });
  assert.deepEqual(chatCompletionsUrl("http://h:1/generate"), { ok: false, reason: "unsupported", base: "http://h:1/generate" });
});

test("chatUrl: una base con /v1 no se duplica; una URL inválida da null y el precalentamiento la omite sin lanzar", async () => {
  assert.equal(chatUrl("http://h:1/v1"), "http://h:1/v1/chat/completions");
  assert.equal(chatUrl(""), null);
  const urls: string[] = [];
  await warmUpModels(() => ({ ...config, qwenUrl: "" }), async (url) => {
    urls.push(url);
    return { ok: true, status: 200 };
  });
  assert.deepEqual(urls, ["http://h:2/v1/systemone"], "solo se precalienta el modelo de decisión");
});
