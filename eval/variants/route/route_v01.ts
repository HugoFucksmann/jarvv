/**
 * eval/variants/route/route_v01.ts
 *
 * Route completa:
 * - route (choice): criterios explícitos para todas las rutas ejecutables disponibles.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Un texto por cada ruta ejecutable: si falta una, la variante no carga.
const ROUTE_CRITERIA: Record<string, string> = {
  terminal: "Run PowerShell commands and programs, read their output and answer their prompts while they run.",
  files_read: "Inspect files and folders without changing them: find, list, search inside files and read content.",
  files_write: "Change files and folders: create, write, edit, copy, move, rename, delete, compress and convert.",
  system: "Query or control the PC: hardware, operating system, disks, services, network, processes, settings, power, clipboard, and opening an application, a URL or a folder.",
  multimedia: "Play music or video and control playback and volume.",
  web: "Search the web, query live internet facts, fetch online documentation, read websites or URLs, and look up current information.",
};

// Producción agrega al final de una opción una marca entre corchetes (por ejemplo `[the last attempt on this route failed]`); se conserva.
const MARK = /\s*(\[[^\]]*\])\s*$/;

function buildRouteChoice(data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const routeQ = base.questions.route;
  if (routeQ.type !== "choice") return base;

  const criteria = Object.fromEntries(
    Object.entries(routeQ.criteria).map(([route, text]) => {
      const own = ROUTE_CRITERIA[route];
      if (own === undefined) throw new Error(`falta el texto de la ruta '${route}'`);
      const mark = MARK.exec(text)?.[1];
      return [route, mark === undefined ? own : `${own} ${mark}`];
    }),
  );

  return {
    ...base,
    questions: {
      route: {
        ...routeQ,
        instructions: "Choose the single destination route that directly solves the next step instruction.",
        criteria,
      },
    },
  };
}

const route_v01: Variant = {
  name: "route_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v01;
