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
  assert.ok(working.includes("🔄 1. Listar procesos &lt;ram&gt; · Terminal"));
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
  const sent: TaskEvent = {
    type: "created",
    taskId: "t1",
    n: 0,
    summary: { id: "t1", mode: "reactive", request: "hola", state: "running", stopReason: null, startedAt: 0, n: 0, waiting: null },
  };
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

test("Progress tacha un paso descartado aunque el parche traiga solo superseded (como lo emite el planner)", () => {
  const p = new Progress();
  const [step, replaced] = ops(
    { op: "add", target: "steps", value: { id: "s1", instruction: "leer", route: null, state: "pending", superseded: false } },
    { op: "update", target: "s1", value: { superseded: true } },
  );
  p.apply(step);
  assert.equal(p.apply(replaced), true);
  assert.ok(p.render("h").includes("<s>⏳ 1. leer</s> (descartado)"));
});

import type { Waiting } from "../src/core/types/waiting.ts";
import { AUTO_SPEC, runSwitch, voiceSwitchOf } from "../src/telegram/switches.ts";
import { APPROVAL_ARGS_MAX, describeWaiting, tagOf, waitKey } from "../src/telegram/waitingPrompt.ts";

const callbacks = (kb: { readonly inline_keyboard: readonly (readonly object[])[] }): string[] =>
  kb.inline_keyboard.flat().map((b) => ("callback_data" in b && typeof b.callback_data === "string" ? b.callback_data : ""));

const planWait = { kind: "plan", request: { id: "plan-wait-id-1", steps: [{ instruction: "Hacer A" }, { instruction: "Hacer B" }] } } as unknown as Waiting;
const approvalWait = (args: unknown, canRemember: boolean): Waiting =>
  ({ kind: "approval", request: { id: "approval-id-1", mcp: "jarvis_files_write", tool: "write_file", capability: "FILE_WRITE", reason: "porque sí", args, canRemember } }) as unknown as Waiting;
const questionWait = { kind: "question", question: { stepId: "s3", question: "¿Qué nombre?" } } as unknown as Waiting;

test("describeWaiting: un plan muestra sus pasos y ofrece aceptar, modificar y rechazar con la etiqueta de la espera", () => {
  const { markdown, keyboard } = describeWaiting(planWait);
  assert.ok(markdown.includes("1. Hacer A") && markdown.includes("2. Hacer B"));
  const tag = tagOf(planWait);
  assert.deepEqual(callbacks(keyboard), [`pa:${tag}`, `pm:${tag}`, `pr:${tag}`]);
  assert.equal(tag.length, 8, "Telegram limita el callback_data a 64 bytes");
});

test("describeWaiting: una aprobación revisable ofrece aprobar (y «siempre» solo si se puede recordar); si no cabe en el chat, solo denegar o cancelar", () => {
  const small = describeWaiting(approvalWait({ path: "a.txt" }, true));
  assert.deepEqual(callbacks(small.keyboard).map((c) => c.split(":")[0]), ["aa", "al", "ad", "cx"]);
  assert.ok(small.markdown.includes("jarvis_files_write/write_file") && small.markdown.includes("porque sí"));

  const noRemember = describeWaiting(approvalWait({ path: "a.txt" }, false));
  assert.deepEqual(callbacks(noRemember.keyboard).map((c) => c.split(":")[0]), ["aa", "ad", "cx"]);

  const long = describeWaiting(approvalWait({ content: "x".repeat(APPROVAL_ARGS_MAX + 10) }, true));
  assert.deepEqual(callbacks(long.keyboard).map((c) => c.split(":")[0]), ["ad", "cx"], "lo que no se pudo leer entero no se aprueba desde el chat");
  assert.ok(long.markdown.includes("demasiado largos"));
});

test("describeWaiting: una pregunta pide responder con un mensaje y solo ofrece cancelar; la clave de la espera distingue pregunta de petición", () => {
  const { markdown, keyboard } = describeWaiting(questionWait);
  assert.ok(markdown.includes("¿Qué nombre?") && markdown.includes("Responde con un mensaje"));
  assert.deepEqual(callbacks(keyboard), [`cx:${tagOf(questionWait)}`]);
  assert.equal(waitKey(questionWait), "qs3");
  assert.equal(waitKey(planWait), "plan-wait-id-1");
});

test("voiceSwitchOf: `/voz on|off` es la nota de voz de Telegram y `/voz ui on|off` la voz de la interfaz", () => {
  assert.deepEqual([voiceSwitchOf("on").spec.key, voiceSwitchOf("on").arg], ["telegramVoice", "on"]);
  assert.deepEqual([voiceSwitchOf("").spec.key, voiceSwitchOf("").arg], ["telegramVoice", ""]);
  assert.deepEqual([voiceSwitchOf("ui off").spec.key, voiceSwitchOf("ui off").arg], ["voiceEnabled", "off"]);
  assert.deepEqual([voiceSwitchOf("UI").spec.key, voiceSwitchOf("UI").arg], ["voiceEnabled", ""]);
});

function fakeSwitchApi(current: boolean | null) {
  const posts: unknown[] = [];
  const api = {
    get: async () => (current === null ? { ok: false as const, error: "caído" } : { ok: true as const, data: { autoMode: current } }),
    post: async (_path: string, body: unknown) => {
      posts.push(body);
      return { ok: true as const, data: {} };
    },
  };
  return { api: api as never, posts };
}
function fakeCtx() {
  const replies: { text: string; markup: unknown }[] = [];
  const ctx = { reply: async (text: string, extra?: { reply_markup?: unknown }) => void replies.push({ text, markup: extra?.reply_markup }) };
  return { ctx: ctx as never, replies };
}

test("runSwitch: sin argumento muestra el estado; un argumento inválido da el uso; repetir el estado no escribe", async () => {
  const state = fakeSwitchApi(true);
  const c1 = fakeCtx();
  await runSwitch(state.api, c1.ctx, AUTO_SPEC, "");
  assert.match(c1.replies[0].text, /Modo automático de Guard: activado/);

  const c2 = fakeCtx();
  await runSwitch(state.api, c2.ctx, AUTO_SPEC, "quizás");
  assert.match(c2.replies[0].text, /^Uso: \/auto on o \/auto off/);

  const c3 = fakeCtx();
  await runSwitch(state.api, c3.ctx, AUTO_SPEC, "on");
  assert.match(c3.replies[0].text, /ya está activado/);
  assert.equal(state.posts.length, 0);
});

test("runSwitch: encender el modo automático pide confirmar con botones; apagarlo escribe directo; sin poder leer la configuración, avisa", async () => {
  const off = fakeSwitchApi(false);
  const ask = fakeCtx();
  await runSwitch(off.api, ask.ctx, AUTO_SPEC, "on");
  assert.deepEqual(callbacks(ask.replies[0].markup as never), ["ao:y", "ao:n"]);
  assert.equal(off.posts.length, 0, "no se escribe hasta confirmar");

  const on = fakeSwitchApi(true);
  const done = fakeCtx();
  await runSwitch(on.api, done.ctx, AUTO_SPEC, "off");
  assert.deepEqual(on.posts, [{ autoMode: false }]);
  assert.match(done.replies[0].text, /desactivado/);

  const down = fakeSwitchApi(null);
  const warn = fakeCtx();
  await runSwitch(down.api, warn.ctx, AUTO_SPEC, "on");
  assert.match(warn.replies[0].text, /No se pudo leer la configuración/);
});

test("mdToHtml: un NUL que venga en el texto no se confunde con la marca de un bloque de código", () => {
  const html = mdToHtml("antes \u00000\u0000 despues\n```\ncodigo\n```");
  assert.ok(html.includes("<pre>codigo</pre>"), "el bloque de código real se restaura");
  assert.equal(html.includes("\u0000"), false);
  assert.ok(html.includes("antes 0 despues"), "el NUL de la entrada se descarta y su texto queda");
});
