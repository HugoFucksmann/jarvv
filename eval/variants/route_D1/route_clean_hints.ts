import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, ROUTE_QUESTION } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * route_clean_hints: igual a prod (Request + frameLines + ROUTE_HINTS), pero sin la marca `[the last attempt on this route failed]`,
 * que según DN-3.1 no mejoró los reintentos (0/18) y puede empujar fuera de la ruta correcta tras un fallo de argumentos.
 */
const ROUTE_HINTS: Record<string, string> = {
  files: "Read, write, create directory, or move known file paths directly; not for launching apps.",
  terminal: "Run PowerShell commands, launch apps, inspect sizes/dates/totals/archives, or list/stop processes.",
  locate: "Search files by name/pattern or text inside files; use after a file path was not found.",
  web: "Search the web or read web URLs for online facts or documentation.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    criteria[route] = ROUTE_HINTS[route] ?? DESTINATIONS[route].description;
  }

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: { route: { type: "choice", instructions: ROUTE_QUESTION, criteria } },
  };
}

const route_clean_hints: Variant = {
  name: "route_clean_hints",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_clean_hints;
