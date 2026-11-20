import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_hybrid_calibrated
 * Construida sobre tool_choice_precision_criteria (+0.9% passRate, p=0.011, +17% a +23% en terminal_locate holdouts).
 * Ajuste: Refina las descripciones para evitar las 5 regresiones detectadas:
 * - list_processes: aclara explícitamente "inspect running processes or CPU/RAM"
 * - run_command: mantiene el poder de comandos de sistema/red/puertos sin eclipsar scripts específicos.
 * - get_more_search_results vs start_search: mantiene separación nítida.
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let base = shortDesc(t.description, t.name);
    if (t.name === "run_command") {
      base = "Execute a PowerShell command or script: system info, hardware, ports, disks, network, or file ops.";
    } else if (t.name === "list_processes") {
      base = "List running processes, background tasks, or inspect CPU and memory usage.";
    } else if (t.name === "get_more_search_results") {
      base = "Fetch additional results from an active web search.";
    } else if (t.name === "start_search") {
      base = "Start a fresh web search query.";
    }

    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  const instructions = "Choose the tool that directly accomplishes the step instruction.";

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const tool_choice_hybrid_calibrated: Variant = {
  name: "tool_choice_hybrid_calibrated",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_hybrid_calibrated;
