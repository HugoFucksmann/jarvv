/**
 * JARVIS Core — Pre-chequeo determinista de una llamada candidata (antes de la revisión de Decisión 3).
 *
 * Qué es: reglas de código, sin modelo, sobre los argumentos ya resueltos. Rechazan solo lo que se puede comprobar:
 * valores vacíos o `N/A`, marcadores de posición, rutas de otro usuario, comandos que no existen en este sistema, y rutas o
 * URLs de lectura que no aparecen en nada de lo que la tarea sabe (pedido, respuestas del usuario, llamadas y resultados
 * anteriores). Cada rechazo trae una razón escrita que viaja a la línea FAIL del LLM de argumentos: sin ella el modelo
 * repetía el mismo comando (un `ps aux` se propuso y se rechazó 5 veces seguidas).
 *
 * Principio: ante la duda, silencio. Si la tarea tiene un resultado guardado aparte (`ref`), lo que "no aparece" puede estar
 * en él: esas comprobaciones se omiten. Si el analizador de comandos falla o expira, no se rechaza.
 *
 * Los comandos solo se analizan en Windows (parser de PowerShell); en otros sistemas esa parte no corre.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { TaskContext } from "../ctx/index.ts";
import type { Platform, UserEnvironment } from "../environment.ts";
import { reviewViewOptions } from "./adapters.ts";

const execFileAsync = promisify(execFile);

// ───────────────────────── Tipos ─────────────────────────

export interface PrecheckFinding {
  /** Etiqueta de revisión que se registra: la misma que habría dado Decisión 3. */
  readonly review: "args_invalid" | "info_missing";
  /** Razón en inglés (va al LLM de argumentos). */
  readonly reason: string;
}

export interface PrecheckSources {
  /** Todo lo que la tarea sabe, en minúsculas y con `/` como separador. */
  readonly text: string;
  /** false si hay resultados guardados aparte: lo que no aparece en `text` puede estar ahí. */
  readonly complete: boolean;
}

export interface PrecheckInput {
  readonly tool: string;
  /** `read` o `write` (la política de la herramienta). */
  readonly kind: "read" | "write";
  readonly args: Readonly<Record<string, unknown>>;
  readonly sources: PrecheckSources;
  readonly environment: UserEnvironment;
}

export interface CommandReport {
  readonly syntaxErrors: readonly string[];
  readonly commands: readonly { readonly name: string; readonly kind: string; readonly dashOptions: readonly string[] }[];
}

/** Analiza un comando de PowerShell. Devuelve null si no se pudo analizar (no se rechaza por eso). */
export type CommandAnalyzer = (command: string) => Promise<CommandReport | null>;

// ───────────────────────── Utilidades ─────────────────────────

/** Minúsculas y `/` como separador: la comparación no distingue mayúsculas ni `\` de `/`. */
export function normalizeText(text: string): string {
  return text.split("\\").join("/").toLowerCase();
}

type Role = "path" | "url" | "command" | "text";

const PATH_KEYS = new Set(["path", "source", "src", "destination", "dest", "file", "directory", "dir", "folder", "cwd"]);
const SOURCE_KEYS = new Set(["source", "src", "from"]);
/** Claves cuyo valor puede ser vacío a propósito (un archivo vacío, una tecla Enter). */
export const MAY_BE_EMPTY = new Set(["content", "text", "data", "body", "input"]);

function roleOf(key: string): Role {
  const k = key.toLowerCase();
  if (PATH_KEYS.has(k)) return "path";
  if (k === "url" || k === "urls") return "url";
  if (k === "command") return "command";
  return "text";
}

/** Valores de texto de un argumento (un string, o los strings de un arreglo). */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

const PLACEHOLDER = /<[A-Za-z][\w-]*>|\byour[_ -]|\bexample\.(com|org|net)\b|\/path\/to\b|\bxxx+\b|\bTODO\b|\bplaceholder\b/i;
/** Ruta de Linux dentro de un comando (`/etc/hosts`, `/usr/bin/…`): no existe en Windows. */
const LINUX_PATH = /(^|[\s'"=])\/(etc|usr|var|home|bin|opt|tmp|proc|sys|dev|mnt)\//;
const SYSTEM_USER_DIRS = new Set(["public", "default", "all users", "default user"]);

// ───────────────────────── Fuentes ─────────────────────────

/** Tope de bytes que se leen de cada ref como fuente: las páginas de `research` pueden ser largas y esto se corre en cada llamada. */
const REF_SOURCE_MAX_BYTES = 400_000;

/** Texto de una ref (el resultado crudo guardado aparte), o `null` si el archivo ya no se puede leer. */
function readRefText(where: string): string | null {
  try {
    const fd = fs.openSync(where, "r");
    try {
      const buffer = Buffer.alloc(REF_SOURCE_MAX_BYTES);
      return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Fuentes de la tarea para las comprobaciones "esto no aparece en nada": pedido, pasos, respuestas del usuario y todas las
 * llamadas, incluido el contenido de sus refs (una búsqueda o una página larga queda casi siempre en una ref: sin leerla, las
 * URLs y rutas que aparecen solo ahí se darían por inventadas, o habría que apagar la comprobación en toda la tarea).
 */
export function collectSources(ctx: TaskContext): PrecheckSources {
  const parts: string[] = [ctx.task.request];
  for (const step of ctx.find("steps", {})) if (step.instruction) parts.push(step.instruction);
  parts.push(JSON.stringify(ctx.view.forReview(reviewViewOptions()).userInput));
  let complete = true;
  for (const call of ctx.find("calls", {})) {
    // Solo lo que se ejecutó bien da origen: los argumentos de un intento rechazado o con `not_found` eran una suposición.
    if (call.status === "ok" && call.args !== null) parts.push(JSON.stringify(call.args));
    if (call.status === "ok" && call.summary !== null) parts.push(call.summary);
    if (call.ref !== null) {
      const ref = ctx.find("refs", {}).find((r) => r.id === call.ref);
      const text = ref === undefined ? null : readRefText(ref.where);
      // Una ref ilegible (archivo borrado) puede contener lo que se busca: sin ella la comprobación no es concluyente.
      if (text === null) complete = false;
      else if (call.status === "ok") parts.push(text);
    }
  }
  return { text: normalizeText(parts.join("\n")), complete };
}

// ───────────────────────── Reglas ─────────────────────────

function userSegment(path: string): string | null {
  const m = /^[a-z]:\/users\/([^/]+)/.exec(path);
  return m === null ? null : m[1];
}

function knownFolders(env: UserEnvironment): string[] {
  return [env.home, env.desktop, env.documents, env.downloads].filter((v): v is string => typeof v === "string").map(normalizeText);
}

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length === 0 ? path : parts[parts.length - 1];
}

/** Ruta de lectura "con origen": aparece completa, es una carpeta conocida (o su ancestro) o su nombre de archivo aparece. */
function pathHasSource(path: string, input: PrecheckInput): boolean {
  const p = normalizeText(path).replace(/\/+$/, "");
  if (input.sources.text.includes(p)) return true;
  if (knownFolders(input.environment).some((f) => f === p || f.startsWith(`${p}/`))) return true;
  return input.sources.text.includes(baseName(p));
}

function normalizeUrl(url: string): string {
  return normalizeText(url).replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function checkValues(input: PrecheckInput): PrecheckFinding | null {
  const home = userSegment(normalizeText(input.environment.home));
  for (const [key, raw] of Object.entries(input.args)) {
    const role = roleOf(key);
    for (const value of stringsOf(raw)) {
      if (value.trim() === "" && !MAY_BE_EMPTY.has(key.toLowerCase())) {
        return { review: "info_missing", reason: `The argument '${key}' is empty: the value it needs is missing from the task.` };
      }
      if (/^n\/a$/i.test(value.trim())) {
        return { review: "info_missing", reason: `The argument '${key}' is 'N/A': the value it needs is missing from the task.` };
      }
      if (role === "text") continue;
      const hit = PLACEHOLDER.exec(value);
      if (hit !== null) {
        return { review: "args_invalid", reason: `The argument '${key}' contains a placeholder ('${hit[0]}'). Use the real value from the task or from earlier results.` };
      }
      if (role === "path" && input.environment.platform === "windows") {
        const seg = userSegment(normalizeText(value));
        if (seg !== null && home !== null && seg !== home && !SYSTEM_USER_DIRS.has(seg)) {
          return {
            review: "args_invalid",
            reason: `The path '${value}' is under another user's folder ('${seg}'). The home folder of this computer is '${input.environment.home}'; use the paths listed in ENV.`,
          };
        }
      }
    }
  }
  return null;
}

function checkSources(input: PrecheckInput): PrecheckFinding | null {
  if (!input.sources.complete) return null;
  for (const [key, raw] of Object.entries(input.args)) {
    const role = roleOf(key);
    const readsIt = role === "path" && (input.kind === "read" || SOURCE_KEYS.has(key.toLowerCase()));
    if (role !== "url" && !readsIt) continue;
    for (const value of stringsOf(raw)) {
      if (value.trim() === "") continue;
      if (role === "url") {
        if (!input.sources.text.includes(normalizeUrl(value))) {
          return { review: "args_invalid", reason: `The URL '${value}' does not appear in the request or in earlier results. Use a URL from the results, or search first.` };
        }
      } else if (!pathHasSource(value, input)) {
        return {
          review: "args_invalid",
          reason: `The path '${value}' does not appear in the request or in earlier results. Use a path from the request or from a listing, or locate the file first.`,
        };
      }
    }
  }
  return null;
}

function checkCommand(report: CommandReport | null, platform: Platform): PrecheckFinding | null {
  if (platform !== "windows" || report === null) return null;
  if (report.syntaxErrors.length > 0) {
    return { review: "args_invalid", reason: `The command has a PowerShell syntax error: ${report.syntaxErrors[0]}` };
  }
  for (const c of report.commands) {
    if (c.kind === "None") {
      return {
        review: "args_invalid",
        reason: `The command '${c.name}' does not exist on this computer (Windows). Use a PowerShell cmdlet or a program installed on Windows that gets the same result.`,
      };
    }
    if (c.dashOptions.length > 0 && /Alias|Cmdlet|Function/.test(c.kind)) {
      return {
        review: "args_invalid",
        reason: `'${c.name}' is a PowerShell command and does not take Linux-style options such as '${c.dashOptions[0]}'. Use its PowerShell parameters (for example Get-Process | Sort-Object WorkingSet -Descending).`,
      };
    }
  }
  return null;
}

/**
 * `powershell -Command "..."` (o `pwsh`, `-c`, con opciones como `-NoProfile` antes): el texto entre comillas lo analiza otro PowerShell,
 * así que el analizador solo ve el comando externo y no encontraría errores de sintaxis del interior. Devuelve ese texto interior, o null
 * si el comando no tiene esa forma.
 */
export function unwrapPowerShellCommand(command: string): string | null {
  const m = /^\s*(?:powershell|pwsh)(?:\.exe)?((?:\s+-(?!c(?:ommand)?\b)[A-Za-z]+(?:\s+(?!-)\S+)?)*)\s+-c(?:ommand)?\s+([\s\S]+)$/i.exec(command);
  if (m === null) return null;
  let inner = m[2].trim();
  const quote = inner[0];
  if ((quote === '"' || quote === "'") && inner.length >= 2 && inner.endsWith(quote)) {
    inner = inner.slice(1, -1);
    if (quote === '"') inner = inner.replace(/\\"/g, '"');
  }
  return inner.trim() === "" ? null : inner;
}

const WRAPPER_REASON =
  "The command is already run in PowerShell: write the PowerShell command directly, without wrapping it in 'powershell -Command'.";

/** Envoltorio `powershell -Command`: se analiza el interior (el error de sintaxis, si lo hay, va primero) y, aunque esté bien, se pide escribirlo sin el envoltorio. */
async function checkWrappedCommand(inner: string, analyze: CommandAnalyzer, platform: Platform): Promise<PrecheckFinding> {
  const found = checkCommand(await analyze(inner), platform);
  return { review: "args_invalid", reason: found === null ? WRAPPER_REASON : `${WRAPPER_REASON} Also: ${found.reason}` };
}

// ───────────────────────── Analizador de comandos (PowerShell) ─────────────────────────

const ANALYZER_TIMEOUT_MS = 8000;

/**
 * Un solo proceso PowerShell: parsea el comando (parser oficial, sin ejecutarlo), lista cada comando que invoca y lo resuelve
 * con `Get-Command`. El comando viaja por una variable de entorno: sin escapes de comillas.
 */
const ANALYZER_SCRIPT = [
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "$tok = $null; $err = $null",
  "$ast = [System.Management.Automation.Language.Parser]::ParseInput($env:JARVIS_COMMAND, [ref]$tok, [ref]$err)",
  "$cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)",
  "$list = @()",
  "foreach ($c in $cmds) {",
  "  $name = $c.GetCommandName(); if (-not $name) { continue }",
  "  $info = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1",
  "  $kind = if ($info) { [string]$info.CommandType } else { 'None' }",
  "  $dash = @($c.CommandElements | Where-Object { $_.Extent.Text -like '--?*' } | ForEach-Object { $_.Extent.Text })",
  "  $list += [pscustomobject]@{ name = $name; kind = $kind; dashOptions = $dash }",
  "}",
  "[pscustomobject]@{ syntaxErrors = @($err | ForEach-Object { $_.Message }); commands = $list } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

export const analyzePowerShell: CommandAnalyzer = async (command) => {
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ANALYZER_SCRIPT], {
      timeout: ANALYZER_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, JARVIS_COMMAND: command },
    });
    const parsed = JSON.parse(stdout) as { syntaxErrors?: unknown; commands?: unknown };
    const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined || v === null ? [] : [v as T]);
    return {
      syntaxErrors: asArray<string>(parsed.syntaxErrors),
      commands: asArray<{ name: string; kind: string; dashOptions?: unknown }>(parsed.commands).map((c) => ({
        name: c.name,
        kind: c.kind,
        dashOptions: asArray<string>(c.dashOptions),
      })),
    };
  } catch {
    return null;
  }
};

// ───────────────────────── Entrada ─────────────────────────

/**
 * Primer problema comprobable de la llamada, o null. Orden: vacíos y `N/A`, marcadores y rutas de otro usuario, comando,
 * rutas y URLs sin origen.
 */
export async function precheckCall(input: PrecheckInput, analyze: CommandAnalyzer = analyzePowerShell): Promise<PrecheckFinding | null> {
  const values = checkValues(input);
  if (values !== null) return values;

  // `run_command` ejecuta siempre PowerShell (no tiene un argumento `shell`): se comprueba el comando como PowerShell.
  if (input.tool === "run_command" && typeof input.args.command === "string") {
    const command = input.args.command;
    if (input.environment.platform === "windows") {
      if (LINUX_PATH.test(command)) {
        return { review: "args_invalid", reason: "The command uses a Linux path (such as /etc/... or /usr/...), which does not exist on this computer (Windows). Use a Windows path." };
      }
      const inner = unwrapPowerShellCommand(command);
      if (inner !== null) return checkWrappedCommand(inner, analyze, input.environment.platform);
      const found = checkCommand(await analyze(command), input.environment.platform);
      if (found !== null) return found;
    }
  }

  return checkSources(input);
}
