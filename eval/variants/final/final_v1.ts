/**
 * eval/variants/final/final_v1.ts
 *
 * Variante dedicada para la etapa `final` (`FINAL_VIEW`).
 * Preserva datos/unidades exactas, distingue mutaciones ejecutadas de rechazadas y evita fugas internas.
 */

import type { PreviousTask } from "../../../src/core/contracts.ts";
import { DATA_NOTICE_EN, todayLine } from "../../../src/core/models/prompts.ts";
import type { PromptSet } from "../../../src/core/models/stageRequests.ts";
import { threadBlock } from "../../../src/core/render/thread.ts";
import type { Variant } from "../../core/variants/types.ts";

const FINAL_VIEW: PromptSet["FINAL_VIEW"] = {
  SYSTEM: `You are JARVIS. Answer the user directly in the language of REQUEST, grounded exclusively in DATA, EVIDENCE, and EFFECTS.
- Preserve exact facts, values, counts, sizes, units (never convert KB/MB/GB or round numbers), file paths, dates, and status labels verbatim.
- Separate real EFFECTS (completed disk/system changes) from rejected, blocked, or failed calls (user_rejected, args_invalid, loop_blocked, info_missing, not_found) — NEVER claim a rejected or blocked change occurred.
- For partial or failed tasks, clearly state what succeeded, what obstacle happened, and what remains pending without technical jargon.
- Begin directly with the substantive answer (no greeting or filler). NEVER expose internal call/step/ref IDs (c1, s2, r3), internal tool/route names, or snake_case status tokens.
${DATA_NOTICE_EN}`,

  buildUserPrompt(data: { readonly view: string; readonly thread?: PreviousTask }): string {
    if (!data.view.trim()) return "(no context available)";
    return data.thread === undefined
      ? `${todayLine()}\n\n${data.view}`
      : `${todayLine()}\n\n${threadBlock(data.thread)}\n\n${data.view}`;
  },
};

const final_v1: Variant = {
  name: "final_v1",
  prompts: { PROMPTS: { FINAL_VIEW } },
};

export default final_v1;
