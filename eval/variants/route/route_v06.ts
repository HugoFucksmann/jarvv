/**
 * eval/variants/route/route_v06.ts
 *
 * Route — variante v06 (Vuelta Manual 2):
 * Combina la fuerza de v04 (regla de prioridad cuando se menciona PowerShell/comando)
 * con los aciertos de v05 (multimedia, system/clipboard y manejo de reintentos tras fallo de shell):
 *
 * 1) PRIORITY: Si el paso dice "con PowerShell", "desde PowerShell", "script", "CLI" o "comando",
 *    la ruta es SIEMPRE 'terminal' (resuelve route-hard-04, 06, 2-08).
 * 2) Peticiones a localhost (127.0.0.1) van a 'terminal' (curl / test-net), NO 'web' (resuelve route-hard-09).
 * 3) Portapapeles (clipboard) y dev_tools instalados van a 'system' (resuelve route-hard-34).
 * 4) Volumen, mutear o adelantar (seek) sonido/música van a 'multimedia'.
 * 5) Consultar versiones en registros públicos en línea (npm, pypi, docs online) sin comando local va a 'web'.
 * 6) Si un comando previo falló (Attempts not approved) y el paso busca texto en logs o crea carpetas,
 *    usar las herramientas nativas 'files_read' / 'files_write'.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const ROUTE_CRITERIA: Record<string, string> = {
  terminal:
    "Execute commands or scripts in a shell (PowerShell/cmd/bash): explicitly mentions PowerShell/CLI/comando, runs scripts, or makes local HTTP requests to localhost / 127.0.0.1.",
  files_read:
    "Inspect, read, search text inside, or list files and folders purely through native file tools (read_file, find_files) without running PowerShell.",
  files_write:
    "Create, write, edit, rename, move, delete, copy, or compress files and folders purely through native file tools (write_file, create_folder) without running PowerShell.",
  system:
    "Query or control operating system: installed dev_tools, clipboard (portapapeles), processes, services, power, or launching desktop apps.",
  multimedia:
    "Play, pause, skip, seek forward/back, or control volume/mute of music, video, and audio playback.",
  web:
    "Search the public internet, look up package versions online (npm/PyPI), read online documentation or websites.",
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
          "Choose the route for the step. Apply these exact rules: " +
          "1. If the step mentions 'PowerShell', 'CLI', 'script', or local requests (localhost / 127.0.0.1) -> 'terminal'. " +
          "2. If the step modifies the clipboard (portapapeles) or checks installed dev_tools -> 'system'. " +
          "3. If the step controls volume/mute or playback -> 'multimedia'. " +
          "4. If checking online package versions (npm/web) without a local command -> 'web'. " +
          "5. If a shell command failed previously and the step seeks text in files/logs or creates directories -> use native 'files_read' or 'files_write'.",
        criteria,
      },
    },
  };
}

const route_v06: Variant = {
  name: "route_v06",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v06;
