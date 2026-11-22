/** `StatusMessage`: un solo mensaje de progreso que se edita, con ediciones espaciadas y serializadas, y el aviso «escribiendo…». */

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { StatusMessage, type StatusSink } from "../src/telegram/statusMessage.ts";

afterEach(() => mock.timers.reset());

function setup(over: Partial<StatusSink> = {}) {
  const calls: string[] = [];
  const sink: StatusSink = {
    send: async (html) => {
      calls.push(`send:${html.length > 0 ? "html" : ""}`);
      return 42;
    },
    edit: async (id) => void calls.push(`edit:${id}`),
    typing: async () => void calls.push("typing"),
    ...over,
  };
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  return { calls, status: new StatusMessage(sink, { intervalMs: 1000, typingMs: 4000 }) };
}

test("el primer flush envía el mensaje y los siguientes lo editan (mismo id)", async () => {
  const { calls, status } = setup();
  await status.flush();
  await status.flush("otro título");
  assert.deepEqual(calls, ["send:html", "edit:42"]);
});

test("schedule junta los cambios: un solo refresco por intervalo, y no antes de que pase", async () => {
  const { calls, status } = setup();
  await status.flush(); // lastFlush = ahora
  calls.length = 0;
  status.schedule();
  status.schedule();
  status.schedule();
  mock.timers.tick(999);
  assert.deepEqual(calls, [], "todavía no pasó el intervalo");
  mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["edit:42"], "un único refresco con los tres cambios");
});

test("tras close no se programan más refrescos, pero un flush explícito (el título final) sí se escribe", async () => {
  const { calls, status } = setup();
  await status.flush();
  calls.length = 0;
  status.schedule();
  status.close();
  mock.timers.tick(5000);
  status.schedule();
  mock.timers.tick(5000);
  assert.deepEqual(calls, [], "nada se refresca solo después de cerrar");
  await status.flush("✅ Tarea completada");
  assert.deepEqual(calls, ["edit:42"]);
});

test("un fallo al enviar o editar se ignora y el siguiente refresco lo corrige", async () => {
  const log: string[] = [];
  let fail = true;
  const { status } = setup({
    send: async () => {
      log.push("send");
      if (fail) throw new Error("red");
      return 7;
    },
    edit: async (id) => void log.push(`edit:${id}`),
  });
  await status.flush();
  fail = false;
  await status.flush();
  await status.flush();
  assert.deepEqual(log, ["send", "send", "edit:7"], "el primer envío falló: se reintenta enviar, luego se edita");
});

test("las ediciones se serializan: una no empieza hasta que termina la anterior", async () => {
  const order: string[] = [];
  let release: (() => void) | undefined;
  const { status } = setup({
    send: () => new Promise<number>((resolve) => (release = () => (order.push("send listo"), resolve(1)))),
    edit: async () => void order.push("edit"),
  });
  const first = status.flush();
  const second = status.flush();
  await Promise.resolve();
  assert.deepEqual(order, [], "la segunda espera a la primera");
  release?.();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["send listo", "edit"]);
});

test("startTyping avisa al empezar y cada intervalo; stopTimers lo detiene", () => {
  const { calls, status } = setup();
  status.startTyping();
  assert.deepEqual(calls, ["typing"]);
  mock.timers.tick(8000);
  assert.equal(calls.filter((c) => c === "typing").length, 3);
  status.stopTimers();
  mock.timers.tick(20_000);
  assert.equal(calls.filter((c) => c === "typing").length, 3, "ya no avisa");
});
