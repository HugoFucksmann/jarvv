/**
 * Proveedor nativo `jarvis_terminal`: la tool `run_command`.
 *
 * Lanza un comando de PowerShell con `child_process` y devuelve su resultado en el contrato de los proveedores nativos (`core/tools/result.ts`).
 * - Código de salida real (`exit`), con la salida en UTF-8 y los saltos de línea normalizados; stdout y stderr llegan juntos, en el orden en que se emitieron.
 * - Una llamada espera el primer de estos eventos: el proceso terminó (`finished`), pide una respuesta (`waiting_input`), venció el plazo (`running`, el
 *   proceso NO se mata) o se canceló la tarea (`cancelled`, se corta su árbol).
 * - Un proceso que sigue vivo se continúa con `{ pid }` (espera más salida) o `{ pid, input }` (responde lo que pedía). Cada llamada devuelve solo la salida nueva.
 * - Solo se continúan los procesos que lanzó la misma tarea. Al terminar mal una tarea (`onTaskEnd`) se cierran los suyos; al apagar el servidor (`close`), todos.
 *
 * Un prompt se detecta por inactividad: la salida se detuvo `PROMPT_IDLE_MS` y la última línea quedó sin salto de línea (`Tu nombre: `). PowerShell se lanza con
 * `-NonInteractive`, así que `Read-Host` falla en el acto en vez de colgarse. Sin PTY, los programas que exigen una terminal real (REPL) quedan fuera.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";

import { BUDGET } from "../../core/budget.ts";
import type { ToolCallOptions, ToolProvider, TaskEndOutcome } from "../../core/tools/provider.ts";
import { toolResult } from "../../core/tools/result.ts";
import { headTailNeutral } from "../../core/text.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";
import { LineNormalizer, OutputBuffer, stripAnsi } from "./output.ts";
import { killTree } from "./processTree.ts";

export const TERMINAL_SERVER = "jarvis_terminal";
export const RUN_COMMAND = "run_command";

export const DEFAULT_WAIT_SEC = 30;
export const MAX_WAIT_SEC = 300;
/** Inactividad con una línea sin terminar que cuenta como "el proceso pide una respuesta". */
export const PROMPT_IDLE_MS = 1500;
/** Procesos vivos a la vez. */
export const MAX_LIVE_PROCESSES = 8;
export const MAX_COMMAND_CHARS = 4000;
export const MAX_INPUT_CHARS = 1000;
/** Largo máximo de la línea que se toma por prompt. */
const PROMPT_MAX_CHARS = 300;
/** Cuánto se espera a que cierren los flujos de un proceso que ya terminó (un hijo puede heredarlos). */
const CLOSE_GRACE_MS = 300;
/** Un proceso terminado cuya salida nadie leyó se olvida pasado este tiempo. */
const RETAIN_FINISHED_MS = 10 * 60 * 1000;
const SAFETY_MARGIN_MS = 5000;
/** Reserva de la cabecera dentro del tope del resumen. */
const HEADER_RESERVE = 220;

type WaitResult = "finished" | "waiting_input" | "running" | "cancelled";

interface Tracked {
  readonly pid: number;
  readonly taskId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly startedAt: number;
  readonly buffer: OutputBuffer;
  readonly events: EventEmitter;
  /** Últimos caracteres de toda la salida: de ahí sale la línea sin terminar que se toma por prompt. */
  recentTail: string;
  lastOutputAt: number;
  /** La tarea que lo lanzó se completó y lo dejó corriendo: ninguna otra tarea lo puede continuar, y es lo primero que se cierra si hace falta lugar. */
  orphan: boolean;
  exitCode: number | null;
  /** El proceso terminó y sus flujos se cerraron (o venció el plazo de gracia). */
  done: boolean;
  endedAt: number | null;
}

/** Salida en UTF-8 y sin barras de progreso: va antes del comando, fuera de su bloque, para que los números de línea de los errores sean los del comando. */
export const PROLOGUE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'";

/** Código de salida del proceso: 0 si el último comando salió bien; si no, el del programa externo que falló, o 1. */
export const EPILOGUE = "if ($?) { exit 0 } else { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }";

/** El comando tal cual (una línea de comentario final no lo anula) y, en otra línea, el cálculo del código de salida. */
export function buildScript(command: string): string {
  return `${command}\n${EPILOGUE}`;
}

/**
 * Argumento de `-Command`: el script va en base64 dentro de un bloque, así que no hay comillas que escapar. No se usa `-EncodedCommand` porque con él PowerShell
 * escribe los errores en CLIXML (XML) en vez de texto.
 */
export function buildCommandLine(command: string): string {
  const encoded = Buffer.from(buildScript(command), "utf16le").toString("base64");
  return `${PROLOGUE}; & ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))))`;
}

const TOOL: MCPTool = {
  name: RUN_COMMAND,
  description: "Run a PowerShell command, or continue a running one by its pid.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "PowerShell command to run." },
      pid: { type: "integer", description: "Process id of a process started by an earlier run_command." },
      input: { type: "string", description: "Answer for a process that is waiting for input." },
      timeoutSec: { type: "integer", description: `Seconds to wait (default ${DEFAULT_WAIT_SEC}, max ${MAX_WAIT_SEC}).` },
      cwd: { type: "string", description: "Absolute working directory for a new command." },
    },
    additionalProperties: false,
  },
};

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", ...data }, isError: true });

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

export interface TerminalOptions {
  /** Directorio de trabajo de un comando nuevo sin `cwd`. Por defecto, la carpeta personal del usuario. */
  readonly defaultCwd?: string;
  /** Solo para pruebas: otra plataforma. */
  readonly platform?: NodeJS.Platform;
  /** Procesos vivos a la vez (por defecto `MAX_LIVE_PROCESSES`). */
  readonly maxLive?: number;
}

export class TerminalProvider implements ToolProvider {
  readonly name = TERMINAL_SERVER;
  readonly version = "1.0.0";
  private readonly procs = new Map<number, Tracked>();
  private readonly defaultCwd: string;
  private readonly platform: NodeJS.Platform;
  private readonly maxLive: number;

  constructor(options: TerminalOptions = {}) {
    this.defaultCwd = options.defaultCwd ?? os.homedir();
    this.platform = options.platform ?? process.platform;
    this.maxLive = options.maxLive ?? MAX_LIVE_PROCESSES;
  }

  async listTools(): Promise<MCPTool[]> {
    return [TOOL];
  }

  isConnected(): boolean {
    return this.platform === "win32";
  }

  async reconnect(): Promise<void> {}

  async close(): Promise<void> {
    await this.killAll(() => true);
  }

  async onTaskEnd(taskId: string, outcome: TaskEndOutcome): Promise<void> {
    if (outcome === "completed") {
      for (const t of this.procs.values()) if (t.taskId === taskId && !t.done) t.orphan = true;
      return;
    }
    try {
      const closed = await this.killAll((t) => t.taskId === taskId);
      if (closed > 0) console.log(`[Terminal] ${closed} proceso(s) de la tarea ${taskId} cerrados (${outcome}).`);
    } catch (error) {
      console.warn(`[Terminal] no se pudieron cerrar los procesos de la tarea ${taskId}: ${errorMessage(error)}`);
    }
  }

  async callTool(name: string, args: Record<string, unknown>, options: ToolCallOptions = {}): Promise<MCPCallResult> {
    if (name !== RUN_COMMAND) return fail(`Unknown tool: '${name}'.`);
    if (this.platform !== "win32") return fail("run_command only works on Windows (PowerShell).");
    this.purge();

    const { command, pid, input } = args;
    const timeoutSec = args.timeoutSec;
    if (command !== undefined && typeof command !== "string") return fail("'command' must be a text.");
    if (pid !== undefined && (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)) return fail("'pid' must be a positive integer.");
    if (input !== undefined && typeof input !== "string") return fail("'input' must be a text.");
    if (timeoutSec !== undefined && (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec <= 0)) return fail("'timeoutSec' must be a positive number.");
    if ((command === undefined || command.trim() === "") === (pid === undefined)) return fail("Give exactly one of: 'command' (a new command) or 'pid' (continue a process).");

    const requested = Math.min(Math.max(Math.round(typeof timeoutSec === "number" ? timeoutSec : DEFAULT_WAIT_SEC), 1), MAX_WAIT_SEC) * 1000;
    const ceiling = options.timeoutMs === undefined ? Infinity : Math.max(options.timeoutMs - SAFETY_MARGIN_MS, 1000);
    const waitMs = Math.min(requested, ceiling);

    if (command !== undefined && command.trim() !== "") {
      if (command.length > MAX_COMMAND_CHARS) return fail(`The command is longer than ${MAX_COMMAND_CHARS} characters.`);
      if (input !== undefined) return fail("'input' is only used together with 'pid'.");
      return this.start(command, typeof args.cwd === "string" && args.cwd.trim() !== "" ? args.cwd : this.defaultCwd, waitMs, options);
    }
    if (input !== undefined && input.length > MAX_INPUT_CHARS) return fail(`The input is longer than ${MAX_INPUT_CHARS} characters.`);
    return this.resume(pid as number, input, waitMs, options);
  }

  // ───────────────────────── Lanzar ─────────────────────────

  private async start(command: string, cwd: string, waitMs: number, options: ToolCallOptions): Promise<MCPCallResult> {
    const taskId = options.taskId ?? "";
    const live = (): Tracked[] => [...this.procs.values()].filter((p) => !p.done);
    if (live().length >= this.maxLive) {
      // Lo que dejó una tarea ya completada no lo puede continuar nadie: se cierra el más antiguo para hacer lugar. Lo de una tarea en curso nunca se toca.
      const oldest = live().filter((p) => p.orphan).sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest !== undefined) {
        console.log(`[Terminal] se cierra el proceso ${oldest.pid} de la tarea ${oldest.taskId} (completada) para hacer lugar.`);
        await this.dispose(oldest);
      }
    }
    if (live().length >= this.maxLive) {
      return fail(`${this.maxLive} processes are already running: wait for one to finish before starting another.`);
    }
    try {
      if (!fs.statSync(cwd).isDirectory()) return fail(`'${cwd}' is not a folder.`);
    } catch {
      return fail(`The working folder '${cwd}' does not exist.`);
    }

    let tracked: Tracked;
    try {
      tracked = await this.spawnProcess(command, cwd, taskId);
    } catch (error) {
      return fail(`Could not start PowerShell: ${errorMessage(error)}`);
    }
    return this.settle(tracked, waitMs, options.signal);
  }

  private spawnProcess(command: string, cwd: string, taskId: string): Promise<Tracked> {
    return new Promise((resolve, reject) => {
      const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", buildCommandLine(command)];
      const child = spawn("powershell.exe", args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.on("error", () => {});
      child.once("error", reject);
      child.once("spawn", () => {
        const pid = child.pid;
        if (pid === undefined) return reject(new Error("el sistema no devolvió el id del proceso."));
        const t: Tracked = {
          pid,
          taskId,
          child,
          startedAt: Date.now(),
          buffer: new OutputBuffer(),
          events: new EventEmitter(),
          recentTail: "",
          lastOutputAt: Date.now(),
          orphan: false,
          exitCode: null,
          done: false,
          endedAt: null,
        };
        this.procs.set(pid, t);
        this.collect(t);
        resolve(t);
      });
    });
  }

  /** Recoge stdout y stderr en un único flujo ordenado y vigila el fin del proceso. */
  private collect(t: Tracked): void {
    const normalizer = new LineNormalizer();
    const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
    const receive = (text: string): void => {
      if (text.length === 0) return;
      t.buffer.append(text);
      t.recentTail = (t.recentTail + text).slice(-2048);
      t.lastOutputAt = Date.now();
      t.events.emit("activity");
    };
    [t.child.stdout, t.child.stderr].forEach((stream, i) => {
      stream.on("data", (chunk: Buffer) => receive(normalizer.push(stripAnsi(decoders[i].write(chunk)))));
    });

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      receive(normalizer.push(stripAnsi(decoders[0].end() + decoders[1].end())) + normalizer.flush());
      t.done = true;
      t.endedAt = Date.now();
      t.events.emit("activity");
    };
    // Sin código (el proceso lo cortó alguien desde fuera): -1, para que no se lea como una salida limpia.
    t.child.once("exit", (code) => {
      t.exitCode = code ?? -1;
      setTimeout(finish, CLOSE_GRACE_MS).unref();
    });
    t.child.once("close", (code) => {
      if (t.exitCode === null) t.exitCode = code ?? -1;
      finish();
    });
  }

  // ───────────────────────── Continuar ─────────────────────────

  private async resume(pid: number, input: string | undefined, waitMs: number, options: ToolCallOptions): Promise<MCPCallResult> {
    const t = this.procs.get(pid);
    if (t === undefined || t.taskId !== (options.taskId ?? "")) {
      return fail(`Process ${pid} does not exist or was not started by this task.`, { pid, state: "unknown_pid" });
    }
    let ignoredInput = false;
    if (input !== undefined) {
      if (t.done) {
        ignoredInput = true;
      } else {
        // La línea sin terminar era el prompt que se está respondiendo: no puede volver a tomarse por uno nuevo.
        t.recentTail = t.recentTail.slice(0, t.recentTail.lastIndexOf("\n") + 1);
        t.lastOutputAt = Date.now();
        t.child.stdin.write(`${input}\r\n`);
      }
    }
    return this.settle(t, waitMs, options.signal, ignoredInput);
  }

  // ───────────────────────── Esperar y responder ─────────────────────────

  private async settle(t: Tracked, waitMs: number, signal: AbortSignal | undefined, ignoredInput = false): Promise<MCPCallResult> {
    const state = await this.waitFor(t, waitMs, signal);
    if (state === "cancelled") {
      await this.dispose(t);
    }
    const { text: output, omitted } = t.buffer.take();
    const prompt = state === "waiting_input" ? this.currentPrompt(t) : undefined;
    const durationMs = (t.endedAt ?? Date.now()) - t.startedAt;
    const exitCode = state === "finished" ? t.exitCode : null;
    if (state === "finished") this.procs.delete(t.pid);

    const header = [`status: ${state}`, ...(exitCode !== null ? [`exit code: ${exitCode}`] : []), `duration: ${seconds(durationMs)}`, `pid: ${t.pid}`].join(" · ");
    const notes: string[] = [];
    if (ignoredInput) notes.push("The input was ignored: the process had already finished.");
    // Frases llanas para los modelos chicos: el estado y el código de salida no alcanzan para que un verificador o un generador de argumentos entienda qué pasó o qué hacer.
    if (state === "finished" && exitCode !== null) notes.push(exitCode === 0 ? "The command finished successfully." : `The command failed (exit code ${exitCode}).`);
    if (state === "waiting_input") {
      notes.push(`Waiting for input: "${prompt}". The user is asked for the answer; then continue THIS process with run_command { "pid": ${t.pid}, "input": <the answer> }. Do not start a new command.`);
    }
    if (state === "running") notes.push(`The process is still running. Call run_command with { "pid": ${t.pid} } to read more output.`);

    const cap = Math.max(BUDGET.summaryMax - HEADER_RESERVE, 400);
    const head = Math.floor(cap * 0.2);
    const body = output.length === 0 ? "(no new output)" : headTailNeutral(output, head, cap - head - 50).text;
    const text = [header, ...notes, body].join("\n");

    return toolResult({
      text,
      raw: output,
      data: { state, pid: t.pid, exitCode, durationMs, ...(prompt === undefined ? {} : { prompt }), rawTruncated: omitted > 0 },
      meta: { waitLimitMs: waitMs },
    });
  }

  private waitFor(t: Tracked, ms: number, signal: AbortSignal | undefined): Promise<WaitResult> {
    return new Promise<WaitResult>((resolve) => {
      let idleTimer: NodeJS.Timeout | undefined;
      let deadline: NodeJS.Timeout | undefined;
      let settled = false;

      const finish = (result: WaitResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(deadline);
        t.events.off("activity", evaluate);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => finish("cancelled");
      const evaluate = (): void => {
        if (t.done) return finish("finished");
        clearTimeout(idleTimer);
        if (!this.looksLikePrompt(t)) return;
        idleTimer = setTimeout(() => {
          if (t.done) finish("finished");
          else if (this.looksLikePrompt(t)) finish("waiting_input");
        }, Math.max(PROMPT_IDLE_MS - (Date.now() - t.lastOutputAt), 0));
      };

      if (signal?.aborted) return finish("cancelled");
      deadline = setTimeout(() => finish("running"), ms);
      signal?.addEventListener("abort", onAbort, { once: true });
      t.events.on("activity", evaluate);
      evaluate();
    });
  }

  /** La línea sin terminar de la salida (lo que el proceso dejó escrito esperando una respuesta). */
  private currentPrompt(t: Tracked): string {
    return t.recentTail.slice(t.recentTail.lastIndexOf("\n") + 1).trim();
  }

  private looksLikePrompt(t: Tracked): boolean {
    if (t.done) return false;
    const last = t.recentTail.slice(t.recentTail.lastIndexOf("\n") + 1);
    return last.trim().length > 0 && last.length <= PROMPT_MAX_CHARS;
  }

  // ───────────────────────── Cierre ─────────────────────────

  /** Corta el árbol del proceso y espera a que termine (con tope). */
  private async dispose(t: Tracked): Promise<void> {
    this.procs.delete(t.pid);
    if (t.done) return;
    await killTree(t.pid);
    await new Promise<void>((resolve) => {
      if (t.done) return resolve();
      const timer = setTimeout(resolve, 2000);
      t.events.once("activity", () => {
        if (t.done) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  private async killAll(filter: (t: Tracked) => boolean): Promise<number> {
    const targets = [...this.procs.values()].filter((t) => !t.done && filter(t));
    await Promise.allSettled(targets.map((t) => this.dispose(t)));
    for (const t of [...this.procs.values()]) if (filter(t) && t.done) this.procs.delete(t.pid);
    return targets.length;
  }

  /** Olvida los procesos terminados que nadie volvió a leer. */
  private purge(): void {
    const now = Date.now();
    for (const t of this.procs.values()) if (t.done && t.endedAt !== null && now - t.endedAt > RETAIN_FINISHED_MS) this.procs.delete(t.pid);
  }
}
