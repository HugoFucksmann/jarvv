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

const caso = (id: string, route: string, request: string, tool: string, inputSchema: unknown, expect: unknown) =>
  JSON.stringify({ id, stage: "arguments", scenario: { mode: "reactive", request, steps: [{ state: "running", instruction: request }], at: { route, tool, inputSchema, environment: ENV } }, expect });

const CMD_SCHEMA = { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command", "timeout_ms"] };


const CASOS = [
  caso("cmd", "terminal", "lista los 10 procesos que mas ram consuman", "run_command", CMD_SCHEMA, {
    requiredFields: ["command", "timeout_ms"],
    forbiddenHardcodedValues: ["ps aux", "head -n"],
  }),
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
