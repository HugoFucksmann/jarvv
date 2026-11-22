/**
 * eval/variants/route/route_v2.ts
 *
 * Variante de `route` (`buildRouteChoice`) generada por `--auto --mode=improve` (base `prod`, optimizador qwen3.5:4b, vuelta 4) y promovida el 2026-11-21.
 * Cambia solo la instrucción y las descripciones de las opciones; el estado y el resto salen de la función de producción.
 *
 * Medición (modelo de decisión d3:2b-text, el optimizador no vio ningún caso de evaluación):
 * - Desarrollo (route_v1, 20 casos): 20/20 (prod: 18/20).
 * - Holdout (route_v1_holdout, 125 casos): 118/125 = 94,4 % (prod: 108/125 = 86,4 %). Arregló 15 casos (consultas del estado del equipo que ahora van a `system`)
 *   y rompió 5 (curl y nslookup explícitos, silenciar el sonido, y dos búsquedas web). Diferencia de 15 contra 5: p ≈ 0,04.
 * - El holdout se armó alrededor de la confusión conocida de prod (estado del equipo contra terminal): es una prueba de estrés de ese punto, no una muestra del uso real.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Variante generada por código: la salida de producción (DECISION_PROMPTS.buildRouteChoice) con estos textos reemplazados.
interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = {
  "instructions": {
    "route": "Where should this step run? If the step involves managing hardware, OS state, services, network, or performing system maintenance (restart, lock, sleep), choose 'system'. If the user needs to open an application via a command line interface to execute commands or view logs, choose 'terminal'. Do not use 'terminal' for general GUI interactions like opening apps directly from the screen."
  },
  "criteria": {
    "route": {
      "files_read": "Find, list and read files and folders: look a file up by name, search text inside files, see what a folder contains, read a file. Not for opening applications.",
      "files_write": "Create, write, edit, copy, move, rename, delete, compress or convert files and folders. Not for opening applications.",
      "system": "Check the state of the PC (hardware, system, disks, services, network, processes, ports, date and time), stop processes, change settings, lock, sleep, restart or shut down, open an application or URL on screen, use the clipboard, and manage GUI windows. This covers all non-command-line OS interactions.",
      "terminal": "Run a command or program via a command line interface to execute scripts, view raw output, send input, or query specific file metadata (sizes, dates, sorting). Opening an application such as Notepad belongs here ONLY if done via CLI commands.",
      "web": "Look up information online, read the content of web pages (including known URLs), and download a file from a URL.",
      "multimedia": "Play music or video, and control the playback and the volume."
    }
  }
};

// Conserva la marca final entre corchetes que producción agrega a una opción (por ejemplo `[the last attempt on this route failed]`).
const MARKER = /\s*(\[[^\]]*\])\s*$/;

function buildRouteChoice(data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const questions: DecisionInput["questions"] = {};
  for (const [key, question] of Object.entries(base.questions)) {
    const next = { ...question };
    const instructions = PATCH.instructions?.[key];
    if (instructions !== undefined) next.instructions = instructions;
    const criteria = PATCH.criteria?.[key];
    if (next.type === "choice" && criteria !== undefined) {
      const merged: Record<string, string> = { ...next.criteria };
      for (const [option, text] of Object.entries(criteria)) {
        if (!(option in merged)) continue;
        const marker = MARKER.exec(merged[option]);
        merged[option] = marker ? `${text} ${marker[1]}` : text;
      }
      next.criteria = merged;
    }
    questions[key] = next;
  }
  const state = PATCH.stateNote === undefined ? base.state : `${PATCH.stateNote}\n${base.state}`;
  return { ...base, state, questions };
}

const route_v2: Variant = {
  name: "route_v2",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v2;
