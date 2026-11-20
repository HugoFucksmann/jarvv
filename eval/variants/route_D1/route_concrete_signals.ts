import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy, ROUTE_QUESTION } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * route_concrete_signals
 * Criterios concretos y diferenciados basados en el tipo de acción:
 * - files: Known path operations (read, write, append, move, rename existing files/folders).
 * - locate: Search/find local files or folders when the exact location is unknown.
 * - terminal: Shell commands, system/hardware/disk info, running services or managing processes.
 * - web: Online lookups, web search, prices, documentation, external facts or reading web URLs.
 */
function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);

  const routeDescriptions: Record<string, string> = {
    files: "Read, write, edit, copy, move or delete local files and folders when the path is already known. Not for finding lost files or online search.",
    locate: "Search and locate files or folders on the computer when their location is unknown or lost.",
    terminal: "Run PowerShell commands, check hardware, disks, system specs, network, installed tools or running processes.",
    web: "Search online, lookup external information, research topics, prices, news or read web pages.",
  };

  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const base = routeDescriptions[route] ?? route;
    criteria[route] = failed.get(route) === true ? `${base} [the last attempt on this route failed]` : base;
  }

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: { route: { type: "choice", instructions: ROUTE_QUESTION, criteria } },
  };
}

const route_concrete_signals: Variant = {
  name: "route_concrete_signals",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_concrete_signals;
