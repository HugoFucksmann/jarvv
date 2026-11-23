/**
 * eval/variants/route/route_v02.ts
 *
 * Hipótesis: Enfatizar en la instrucción de `route` que se debe priorizar la operación pedida en el paso actual (ignorar pasos futuros ya cumplidos o pendientes) y respetar las rutas explícitas (URL http(s) vs ruta local, comando explícito vs operación de archivo) mejora la precisión en contextos multi-paso y de recuperación.
 */

import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const INSTRUCTIONS =
  "Pick the single best route for the current Step (not already-done or later steps). Follow explicit cues: shell/PowerShell commands go to terminal, http(s) lookup/download goes to web, and opening on screen or PC state/settings goes to system.";

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const question = base.questions.route;
  if (question.type !== "choice") return base;
  return { ...base, questions: { route: { ...question, instructions: INSTRUCTIONS } } };
}

const route_v02: Variant = {
  name: "route_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v02;
