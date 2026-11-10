import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. pending_focused_elite con todas las secciones rotuladas (PENDING y USER además de DONE y FAIL). */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
Follow USER.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: { readonly view: string }): string {
  return data.view
    .trim()
    .replace(/^PENDING:\n/m, "### PREVIOUS TO-DO LIST (PENDING):\n")
    .replace(/^DONE:\n/m, "### COMPLETED TASKS (DONE):\n")
    .replace(/^FAIL:\n/m, "### FAILED TASKS (REPLACE IN PENDING):\n")
    .replace(/^USER:\n/m, "### USER INSTRUCTIONS (FOLLOW):\n");
}

const pending_elite_labels: Variant = { name: "pending_elite_labels", prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM, buildUserPrompt } } } };
export default pending_elite_labels;
