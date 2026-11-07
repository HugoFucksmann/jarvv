/**
 * JARVIS Core — Lista negra de herramientas (editable en `jarvis-config.json`, clave `blacklist`).
 *
 * Es una regla determinista de rechazo, aparte de Guard: Guard deniega lo destructivo y cierra la tarea (`security_denied`); un
 * acierto de la lista negra solo rechaza la llamada (`tool_rejected`, con la razón escrita) y el modelo sigue con otra herramienta
 * o con otros argumentos. Las lecturas nunca se rechazan: la lista solo se mira en herramientas que modifican el sistema.
 *
 * Cada entrada nombra una herramienta (`start_process` o `desktop_commander:start_process`, sin distinguir mayúsculas) y, si se
 * quiere, un patrón que se prueba sobre los argumentos escritos como Guard los lee (JSON en minúsculas, `\\` → `/`, espacios
 * colapsados). Sin patrón se rechaza toda llamada a la herramienta y esta deja de ofrecerse a la decisión de herramienta.
 */

export interface BlacklistEntry {
  /** `herramienta` o `servidor:herramienta`. */
  readonly tool: string;
  /** Expresión regular (sin distinguir mayúsculas) sobre los argumentos; sin ella, toda llamada. */
  readonly pattern?: string;
  /** Texto que ve el modelo al rechazar la llamada. */
  readonly reason: string;
}

interface CompiledEntry {
  readonly server: string | null;
  readonly tool: string;
  readonly pattern: RegExp | null;
  readonly reason: string;
}

export type Blacklist = readonly CompiledEntry[];

export const EMPTY_BLACKLIST: Blacklist = [];

/** Compila las entradas; una entrada con un patrón que no es una expresión regular válida se descarta (se avisa por consola). */
export function compileBlacklist(entries: readonly BlacklistEntry[]): Blacklist {
  const out: CompiledEntry[] = [];
  for (const entry of entries) {
    const [server, tool] = entry.tool.includes(":") ? entry.tool.toLowerCase().split(":", 2) : [null, entry.tool.toLowerCase()];
    try {
      out.push({ server, tool, pattern: entry.pattern ? new RegExp(entry.pattern, "i") : null, reason: entry.reason });
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

/** ¿La herramienta está vetada entera (entrada sin patrón) y modifica el sistema? Entonces no se ofrece a la decisión de herramienta. */
export function isBlacklistedTool(list: Blacklist, mcp: string, tool: string, mutates: boolean): boolean {
  return mutates && list.some((e) => e.pattern === null && matchesTool(e, mcp, tool));
}
