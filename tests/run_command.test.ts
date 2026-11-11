/**
 * `run_command` (proveedor nativo `jarvis_terminal`): procesos reales de PowerShell. Código de salida real, salida completa, prompts, plazos,
 * continuación por `pid`, cancelación, cierre del árbol y validaciones. Solo Windows.
 */

import assert from "node:assert/strict";
import os from "node:os";
import { after, test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { applyDestination, repeatPolicyOf, SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import { LineNormalizer, OutputBuffer, stripAnsi, UNREAD_HEAD_CAP, UNREAD_TAIL_CAP } from "../src/tools/terminal/output.ts";
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

test("stripAnsi y LineNormalizer: sin colores, y un \\r\\n partido entre dos fragmentos es un solo salto", () => {
  assert.equal(stripAnsi("\u001b[31mrojo\u001b[0m y \u001b[2K\u001b[1Gfin"), "rojo y fin");
  const n = new LineNormalizer();
  assert.equal(n.push("a\r") + n.push("\nb\rc\r\n") + n.flush(), "a\nb\nc\n");
  assert.equal(new LineNormalizer().push("x\r") + "", "x");
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
});

test("el manifiesto expone exactamente los parámetros que declara el proveedor", async () => {
  const tools = await provider.listTools();
  const offered = applyDestination("terminal", tools);
  assert.deepEqual(offered.map((t) => t.name), ["run_command"]);
  const def = SYSTEM_TOOL_MANIFEST.find((d) => d.name === "run_command");
  assert.ok(def);
  assert.equal(def.server, provider.name);
  assert.deepEqual(Object.keys(offered[0].inputSchema.properties ?? {}).sort(), [...(def.params ?? [])].sort());
  assert.equal(def.policy.requiresApproval, true);
  assert.equal(def.policy.repeat, "strict");
  assert.equal(repeatPolicyOf(def.server, def.name, { command: "Get-Date" }), "strict", "repetir un comando idéntico pudo duplicar sus efectos");
  assert.equal(repeatPolicyOf(def.server, def.name, { pid: 7 }), "allow", "esperar más salida de un pid repite los mismos argumentos");
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

test("Read-Host no cuelga el proceso: falla en el acto (PowerShell sin interacción)", { skip: !windows }, async () => {
  const started = Date.now();
  const native = read(await run({ command: "Read-Host 'dato'" }, nextTask()));
  assert.equal(native.data.state, "finished");
  assert.notEqual(native.data.exitCode, 0);
  assert.ok(Date.now() - started < 15_000);
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
