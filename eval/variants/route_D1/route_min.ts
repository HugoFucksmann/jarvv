import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { lastFailedBy, listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. Mínimo: sin `Done` (solo el último resultado), criterios planos (sin marca de fallo: el fallo va en `Attempts`) e instrucción corta. */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const criteria: Record<string, string> = {};
  for (const route of data.routes) criteria[route] = DESTINATIONS[route].description;
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
  ].filter(Boolean).join("\n");
  return { state, questions: { route: { type: "choice", instructions: "Which route performs the next action?", criteria } } };
}

const route_min: Variant = { name: "route_min", prompts: { DECISION_PROMPTS: { buildRouteChoice } } };
export default route_min;
