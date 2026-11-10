import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

const ROUTE_HINTS_FAST: Record<string, string> = {
  files: "Filesystem: reading, writing, moving or listing files/dirs.",
  terminal: "Running commands, scripts, apps or process management.",
  locate: "Searching files across the system by name/pattern.",
  web: "Searching online or fetching web pages.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);

  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    const base = failed.get(route) === true ? `${desc} [last attempt failed]` : desc;
    const hint = ROUTE_HINTS_FAST[route];
    criteria[route] = hint ? `${base} ${hint}` : base;
  }

  return {
    state: frameLines(data).filter(Boolean).join("\n"),
    questions: {
      route: {
        type: "choice",
        instructions: "Select the most appropriate route for the next immediate action.",
        criteria,
      },
    },
  };
}

const route_fast: Variant = {
  name: "route_fast",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_fast;

