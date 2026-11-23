/**
 * eval/variants/route/route_v01.ts
 *
 * Hipótesis: Alinear las notas de ruta con `manifest.ts` (corrigiendo la contradicción de abrir apps/URLs/carpetas en pantalla hacia `system` y aclarando que comandos, ping y totales de carpetas van a `terminal`) reduce errores entre `system`, `terminal` y `files_*`.
 */

import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const MARK = /\s*(\[[^\]]*\])\s*$/;

const CRITERIA: Record<string, string> = {
  files_read:
    "Read-only local file and folder inspection: find by name, list and sort/filter a folder, search text inside files, read a file. Never for URLs or opening apps.",
  files_write:
    "Create, write, edit, copy, move, rename, delete, compress (.zip) or convert local files and folders. Never for explicit terminal commands.",
  terminal:
    "Run a shell/PowerShell command, script or CLI tool (git, npm, python, ping, curl, hashes), continue a running PID, or compute recursive totals/line counts. Follow explicit terminal/PowerShell requests.",
  system:
    "Inspect PC state (hardware, OS, disks, services, dev_tools, network, processes, ports, datetime), stop a process, change settings (brightness, wifi, bluetooth, dark mode, do not disturb), power, clipboard, or open an app/URL/folder on screen.",
  multimedia:
    "Search and play music or video on YouTube or Spotify, or control playback and audio volume (play, pause, skip, seek, mute, now playing).",
  web:
    "Look up information online, read content from http(s) URLs, or download a file from a URL to disk.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const question = base.questions.route;
  if (question.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(question.criteria).map(([option, text]) => {
      const own = CRITERIA[option];
      const mark = MARK.exec(text)?.[1];
      return [option, own === undefined ? text : `${own}${mark ? ` ${mark}` : ""}`];
    }),
  );
  return { ...base, questions: { route: { ...question, criteria } } };
}

const route_v01: Variant = {
  name: "route_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v01;
