import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending2 con prompt objetivo y concreto: reglas cortas e imperativas, sin explicaciones ni ejemplos.
 * Cada pendiente es un objeto `{kind, goal, done_when}`.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools.
Reply only with JSON: {"pending":[{"kind":"search|read|write|execute|other","goal":"...","done_when":"..."}]}
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Keep the unfinished items of PENDING with the same goal wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
- Keep the user's constraints.
- kind: search (look up information), read (open a file or page), write (create or change something), execute (run a program or command), other.
- goal: in the language of REQUEST. If kind is search: a question. Otherwise: an action saying what to obtain or change. Never commands, tools or code.
- done_when: a statement about the result that can be checked. Not an action. Do not repeat the goal.
- Fields in this order: kind, goal, done_when. No other fields.
Follow USER.
${DATA_NOTICE_EN}`;

const pending2_obj: Variant = {
  name: "pending2_obj",
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
export default pending2_obj;
