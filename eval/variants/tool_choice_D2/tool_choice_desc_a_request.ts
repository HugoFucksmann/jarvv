import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_desc_a_request
 * La combinación de tool_choice_desc_a y tool_choice_request:
 * Descripciones nuevas de terminal + línea Request: al inicio del estado.
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let desc = t.description;
    if (t.name === "run_command") {
      desc = "Run a PowerShell command: system info, hardware, disks, services, files.";
    } else if (t.name === "list_processes") {
      desc = "List running processes with their memory use. Not for hardware or system info.";
    }
    const base = shortDesc(desc, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  const instructions = "Choose the tool that directly accomplishes the step instruction.";

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data), `Route: ${data.route}`]
      .filter(Boolean)
      .join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const tool_choice_desc_a_request: Variant = {
  name: "tool_choice_desc_a_request",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_desc_a_request;
