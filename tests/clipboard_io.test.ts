/** `runPowerShellIo` (portapapeles): lee la salida de PowerShell con un tope; más allá es un error, no un texto cortado ni memoria sin límite. Solo en Windows. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_CLIPBOARD_READ_BYTES, runPowerShellIo } from "../src/tools/system/clipboard.ts";

const onWindows = process.platform === "win32";

test("una lectura dentro del tope devuelve el texto", { skip: !onWindows }, async () => {
  assert.equal(await runPowerShellIo("[Console]::Out.Write('hola')", undefined, 20_000), "hola");
});

test("una lectura que supera el tope falla y corta el proceso", { skip: !onWindows }, async () => {
  const bytes = MAX_CLIPBOARD_READ_BYTES + 1_000_000;
  await assert.rejects(runPowerShellIo(`[Console]::Out.Write(('x' * ${bytes}))`, undefined, 30_000), /too large to read/);
});
