/**
 * JARVIS Core — Policy Registry
 * Deterministically associates MCP tools to security Capabilities.
 * 
 * Rules:
 * - Deterministic mapping: (mcp, tool) -> capability.
 * - Cannot be modified dynamically by Qwen, Decision 2.0, or tool output.
 * - New or unknown tools trigger Discovery re-check; if unregistered, assigned fallback strict capability.
 */

import { Capability, ToolPolicy } from "../types.ts";

export class PolicyRegistry {
  private static policies: Map<string, ToolPolicy> = new Map([
    // --- Windows MCP ---
    ["windows:ui_get_window_tree", { capability: "READ" }],
    ["windows:ui_get_diff_tree", { capability: "READ" }],
    ["windows:ui_search_elements", { capability: "READ" }],
    ["windows:ui_inspect_element", { capability: "READ" }],
    ["windows:ui_read", { capability: "READ" }],
    ["windows:ui_wait", { capability: "READ" }],
    ["windows:ui_click", { capability: "UI_ACTION" }],
    ["windows:ui_set_focus", { capability: "UI_ACTION" }],
    ["windows:ui_type_text", { capability: "UI_ACTION" }],
    ["windows:set_volume", { capability: "UI_ACTION" }],
    ["windows:launch_app", { capability: "PROCESS_CONTROL", requiresApproval: true }],
    ["windows:close_window", { capability: "PROCESS_CONTROL", requiresApproval: true }],

    // --- Desktop Commander MCP ---
    ["desktop_commander:list_directory", { capability: "FILE_READ" }],
    ["desktop_commander:read_file", { capability: "FILE_READ" }],
    ["desktop_commander:search_files", { capability: "FILE_READ" }],
    ["desktop_commander:write_file", { capability: "FILE_WRITE", requiresApproval: true }],
    ["desktop_commander:edit_file", { capability: "FILE_WRITE", requiresApproval: true }],
    ["desktop_commander:delete_file", { capability: "FILE_DELETE", requiresApproval: true }],
    ["desktop_commander:start_process", { capability: "PROCESS_CONTROL", requiresApproval: true }],
    ["desktop_commander:run_command", { capability: "COMMAND_EXECUTION", requiresApproval: true }],
    ["desktop_commander:kill_process", { capability: "PROCESS_CONTROL", requiresApproval: true }],
    ["desktop_commander:interact_process", { capability: "PROCESS_CONTROL", requiresApproval: true }],
    ["desktop_commander:read_process_output", { capability: "READ" }],
    ["desktop_commander:set_config", { capability: "CONFIGURATION", requiresApproval: true }],

    // --- free-search-mcp ---
    ["free_search:search", { capability: "READ" }],
    ["free_search:fetch_page", { capability: "READ" }],
    ["free_search:extract_structured", { capability: "READ" }],
    ["free_search:read_cached_resource", { capability: "READ" }],
    ["free_search:download_document", { capability: "DOWNLOAD", requiresApproval: true }],
  ]);

  /**
   * Retrieves policy for given MCP and tool.
   * If tool is unknown, returns fallback with strict APPROVAL requirement.
   */
  static getPolicy(mcp: string, tool: string): ToolPolicy {
    const key = `${mcp}:${tool}`;
    const policy = this.policies.get(key);
    if (policy) {
      return policy;
    }

    // Invariant: Unregistered tools are treated as potentially high-risk
    const isDestructiveName = /delete|remove|rm|kill|exec|cmd|shell|run|write|drop|interact/i.test(tool);
    return {
      capability: isDestructiveName ? "COMMAND_EXECUTION" : "READ",
      requiresApproval: isDestructiveName,
    };
  }

  /**
   * Checks if tool is known in the registry
   */
  static isKnownTool(mcp: string, tool: string): boolean {
    return this.policies.has(`${mcp}:${tool}`);
  }
}
