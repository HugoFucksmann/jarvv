import { DATA_NOTICE_EN, PROMPTS, join, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_tiny_notoday:
 * Mantiene el SYSTEM exitoso de pending_tiny (83.1% - 85.2% pass rate).
 * Remueve la cabecera 'TODAY: ...' del contexto de usuario que no aporta a to-do lists operativas
 * y reduce la distracción temporal para qwen3.5:4b.
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
  // Retorna únicamente el view operativo sin la línea de TODAY
  return data.view.trim();
}

const pending_tiny_notoday: Variant = {
  name: "pending_tiny_notoday",
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

export default pending_tiny_notoday;

