/**
 * scripts/eval-next/core/stages/route.ts
 *
 * Etapa Decisión #1: Selección de ruta (route, fin, ask_user).
 * Usa DECISION_PROMPTS.buildRouteChoice de producción.
 */

import { DECISION_PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import type { RouteDecisionInput } from "../../../../src/core/engine/deps.ts";
import { NotTruncatedGrader, LatencyGrader } from "../graders/common.ts";
import { RouteLabelGrader } from "../graders/label.ts";
import type {
  DecisionModelRequest,
  ParseResult,
  PromptVariant,
  RouteExpect,
  RouteInput,
  RouteOutput,
  StageDefinition,
} from "../types.ts";

export const RouteStage: StageDefinition<RouteInput, RouteOutput, RouteExpect> = {
  name: "route",
  defaultClient: "decision",
  defaultThinking: false,

  build(input: RouteInput, _variant: PromptVariant): DecisionModelRequest {
    const normalized: RouteDecisionInput = {
      request: input.request ?? null,
      step: input.step ?? null,
      lastResult: input.lastResult ?? null,
      done: input.done ?? [],
      attempts: input.attempts ?? [],
      userInput: input.userInput ?? [],
      env: input.env ?? [],
      routes: input.routes ?? [],
      allowFin: input.allowFin ?? true,
      allowAsk: input.allowAsk ?? false,
    };
    const { state, questions } = DECISION_PROMPTS.buildRouteChoice(normalized);
    return {
      type: "decision",
      backend: "d3",
      state,
      questions,
    };
  },

  parse(raw: string): ParseResult<RouteOutput> {
    try {
      const data = typeof raw === "object" && raw !== null ? raw : JSON.parse(raw);
      // Puede venir como { answers: { route: { choice, probabilities } } } o { choice, probabilities }
      const routeAnswer = data.answers?.route || data.route || data;
      const choice = routeAnswer.choice;
      if (!choice || typeof choice !== "string") {
        return { ok: false, error: "Respuesta no contiene un campo 'choice' de ruta válido." };
      }
      let action: "route" | "fin" | "ask_user";
      let route: any = undefined;
      if (choice === "fin") {
        action = "fin";
      } else if (choice === "ask_user") {
        action = "ask_user";
      } else {
        action = "route";
        route = choice;
      }
      return {
        ok: true,
        value: {
          action,
          route,
          probabilities: routeAnswer.probabilities,
        },
      };
    } catch (e: any) {
      return { ok: false, error: `Error parseando respuesta de Decisión #1: ${e.message}` };
    }
  },

  graders: [NotTruncatedGrader, LatencyGrader, RouteLabelGrader],
};

