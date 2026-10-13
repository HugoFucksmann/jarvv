/**
 * JARVIS Core — Policy Registry
 * Deterministically associates MCP tools to security Capabilities.
 * 
 * Rules:
 * - Deterministic mapping: (mcp, tool) -> capability.
 * - Cannot be modified dynamically by Qwen, Decision 2.0, or tool output.
 * - Dynamic command inspection delegated to Guard for run_command.
 */

import { Capability, ToolPolicy } from "../types.ts";
import { SYSTEM_TOOL_MANIFEST } from "../tools/manifest.ts";

export class PolicyRegistry {
  private static policies: Map<string, ToolPolicy> = new Map([
    // Población estricta desde el manifiesto tipado de herramientas
    ...SYSTEM_TOOL_MANIFEST.map((t): [string, ToolPolicy] => [`${t.server}:${t.name}`, t.policy]),
    // Sobrescritura específica para run_command (evaluado dinámicamente en Guard)
    ["desktop_commander:run_command", { capability: "COMMAND_EXECUTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false }],
  ]);

  /**
   * Retrieves policy for given MCP and tool.
   * Recognizes benign inspection prefixes dynamically before forcing fallback approval.
   */
  static getPolicy(mcp: string, tool: string): ToolPolicy {
    const key = `${mcp}:${tool}`;
    const policy = this.policies.get(key);
    if (policy) {
      return policy;
    }

    const isDestructiveName = /delete|remove|rm|kill|exec|cmd|shell|run|write|drop|interact|install|edit/i.test(tool);
    const isExplicitRead = /^(read|get|search|list|inspect|fetch|find|check|view|show|cat|info)/i.test(tool);

    if (isExplicitRead && !isDestructiveName) {
      return {
        capability: "READ",
        requiresApproval: false,
        kind: "READ",
        mutates: false,
        emptyIsError: false,
      };
    }

    const capability: Capability = isDestructiveName ? "COMMAND_EXECUTION" : "READ";
    const kind = capability === "READ" ? "READ" : "no-READ";
    return {
      capability,
      requiresApproval: isDestructiveName,
      kind,
      mutates: kind !== "READ",
      emptyIsError: false,
    };
  }

  /**
   * Checks if tool is known in the registry
   */
  static isKnownTool(mcp: string, tool: string): boolean {
    return this.policies.has(`${mcp}:${tool}`);
  }
}