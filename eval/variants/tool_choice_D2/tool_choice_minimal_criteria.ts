import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock, shortDesc } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * tool_choice_minimal_criteria: estado compacto (sin ruido de `Environment`) y sin etiqueta `[FAILED - AVOID]`
 * en criterios: deja que el modelo vea el historial en `Attempts not approved` sin sesgar en contra de la herramienta
 * cuando un intento anterior solo falló por argumentos inválidos o por falta de una sesión previa.
 */
function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    criteria[t.name] = shortDesc(t.description, t.name);
  }

  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    data.step?.expected ? `Expected: ${data.step.expected}` : null,
    listBlock("Done", data.done),
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
    `Route: ${data.route}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      selected_tool: {
        type: "choice",
        instructions: "Pick the single tool whose capability directly performs the Step.",
        criteria,
      },
    },
  };
}

const tool_choice_minimal_criteria: Variant = {
  name: "tool_choice_minimal_criteria",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_minimal_criteria;
