import { DATA_NOTICE_EN, PROMPTS, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are JARVIS. Compose the final summary response for the user based strictly on DATA and EFFECTS.
- State findings, values, and answers thoroughly and accurately.
- Clearly report any changes made to the system (EFFECTS) or specify that no changes were made.
- If a task failed or could not be completed, explain the specific obstacle and remaining requirements without technical jargon.
${DATA_NOTICE_EN}`;

const final_summary: Variant = {
  name: "final_summary",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
      },
    },
  },
};

export default final_summary;

