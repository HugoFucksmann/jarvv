import type { ToolDecisionInput } from "../../../src/core/engine/deps.ts";
import { lastFailedBy, listBlock, shortDesc } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Estado reducido (como tool_choice_lean) con la instrucción y las marcas de tool_choice_direct. */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    listBlock("Done", data.done),
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
    `Route: ${data.route}`,
  ].filter(Boolean).join("\n");
  return { state, questions: { selected_tool: { type: "choice", instructions: "Choose the tool that directly accomplishes the step instruction.", criteria } } };
}

const tool_choice_lean_direct: Variant = { name: "tool_choice_lean_direct", prompts: { DECISION_PROMPTS: { buildToolChoice } } };
export default tool_choice_lean_direct;
