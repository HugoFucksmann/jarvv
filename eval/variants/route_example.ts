/**
 * eval/variants/route_example.ts
 *
 * Variante de ejemplo con un prompt ENTERO: el constructor completo de la Decisión 1 (`DECISION_PROMPTS.buildRouteChoice`), escrito
 * en este archivo. No parte del de producción ni lo edita: lo que la variante no nombra (las otras tres decisiones y todas las
 * etapas generativas) usa producción. Este constructor devuelve el mismo `{ state, questions }` que el de producción, con otra
 * `instructions` y sin las aclaraciones por ruta.
 *
 * Cómo escribir una variante propia:
 * - Etapa de decisión: un constructor completo en `prompts.DECISION_PROMPTS` (`buildRouteChoice`, `buildToolChoice`,
 *   `buildArgsReview` o `buildResultVerification`). Devuelve `{ state, questions }`; cada pregunta lleva `type`, `instructions` y,
 *   según el tipo, `criteria` (choice: una opción por clave; noul: opcionalmente `{ true, false }`).
 * - Etapa generativa: una vista completa en `prompts.PROMPTS` (por ejemplo `PENDING_VIEW` con `SYSTEM` y `buildUserPrompt`).
 * - Parámetros (temperatura, tokens, thinking) de una etapa generativa: `params`.
 * - Si cambia el conjunto de preguntas de `args_review` o `result_verification`, `read` dice cómo leer las respuestas. Con las
 *   preguntas de producción (`review`; `ok` y `cumple`, ambas `noul`) no hace falta.
 * Para ver el prompt actual de una etapa: `npm run eval -- --dataset=smoke --ids=smoke-route --dry-run`.
 */

import type { RouteDecisionInput } from "../../src/core/engine/deps.ts";
import { frameLines, lastFailedBy } from "../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../src/core/reasoner/prompts.ts";
import { DESTINATIONS } from "../../src/core/tools/manifest.ts";
import type { Variant } from "../core/variants/types.ts";

/** Aclaración por ruta (texto propio de esta variante). */
const HINTS: Record<string, string> = {
  terminal: "Opening an application belongs here.",
};

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.route);

  const criteria: Record<string, string> = {};
  for (const route of data.routes) {
    const desc = DESTINATIONS[route].description;
    const base = failed.get(route) === true ? `${desc} [the last attempt on this route failed]` : desc;
    criteria[route] = HINTS[route] ? `${base} ${HINTS[route]}` : base;
  }

  return {
    state: frameLines(data).filter(Boolean).join("\n"),
    questions: {
      route: {
        type: "choice",
        instructions: "Pick the route for the next action. Prefer web when the user asks to look something up.",
        criteria,
      },
    },
  };
}

const route_example: Variant = {
  name: "route_example",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};

export default route_example;
