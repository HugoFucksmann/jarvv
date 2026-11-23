/**
 * eval/variants/route/route_v2.ts
 *
 * Hipótesis: enfocar `instructions` en lo que el paso actual pide hacer ahora (y si la ruta anterior falló, evitar repetirla sin motivo) mejora la elección de ruta en pasos intermedios y de recuperación.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const INSTRUCTIONS =
  "Pick the single route for the current Step only (not later steps). Follow explicit cues (terminal/PowerShell, local file path, web URL, media playback, or PC setting/state). Avoid routes marked as failed unless retrying the same domain.";

function buildRouteChoice(data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const question = base.questions.route;
  if (question?.type !== "choice") return base;
  return { ...base, questions: { route: { ...question, instructions: INSTRUCTIONS } } };
}

const route_v2: Variant = {
  name: "route_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_v2;
