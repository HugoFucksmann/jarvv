/**
 * Sondas de `run_command` con PowerShell real. No son pruebas (no afirman nada): ejecutan casos límite y muestran qué devuelve la tool, para mirarlos a ojo.
 * Solo Windows. No usa red ni modelos.
 *
 *   npx tsx scripts/validate/run_command_probe.ts          # los casos de siempre
 *   npx tsx scripts/validate/run_command_probe.ts --big    # además, 300 000 líneas de salida (~12 s)
 *
 * Qué mira cada caso está en `docs/REVISION_run_command.md` (hallazgos RC-xx). Actualizada el 2026-11-11 con lo que cambió en la revisión: tildes de las
 * herramientas del sistema por la tubería de PowerShell, Python en UTF-8, `Read-Host` y `pause` respondibles, `python -i`, barras de progreso que se reescriben (retorno de carro),
 * prompts por clases (un avance que se detiene ya no es un prompt) y una tubería cortada que no deja vivo al programa.
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
  await run("ipconfig directo (página OEM: lo decodifica Node)", { command: "ipconfig | Select-Object -First 4" });
  await run("ipconfig por la tubería de PowerShell (envoltorio)", { command: "ipconfig | Select-String 'IP'" });
  await run("asignado a una variable (envoltorio)", { command: "$x = ipconfig; $x | Select-Object -First 3" });
  await run("chcp (página ANSI 1252)", { command: "[Console]::OutputEncoding.CodePage; chcp" });
  await run("Python escribe UTF-8 (PYTHONIOENCODING)", { command: `python -c "print('añ €')"` });
  await run("ping -t cortado por Select-Object: termina y no deja ping vivo", { command: "ping -t 127.0.0.1 | Select-Object -First 3", timeoutSec: 15 });
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
  await run("antes FALSO POSITIVO: progreso sin salto de línea y una pausa de 3 s (ahora finished)", { command: "Write-Host -NoNewline 'progreso...'; Start-Sleep 3; Write-Host ' listo'", timeoutSec: 10 });
  await run("barra de progreso que se reescribe: queda la última versión", { command: "1..3 | % { Write-Host -NoNewline (\"`r{0}%\" -f ($_*33)); Start-Sleep -Milliseconds 200 }; Write-Host ''" });
  const readHost = await run("Read-Host: waiting_input", { command: "$n = Read-Host 'Tu nombre'; \"hola $n\"", timeoutSec: 10 });
  if (readHost.state === "waiting_input") await run("…respuesta con tildes", { pid: readHost.pid, input: "Ñandú €", timeoutSec: 10 }, readHost.taskId);
  const repl = await run("python -i (REPL sin PTY): waiting_input con >>>", { command: "python -i -q", timeoutSec: 10 });
  if (repl.state === "waiting_input") {
    await run("…una línea de código", { pid: repl.pid, input: "print(6*7)", timeoutSec: 10 }, repl.taskId);
    await run("…salir", { pid: repl.pid, input: "exit()", timeoutSec: 10 }, repl.taskId);
  }

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
  await run("comando de 990 caracteres", { command: `Write-Output '${"a".repeat(960)}'` });
  await run("comando de 1001 caracteres: error (el tope es el del manifiesto, RC-19)", { command: `Write-Output '${"a".repeat(971)}'` });
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
