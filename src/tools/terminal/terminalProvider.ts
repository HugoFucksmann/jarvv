/**
 * Proveedor nativo `jarvis_terminal`: la tool `run_command`.
 *
 * Lanza un comando de PowerShell con `child_process` (cómo se arma la línea: `powershell.ts`) y devuelve su resultado en el contrato de los proveedores
 * nativos (`core/tools/result.ts`).
 * - Código de salida real (`exit`); la salida en texto (UTF-8, y las herramientas del sistema que escriben en la página OEM/ANSI decodificadas con ella:
 *   `output.ts`), sin escapes de terminal, con las barras de progreso en su última versión y stdout y stderr unidos por líneas enteras.
 * - Una llamada espera el primer de estos eventos: el proceso terminó (`finished`), pide una respuesta (`waiting_input`), venció el plazo (`running`, el
 *   proceso NO se mata) o se canceló la tarea (`cancelled`, se corta su árbol).
 * - Un proceso que sigue vivo se continúa con `{ pid }` (espera más salida) o `{ pid, input }` (responde lo que pedía). Cada llamada devuelve solo la salida nueva.
 * - Solo se continúan los procesos que lanzó la misma tarea. Al terminar mal una tarea (`onTaskEnd`) se cierran los suyos; al apagar el servidor (`close`), todos.
 *   Los que deja una tarea completada siguen vivos (pudo ser lo pedido: un servidor) y quedan huérfanos: no se guarda su salida y son lo primero que se
 *   cierra si hace falta lugar.
 *
 * Un prompt se detecta por la forma de la última línea y el silencio del proceso (`prompts.ts`). PowerShell se lanza con `-NonInteractive`: sus propios
 * prompts de confirmación fallan en el acto en vez de colgarse (el texto lo explica al modelo), salvo `Read-Host`/`pause`, que se responden como cualquier
 * programa (`powershell.ts`). Sin PTY; un REPL que escribe su prompt (`python -i`) igual llega a `waiting_input`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BUDGET } from "../../core/budget.ts";
import type { ToolCallOptions, ToolProvider, TaskEndOutcome } from "../../core/tools/provider.ts";
import { argCapsOf } from "../../core/tools/manifest.ts";
import { toolResult } from "../../core/tools/result.ts";
import { headTailNeutral, omissionMarker } from "../../core/text.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";
import { systemCodePages, type CodePages } from "./codepages.ts";
import { cleanTerminalText, LineAssembler, legacyDecoder, OutputBuffer, OutputDecoder } from "./output.ts";
import { buildCommandLine, ensureHelpersFile, HELPERS_ENV, HELPERS_UNAVAILABLE, HELPERS_UNAVAILABLE_EXIT, POWERSHELL_ARGS } from "./powershell.ts";
import { classifyPrompt, PROMPT_IDLE_MS, promptIdleMs, TERMINATED_PROMPT_IDLE_MS, WEAK_PROMPT_IDLE_MS, type PromptKind } from "./prompts.ts";
import { killProcess, killTree, protectedReason, systemProcesses, type RootOwner, type SystemProcess } from "./processTree.ts";

export { buildCommandLine, buildScript, EPILOGUE, PROLOGUE } from "./powershell.ts";

export const TERMINAL_SERVER = "jarvis_terminal";
export const RUN_COMMAND = "run_command";
export const LIST_PROCESSES = "list_processes";
export const STOP_PROCESS = "stop_process";

export const DEFAULT_WAIT_SEC = 30;
export const MAX_WAIT_SEC = 300;
/** Procesos vivos a la vez. */
export const MAX_LIVE_PROCESSES = 8;
/**
 * Largo máximo de `command`: el mismo tope con el que el manifiesto lo registra en el contexto (`argCaps`). Un comando más largo lo ejecutaría entero pero
 * el usuario (al confirmar), la revisión (D3) y el verificador solo verían el principio.
 */
export const MAX_COMMAND_CHARS = argCapsOf(TERMINAL_SERVER, RUN_COMMAND).command ?? 1000;
export const MAX_INPUT_CHARS = 1000;
/** Cuánto se espera a que cierren los flujos de un proceso que ya terminó (un hijo puede heredarlos). */
const CLOSE_GRACE_MS = 300;
/** Veces que se intenta escribir el archivo de ayudas antes de seguir sin ellas el resto de la sesión. */
const MAX_HELPERS_ATTEMPTS = 3;
/** Plazo para que el sistema arranque PowerShell. */
const SPAWN_TIMEOUT_MS = 15_000;
/** Lápidas de procesos terminados que se recuerdan a la vez (ver `ended`). */
const MAX_ENDED = 64;
/** Un proceso terminado cuya salida nadie leyó, o su lápida, se olvida pasado este tiempo. */
const RETAIN_FINISHED_MS = 10 * 60 * 1000;
const SAFETY_MARGIN_MS = 5000;
/** Reserva de la cabecera y las notas dentro del tope del resumen. */
const HEADER_RESERVE = 320;
/** Una secuencia de escape que quedó partida al final de un fragmento se retiene hasta este largo. */
const MAX_ESCAPE_CARRY = 64;

/** El mensaje de PowerShell cuando algo quiso preguntar en modo no interactivo (inglés y español). */
const NON_INTERACTIVE = /NonInteractive mode|modo no interactivo/i;

type WaitResult = "finished" | "waiting_input" | "running" | "cancelled";

interface StreamState {
  readonly decoder: OutputDecoder;
  readonly lines: LineAssembler;
  /** Secuencia de escape incompleta al final del último fragmento. */
  escapeCarry: string;
  /** Número de orden (`Tracked.seq`) de la última vez que cambió la línea abierta y de la última línea completa. */
  currentSeq: number;
  completedSeq: number;
  chars: number;
}

interface Tracked {
  readonly pid: number;
  readonly taskId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly command: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly spawnMs: number;
  readonly buffer: OutputBuffer;
  readonly events: EventEmitter;
  readonly streams: readonly [StreamState, StreamState];
  /** Contador de fragmentos recibidos: ordena la actividad de los dos flujos sin depender del reloj. */
  seq: number;
  /** `seq` en el momento de la última respuesta (`input`): lo anterior ya se respondió y no puede volver a tomarse por un prompt. */
  answeredSeq: number;
  lastOutputAt: number;
  totalChars: number;
  /** La tarea que lo lanzó se completó y lo dejó corriendo: ninguna otra tarea lo puede continuar, su salida no se guarda y es lo primero que se cierra si hace falta lugar. */
  orphan: boolean;
  exitCode: number | null;
  /** El proceso terminó y sus flujos se cerraron (o venció el plazo de gracia). */
  done: boolean;
  /** Terminó, pero otro proceso que lanzó heredó su salida y la mantiene abierta: lo que escriba ya no se recoge. */
  detached: boolean;
  endedAt: number | null;
  /** Se lanzó cargando las ayudas de PowerShell. */
  readonly usesHelpers: boolean;
  /** Las ayudas no se pudieron cargar y el proceso salió sin correr el comando (`HELPERS_UNAVAILABLE_EXIT`). */
  helpersUnavailable: boolean;
  /** El prompt que se devolvió en `waiting_input` y que todavía no se respondió (nada escrito después): lo muestra `list_processes`. */
  waitingPrompt: string | null;
}

/** Lo que se recuerda de un proceso terminado cuya salida ya se entregó. */
interface Ended {
  readonly taskId: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly endedAt: number;
  /** Lo cortó `stop_process` (no terminó solo). */
  readonly stopped: boolean;
}

interface PromptCandidate {
  readonly text: string;
  readonly terminated: boolean;
}

const RUN_COMMAND_TOOL: MCPTool = {
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

const LIST_PROCESSES_TOOL: MCPTool = {
  name: LIST_PROCESSES,
  description: "List the processes started with run_command, or with all=true every process on the computer.",
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "List every process on the computer (name, pid, memory) instead of the ones started with run_command." },
    },
    additionalProperties: false,
  },
};

const STOP_PROCESS_TOOL: MCPTool = {
  name: STOP_PROCESS,
  description: "Stop a running process by its pid.",
  inputSchema: {
    type: "object",
    properties: { pid: { type: "integer", description: "Process id to stop." } },
    required: ["pid"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [RUN_COMMAND_TOOL, LIST_PROCESSES_TOOL, STOP_PROCESS_TOOL];

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", ...data }, isError: true });

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** Dónde empieza una secuencia de escape que quedó sin terminar al final de `text`, o `-1`. */
function openEscapeAt(text: string): number {
  const at = text.lastIndexOf("\u001b");
  if (at < 0 || text.length - at > MAX_ESCAPE_CARRY) return -1;
  const rest = text.slice(at);
  // Terminada: CSI con su letra final, OSC con BEL o ST, o un escape de dos caracteres.
  if (/^\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/.test(rest)) return -1;
  return at;
}

export interface TerminalOptions {
  /** Directorio de trabajo de un comando nuevo sin `cwd`. Por defecto, la carpeta personal del usuario. */
  readonly defaultCwd?: string;
  /** Solo para pruebas: otra plataforma. */
  readonly platform?: NodeJS.Platform;
  /** Procesos vivos a la vez (por defecto `MAX_LIVE_PROCESSES`). */
  readonly maxLive?: number;
  /** Variables de entorno que NO hereda el comando (sin distinguir mayúsculas): `server.ts` pasa las que cargó de `.env`. */
  readonly envRemove?: readonly string[];
  /** Ayudas de PowerShell (`Read-Host` respondible y envoltorios; `powershell.ts`). Por defecto, sí; con `false`, PowerShell como antes de tenerlas. */
  readonly helpers?: boolean;
  /** Carpeta del archivo de ayudas (por defecto, `jarvis-terminal` en la carpeta temporal del usuario). */
  readonly helpersDir?: string;
  /** Dentro de las ayudas, los envoltorios de las herramientas del sistema que escriben en la página OEM/ANSI. Por defecto, sí. */
  readonly legacyTools?: boolean;
  /** Páginas de códigos para decodificar lo que no llega en UTF-8. Por defecto, las del sistema. */
  readonly codePages?: CodePages;
  /** Silencios de la detección de prompts (`prompts.ts`), en milisegundos. */
  readonly promptIdleMs?: number;
  readonly weakPromptIdleMs?: number;
  readonly terminatedPromptIdleMs?: number;
}

export class TerminalProvider implements ToolProvider {
  readonly name = TERMINAL_SERVER;
  readonly version = "1.1.0";
  private readonly procs = new Map<number, Tracked>();
  /** Procesos terminados cuya salida ya se entregó (por `pid`, del más viejo al más nuevo): una continuación tardía responde `finished`, no "no existe". */
  private readonly ended = new Map<number, Ended>();
  private readonly defaultCwd: string;
  private readonly platform: NodeJS.Platform;
  private readonly maxLive: number;
  private readonly envRemove: ReadonlySet<string>;
  private readonly legacyTools: boolean;
  private readonly codePages: CodePages | undefined;
  private readonly idle: { readonly prompt: number; readonly weak: number; readonly terminated: number };
  /** Lanzamientos en curso: ocupan lugar antes de existir, para que dos llamadas simultáneas no pasen juntas el tope de procesos vivos. */
  private starting = 0;
  /** Ruta del archivo de ayudas (`undefined`: todavía no se escribió; `null`: no se pudo). */
  private helpersFile: string | null | undefined;
  /** Veces que no se pudo escribir el archivo de ayudas; al llegar a `MAX_HELPERS_ATTEMPTS` se deja de intentar. */
  private helpersWriteFailures = 0;
  /** Las ayudas fallaron al cargarse una vez: no se vuelven a intentar en esta sesión. */
  private helpersDisabled: boolean;
  private readonly helpersDir: string | undefined;

  constructor(options: TerminalOptions = {}) {
    this.defaultCwd = options.defaultCwd ?? os.homedir();
    this.platform = options.platform ?? process.platform;
    this.maxLive = options.maxLive ?? MAX_LIVE_PROCESSES;
    this.envRemove = new Set((options.envRemove ?? []).map((k) => k.toLowerCase()));
    this.legacyTools = options.legacyTools ?? true;
    this.helpersDisabled = options.helpers === false;
    this.helpersDir = options.helpersDir;
    this.codePages = options.codePages;
    this.idle = {
      prompt: options.promptIdleMs ?? PROMPT_IDLE_MS,
      weak: options.weakPromptIdleMs ?? WEAK_PROMPT_IDLE_MS,
      terminated: options.terminatedPromptIdleMs ?? TERMINATED_PROMPT_IDLE_MS,
    };
  }

  /** Solo en Windows: en otra plataforma no hay herramientas que ofrecer (el destino `terminal` no se ofrece; ver `routesWithTools` en el motor). */
  async listTools(): Promise<MCPTool[]> {
    return this.platform === "win32" ? [...TOOLS] : [];
  }

  isConnected(): boolean {
    return this.platform === "win32";
  }

  async reconnect(): Promise<void> { }

  async close(): Promise<void> {
    await this.killAll(() => true);
    this.ended.clear();
  }

  async onTaskEnd(taskId: string, outcome: TaskEndOutcome): Promise<void> {
    if (outcome === "completed") {
      const left: string[] = [];
      for (const t of this.procs.values()) {
        if (t.taskId !== taskId) continue;
        if (t.done) {
          this.procs.delete(t.pid); // nadie lo va a leer
          continue;
        }
        t.orphan = true;
        t.buffer.take(); // ni lo leído ni lo que venga: nadie lo va a leer
        left.push(`${t.pid} (${t.command.replace(/\s+/g, " ").slice(0, 80)})`);
      }
      if (left.length > 0) console.log(`[Terminal] la tarea ${taskId} terminó y dejó ${left.length} proceso(s) corriendo: ${left.join("; ")}.`);
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
    if (!TOOLS.some((t) => t.name === name)) return fail(`Unknown tool: '${name}'.`);
    if (this.platform !== "win32") return fail(`${name} only works on Windows (PowerShell).`);
    this.purge();
    if (name === LIST_PROCESSES) return this.listProcesses(args, options);
    if (name === STOP_PROCESS) return this.stopProcess(args, options);

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
      if (command.length > MAX_COMMAND_CHARS) {
        return fail(`The command is longer than ${MAX_COMMAND_CHARS} characters. Use a shorter command, or split the work into several commands.`);
      }
      if (input !== undefined) return fail("'input' is only used together with 'pid'.");
      const cwdArg = args.cwd;
      // `undefined` y `null` (un parámetro opcional sin valor) valen como ausentes; un texto en blanco también.
      if (cwdArg !== undefined && cwdArg !== null && typeof cwdArg !== "string") return fail("'cwd' must be a text.");
      const cwd = typeof cwdArg === "string" && cwdArg.trim() !== "" ? cwdArg : undefined;
      if (cwd !== undefined && !path.isAbsolute(cwd)) return fail(`'cwd' must be an absolute path: '${cwd}'.`);
      return this.start(command, cwd ?? this.defaultCwd, waitMs, options);
    }
    if (input !== undefined && input.length > MAX_INPUT_CHARS) return fail(`The input is longer than ${MAX_INPUT_CHARS} characters.`);
    return this.resume(pid as number, input, waitMs, options);
  }

  // ───────────────────────── Lanzar ─────────────────────────

  private liveCount(): number {
    let n = this.starting;
    for (const p of this.procs.values()) if (!p.done) n++;
    return n;
  }

  private async start(command: string, cwd: string, waitMs: number, options: ToolCallOptions): Promise<MCPCallResult> {
    const taskId = options.taskId ?? "";
    try {
      if (!fs.statSync(cwd).isDirectory()) return fail(`'${cwd}' is not a folder.`);
    } catch {
      return fail(`The working folder '${cwd}' does not exist.`);
    }
    // El lugar se reserva antes del primer `await`: dos lanzamientos simultáneos no pueden pasar juntos el tope.
    this.starting++;
    let tracked: Tracked;
    try {
      if (this.liveCount() > this.maxLive) {
        // Lo que dejó una tarea ya completada no lo puede continuar nadie: se cierra el más antiguo para hacer lugar. Lo de una tarea en curso nunca se toca.
        const oldest = [...this.procs.values()].filter((p) => !p.done && p.orphan).sort((a, b) => a.startedAt - b.startedAt)[0];
        if (oldest !== undefined) {
          console.log(`[Terminal] se cierra el proceso ${oldest.pid} de la tarea ${oldest.taskId} (completada) para hacer lugar.`);
          await this.dispose(oldest);
        }
      }
      if (this.liveCount() > this.maxLive) {
        return fail(`${this.maxLive} processes are already running: wait for one to finish before starting another.`);
      }
      tracked = await this.spawnProcess(command, cwd, taskId, this.helpersPath());
    } catch (error) {
      return fail(`Could not start PowerShell: ${errorMessage(error)}`);
    } finally {
      this.starting--;
    }
    const result = await this.settle(tracked, waitMs, options.signal, { started: true });
    if (!tracked.helpersUnavailable) return result;
    // Las ayudas no se cargaron (el comando no llegó a correr): se apagan para el resto de la sesión y se relanza sin ellas, como antes de tenerlas.
    if (this.helpersFile && !fs.existsSync(this.helpersFile)) {
      this.helpersFile = undefined; // alguien borró el archivo (limpieza de temporales): se vuelve a escribir
    } else {
      console.warn("[Terminal] no se pudieron cargar las ayudas de PowerShell (Read-Host, herramientas del sistema): se sigue sin ellas.");
      this.helpersDisabled = true;
    }
    return this.start(command, cwd, waitMs, options);
  }

  /** Archivo de ayudas de PowerShell (`powershell.ts`), o `null` si están apagadas o no se pudo escribir. */
  private helpersPath(): string | null {
    if (this.helpersDisabled) return null;
    if (this.helpersFile === undefined || (this.helpersFile === null && this.helpersWriteFailures < MAX_HELPERS_ATTEMPTS)) {
      this.helpersFile = ensureHelpersFile(this.legacyTools, this.helpersDir);
      if (this.helpersFile === null) {
        this.helpersWriteFailures++;
        const left = MAX_HELPERS_ATTEMPTS - this.helpersWriteFailures;
        console.warn(
          `[Terminal] no se pudo escribir el archivo de ayudas de PowerShell (Read-Host, herramientas del sistema): el comando corre sin ellas${left > 0 ? `; se reintenta (${left} más)` : "; no se vuelve a intentar en esta sesión"}.`,
        );
      }
    }
    return this.helpersFile;
  }

  /** El entorno del comando: el de Jarvis sin las variables excluidas, y Python con su entrada y salida en UTF-8 y sin búfer (si el usuario no dijo otra cosa). */
  private environment(): NodeJS.ProcessEnv {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !this.envRemove.has(key.toLowerCase())) env[key] = value;
    }
    const has = (name: string): boolean => Object.keys(env).some((k) => k.toLowerCase() === name.toLowerCase());
    if (!has("PYTHONIOENCODING")) env.PYTHONIOENCODING = "utf-8";
    if (!has("PYTHONUNBUFFERED")) env.PYTHONUNBUFFERED = "1";
    return env;
  }

  private spawnProcess(command: string, cwd: string, taskId: string, helpers: string | null): Promise<Tracked> {
    const requestedAt = Date.now();
    const pages = this.codePages ?? systemCodePages();
    const fallback = legacyDecoder(pages.oem, pages.ansi);
    return new Promise((resolve, reject) => {
      const args = [...POWERSHELL_ARGS, buildCommandLine(command, { helpers: helpers !== null })];
      const env = this.environment();
      if (helpers !== null) env[HELPERS_ENV] = helpers;
      const child = spawn("powershell.exe", args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`el sistema no arrancó PowerShell en ${SPAWN_TIMEOUT_MS / 1000} s.`));
      }, SPAWN_TIMEOUT_MS);
      timer.unref();
      child.stdin.on("error", () => { });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const pid = child.pid;
        if (pid === undefined) return reject(new Error("el sistema no devolvió el id del proceso."));
        const stream = (): StreamState => ({ decoder: new OutputDecoder(fallback), lines: new LineAssembler(), escapeCarry: "", currentSeq: 0, completedSeq: 0, chars: 0 });
        const now = Date.now();
        const t: Tracked = {
          pid,
          taskId,
          child,
          command,
          cwd,
          startedAt: now,
          spawnMs: now - requestedAt,
          buffer: new OutputBuffer(),
          events: new EventEmitter(),
          streams: [stream(), stream()],
          seq: 0,
          answeredSeq: 0,
          lastOutputAt: now,
          totalChars: 0,
          orphan: false,
          exitCode: null,
          done: false,
          detached: false,
          endedAt: null,
          usesHelpers: helpers !== null,
          helpersUnavailable: false,
          waitingPrompt: null,
        };
        this.procs.set(pid, t);
        this.collect(t);
        resolve(t);
      });
    });
  }

  /** Recoge stdout y stderr (cada uno con su decodificador y sus líneas) en un único búfer ordenado por líneas, y vigila el fin del proceso. */
  private collect(t: Tracked): void {
    const receive = (s: StreamState, decoded: string, final = false): void => {
      let text = s.escapeCarry + decoded;
      s.escapeCarry = "";
      if (!final) {
        const at = openEscapeAt(text);
        if (at >= 0) {
          s.escapeCarry = text.slice(at);
          text = text.slice(0, at);
        }
      }
      const clean = cleanTerminalText(text);
      if (clean.length === 0) return;
      const ready = s.lines.push(clean);
      t.seq++;
      s.currentSeq = t.seq;
      if (ready.includes("\n")) s.completedSeq = t.seq;
      s.chars += clean.length;
      t.totalChars += clean.length;
      if (!t.orphan) t.buffer.append(ready);
      t.waitingPrompt = null;
      t.lastOutputAt = Date.now();
      t.events.emit("activity");
    };
    [t.child.stdout, t.child.stderr].forEach((stream, i) => {
      const s = t.streams[i];
      stream.on("data", (chunk: Buffer) => receive(s, s.decoder.write(chunk)));
    });

    let finished = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer);
      graceTimer = undefined;
      for (const s of t.streams) {
        receive(s, s.decoder.end(), true);
        const rest = s.lines.end();
        if (!t.orphan) t.buffer.append(rest);
      }
      t.done = true;
      t.endedAt = Date.now();
      t.events.emit("activity");
    };
    // Sin código (el proceso lo cortó alguien desde fuera): -1, para que no se lea como una salida limpia.
    t.child.once("exit", (code) => {
      t.exitCode = code ?? -1;
      if (finished) return;
      graceTimer = setTimeout(() => {
        if (finished) return;
        // Los flujos siguen abiertos: un proceso que lanzó el comando los heredó y sigue vivo. Se sueltan (no se recoge más) y se avisa.
        t.detached = true;
        t.child.stdout.destroy();
        t.child.stderr.destroy();
        finish();
      }, CLOSE_GRACE_MS);
      graceTimer.unref();
    });
    t.child.once("close", (code) => {
      if (t.exitCode === null) t.exitCode = code ?? -1;
      finish();
    });
  }

  // ───────────────────────── Continuar ─────────────────────────

  private async resume(pid: number, input: string | undefined, waitMs: number, options: ToolCallOptions): Promise<MCPCallResult> {
    const taskId = options.taskId ?? "";
    const t = this.procs.get(pid);
    if (t === undefined || t.taskId !== taskId) {
      // Ya terminó y su salida se entregó en una llamada anterior de esta tarea: sigue terminado (no es un pid desconocido).
      const ended = this.ended.get(pid);
      if (ended !== undefined && ended.taskId === taskId) return this.endedResult(pid, ended, input !== undefined);
      return fail(`Process ${pid} does not exist or was not started by this task.`, { pid, state: "unknown_pid" });
    }
    let ignoredInput = false;
    if (input !== undefined) {
      if (t.done) {
        ignoredInput = true;
      } else {
        // Lo escrito hasta acá era el prompt que se está respondiendo: no puede volver a tomarse por uno nuevo.
        t.answeredSeq = t.seq;
        t.waitingPrompt = null;
        for (const s of t.streams) {
          const rest = s.lines.closeAnswered();
          if (!t.orphan) t.buffer.append(rest);
        }
        t.lastOutputAt = Date.now();
        t.child.stdin.write(`${input}\r\n`);
      }
    }
    return this.settle(t, waitMs, options.signal, { ignoredInput });
  }

  // ───────────────────────── Esperar y responder ─────────────────────────

  private async settle(t: Tracked, waitMs: number, signal: AbortSignal | undefined, flags: { started?: boolean; ignoredInput?: boolean }): Promise<MCPCallResult> {
    const waitStarted = Date.now();
    const waited = await this.waitFor(t, waitMs, signal);
    const state = waited.state;
    if (state === "cancelled") {
      await this.dispose(t);
    }
    // Lo que quedó en una línea sin terminar (un prompt, un avance) también se entrega.
    if (!t.done) for (const s of t.streams) t.buffer.append(s.lines.flushPartial());
    const { text: output, omitted } = t.buffer.take();
    const prompt = state === "waiting_input" ? waited.prompt?.text.trim() : undefined;
    if (prompt !== undefined) t.waitingPrompt = prompt;
    const durationMs = (t.endedAt ?? Date.now()) - t.startedAt;
    const exitCode = state === "finished" ? t.exitCode : null;
    if (state === "finished") this.forget(t);
    if (state === "finished" && t.usesHelpers && exitCode === HELPERS_UNAVAILABLE_EXIT && output.includes(HELPERS_UNAVAILABLE)) {
      t.helpersUnavailable = true;
    }

    const header = [
      `status: ${state}`,
      ...(exitCode !== null ? [`exit code: ${exitCode}`] : []),
      `duration: ${seconds(durationMs)}`,
      `pid: ${t.pid}`,
      // La carpeta en la que corrió un comando nuevo: el modelo no sabe cuál es la de por defecto.
      ...(flags.started === true ? [`cwd: ${t.cwd}`] : []),
    ].join(" · ");
    const notes: string[] = [];
    if (flags.ignoredInput === true) notes.push("The input was ignored: the process had already finished.");
    // Frases llanas para los modelos chicos: el estado y el código de salida no alcanzan para que un verificador o un generador de argumentos entienda qué pasó o qué hacer.
    if (state === "finished" && exitCode !== null) notes.push(exitCode === 0 ? "The command finished successfully." : `The command failed (exit code ${exitCode}).`);
    if (state === "waiting_input") {
      notes.push(`Waiting for input: "${prompt}". The user is asked for the answer; then continue THIS process with run_command { "pid": ${t.pid}, "input": <the answer> }. Do not start a new command.`);
    }
    if (state === "running") notes.push(`The process is still running. Call run_command with { "pid": ${t.pid} } to read more output.`);
    if (NON_INTERACTIVE.test(output)) {
      notes.push("PowerShell runs without interaction: confirmation (-Confirm), credential and missing-parameter prompts fail. Pass the values as parameters, or add -Confirm:$false or -Force.");
    }
    if (t.detached && state === "finished") notes.push("A program started by this command is still running in the background; its output is not captured.");

    const cap = Math.max(BUDGET.summaryMax - HEADER_RESERVE, 400);
    const head = Math.floor(cap * 0.2);
    const empty = state === "finished" && t.totalChars === 0 ? "(no output)" : "(no new output)";
    const body = output.length === 0 ? empty : headTailNeutral(output, head, cap - head - 50).text;
    const text = [header, ...notes, body].join("\n");

    const legacy = t.streams[0].decoder.legacyChunks + t.streams[1].decoder.legacyChunks;
    return toolResult({
      text,
      raw: output,
      data: { state, pid: t.pid, exitCode, durationMs, ...(prompt === undefined ? {} : { prompt }), rawTruncated: omitted > 0, ...(t.detached ? { detached: true } : {}) },
      meta: {
        waitLimitMs: waitMs,
        waitedMs: Date.now() - waitStarted,
        ...(flags.started === true ? { command: t.command.slice(0, 300), cwd: t.cwd, spawnMs: t.spawnMs } : {}),
        ...(waited.prompt === undefined ? {} : { promptKind: waited.kind, promptTerminated: waited.prompt.terminated }),
        outputChars: { stdout: t.streams[0].chars, stderr: t.streams[1].chars },
        ...(legacy > 0 ? { legacyDecodedChunks: legacy } : {}),
      },
    });
  }

  private waitFor(t: Tracked, ms: number, signal: AbortSignal | undefined): Promise<{ state: WaitResult; prompt?: PromptCandidate; kind?: PromptKind }> {
    return new Promise((resolve) => {
      let idleTimer: NodeJS.Timeout | undefined;
      let deadline: NodeJS.Timeout | undefined;
      let settled = false;

      const finish = (state: WaitResult, prompt?: PromptCandidate, kind?: PromptKind): void => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(deadline);
        t.events.off("activity", evaluate);
        signal?.removeEventListener("abort", onAbort);
        resolve(prompt === undefined ? { state } : { state, prompt, kind });
      };
      const onAbort = (): void => finish("cancelled");
      const evaluate = (): void => {
        if (t.done) return finish("finished");
        clearTimeout(idleTimer);
        const candidate = this.promptCandidate(t);
        if (candidate === null) return;
        const kind = classifyPrompt(candidate.text, candidate.terminated);
        const need = promptIdleMs(kind, candidate.terminated, this.idle);
        if (need === null) return;
        // Cualquier salida nueva vuelve a evaluar (y cancela este temporizador): si se cumple, nada cambió en el silencio pedido.
        idleTimer = setTimeout(() => (t.done ? finish("finished") : finish("waiting_input", candidate, kind)), Math.max(need - (Date.now() - t.lastOutputAt), 0));
      };

      if (signal?.aborted) return finish("cancelled");
      deadline = setTimeout(() => finish("running"), ms);
      signal?.addEventListener("abort", onAbort, { once: true });
      t.events.on("activity", evaluate);
      evaluate();
    });
  }

  /**
   * La línea que podría ser un prompt: la línea abierta (sin salto) más reciente de los dos flujos; si no hay, la última línea completa. Solo cuenta lo
   * escrito después de la última respuesta.
   */
  private promptCandidate(t: Tracked): PromptCandidate | null {
    const open = t.streams
      .filter((s) => s.currentSeq > t.answeredSeq && !s.lines.currentIsLong && s.lines.current.trim() !== "")
      .sort((a, b) => b.currentSeq - a.currentSeq)[0];
    if (open !== undefined) return { text: open.lines.current, terminated: false };
    const last = t.streams.filter((s) => s.completedSeq > t.answeredSeq && s.lines.lastCompleted !== "").sort((a, b) => b.completedSeq - a.completedSeq)[0];
    return last === undefined ? null : { text: last.lines.lastCompleted, terminated: true };
  }

  // ───────────────────────── Cierre ─────────────────────────

  /** Corta el árbol del proceso y espera a que termine (con tope). */
  private async dispose(t: Tracked): Promise<void> {
    this.procs.delete(t.pid);
    if (t.done) return;
    await killTree(t.pid);
    await new Promise<void>((resolve) => {
      if (t.done) return resolve();
      const end = (): void => {
        clearTimeout(timer);
        t.events.off("activity", check);
        resolve();
      };
      const check = (): void => {
        if (t.done) end();
      };
      const timer = setTimeout(end, 2000);
      t.events.on("activity", check);
    });
  }

  private async killAll(filter: (t: Tracked) => boolean): Promise<number> {
    const targets = [...this.procs.values()].filter((t) => !t.done && filter(t));
    await Promise.allSettled(targets.map((t) => this.dispose(t)));
    for (const t of [...this.procs.values()]) if (filter(t) && t.done) this.procs.delete(t.pid);
    return targets.length;
  }

  /** Un proceso terminado cuya salida ya se entregó deja de seguirse; queda su lápida (tarea, código, duración) para responder una continuación tardía. */
  private forget(t: Tracked, stopped = false): void {
    this.procs.delete(t.pid);
    this.ended.delete(t.pid);
    this.ended.set(t.pid, {
      taskId: t.taskId,
      exitCode: t.exitCode ?? -1,
      durationMs: (t.endedAt ?? Date.now()) - t.startedAt,
      endedAt: t.endedAt ?? Date.now(),
      stopped,
    });
    for (const oldest of this.ended.keys()) {
      if (this.ended.size <= MAX_ENDED) break;
      this.ended.delete(oldest);
    }
  }

  // ───────────────────────── list_processes y stop_process ─────────────────────────

  /**
   * Los procesos de `run_command` que ve una tarea: los suyos y los que dejaron corriendo tareas ya completadas (huérfanos). Los de otra tarea en curso
   * no se ven.
   */
  private visibleTo(taskId: string): Tracked[] {
    return [...this.procs.values()].filter((t) => t.taskId === taskId || t.orphan).sort((a, b) => a.startedAt - b.startedAt);
  }

  /** `list_processes`: los procesos de `run_command` (con su estado) o, con `all`, todos los de la PC. */
  private async listProcesses(args: Record<string, unknown>, options: ToolCallOptions): Promise<MCPCallResult> {
    if (args.all !== undefined && typeof args.all !== "boolean") return fail("'all' must be true or false.");
    const taskId = options.taskId ?? "";
    if (args.all === true) {
      let table: SystemProcess[];
      try {
        table = await systemProcesses();
      } catch (error) {
        return fail(`Could not read the list of processes: ${errorMessage(error)}`);
      }
      const rows = [...table].sort((a, b) => b.memoryBytes - a.memoryBytes);
      const lines = rows.map((p) => `pid ${p.pid} · ${p.name} · ${Math.round(p.memoryBytes / 1048576)} MB`);
      const header = `status: listed · ${rows.length} processes on this computer, by memory in use`;
      const cap = Math.max(BUDGET.summaryMax - HEADER_RESERVE, 400);
      // Solo filas completas: cortar por caracteres dejaba una última fila con la cifra truncada (`node.exe · 7` en vez de `· 72 MB`).
      let shown = 0;
      for (let used = 0; shown < lines.length; shown++) {
        used += lines[shown].length + (shown > 0 ? 1 : 0);
        if (used > cap - 50) break;
      }
      const omitted = lines.length - shown;
      return toolResult({
        text: [header, ...lines.slice(0, shown), ...(omitted > 0 ? [omissionMarker(omitted, "procesos")] : [])].join("\n"),
        raw: [header, ...lines].join("\n"),
        data: { state: "listed", scope: "system", count: rows.length },
      });
    }
    const now = Date.now();
    const visible = this.visibleTo(taskId);
    const describe = (t: Tracked): string => {
      const state = t.done
        ? `finished (exit code ${t.exitCode ?? -1}), output not read yet`
        : t.waitingPrompt !== null
          ? `waiting for input: "${t.waitingPrompt}"`
          : "running";
      const owner = t.taskId === taskId ? "this task" : "left running by an earlier task";
      return `pid ${t.pid} · ${state} · ${seconds((t.endedAt ?? now) - t.startedAt)} · ${owner} · ${t.command.replace(/\s+/g, " ").slice(0, 120)}`;
    };
    const header = `status: listed · ${visible.length} process(es) started with run_command`;
    const body = visible.length === 0 ? "No process started with run_command is running." : visible.map(describe).join("\n");
    return toolResult({
      text: `${header}\n${body}`,
      raw: `${header}\n${body}`,
      data: {
        state: "listed",
        scope: "run_command",
        count: visible.length,
        processes: visible.map((t) => ({ pid: t.pid, done: t.done, waiting: t.waitingPrompt !== null, ownTask: t.taskId === taskId, command: t.command.slice(0, 300) })),
      },
    });
  }

  /**
   * `stop_process`: corta un proceso. Uno de `run_command` que la tarea ve (suyo o huérfano) se corta con todo lo que lanzó y se devuelve lo que había
   * escrito sin leer. Cualquier otro proceso de la PC se corta solo (sin su árbol), salvo los protegidos (`protectedReason`): críticos de Windows,
   * Jarvis y lo suyo, y lo de otra tarea en curso.
   */
  private async stopProcess(args: Record<string, unknown>, options: ToolCallOptions): Promise<MCPCallResult> {
    const pid = args.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return fail("'pid' must be a positive integer.");
    const taskId = options.taskId ?? "";
    const tracked = this.procs.get(pid);
    if (tracked !== undefined) {
      if (tracked.taskId !== taskId && !tracked.orphan) return fail(`Process ${pid} belongs to another task that is still running.`, { pid });
      if (tracked.done) {
        const exit = tracked.exitCode ?? -1;
        this.forget(tracked);
        return toolResult({
          text: `status: not_running · pid: ${pid}\nThe process had already finished (exit code ${exit}); there was nothing to stop.`,
          raw: "",
          data: { state: "not_running", pid, scope: "run_command" },
        });
      }
      await this.dispose(tracked);
      for (const s of tracked.streams) tracked.buffer.append(s.lines.flushPartial());
      const { text: output } = tracked.buffer.take();
      if (tracked.taskId === taskId) this.forget(tracked, true);
      const cap = Math.max(BUDGET.summaryMax - HEADER_RESERVE, 400);
      const lines = [
        `status: stopped · duration: ${seconds(Date.now() - tracked.startedAt)} · pid: ${pid}`,
        `The process and everything it started were stopped: ${tracked.command.replace(/\s+/g, " ").slice(0, 120)}`,
        output.trim() === "" ? "(no unread output)" : `Unread output:\n${headTailNeutral(output, Math.floor(cap * 0.2), Math.floor(cap * 0.6)).text}`,
      ];
      return toolResult({ text: lines.join("\n"), raw: output, data: { state: "stopped", pid, scope: "run_command" } });
    }
    const ended = this.ended.get(pid);
    if (ended !== undefined && ended.taskId === taskId) {
      return toolResult({
        text: `status: not_running · pid: ${pid}\nThe process had already ${ended.stopped ? "been stopped" : `finished (exit code ${ended.exitCode})`}; there was nothing to stop.`,
        raw: "",
        data: { state: "not_running", pid, scope: "run_command" },
      });
    }
    let table: SystemProcess[];
    try {
      table = await systemProcesses();
    } catch (error) {
      return fail(`Could not read the list of processes to check ${pid}: ${errorMessage(error)}`, { pid });
    }
    const target = table.find((p) => p.pid === pid);
    if (target === undefined) return fail(`No process with pid ${pid} is running.`, { pid, state: "unknown_pid" });
    const roots = new Map<number, RootOwner>();
    for (const t of this.procs.values()) if (!t.done) roots.set(t.pid, t.taskId === taskId || t.orphan ? "caller" : "other_task");
    const refusal = protectedReason(target, table, roots);
    if (refusal !== null) return fail(`Process ${pid} (${target.name}) cannot be stopped: ${refusal}`, { pid, state: "protected" });
    if (!(await killProcess(pid))) return fail(`Could not stop process ${pid} (${target.name}): it may need administrator rights.`, { pid });
    return toolResult({
      text: `status: stopped · pid: ${pid}\nThe process ${target.name} was stopped (only that process, not the programs it started).`,
      raw: "",
      data: { state: "stopped", pid, name: target.name, scope: "system" },
    });
  }

  /** Una continuación de un proceso que ya terminó y cuya salida ya se entregó: `finished` con su código, sin salida nueva. */
  private endedResult(pid: number, ended: Ended, withInput: boolean): MCPCallResult {
    if (ended.stopped) {
      const text = [
        `status: stopped · duration: ${seconds(ended.durationMs)} · pid: ${pid}`,
        ...(withInput ? ["The input was ignored: the process is not running."] : []),
        "This process was stopped with stop_process; there is nothing to continue.",
      ].join("\n");
      return toolResult({ text, raw: "", data: { state: "stopped", pid, durationMs: ended.durationMs, alreadyReported: true }, meta: { waitLimitMs: 0, waitedMs: 0 } });
    }
    const header = `status: finished · exit code: ${ended.exitCode} · duration: ${seconds(ended.durationMs)} · pid: ${pid}`;
    const notes = [
      ...(withInput ? ["The input was ignored: the process had already finished."] : []),
      ended.exitCode === 0 ? "The command finished successfully." : `The command failed (exit code ${ended.exitCode}).`,
      "This process had already finished; its output was returned by an earlier call.",
    ];
    return toolResult({
      text: [header, ...notes, "(no new output)"].join("\n"),
      raw: "",
      // Sin `exitCode` en `data`: el código ya lo señaló la llamada que entregó la salida (con él, el núcleo registraría un segundo `tool_error` por el mismo
      // fallo). Queda en el texto, para que el modelo lo vea.
      data: { state: "finished", pid, durationMs: ended.durationMs, rawTruncated: false, alreadyReported: true },
      meta: { waitLimitMs: 0, waitedMs: 0 },
    });
  }

  /** Olvida los procesos terminados que nadie volvió a leer (los huérfanos, en cuanto terminan) y las lápidas viejas. */
  private purge(): void {
    const now = Date.now();
    for (const t of this.procs.values()) {
      if (t.done && t.endedAt !== null && (t.orphan || now - t.endedAt > RETAIN_FINISHED_MS)) this.procs.delete(t.pid);
    }
    for (const [pid, ended] of this.ended) if (now - ended.endedAt > RETAIN_FINISHED_MS) this.ended.delete(pid);
  }
}