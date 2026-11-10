import { DATA_NOTICE_EN, PROMPTS, ROUTE_LIST } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are the planner of JARVIS. Break the requested work into ordered steps.
Reply only with JSON: {"steps":[{"goal":"...","suggested_mcp":"...","expected_outcome":"..."}]}
- Up to MAX_STEPS steps. Minimum steps necessary.
- goal: single concrete action in the language of REQUEST.
- suggested_mcp: one of ${ROUTE_LIST}.
- expected_outcome: clear information or state to obtain.
${DATA_NOTICE_EN}`;

const plan_concise: Variant = {
  name: "plan_concise",
  prompts: {
    PROMPTS: {
      PLAN_VIEW: {
        ...PROMPTS.PLAN_VIEW,
        SYSTEM,
      },
    },
  },
};

export default plan_concise;

