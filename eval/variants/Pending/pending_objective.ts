import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `Maintain the minimal to-do list for REQUEST.
Reply ONLY with JSON: {"pending":["..."]}
Rules:
1. Return {"pending":[]} ONLY if REQUEST is already completely achieved by DONE, or is a pure conversational greeting/question not requiring system actions.
2. Every item is a high-level outcome in the language of REQUEST (what, never how/commands/tools). First item = immediate next action.
3. Keep unfinished goals from PENDING with identical wording; remove completed goals; add necessary missing goals.
4. Replace goals marked failed in FAIL with a viable alternative approach in plain words.
${DATA_NOTICE_EN}`;

const pending_objective: Variant = {
  name: "pending_objective",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_objective;

