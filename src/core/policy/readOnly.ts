/**
 * JARVIS Core — Comandos de terminal que solo leen.
 *
 * `start_process` es, por política del catálogo, una escritura (un comando puede hacer cualquier cosa). Pero la mayoría de los comandos que
 * pide el modelo solo consultan (`Get-ChildItem`, `Get-Process | Sort-Object …`): tratarlos como escritura los manda a EFFECTS (no a DATA),
 * les pide confirmación al usuario en cada uno y, con `autoMode`, los pasa por D3. Aquí se decide, llamada por llamada, si un comando es
 * de solo lectura.
 *
 * Fail-closed: solo es de lectura lo que se puede demostrar leyendo el texto. Todo lo demás sigue siendo una escritura. Un comando es de
 * lectura si, a la vez:
 * - cada segmento (separado por `|`, `;` o salto de línea) empieza por un comando de la lista cerrada `READ_COMMANDS`;
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
]);

/** Cualquiera de estos fuera de comillas lo descarta: redirección, llamada, bloque, paréntesis, corchete o acento grave. */
const FORBIDDEN_OUTSIDE_QUOTES = new Set([">", "<", "&", "{", "}", "(", ")", "[", "]", "`"]);

/** Subexpresiones, variables (salvo `$env:`) y acentos graves: se descartan estén o no entre comillas (dentro de comillas dobles se expanden). */
const FORBIDDEN_ANYWHERE = /`|\$\(|\$\{|\$(?!env:)/i;

const WAIT_PARAM = /(^|\s)-wait\b/i;

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

/** ¿El comando solo lee? Ver el criterio en la cabecera del archivo. */
export function isReadOnlyCommand(command: string): boolean {
  const text = command.trim();
  if (text === "" || text.length > MAX_LENGTH) return false;
  if (FORBIDDEN_ANYWHERE.test(text)) return false;

  const segments = segmentsOf(text);
  if (segments === null || segments.length === 0) return false;
  for (const segment of segments) {
    const name = (segment.split(/\s+/)[0] ?? "").toLowerCase();
    if (!READ_COMMANDS.has(name)) return false;
    if (WAIT_PARAM.test(segment)) return false;
  }
  return classify(text, { homeDirs: [os.homedir()] }) === null;
}

/**
 * ¿Esta llamada es de solo lectura aunque la herramienta, por catálogo, sea una escritura? Hoy solo `start_process` con un comando de
 * PowerShell que `isReadOnlyCommand` reconoce (con el shell por defecto o `powershell`/`pwsh`).
 */
export function isReadOnlyCall(mcp: string, tool: string, args: Record<string, unknown>): boolean {
  if (mcp.toLowerCase() !== "desktop_commander" || tool.toLowerCase() !== "start_process") return false;
  const command = args.command;
  if (typeof command !== "string") return false;
  const shell = typeof args.shell === "string" ? args.shell.toLowerCase().replace(/\.exe$/, "") : undefined;
  if (shell !== undefined && shell !== "powershell" && shell !== "pwsh") return false;
  return isReadOnlyCommand(command);
}
