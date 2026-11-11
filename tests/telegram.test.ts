/** Telegram: configuración por entorno, formato de los mensajes, progreso de la tarea y el cliente de la API. */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import type { NormalizedOp } from "../src/core/ctx/index.ts";
import type { TaskEvent } from "../src/core/tasks.ts";
import { JarvisApi } from "../src/telegram/api.ts";
import { telegramConfigFromEnv } from "../src/telegram/config.ts";
import { chunk, mdToHtml } from "../src/telegram/format.ts";
import { Progress } from "../src/telegram/progress.ts";

test("config: sin token está desactivado; el chat debe ser un id numérico privado", () => {
  assert.equal(telegramConfigFromEnv({}, 3000).config, null);
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t" }, 3000).config, null);
  for (const bad of ["tu_id", "0", "-100123", "1.5"]) {
    assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: bad }, 3000).config, null, bad);
  }
  const ok = telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: " t ", TELEGRAM_CHAT_ID: "42", TELEGRAM_MODE: "deliberative" }, 3001);
  assert.ok(ok.config);
  assert.deepEqual(ok.config, { token: "t", chatId: 42, apiBase: "http://127.0.0.1:3001/api/jarvis", mode: "deliberative" });
  assert.deepEqual(ok.warnings, []);
});

test("config: un modo inválido se avisa y se ignora", () => {
  const setup = telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42", TELEGRAM_MODE: "reactivo" }, 3000);
  assert.ok(setup.config);
  assert.equal(setup.config.mode, undefined);
  assert.equal(setup.warnings.length, 1);
});

test("mdToHtml escapa HTML y convierte el formato; chunk parte en trozos del tope", () => {
  assert.equal(mdToHtml("**a** <b> `c`"), "<b>a</b> &lt;b&gt; <code>c</code>");
  assert.ok(mdToHtml("```\n<x>\n```").includes("<pre>&lt;x&gt;</pre>"));
  const parts = chunk("a\n".repeat(5000), 3500);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 3500));
  assert.ok(chunk("x".repeat(9000), 3500).every((p) => p.length <= 3500));
});

/** Operaciones como las emite la API (ids `s1`, `c1` como destino de los `update`). */
const ops = (...list: unknown[]): NormalizedOp[] => list as NormalizedOp[];

test("Progress muestra pasos, qué hace cada llamada, su resultado y su veredicto", () => {
  const p = new Progress();
  const [step, call, approve, done] = ops(
    { op: "add", target: "steps", value: { id: "s1", instruction: "Listar procesos <ram>", route: "terminal", state: "running", superseded: false } },
    { op: "add", target: "calls", value: { id: "c1", stepId: "s1", tool: "run_command", kind: "write", status: "ok", verdict: null, args: { command: "Get-Process | Sort WS" }, summary: "status: listed\n355 processes" } },
    { op: "update", target: "c1", value: { verdict: "approved", reason: null } },
    { op: "update", target: "s1", value: { state: "completed" } },
  );
  assert.ok(p.apply(step) && p.apply(call));
  const working = p.render("⏳ Trabajando…");
  assert.ok(working.includes("🔄 1. Listar procesos &lt;ram&gt; · Terminal y procesos"));
  assert.ok(working.includes("<code>run_command</code>") && working.includes("Get-Process | Sort WS") && working.includes("<i>listed</i>"));

  assert.ok(p.apply(approve) && p.apply(done));
  const finished = p.render("✅ Tarea completada");
  assert.ok(finished.includes("✅ 1.") && finished.includes("✓"));
});

test("Progress ignora lo que no dibuja y un paso descartado sale tachado", () => {
  const p = new Progress();
  const [orphan, other, step, replaced] = ops(
    { op: "add", target: "calls", value: { id: "c9", stepId: "nada", tool: "x", kind: "read", status: "ok", verdict: null, args: null, summary: null } },
    { op: "set", target: "result", value: { text: "hola", origin: "model" } },
    { op: "add", target: "steps", value: { id: "s1", instruction: null, route: null, state: "running", superseded: false } },
    { op: "update", target: "s1", value: { superseded: true, state: "failed" } },
  );
  assert.equal(p.apply(orphan), false);
  assert.equal(p.apply(other), false);
  p.apply(step);
  p.apply(replaced);
  assert.ok(p.render("h").includes("<s>❌ 1. Iteración #1</s> (descartado)"));
});

test("JarvisApi: post devuelve el error de la API o de la red, y listen reconecta y entrega los eventos", async () => {
  const sent: TaskEvent = { type: "created", taskId: "t1", n: 0 };
  let connections = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/jarvis/events") {
      connections++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": ping\n\n");
      res.write(`data: ${JSON.stringify(sent)}\n\n`);
      if (connections === 1) res.end(); // se corta: el cliente debe reconectar
      return;
    }
    res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "La tarea no espera eso." }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jarvis`;
  const api = new JarvisApi(base);

  assert.deepEqual(await api.post("/approve", {}), { ok: false, error: "La tarea no espera eso." });

  const received: TaskEvent[] = [];
  const abort = new AbortController();
  const listening = api.listen((e) => {
    received.push(e);
    if (received.length === 2) abort.abort();
  }, abort.signal);
  await listening;
  assert.deepEqual(received, [sent, sent]);
  assert.equal(connections, 2);

  server.closeAllConnections();
  server.close();
  assert.deepEqual(await api.post("/approve", {}), { ok: false, error: "No se pudo contactar con JARVIS." });
});

import { BOT_COMMANDS, parseMode, parseSwitch } from "../src/telegram/commands.ts";

test("comandos: on/off y modo se entienden en español e inglés; lo demás es null", () => {
  for (const on of ["on", "ON", " sí ", "activar", "1"]) assert.equal(parseSwitch(on), true, on);
  for (const off of ["off", "No", "desactivar", "0"]) assert.equal(parseSwitch(off), false, off);
  assert.equal(parseSwitch(""), null);
  assert.equal(parseSwitch("quizás"), null);
  assert.equal(parseMode("Deliberativo"), "deliberative");
  assert.equal(parseMode("reactive"), "reactive");
  assert.equal(parseMode("rapido"), null);
  assert.equal(parseMode(""), null);
});

test("el menú de comandos cumple los límites de Telegram", () => {
  for (const c of BOT_COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(c.description.length >= 3 && c.description.length <= 256);
  }
});

test("comandos: modo se abrevia con la inicial", () => {
  assert.equal(parseMode("r"), "reactive");
  assert.equal(parseMode("D"), "deliberative");
});
