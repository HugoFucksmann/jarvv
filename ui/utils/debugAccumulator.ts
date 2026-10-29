/**
 * Vistas de la UI sobre las iteraciones de modelo (agrupación por paso). Consumido por DecisionStream e inspectores.
 *
 * Las iteraciones las construye `src/core/modelIterations.ts` (el mismo módulo que usa el servidor, para que ambos
 * lados describan igual cada intercambio) y viajan en `task.modelIterations` (`/state`) o se derivan de cada evento
 * SSE con `createIterationFromEvent`. La UI no reconstruye iteraciones por su cuenta.
 */

import type { Task } from "../../src/core/types.ts";
import type { ModelIteration } from "../../src/core/types.ts";
import { FIN_DECISION_TITLE } from "../../src/core/modelIterations.ts";
import type { StepIterationGroupData } from "../types/debug.ts";

export { createIterationFromEvent } from "../../src/core/modelIterations.ts";

/**
 * Groups a flat array of ModelIteration items into hierarchically organized StepIterationGroups.
 */
export function groupIterationsByStep(
  iterations: ModelIteration[],
  task: Pick<Task, "steps"> | null
): StepIterationGroupData[] {
  const groupsMap = new Map<string, StepIterationGroupData>();

  if (task?.steps) {
    task.steps.forEach((step, idx) => {
      groupsMap.set(step.id, {
        stepId: step.id,
        stepSeq: idx + 1,
        stepTitle: `Paso #${idx + 1}: ${step.instruction}`,
        route: step.route,
        tool: step.tool,
        state: step.state,
        iterations: [],
      });
    });
  }

  for (const iter of iterations) {
    let key = iter.stepId || "global";
    if (key === "plan_global") {
      key = "planning";
    }

    if (!groupsMap.has(key)) {
      let title = iter.stepTitle || "Iteraciones del Sistema";
      if (key === "planning") {
        title = "Planificación Global";
      } else if (key === "final_response") {
        title = "Respuesta Final y Cierre";
      } else if (key === "routing_fin") {
        title = FIN_DECISION_TITLE;
      } else if (iter.stepSeq) {
        title = `Paso #${iter.stepSeq}: ${iter.stepTitle || ""}`;
      }

      groupsMap.set(key, {
        stepId: key,
        stepSeq: iter.stepSeq,
        stepTitle: title,
        iterations: [],
      });
    }

    const grp = groupsMap.get(key)!;
    if (!grp.iterations.some((existing) => existing.id === iter.id)) {
      grp.iterations.push(iter);
    }
  }

  const result = Array.from(groupsMap.values()).filter((g) => g.iterations.length > 0);

  result.sort((a, b) => {
    if (a.stepId === "planning") return -1;
    if (b.stepId === "planning") return 1;
    if (a.stepId === "final_response") return 1;
    if (b.stepId === "final_response") return -1;
    if (a.stepId === "routing_fin") return 1;
    if (b.stepId === "routing_fin") return -1;
    if (a.stepSeq !== undefined && b.stepSeq !== undefined) {
      return a.stepSeq - b.stepSeq;
    }
    const aMinTime = Math.min(...a.iterations.map((i) => i.timestamp));
    const bMinTime = Math.min(...b.iterations.map((i) => i.timestamp));
    return aMinTime - bMinTime;
  });

  return result;
}