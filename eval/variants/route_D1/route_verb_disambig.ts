import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines, lastFailedBy } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * route_verb_disambig: resuelve confusiones medidas en modelos chicos (d3-2b):
 * - verbos de archivo con terminal explícita ("creá/mové... en PowerShell"), tamaños/fechas/totales/zip -> `terminal`
 * - dominios de red en comandos (`ping google.com`) -> `terminal`, no `web`
 * - fallback `not_found` -> `locate`
 */
const DISAMBIG_DESC: Record<string, string> = {
  files: "Direct file/folder operations on known paths (read text/PDF/Excel, write text/Excel, list directory entries, create directory, move/rename). Do NOT pick if the step asks for terminal/PowerShell/scripts, file sizes/dates/disk usage, archives, or launching apps.",
  terminal: "PowerShell commands, scripts, launching apps, network diagnostics (ping/curl/ipconfig), file sizes/dates/sorting, archives (zip/tar), system metrics, and managing or stopping processes.",
  locate: "Find files by filename pattern or search text inside local files/folders (or locate the real path after not_found).",
  web: "Online web searches and reading http/https web pages (not local network commands like ping).",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const base = DISAMBIG_DESC[route] ?? DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${base} (previous attempt failed)` : base;
  }

  return {
    state: [data.request ? `Request: ${data.request}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: {
      route: {
        type: "choice",
        instructions:
          "Select the route that matches HOW this step must run. Commands, PowerShell, network tools, sizes/dates, processes, and apps go to terminal even if the goal mentions files or domains.",
        criteria,
      },
    },
  };
}

const route_verb_disambig: Variant = {
  name: "route_verb_disambig",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_verb_disambig;
