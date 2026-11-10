import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { lastFailedBy, listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Estado reducido (como route_lean) con los criterios de route_direct (sin aclaraciones, marca de fallo explícita). */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${desc} [FAILED PREVIOUSLY - DO NOT REPEAT]` : desc;
  }
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    listBlock("Done", data.done),
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
  ].filter(Boolean).join("\n");
  return {
    state,
    questions: { route: { type: "choice", instructions: "Determine which system subsystem (route) can perform the required step. Avoid previously failed routes.", criteria } },
  };
}

const route_lean_direct: Variant = { name: "route_lean_direct", prompts: { DECISION_PROMPTS: { buildRouteChoice } } };
export default route_lean_direct;
