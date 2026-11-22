/**
 * El puente de Telegram de punta a punta, sin red: la API de JARVIS es un servidor HTTP local (con su SSE) y la de Telegram, un transformador de grammY que
 * anota cada llamada. Las actualizaciones del chat se entregan a mano (`bot.handleUpdate`) y los eventos de las tareas, por el SSE, como en producción.
 */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import { Bot } from "grammy";

import type { TaskEvent } from "../src/core/tasks.ts";
import { startTelegram } from "../src/telegram/bot.ts";
import type { TelegramMode } from "../src/telegram/config.ts";

const CHAT = 4242;
const FROM = { id: CHAT, is_bot: false, first_name: "Hugo" };
const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "Jarvis",
  username: "jarvis_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as never;

interface ApiCall {
  readonly path: string;
  readonly body: Record<string, unknown>;
}
interface TelegramCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

async function until(condition: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`no ocurrió a tiempo: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function harness(mode?: TelegramMode) {
  const calls: ApiCall[] = [];
  const sseClients: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/api/jarvis/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": ping\n\n");
      sseClients.push(res);
      return;
    }
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const path = (req.url ?? "").replace("/api/jarvis", "");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (req.method === "POST") calls.push({ path, body });
      const json = path === "/process" ? { task: { task: { id: "task_1" } } } : path.startsWith("/state") ? { task: { result: null } } : { ok: true };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jarvis`;

  const telegram: TelegramCall[] = [];
  let messageId = 100;
  const bot = new Bot("1:fake", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    telegram.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" ? { message_id: ++messageId, date: 0, chat: { id: CHAT, type: "private" } } : true;
    return { ok: true, result } as never;
  });

  const stop = startTelegram({ cfg: { token: "1:fake", chatId: CHAT, apiBase, ...(mode ? { mode } : {}) }, getVoice: () => null, bot, polling: false });
  cleanups.push(async () => {
    stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await until(() => sseClients.length > 0, "el puente se conectó a los eventos");

  let updateId = 0;
  const h = {
    calls,
    telegram,
    posts: (path: string) => calls.filter((c) => c.path === path),
    texts: () => telegram.filter((t) => t.method === "sendMessage").map((t) => String(t.payload.text)),
    /** Un mensaje de texto del chat (o de otro chat). */
    say: (text: string, chatId = CHAT) =>
      bot.handleUpdate({
        update_id: ++updateId,
        message: {
          message_id: ++updateId,
          date: 0,
          chat: { id: chatId, type: "private" },
          from: { ...FROM, id: chatId },
          text,
          ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}),
        },
      } as never),
    /** Un botón del aviso. */
    press: (data: string) =>
      bot.handleUpdate({
        update_id: ++updateId,
        callback_query: { id: String(++updateId), from: FROM, chat_instance: "x", data, message: { message_id: 200, date: 0, chat: { id: CHAT, type: "private" }, text: "aviso" } },
      } as never),
    /** Un evento de la API, por el SSE. */
    emit: (event: unknown) => {
      for (const client of sseClients) client.write(`data: ${JSON.stringify(event as TaskEvent)}\n\n`);
    },
    /** Los `callback_data` de los botones de los avisos enviados. */
    buttons: (): string[] =>
      telegram
        .filter((t) => t.method === "sendMessage" && t.payload.reply_markup)
        .flatMap((t) => (t.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard.flat().map((b) => b.callback_data ?? "")),
    /** Inicia una tarea y espera a que el puente la conozca. */
    startTask: async (text = "haz algo") => {
      await h.say(text);
      await until(() => h.posts("/process").length > 0, "se pidió iniciar la tarea");
      await until(() => h.telegram.some((t) => t.method === "sendMessage"), "se mostró el progreso");
    },
  };
  return h;
}

const approval = { kind: "approval", request: { id: "approval-id-1", mcp: "jarvis_files_write", tool: "write_file", capability: "FILE_WRITE", reason: "porque sí", args: { path: "a.txt" }, canRemember: true } };
const plan = { kind: "plan", request: { id: "plan-id-1", planId: "plan1", steps: [{ id: "s1", instruction: "Hacer A", route: "files_write", expected: "" }] } };
const question = { kind: "question", question: { id: "q1", stepId: "s9", question: "¿Qué nombre?", source: "model" } };

test("un chat que no es el autorizado se ignora: no inicia tareas ni recibe respuesta", async () => {
  const h = await harness();
  await h.say("haz algo", 999);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(h.calls.length, 0);
  assert.equal(h.telegram.length, 0);
});

test("un mensaje inicia la tarea (con el modo configurado), muestra el progreso y avisa «escribiendo…»", async () => {
  const h = await harness("deliberative");
  await h.startTask("ordena mi escritorio");
  assert.deepEqual(h.posts("/process")[0].body, { message: "ordena mi escritorio", mode: "deliberative" });
  assert.ok(h.telegram.some((t) => t.method === "sendChatAction" && t.payload.action === "typing"));
  const status = h.telegram.find((t) => t.method === "sendMessage");
  assert.equal(status?.payload.parse_mode, "HTML");
});

test("con una tarea en curso, otro mensaje no inicia otra", async () => {
  const h = await harness();
  await h.startTask();
  await h.say("otra cosa");
  await until(() => h.texts().some((t) => t.includes("Hay una tarea en curso")), "se avisó que hay una tarea en curso");
  assert.equal(h.posts("/process").length, 1);
});

test("una aprobación llega con botones; el botón la resuelve con el id de la espera y uno viejo no aplica", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({ type: "waiting", taskId: "task_1", waiting: approval });
  await until(() => h.buttons().some((b) => b.startsWith("aa:")), "se mostró la aprobación con sus botones");
  assert.ok(h.texts().some((t) => t.includes("Aprobación requerida") && t.includes("jarvis_files_write/write_file")));

  await h.press(h.buttons().find((b) => b.startsWith("aa:")) as string);
  await until(() => h.posts("/approve").length === 1, "se aprobó");
  assert.deepEqual(h.posts("/approve")[0].body, { taskId: "task_1", waitId: "approval-id-1" });

  await h.press("aa:viejo123");
  await until(() => h.telegram.some((t) => t.method === "answerCallbackQuery" && t.payload.text === "Ya no aplica."), "un botón de otra espera no aplica");
  assert.equal(h.posts("/approve").length, 1);
});

test("«aprobar siempre» y «denegar» mandan su decisión (con `remember` solo en el primero)", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({ type: "waiting", taskId: "task_1", waiting: approval });
  await until(() => h.buttons().some((b) => b.startsWith("al:")), "se mostraron los botones");
  await h.press(h.buttons().find((b) => b.startsWith("al:")) as string);
  await until(() => h.posts("/approve").length === 1, "se aprobó siempre");
  assert.deepEqual(h.posts("/approve")[0].body, { taskId: "task_1", waitId: "approval-id-1", remember: true });
  await h.press(h.buttons().find((b) => b.startsWith("ad:")) as string);
  await until(() => h.posts("/deny").length === 1, "se denegó");
  assert.deepEqual(h.posts("/deny")[0].body, { taskId: "task_1", waitId: "approval-id-1" });
});

test("una pregunta se responde con el siguiente mensaje de texto", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({ type: "waiting", taskId: "task_1", waiting: question });
  await until(() => h.texts().some((t) => t.includes("¿Qué nombre?")), "se mostró la pregunta");
  await h.say("informe.md");
  await until(() => h.posts("/user-answer").length === 1, "se respondió");
  assert.deepEqual(h.posts("/user-answer")[0].body, { taskId: "task_1", answer: "informe.md" });
  assert.equal(h.posts("/process").length, 1, "la respuesta no inició otra tarea");
});

test("un plan se acepta, se rechaza o se modifica: «modificar» pide el texto y lo manda con el siguiente mensaje", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({ type: "waiting", taskId: "task_1", waiting: plan });
  await until(() => h.buttons().some((b) => b.startsWith("pm:")), "se mostró el plan");
  assert.ok(h.texts().some((t) => t.includes("Plan propuesto") && t.includes("1. Hacer A")));

  await h.press(h.buttons().find((b) => b.startsWith("pm:")) as string);
  await until(() => h.texts().some((t) => t.includes("Escribe los cambios")), "pidió los cambios");
  await h.say("hazlo más corto");
  await until(() => h.posts("/modify-plan").length === 1, "se mandaron los cambios");
  assert.deepEqual(h.posts("/modify-plan")[0].body, { taskId: "task_1", waitId: "plan-id-1", feedback: "hazlo más corto" });

  await h.press(h.buttons().find((b) => b.startsWith("pa:")) as string);
  await until(() => h.posts("/confirm-plan").length === 1, "se aceptó");
  assert.deepEqual(h.posts("/confirm-plan")[0].body, { taskId: "task_1", waitId: "plan-id-1" });
});

test("al terminar, la respuesta llega al chat, el título final se escribe y se puede iniciar otra tarea", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({
    type: "change",
    taskId: "task_1",
    n: 1,
    at: 0,
    ops: [
      { op: "set", target: "result", value: { text: "Listo, ordené todo." } },
      { op: "finish", value: { state: "completed", stopReason: null } },
    ],
  });
  await until(() => h.texts().some((t) => t.includes("Listo, ordené todo.")), "llegó la respuesta");
  await until(() => h.telegram.some((t) => t.method === "editMessageText" && String(t.payload.text).includes("Tarea completada")), "el título final del progreso");

  await h.say("otra tarea");
  await until(() => h.posts("/process").length === 2, "se inició otra tarea");
});

test("/modo cambia el modo de las tareas que siguen y /cancel cancela la tarea en curso", async () => {
  const h = await harness();
  await h.say("/modo d");
  await until(() => h.texts().some((t) => t.includes("deliberativo")), "confirmó el modo");
  await h.startTask("haz algo");
  assert.equal(h.posts("/process")[0].body.mode, "deliberative");

  await h.say("/cancel");
  await until(() => h.posts("/cancel").length === 1, "se canceló");
  assert.deepEqual(h.posts("/cancel")[0].body, { taskId: "task_1" });
});

test("sin tarea en curso, /cancel lo dice; /start muestra la ayuda", async () => {
  const h = await harness();
  await h.say("/cancel");
  await until(() => h.texts().some((t) => t.includes("No hay tarea en curso")), "avisó que no hay tarea");
  await h.say("/start");
  await until(() => h.texts().some((t) => t.includes("JARVIS listo")), "mostró la ayuda");
});

test("un modelo caído pausa la tarea y se avisa en el chat", async () => {
  const h = await harness();
  await h.startTask();
  h.emit({ type: "paused", taskId: "task_1", paused: { since: 0, model: "llm" } });
  await until(() => h.texts().some((t) => t.includes("modelo generativo (LLM)") && t.includes("no disponible")), "avisó la pausa");
});
