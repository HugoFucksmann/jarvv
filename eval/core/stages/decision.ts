/**
 * eval/core/stages/decision.ts
 *
 * Entradas del registro para las etapas de decisión
 * (route, tool_choice, args_review, result_verification, fragment_judge).
 * Secciones 3 y 7.6.
 */

import { LatencyGrader } from "../graders/common.ts";
import {
  ArgsReviewLabelGrader,
  CompletionLabelGrader,
  ContinuationLabelGrader,
  FragmentJudgeGrader,
  ProbeLabelGrader,
  ResultVerificationGrader,
  D0LabelGrader,
  RouteLabelGrader,
  ToolChoiceLabelGrader,
} from "../graders/label.ts";
import type {
  ArgsReviewExpect,
  ArgsReviewOutput,
  CompletionExpect,
  CompletionOutput,
  ContinuationExpect,
  ContinuationOutput,
  DecisionRequest,
  FragmentJudgeExpect,
  FragmentJudgeOutput,
  ProbeExpect,
  ProbeOutput,
  ResultVerificationExpect,
  ResultVerificationOutput,
  D0Expect,
  D0Output,
  RouteExpect,
  RouteOutput,
  ToolChoiceExpect,
  ToolChoiceOutput,
} from "../types.ts";
import {
  parseArgsReviewDecision,
  parseCompletionDecision,
  parseContinuationDecision,
  parseFragmentJudgeDecision,
  parseProbeDecision,
  parseResultVerificationDecision,
  parseD0Decision,
  parseRouteDecision,
  parseToolChoiceDecision,
} from "../variants/labels.ts";
import type { DecisionStageEntry, LabelInfo } from "./index.ts";

// ───────────────────────── d0 ─────────────────────────

export const d0Stage: DecisionStageEntry<D0Output, D0Expect> = {
  stageName: "d0",
  requestType: "decision",
  graders: [LatencyGrader, D0LabelGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): D0Output {
    return parseD0Decision(rawOutput, sentReq);
  },
  label(output: D0Output | undefined, expect: D0Expect | undefined): LabelInfo {
    const predicted = output?.kind ?? null;
    return {
      predicted,
      expected: expect?.expectedKind ?? null,
      rawScore: output ? (output.probabilities.chat ?? null) : null,
      probabilities: output?.probabilities ?? null,
    };
  },
};

// ───────────────────────── route ─────────────────────────

export const routeStage: DecisionStageEntry<RouteOutput, RouteExpect> = {
  stageName: "route",
  requestType: "decision",
  graders: [LatencyGrader, RouteLabelGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): RouteOutput {
    return parseRouteDecision(rawOutput, sentReq);
  },
  label(output: RouteOutput | undefined, expect: RouteExpect | undefined): LabelInfo {
    const predicted = output?.route ?? null;
    const expected = expect?.expectedRoute ?? null;
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
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ToolChoiceOutput {
    return parseToolChoiceDecision(rawOutput, sentReq);
  },
  label(output: ToolChoiceOutput | undefined, expect: ToolChoiceExpect | undefined): LabelInfo {
    const predicted = output?.selected ?? null;
    const expected = expect?.expectedTool ?? null;
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
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ArgsReviewOutput {
    return parseArgsReviewDecision(rawOutput, sentReq);
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
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ResultVerificationOutput {
    return parseResultVerificationDecision(rawOutput, sentReq);
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

// ───────────────────────── fragment_judge ─────────────────────────

/** Etiqueta del juez de fragmentos: un `true`/`false` por fragmento (`f0=true,f1=false`). */
const judgeLabel = (flags: readonly boolean[]): string => flags.map((v, i) => `f${i}=${v}`).join(",");

export const fragmentJudgeStage: DecisionStageEntry<FragmentJudgeOutput, FragmentJudgeExpect> = {
  stageName: "fragment_judge",
  requestType: "decision",
  graders: [LatencyGrader, FragmentJudgeGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): FragmentJudgeOutput {
    return parseFragmentJudgeDecision(rawOutput, sentReq);
  },
  label(output: FragmentJudgeOutput | undefined, expect: FragmentJudgeExpect | undefined): LabelInfo {
    return {
      predicted: output ? judgeLabel(output.relevant) : null,
      expected: expect ? judgeLabel(expect.expectedRelevant) : null,
      rawScore: output?.probabilities[0] ?? null,
      probabilities: output ? Object.fromEntries(output.probabilities.map((p, i) => [`f${i}`, p])) : null,
    };
  },
};

// ───────────────────────── probe ─────────────────────────

export const probeStage: DecisionStageEntry<ProbeOutput, ProbeExpect> = {
  stageName: "probe",
  requestType: "decision",
  graders: [LatencyGrader, ProbeLabelGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ProbeOutput {
    return parseProbeDecision(rawOutput, sentReq);
  },
  label(output: ProbeOutput | undefined, expect: ProbeExpect | undefined): LabelInfo {
    const p = output?.probability;
    return {
      predicted: output ? (output.yes ? "yes" : "no") : null,
      expected: expect ? (expect.expectedYes ? "yes" : "no") : null,
      rawScore: p ?? null,
      probabilities: p !== undefined ? { yes: p, no: 1 - p } : null,
    };
  },
};

// ───────────────────────── continuation ─────────────────────────

export const continuationStage: DecisionStageEntry<ContinuationOutput, ContinuationExpect> = {
  stageName: "continuation",
  requestType: "decision",
  graders: [LatencyGrader, ContinuationLabelGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ContinuationOutput {
    return parseContinuationDecision(rawOutput, sentReq);
  },
  label(output: ContinuationOutput | undefined, expect: ContinuationExpect | undefined): LabelInfo {
    const p = output?.probability;
    return {
      predicted: output ? (output.follows ? "yes" : "no") : null,
      expected: expect ? (expect.expectedFollows ? "yes" : "no") : null,
      rawScore: p ?? null,
      probabilities: p !== undefined ? { yes: p, no: 1 - p } : null,
    };
  },
};

// ───────────────────────── completion ─────────────────────────

export const completionStage: DecisionStageEntry<CompletionOutput, CompletionExpect> = {
  stageName: "completion",
  requestType: "decision",
  graders: [LatencyGrader, CompletionLabelGrader],
  parseOutput(rawOutput: string, sentReq: DecisionRequest): CompletionOutput {
    return parseCompletionDecision(rawOutput, sentReq);
  },
  label(output: CompletionOutput | undefined, expect: CompletionExpect | undefined): LabelInfo {
    const p = output?.probability;
    return {
      predicted: output ? (output.complete ? "yes" : "no") : null,
      expected: expect ? (expect.expectedComplete ? "yes" : "no") : null,
      rawScore: p ?? null,
      probabilities: p !== undefined ? { yes: p, no: 1 - p } : null,
    };
  },
};
