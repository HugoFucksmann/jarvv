/**
 * JARVIS Core — Mapa de tipos de eventos y unión discriminada de CoreEvent.
 *
 * NOTA: Este archivo contiene ÚNICAMENTE `import type` para evitar arrastrar módulos de Node
 * cuando la UI importa `CoreEvent` o `CoreEventType`.
 */

import type {
  CallStatus,
  DecisionOneResult,
  DecisionTwoResult,
  GuardDecision,
  McpServerName,
  PendingApproval,
  StageVerificationResult,
  Step,
  StepState,
  StepVerificationResult,
  Task,
  TaskState,
  TimeSpan,
  VerificationState,
} from "./types.ts";
import type { ProcessedResult } from "./processor/resultProcessor.ts";

export interface CoreEventDataMap {
  TASK_CREATED: { task: Task };
  DECISION_ONE: Pick<DecisionOneResult, "route" | "probabilities" | "rawInput" | "rawOutput" | "timing"> & {
    purpose?: "escalation" | "reselection";
  };
  DECISION_TWO: Pick<DecisionTwoResult, "probabilities" | "rawInput" | "rawOutput" | "shortcut" | "timing"> & {
    tool: string;
    candidates: string[];
    memory: string;
  };
  ARGUMENTS_GENERATED:
  | {
    error: string;
    attempt?: number;
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
  }
  | {
    args: Record<string, unknown>;
    resolvedRefs: string[];
    unresolvedRefs: string[];
    replacedCount: number;
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
  };
  GUARD_EVALUATION: { guardDecision: GuardDecision };
  /** Lleva callbacks (onApprove/onDeny); JSON.stringify los descarta automáticamente en el SSE. */
  APPROVAL_REQUESTED: { pendingApproval: PendingApproval };
  APPROVAL_RESOLVED: { approved: boolean; reason?: string };
  MCP_DISPATCHED: { mcp: McpServerName; tool: string; args: Record<string, unknown> };
  MCP_RESULT: { rawResult: unknown; execution: TimeSpan };
  RESULT_PROCESSED: {
    processed: ProcessedResult;
    callStatus: CallStatus;
    execution: TimeSpan;
    verification: StepVerificationResult | null;
    eosUnavailable: boolean;
    isStepSuccess: boolean;
    verificationState: VerificationState;
    verifiedBy?: "eos" | "qwen";
    rawInput?: string;
    rawOutput?: string;
  };
  STEP_STATE_CHANGED: {
    step: Step;
    stepIndex?: number;
    state: StepState;
  };
  STEP_COMPLETED: {
    step: Step;
    stepIndex?: number;
    error?: string;
  };
  FINAL_RESPONSE: {
    response?: string;
    state: TaskState;
    source?: "model" | "fallback";
    synthesisError?: string;
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
  };
  TASK_STATE_CHANGED: {
    state: TaskState;
    waitingReason?: "approval" | "plan_confirmation" | "user_answer";
    planConfirmed?: boolean;
    userAnswerProvided?: boolean;
    stepId?: string;
    question?: string;
    error?: string;
    finalResponse?: string;
  };
  PLAN_GENERATED: {
    steps: Step[];
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
    replan?: boolean;
    isMaterialReplan?: boolean;
  };
  PLAN_REJECTED: { reason: string };
  PLAN_MODIFIED: { feedback: string; steps: Step[] };
  STAGE_VERIFIED: {
    stepId: string;
    stageVerification: StageVerificationResult;
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
  };
}

export type CoreEventType = keyof CoreEventDataMap;

export type CoreEvent = {
  [T in CoreEventType]: {
    type: T;
    timestamp: number;
    taskId: string;
    stepId?: string;
    data: CoreEventDataMap[T];
  };
}[CoreEventType];