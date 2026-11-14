import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { collectSources, precheckCall } from "../src/core/engine/precheck.ts";
import { createMemoryReader, factLines, MAX_FACTS_PER_PROMPT, parseFacts, selectFacts } from "../src/core/memory.ts";
import { PROMPTS } from "../src/core/models/prompts.ts";
import { newContext } from "./fixtures.ts";

const FACTS = parseFacts([
  { key: "carpeta jarvis", value: "C:\Users\Ana\Desktop\jarvis" },
  { key: "proyecto de facturación", value: "D:\trabajo\facturas-app" },
  { key: "mi editor de código", value: "code" },
  { key: "equipo de fútbol", value: "Rosario Central" },
]);

test("selectFacts: elige solo los hechos cuya clave aparece completa en el pedido", () => {
  const pick = (text: string) => selectFacts(text, FACTS).map((f) => f.key);
  assert.deepEqual(pick("Listar el contenido de la carpeta jarvis"), ["carpeta jarvis"]);
  assert.deepEqual(pick("Listar los archivos de mi proyecto de facturacion"), ["proyecto de facturación"]);
  assert.deepEqual(pick("Abrir mi editor de codigo"), ["mi editor de código"]);
  assert.deepEqual(pick("Buscar las últimas noticias de mi equipo de fútbol"), ["equipo de fútbol"]);
  // Pedidos ajenos: ninguna coincidencia, ningún bloque.
  assert.deepEqual(pick("Listar la carpeta proyectos de Documents"), []);
  assert.deepEqual(pick("Decime la hora"), []);
  assert.deepEqual(pick(""), []);
});

test("selectFacts: tope de hechos y claves sin palabras que distingan", () => {
  const many = parseFacts(Array.from({ length: 6 }, (_, i) => ({ key: `carpeta jarvis${i}`.replace(/\d/, ""), value: `v${i}` })));
  assert.equal(selectFacts("la carpeta jarvis", many).length, MAX_FACTS_PER_PROMPT);
  assert.deepEqual(selectFacts("lo que sea", parseFacts([{ key: "que como", value: "x" }])), []);
});

test("parseFacts: tolera formatos y descarta entradas inválidas", () => {
  assert.equal(parseFacts({ facts: [{ key: "a b", value: "c" }] }).length, 1);
  assert.equal(parseFacts([{ key: "", value: "x" }, { key: "k" }, null, 5, { key: "k", value: "v" }]).length, 1);
  assert.deepEqual(parseFacts("no es una lista"), []);
  assert.equal(parseFacts([{ key: "k", value: "x".repeat(301) }]).length, 0, "un valor enorme no entra al prompt");
});

test("createMemoryReader: archivo ausente o inválido es memoria vacía; un cambio del archivo se ve en la lectura siguiente", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-mem-"));
  const file = path.join(dir, "memory.json");
  const read = createMemoryReader(file);
  assert.deepEqual(read(), []);
  fs.writeFileSync(file, "{ no es json");
  assert.deepEqual(read(), []);
  fs.writeFileSync(file, JSON.stringify([{ key: "carpeta jarvis", value: "X" }]));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(read().length, 1);
  fs.writeFileSync(file, JSON.stringify([]));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 10_000));
  assert.equal(read().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("prompt de argumentos: el bloque MEMORY solo aparece con hechos", () => {
  const tool = { name: "list_directory", description: "List", inputSchema: { type: "object", properties: { path: { type: "string" } } } };
  const data = { tool, cleanedSchema: {}, environment: { platform: "windows", home: "C:\Users\Ana" }, view: "TASK: x" } as never;
  assert.ok(!PROMPTS.ARGUMENTS_VIEW.buildUserPrompt(data).includes("MEMORY"));
  const withFacts = PROMPTS.ARGUMENTS_VIEW.buildUserPrompt({ ...(data as object), memory: factLines(FACTS.slice(0, 1)) } as never);
  assert.ok(withFacts.includes("MEMORY") && withFacts.includes("- carpeta jarvis: C:\Users\Ana\Desktop\jarvis"));
});

test("pre-chequeo: una ruta que viene de un hecho tiene origen solo si el hecho es fuente (DN-1.10)", async () => {
  const ctx = newContext("reactive");
  const env = { platform: "windows", home: "C:\Users\Ana", desktop: "C:\Users\Ana\Desktop" } as never;
  const args = { path: "D:\trabajo\facturas-app" };
  const without = await precheckCall({ tool: "list_directory", kind: "read", args, sources: collectSources(ctx), environment: env });
  assert.equal(without?.review, "args_invalid", "sin el hecho, la ruta se rechaza como inventada");
  const withFact = await precheckCall({ tool: "list_directory", kind: "read", args, sources: collectSources(ctx, ["D:\trabajo\facturas-app"]), environment: env });
  assert.equal(withFact, null);
});
