import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, ROUTE_QUESTION } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * route_research_aware
 * Clarifica que web es para investigar o buscar información externa (precios, clima, datos)
 * incluso si la tarea incluye crear o guardar en archivos.
 * Clarifica que files es solo para operar sobre rutas de archivos locales ya conocidas.
 */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);

  const hints: Record<string, string> = {
    files: "Only for reading, saving or moving local files at known paths. Not for searching unknown files or online research.",
    terminal: "Run commands, check hardware, OS info, services or active processes.",
    web: "Look up information online, search the web, research facts, prices, weather or news.",
  };

  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    const base = failed.get(route) === true ? `${desc} [the last attempt on this route failed]` : desc;
    const hint = hints[route];
    criteria[route] = hint ? `${base} ${hint}` : base;
  }

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: { route: { type: "choice", instructions: ROUTE_QUESTION, criteria } },
  };
}

const route_research_aware: Variant = {
  name: "route_research_aware",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_research_aware;
