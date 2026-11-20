import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_desc_b
 * Redacción alternativa (<= 80 caracteres) que difiere en una señal observable del pedido:
 * run_command = Run PowerShell commands for OS, hardware, disks, network and apps. (68 car.)
 * list_processes = View active tasks, running programs and memory usage. (56 car.)
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let desc = t.description;
    if (t.name === "run_command") {
      desc = "Run PowerShell commands for OS, hardware, disks, network and apps.";
    } else if (t.name === "list_processes") {
      desc = "View active tasks, running programs and memory usage.";
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

const tool_choice_desc_b: Variant = {
  name: "tool_choice_desc_b",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_desc_b;
