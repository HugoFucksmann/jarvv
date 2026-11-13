import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending2 con prompt conciso que explica el propósito de cada campo (quién lo lee y para qué), sin ejemplos
 * para que el modelo no los copie. Cada pendiente es un objeto `{kind, goal, done_when}`.
 */
const SYSTEM = `You keep the to-do list for REQUEST, for JARVIS, an agent that works on the user's computer through tools. Each item is one goal plus the check that confirms it was reached.
Reply only with JSON: {"pending":[{"kind":"search|read|write|execute|other","goal":"...","done_when":"..."}]}

List:
- Empty list only if DONE already accomplishes REQUEST, or REQUEST is a greeting or a question you can answer without using the computer. Otherwise at least one item.
- Keep the unfinished items of PENDING with the same goal wording, drop those DONE accomplished, add what is missing. First item = next action.
- An item that FAIL shows as failed: replace it with a new goal in plain words (not found: find it first; approach failed: same result another way).
- Keep the user's constraints.

Item fields, always in this order and with no other fields:
- kind: the type of work. search = look up information; read = open a file or page; write = create or change something; execute = run a program or command; other = anything else. It is a hint, not an order. Decide it first.
- goal: what to obtain or change, in the language of REQUEST, never how (no commands, tools or code). JARVIS works from this text alone, so it must be understandable by itself. If kind is search, write it as a question; otherwise as an action.
- done_when: how to tell the result is correct. A verifier will read it next to the tool result and nothing else, so write a statement that can be checked from the result alone, describing its form (a number with its unit, a file that exists and contains X, a list of names). Not an action, and not a repetition of the goal.
Follow USER.
${DATA_NOTICE_EN}`;

const pending2_exp: Variant = {
  name: "pending2_exp",
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
export default pending2_exp;
