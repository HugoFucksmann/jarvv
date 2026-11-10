/** Transporte MCP por stdio, contra un servidor de mentira: ida y vuelta, mensajes partidos, timeout, proceso caído y arranque fallido. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { StdioMcpTransport } from "../src/core/mcp/transport.ts";

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
