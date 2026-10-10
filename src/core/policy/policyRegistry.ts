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

export class PolicyRegistry {
  private static policies: Map<string, ToolPolicy> = new Map([
    // ============================================================
    // Windows MCP
    // ============================================================
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

    // ============================================================
    // Desktop Commander MCP
    // ============================================================
    ["desktop_commander:list_directory", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["desktop_commander:read_file", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["desktop_commander:search_files", { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["desktop_commander:read_process_output", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    // run_command se evalúa dinámicamente en Guard (comandos seguros -> auto-allow; destructivos -> approval)
    ["desktop_commander:run_command", { capability: "COMMAND_EXECUTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:write_file", { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:edit_file", { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:delete_file", { capability: "FILE_DELETE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:start_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:kill_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:interact_process", { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["desktop_commander:set_config", { capability: "CONFIGURATION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],

    // ============================================================
    // free-search-mcp (Catálogo completo de herramientas web)
    // ============================================================
    ["free_search:search", { capability: "READ", kind: "READ", mutates: false, emptyIsError: true }],
    ["free_search:fetch", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:fetch_page", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:fetch_batch", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:read_doc", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:research", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:paper_graph", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:cache_search", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:read_cached_resource", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:engines", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:compare", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:extract_structured", { capability: "READ", kind: "READ", mutates: false, emptyIsError: false }],
    ["free_search:download", { capability: "DOWNLOAD", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
    ["free_search:download_document", { capability: "DOWNLOAD", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false }],
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