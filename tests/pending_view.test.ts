/** Lo que ve la lista de pendientes (y D5 y recovery, que comparten su vista): lo hecho con la instrucción del paso, sin ids ni encabezado de ejecución; los fallos con su razón. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { CallView, PendingView } from "../src/core/ctx/index.ts";
import { renderPending } from "../src/core/render/pending.ts";
import { resultText } from "../src/core/render/shared.ts";

const call = (over: Partial<CallView>): CallView => ({
  id: "c1", stepId: "s1", route: "terminal", tool: "run_command", kind: "read", status: "ok", verdict: "approved", reason: null, failed: false, args: null, summary: null, ...over,
});
const view = (over: Partial<PendingView>): PendingView => ({ request: "Revisá mi PC", previous: [], done: [], attempts: [], userInput: [], env: [], ...over });

test("resultText: quita duración, PID, carpeta y la frase de éxito; conserva las líneas del resultado", () => {
  const raw = "status: finished · exit code: 0 · duration: 0.7s · pid: 25084 · cwd: C:\Users\Ana\nThe command finished successfully.\nName Id\nsvchost 4";
  assert.equal(resultText(raw), "Name Id\nsvchost 4");
});

test("resultText: un código de salida distinto de cero y la frase del fallo se conservan", () => {
  const raw = "status: finished · exit code: 1 · duration: 0.2s · pid: 7\nThe command failed (exit code 1).\nboom";
  assert.equal(resultText(raw), "status: finished · exit code: 1\nThe command failed (exit code 1).\nboom");
});

test("resultText: el encabezado de otra herramienta (sección, cantidad) no se toca", () => {
  const raw = "status: ok · section: processes (showing 50 of 333, sorted by memory)\nPID 4 · System";
  assert.equal(resultText(raw), raw);
});

test("DONE lleva la instrucción del paso, la herramienta y el resultado; sin ids ni read/ok/verdict", () => {
  const text = renderPending(
    view({ done: [{ instruction: "Revisar si hay virus en la PC", call: call({ args: { command: "Get-MpComputerStatus" }, summary: "status: finished · exit code: 0 · duration: 0.4s · pid: 9\nThe command finished successfully.\nAntivirusEnabled : True" }) }] }),
    { caps: BUDGET.caps },
  );
  assert.match(text, /- Revisar si hay virus en la PC → run_command \{"command":"Get-MpComputerStatus"\}\n {2}AntivirusEnabled : True/);
  assert.doesNotMatch(text, /\bc1\b|\bs1\b|verdict=|pid:|duration:/);
});

test("FAIL muestra la razón del rechazo y no el resultado leído; un error de la herramienta sí lleva su texto", () => {
  const text = renderPending(
    view({
      attempts: [
        { instruction: "Listar procesos", call: call({ verdict: "rejected", reason: "not_accomplished", failed: true, summary: "PID 4 · System · RAM 1 MB" }) },
        { instruction: "Leer el archivo", call: call({ id: "c2", tool: "read_file", status: "tool_error", verdict: "rejected", reason: "no_usable_data", failed: true, summary: "ENOENT: no such file" }) },
      ],
    }),
    { caps: BUDGET.caps },
  );
  assert.match(text, /- Listar procesos → run_command \[rejected: not_accomplished\]\n(?! {2}PID)/);
  assert.match(text, /- Leer el archivo → read_file \[tool_error\]\n {2}ENOENT: no such file/);
});
