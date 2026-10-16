/**
 * JARVIS Core — Guard & Authorization Engine
 *
 * Invariantes:
 * - Ningún modelo puede eludir Guard.
 * - Patrones destructivos sobre el SO => DENY siempre. Se escanean los argumentos que son rutas o comandos; no se
 *   escanean los de `free_search` (consultas y URLs) ni el campo `content` de `desktop_commander:write_file` (texto
 *   que se escribe: sus rutas, `path`, sí se escanean, y ejecutarlo exige un `start_process`, que siempre pide aprobación).
 * - Herramienta no catalogada en el manifest => APPROVAL (fail-closed; en la práctica runStep ya no la ofrece).
 * - policy.requiresApproval => APPROVAL cada vez (la aprobación no perdura).
 * - Resto => ALLOW (lecturas).
 * - La política sale únicamente del manifest (tools/manifest.ts); no hay otra fuente.
 */

import type { Capability, GuardDecision } from "../types.ts";
import { getToolPolicy, isKnownTool } from "../tools/manifest.ts";

// Se evalúan sobre el JSON de args en minúsculas, con "\\" -> "/" y espacios colapsados.
// NOTA: comportamiento heredado: `rm -rf /<cualquier ruta>` también dispara DENY (falso positivo conocido).
const DENY_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-\w+\s+)+\//,
  /\bformat\s+c:/,
  /\bmkfs\b/,
  /del\s+\/f\s+\/s\s+\/q\s+c:\/windows/,
  /\/etc\/shadow/,
  /system32\/drivers/,
];

export class Guard {
  static evaluate(mcp: string, tool: string, args: Record<string, unknown> = {}): GuardDecision {
    const policy = getToolPolicy(mcp, tool);
    const capability = policy.capability;

    const scannable = this.denyScanArgs(mcp, tool, args);
    if (scannable && this.matchesDenyPattern(scannable)) {
      return {
        decision: "DENY",
        reason: "Operación rechazada (DENY): patrón destructivo prohibido sobre el sistema operativo.",
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

    if (policy.requiresApproval) {
      return { decision: "APPROVAL", reason: this.approvalReason(capability, tool, args), capability };
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

  private static matchesDenyPattern(args: Record<string, unknown>): boolean {
    const normalized = JSON.stringify(args).toLowerCase().replace(/\\\\/g, "/").replace(/\s+/g, " ");
    return DENY_PATTERNS.some((p) => p.test(normalized));
  }

  private static approvalReason(cap: Capability, tool: string, args: Record<string, unknown>): string {
    switch (cap) {
      case "COMMAND_EXECUTION":
        return `Ejecución de comando en terminal: "${args.command || args.cmd || tool}". Requiere confirmación de seguridad.`;
      case "FILE_WRITE":
        return `Modificación o creación de archivo en la ruta "${args.path || args.filename || "sistema"}".`;
      case "PROCESS_CONTROL":
        return `Control de proceso o ciclo de vida de aplicación (${tool}).`;
      case "DOWNLOAD":
        return `Descarga de documento o archivo binario externo hacia el almacenamiento local.`;
      case "CONFIGURATION":
        return `Modificación de ajustes de entorno o configuración del sistema.`;
      default:
        return `Acción con impacto potencial sobre el sistema (${tool}).`;
    }
  }
}