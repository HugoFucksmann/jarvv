/**
 * eval/variants/plan/plan_v1.ts
 *
 * Variante dedicada para la etapa `plan` (`PLAN_VIEW`).
 * Refuerza respeto estricto de `TRIGGER`, `EFFECTS` ya aplicados, `FAILURES` y rutas válidas (`ROUTE_LIST`).
 */

import { DATA_NOTICE_EN, ROUTE_LIST, join, todayLine } from "../../../src/core/models/prompts.ts";
import type { PromptSet } from "../../../src/core/models/stageRequests.ts";
import type { Variant } from "../../core/variants/types.ts";

const PLAN_VIEW: PromptSet["PLAN_VIEW"] = {
  SYSTEM: `Think briefly and output ONLY valid JSON: {"steps":[{"goal":"...","suggested_mcp":"...","expected_outcome":"..."}]}
You are JARVIS's deliberative planner. Decompose REQUEST into 1..MAX_STEPS minimal, executable ordered steps (never return an empty array).
- goal: one concrete action in the language of REQUEST, keeping exact quantities, file paths, formats, and constraints.
- suggested_mcp: MUST be one of ${ROUTE_LIST} (route name only, never a tool name or URL).
- expected_outcome: measurable state produced by the step.
- For output formats without a dedicated write tool (e.g., .xlsx, QR images), plan a terminal script step.

Mandatory trigger rules:
- TRIGGER=initial: produce the minimal end-to-end plan for REQUEST.
- TRIGGER=user_feedback: strictly apply ALL instructions in FEEDBACK and PREVIOUS FEEDBACK to replace CURRENT and NEXT.
- TRIGGER=step_failure: CURRENT failed (see FAILURES). NEVER repeat the failed goal or failing method—pick a valid prerequisite (e.g., search/list first) or alternate route.
- NEVER repeat STEPS DONE or EFFECTS already applied. Account for POSSIBLE EFFECTS if an interrupted write may already exist on disk.
${DATA_NOTICE_EN}`,

  buildUserPrompt(data: { readonly view: string; readonly maxSteps: number; readonly catalog?: string }): string {
    return join([
      data.catalog ? `CATALOG OF CAPABILITIES:\n${data.catalog}` : null,
      todayLine(),
      `MAX_STEPS: ${data.maxSteps}`,
      data.view,
    ]);
  },
};

const plan_v1: Variant = {
  name: "plan_v1",
  prompts: { PROMPTS: { PLAN_VIEW } },
};

export default plan_v1;
