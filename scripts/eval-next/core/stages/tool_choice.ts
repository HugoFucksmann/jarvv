/**
 * scripts/eval-next/core/stages/tool_choice.ts
 *
 * Etapa Decisión #2: Selección de herramienta candidata o ask_user.
 * Usa DECISION_PROMPTS.buildToolChoice de producción.
 */

import { DECISION_PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import type { ToolDecisionInput } from "../../../../src/core/engine/deps.ts";
import { NotTruncatedGrader, LatencyGrader } from "../graders/common.ts";
import { ToolChoiceLabelGrader } from "../graders/label.ts";
import type {
  DecisionModelRequest,
  ParseResult,
  PromptVariant,
  StageDefinition,
  ToolChoiceExpect,
  ToolChoiceInput,
  ToolChoiceOutput,
} from "../types.ts";

export const ToolChoiceStage: StageDefinition<ToolChoiceInput, ToolChoiceOutput, ToolChoiceExpect> = {
  name: "tool_choice",
  defaultClient: "decision",
  defaultThinking: false,

  build(input: ToolChoiceInput, _variant: PromptVariant): DecisionModelRequest {
    const step = input.step ?? ((input as any).instruction ? { instruction: (input as any).instruction, expected: (input as any).expected ?? null } : null);
    const normalized: ToolDecisionInput = {
      request: input.request ?? null,
      step,
      lastResult: input.lastResult ?? null,
      done: input.done ?? [],
      attempts: input.attempts ?? [],
      userInput: input.userInput ?? [],
      env: input.env ?? [],
      route: input.route ?? "files",
      tools: input.tools ?? [],
      allowAsk: input.allowAsk ?? false,
    };
    const { state, questions } = DECISION_PROMPTS.buildToolChoice(normalized);
    return {
      type: "decision",
      backend: "d3",
      state,
      questions,
    };
  },

  parse(raw: string): ParseResult<ToolChoiceOutput> {
    try {
      const data = typeof raw === "object" && raw !== null ? raw : JSON.parse(raw);
      const answer = data.answers?.selected_tool || data.selected_tool || data;
      const choice = answer.choice;
      if (!choice || typeof choice !== "string") {
        return { ok: false, error: "Respuesta no contiene un campo 'choice' de herramienta válido." };
      }
      return {
        ok: true,
        value: {
          selected: choice,
          probabilities: answer.probabilities,
        },
      };
    } catch (e: any) {
      return { ok: false, error: `Error parseando respuesta de Decisión #2: ${e.message}` };
    }
  },

  graders: [NotTruncatedGrader, LatencyGrader, ToolChoiceLabelGrader],
};

