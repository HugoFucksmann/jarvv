/**
 * JARVIS Core — Lista negra de herramientas (editable en `jarvis-config.json`, clave `blacklist`) y reglas de comandos.
 *
 * Es una regla determinista, aparte de Guard: Guard deniega lo catastrófico y cierra la tarea (`security_denied`); un acierto de
 * la lista negra no cierra la tarea. Las lecturas nunca se miran: la lista solo se mira en herramientas que modifican el sistema.
 *
 * Dos niveles (`level`), con efecto distinto según `autoMode` (lo aplica `callRunner.ts`, fases 6a, 7 y 8):
 * - `blocked` (nivel 1): manual, se pregunta al usuario; automático, `tool_rejected` con la razón escrita (el modelo sigue con otro
 *   comando u otros argumentos).
 * - `sensitive` (nivel 2): manual, se pregunta al usuario; automático, lo decide D3 con el umbral estricto `sensitiveApprove`.
 *
 * Hay dos fuentes de coincidencias, y gana el nivel más grave:
 * 1. Reglas de comando integradas (`commandRules.ts`): Windows y Linux, miran comando y ruta juntos. Se aplican siempre, aunque
 *    `blacklist` esté vacía, a todo argumento `command`/`cmd` de una herramienta que modifica el sistema.
 * 2. Entradas de la configuración (abajo). Sin `level` valen `blocked`.
 *
 * Cada entrada nombra una herramienta (`start_process` o `desktop_commander:start_process`, sin distinguir mayúsculas) y, si se
 * quiere, un patrón que se prueba sobre los argumentos escritos como Guard los lee (JSON en minúsculas, `\\` → `/`, espacios
 * colapsados). Sin patrón se rechaza toda llamada a la herramienta y esta deja de ofrecerse a la decisión de herramienta.
 */

import os from "node:os";

import { classify, commandOf } from "./commandRules.ts";

export type ListLevel = "blocked" | "sensitive";

export interface BlacklistEntry {
  /** `herramienta` o `servidor:herramienta`. */
  readonly tool: string;
  /** Expresión regular (sin distinguir mayúsculas) sobre los argumentos; sin ella, toda llamada. */
  readonly pattern?: string;
  /** Texto que ve el modelo al rechazar la llamada. */
  readonly reason: string;
  /** Nivel de la entrada; sin él, `blocked`. */
  readonly level?: ListLevel;
}

interface CompiledEntry {
  readonly server: string | null;
  readonly tool: string;
  readonly pattern: RegExp | null;
  readonly reason: string;
  readonly level: ListLevel;
}

export type Blacklist = readonly CompiledEntry[];

export const EMPTY_BLACKLIST: Blacklist = [];

/** Compila las entradas; una entrada con un patrón que no es una expresión regular válida se descarta (se avisa por consola). */
export function compileBlacklist(entries: readonly BlacklistEntry[]): Blacklist {
  const out: CompiledEntry[] = [];
  for (const entry of entries) {
    const [server, tool] = entry.tool.includes(":") ? entry.tool.toLowerCase().split(":", 2) : [null, entry.tool.toLowerCase()];
    try {
      out.push({ server, tool, pattern: entry.pattern ? new RegExp(entry.pattern, "i") : null, reason: entry.reason, level: entry.level ?? "blocked" });
    } catch {
      console.warn(`[Blacklist] patrón inválido en '${entry.tool}': ${entry.pattern}`);
    }
  }
  return out;
}

const matchesTool = (entry: CompiledEntry, mcp: string, tool: string): boolean =>
  entry.tool === tool.toLowerCase() && (entry.server === null || entry.server === mcp.toLowerCase());

const normalizeArgs = (args: Record<string, unknown>): string => JSON.stringify(args).toLowerCase().replace(/\\\\/g, "/").replace(/\s+/g, " ");

/** Razón del rechazo si la llamada a una herramienta que modifica el sistema está en la lista negra; `null` si pasa. */
export function blacklistReason(list: Blacklist, mcp: string, tool: string, mutates: boolean, args: Record<string, unknown>): string | null {
  if (!mutates) return null;
  const text = normalizeArgs(args);
  const hit = list.find((e) => matchesTool(e, mcp, tool) && (e.pattern === null || e.pattern.test(text)));
  return hit?.reason ?? null;
}

/** ¿La herramienta está vetada entera (entrada sin patrón, de nivel `blocked`) y modifica el sistema? Entonces no se ofrece a la decisión de herramienta. */
export function isBlacklistedTool(list: Blacklist, mcp: string, tool: string, mutates: boolean): boolean {
  return mutates && list.some((e) => e.pattern === null && e.level === "blocked" && matchesTool(e, mcp, tool));
}

/** Coincidencia con la lista: nivel, razón para el modelo e identificador de la regla. */
export interface ListHit {
  readonly level: ListLevel;
  readonly reason: string;
  readonly id: string;
}

const BLOCKED_HINT = "Do not retry this command. Reach the goal another way with a safer command, or say it cannot be done.";

/**
 * Coincidencia más grave de la llamada con las reglas de comando integradas y con la lista de la configuración; `null` si pasa
 * (o si la herramienta no modifica el sistema). Un hallazgo `guard` de las reglas integradas llega aquí solo si Guard no lo vio
 * (otro nombre de argumento): se trata como `blocked`.
 */
export function blacklistMatch(
  list: Blacklist,
  mcp: string,
  tool: string,
  mutates: boolean,
  args: Record<string, unknown>,
  homeDirs: readonly string[] = [os.homedir()],
): ListHit | null {
  if (!mutates) return null;
  let best: ListHit | null = null;
  const consider = (candidate: ListHit): void => {
    if (best === null || (candidate.level === "blocked" && best.level === "sensitive")) best = candidate;
  };

  const command = commandOf(args);
  if (command !== null) {
    const found = classify(command, { homeDirs });
    if (found !== null) {
      const level: ListLevel = found.tier === "sensitive" ? "sensitive" : "blocked";
      consider({ level, id: found.id, reason: level === "blocked" ? `${found.reason} ${BLOCKED_HINT}` : found.reason });
    }
  }

  const text = normalizeArgs(args);
  for (const e of list) {
    if (matchesTool(e, mcp, tool) && (e.pattern === null || e.pattern.test(text))) {
      consider({ level: e.level, id: `config:${e.tool}`, reason: e.level === "blocked" ? `${e.reason} ${BLOCKED_HINT}` : e.reason });
    }
  }
  return best;
}