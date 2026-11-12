/**
 * JARVIS Core — Comandos de terminal que solo leen.
 *
 * `run_command` es, por política del catálogo, una escritura (un comando puede hacer cualquier cosa). Pero la mayoría de los comandos que
 * pide el modelo solo consultan (`Get-ChildItem`, `Get-Process | Sort-Object …`): tratarlos como escritura los manda a EFFECTS (no a DATA),
 * les pide confirmación al usuario en cada uno y, con `autoMode`, los pasa por D3. Aquí se decide, llamada por llamada, si un comando es
 * de solo lectura.
 *
 * Fail-closed: solo es de lectura lo que se puede demostrar leyendo el texto. Todo lo demás sigue siendo una escritura. Un comando es de
 * lectura si, a la vez:
 * - cada segmento (separado por `|`, `;` o salto de línea) empieza por un comando de la lista cerrada `READ_COMMANDS`, o es una invocación de un
 *   programa externo con argumentos exactos que solo leen (`READ_INVOCATIONS`: `node --version`, `npm ls`, `ipconfig /all`);
 * - no usa redirecciones (`>`, `<`), llamadas (`&`), subexpresiones, bloques, paréntesis, corchetes (métodos y llamadas .NET), acentos
 *   graves ni variables (salvo `$env:`), y sus comillas están balanceadas;
 * - no usa `-Wait` (dejaría un proceso corriendo);
 * - ninguna regla de comando (`commandRules.ts`) lo marca, en ningún nivel.
 *
 * Límite conocido: no es una barrera contra un atacante (nada lo es en este diseño), es un criterio para no molestar al usuario con lo que
 * solo lee. Lo que no reconoce (por ejemplo `(Get-Date).AddDays(-1)`) sigue como escritura y pide confirmación.
 */

import os from "node:os";

import { classify } from "./commandRules.ts";

/** Comandos de PowerShell (y alias comunes) que solo consultan o dan formato a lo que reciben. En minúsculas. */
const READ_COMMANDS: ReadonlySet<string> = new Set([
  // Archivos y carpetas
  "get-childitem", "gci", "ls", "dir", "get-content", "gc", "cat", "type", "get-item", "gi", "get-itemproperty", "gp", "get-acl",
  "get-filehash", "test-path", "resolve-path", "split-path", "join-path", "get-location", "gl", "pwd", "get-psdrive", "get-volume",
  // Procesos, servicios y sistema
  "get-process", "gps", "ps", "get-service", "gsv", "get-date", "get-computerinfo", "get-timezone", "get-culture", "get-hotfix",
  "get-ciminstance", "get-wmiobject", "get-netipaddress", "get-netadapter", "get-eventlog", "get-winevent",
  "hostname", "whoami", "tasklist", "systeminfo",
  // Ayuda y descubrimiento
  "get-command", "gcm", "get-help", "get-member", "gm",
  // Filtrado, orden y formato de lo que llega por la tubería
  "select-object", "select", "sort-object", "sort", "where-object", "where", "measure-object", "measure", "group-object", "group",
  "select-string", "sls", "format-table", "ft", "format-list", "fl", "format-wide", "fw", "out-string", "convertto-json", "convertto-csv",
  "write-output", "echo", "write-host",
  // Más consultas del sistema y de PowerShell (RC-22)
  "get-host", "get-module", "get-alias", "get-executionpolicy", "get-itempropertyvalue", "get-disk", "get-partition", "get-physicaldisk",
  "get-netroute", "get-dnsclientserveraddress", "get-netconnectionprofile", "get-localuser", "get-localgroup", "get-printer",
  "get-scheduledtask", "resolve-dnsname", "test-connection", "convertfrom-json", "get-unique",
]);

/** `true` si `args` es exactamente uno de `flags` (con mayúsculas y minúsculas: en Python `-V` es la versión y `-v` otra cosa). */
const only =
  (...flags: string[]) =>
    (args: readonly string[]): boolean =>
      args.length === 1 && flags.includes(args[0]);

/** Subcomandos de npm que solo leen (no instalan, no ejecutan scripts del paquete). */
const NPM_READS = new Set(["ls", "list", "ll", "la", "outdated", "view", "v", "info", "show", "root", "prefix", "explain", "why"]);

/**
 * Programas externos que solo leen con ciertos argumentos (RC-22): nombre en minúsculas, sin `.exe`/`.cmd` → ¿estos argumentos son de lectura?
 * Lista cerrada y por argumentos exactos: `node --version` sí, `node -e …` no. Fuera a propósito: `git` salvo `--version` (la configuración de un
 * repositorio ajeno puede ejecutar programas en `git status`/`git diff`: `core.fsmonitor`, `diff.external`), `npx`, `yarn` y `pnpm` (pueden descargar
 * y ejecutar paquetes), `pip` (importa código del entorno) y lo que acepte una interval (`netstat 5` no termina).
 */
const READ_INVOCATIONS: ReadonlyMap<string, (args: readonly string[]) => boolean> = new Map([
  ["node", only("--version", "-v")],
  ["git", only("--version")],
  ["python", only("--version", "-V")],
  ["py", only("--version", "-V", "-0", "--list")],
  ["dotnet", only("--version", "--info", "--list-sdks", "--list-runtimes")],
  ["java", only("-version", "--version")],
  ["go", only("version")],
  ["rustc", only("--version", "-V")],
  ["cargo", only("--version", "-V")],
  ["deno", only("--version", "-V")],
  ["bun", only("--version", "-v")],
  ["pwsh", only("--version", "-v")],
  [
    "npm",
    (args: readonly string[]) =>
      only("--version", "-v")(args) ||
      (args.length > 0 && NPM_READS.has(args[0].toLowerCase())) ||
      (args.length >= 2 && args[0].toLowerCase() === "config" && ["get", "list", "ls"].includes(args[1].toLowerCase())),
  ],
  ["where", (args: readonly string[]) => args.length > 0],
  ["ipconfig", (args: readonly string[]) => args.every((a) => ["/all", "/displaydns", "-all"].includes(a.toLowerCase()))],
  ["netstat", (args: readonly string[]) => args.every((a) => /^-[a-z]+$/i.test(a))],
  ["getmac", (args: readonly string[]) => args.every((a) => a.toLowerCase() === "/v")],
  ["driverquery", (args: readonly string[]) => args.every((a) => a.toLowerCase() === "/v")],
]);

/** ¿El segmento es una invocación de lectura de un programa externo (`READ_INVOCATIONS`)? `where` sin `.exe` es `Where-Object`: no cuenta acá. */
function isReadInvocation(tokens: readonly string[]): boolean {
  const raw = (tokens[0] ?? "").toLowerCase();
  const name = raw.replace(/\.(exe|cmd)$/, "");
  if (name === "where" && raw === "where") return false;
  const check = READ_INVOCATIONS.get(name);
  return check !== undefined && check(tokens.slice(1));
}

/** Cualquiera de estos fuera de comillas lo descarta: redirección, llamada, bloque, paréntesis, corchete o acento grave. */
const FORBIDDEN_OUTSIDE_QUOTES = new Set([">", "<", "&", "{", "}", "(", ")", "[", "]", "`"]);

/** Subexpresiones, variables (salvo `$env:`) y acentos graves: se descartan estén o no entre comillas (dentro de comillas dobles se expanden). */
const FORBIDDEN_ANYWHERE = /`|\$\(|\$\{|\$(?!env:)/i;

/**
 * `-Wait` y su abreviatura válida `-Wai`: PowerShell acepta cualquier prefijo único de un parámetro. `-W` y `-Wa` son ambiguos con los parámetros comunes
 * (`-WarningAction`, `-WarningVariable`, `-WhatIf`) y fallan, así que no cuelgan; `-Wai` ya no lo es.
 */
const WAIT_PARAM = /(^|\s)-wai(?:t)?\b/i;

/** Largo máximo de un comando que se analiza: lo más largo no es una consulta simple. */
const MAX_LENGTH = 600;

/** Segmentos del comando (partidos por `|`, `;` y saltos de línea fuera de comillas), o `null` si el texto no se puede leer con seguridad. */
function segmentsOf(command: string): string[] | null {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "|" || ch === ";" || ch === "\n" || ch === "\r") {
      segments.push(current);
      current = "";
    } else if (FORBIDDEN_OUTSIDE_QUOTES.has(ch)) {
      return null;
    } else {
      current += ch;
    }
  }
  if (quote !== null) return null;
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * Los segmentos de un comando que se puede analizar con seguridad (ver la cabecera: sin redirecciones, llamadas, bloques ni variables), o `null`.
 * Lo comparten `isReadOnlyCommand` y `policy/rerun.ts`.
 */
export function analyzableSegments(command: string): string[] | null {
  const text = command.trim();
  if (text === "" || text.length > MAX_LENGTH || FORBIDDEN_ANYWHERE.test(text)) return null;
  const segments = segmentsOf(text);
  return segments === null || segments.length === 0 ? null : segments;
}

/** ¿Este segmento (ya separado) solo lee? */
export function isReadOnlySegment(segment: string): boolean {
  const tokens = segment.split(/\s+/);
  const name = (tokens[0] ?? "").toLowerCase();
  return (READ_COMMANDS.has(name) || isReadInvocation(tokens)) && !WAIT_PARAM.test(segment);
}

/** ¿Ninguna regla de comando (`commandRules.ts`) marca el texto, en ningún nivel? */
export const noCommandRule = (command: string): boolean => classify(command.trim(), { homeDirs: [os.homedir()] }) === null;

/** ¿El comando solo lee? Ver el criterio en la cabecera del archivo. */
export function isReadOnlyCommand(command: string): boolean {
  const segments = analyzableSegments(command);
  return segments !== null && segments.every(isReadOnlySegment) && noCommandRule(command);
}

/**
 * ¿Esta llamada es de solo lectura aunque la herramienta, por catálogo, sea una escritura? Hoy solo `run_command` (proveedor `jarvis_terminal`):
 * - un comando nuevo que `isReadOnlyCommand` reconoce como de PowerShell de solo lectura;
 * - una continuación (`pid`) sin `input`: solo espera más salida de un proceso que ya se aprobó. Con `input` se le envía texto a un proceso: no es lectura.
 */
export function isReadOnlyCall(mcp: string, tool: string, args: Record<string, unknown>): boolean {
  if (mcp.toLowerCase() !== "jarvis_terminal" || tool.toLowerCase() !== "run_command") return false;
  // Un `command` vacío o en blanco no cuenta como comando (igual que en el proveedor): con `pid` es una continuación.
  if (typeof args.command === "string" && args.command.trim() !== "") return args.pid === undefined && isReadOnlyCommand(args.command);
  return typeof args.pid === "number" && args.input === undefined;
}