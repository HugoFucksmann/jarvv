/**
 * `run_command` (proveedor nativo `jarvis_terminal`): procesos reales de PowerShell. Código de salida real, salida completa, prompts, plazos,
 * continuación por `pid`, cancelación, cierre del árbol y validaciones. Solo Windows.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { applyDestination, argCapsOf, repeatPolicyOf, SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import {
  cleanTerminalText,
  codePageDecoder,
  LineAssembler,
  legacyDecoder,
  MAX_OPEN_LINE,
  OutputBuffer,
  OutputDecoder,
  stripAnsi,
  UNREAD_HEAD_CAP,
  UNREAD_TAIL_CAP,
} from "../src/tools/terminal/output.ts";
import { ensureHelpersFile, helpersSource, LEGACY_TOOLS, PS_HELPERS } from "../src/tools/terminal/powershell.ts";
import { classifyPrompt, promptIdleMs } from "../src/tools/terminal/prompts.ts";
import { buildCommandLine, buildScript, EPILOGUE, MAX_COMMAND_CHARS, PROLOGUE, TerminalProvider } from "../src/tools/terminal/terminalProvider.ts";
import type { MCPCallResult } from "../src/core/types.ts";

const windows = process.platform === "win32";
const provider = new TerminalProvider({ defaultCwd: os.tmpdir() });
after(async () => {
  await provider.close();
});

let counter = 0;
const nextTask = (): string => `task_${++counter}`;
const run = (args: Record<string, unknown>, taskId: string, extra: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<MCPCallResult> =>
  provider.callTool("run_command", args, { taskId, ...extra });
const read = (result: MCPCallResult) => {
  const native = readToolResult(result);
  assert.ok(native, "el resultado debe ser nativo");
  return native;
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
};

// ───────────────────────── Salida (sin procesos) ─────────────────────────

test("cleanTerminalText: sin colores, con los retrocesos aplicados y sin caracteres de control sueltos", () => {
  assert.equal(stripAnsi("\u001b[31mrojo\u001b[0m y \u001b[2K\u001b[1Gfin"), "rojo y fin");
  assert.equal(cleanTerminalText("\u001b[32mok\u001b[0m"), "ok");
  assert.equal(cleanTerminalText("cargando |\b/\b-\b\\ listo"), "cargando \\ listo", "un indicador giratorio deja su último carácter");
  assert.equal(cleanTerminalText("a\u0000b\u0007c\td\ne\r"), "abc\td\ne\r", "se conservan \\t, \\n y \\r");
});

test("LineAssembler: un \\r\\n partido es un salto, un \\r suelto reescribe la línea y la línea abierta se retiene hasta su salto", () => {
  const a = new LineAssembler();
  assert.equal(a.push("a\r") + a.push("\nb\nc"), "a\nb\n");
  assert.equal(a.current, "c");
  assert.equal(a.end(), "c");

  const bar = new LineAssembler();
  assert.equal(bar.push("bajando 10%\rbajando 50%\rbajando 100%\n"), "bajando 100%\n", "la barra de progreso queda en su última versión");
  assert.equal(bar.lastCompleted, "bajando 100%");

  const prompt = new LineAssembler();
  assert.equal(prompt.push("Tu nombre: "), "");
  assert.equal(prompt.flushPartial(), "Tu nombre: ");
  assert.equal(prompt.push("Ana\n"), "Ana\n", "lo ya entregado no se repite");
  assert.equal(prompt.push("10%"), "");
  assert.equal(prompt.flushPartial(), "10%");
  assert.equal(prompt.push("\r20%\n"), "\n20%\n", "lo reescrito después de entregar una parte va en otra línea");

  const long = new LineAssembler();
  assert.equal(long.push("x".repeat(MAX_OPEN_LINE + 5)).length, MAX_OPEN_LINE + 5, "una línea sin salto enorme no se retiene sin tope");
  assert.equal(long.currentIsLong, true);
  long.push("y\n");
  assert.equal(long.currentIsLong, false);
});

test("OutputDecoder: UTF-8 tal cual (aunque llegue partido) y las líneas OEM o ANSI con la página que da letras", () => {
  const decoder = new OutputDecoder(legacyDecoder(850, 1252));
  const utf8 = Buffer.from("ñandú € 😀\n", "utf8");
  assert.equal(decoder.write(utf8.subarray(0, 2)) + decoder.write(utf8.subarray(2, 9)) + decoder.write(utf8.subarray(9)) + decoder.end(), "ñandú € 😀\n");
  assert.equal(decoder.legacyChunks, 0);

  // `ipconfig` en la página 850: "Configuración IP" (ó = 0xA2) y "inalámbrica" (á = 0xA0).
  const oem = Buffer.from([...Buffer.from("Configuraci"), 0xa2, ...Buffer.from("n IP\r\nLAN inal"), 0xa0, ...Buffer.from("mbrica\r\n")]);
  assert.equal(decoder.write(oem), "Configuración IP\r\nLAN inalámbrica\r\n");
  // `chcp` en la página 1252: "Página de códigos" (á = 0xE1, ó = 0xF3).
  const ansi = Buffer.from([...Buffer.from("P"), 0xe1, ...Buffer.from("gina de c"), 0xf3, ...Buffer.from("digos\r\n")]);
  assert.equal(decoder.write(ansi), "Página de códigos\r\n");
  // Una línea OEM y otra UTF-8 en el mismo fragmento: cada una con lo suyo.
  assert.equal(decoder.write(Buffer.concat([Buffer.from([0x61, 0xa2, 0x0a]), Buffer.from("€\n", "utf8")])), "aó\n€\n");
  assert.ok(decoder.legacyChunks > 0);
  assert.equal(codePageDecoder(9999), null, "una página desconocida no se inventa");
});

test("classifyPrompt: lo que parece una pregunta necesita menos silencio; un avance no es un prompt", () => {
  const idle = { prompt: 1, weak: 2, terminated: 3 };
  const cases: Array<[string, boolean, string]> = [
    ["Tu nombre: ", false, "likely"],
    [">>> ", false, "likely"],
    ["¿Continuar? ", false, "strong"],
    ["Valor? ", false, "likely"],
    ["Elija una opción [1-3]", false, "likely"],
    ["Overwrite file? [y/N] ", false, "strong"],
    ["¿Desea continuar? (S/N)", true, "strong"],
    ["Presione una tecla para continuar . . . ", false, "strong"],
    ["Press any key to continue", true, "strong"],
    ["Contraseña", false, "strong"],
    ["Ingrese un valor", false, "weak"],
    ["progreso...", false, "none"],
    ["Descargando 45%", false, "none"],
    ["[#####     ]", false, "none"],
    ["empiezo", true, "none"],
    ["Tu nombre:", true, "none"],
    ["", false, "none"],
    ["x".repeat(400) + ":", false, "none"],
  ];
  for (const [line, terminated, kind] of cases) assert.equal(classifyPrompt(line, terminated), kind, JSON.stringify(line));
  assert.equal(promptIdleMs("likely", false, idle), 1);
  assert.equal(promptIdleMs("weak", false, idle), 2);
  assert.equal(promptIdleMs("strong", true, idle), 3);
  assert.equal(promptIdleMs("likely", true, idle), null);
  assert.equal(promptIdleMs("none", false, idle), null);
});

test("OutputBuffer: conserva el inicio y el final de lo no leído, cuenta lo omitido y se vacía al leer", () => {
  const buffer = new OutputBuffer();
  buffer.append("hola ");
  buffer.append("mundo");
  assert.deepEqual(buffer.take(), { text: "hola mundo", omitted: 0 });
  assert.deepEqual(buffer.take(), { text: "", omitted: 0 });

  const total = UNREAD_HEAD_CAP + UNREAD_TAIL_CAP * 2 + 12345;
  const piece = "x".repeat(100_000);
  for (let n = 0; n < total; n += piece.length) buffer.append(piece);
  buffer.append("FINAL");
  const taken = buffer.take();
  assert.ok(taken.omitted > 0);
  assert.match(taken.text, /omitidos: \d+ caracteres/);
  assert.ok(taken.text.endsWith("FINAL"));
  assert.ok(taken.text.length < UNREAD_HEAD_CAP + UNREAD_TAIL_CAP + 100);
});

test("el script: el comando va tal cual y el cálculo del código de salida en otra línea (un comentario final no lo anula); la línea de comandos lleva el script en base64", () => {
  const lines = buildScript("Get-Date # comentario").split("\n");
  assert.deepEqual(lines, ["Get-Date # comentario", EPILOGUE]);

  const commandLine = buildCommandLine("Write-Output 'con \"comillas\" y \\ barras'");
  assert.ok(commandLine.startsWith(PROLOGUE));
  assert.doesNotMatch(commandLine, /comillas|barras/, "el comando no viaja en claro: no hay nada que escapar");
  assert.ok(!commandLine.includes('"'), "sin comillas dobles que rompan la línea de comandos");
  assert.ok(commandLine.endsWith("& ([scriptblock]::Create('script'))"), "el comando corre como la función `script`");
  assert.ok(commandLine.includes("JARVIS_TERMINAL_HELPERS") && !buildCommandLine("x", { helpers: false }).includes("JARVIS_TERMINAL_HELPERS"), "las ayudas se leen de un archivo, no viajan en la línea");
  assert.ok(helpersSource(false).length < helpersSource(true).length && helpersSource(false).includes("Read-Host"), "sin envoltorios, las ayudas son solo Read-Host");
  assert.ok(commandLine.length + MAX_COMMAND_CHARS * 3 < 32_000, "la línea de comandos de Windows tiene un tope de 32 767 caracteres");
  assert.ok(LEGACY_TOOLS.includes("ipconfig") && !PS_HELPERS.includes("`"), "las ayudas no usan acentos graves (van en una plantilla)");
});

test("el tope de largo de command es el mismo con el que el manifiesto lo registra: lo que se ejecuta es lo que ven el usuario y los modelos", () => {
  assert.equal(MAX_COMMAND_CHARS, argCapsOf("jarvis_terminal", "run_command").command);
});

test("el manifiesto expone exactamente los parámetros que declara el proveedor, para sus tres herramientas", async () => {
  const tools = await provider.listTools();
  const offered = applyDestination("terminal", tools);
  assert.deepEqual(offered.map((t) => t.name), ["run_command", "list_processes", "stop_process"]);
  for (const tool of offered) {
    const d = SYSTEM_TOOL_MANIFEST.find((m) => m.name === tool.name);
    assert.ok(d, tool.name);
    assert.equal(d.server, provider.name);
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [...(d.params ?? [])].sort(), tool.name);
  }
  assert.equal(SYSTEM_TOOL_MANIFEST.find((m) => m.name === "list_processes")?.policy.requiresApproval, false, "listar es una lectura");
  assert.equal(SYSTEM_TOOL_MANIFEST.find((m) => m.name === "stop_process")?.policy.requiresApproval, true, "cortar un proceso se confirma");
  const def = SYSTEM_TOOL_MANIFEST.find((d) => d.name === "run_command");
  assert.ok(def);
  assert.equal(def.policy.requiresApproval, true);
  assert.equal(def.policy.repeat, "strict");
  assert.equal(repeatPolicyOf(def.server, def.name, { command: "Get-Date" }), "strict", "repetir un comando idéntico pudo duplicar sus efectos");
  assert.equal(repeatPolicyOf(def.server, def.name, { pid: 7 }), "allow", "esperar más salida de un pid repite los mismos argumentos");
  assert.equal(repeatPolicyOf(def.server, def.name, { command: "npm test" }), "rerun", "correr las pruebas otra vez tras un cambio (RC-21)");
  assert.equal(repeatPolicyOf(def.server, def.name, { command: "Add-Content notas.txt cambio" }), "strict");
});

// ───────────────────────── Procesos reales ─────────────────────────

test("un comando que termina: estado finished, salida completa en UTF-8 y código de salida 0", { skip: !windows }, async () => {
  const result = await run({ command: "Write-Output 'hola ñandú'" }, nextTask());
  const native = read(result);
  assert.equal(native.data.state, "finished");
  assert.equal(native.data.exitCode, 0);
  assert.equal(typeof native.data.pid, "number");
  assert.match(native.text, /^status: finished · exit code: 0 · duration: /);
  assert.match(native.raw, /hola ñandú/);
  assert.match(native.text, /The command finished successfully\./, "una frase llana para los modelos chicos");
  assert.equal(result.isError, false);
});

test("el código de salida es el real: exit explícito, programa externo que falla y cmdlet que falla", { skip: !windows }, async () => {
  const task = nextTask();
  const seven = read(await run({ command: "exit 7" }, task));
  assert.equal(seven.data.exitCode, 7);
  assert.match(seven.text, /The command failed \(exit code 7\)\./);
  assert.equal(read(await run({ command: "cmd /c exit 3" }, task)).data.exitCode, 3);
  const failing = read(await run({ command: "Get-Item C:\\no_existe_xyz_jarvis" }, task));
  assert.equal(failing.data.exitCode, 1);
  assert.match(failing.raw, /no_existe_xyz_jarvis/);
  assert.doesNotMatch(failing.raw, /CLIXML/);
  assert.equal(read(await run({ command: "Write-Error 'boom'; Write-Output 'sigue'" }, task)).raw.includes("boom"), true);
});

test("salida grande: el resumen respeta el tope y el texto completo va en raw", { skip: !windows }, async () => {
  const native = read(await run({ command: '1..20000 | ForEach-Object { "linea $_" }', timeoutSec: 60 }, nextTask()));
  assert.equal(native.data.state, "finished");
  assert.ok(native.text.length <= BUDGET.summaryMax, `text mide ${native.text.length}`);
  assert.match(native.text, /omitidos/);
  assert.ok(native.text.includes("linea 20000"), "la cola es lo que se prioriza");
  assert.ok(native.raw.includes("linea 1\n") && native.raw.includes("linea 10000\n") && native.raw.includes("linea 20000"));
  assert.equal(native.data.rawTruncated, false);
});

test("vence el plazo: running sin matar el proceso, y con {pid} se recoge el resto y el código de salida", { skip: !windows }, async () => {
  const task = nextTask();
  const first = read(await run({ command: "Write-Output 'empiezo'; Start-Sleep 4; Write-Output 'listo'; exit 5", timeoutSec: 1 }, task));
  assert.equal(first.data.state, "running");
  assert.match(first.text, new RegExp(`run_command with \\{ "pid": ${first.data.pid} \\}`));
  assert.match(first.raw, /empiezo/);
  assert.doesNotMatch(first.raw, /listo/);
  const pid = first.data.pid as number;
  assert.ok(alive(pid));

  const second = read(await run({ pid, timeoutSec: 20 }, task));
  assert.equal(second.data.state, "finished");
  assert.equal(second.data.exitCode, 5);
  assert.match(second.raw, /listo/);
  assert.doesNotMatch(second.raw, /empiezo/, "cada llamada devuelve solo la salida nueva");
});

test("un prompt: waiting_input con el texto, y la respuesta llega por {pid, input}", { skip: !windows }, async () => {
  const task = nextTask();
  const first = await run({ command: "[Console]::Out.Write('Tu nombre: '); $n = [Console]::In.ReadLine(); Write-Output \"hola $n\"", timeoutSec: 30 }, task);
  const waiting = read(first);
  assert.equal(waiting.data.state, "waiting_input");
  assert.equal(waiting.data.prompt, "Tu nombre:");
  assert.equal(waiting.data.exitCode, null);
  assert.match(waiting.text, new RegExp(`run_command \\{ "pid": ${waiting.data.pid}, "input": <the answer> \\}`), "dice cómo continuar el mismo proceso");
  assert.match(waiting.text, /Do not start a new command/);

  const answered = read(await run({ pid: waiting.data.pid, input: "Ana", timeoutSec: 20 }, task));
  assert.equal(answered.data.state, "finished");
  assert.equal(answered.data.exitCode, 0);
  assert.match(answered.raw, /hola Ana/);
});

test("Read-Host se responde como cualquier prompt (también con tildes); -AsSecureString y -Confirm fallan en el acto y el texto dice cómo seguir", { skip: !windows }, async () => {
  const task = nextTask();
  const waiting = read(await run({ command: "$n = Read-Host 'Tu nombre'; Write-Output \"hola $n\"" }, task));
  assert.equal(waiting.data.state, "waiting_input");
  assert.equal(waiting.data.prompt, "Tu nombre:");
  const answered = read(await run({ pid: waiting.data.pid, input: "Ñandú €", timeoutSec: 20 }, task));
  assert.equal(answered.data.state, "finished");
  assert.match(answered.raw, /hola Ñandú €/, "la respuesta llega en UTF-8");

  const started = Date.now();
  const secure = read(await run({ command: "Read-Host 'clave' -AsSecureString" }, task));
  assert.equal(secure.data.state, "finished");
  assert.notEqual(secure.data.exitCode, 0);
  assert.ok(Date.now() - started < 15_000, "no se cuelga esperando una contraseña");
  assert.match(secure.text, /PowerShell runs without interaction/);

  const confirm = read(await run({ command: "New-Item -ItemType Directory -Path (Join-Path $env:TEMP 'jv_confirm_test') -Confirm" }, task));
  assert.notEqual(confirm.data.exitCode, 0);
  assert.match(confirm.text, /-Confirm:\$false or -Force/);
});

test("la cancelación corta el proceso y devuelve cancelled", { skip: !windows }, async () => {
  const controller = new AbortController();
  const pending = run({ command: "Start-Sleep 60", timeoutSec: 120 }, nextTask(), { signal: controller.signal });
  setTimeout(() => controller.abort(), 700);
  const native = read(await pending);
  assert.equal(native.data.state, "cancelled");
  assert.equal(await waitDead(native.data.pid as number), true);
});

test("al fallar o cancelarse la tarea se cierra el árbol de sus procesos; al completarse se conservan", { skip: !windows }, async () => {
  const keep = nextTask();
  const kept = read(await run({ command: "Start-Sleep 60", timeoutSec: 1 }, keep));
  assert.equal(kept.data.state, "running");
  await provider.onTaskEnd(keep, "completed");
  assert.ok(alive(kept.data.pid as number), "una tarea completada deja sus procesos");

  const doomed = nextTask();
  const command = "$p = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -PassThru -NoNewWindow; Write-Output $p.Id; Wait-Process -Id $p.Id";
  const parent = read(await run({ command, timeoutSec: 3 }, doomed));
  assert.equal(parent.data.state, "running");
  const childPid = Number(/^\d+$/m.exec(parent.raw)?.[0]);
  assert.ok(childPid > 0 && alive(childPid), "el hijo existe");

  await provider.onTaskEnd(doomed, "failed");
  assert.equal(await waitDead(parent.data.pid as number), true);
  assert.equal(await waitDead(childPid), true, "el árbol completo se cierra");
  assert.ok(alive(kept.data.pid as number), "los procesos de otra tarea no se tocan");

  await provider.onTaskEnd(keep, "cancelled");
  assert.equal(await waitDead(kept.data.pid as number), true);
});

test("directorio de trabajo: el indicado, el de por defecto, y uno inexistente es un error", { skip: !windows }, async () => {
  const task = nextTask();
  const base = os.tmpdir().toLowerCase();
  assert.ok(read(await run({ command: "(Get-Location).Path" }, task)).raw.toLowerCase().includes(base));
  assert.ok(read(await run({ command: "(Get-Location).Path", cwd: os.homedir() }, task)).raw.toLowerCase().includes(os.homedir().toLowerCase()));
  const missing = await run({ command: "Get-Date", cwd: "C:\\no_existe_jarvis_dir" }, task);
  assert.equal(missing.isError, true);
});

test("validaciones: un solo modo, tipos, tope de largo, pid ajeno o inexistente y plataforma", { skip: !windows }, async () => {
  const task = nextTask();
  const errorText = async (args: Record<string, unknown>, taskId = task) => {
    const result = await run(args, taskId);
    assert.equal(result.isError, true, JSON.stringify(args));
    return read(result).text;
  };
  await errorText({});
  await errorText({ command: "Get-Date", pid: 1 });
  await errorText({ command: "Get-Date", input: "x" });
  await errorText({ command: "Get-Date", timeoutSec: -1 });
  await errorText({ command: 42 });
  await errorText({ pid: 1.5 });
  assert.match(await errorText({ command: "x".repeat(MAX_COMMAND_CHARS + 1) }), /characters/);
  assert.match(await errorText({ pid: 999_999 }), /does not exist/);

  const started = read(await run({ command: "Start-Sleep 30", timeoutSec: 1 }, task));
  assert.equal(started.data.state, "running");
  const other = await run({ pid: started.data.pid }, nextTask());
  assert.equal(other.isError, true, "un pid de otra tarea no se continúa");
  await provider.onTaskEnd(task, "failed");

  const linux = new TerminalProvider({ platform: "linux" });
  assert.equal(linux.isConnected(), false);
  assert.deepEqual(await linux.listTools(), [], "RC-29: fuera de Windows no ofrece herramientas");
  assert.equal((await linux.callTool("run_command", { command: "ls" })).isError, true);
  assert.equal((await provider.callTool("otra_cosa", {})).isError, true);
});

test("el plazo del manifiesto acota la espera de una llamada", { skip: !windows }, async () => {
  const task = nextTask();
  const started = Date.now();
  const native = read(await run({ command: "Start-Sleep 30", timeoutSec: 300 }, task, { timeoutMs: 6000 }));
  assert.equal(native.data.state, "running");
  assert.ok(Date.now() - started < 8000, "esperó más de lo que el plazo permite");
  await provider.onTaskEnd(task, "failed");
});

test("un proceso cortado desde fuera no se lee como una salida limpia: código -1", { skip: !windows }, async () => {
  const task = nextTask();
  const started = read(await run({ command: "Start-Sleep 30", timeoutSec: 1 }, task));
  const pid = started.data.pid as number;
  process.kill(pid);
  const ended = read(await run({ pid, timeoutSec: 10 }, task));
  assert.equal(ended.data.state, "finished");
  assert.notEqual(ended.data.exitCode, 0);
  assert.equal(typeof ended.data.exitCode, "number");
});

test("con el tope de procesos vivos: lo que dejó una tarea completada se cierra para hacer lugar; lo de una tarea en curso no se toca", { skip: !windows }, async () => {
  const small = new TerminalProvider({ defaultCwd: os.tmpdir(), maxLive: 2 });
  const start = (taskId: string) => small.callTool("run_command", { command: "Start-Sleep 60", timeoutSec: 1 }, { taskId });
  try {
    const a = read(await start("A"));
    const b = read(await start("A"));
    // La tarea A sigue en curso: no hay lugar y no se cierra nada.
    const refused = await start("B");
    assert.equal(refused.isError, true);
    assert.match(read(refused).text, /2 processes are already running/);
    assert.ok(alive(a.data.pid as number) && alive(b.data.pid as number));

    // La tarea A se completa y deja sus procesos: ya no los puede continuar nadie, y el más antiguo se cierra para dar lugar a B.
    await small.onTaskEnd("A", "completed");
    assert.ok(alive(a.data.pid as number) && alive(b.data.pid as number), "una tarea completada los deja");
    const c = read(await start("B"));
    assert.equal(c.data.state, "running");
    assert.equal(await waitDead(a.data.pid as number), true, "el más antiguo se cerró");
    assert.ok(alive(b.data.pid as number), "solo se cierra lo necesario");
  } finally {
    await small.close();
  }
});

// ───────────────────────── Mejoras de la revisión (RC-xx en docs/REVISION_run_command.md) ─────────────────────────

test("RC-01: un avance sin salto de línea que se detiene no es un prompt", { skip: !windows }, async () => {
  const native = read(await run({ command: "Write-Host -NoNewline 'progreso...'; Start-Sleep 3; Write-Host ' listo'", timeoutSec: 20 }, nextTask()));
  assert.equal(native.data.state, "finished");
  assert.match(native.raw, /progreso\.\.\. listo/);
});

test("RC-11 y RC-18: un Write-Error no arrastra el texto del comando ni el epílogo, la cabecera dice la carpeta y un comando mudo dice que no escribió nada", { skip: !windows }, async () => {
  const task = nextTask();
  const native = read(await run({ command: "Write-Error 'boom'; Write-Output 'sigue'" }, task));
  assert.match(native.raw, /script : boom/);
  assert.ok(!native.raw.includes("LASTEXITCODE"), "el epílogo no aparece como contexto del error");
  assert.ok(native.text.toLowerCase().includes(`cwd: ${os.tmpdir().toLowerCase()}`), native.text.split("\n")[0]);
  const silent = read(await run({ command: "$null = 1" }, task));
  assert.match(silent.text, /\(no output\)$/);
});

test("RC-10: las herramientas del sistema salen sin �, por la tubería de PowerShell o directo, con su código de salida real", { skip: !windows }, async () => {
  const task = nextTask();
  for (const command of ["ipconfig", "ipconfig | Select-Object -First 6", "$x = ipconfig; $x", "chcp", "ping -n 1 127.0.0.1 | Out-String"]) {
    const native = read(await run({ command, timeoutSec: 30 }, task));
    assert.equal(native.data.exitCode, 0, command);
    assert.ok(!native.raw.includes("�"), `${command}: ${native.raw.slice(0, 200)}`);
  }
  assert.equal(read(await run({ command: "ipconfig /opcion_que_no_existe" }, task)).data.exitCode, 1, "el envoltorio conserva el fallo");
  assert.equal(read(await run({ command: "ipconfig /opcion_que_no_existe; Write-Output ok" }, task)).data.exitCode, 0, "solo cuenta si fue lo último");
  const python = read(await run({ command: "python -c \"print('añ €')\"" }, task));
  if (python.data.exitCode === 0) assert.match(python.raw, /añ €/, "Python escribe en UTF-8 (PYTHONIOENCODING)");
});

test("RC-16: el comando no hereda las variables excluidas", { skip: !windows }, async () => {
  process.env.JARVIS_TEST_SECRET_RC16 = "no-debe-verse";
  const filtered = new TerminalProvider({ defaultCwd: os.tmpdir(), envRemove: ["jarvis_test_secret_rc16"] });
  try {
    const native = read(await filtered.callTool("run_command", { command: "\"[$env:JARVIS_TEST_SECRET_RC16][$env:PYTHONIOENCODING]\"" }, { taskId: "env" }));
    assert.match(native.raw, /\[\]\[utf-8\]/);
  } finally {
    delete process.env.JARVIS_TEST_SECRET_RC16;
    await filtered.close();
  }
});

test("RC-30: dos lanzamientos simultáneos no pasan juntos el tope de procesos vivos", { skip: !windows }, async () => {
  const small = new TerminalProvider({ defaultCwd: os.tmpdir(), maxLive: 1 });
  try {
    const results = await Promise.all(["A", "B"].map((taskId) => small.callTool("run_command", { command: "Start-Sleep 30", timeoutSec: 1 }, { taskId })));
    assert.deepEqual(results.map((r) => r.isError).sort(), [false, true]);
  } finally {
    await small.close();
  }
});

test("RC-08: si un programa lanzado hereda la salida y sigue vivo, el comando termina igual y lo dice", { skip: !windows }, async () => {
  const command = "$p = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 20' -PassThru -NoNewWindow; Write-Output $p.Id";
  const native = read(await run({ command, timeoutSec: 20 }, nextTask()));
  const childPid = Number(/^\d+$/m.exec(native.raw)?.[0]);
  try {
    assert.equal(native.data.state, "finished");
    assert.equal(native.data.detached, true);
    assert.match(native.text, /still running in the background/);
  } finally {
    if (childPid > 0) {
      try {
        process.kill(childPid);
      } catch {
        // ya terminó
      }
    }
  }
});

test("si las ayudas de PowerShell no se pueden cargar, el comando corre igual (una sola vez) sin ellas", { skip: !windows }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jv_helpers_"));
  const broken = new TerminalProvider({ defaultCwd: os.tmpdir(), helpersDir: dir });
  try {
    const first = read(await broken.callTool("run_command", { command: "Write-Output uno" }, { taskId: "h" }));
    assert.match(first.raw, /uno/);
    const file = ensureHelpersFile(true, dir);
    assert.ok(file !== null);
    fs.writeFileSync(file, "throw 'ayudas rotas'");
    const marker = path.join(dir, "corrio.txt");
    const second = read(await broken.callTool("run_command", { command: `Add-Content -Path '${marker}' -Value x; Write-Output dos` }, { taskId: "h" }));
    assert.equal(second.data.exitCode, 0);
    assert.match(second.raw, /dos/);
    assert.doesNotMatch(second.raw, /JARVIS_HELPERS_UNAVAILABLE/);
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "x", "el comando corrió exactamente una vez");
  } finally {
    await broken.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un REPL que vuelve a preguntar: el prompt nuevo no arrastra el ya respondido (python -i)", { skip: !windows }, async () => {
  const task = nextTask();
  const first = read(await run({ command: "python -i -q", timeoutSec: 15 }, task));
  if (first.data.state !== "waiting_input") return; // sin Python en el PATH
  try {
    const second = read(await run({ pid: first.data.pid, input: "print(6*7)", timeoutSec: 15 }, task));
    assert.equal(second.data.state, "waiting_input");
    assert.equal(second.data.prompt, ">>>");
    assert.match(second.raw, /42/);
  } finally {
    await provider.onTaskEnd(task, "failed");
  }
});

test("un pid que ya terminó y cuya salida se entregó sigue terminado: finished con su código, no 'no existe' (solo en su tarea)", { skip: !windows }, async () => {
  const task = nextTask();
  const first = read(await run({ command: "Write-Output hecho; exit 3" }, task));
  assert.equal(first.data.exitCode, 3);
  const again = read(await run({ pid: first.data.pid, input: "ok" }, task));
  assert.equal(again.data.state, "finished");
  assert.equal(again.data.exitCode, 3);
  assert.equal(again.data.alreadyReported, true);
  assert.match(again.text, /The input was ignored/);
  assert.match(again.text, /already finished; its output was returned by an earlier call/);
  assert.equal(again.raw, "", "la salida no se repite");
  const other = await run({ pid: first.data.pid }, nextTask());
  assert.equal(other.isError, true, "otra tarea no lo ve");
});

test("RC-40: las herramientas del sistema escritas con extensión también se envuelven", { skip: !windows }, async () => {
  const task = nextTask();
  for (const command of ["ipconfig.exe | Select-Object -First 6", "$x = chcp.com; $x"]) {
    const native = read(await run({ command }, task));
    assert.equal(native.data.exitCode, 0, command);
    assert.ok(!native.raw.includes("�"), `${command}: ${native.raw.slice(0, 200)}`);
  }
});

test("RC-30: cuatro tareas a la vez: cada una ve solo su salida y sus procesos; cancelar una no toca a las demás", { skip: !windows }, async () => {
  const tasks = ["A", "B", "C", "D"].map((name) => `${nextTask()}_${name}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  const results = await Promise.all([
    run({ command: "1..50 | % { 'salida-A ' + $_ }" }, tasks[0]),
    run({ command: "$n = Read-Host 'Nombre B'; \"hola-B $n\"" }, tasks[1]),
    run({ command: "Start-Sleep 30" }, tasks[2], { signal: controller.signal }),
    run({ command: "Write-Output salida-D; Start-Sleep 30", timeoutSec: 3 }, tasks[3]),
  ]);
  clearTimeout(timer);
  const [a, b, c, d] = results.map(read);
  try {
    assert.equal(a.data.state, "finished");
    assert.ok(a.raw.includes("salida-A 50") && !a.raw.includes("salida-D") && !a.raw.includes("Nombre B"));
    assert.equal(b.data.state, "waiting_input");
    assert.equal(c.data.state, "cancelled");
    assert.equal(d.data.state, "running");
    assert.ok(d.raw.includes("salida-D") && !d.raw.includes("salida-A"));
    assert.equal((await run({ pid: b.data.pid, input: "x" }, tasks[3])).isError, true, "una tarea no responde el proceso de otra");
    const answered = read(await run({ pid: b.data.pid, input: "Ana", timeoutSec: 15 }, tasks[1]));
    assert.match(answered.raw, /hola-B Ana/);
  } finally {
    for (const t of tasks) await provider.onTaskEnd(t, "failed");
  }
});

// ───────────────────────── list_processes y stop_process (RC-25) ─────────────────────────

test("RC-25: list_processes muestra los procesos de run_command de la tarea y los que dejó una tarea completada, no los de otra tarea en curso", { skip: !windows }, async () => {
  const mine = nextTask();
  const earlier = nextTask();
  const other = nextTask();
  const a = read(await run({ command: "Start-Sleep 60", timeoutSec: 1 }, mine));
  const b = read(await run({ command: "$n = Read-Host 'Nombre'", timeoutSec: 10 }, mine));
  const c = read(await run({ command: "Start-Sleep 61", timeoutSec: 1 }, earlier));
  const d = read(await run({ command: "Start-Sleep 62", timeoutSec: 1 }, other));
  try {
    await provider.onTaskEnd(earlier, "completed");
    const listed = read(await provider.callTool("list_processes", {}, { taskId: mine }));
    assert.equal(listed.data.state, "listed");
    assert.match(listed.text, new RegExp(`pid ${a.data.pid} · running · .* · this task · Start-Sleep 60`));
    assert.match(listed.text, new RegExp(`pid ${b.data.pid} · waiting for input: "Nombre:"`));
    assert.match(listed.text, new RegExp(`pid ${c.data.pid} · running · .* · left running by an earlier task`));
    assert.ok(!listed.text.includes(`pid ${d.data.pid}`), "lo de otra tarea en curso no se ve");

    const all = read(await provider.callTool("list_processes", { all: true }, { taskId: mine }));
    assert.equal(all.data.scope, "system");
    assert.ok((all.data.count as number) > 10);
    assert.match(all.raw, new RegExp(`pid ${process.pid} · node`, "i"));
  } finally {
    for (const t of [mine, earlier, other]) await provider.onTaskEnd(t, "failed");
  }
});

test("RC-25: stop_process corta un proceso de run_command con todo su árbol y devuelve lo que tenía sin leer; después, continuarlo dice que se cortó", { skip: !windows }, async () => {
  const task = nextTask();
  const command = "Write-Output antes; $p = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -PassThru -NoNewWindow; Write-Output $p.Id; Wait-Process -Id $p.Id";
  const started = read(await run({ command, timeoutSec: 3 }, task));
  const childPid = Number(/^\d+$/m.exec(started.raw)?.[0]);
  assert.ok(childPid > 0 && alive(childPid));
  const stopped = read(await provider.callTool("stop_process", { pid: started.data.pid }, { taskId: task }));
  assert.equal(stopped.data.state, "stopped");
  assert.equal(stopped.data.scope, "run_command");
  assert.equal(await waitDead(started.data.pid as number), true);
  assert.equal(await waitDead(childPid), true, "el árbol completo");
  const again = read(await run({ pid: started.data.pid }, task));
  assert.equal(again.data.state, "stopped");
  assert.match(again.text, /stopped with stop_process/);
  const twice = read(await provider.callTool("stop_process", { pid: started.data.pid }, { taskId: task }));
  assert.equal(twice.data.state, "not_running");
});

test("RC-25: stop_process corta un proceso cualquiera de la PC, pero nunca Jarvis, lo que cuelga de Jarvis, un crítico de Windows ni lo de otra tarea en curso", { skip: !windows }, async () => {
  const outsider = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep 60"], { windowsHide: true, stdio: "ignore" });
  const task = nextTask();
  const other = nextTask();
  try {
    // Un proceso que lanzó Jarvis por su cuenta (como sus servidores de herramientas) está protegido; uno ajeno, no.
    const own = read(await provider.callTool("stop_process", { pid: outsider.pid }, { taskId: task }));
    assert.equal(own.data.state, "protected", "lo lanzó este mismo proceso de Node: cuelga de Jarvis");
    for (const pid of [process.pid, 4]) {
      const refused = read(await provider.callTool("stop_process", { pid }, { taskId: task }));
      assert.equal(refused.data.state, "protected", String(pid));
    }
    const foreign = read(await run({ command: "Start-Sleep 60", timeoutSec: 1 }, other));
    const notYours = await provider.callTool("stop_process", { pid: foreign.data.pid }, { taskId: task });
    assert.equal(notYours.isError, true);
    assert.match(read(notYours).text, /another task that is still running/);
    assert.equal((await provider.callTool("stop_process", { pid: 999_999 }, { taskId: task })).isError, true);
  } finally {
    try {
      process.kill(outsider.pid as number);
    } catch {
      // ya terminó
    }
    await provider.onTaskEnd(other, "failed");
  }
});

test("RC-25: un proceso ajeno a Jarvis (lanzado aparte, sin padre vivo) se corta solo, sin su árbol", { skip: !windows }, async () => {
  const task = nextTask();
  const launched = read(await run({ command: "(Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -WindowStyle Hidden -PassThru).Id" }, task));
  const pid = Number(/^\d+$/m.exec(launched.raw)?.[0]);
  assert.ok(pid > 0 && alive(pid));
  try {
    const stopped = read(await provider.callTool("stop_process", { pid }, { taskId: task }));
    assert.equal(stopped.data.state, "stopped");
    assert.equal(stopped.data.scope, "system");
    assert.equal(await waitDead(pid), true);
  } finally {
    try {
      process.kill(pid);
    } catch {
      // ya terminó
    }
  }
});
