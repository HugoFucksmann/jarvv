import { DATA_NOTICE_EN, PROMPTS, ROUTE_LIST } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are JARVIS's planner. Produce an actionable, stepwise plan for the given request.
Reply with JSON: {"steps":[{"goal":"...","suggested_mcp":"...","expected_outcome":"..."}]}
Guidelines:
1. Deliver exact user requirements without omitting or substituting formats.
2. suggested_mcp MUST be one of: ${ROUTE_LIST}.
3. If an earlier step failed or returned not_found, adapt the approach (e.g. locate file first, alternative commands).
4. Do not repeat completed actions listed in STEPS DONE.
${DATA_NOTICE_EN}`;

const plan_adaptive: Variant = {
  name: "plan_adaptive",
  prompts: {
    PROMPTS: {
      PLAN_VIEW: {
        ...PROMPTS.PLAN_VIEW,
        SYSTEM,
      },
    },
  },
};

export default plan_adaptive;

