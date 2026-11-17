import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_runtime_focus: refuerza elecciones críticas de las herramientas actuales del manifest:
 * - `run_command` (pid vivo / waiting_input / comandos con filtros o puertos) vs `list_processes` vs `stop_process`
 * - `read_file` vs `read_multiple_files` vs `list_directory`
 * - `start_search` vs `get_more_search_results`
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: {
      selected_tool: {
        type: "choice",
        instructions:
          "Choose the exact tool for this step. Use run_command to continue a running/waiting_input pid or run filtered commands; use stop_process only to kill a known PID; use get_more_search_results only to paginate an active search session.",
        criteria,
      },
    },
  };
}

const tool_choice_runtime_focus: Variant = {
  name: "tool_choice_runtime_focus",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_runtime_focus;
