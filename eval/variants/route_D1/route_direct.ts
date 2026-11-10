import type { RouteDecisionInput } from "../../../src/core/engine/deps.ts";
import { frameLines, lastFailedBy } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);

  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${desc} [FAILED PREVIOUSLY - DO NOT REPEAT]` : desc;
  }

  return {
    state: frameLines(data).filter(Boolean).join("\n"),
    questions: {
      route: {
        type: "choice",
        instructions: "Determine which system subsystem (route) can perform the required step. Avoid previously failed routes.",
        criteria,
      },
    },
  };
}

const route_direct: Variant = {
  name: "route_direct",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_direct;

