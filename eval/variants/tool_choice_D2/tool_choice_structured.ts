import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: explicitar desempates típicos entre herramientas de la misma ruta (list_directory vs read_file, move_file vs copy_file, edit_file vs write_file, run_command vs stop_process) sin recargar el estado reduce errores en pedidos con verbos similares.
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  const instructions =
    "Choose the single tool that directly matches the step action (avoid tools marked [FAILED - AVOID]; prefer edit_file for partial changes, copy_file vs move_file as requested, list_directory for folder contents, read_file for file contents).";

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const tool_choice_structured: Variant = {
  name: "tool_choice_structured",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_structured;
