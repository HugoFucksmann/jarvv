/**
 * eval/variants/pending/pending_v1.ts
 *
 * Variante dedicada para la etapa `pending` (`PENDING_VIEW`).
 * Mantiene la lista reactiva en lenguaje natural sin jerga de herramientas y evita repetir fallos de `FAIL`.
 */

import type { PreviousTask } from "../../../src/core/contracts.ts";
import { DATA_NOTICE_EN } from "../../../src/core/models/prompts.ts";
import type { PromptSet } from "../../../src/core/models/stageRequests.ts";
import { retitlePending } from "../../../src/core/render/pending.ts";
import { threadBlock } from "../../../src/core/render/thread.ts";
import type { Variant } from "../../core/variants/types.ts";

const PENDING_VIEW: PromptSet["PENDING_VIEW"] = {
  SYSTEM: `Maintain the reactive to-do list for REQUEST as valid JSON ONLY: {"pending":["..."]}
- Return {"pending":[]} ONLY when DONE satisfies EVERY explicit part of REQUEST, OR when REQUEST is pure conversation (greetings, thanks, jokes, general conceptual Q&A) needing no computer or web action.
- Otherwise return >= 1 short plain-language goal items in the language of REQUEST describing WHAT remains (never tool names, code, or commands).
- Keep remaining unfinished items from PENDING, remove items fully completed in DONE, and add any missing sub-goal from REQUEST (resolving references using prior thread context if present). Put the immediate next action first.
- If FAIL shows a failed attempt on an item, replace it with a concrete alternative goal (e.g., search more broadly first, create missing folder, or use another viable approach) rather than repeating the identical failing step.
- Do not invent web lookups unless REQUEST demands external/current data.
Follow USER instructions strictly.
${DATA_NOTICE_EN}`,

  buildUserPrompt(data: { readonly view: string; readonly thread?: PreviousTask }): string {
    const view = retitlePending(data.view);
    return data.thread === undefined ? view : `${threadBlock(data.thread)}\n\n${view}`;
  },
};

const pending_v1: Variant = {
  name: "pending_v1",
  prompts: { PROMPTS: { PENDING_VIEW } },
};

export default pending_v1;
