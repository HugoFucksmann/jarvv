import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_r1_action_verbs:
 * Variante basada en tool_choice_desc_a pero especificando verbos de acción
 * ('run' vs 'inspect' vs 'terminate') para guiar al modelo en la primera palabra.
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let desc = t.description;
    if (t.name === "run_command") {
      desc = "Run/execute PowerShell commands: system diagnostics, hardware, services, files.";
    } else if (t.name === "list_processes") {
      desc = "Inspect running processes by memory/CPU. Never for hardware, disks or services.";
    } else if (t.name === "stop_process") {
      desc = "Terminate/kill a running process by its pid.";
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

const tool_choice_r1_action_verbs: Variant = {
  name: "tool_choice_r1_action_verbs",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_r1_action_verbs;
