/**
 * JARVIS Core — Pre-chequeo determinista de una llamada candidata (antes de la revisión de Decisión 3).
 *
 * Qué es: reglas de código, sin modelo, sobre los argumentos ya resueltos. Rechazan solo lo que se puede comprobar:
 * valores vacíos o `N/A`, marcadores de posición, rutas de otro usuario, comandos que no existen en este sistema, y rutas o
 * URLs de lectura que no aparecen en nada de lo que la tarea sabe (pedido, respuestas del usuario, llamadas y resultados
 * anteriores). Cada rechazo trae una razón escrita que viaja a la línea FAIL del LLM de argumentos: sin ella el modelo
 * repetía el mismo comando (un `ps aux` se propuso y se rechazó 5 veces seguidas).
 *
 * Las reglas están en un registro (`CALL_RULES`, `VALUE_RULES`, `SOURCE_RULES`, más abajo): agregar una validación es agregar una fila.
 *
 * Principio: ante la duda, silencio. Si la tarea tiene un resultado guardado aparte (`ref`), lo que "no aparece" puede estar
 * en él: esas comprobaciones se omiten. Si el analizador de comandos falla o expira, no se rechaza.
 *
 * Los comandos solo se analizan en Windows (parser de PowerShell); en otros sistemas esa parte no corre.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TaskContext } from "../ctx/index.ts";
import type { Platform, UserEnvironment } from "../environment.ts";
import { FIXED_TIMEOUTS } from "../timeouts.ts";
import { stripExtendedPrefix } from "../policy/allowedDirs.ts";
import { isPathArgKey, PATH_LIST_KEY } from "../policy/pathArgs.ts";
import { isPrecheckSource } from "../recalledPolicy.ts";
import { isPathWriteTool, parentFolderArg } from "../tools/toolTargets.ts";
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
  readonly detectedPaths?: readonly string[];
  readonly unresolvablePaths?: readonly string[];
}

/** Analiza un comando de PowerShell. Devuelve null si no se pudo analizar (no se rechaza por eso). */
export type CommandAnalyzer = (command: string) => Promise<CommandReport | null>;

// ───────────────────────── Utilidades ─────────────────────────

/** Minúsculas y `/` como separador: la comparación no distingue mayúsculas ni `\` de `/`. */
export function normalizeText(text: string): string {
  return text.split("\\").join("/").toLowerCase();
}

export type Role = "path" | "url" | "command" | "text";

const SOURCE_KEYS = new Set(["source", "src", "from"]);
/** Claves cuyo valor puede ser vacío a propósito (un archivo vacío, una tecla Enter). */
export const MAY_BE_EMPTY = new Set(["content", "text", "data", "body", "input"]);

function roleOf(key: string): Role {
  const k = key.toLowerCase();
  if (isPathArgKey(k) || k === PATH_LIST_KEY) return "path"; // `paths` (read_multiple_files) es un arreglo de rutas: `stringsOf` revisa cada una
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

const PLACEHOLDER = /<[A-Za-z][\w-]*>|\byour[_ -]|\bexample\.(com|org|net)\b|\/path\/to\b|\bxxx+\b|\bplaceholder\b/i;
/**
 * `TODO` como marcador: solo en mayúsculas y como palabra suelta. En español `todo` es una palabra común («todo-lo-que-sabemos» en una URL) y `TODO.md` es un archivo
 * habitual; ni uno ni otro son un valor sin completar.
 */
const TODO_MARKER = /(?<![\w.-])TODO(?![\w.-])/;
/** Ruta de Linux dentro de un comando (`/etc/hosts`, `/usr/bin/…`): no existe en Windows. */
const LINUX_PATH = /(^|[\s'"=])\/(etc|usr|var|home|bin|opt|tmp|proc|sys|dev|mnt)\//;
const SYSTEM_USER_DIRS = new Set(["public", "default", "all users", "default user"]);

// ───────────────────────── Fuentes ─────────────────────────

/** Tope de bytes que se leen de cada ref como fuente: las páginas largas superan varios cientos de KB y esto corre en cada llamada. */
export const REF_SOURCE_MAX_BYTES = 400_000;

interface ReadRefResult {
  readonly text: string;
  readonly truncated: boolean;
}

/** Texto de una ref (hasta `REF_SOURCE_MAX_BYTES`) y si se cortó por tamaño, o `null` si el archivo ya no se puede leer. */
function readRefText(where: string): ReadRefResult | null {
  try {
    const fd = fs.openSync(where, "r");
    try {
      const buffer = Buffer.alloc(REF_SOURCE_MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const truncated = offset > REF_SOURCE_MAX_BYTES;
      return {
        text: buffer.subarray(0, truncated ? REF_SOURCE_MAX_BYTES : offset).toString("utf8"),
        truncated,
      };
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
export function collectSources(ctx: TaskContext, extra: readonly string[] = []): PrecheckSources {
  const parts: string[] = [ctx.task.request, ...extra];
  for (const r of ctx.find("recalled", {})) {
    if (isPrecheckSource(r.source)) parts.push(r.value);
  }
  for (const step of ctx.find("steps", {})) if (step.instruction) parts.push(step.instruction);
  parts.push(JSON.stringify(ctx.view.forReview(reviewViewOptions()).userInput));
  let complete = true;
  const calls = ctx.find("calls", {});
  const refs = ctx.find("refs", {});
  // Una ref que ninguna llamada usa (la respuesta larga del usuario que `ask.ts` guarda cuando el hecho `answer_*` queda recortado) también es fuente: lo que el
  // usuario escribió más allá del recorte no puede darse por inventado. Una ref ilegible o mayor al tope deja la comprobación inconclusa, como las de las llamadas.
  const usedByCalls = new Set(calls.map((c) => c.ref).filter((id): id is string => id !== null));
  for (const ref of refs) {
    if (usedByCalls.has(ref.id)) continue;
    const read = readRefText(ref.where);
    if (read === null || read.truncated) complete = false;
    if (read !== null) parts.push(read.text);
  }
  for (const call of calls) {
    // Solo lo que se ejecutó bien da origen: los argumentos de un intento rechazado o con `not_found` eran una suposición.
    if (call.status === "ok" && call.args !== null) parts.push(JSON.stringify(call.args));
    if (call.status === "ok" && call.summary !== null) parts.push(call.summary);
    if (call.ref !== null) {
      const ref = refs.find((r) => r.id === call.ref);
      const read = ref === undefined ? null : readRefText(ref.where);
      // Una ref ilegible (archivo borrado) o mayor al tope por ref puede contener lo que se busca fuera de lo leído: la comprobación no es concluyente.
      if (read === null) {
        complete = false;
      } else if (call.status === "ok") {
        parts.push(read.text);
        if (read.truncated) complete = false;
      }
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

/** Ruta absoluta de Windows (`C:/…`, ya normalizada) o de Linux/macOS (`/…`). Una ruta relativa depende de la base de cada herramienta y no se juzga. */
const isAbsolutePath = (normalized: string): boolean => /^[a-z]:\//.test(normalized) || normalized.startsWith("/");

/**
 * ¿El destino de una escritura sale de algo que la tarea sabe? La ruta completa o alguno de sus ancestros (con al menos un segmento tras la unidad) aparece en las
 * fuentes. A diferencia de una lectura, no basta con que aparezca el nombre final: «creá la carpeta backup» no da `D:/proyectos/facturacion` como lugar.
 */
function writeDestinationHasSource(path: string, input: PrecheckInput): boolean {
  let p = normalizeText(path).replace(/\/+$/, "");
  while (p.includes("/")) {
    if (input.sources.text.includes(p)) return true;
    p = p.slice(0, p.lastIndexOf("/"));
    if (p === "" || /^[a-z]:$/.test(p)) break;
  }
  return false;
}

/** ¿La ruta está dentro de una carpeta conocida del usuario (inicio, escritorio, documentos, descargas)? */
function isUnderKnownFolder(path: string, env: UserEnvironment): boolean {
  const p = normalizeText(path).replace(/\/+$/, "");
  return knownFolders(env).some((f) => p === f || p.startsWith(`${f}/`));
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

const ANALYZER_TIMEOUT_MS = FIXED_TIMEOUTS.analyzerMs;

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
  "$paths = New-Object System.Collections.Generic.List[string]",
  "$unres = New-Object System.Collections.Generic.List[string]",
  "$pathPattern = '^([A-Za-z]:([\\\\/]|$)|\\\\\\\\|//[^/]+/[^/]+|~([\\\\/]|$)|\\.\\.?([\\\\/]|$)|.*/\\.\\.(?:[\\\\/]|$)|/[^/\\s]+/[^/\\s]+)'",
  "$dynPattern = '^(\\$env:|~|\\$[A-Za-z_{]|[A-Za-z]:|\\\\\\\\|\\.\\.?[\\\\/]|.*[/\\\\])'",
  "$autoSafeVars = @('true','false','null','_','psitem','args','host','error','myinvocation','lastexitcode','?')",
  "foreach ($c in $cmds) {",
  "  $name = $c.GetCommandName(); if (-not $name) { continue }",
  "  $info = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1",
  "  $kind = if ($info) { [string]$info.CommandType } else { 'None' }",
  "  $dash = @($c.CommandElements | Where-Object { $_.Extent.Text -like '--?*' } | ForEach-Object { $_.Extent.Text })",
  "  $list += [pscustomobject]@{ name = $name; kind = $kind; dashOptions = $dash }",
  "  for ($i = 0; $i -lt $c.CommandElements.Count; $i++) {",
  "    $el = $c.CommandElements[$i]",
  "    if ($i -eq 0 -and $el.Extent.Text -notmatch $pathPattern) { continue }",
  "    if ($el -is [System.Management.Automation.Language.CommandParameterAst]) { $el = $el.Argument; if (-not $el) { continue } }",
  "    if ($el -is [System.Management.Automation.Language.VariableExpressionAst]) {",
  "      $vname = $el.VariablePath.UserPath.ToLowerInvariant()",
  "      if ($autoSafeVars -notcontains $vname) { $unres.Add($el.Extent.Text) }",
  "    } elseif ($el -is [System.Management.Automation.Language.SubExpressionAst] -or $el -is [System.Management.Automation.Language.ParenExpressionAst] -or $el -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -or $el -is [System.Management.Automation.Language.MemberExpressionAst]) {",
  "      $unres.Add($el.Extent.Text)",
  "    }",
  "  }",
  "}",
  "foreach ($s in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true)) {",
  "  $v = $s.Value",
  "  if ($v -and ($v -notmatch '^[A-Za-z]{2,}:') -and (($v -match $pathPattern) -or ($v -notmatch '^-' -and $v -match '^[^\\s*?]+\\\\[^\\s*?]+'))) {",
  "    $paths.Add($v)",
  "  }",
  "}",
  "foreach ($e in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] }, $true)) {",
  "  if ($e.NestedExpressions.Count -gt 0 -and $e.Value -notmatch '^[A-Za-z]{2,}:' -and $e.Value -match $dynPattern) {",
  "    $unres.Add($e.Extent.Text)",
  "  }",
  "}",
  "foreach ($r in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst] }, $true)) {",
  "  $loc = $r.Location",
  "  if ($loc -is [System.Management.Automation.Language.StringConstantExpressionAst]) {",
  "    $lv = $loc.Value",
  "    if ($lv -and $lv -notmatch '^(?:nul|/dev/null)$') { $paths.Add($lv) }",
  "  } elseif ($loc -and $loc.Extent.Text -ne '$null') {",
  "    $unres.Add($loc.Extent.Text)",
  "  }",
  "}",
  "[pscustomobject]@{ syntaxErrors = @($err | ForEach-Object { $_.Message }); commands = $list; detectedPaths = @($paths | Select-Object -Unique); unresolvablePaths = @($unres | Select-Object -Unique) } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

/**
 * El JSON que imprime `ANALYZER_SCRIPT` convertido en `CommandReport`. ConvertTo-Json colapsa los arreglos de un elemento a un valor suelto y deja un arreglo vacío como
 * nada: se normaliza todo a arreglos. Pura (se prueba sin PowerShell); lanza si `stdout` no es JSON.
 */
export function parseAnalyzerOutput(stdout: string): CommandReport {
  const parsed = JSON.parse(stdout) as { syntaxErrors?: unknown; commands?: unknown; detectedPaths?: unknown; unresolvablePaths?: unknown };
  const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined || v === null ? [] : [v as T]);
  const detectedPaths = asArray<string>(parsed.detectedPaths).filter((s): s is string => typeof s === "string");
  const unresolvablePaths = asArray<string>(parsed.unresolvablePaths).filter((s): s is string => typeof s === "string");
  return {
    syntaxErrors: asArray<string>(parsed.syntaxErrors),
    commands: asArray<{ name: string; kind: string; dashOptions?: unknown }>(parsed.commands).map((c) => ({
      name: c.name,
      kind: c.kind,
      dashOptions: asArray<string>(c.dashOptions),
    })),
    ...(detectedPaths.length > 0 ? { detectedPaths } : {}),
    ...(unresolvablePaths.length > 0 ? { unresolvablePaths } : {}),
  };
}

export const analyzePowerShell: CommandAnalyzer = async (command) => {
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ANALYZER_SCRIPT], {
      timeout: ANALYZER_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, JARVIS_COMMAND: command },
    });
    return parseAnalyzerOutput(stdout);
  } catch {
    return null;
  }
};

// ───────────────────────── Registro de reglas ─────────────────────────
//
// Todo el pre-chequeo vive en dos listas ordenadas: `VALUE_RULES` y `SOURCE_RULES` (una regla por valor de argumento) y `CALL_RULES` (una regla por llamada, que además
// recorre las dos anteriores). Cada regla tiene `name` (para la traza y las pruebas), `applies` (¿le corresponde a esta entrada?) y `check` (devuelve el rechazo con su razón
// en inglés, o `null`). Gana la primera regla que rechaza, en el orden de la lista. Agregar una validación es agregar una fila en la lista que corresponda.
//
// Convenciones para una regla nueva: determinista y sin modelos; ante la duda, `null`; si mira el disco, solo con rutas absolutas y solo si existe la carpeta de inicio del
// entorno (`diskIsReal`: un entorno inventado, como el de un caso de prueba, no se juzga); la razón dice qué hacer en su lugar (llega a la línea FAIL del LLM de argumentos).

/** Una regla del pre-chequeo sobre un contexto `C`. */
export interface PrecheckRule<C> {
  readonly name: string;
  readonly applies: (ctx: C) => boolean;
  readonly check: (ctx: C) => PrecheckFinding | null | Promise<PrecheckFinding | null>;
}

/** Un valor de texto de un argumento, con lo que las reglas necesitan saber de él. */
export interface ValueContext {
  readonly input: PrecheckInput;
  readonly key: string;
  readonly role: Role;
  readonly value: string;
  /** Segmento de usuario de la carpeta de inicio del entorno (`C:/Users/<este>`), o null. */
  readonly home: string | null;
  /** El valor es una ruta que la llamada lee (lectura, o el origen de un movimiento). */
  readonly readsIt: boolean;
  /** El valor es un destino de escritura. */
  readonly writesIt: boolean;
}

export interface CallContext {
  readonly input: PrecheckInput;
  readonly analyze: CommandAnalyzer;
}

const invalid = (reason: string): PrecheckFinding => ({ review: "args_invalid", reason });
const missing = (reason: string): PrecheckFinding => ({ review: "info_missing", reason });

/** ¿Se puede juzgar contra el disco de esta PC? Solo si la carpeta de inicio del entorno existe aquí. */
function diskIsReal(env: UserEnvironment): boolean {
  try {
    return fs.existsSync(env.home);
  } catch {
    return false;
  }
}

/** Tipo de lo que hay en `p` (`"file"`, `"directory"`, `"other"`) o `null` si no existe o no se puede leer. */
function diskKind(p: string): "file" | "directory" | "other" | null {
  try {
    const st = fs.statSync(p);
    return st.isDirectory() ? "directory" : st.isFile() ? "file" : "other";
  } catch {
    return null;
  }
}

const isUrlLike = (value: string): boolean => /^https?:\/\//i.test(value.trim());
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// ── Reglas por valor ──

export const VALUE_RULES: readonly PrecheckRule<ValueContext>[] = [
  {
    name: "empty-value",
    applies: (c) => c.value.trim() === "" && !MAY_BE_EMPTY.has(c.key.toLowerCase()),
    check: (c) => missing(`The argument '${c.key}' is empty: the value it needs is missing from the task.`),
  },
  {
    name: "na-value",
    applies: (c) => /^n\/a$/i.test(c.value.trim()),
    check: (c) => missing(`The argument '${c.key}' is 'N/A': the value it needs is missing from the task.`),
  },
  {
    name: "placeholder",
    applies: (c) => c.role !== "text",
    check: (c) => {
      const hit = PLACEHOLDER.exec(c.value) ?? TODO_MARKER.exec(c.value);
      return hit === null ? null : invalid(`The argument '${c.key}' contains a placeholder ('${hit[0]}'). Use the real value from the task or from earlier results.`);
    },
  },
  {
    name: "other-user-folder",
    applies: (c) => c.role === "path" && c.input.environment.platform === "windows",
    check: (c) => {
      const seg = userSegment(normalizeText(c.value));
      if (seg === null || c.home === null || seg === c.home || SYSTEM_USER_DIRS.has(seg)) return null;
      return invalid(`The path '${c.value}' is under another user's folder ('${seg}'). The home folder of this computer is '${c.input.environment.home}'; use the paths listed in ENV.`);
    },
  },
  {
    // Un esquema que no es http(s) (`file:`, `javascript:`…) o una URL que no se puede analizar no llega a ninguna herramienta web.
    name: "url-syntax",
    applies: (c) => c.role === "url" && c.value.trim() !== "",
    check: (c) => {
      const v = c.value.trim();
      const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(v)?.[1] ?? /^(file|javascript|data|mailto|about|vbscript):/i.exec(v)?.[1];
      if (scheme !== undefined && !/^https?$/i.test(scheme)) return invalid(`Only http and https URLs can be read ('${scheme}:' given in '${v.slice(0, 80)}').`);
      let url: URL;
      try {
        url = new URL(scheme === undefined ? `https://${v}` : v);
      } catch {
        return invalid(`'${v.slice(0, 80)}' is not a valid URL. Use a full address such as https://example.org/page.`);
      }
      return url.username !== "" || url.password !== "" ? invalid("URLs with credentials are not allowed.") : null;
    },
  },
  {
    // Caracteres que Windows no admite en una ruta, y en una escritura también `?`, `*`, nombres reservados (`CON`, `NUL`…) y segmentos que terminan en punto o espacio.
    name: "windows-invalid-path",
    applies: (c) => c.role === "path" && c.input.environment.platform === "windows" && c.value.trim() !== "" && !isUrlLike(c.value),
    check: (c) => {
      const rest = stripExtendedPrefix(c.value.trim()).replace(/^[A-Za-z]:/, "");
      const bad = /[<>"|\u0000-\u001f]/.exec(rest);
      if (bad !== null) return invalid(`The path '${c.value}' contains a character that Windows does not allow in paths (${JSON.stringify(bad[0])}). Use a plain path.`);
      if (!isPathWriteTool(c.input.tool)) return null;
      if (/[?*]/.test(rest)) return invalid(`The path '${c.value}' has a wildcard ('?' or '*'): ${c.input.tool} needs one exact path.`);
      for (const segment of rest.split(/[\\/]/)) {
        if (segment === "" || segment === "." || segment === "..") continue;
        if (WINDOWS_RESERVED.test(segment.split(".")[0])) return invalid(`'${segment}' is a name reserved by Windows (CON, NUL, COM1…): choose another name.`);
        if (/[. ]$/.test(segment)) return invalid(`The name '${segment}' ends with a dot or a space, which Windows does not allow. Remove it.`);
      }
      return null;
    },
  },
];

/** Las reglas de origen: lo que se lee o se usa como destino tiene que salir de algo que la tarea sabe. */
export const SOURCE_RULES: readonly PrecheckRule<ValueContext>[] = [
  {
    name: "url-source",
    applies: (c) => c.role === "url",
    check: (c) =>
      c.input.sources.text.includes(normalizeUrl(c.value))
        ? null
        : invalid(`The URL '${c.value}' does not appear in the request or in earlier results. Use a URL from the results, or search first.`),
  },
  {
    // Destino de una escritura (`path` de `write_file` o `create_directory`, `destination` de `move_file`): si no es una carpeta del usuario, tiene que salir de algún lado.
    // D3 aprobó 5 de 5 destinos inventados (`D:\proyectos\facturacion\backup`…) y con `autoMode` no hay otra barrera.
    name: "write-destination-source",
    applies: (c) => c.writesIt,
    check: (c) =>
      isAbsolutePath(normalizeText(c.value)) && !isUnderKnownFolder(c.value, c.input.environment) && !writeDestinationHasSource(c.value, c.input)
        ? invalid(`The destination '${c.value}' is not under your folders (see ENV) and does not appear in the request or in earlier results. Use a path under ENV or the one the user gave.`)
        : null,
  },
  {
    name: "read-path-source",
    applies: (c) => c.readsIt,
    check: (c) =>
      pathHasSource(c.value, c.input)
        ? null
        : invalid(`The path '${c.value}' does not appear in the request or in earlier results. Use a path from the request or from a listing, or locate the file first.`),
  },
];

/** Recorre los valores de texto de los argumentos (en el orden de los argumentos) y devuelve el primer rechazo de `rules`. */
function firstValueFinding(input: PrecheckInput, rules: readonly PrecheckRule<ValueContext>[], keep: (ctx: ValueContext) => boolean): PrecheckFinding | null {
  const home = userSegment(normalizeText(input.environment.home));
  for (const [key, raw] of Object.entries(input.args)) {
    const role = roleOf(key);
    const readsIt = role === "path" && (input.kind === "read" || SOURCE_KEYS.has(key.toLowerCase()));
    const writesIt = role === "path" && input.kind === "write" && !readsIt;
    for (const value of stringsOf(raw)) {
      const ctx: ValueContext = { input, key, role, value, home, readsIt, writesIt };
      if (!keep(ctx)) continue;
      for (const rule of rules) {
        if (!rule.applies(ctx)) continue;
        const found = rule.check(ctx) as PrecheckFinding | null;
        if (found !== null) return found;
      }
    }
  }
  return null;
}

// ── Reglas por llamada ──

/**
 * `write_file` y `move_file` no crean carpetas: si la que contendría al archivo no existe, la herramienta falla (`ENOENT`) y el modelo repetía la misma ruta. El destino
 * se comprueba en el disco solo si la carpeta de inicio del entorno existe en esta PC y solo con rutas absolutas. `create_directory` sí crea las carpetas intermedias.
 */
function checkParentFolder(input: PrecheckInput): PrecheckFinding | null {
  const key = parentFolderArg(input.tool);
  const value = key === null ? undefined : input.args[key];
  if (typeof value !== "string" || !isAbsolutePath(normalizeText(value))) return null;
  try {
    if (!fs.existsSync(input.environment.home)) return null;
    const parent = path.dirname(value);
    if (parent === value || fs.existsSync(parent)) return null;
    return invalid(
      `The folder '${parent}' does not exist, so '${value}' cannot be written there. Create the folder first with create_directory, or use a folder that exists (ENV lists the user's folders; the folder the user means may be inside one of them).`,
    );
  } catch {
    return null;
  }
}

/** Un argumento de ruta absoluta (no una URL) con valor, o `null`. */
function absolutePathArg(input: PrecheckInput, key: string): string | null {
  const v = input.args[key];
  return typeof v === "string" && v.trim() !== "" && !isUrlLike(v) && isAbsolutePath(normalizeText(v)) ? v : null;
}

/**
 * Lo que hay en disco no es lo que la herramienta espera (carpeta donde va un archivo y al revés, origen de un movimiento que no existe). Una regla por herramienta:
 * agregar una herramienta con rutas es agregar su fila (`path-kind` solo corre para las que están acá).
 */
const PATH_KIND_CHECKS: ReadonlyMap<string, (input: PrecheckInput) => PrecheckFinding | null> = new Map([
  [
    "write_file",
    (input) => {
      const p = absolutePathArg(input, "path");
      return p !== null && diskKind(p) === "directory" ? invalid(`'${p}' is a folder, not a file: write_file needs a file path (for example '${p}\\notes.txt').`) : null;
    },
  ],
  [
    "read_file",
    (input) => {
      const p = absolutePathArg(input, "path");
      return p !== null && diskKind(p) === "directory" ? invalid(`'${p}' is a folder, not a file: use list_directory to see what it contains, then read_file on a file.`) : null;
    },
  ],
  [
    "list_directory",
    (input) => {
      const p = absolutePathArg(input, "path");
      return p !== null && diskKind(p) === "file" ? invalid(`'${p}' is a file, not a folder: use read_file to read it.`) : null;
    },
  ],
  [
    "move_file",
    (input) => {
      const p = absolutePathArg(input, "source");
      return p !== null && diskKind(p) === null ? invalid(`The source '${p}' does not exist, so it cannot be moved. Check the name with list_directory or locate it first.`) : null;
    },
  ],
]);

function checkPathKind(input: PrecheckInput): PrecheckFinding | null {
  if (!diskIsReal(input.environment)) return null;
  return PATH_KIND_CHECKS.get(input.tool)?.(input) ?? null;
}

const textArg = (input: PrecheckInput, key: string): string | null => {
  const v = input.args[key];
  return typeof v === "string" ? v : null;
};
const isPowerShellCommand = (input: PrecheckInput): boolean =>
  input.tool === "run_command" && typeof input.args.command === "string" && input.environment.platform === "windows";

export const CALL_RULES: readonly PrecheckRule<CallContext>[] = [
  {
    name: "list-directory-depth",
    applies: ({ input }) => input.tool === "list_directory" && input.args.depth !== undefined && input.args.depth !== null,
    check: ({ input }) => {
      const d = input.args.depth;
      return typeof d !== "number" || !Number.isInteger(d) || d < 1 ? invalid("The 'depth' argument of list_directory must be an integer >= 1 (use 1 or omit for a single level).") : null;
    },
  },
  {
    name: "argument-values",
    applies: () => true,
    check: ({ input }) => firstValueFinding(input, VALUE_RULES, () => true),
  },
  {
    name: "same-source-destination",
    applies: ({ input }) => input.tool === "move_file",
    check: ({ input }) => {
      const from = textArg(input, "source");
      const to = textArg(input, "destination");
      if (from === null || to === null || from.trim() === "" || to.trim() === "") return null;
      const flat = (p: string): string => normalizeText(p.trim()).replace(/\/+$/, "");
      return flat(from) === flat(to) ? invalid("The source and the destination of move_file are the same path: there is nothing to move. Give the new location or the new name.") : null;
    },
  },
  { name: "parent-folder", applies: ({ input }) => parentFolderArg(input.tool) !== null, check: ({ input }) => checkParentFolder(input) },
  { name: "path-kind", applies: ({ input }) => PATH_KIND_CHECKS.has(input.tool), check: ({ input }) => checkPathKind(input) },
  {
    name: "linux-path-in-command",
    applies: ({ input }) => isPowerShellCommand(input),
    check: ({ input }) =>
      LINUX_PATH.test(input.args.command as string)
        ? invalid("The command uses a Linux path (such as /etc/... or /usr/...), which does not exist on this computer (Windows). Use a Windows path.")
        : null,
  },
  {
    name: "wrapped-powershell",
    applies: ({ input }) => isPowerShellCommand(input) && unwrapPowerShellCommand(input.args.command as string) !== null,
    check: ({ input, analyze }) => checkWrappedCommand(unwrapPowerShellCommand(input.args.command as string) as string, analyze, input.environment.platform),
  },
  {
    // `run_command` ejecuta siempre PowerShell (no tiene un argumento `shell`): se comprueba el comando como PowerShell.
    name: "command-analysis",
    applies: ({ input }) => isPowerShellCommand(input),
    check: async ({ input, analyze }) => checkCommand(await analyze(input.args.command as string), input.environment.platform),
  },
  {
    // Si hay resultados guardados aparte, lo que «no aparece» puede estar en ellos: no se juzga.
    name: "argument-sources",
    applies: ({ input }) => input.sources.complete,
    check: ({ input }) => firstValueFinding(input, SOURCE_RULES, (c) => c.value.trim() !== "" && (c.role === "url" || c.readsIt || c.writesIt)),
  },
];

/** Los nombres de las reglas, en el orden en que se evalúan (por llamada, por valor y de origen). */
export const precheckRuleNames = (): { readonly call: string[]; readonly value: string[]; readonly source: string[] } => ({
  call: CALL_RULES.map((r) => r.name),
  value: VALUE_RULES.map((r) => r.name),
  source: SOURCE_RULES.map((r) => r.name),
});

// ───────────────────────── Entrada ─────────────────────────

/** Primer problema comprobable de la llamada, o null: la primera regla de `CALL_RULES` que la rechaza. */
export async function precheckCall(input: PrecheckInput, analyze: CommandAnalyzer = analyzePowerShell): Promise<PrecheckFinding | null> {
  const ctx: CallContext = { input, analyze };
  for (const rule of CALL_RULES) {
    if (!rule.applies(ctx)) continue;
    const found = await rule.check(ctx);
    if (found !== null) return found;
  }
  return null;
}
