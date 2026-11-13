import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Cada pendiente es un objeto `{kind, goal, done_when}` en lugar de un texto. Mantiene las reglas de prod y suma las de `kind`, `goal` y `done_when`.
 * La entrada (PENDING) sigue siendo texto: el eval compara los `goal` con los pendientes previos.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":[{"kind":"search|read|write|execute|other","goal":"...","done_when":"..."}]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Each item is one goal in the language of REQUEST: what to obtain or change, never how (no commands, tools or code). Keep the user's constraints.
- Keep the unfinished items of PENDING with the same wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
- kind: search, read, write, execute or other. It is a hint, not an order.
- goal: if kind is search, a question in the language of REQUEST. Otherwise an action: what to obtain or change, never how (no commands, tools or code).
- done_when: a verifiable condition on the result, not an action. Describe the shape of the answer; do not repeat the question.
- Write the fields in this order: kind, goal, done_when. No other fields.
Follow USER.
${DATA_NOTICE_EN}`;

const pending2: Variant = {
  name: "pending2",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
  params: {
    pending: {
      schema: {
        type: "object",
        properties: {
          pending: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["search", "read", "write", "execute", "other"] },
                goal: { type: "string" },
                done_when: { type: "string" },
              },
              required: ["kind", "goal", "done_when"],
              additionalProperties: false,
            },
          },
        },
        required: ["pending"],
        additionalProperties: false,
      },
    },
  },
};
export default pending2;
