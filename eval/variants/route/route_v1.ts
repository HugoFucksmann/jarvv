/**
 * eval/variants/route/route_v1.ts
 *
 * Variante dedicada para la etapa `route` (`buildRouteChoice`).
 * Refuerza límites entre las 6 rutas ejecutables (`EXECUTABLE_ROUTES`) y penaliza rutas recién fallidas.
 */

import type { DecisionAttempt, RouteDecisionInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, frameLines, lastFailedBy, safe } from "../../../src/core/models/prompts.ts";
import { DESTINATIONS } from "../../../src/core/tools/manifest.ts";
import type { Variant } from "../../core/variants/types.ts";

const ROUTE_RULES: Record<string, string> = {
  files_read:
    "Read-only file/folder inspection: find files by name/pattern, list folder entries, search text inside files, read file content. Never writes/moves/deletes and never opens apps.",
  files_write:
    "File/folder mutations on disk: create folders, write/append/edit files, copy, move/rename, delete, zip/unzip archives, convert multimedia files.",
  system:
    "Host state & desktop UI: hardware/OS/disk/process/service/network/ports/datetime info, stop processes, toggle PC settings, power actions, open app/URL/path on screen, clipboard.",
  multimedia:
    "Play music or video on YouTube/Spotify and control active media playback or volume.",
  terminal:
    "Execute PowerShell commands, scripts, builds, tests, git/npm/python CLIs, or OS operations with no dedicated tool.",
  web:
    "Live web search, fetch web page content by URL, or download files from http(s) URLs.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a: DecisionAttempt) => a.route);
  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = ROUTE_RULES[route] ?? DESTINATIONS[route].description;
    criteria[route] = failed.get(route) === true ? `${desc} [PREVIOUS ATTEMPT FAILED — AVOID IF ALTERNATIVE EXISTS]` : desc;
  }

  return {
    state: [data.request ? `Request: ${safe(data.request)}` : null, ...frameLines(data)].filter(Boolean).join("\n"),
    questions: {
      route: {
        type: "choice",
        instructions:
          "Pick the single best executable route for the current step. Honor explicit intent (create/edit/move/delete -> files_write; locate/list/read -> files_read; run command/script -> terminal; open on screen/PC info -> system; search/download URL -> web).",
        criteria,
      },
    },
  };
}

const route_v1: Variant = {
  name: "route_v1",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_v1;
