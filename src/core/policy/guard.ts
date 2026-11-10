/**
 * JARVIS Core — Guard & Authorization Engine
 *
 * Invariantes:
 * - Ningún modelo puede eludir Guard.
 * - Patrones destructivos sobre el SO y comandos catastróficos (nivel `guard` de `commandRules.ts`: discos, raíz del sistema) => DENY siempre. Se escanean los argumentos que son rutas o comandos; no se
 *   escanean los de `free_search` (consultas y URLs) ni el campo `content` de `desktop_commander:write_file` (texto
 *   que se escribe: sus rutas, `path`, sí se escanean, y ejecutarlo exige un `start_process`, que siempre pide aprobación).
 * - Herramienta no catalogada en el manifest => APPROVAL (fail-closed; en la práctica runStep ya no la ofrece).
 * - policy.requiresApproval => APPROVAL cada vez (la aprobación no perdura), salvo un comando de terminal que `readOnly.ts` demuestra de
 *   solo lectura (pasó antes por todas las reglas anteriores: DENY de patrones y reglas de comando).
 * - Regla B (Fase 5): una escritura (FILE_WRITE) sobre una ruta dentro de las carpetas protegidas (`refsDir`: resultados
 *   crudos de las refs) => DENY siempre. Se revisan los argumentos de tipo texto, salvo `content` y `mode`; las rutas
 *   relativas se resuelven contra cada base conocida (D27); se compara sin seguir enlaces simbólicos. No cubre
 *   `start_process` (un comando puede tocar esas rutas; ya pide aprobación) ni un directorio que CONTENGA a la protegida.
 * - Resto => ALLOW (lecturas).
 * - La política sale únicamente del manifest (tools/manifest.ts); no hay otra fuente.
 */

import os from "node:os";
import path from "node:path";

import type { Capability, GuardDecision } from "../types.ts";
import { getToolPolicy, isKnownTool } from "../tools/manifest.ts";
import { classify, commandOf } from "./commandRules.ts";
import { isReadOnlyCall } from "./readOnly.ts";

// Se evalúan sobre el JSON de args en minúsculas, con "\\" -> "/" y espacios colapsados.
// Los comandos de terminal (Windows y Linux) los analiza además `commandRules.ts` (comando y ruta juntos): `rm -rf /` o `Remove-Item -Recurse C:\`
// dan DENY, pero `rm -rf /tmp/x` ya no (antes un patrón de texto lo denegaba: falso positivo heredado).
const DENY_PATTERNS: readonly RegExp[] = [
  /\bformat\s+c:/,
  /\bmkfs\b/,
  /del\s+\/f\s+\/s\s+\/q\s+c:\/windows/,
  /\/etc\/shadow/,
  /system32\/drivers/,
];

/** Carpetas que el modelo no puede modificar y bases para resolver las rutas relativas que escriba (regla B). */
export interface ProtectedPaths {
  /** Rutas absolutas de las carpetas protegidas (hoy: `refsDir`). */
  readonly protectedDirs: readonly string[];
  /** Bases contra las que se resuelve una ruta relativa: cada una es un candidato (D27). */
  readonly relativeBases: readonly string[];
}

/**
 * ¿`child` es `parent` o está dentro de `parent`? Ambas se resuelven con `path.resolve`; en Windows la comparación no
 * distingue mayúsculas (lo hace `path.relative` de Node). No sigue enlaces simbólicos ni uniones.
 */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Argumentos de las herramientas de escritura que no son rutas (texto que se escribe, modo de escritura). */
const NON_PATH_ARGS: readonly string[] = ["content", "mode"];

export class Guard {
  /**
   * @param scope Carpetas protegidas (regla B). Sin él, la regla no se aplica.
   */
  static evaluate(mcp: string, tool: string, args: Record<string, unknown> = {}, scope?: ProtectedPaths): GuardDecision {
    const policy = getToolPolicy(mcp, tool);
    const capability = policy.capability;

    const scannable = Guard.denyScanArgs(mcp, tool, args);
    if (scannable && Guard.matchesDenyPattern(scannable)) {
      return {
        decision: "DENY",
        reason: "Operación rechazada (DENY): patrón destructivo prohibido sobre el sistema operativo.",
        capability,
      };
    }

    const command = scannable ? commandOf(scannable) : null;
    const found = command !== null ? classify(command, { homeDirs: [os.homedir()] }) : null;
    if (found?.tier === "guard") {
      return { decision: "DENY", reason: `Operación rechazada (DENY): comando catastrófico prohibido (${found.id}).`, capability };
    }

    if (scope && capability === "FILE_WRITE" && Guard.touchesProtectedPath(args, scope)) {
      return {
        decision: "DENY",
        reason: "Operación rechazada (DENY): la ruta pertenece a la carpeta de resultados guardados (refs) y no se puede modificar.",
        capability,
      };
    }

    if (!isKnownTool(mcp, tool)) {
      return {
        decision: "APPROVAL",
        reason: `Herramienta no catalogada (${mcp}:${tool}). Requiere confirmación.`,
        capability,
      };
    }

    if (policy.requiresApproval && !isReadOnlyCall(mcp, tool, args)) {
      return { decision: "APPROVAL", reason: Guard.approvalReason(capability, tool, args), capability };
    }

    return { decision: "ALLOW", capability };
  }

  /** Argumentos sobre los que se aplica el DENY. `null` = sin escaneo (free_search); en write_file se omite `content`. */
  private static denyScanArgs(mcp: string, tool: string, args: Record<string, unknown>): Record<string, unknown> | null {
    const server = mcp.toLowerCase();
    const name = tool.toLowerCase();
    if (server === "free_search") return null;
    if (server === "desktop_commander" && name === "write_file") {
      const rest = { ...args };
      delete rest.content;
      return rest;
    }
    return args;
  }

  /** Rutas que un argumento de texto puede nombrar: absoluta, `~` o relativa a cada base conocida. */
  private static candidatePaths(value: string, scope: ProtectedPaths): string[] {
    const text = value.trim();
    if (text.length === 0 || text.includes("\0")) return [];
    if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) return [path.join(os.homedir(), text.slice(1))];
    if (path.isAbsolute(text)) return [text];
    return scope.relativeBases.map((base) => path.resolve(base, text));
  }

  /** Regla B: ¿algún argumento de texto (salvo `content` y `mode`) nombra una ruta dentro de las carpetas protegidas? */
  private static touchesProtectedPath(args: Record<string, unknown>, scope: ProtectedPaths): boolean {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== "string" || NON_PATH_ARGS.includes(key.toLowerCase())) continue;
      for (const candidate of Guard.candidatePaths(value, scope)) {
        if (scope.protectedDirs.some((dir) => isPathInside(dir, candidate))) return true;
      }
    }
    return false;
  }

  private static matchesDenyPattern(args: Record<string, unknown>): boolean {
    const normalized = JSON.stringify(args).toLowerCase().replace(/\\\\/g, "/").replace(/\s+/g, " ");
    return DENY_PATTERNS.some((p) => p.test(normalized));
  }

  /** Valor de un argumento si es texto no vacío; evita que un valor que no es texto se imprima como "[object Object]". */
  private static text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private static approvalReason(cap: Capability, tool: string, args: Record<string, unknown>): string {
    switch (cap) {
      case "COMMAND_EXECUTION":
        return `Ejecución de comando en terminal: "${Guard.text(args.command) ?? Guard.text(args.cmd) ?? tool}". Requiere confirmación de seguridad.`;
      case "FILE_WRITE":
        return `Modificación o creación de archivo en la ruta "${Guard.text(args.path) ?? Guard.text(args.filename) ?? "sistema"}".`;
      case "PROCESS_CONTROL":
        return `Control de proceso o ciclo de vida de aplicación (${tool}).`;
      case "DOWNLOAD":
        return "Descarga de documento o archivo binario externo hacia el almacenamiento local.";
      case "CONFIGURATION":
        return "Modificación de ajustes de entorno o configuración del sistema.";
      default:
        return `Acción con impacto potencial sobre el sistema (${tool}).`;
    }
  }
}