/**
 * Sondas de `run_command` con PowerShell real. No son pruebas (no afirman nada): ejecutan casos límite y muestran qué devuelve la tool, para mirarlos a ojo.
 * Solo Windows. No usa red ni modelos.
 *
 *   npx tsx scripts/validate/run_command_probe.ts          # los casos de siempre
 *   npx tsx scripts/validate/run_command_probe.ts --big    # además, 300 000 líneas de salida (~12 s)
 *
 * Qué mira cada caso está en `docs/REVISION_run_command.md` (hallazgos RC-xx).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readToolResult } from "../../src/core/tools/result.ts";
import { TerminalProvider } from "../../src/tools/terminal/terminalProvider.ts";

if (process.platform !== "win32") {
  console.error("run_command solo funciona en Windows.");
  process.exit(1);
}

const provider = new TerminalProvider({ defaultCwd: os.tmpdir() });
let counter = 0;
const newTask = (): string => `probe_${++counter}`;

interface Shown {
  readonly state: unknown;
  readonly exitCode: unknown;
  readonly pid: unknown;
  readonly raw: string;
  readonly text: string;
  readonly taskId: string;
}

async function run(label: string, args: Record<string, unknown>, taskId = newTask()): Promise<Shown> {
  const started = Date.now();
  const result = await provider.callTool("run_command", args, { taskId });
  const native = readToolResult(result);
  if (native === null) throw new Error(`'${label}': el resultado no es nativo`);
  console.log(`\n### ${label} (${Date.now() - started} ms) isError=${result.isError === true}`);
  console.log(`    state=${String(native.data.state)} exit=${String(native.data.exitCode)} pid=${String(native.data.pid)} prompt=${JSON.stringify(native.data.prompt ?? null)} rawLen=${native.raw.length}`);
  console.log(`    raw: ${JSON.stringify(native.raw.slice(0, 160))}`);
  return { state: native.data.state, exitCode: native.data.exitCode, pid: native.data.pid, raw: native.raw, text: native.text, taskId };
}

const big = process.argv.includes("--big");
const accentedDir = fs.mkdtempSync(path.join(os.tmpdir(), "carpeta con ñ y espacios "));

try {
  console.log("===== Codificación (RC-10) =====");
  await run("cmd /c echo con acentos", { command: 'cmd /c "echo ñandú áéíóú ü"' });
  await run("ipconfig (mensajes nativos de Windows: salen en la página OEM 850)", { command: "ipconfig | Select-Object -First 4" });
  await run("chcp", { command: "[Console]::OutputEncoding.CodePage; chcp" });
  await run("node escribe UTF-8", { command: `node -e "console.log('añ ü €')"` });
  await run("emoji fuera del plano básico", { command: "[char]::ConvertFromUtf32(0x1F600) + ' fin'" });
  await run("colores ANSI", { command: '[char]27 + "[31mrojo" + [char]27 + "[0m normal"' });

  console.log("\n===== Errores =====");
  await run("programa inexistente", { command: "programa_que_no_existe_xyz --flag" });
  await run("Write-Error: el texto del error trae el script entero (RC-11)", { command: "Write-Error 'boom'; Write-Output 'sigue'" });
  await run("-Confirm: PowerShell sin interacción falla en el acto (RC-03)", { command: "New-Item -ItemType Directory -Path (Join-Path $env:TEMP 'jv_conf_x') -Confirm", timeoutSec: 5 });

  console.log("\n===== Entrada y prompts (RC-01, RC-02) =====");
  const stdin = await run("node lee stdin sin mostrar prompt: queda running", {
    command: `node -e "process.stdin.on('data',d=>{console.log('got:'+d.toString().trim());process.exit(0)})"`,
    timeoutSec: 2,
  });
  if (stdin.state === "running") await run("…y se le responde con { pid, input }", { pid: stdin.pid, input: "hola", timeoutSec: 10 }, stdin.taskId);
  await run("findstr lee stdin hasta el final: queda running", { command: "findstr x", timeoutSec: 2 });
  const pause = await run("cmd /c pause: waiting_input", { command: "cmd /c pause", timeoutSec: 10 });
  if (pause.state === "waiting_input") await run("…respuesta vacía", { pid: pause.pid, input: "", timeoutSec: 10 }, pause.taskId);
  await run("FALSO POSITIVO: progreso sin salto de línea y una pausa de 3 s", { command: "Write-Host -NoNewline 'progreso...'; Start-Sleep 3; Write-Host ' listo'", timeoutSec: 10 });

  console.log("\n===== Procesos en segundo plano (RC-05) =====");
  const server = await run("servidor HTTP de node: running", {
    command: `node -e "require('http').createServer((q,r)=>r.end('ok')).listen(8765,()=>console.log('escuchando'))"`,
    timeoutSec: 3,
  });
  await run("continuar el servidor", { pid: server.pid, timeoutSec: 1 }, server.taskId);
  await provider.onTaskEnd(server.taskId, "failed");
  console.log("    (la tarea falló: el árbol del servidor se cerró)");

  console.log("\n===== Límites y entorno =====");
  await run("cwd con tildes y espacios", { command: "(Get-Location).Path", cwd: accentedDir });
  await run("comando de 3990 caracteres", { command: `Write-Output '${"a".repeat(3960)}'` });
  await run("línea enorme sin salto de línea (400 000 caracteres): no es un prompt", { command: "[Console]::Out.Write('x' * 400000)", timeoutSec: 20 });
  await run("entorno heredado (RC-16)", { command: "if ($env:PATH) { 'PATH visible' }; $env:USERNAME" });
  if (big) {
    const started = Date.now();
    const huge = await run("300 000 líneas (el cuello es PowerShell)", { command: "1..300000 | ForEach-Object { 'linea ' + $_ }", timeoutSec: 120 });
    console.log(`    tamaño de raw: ${huge.raw.length} caracteres, ${Date.now() - started} ms`);
  }
} finally {
  await provider.close();
  fs.rmSync(accentedDir, { recursive: true, force: true });
  process.exit(0);
}
