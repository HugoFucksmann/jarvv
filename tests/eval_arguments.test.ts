/**
 * Etapa `arguments` del eval, de punta a punta (carga del escenario → request → parseo → graders → pre-chequeo → pass).
 * Un modelo simulado devuelve argumentos buenos y malos: los malos DEBEN fallar. Si alguno pasa, el eval deja de detectar ese defecto.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createDecisionClient } from "../eval/core/client/decision.ts";
import { createMockGenerativeClient } from "../eval/core/client/mock.ts";
import { parseConfig } from "../eval/core/config.ts";
import { loadDatasets } from "../eval/core/datasets.ts";
import { runDataset } from "../eval/core/runner.ts";
import type { RunRecord } from "../eval/core/types.ts";
import { loadVariant } from "../eval/core/variants/load.ts";
import { ArgumentsGrader } from "../eval/core/graders/arguments.ts";
import { createCollector } from "../eval/core/graders/common.ts";

const ENV = { home: "C:\\Users\\hugof", desktop: "C:\\Users\\hugof\\Desktop", documents: "C:\\Users\\hugof\\Documents", downloads: "C:\\Users\\hugof\\Downloads" };
const DOC = "C:\\Users\\hugof\\Documents\\informe.txt";
const INVENTADA = "C:\\Users\\hugof\\Documents\\inventado.txt";

const caso = (id: string, route: string, request: string, tool: string, inputSchema: unknown, expect: unknown) =>
  JSON.stringify({ id, stage: "arguments", scenario: { mode: "reactive", request, steps: [{ state: "running", instruction: request }], at: { route, tool, inputSchema, environment: ENV } }, expect });

const CMD_SCHEMA = { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command", "timeout_ms"] };
const READ_SCHEMA = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };

// Herramienta de LECTURA: el pre-chequeo exige que la ruta salga de la tarea (en una escritura, crear una ruta nueva es legítimo).
const REF_SCHEMA = { type: "object", properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path", "encoding"] };

const refFile = join(mkdtempSync(join(tmpdir(), "eval-ref-")), "resultado.txt");
writeFileSync(refFile, "contenido guardado de la búsqueda");

/** Escenario con una llamada previa que dejó la ref r1 (la única que existe). */
const conRef = (id: string) =>
  JSON.stringify({
    id,
    stage: "arguments",
    scenario: {
      mode: "reactive",
      request: `lee ${DOC} y úsalo con el resultado de la búsqueda`,
      steps: [{ state: "running", instruction: `leer ${DOC}` }],
      calls: [{ route: "web", tool: "web_search", status: "ok", summary: "resultado largo guardado aparte", ref: { label: "búsqueda", size: 5000, where: refFile } }],
      at: { route: "files", tool: "read_file", inputSchema: REF_SCHEMA, environment: ENV },
    },
    expect: { requiredFields: ["path", "encoding"] },
  });

const CASOS = [
  conRef("con_ref"),
  caso("cmd", "terminal", "lista los 10 procesos que mas ram consuman", "run_command", CMD_SCHEMA, {
    requiredFields: ["command", "timeout_ms"],
    forbiddenHardcodedValues: ["ps aux", "head -n"],
  }),
  caso("leer", "files", `lee el archivo ${DOC}`, "read_file", READ_SCHEMA, { requiredFields: ["path"], exactFieldValues: { path: DOC } }),
  // Sin `exactFieldValues`: aquí solo el pre-chequeo puede rechazar una ruta inventada.
  caso("leer_libre", "files", `lee el archivo ${DOC}`, "read_file", READ_SCHEMA, { requiredFields: ["path"] }),
];

const dir = mkdtempSync(join(tmpdir(), "eval-args-"));
writeFileSync(join(dir, "args.jsonl"), `${CASOS.join("\n")}\n`);

async function correr(id: string, salida: string): Promise<RunRecord> {
  const variant = await loadVariant("prod");
  const [ds] = loadDatasets([join(dir, "args.jsonl")], { ids: [id] }, variant);
  // `client=real`: es el único modo en que corre el pre-chequeo; el modelo es el simulado.
  const cfg = parseConfig(["--client=real", "--concurrency=1"]);
  const { records } = await runDataset({
    cases: ds.cases,
    datasetName: "args",
    variant,
    variantSpec: "prod",
    cfg,
    genClient: createMockGenerativeClient({ url: cfg.url, model: cfg.model }, () => salida),
    decClient: createDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }),
    stageFilter: ["arguments"],
  });
  assert.equal(records.length, 1);
  return records[0];
}

const buenos: Array<[string, string]> = [
  ["cmd", JSON.stringify({ command: "Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 10", timeout_ms: 30000 })],
  ["leer", JSON.stringify({ path: DOC })],
  ["leer_libre", JSON.stringify({ path: DOC })],
  ["con_ref", JSON.stringify({ path: DOC, encoding: "{{ref:r1}}" })],
];

for (const [id, salida] of buenos) {
  test(`arguments: salida correcta pasa (${id})`, async () => {
    const r = await correr(id, salida);
    assert.equal(r.passed, true, r.errors.join(" | "));
  });
}

const malos: Array<[string, string, string]> = [
  ["cmd", "falta un campo requerido", JSON.stringify({ command: "Get-Process" })],
  ["cmd", "tipo equivocado (timeout_ms texto)", JSON.stringify({ command: "Get-Process", timeout_ms: "mucho" })],
  ["cmd", "comando de Linux prohibido", JSON.stringify({ command: "ps aux | head -n 10", timeout_ms: 30000 })],
  ["cmd", "comando vacío", JSON.stringify({ command: "", timeout_ms: 30000 })],
  ["cmd", "marcador N/A", JSON.stringify({ command: "N/A", timeout_ms: 30000 })],
  ["cmd", "sintaxis PowerShell inválida", JSON.stringify({ command: "Get-Process | Sort-Object -Property {", timeout_ms: 30000 })],
  ["cmd", "comando que no existe", JSON.stringify({ command: "Obtener-Procesos-Inventado -Top 10", timeout_ms: 30000 })],
  ["cmd", "no es JSON", "claro, aquí tienes el comando: Get-Process"],
  ["cmd", "salida vacía", ""],
  ["leer", "ruta inventada que no sale de la solicitud", JSON.stringify({ path: INVENTADA })],
  ["leer", "ruta distinta de la exacta esperada", JSON.stringify({ path: "C:\\Users\\hugof\\Documents\\otro.txt" })],
  ["leer_libre", "ruta inventada: solo la detecta el pre-chequeo", JSON.stringify({ path: INVENTADA })],
  ["con_ref", "ref inventada (no existe en el escenario, sin allowedRefTokens)", JSON.stringify({ path: DOC, encoding: "{{ref:r9}}" })],
  ["con_ref", "ref inventada dentro de un texto", JSON.stringify({ path: DOC, encoding: "resumen: {{ref:r7}}" })],
  ["con_ref", "ruta inventada junto a una ref válida (el resto se sigue comprobando)", JSON.stringify({ path: INVENTADA, encoding: "{{ref:r1}}" })],
  ["leer", "ruta de otro usuario", JSON.stringify({ path: "C:\\Users\\ana\\Documents\\informe.txt" })],
];

for (const [id, motivo, salida] of malos) {
  test(`arguments: DEBE fallar — ${motivo} (${id})`, async () => {
    const r = await correr(id, salida);
    assert.equal(r.passed, false, `el eval aprobó una salida mala (${motivo}): ${salida}`);
    assert.ok(r.errors.length > 0, "falló sin registrar ningún error");
  });
}

// ───────────── Grader `requiredFields` ─────────────

function grade(args: Record<string, unknown>, requiredFields: string[]): { ok: boolean; errors: string[] } {
  const { collector, errors } = createCollector();
  ArgumentsGrader.grade({ args }, { requiredFields }, { rawOutput: "", durationMs: 0 }, collector);
  return { ok: errors.length === 0, errors };
}

test("requiredFields: un string vacío o en blanco NO cuenta como presente", () => {
  assert.equal(grade({ path: "" }, ["path"]).ok, false);
  assert.equal(grade({ path: "   " }, ["path"]).ok, false);
  assert.equal(grade({ command: " 	 " }, ["command"]).ok, false);
  assert.equal(grade({ path: DOC }, ["path"]).ok, true);
});

test("requiredFields: content/text/data/body/input pueden ir vacíos a propósito (como en producción)", () => {
  assert.equal(grade({ path: DOC, content: "" }, ["path", "content"]).ok, true);
  assert.equal(grade({ input: "" }, ["input"]).ok, true);
});
