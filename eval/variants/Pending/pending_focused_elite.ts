import { DATA_NOTICE_EN, PROMPTS, join } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_focused_elite:
 * Basada en la ganadora absoluta pending_tiny_focused (+6.5% vs prod, 81.3% en llm_gemai, -36ms latencia).
 * Combina:
 * 1. Resaltado explícito de ### COMPLETED TASKS (DONE): y ### FAILED TASKS (REPLACE IN PENDING):
 * 2. Supresión de TODAY: para eliminar cualquier ruido temporal irrelevante para una to-do list.
 * 3. Reglas pulidas de pending_tiny para asegurar formulación de objetivos limpios sin herramientas.
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
  const raw = data.view.trim();
  const highlighted = raw
    .replace(/^DONE:\n/m, "### COMPLETED TASKS (DONE):\n")
    .replace(/^FAIL:\n/m, "### FAILED TASKS (REPLACE IN PENDING):\n");
  // Retorna directamente el texto estructurado sin TODAY
  return highlighted;
}

const pending_focused_elite: Variant = {
  name: "pending_focused_elite",
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

export default pending_focused_elite;

