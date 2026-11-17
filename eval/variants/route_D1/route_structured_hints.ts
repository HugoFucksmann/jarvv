import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, ROUTE_QUESTION } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: agregar reglas breves de desambiguación por ruta (`files` lectura/escritura puntual en ruta conocida vs `locate` buscar/encontrar vs `terminal` apps/comandos/conteos/filtros vs `web`) mejora el enrutamiento en casos ambiguos sin perder casos de terminal explícita.
const STRUCTURED_HINTS: Record<string, string> = {
  files: "Use for direct read, write, edit, copy, move or delete at a known path. Never for opening GUI apps or running shell commands.",
  locate: "Use to find files/folders by name, pattern, size or extension, or after a not_found error.",
  terminal: "Use to run commands/scripts, open/close apps (Notepad, calculator, browser), inspect processes/system state, or filter/count lines.",
  web: "Use only for online/external information or fetching a URL.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const base = STRUCTURED_HINTS[route] ?? DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${base} [last attempt failed]` : base;
  }

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: { route: { type: "choice", instructions: ROUTE_QUESTION, criteria } },
  };
}

const route_structured_hints: Variant = {
  name: "route_structured_hints",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_structured_hints;
