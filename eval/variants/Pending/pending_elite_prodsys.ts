import { PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Los rótulos de pending_focused_elite sin TODAY, pero con el SYSTEM de producción completo: aísla si la ganancia viene de los rótulos o del SYSTEM corto. */
function buildUserPrompt(data: { readonly view: string }): string {
  return data.view
    .trim()
    .replace(/^DONE:\n/m, "### COMPLETED TASKS (DONE):\n")
    .replace(/^FAIL:\n/m, "### FAILED TASKS (REPLACE IN PENDING):\n");
}

const pending_elite_prodsys: Variant = { name: "pending_elite_prodsys", prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, buildUserPrompt } } } };
export default pending_elite_prodsys;
