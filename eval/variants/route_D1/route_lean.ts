import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { lastFailedBy, listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Estado sin `Expected` ni `Environment`; criterios de producción (con las aclaraciones por ruta). */
const ROUTE_HINTS: Record<string, string> = {
  files: "Not for opening or launching applications.",
  terminal: "Opening an application such as Notepad or the calculator belongs here.",
  locate: "Also use it after a file was not found at the path that was tried.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    const base = failed.get(route) === true ? `${desc} [the last attempt on this route failed]` : desc;
    criteria[route] = ROUTE_HINTS[route] ? `${base} ${ROUTE_HINTS[route]}` : base;
  }
  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    listBlock("Done", data.done),
    data.lastResult === null ? null : `Last result: ${data.lastResult}`,
    listBlock("Attempts not approved", data.attempts.map((a) => a.text)),
    listBlock("User input", data.userInput),
  ].filter(Boolean).join("\n");
  return { state, questions: { route: { type: "choice", instructions: "Which route should handle the next action?", criteria } } };
}

const route_lean: Variant = { name: "route_lean", prompts: { DECISION_PROMPTS: { buildRouteChoice } } };
export default route_lean;
