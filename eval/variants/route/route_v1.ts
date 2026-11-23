/**
 * eval/variants/route/route_v1.ts
 *
 * Hipótesis: delimitar en `criteria` las fronteras entre rutas vecinas (`terminal` para comandos/ping/scripts vs `system` para estado/ajustes/portapapeles vs `multimedia` para audio/video/volumen vs `web` para búsquedas/descargas) reduce confusiones por palabras sueltas.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FAILED_MARK = "[the last attempt on this route failed]";

const CRITERIA: Record<string, string> = {
  terminal:
    "Run CLI tools, scripts, package managers, git, network diagnostics (ping, nslookup, curl), recursive size totals, or any step that explicitly asks for the terminal or PowerShell.",
  files_read:
    "Read-only local filesystem: find files by name, list folder entries (with size/date/filter), search text inside local files, or read a local file's lines. Not for opening apps.",
  files_write:
    "Local file/folder mutations: create, write, append, edit text, copy, move, rename, delete, compress/extract .zip, or convert/resize media files. Not for opening apps.",
  system:
    "PC state (hardware, OS, disks, services, network, processes, ports, datetime), stop a process, PC settings (brightness, wifi, bluetooth, dark mode, do not disturb), power (lock, sleep, restart, shutdown), open URL/folder/app on screen, or clipboard.",
  multimedia:
    "Search and play music or video on YouTube or Spotify, and control playback or system volume (play, pause, next, previous, seek, mute, volume level, now playing).",
  web:
    "Search information online, read web pages from http(s) URLs, or download a file from an http(s) URL to disk.",
};

function buildRouteChoice(data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const question = base.questions.route;
  if (question?.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(question.criteria).map(([option, text]) => {
      const own = CRITERIA[option];
      if (own === undefined) return [option, text];
      const hasFailed = text.includes(FAILED_MARK);
      return [option, hasFailed ? `${own} ${FAILED_MARK}` : own];
    }),
  );
  return { ...base, questions: { route: { ...question, criteria } } };
}

const route_v1: Variant = {
  name: "route_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_v1;
