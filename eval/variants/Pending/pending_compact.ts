import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `Track remaining tasks for REQUEST as JSON: {"pending":["..."]}
- Output [] if DONE fulfills REQUEST or no tool execution is needed.
- Write each goal as an outcome in user language without commands or tool names.
- Retain exact text of pending items, drop finished ones, set next goal first.
- On failure in FAIL, substitute with an alternative goal.
${DATA_NOTICE_EN}`;

const pending_compact: Variant = {
  name: "pending_compact",
  prompts: { PROMPTS: { PENDING_VIEW: { ...PROMPTS.PENDING_VIEW, SYSTEM } } },
};
export default pending_compact;

