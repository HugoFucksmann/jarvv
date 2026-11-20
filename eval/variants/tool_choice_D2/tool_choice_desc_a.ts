import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_desc_a
 * Prueba descripciones nuevas para terminal:
 * run_command = Run a PowerShell command: system info, hardware, disks, services, files.
 * list_processes = List running processes with their memory use. Not for hardware or system info.
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
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const tool_choice_desc_a: Variant = {
  name: "tool_choice_desc_a",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_desc_a;
