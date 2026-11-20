import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_precision_criteria
 * Hipótesis: En d3:2b, run_command es erróneamente elegido como list_processes cuando la instrucción
 * pide consultar estado o información de sistema, y get_more_search_results se confunde con start_search.
 * Aclarar con criterios concretos y directos para run_command, list_processes, start_search y get_more_search_results.
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let base = shortDesc(t.description, t.name);
    if (t.name === "run_command") {
      base = "Run a PowerShell command, inspect ports, disks, services, network, or system state.";
    } else if (t.name === "list_processes") {
      base = "List currently running processes and their memory or CPU. Only for processes.";
    } else if (t.name === "get_more_search_results") {
      base = "Fetch the next page of results from an existing web search.";
    } else if (t.name === "start_search") {
      base = "Start a new web search with a query.";
    }

    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  const instructions = "Choose the tool that directly accomplishes the step instruction.";

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const tool_choice_precision_criteria: Variant = {
  name: "tool_choice_precision_criteria",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_precision_criteria;
