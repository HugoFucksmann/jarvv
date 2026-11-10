import type { RouteDecisionInput } from "../../../src/core/engine/deps.ts";
import { lastFailedBy, listBlock } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. route_min con la marca de fallo de route_lean_direct en el criterio de la ruta fallida. */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${desc} [FAILED PREVIOUSLY - DO NOT REPEAT]` : desc;
  }
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
  ].filter(Boolean).join("\n");
  return { state, questions: { route: { type: "choice", instructions: "Which route performs the next action? Avoid previously failed routes.", criteria } } };
}

const route_min_marks: Variant = { name: "route_min_marks", prompts: { DECISION_PROMPTS: { buildRouteChoice } } };
export default route_min_marks;
