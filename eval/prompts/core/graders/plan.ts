/**
 * eval/prompts/core/graders/plan.ts
 *
 * Graders para la etapa PLAN. Sin `expectEmpty`/`allowEmpty`: un plan vacío siempre es salida inválida.
 */

import type { Grader, PlanExpect, PlanOutput } from "../types.ts";
import { containsTerm } from "./common.ts";

// Coincidencia por palabra/frase completa: "rm" ya no salta con "confirmar".
function findMissing(text: string, needles: string[]): string[] {
  return needles.filter((n) => !containsTerm(text, n));
}

function findPresent(text: string, needles: string[]): string[] {
  return needles.filter((n) => containsTerm(text, n));
}

export const PlanStepsGrader: Grader<PlanOutput, PlanExpect> = {
  name: "plan_steps",
  grade(output, expect, _ctx, col) {
    if (!output || !Array.isArray(output.steps)) {
      col.check("valid_plan_structure", false, "Salida no contiene un array 'steps' válido.");
      return;
    }

    const steps = output.steps;
    col.measure("steps_count", steps.length);

    if (expect.minSteps !== undefined) {
      col.check(
        "min_steps_met",
        steps.length >= expect.minSteps,
        `Pasos generados (${steps.length}) menor al mínimo esperado (${expect.minSteps}).`,
      );
    }

    if (expect.maxSteps !== undefined) {
      col.check(
        "max_steps_met",
        steps.length <= expect.maxSteps,
        `Pasos generados (${steps.length}) supera el máximo esperado (${expect.maxSteps}).`,
      );
    }

    const allowedRoutes = expect.allowedRoutes;
    if (allowedRoutes && allowedRoutes.length > 0) {
      const invalid = steps.filter((s) => !allowedRoutes.includes(s.suggested_mcp));
      col.check(
        "routes_allowed",
        invalid.length === 0,
        `Rutas no permitidas usadas: ${invalid.map((s) => s.suggested_mcp).join(", ")}`,
      );
    }

    if (expect.firstRoute && steps.length > 0) {
      col.check(
        "first_route_match",
        steps[0].suggested_mcp === expect.firstRoute,
        `Primer paso usa '${steps[0].suggested_mcp}' en vez de '${expect.firstRoute}'.`,
      );
    }

    if (expect.requiredRoutes && expect.requiredRoutes.length > 0) {
      const used = new Set(steps.map((s) => s.suggested_mcp));
      const missing = expect.requiredRoutes.filter((r) => !used.has(r));
      col.check(
        "required_routes_used",
        missing.length === 0,
        `Rutas requeridas faltantes: ${missing.join(", ")}`,
      );
    }

    const allGoalsText = steps.map((s) => s.goal).join(" ");

    if (expect.requiredKeywordsInGoal && expect.requiredKeywordsInGoal.length > 0) {
      const missing = findMissing(allGoalsText, expect.requiredKeywordsInGoal);
      col.check(
        "required_keywords_met",
        missing.length === 0,
        `Palabras clave requeridas ausentes en goals: ${missing.join(", ")}`,
      );
    }

    if (expect.forbiddenKeywordsInGoal && expect.forbiddenKeywordsInGoal.length > 0) {
      const found = findPresent(allGoalsText, expect.forbiddenKeywordsInGoal);
      col.check(
        "no_forbidden_keywords",
        found.length === 0,
        `Palabras prohibidas encontradas en goals: ${found.join(", ")}`,
      );
    }

    if (expect.forbiddenRepeatedGoals && expect.forbiddenRepeatedGoals.length > 0) {
      const found = findPresent(allGoalsText, expect.forbiddenRepeatedGoals);
      col.check(
        "no_repeated_failed_goals",
        found.length === 0,
        `Replan repite metas fallidas previas: ${found.join(", ")}`,
      );
    }

    if (expect.forbiddenExecutedEffects && expect.forbiddenExecutedEffects.length > 0) {
      const found = findPresent(allGoalsText, expect.forbiddenExecutedEffects);
      col.check(
        "no_repeated_executed_effects",
        found.length === 0,
        `Replan repite efectos o mutaciones ya ejecutadas: ${found.join(", ")}`,
      );
    }

    if (expect.mustReflectFeedback && expect.mustReflectFeedback.length > 0) {
      const missing = findMissing(allGoalsText, expect.mustReflectFeedback);
      col.check(
        "must_reflect_feedback",
        missing.length === 0,
        `Replan no refleja el feedback del usuario en sus metas. Faltan: ${missing.join(", ")}`,
      );
    }
  },
};
