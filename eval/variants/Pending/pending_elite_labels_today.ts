import { DATA_NOTICE_EN, PROMPTS, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. pending_elite_labels (la mejor de la ronda 1) con la línea TODAY: aísla si quitar la fecha aporta algo. */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":["..."]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
Follow USER.
${DATA_NOTICE_EN}`;

function buildUserPrompt(data: { readonly view: string }): string {
  const view = data.view
    .trim()
    .replace(/^PENDING:\n/m, "### PREVIOUS TO-DO LIST (PENDING):\n")
    .replace(/^DONE:\n/m, "### COMPLETED TASKS (DONE):\n")
    .replace(/^FAIL:\n/m, "### FAILED TASKS (REPLACE IN PENDING):\n")
    .replace(/^USER:\n/m, "### USER INSTRUCTIONS (FOLLOW):\n");
  return `${todayLine()}\n\n${view}`;
}

const pending_elite_labels_today: Variant = { name: "pending_elite_labels_today", prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM, buildUserPrompt } } } };
export default pending_elite_labels_today;
