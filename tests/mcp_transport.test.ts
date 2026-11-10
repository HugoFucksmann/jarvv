/** Transporte MCP por stdio, contra un servidor de mentira: ida y vuelta, mensajes partidos, timeout, proceso caído y arranque fallido. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { needsShell, StdioMcpTransport } from "../src/core/mcp/transport.ts";

const SERVER = path.resolve("tests/helpers/fake_mcp_server.mjs");
const make = (timeoutMs = 5000) => new StdioMcpTransport("fake", { command: "node", args: [SERVER] }, () => timeoutMs);
const text = (result: unknown): string => (result as { content: { text: string }[] }).content[0].text;

test("handshake, listTools y callTool; una respuesta partida a mitad de un carácter UTF-8 llega entera", async () => {
  const transport = make();
  try {
    assert.deepEqual((await transport.listTools()).map((tool) => tool.name), ["echo"]);
    assert.equal(text(await transport.callTool("echo", { text: "hola" })), "hola");
    assert.equal(text(await transport.callTool("split", { text: "año" })), "año");
    assert.ok(transport.isConnected());
  } finally {
    await transport.close();
  }
  assert.equal(transport.isConnected(), false);
});

test("una llamada sin respuesta vence por timeout y el transporte sigue sirviendo las siguientes", async () => {
  const transport = make(400);
  try {
    await assert.rejects(transport.callTool("slow", {}), /Timeout de 400ms/);
    assert.equal(text(await transport.callTool("echo", { text: "sigue" })), "sigue");
  } finally {
    await transport.close();
  }
});

test("si el proceso muere con una llamada en vuelo, se rechaza al instante (sin esperar el timeout) y reconnect() vuelve a servir", async () => {
  const transport = make(20000);
  try {
    const started = Date.now();
    await assert.rejects(transport.callTool("die", {}), /terminó/);
    assert.ok(Date.now() - started < 5000, "no debe esperar al timeout");
    await transport.reconnect();
    assert.equal(text(await transport.callTool("echo", { text: "otra vez" })), "otra vez");
  } finally {
    await transport.close();
  }
});

test("un servidor que no arranca queda como fallo permanente (no se relanza en cada llamada)", async () => {
  const transport = new StdioMcpTransport("roto", { command: "node", args: ["--eval", "process.exit(1)"] }, () => 3000);
  await assert.rejects(transport.listTools());
  assert.ok(transport.getPermanentFailure() !== null);
  await assert.rejects(transport.callTool("echo", {}), /terminó|Transport Error/);
  await transport.close();
});

test("shell solo para scripts .cmd/.bat de Windows: node y uvx (.exe) se lanzan directo y sin Windows no hay shell", () => {
  const present = new Set([String.raw`c:\bin\node.exe`, String.raw`c:\bin\uvx.exe`, String.raw`c:\npm\npx.cmd`, String.raw`c:\npm\npx.ps1`]);
  const env = { platform: "win32", path: String.raw`C:\bin;C:\npm`, pathExt: ".COM;.EXE;.BAT;.CMD", exists: (file: string) => present.has(file.toLowerCase()) };
  assert.equal(needsShell("node", env), false);
  assert.equal(needsShell("uvx", env), false);
  assert.equal(needsShell("npx", env), true);
  assert.equal(needsShell(String.raw`C:\npm\npx.cmd`, env), true);
  assert.equal(needsShell(String.raw`C:\bin\node.exe`, env), false);
  assert.equal(needsShell("inexistente", env), false);
  assert.equal(needsShell("npx", { ...env, platform: "linux" }), false);
});
