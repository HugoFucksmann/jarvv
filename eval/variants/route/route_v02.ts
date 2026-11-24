/**
 * eval/variants/route/route_v02.ts
 *
 * Route — variante v02:
 * - route (choice): instrucción reescrita para atacar la confusión terminal ↔ system
 *   y files_read ↔ terminal cuando el paso menciona comandos que leen archivos.
 *
 * Hipótesis: la instrucción de prod y v01 son simétricas pero no resuelven el borde
 * "un comando que lee archivos" → el modelo duda entre terminal y files_read.
 * v02 agrega una regla de desempate explícita: si hay un comando de shell → terminal;
 * si es solo inspección de contenido sin ejecutar nada → files_read / files_write.
 * Criterios idénticos a v01 (ya medidos).
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const ROUTE_CRITERIA: Record<string, string> = {
  terminal: "Run PowerShell commands and programs, read their output and answer their prompts while they run.",
  files_read: "Inspect files and folders without changing them: find, list, search inside files and read content.",
  files_write: "Change files and folders: create, write, edit, copy, move, rename, delete, compress and convert.",
  system: "Query or control the PC: hardware, operating system, disks, services, network, processes, settings, power, clipboard, and opening an application, a URL or a folder.",
  multimedia: "Play music or video and control playback and volume.",
  web: "Search the web, query live internet facts, fetch online documentation, read websites or URLs, and look up current information.",
};

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
        // Instrucción afinada: nombra el borde difícil terminal ↔ files_read.
        // Regla de desempate: si el paso pide ejecutar un comando → terminal;
        // si pide solo leer/listar sin ejecutar nada → files_read.
        instructions:
          "Choose the single route that directly solves the next step instruction. " +
          "If the step says where or how to do it (the terminal, a command, the web, a file path), follow it. " +
          "Key tiebreaker: if the step involves running a shell command or script (even to read output), use 'terminal'; " +
          "use 'files_read' only for inspecting file content without executing any command.",
        criteria,
      },
    },
  };
}

const route_v02: Variant = {
  name: "route_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v02;
