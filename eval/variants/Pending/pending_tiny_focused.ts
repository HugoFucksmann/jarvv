import { DATA_NOTICE_EN, PROMPTS, join, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_tiny_focused:
 * Combina las 4 reglas directas de pending_tiny.
 * En el contexto del usuario resalta visualmente las secciones DONE y FAIL mediante marcadores claros
 * para que el modelo identifique instantáneamente el estado del avance y los fallos.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
Follow USER.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: { readonly view: string }): string {
  // Enfatiza las secciones críticas para la actualización de tareas
  const raw = data.view.trim();
  const highlighted = raw
    .replace(/^DONE:\n/m, "### COMPLETED TASKS (DONE):\n")
    .replace(/^FAIL:\n/m, "### FAILED TASKS (REPLACE IN PENDING):\n");
  return join([todayLine(), highlighted]);
}

const pending_tiny_focused: Variant = {
  name: "pending_tiny_focused",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        ...PROMPTS.PENDING_VIEW,
        SYSTEM,
        buildUserPrompt,
      },
    },
  },
};

export default pending_tiny_focused;

