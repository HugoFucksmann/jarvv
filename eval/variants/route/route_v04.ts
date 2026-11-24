/**
 * eval/variants/route/route_v04.ts
 *
 * Route — variante v04 (Iteración 1 hard):
 * Hipótesis: En los casos hard, pasos que crean o transforman archivos pero especifican explícitamente
 * la herramienta o entorno ("desde PowerShell", "usando PowerShell", "con un comando de PowerShell")
 * fueron clasificados como files_write en lugar de terminal.
 * v04 añade regla jerárquica estricta: si el paso menciona "PowerShell", "comando", "script", "bash" o "consola",
 * la ruta TIENE que ser 'terminal', sin importar el verbo de archivo que se use.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const ROUTE_CRITERIA: Record<string, string> = {
  terminal:
    "Execute in a shell (PowerShell/cmd/bash): any step that explicitly mentions a command, PowerShell, script, CLI tool, or pipe, even if it creates, modifies, or inspects files.",
  files_read:
    "Inspect, read, search inside, or list files and folders purely through file-system tools WITHOUT using PowerShell or a shell command.",
  files_write:
    "Create, write, edit, rename, move, delete, copy, or compress files and folders purely through file-system tools WITHOUT using PowerShell or a shell command.",
  system:
    "Query or control OS level: processes, services, hardware, clipboard, power, or launching an application/URL on screen.",
  multimedia: "Play music or video and control playback and volume.",
  web: "Search the web, read online documentation, query live internet URLs.",
};

const MARK = /( \([a-z0-9_-]+\))$/;

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
        instructions:
          "Choose the single route that directly solves the next step instruction. " +
          "PRIORITY RULE: If the step mentions 'PowerShell', 'comando', 'script', or shell execution, always choose 'terminal' regardless of whether it touches files.",
        criteria,
      },
    },
  };
}

const route_v04: Variant = {
  name: "route_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v04;
