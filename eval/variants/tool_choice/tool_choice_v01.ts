/**
 * eval/variants/tool_choice/tool_choice_v01.ts
 *
 * Hipótesis: Enriquecer la instrucción de `tool_choice` para distinguir pares cercanos (nombre vs contenido en `files_read`, edición puntual vs escritura completa en `files_write`, leer web vs descargar a disco en `web`, reproducir nuevo vs controlar reproducción actual en `multimedia`) mejora la selección cuando el contexto incluye detalles parecidos.
 */

import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const INSTRUCTIONS =
  "Choose the single tool that directly matches the Step: distinguish finding by name vs searching text inside files vs listing a folder, editing a snippet vs writing a file, playing new media vs controlling current playback/volume, and reading online info vs downloading a file to disk. Avoid tools marked [FAILED - AVOID] when an alternative fits.";

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const q = base.questions.selected_tool;
  if (q.type !== "choice") return base;
  return { ...base, questions: { selected_tool: { ...q, instructions: INSTRUCTIONS } } };
}

const tool_choice_v01: Variant = {
  name: "tool_choice_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};
export default tool_choice_v01;
