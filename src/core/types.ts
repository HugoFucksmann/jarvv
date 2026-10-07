/**
 * JARVIS Core v1.0 — Architecture & Core Contracts
 * Single Source of Truth for Core Types according to norm v1.0
 */

export type TaskState =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLED";

export type StepState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "UNVERIFIED"
  | "BLOCKED";

export type StepRoute =
  | "chat"
  | "windows"
  | "desktop_commander"
  | "free_search";

export interface Step {
  id: string;
  route: StepRoute;
  instruction: string;
  mcp?: string;
  tool?: string;
  args?: Record<string, unknown>;
  state: StepState;
  evidence?: Evidence;
  verification?: VerificationState;
  outcome?: ExecutionOutcome;
  error?: string;
}

export interface PlanStep {
  id: string;
  route: StepRoute;
  instruction: string;
}

export interface Plan {
  steps: PlanStep[];
}

export interface Scratchpad {
  search_results?: unknown[];
  selected_result?: unknown;
  url?: string;
  path?: string;
  process_id?: string;
  window_handle?: string;
  element_id?: string;
  text?: string;
}

export interface Task {
  id: string;
  message: string;
  mode: "NORMAL" | "PLAN";
  steps: Step[];
  currentStep: number;
  scratchpad: Scratchpad;
  state: TaskState;
  finalResponse?: string;
  planConfirmed?: boolean;
}

export interface Evidence {
  ok: boolean;
  summary?: string;
  flags?: string[];
  ref?: string;
}

export type VerificationState =
  | "VERIFIED"
  | "NOT_REQUIRED"
  | "UNVERIFIED";

export interface ExecutionOutcome {
  success?: boolean;
  isError?: boolean;
  actionDispatched?: boolean;
  outcomeVerified?: boolean;
}

export type Capability =
  | "READ"
  | "UI_ACTION"
  | "PROCESS_CONTROL"
  | "FILE_READ"
  | "FILE_WRITE"
  | "FILE_DELETE"
  | "COMMAND_EXECUTION"
  | "DOWNLOAD"
  | "CONFIGURATION";

export type GuardResult = "ALLOW" | "DENY" | "APPROVAL";

export interface GuardDecision {
  decision: GuardResult;
  reason?: string;
  capability: Capability;
}

export interface ToolPolicy {
  capability: Capability;
  requiresApproval?: boolean;
}

// Global Core Limits
export const MAX_STEPS = 15;
export const MAX_TOOL_CALLS_PER_STEP = 4;
export const MAX_PLAN_GENERATION_ATTEMPTS = 1;
export const MAX_ARG_RETRIES = 1;

// Decision 2.0 Integration Types (vllm-sr/Decision-2.0-Kai-0.6B)
export type DecisionQuestionType = "choice" | "noul" | "score";

export interface DecisionQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>; // 2–255 options
}

export interface DecisionQuestionNoul {
  type: "noul";
  instructions: string;
}

export interface DecisionQuestionScore {
  type: "score";
  instructions: string;
  criteria: string[]; // 2–10 ordered levels
}

export type DecisionQuestion =
  | DecisionQuestionChoice
  | DecisionQuestionNoul
  | DecisionQuestionScore;

export interface DecisionAnswerChoice {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface DecisionAnswerNoul {
  type: "noul";
  noul: number; // Probability of YES/true (0.0 to 1.0)
}

export interface DecisionAnswerScore {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
}

export type DecisionAnswer =
  | DecisionAnswerChoice
  | DecisionAnswerNoul
  | DecisionAnswerScore;

export interface DecisionResponse {
  model: "Decision-2.0-Kai-0.6B";
  answers: Record<string, DecisionAnswer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// MCP Contracts
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPContentItem {
  type: string;
  text?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface MCPCallResult {
  content: MCPContentItem[];
  isError?: boolean;
  // Specific potential fields from Windows, Desktop Commander, Free Search
  success?: boolean;
  actionDispatched?: boolean;
  outcomeVerified?: boolean;
  kind?: "full" | "diff";
  tree?: unknown[];
  changes?: unknown[];
  postActionState?: unknown;
  postActionElement?: unknown;
  snapshotIncomplete?: boolean;
  snapshotWarning?: string;
  postActionSnapshotIncomplete?: boolean;
  postActionWarning?: string;
  search_incomplete?: boolean;
  truncated?: boolean;
  retrieved_at?: string;
  cache_age_seconds?: number;
  trimmed?: Record<string, unknown>;
  benched_engines?: string[];
  [key: string]: unknown;
}

// Pending Approval Request for UI interaction
export interface PendingApproval {
  id: string;
  stepId: string;
  mcp: string;
  tool: string;
  capability: Capability;
  args: Record<string, unknown>;
  reason: string;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
}

// Live Core observable event stream
export type CoreEventType =
  | "TASK_CREATED"
  | "DECISION_ONE"
  | "DISCOVERY_REFRESH"
  | "DECISION_TWO"
  | "ARGUMENTS_GENERATED"
  | "GUARD_EVALUATION"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "MCP_DISPATCHED"
  | "MCP_RESULT"
  | "RESULT_PROCESSED"
  | "STEP_COMPLETED"
  | "FINAL_RESPONSE"
  | "TASK_STATE_CHANGED"
  | "PLAN_GENERATED";

export interface CoreEvent {
  type: CoreEventType;
  timestamp: number;
  taskId: string;
  stepId?: string;
  data: Record<string, unknown>;
}
