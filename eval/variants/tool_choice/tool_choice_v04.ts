/**
 * eval/variants/tool_choice/tool_choice_v04.ts
 *
 * Tool Choice — variante v04 (Iteración 1 hard):
 * Hipótesis:
 * 1) En `files_write`, pasos como "Sobrescribir archivo" o "Agregar línea al final de archivo" eligen erróneamente `edit_file`
 *    cuando la herramienta correcta en el sistema para escribir/sobrescribir/appendear un archivo completo es `write_file`.
 * 2) En `multimedia`, el modelo confunde `media_control` con `play_media` al pedir reproducir un medio específico.
 * v04 clarifica el rol de `write_file` vs `edit_file` y `play_media` vs `media_control`.
 */

import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const toolQ = base.questions.selected_tool;
  if (toolQ.type !== "choice") return base;

  // Mismo tratamiento que producción (descripción recortada con `shortDesc` y marca de herramienta fallida); solo cambian los textos de abajo.
  const failed = lastFailedBy(data.attempts, (a) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let desc = shortDesc(t.description, t.name);
    if (t.name === "write_file") {
      desc = "Create a text file, overwrite an existing file entirely, or write/append content to a file.";
    } else if (t.name === "edit_file") {
      desc = "Find and replace a specific targeted substring within an existing file. Do not use for creating or full overwriting.";
    } else if (t.name === "play_media") {
      desc = "Start playing or open a specific song, video, podcast, or stream.";
    } else if (t.name === "media_control") {
      desc = "Control active playback state: pause, resume, stop, skip, volume up/down/mute.";
    }
    criteria[t.name] = failed.get(t.name) === true ? `${desc} [FAILED - AVOID]` : desc;
  }

  return {
    ...base,
    questions: {
      selected_tool: {
        ...toolQ,
        instructions:
          "Choose the single tool that directly performs the step action. " +
          "Note: Use 'write_file' for creating, overwriting, or writing/appending text to files; " +
          "use 'edit_file' strictly for targeted substring search-and-replace inside existing files.",
        criteria,
      },
    },
  };
}

const tool_choice_v04: Variant = {
  name: "tool_choice_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};
export default tool_choice_v04;
