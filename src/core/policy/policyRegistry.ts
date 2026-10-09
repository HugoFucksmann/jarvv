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
    ["windows:ui_get_window_tree", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_get_diff_tree", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_search_elements", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_inspect_element", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_read", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_wait", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["windows:ui_click", { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false }],
    ["windows:ui_set_focus", { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false }],
    ["windows:ui_type_text", { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false }],
    ["windows:set_volume", { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false }],
    ["windows:launch_app", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["windows:close_window", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],

    // --- Desktop Commander MCP ---
    ["desktop_commander:list_directory", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["desktop_commander:read_file", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["desktop_commander:search_files", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["desktop_commander:write_file", { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:edit_file", { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:delete_file", { capability: "FILE_DELETE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:start_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:run_command", { capability: "COMMAND_EXECUTION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:kill_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:interact_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:read_process_output", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["desktop_commander:set_config", { capability: "CONFIGURATION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],

    // --- free-search-mcp ---
    ["free_search:search", { capability: "READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["free_search:fetch_page", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:extract_structured", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:read_cached_resource", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:download_document", { capability: "DOWNLOAD", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
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

    // Invariant: Unregistered tools are treated as potentially high-risk and require approval
    const isDestructiveName = /delete|remove|rm|kill|exec|cmd|shell|run|write|drop|interact/i.test(tool);
    const capability: Capability = isDestructiveName ? "COMMAND_EXECUTION" : "READ";
    const kind = capability === "READ" ? "READ" : "no-READ";
    return {
      capability,
      requiresApproval: true, // Always require approval for unregistered tools
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
