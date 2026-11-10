import { DATA_NOTICE_EN, PROMPTS, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `You are JARVIS. Write a direct, clear final answer to the user in the language of REQUEST.
Give the exact information, result, or status requested.
Do not mention internal IDs (c1, s1), tool details, or technical mechanics unless requested.
If files or data were modified or created, summarize what was done.
${DATA_NOTICE_EN}`;

const final_direct: Variant = {
  name: "final_direct",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
      },
    },
  },
};

export default final_direct;

