import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { lastFailedBy, listBlock, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Estado sin `Expected` ni `Environment`; criterios e instrucción de producción. */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [last attempt failed]` : base;
  }
  const instructions = data.attempts.length > 0
    ? "Which tool should make the next call? Prefer a tool that makes new progress and avoid tools marked [last attempt failed]."
    : "Which tool should make the next call?";
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    listBlock("Done", data.done),
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
    `Route: ${data.route}`,
  ].filter(Boolean).join("\n");
  return { state, questions: { selected_tool: { type: "choice", instructions, criteria } } };
}

const tool_choice_lean: Variant = { name: "tool_choice_lean", prompts: { DECISION_PROMPTS: { buildToolChoice } } };
export default tool_choice_lean;
