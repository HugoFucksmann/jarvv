/**
 * JARVIS Core — Guard & Authorization Engine
 *
 * Invariantes:
 * - Ningún modelo puede eludir Guard.
 * - Patrones destructivos sobre el SO => DENY siempre.
 * - Herramienta no catalogada en el manifest => APPROVAL (fail-closed).
 * - policy.requiresApproval => APPROVAL cada vez (la aprobación no perdura).
 * - Resto => ALLOW (lecturas y UI_ACTION, por decisión de diseño).
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

    if (this.matchesDenyPattern(args)) {
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