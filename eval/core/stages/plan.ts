/**
 * eval/core/stages/plan.ts
 *
 * Etapa generativa `plan`: planificación deliberativa por pasos.
 */

import { BUDGET, clipWithin, MAX_STEPS, NOT_JSON_ERROR, parseJsonObject, parsePlanStepsResult, planInput, planStageRequest } from "../contract.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import { PlanStepsGrader } from "../graders/plan.ts";
import type { GenerativeRequest, PlanExpect, PlanOutput, PlanStep } from "../types.ts";
import { checkIntMin1, checkRoute, checkRouteList, noLabel } from "./shared.ts";
import type { GenerativeStageEntry } from "./types.ts";

/** Lee el `maxItems` del schema **enviado** (si no hay, usa MAX_STEPS). */
function maxItemsFromSchema(req: GenerativeRequest): number {
  const schema = req.schema;
  if (!schema) return MAX_STEPS;
  const steps = (schema as { properties?: { steps?: { maxItems?: unknown } } }).properties?.steps;
  if (typeof steps?.maxItems === "number") return steps.maxItems;
  return MAX_STEPS;
}

export const planStage: GenerativeStageEntry<PlanOutput, PlanExpect> = {
  stageName: "plan",
  requestType: "generative",
  rejectTruncated: true,
  expectSpec: {
    keys: {
      minSteps: "number", maxSteps: "number", allowedRoutes: "string[]", requiredRoutes: "string[]",
      firstRoute: "string", requiredKeywordsInGoal: "string[]", forbiddenKeywordsInGoal: "string[]",
      forbiddenRepeatedGoals: "string[]", forbiddenExecutedEffects: "string[]", mustReflectFeedback: "string[]",
    },
    atLeastOne: [
      "minSteps", "maxSteps", "allowedRoutes", "requiredRoutes", "firstRoute", "requiredKeywordsInGoal",
      "forbiddenKeywordsInGoal", "forbiddenRepeatedGoals", "forbiddenExecutedEffects", "mustReflectFeedback",
    ],
    validate(expectObj, errs) {
      checkRoute("firstRoute", expectObj.firstRoute, errs);
      checkRouteList("allowedRoutes", expectObj.allowedRoutes, errs);
      checkRouteList("requiredRoutes", expectObj.requiredRoutes, errs);
      checkIntMin1(expectObj, ["minSteps", "maxSteps"], errs);
      if (
        typeof expectObj.minSteps === "number" && typeof expectObj.maxSteps === "number" &&
        expectObj.minSteps > expectObj.maxSteps
      ) {
        errs.push(`expect.minSteps (${expectObj.minSteps}) no puede ser mayor que expect.maxSteps (${expectObj.maxSteps}).`);
      }
    },
  },
  graders: [LatencyGrader, NotTruncatedGrader, PlanStepsGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    // Como el motor (`generatePlan`): el feedback del usuario se recorta a `BUDGET.feedbackMax`.
    const feedback = at.feedback === undefined ? null : clipWithin(at.feedback, BUDGET.feedbackMax);
    return {
      request: h.generative(planStageRequest(planInput(ctx, feedback), h.config(), h.effectivePrompts(ov).P), "plan"),
    };
  },
  parseOutput(rawOutput: string, sentReq: GenerativeRequest): PlanOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);

    // Mismo orden y textos que `generatePlanFromView`: primero cada paso (y el tope `BUDGET.maxSteps`), luego el tope del input.
    const result = parsePlanStepsResult(obj.steps, 1, false);
    if ("error" in result) throw new Error(result.error);
    const parsed = result.steps;
    const maxItems = maxItemsFromSchema(sentReq);
    if (parsed.length > maxItems) throw new Error(`máximo ${maxItems} pasos; se recibieron ${parsed.length}`);

    const steps: PlanStep[] = parsed.map((s) => ({
      goal: s.instruction,
      suggested_mcp: s.route,
      expected_outcome: s.expectedOutcome,
    }));
    return { steps };
  },
  label: noLabel,
  oracleOutput(prepared, _ctx, expect, h) {
    const minSteps = h.num(expect.minSteps) ?? 1;
    const maxSteps = h.num(expect.maxSteps) ?? Infinity;
    const allowed = h.strs(expect.allowedRoutes);
    const required = h.strs(expect.requiredRoutes);
    const first = typeof expect.firstRoute === "string" ? expect.firstRoute : undefined;

    const routes: string[] = [];
    if (first) routes.push(first);
    for (const r of required) if (!routes.includes(r)) routes.push(r);
    if (routes.length === 0) routes.push(allowed[0] ?? h.mockPlanRoute(prepared));

    const count = Math.min(maxSteps, Math.max(minSteps, routes.length, 1));
    const words = h.firstAlt([...h.strs(expect.requiredKeywordsInGoal), ...h.strs(expect.mustReflectFeedback)]);

    const steps = Array.from({ length: count }, (_, i) => ({
      goal: i === 0 ? ["Plan step", ...words].join(" ") : `Plan step ${i + 1}`,
      suggested_mcp: routes[Math.min(i, routes.length - 1)],
      expected_outcome: "Step completed",
    }));
    return JSON.stringify({ steps });
  },
};
