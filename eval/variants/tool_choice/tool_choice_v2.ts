/**
 * eval/variants/tool_choice/tool_choice_v2.ts
 *
 * Hipótesis: indicar en `instructions` que se elija la herramienta exacta según la operación pedida y que se eviten las marcadas `[FAILED - AVOID]` mejora los casos de recuperación y desambigua lectura vs búsqueda vs descarga.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const INSTRUCTIONS =
  "Pick the single tool whose action matches the current Step (distinguishing filename search vs content search, edit vs full write, play new media vs playback/volume control, and read page vs save file). Avoid tools marked [FAILED - AVOID].";

function buildToolChoice(data: Parameters<typeof DECISION_PROMPTS.buildToolChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const question = base.questions.selected_tool;
  if (question?.type !== "choice") return base;
  return { ...base, questions: { selected_tool: { ...question, instructions: INSTRUCTIONS } } };
}

const tool_choice_v2: Variant = {
  name: "tool_choice_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_v2;
