/**
 * eval/core/stages/decision.ts
 *
 * Entradas del registro para las etapas de decisión
 * (route, tool_choice, args_review, result_verification).
 * Secciones 3 y 7.6.
 */

import { LatencyGrader } from "../graders/common.ts";
import {
  ArgsReviewLabelGrader,
  ResultVerificationGrader,
  RouteLabelGrader,
  ToolChoiceLabelGrader,
} from "../graders/label.ts";
import type {
  ArgsReviewExpect,
  ArgsReviewOutput,
  DecisionRequest,
  ResultVerificationExpect,
  ResultVerificationOutput,
  RouteExpect,
  RouteOutput,
  ToolChoiceExpect,
  ToolChoiceOutput,
} from "../types.ts";
import {
  parseArgsReviewDecision,
  parseResultVerificationDecision,
  parseRouteDecision,
  parseToolChoiceDecision,
} from "../variants/labels.ts";
import type { DecisionStageVariant } from "../variants/types.ts";
import type { DecisionStageEntry, LabelInfo } from "./index.ts";

// ───────────────────────── route ─────────────────────────

export const routeStage: DecisionStageEntry<RouteOutput, RouteExpect> = {
  stageName: "route",
  requestType: "decision",
  graders: [LatencyGrader, RouteLabelGrader],
  parseOutput(
    rawOutput: string,
    sentReq: DecisionRequest,
    sv: DecisionStageVariant | undefined,
  ): RouteOutput {
    return parseRouteDecision(rawOutput, sentReq, sv);
  },
  label(output: RouteOutput | undefined, expect: RouteExpect | undefined): LabelInfo {
    const predicted = output
      ? output.action === "route"
        ? (output.route ?? output.action)
        : output.action
      : null;
    // Sin `expectedRoute` vale cualquier ruta: no hay etiqueta contra la cual medir accuracy (el grader sí evalúa la acción).
    // Antes la etiqueta era "route", que nunca coincide con una predicción como "files": error de accuracy en un caso que pasa.
    const expected = expect
      ? expect.expectedAction === "route"
        ? (expect.expectedRoute ?? null)
        : expect.expectedAction
      : null;
    const rawScore = output?.probabilities
      ? (predicted !== null ? (output.probabilities[predicted] ?? null) : null)
      : null;
    return {
      predicted,
      expected,
      rawScore,
      probabilities: output?.probabilities ?? null,
    };
  },
};

// ───────────────────────── tool_choice ─────────────────────────

export const toolChoiceStage: DecisionStageEntry<ToolChoiceOutput, ToolChoiceExpect> = {
  stageName: "tool_choice",
  requestType: "decision",
  graders: [LatencyGrader, ToolChoiceLabelGrader],
  parseOutput(
    rawOutput: string,
    sentReq: DecisionRequest,
    sv: DecisionStageVariant | undefined,
  ): ToolChoiceOutput {
    return parseToolChoiceDecision(rawOutput, sentReq, sv);
  },
  label(output: ToolChoiceOutput | undefined, expect: ToolChoiceExpect | undefined): LabelInfo {
    const predicted = output?.selected ?? null;
    const expected =
      expect?.expectedTool ?? (expect?.expectedAction === "ask_user" ? "ask_user" : null);
    const rawScore =
      output?.probabilities && predicted !== null
        ? (output.probabilities[predicted] ?? null)
        : null;
    return {
      predicted,
      expected,
      rawScore,
      probabilities: output?.probabilities ?? null,
    };
  },
};

// ───────────────────────── args_review ─────────────────────────

export const argsReviewStage: DecisionStageEntry<ArgsReviewOutput, ArgsReviewExpect> = {
  stageName: "args_review",
  requestType: "decision",
  graders: [LatencyGrader, ArgsReviewLabelGrader],
  parseOutput(
    rawOutput: string,
    sentReq: DecisionRequest,
    sv: DecisionStageVariant | undefined,
  ): ArgsReviewOutput {
    return parseArgsReviewDecision(rawOutput, sentReq, sv);
  },
  label(output: ArgsReviewOutput | undefined, expect: ArgsReviewExpect | undefined): LabelInfo {
    const predicted = output?.review ?? null;
    const expected = expect?.expectedReview ?? null;
    const rawScore =
      output?.probabilities && predicted !== null
        ? (output.probabilities[predicted] ?? null)
        : null;
    return {
      predicted,
      expected,
      rawScore,
      probabilities: output?.probabilities ?? null,
    };
  },
};

// ───────────────────────── result_verification ─────────────────────────

export const resultVerificationStage: DecisionStageEntry<
  ResultVerificationOutput,
  ResultVerificationExpect
> = {
  stageName: "result_verification",
  requestType: "decision",
  graders: [LatencyGrader, ResultVerificationGrader],
  parseOutput(
    rawOutput: string,
    sentReq: DecisionRequest,
    sv: DecisionStageVariant | undefined,
  ): ResultVerificationOutput {
    return parseResultVerificationDecision(rawOutput, sentReq, sv);
  },
  label(
    output: ResultVerificationOutput | undefined,
    expect: ResultVerificationExpect | undefined,
  ): LabelInfo {
    const predicted = output ? `ok=${output.ok},cumple=${output.cumple}` : null;
    const expected = expect
      ? `ok=${expect.expectedOk},cumple=${expect.expectedCumple}`
      : null;
    return {
      predicted,
      expected,
      rawScore: output?.okProbability ?? null,
      probabilities: output
        ? { ok: output.okProbability, cumple: output.cumpleProbability }
        : null,
    };
  },
};
