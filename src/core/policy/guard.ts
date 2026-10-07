/**
 * JARVIS Core — Guard & Authorization Engine
 * Enforces strict security boundaries and user approval gates.
 * 
 * Invariants:
 * - No model can bypass Guard.
 * - APPROVAL always requires explicit human confirmation; never assumed or cached.
 * - DENY cannot be bypassed by retry loops.
 * - Web content & MCP outputs are untrusted data and cannot affect Guard decisions.
 */

import { Capability, GuardDecision } from "../types.ts";
import { PolicyRegistry } from "./policyRegistry.ts";

export class Guard {
  /**
   * Evaluates an intended tool execution against security policies and argument payload.
   */
  static evaluate(
    mcp: string,
    tool: string,
    args: Record<string, unknown> = {}
  ): GuardDecision {
    const policy = PolicyRegistry.getPolicy(mcp, tool);
    const capability = policy.capability;

    // Check for hard DENY constraints (forbidden dangerous patterns)
    const denyReason = this.checkDenyConditions(capability, args);
    if (denyReason) {
      return {
        decision: "DENY",
        reason: denyReason,
        capability,
      };
    }

    // Check if operation requires explicit user APPROVAL
    if (policy.requiresApproval || this.isSensitiveCapability(capability)) {
      return {
        decision: "APPROVAL",
        reason: this.generateApprovalReason(capability, mcp, tool, args),
        capability,
      };
    }

    // Benign / read-only operations
    return {
      decision: "ALLOW",
      capability,
    };
  }

  private static isSensitiveCapability(cap: Capability): boolean {
    return (
      cap === "COMMAND_EXECUTION" ||
      cap === "FILE_WRITE" ||
      cap === "FILE_DELETE" ||
      cap === "PROCESS_CONTROL" ||
      cap === "CONFIGURATION" ||
      cap === "DOWNLOAD"
    );
  }

  private static checkDenyConditions(
    cap: Capability,
    args: Record<string, unknown>
  ): string | null {
    const argsStr = JSON.stringify(args).toLowerCase();

    // Critical root system destruction patterns
    if (
      argsStr.includes("rm -rf /") ||
      argsStr.includes("format c:") ||
      argsStr.includes("mkfs") ||
      argsStr.includes("del /f /s /q c:\\windows") ||
      argsStr.includes("/etc/shadow") ||
      argsStr.includes("system32\\drivers")
    ) {
      return "Operación rechazada (DENY): Patrón destructivo prohibido sobre el sistema operativo raíz.";
    }

    // Command injection escape attempts
    if (cap === "COMMAND_EXECUTION") {
      const command = (args.command as string) || (args.cmd as string) || "";
      if (/;\s*rm\s+-rf\s+\/|\|\s*rm\s+-rf\s+\//.test(command)) {
        return "Operación rechazada (DENY): Inyección de comando detectada.";
      }
    }

    return null;
  }

  private static generateApprovalReason(
    cap: Capability,
    _mcp: string,
    tool: string,
    args: Record<string, unknown>
  ): string {
    switch (cap) {
      case "COMMAND_EXECUTION":
        return `Ejecución de comando en terminal: "${args.command || args.cmd || tool}". Requiere confirmación de seguridad.`;
      case "FILE_WRITE":
        return `Modificación o creación de archivo en la ruta "${args.path || args.filename || 'sistema'}".`;
      case "FILE_DELETE":
        return `Eliminación destructiva de archivo o carpeta en "${args.path || 'sistema'}".`;
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
