import assert from "node:assert/strict";
import { test } from "node:test";

import { THREAD_ANSWER_CHARS, previousTaskOf, threadBlock, threadMemoryLines } from "../src/core/engine/thread.ts";
import { DECISION_PROMPTS, PROMPTS } from "../src/core/models/prompts.ts";

test("previousTaskOf: recorta la respuesta y limpia espacios", () => {
  const long = "x".repeat(THREAD_ANSWER_CHARS + 50);
  assert.equal(previousTaskOf("  pedido  ", "  corta  ").answer, "corta");
  assert.equal(previousTaskOf("p", long).answer.length, THREAD_ANSWER_CHARS + 1, "recorte más la elipsis");
});

test("los prompts llevan el hilo solo cuando hay tarea anterior", () => {
  const prev = previousTaskOf("buscá el último modelo de GPT", "Es GPT-5.6.");
  assert.ok(!PROMPTS.PENDING_VIEW.buildUserPrompt({ view: "REQUEST: x" }).includes("PREVIOUS TASK"));
  assert.ok(PROMPTS.PENDING_VIEW.buildUserPrompt({ view: "REQUEST: x", thread: prev }).startsWith(threadBlock(prev)));
  assert.ok(!PROMPTS.FINAL_VIEW.buildUserPrompt({ view: "REQUEST: x" }).includes("PREVIOUS TASK"));
  assert.ok(PROMPTS.FINAL_VIEW.buildUserPrompt({ view: "REQUEST: x", thread: prev }).includes("Answer: Es GPT-5.6."));
  assert.deepEqual(threadMemoryLines(prev), ["previous request: buscá el último modelo de GPT", "previous answer: Es GPT-5.6."]);
});

test("buildContinuation: una pregunta noul con la tarea anterior y el pedido nuevo", () => {
  const q = DECISION_PROMPTS.buildContinuation({ previous: { request: "a", answer: "b" }, request: "guardalo" });
  assert.equal(q.state, "Previous request: a\nPrevious answer: b\nNew request: guardalo");
  assert.deepEqual(Object.keys(q.questions), ["follow"]);
  assert.equal(q.questions.follow.type, "noul");
});
