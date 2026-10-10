/**
 * JARVIS Core — Guard & Authorization Engine
 * Enforces strict security boundaries, command inspection, and user approval gates.
 * 
 * Invariants:
 * - No model can bypass Guard.
 * - Critical OS destruction patterns always result in DENY.
 * - Safe inspection commands run autonomously (Auto-ALLOW).
 * - Modifying/destructive console commands and file mutations require APPROVAL.
 */

import { Capability, GuardDecision, ToolPolicy } from "../types.ts";
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

    // 1. Verificación de reglas duras DENY (patrones destructivos prohibidos)
    const denyReason = this.checkDenyConditions(capability, args);
    if (denyReason) {
      return {
        decision: "DENY",
        reason: denyReason,
        capability,
      };
    }

    // 2. Verificación dinámica de aprobación (APPROVAL)
    if (this.requiresApprovalCheck(policy, capability, tool, args)) {
      return {
        decision: "APPROVAL",
        reason: this.generateApprovalReason(capability, mcp, tool, args),
        capability,
      };
    }

    // 3. Operación benigna autorizada automáticamente (ALLOW)
    return {
      decision: "ALLOW",
      capability,
    };
  }

  /**
   * Determina si la acción requiere confirmación humana en tiempo de ejecución.
   */
  private static requiresApprovalCheck(
    policy: ToolPolicy,
    cap: Capability,
    tool: string,
    args: Record<string, unknown>
  ): boolean {
    // Si la política estática ya exige aprobación (ej. write_file, delete_file, kill_process)
    if (policy.requiresApproval) {
      return true;
    }

    // Evaluación dinámica para comandos de terminal (run_command)
    if (cap === "COMMAND_EXECUTION" || tool === "run_command") {
      const command = ((args.command as string) || (args.cmd as string) || "").trim();
      // Si el comando es de solo lectura / inspección comprobada, NO molestar al usuario
      if (this.isSafeReadonlyCommand(command)) {
        return false;
      }
      // Cualquier comando modificador, instalador o desconocido requiere confirmación
      return true;
    }

    // Capacidades intrínsecamente sensibles sobre el entorno
    return (
      cap === "FILE_WRITE" ||
      cap === "FILE_DELETE" ||
      cap === "PROCESS_CONTROL" ||
      cap === "CONFIGURATION" ||
      cap === "DOWNLOAD"
    );
  }

  /**
   * Clasifica si un comando de consola es de solo lectura / inspección segura.
   */
  static isSafeReadonlyCommand(commandStr: string): boolean {
    if (!commandStr || typeof commandStr !== "string") return false;
    const clean = commandStr.trim();
    if (!clean) return false;

    const lower = clean.toLowerCase();

    // Palabras o patrones que implican mutación, instalación o borrado
    const destructivePatterns = [
      /\bdel\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brd\b/,
      /\berase\b/,
      /\bformat\b/,
      /\bmkfs\b/,
      /\bkill\b/,
      /\btaskkill\b/,
      /\binstall\b/,
      /\badd\b/,
      /\bcommit\b/,
      /\bpush\b/,
      /\breset\b/,
      /\bcheckout\s+-b\b/,
      /\bclean\b/,
      /\brebase\b/,
      /\bmove\b/,
      /\bmv\b/,
      /\bcopy\b/,
      /\bcp\b/,
      /\bxcopy\b/,
      /\brobocopy\b/,
      /\bren\b/,
      /\brename\b/,
      /\bsetx\b/,
      /\bshutdown\b/,
      /\breboot\b/,
      /\bchmod\b/,
      /\bchown\b/,
      /\bcurl\b/,
      /\bwget\b/,
      /\bpowershell\b/,
      /\bbash\b/,
      /\bsh\b/,
      /\bcmd\b/,
      />/, // Redirección de salida a archivo (escritura)
    ];

    for (const pattern of destructivePatterns) {
      if (pattern.test(lower)) {
        return false;
      }
    }

    // Obtener el comando principal
    const firstToken = lower.split(/[\s|&;]+/)[0] || "";

    const safeBaseCommands = new Set([
      "dir",
      "ls",
      "echo",
      "type",
      "cat",
      "pwd",
      "cd",
      "where",
      "which",
      "whoami",
      "hostname",
      "head",
      "tail",
      "more",
      "findstr",
      "grep",
      "tree",
      "node",
      "npm",
      "npx",
      "python",
      "python3",
      "py",
      "git",
      "rustc",
      "cargo",
      "go",
      "java",
      "javac",
      "dotnet",
    ]);

    if (safeBaseCommands.has(firstToken)) {
      // Para herramientas como git, npm o python, validar que sean subcomandos de consulta
      if (firstToken === "git") {
        return /^(git\s+)?(status|log|diff|branch|show|tag|remote|rev-parse|describe|config\s+--get)(\s+.*)?$/.test(lower);
      }
      if (firstToken === "npm" || firstToken === "npx" || firstToken === "yarn" || firstToken === "pnpm") {
        return /^(npm|npx|yarn|pnpm)(\s+.*)?\s+(-v|--version|list|view|show|outdated|help)(\s+.*)?$/.test(lower);
      }
      if (
        firstToken === "node" ||
        firstToken === "python" ||
        firstToken === "python3" ||
        firstToken === "py" ||
        firstToken === "cargo" ||
        firstToken === "rustc" ||
        firstToken === "go" ||
        firstToken === "java" ||
        firstToken === "dotnet"
      ) {
        return /(-v|--version|-V|-h|--help|version)$/.test(lower.trim());
      }
      return true;
    }

    return false;
  }

  private static checkDenyConditions(
    cap: Capability,
    args: Record<string, unknown>
  ): string | null {
    // Normalizar a minúsculas y convertir barras invertidas a '/' para neutralizar el doble escape de JSON.stringify
    const argsStr = JSON.stringify(args).toLowerCase().replace(/\\\\/g, "/");

    // Patrones prohibidos contra el sistema operativo raíz
    if (
      argsStr.includes("rm -rf /") ||
      argsStr.includes("format c:") ||
      argsStr.includes("mkfs") ||
      argsStr.includes("del /f /s /q c:/windows") ||
      argsStr.includes("/etc/shadow") ||
      argsStr.includes("system32/drivers")
    ) {
      return "Operación rechazada (DENY): Patrón destructivo prohibido sobre el sistema operativo raíz.";
    }

    // Inyecciones de comando
    if (cap === "COMMAND_EXECUTION") {
      const command = ((args.command as string) || (args.cmd as string) || "").replace(/\\/g, "/");
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