/** Voz: limpieza, partición y extracto del texto para TTS, y la ruta `POST /api/jarvis/tts` contra un servidor de voz falso. */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import express from "express";

import type { DiscoveryEngine } from "../src/core/mcp/discovery.ts";
import type { TaskManager } from "../src/core/tasks.ts";
import { createJarvisRouter } from "../src/server/jarvisRouter.ts";
import { localOnly } from "../src/server/localOnly.ts";
import { cleanForSpeech, speechExcerpt, splitForSpeech } from "../src/voice/tts.ts";

test("cleanForSpeech quita código, enlaces y marcas de Markdown", () => {
  const out = cleanForSpeech("## Título\n- **hola** `x`\n```js\nconsole.log(1)\n```\n[sitio](https://a.b)");
  assert.equal(out.includes("```"), false);
  assert.equal(out.includes("console"), false);
  assert.ok(out.includes("Título") && out.includes("hola") && out.includes("sitio"));
  assert.equal(/[*#`\[\]]/.test(out), false);
});

test("splitForSpeech respeta el tope y no pierde texto", () => {
  const text = Array.from({ length: 50 }, (_, i) => `Frase número ${i}.`).join(" ");
  const parts = splitForSpeech(text, 100);
  assert.ok(parts.length > 1 && parts.every((p: string) => p.length <= 100));
  assert.equal(parts.join(" "), text);
  assert.ok(splitForSpeech("x".repeat(250), 100).every((p: string) => p.length <= 100));
});

test("speechExcerpt corta en una frase entera y siempre devuelve algo", () => {
  const text = "Primera frase. Segunda frase. Tercera frase.";
  assert.equal(speechExcerpt(text, 30), "Primera frase. Segunda frase.");
  assert.equal(speechExcerpt(text, 1000), text);
  assert.equal(speechExcerpt("Una frase muy larga que no entra.", 5), "Una frase muy larga que no entra.");
  assert.equal(speechExcerpt("```js\ncodigo\n```", 100), "");
});

// --- POST /api/jarvis/tts con un servidor TTS falso ---
let tts: http.Server;
let app: http.Server;
let appPort = 0;
let voiceOn = true;
let ttsUrl = "";
const asked: string[] = [];

before(async () => {
  tts = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { input } = JSON.parse(body) as { input: string };
      asked.push(input);
      if (input.includes("falla")) return void res.writeHead(500).end("boom");
      res.writeHead(200, { "Content-Type": "audio/L16" });
      res.end(Buffer.from([1, 0, 2, 0]));
    });
  });
  await new Promise<void>((r) => tts.listen(0, "127.0.0.1", r));
  ttsUrl = `http://127.0.0.1:${(tts.address() as AddressInfo).port}`;

  const a = express();
  a.use(express.json());
  a.use(localOnly());
  a.use("/api/jarvis", createJarvisRouter({} as TaskManager, {} as DiscoveryEngine, () => (voiceOn ? { voice: "default", baseUrl: ttsUrl } : null)));
  app = http.createServer(a);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  appPort = (app.address() as AddressInfo).port;
});

after(() => {
  tts.close();
  app.close();
});

async function postTts(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${appPort}/api/jarvis/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("/tts devuelve el audio PCM del servidor de voz", async () => {
  const res = await postTts({ text: "Hola mundo." });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /audio\/L16/);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 0, 2, 0]);
  assert.deepEqual(asked, ["Hola mundo."]);
});

test("/tts valida la entrada, la voz apagada y los fallos del servidor de voz", async () => {
  assert.equal((await postTts({})).status, 400);
  assert.equal((await postTts({ text: "x".repeat(20001) })).status, 400);
  assert.equal((await postTts({ text: "esto falla" })).status, 502);
  voiceOn = false;
  assert.equal((await postTts({ text: "hola" })).status, 503);
  voiceOn = true;
});
