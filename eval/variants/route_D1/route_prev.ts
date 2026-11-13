import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * route_prev: D1 como era antes de agregar la línea `Request` y la pregunta "Where should this step run?": sin solicitud y con "Which route should handle the next action?".
 * Baseline del A/B de ese cambio.
 */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice({ ...data, request: null });
  const route = base.questions.route;
  if (route.type !== "choice") throw new Error("route_prev: se esperaba una pregunta choice.");
  return { state: base.state, questions: { route: { ...route, instructions: "Which route should handle the next action?" } } };
}

const route_prev: Variant = {
  name: "route_prev",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_prev;
