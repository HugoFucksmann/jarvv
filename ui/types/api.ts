/**
 * Contrato HTTP/SSE entre la UI y el backend JARVIS (/api/jarvis/*).
 * Totalmente desacoplado de src/core.
 */

export type ExecutionMode = "reactive" | "deliberative";

export type TaskState = "running" | "completed" | "partial" | "failed" | "cancelled";

export type StopReason =
  | "max_steps"
  | "no_alternatives"
  | "security_denied"
  | "user_cancelled"
  | "replans_exhausted"
  | "unrecoverable"
  | "restart";

export interface TaskInfo {
  id: string;
  mode: ExecutionMode;
  request: string;
  state: TaskState;
  stopReason?: StopReason | null;
  startedAt: string | number;
}

export interface PlanDto {
  id: string;
  at: string | number;
  trigger: "initial" | "user_feedback" | "step_failure";
  feedback?: string | null;
  stepId?: string | null;
}

export type StepState = "pending" | "running" | "completed" | "failed";

export interface StepDto {
  id: string;
  at: string | number;
  planId: string | null;
  instruction: string | null;
  route: string | null;
  expected: string | null;
  state: StepState;
  superseded: boolean;
}

export type CallStatus =
  | "ok"
  | "no_data"
  | "not_found"
  | "tool_error"
  | "exception"
  | "interrupted"
  | "waiting_input"
  | "denied"
  | "args_invalid"
  | "loop_blocked"
  | "user_rejected"
  | "tool_rejected"
  | "info_missing"
  | string;

export type VerdictReason =
  | "no_usable_data"
  | "not_accomplished"
  | "wrong_place"
  | "wrong_position"
  | "wrong_scope"
  | "wrong_item"
  | "missing_attribute";

export interface CallDto {
  id: string;
  stepId: string;
  at: string | number;
  route: string;
  tool: string;
  kind: "read" | "write";
  args: Record<string, unknown> | null;
  sig: string | null;
  status: CallStatus;
  verdict: "approved" | "rejected" | null;
  reason?: VerdictReason | string | null;
  summary?: string | null;
  ref?: string | null;
}

export interface ErrorDto {
  id: string;
  stepId: string;
  at: string | number;
  kind: "service_unavailable";
}

export interface FactEntry {
  value: unknown;
  stepId: string;
  at: string | number;
}

export interface RefDto {
  id: string;
  stepId: string;
  at: string | number;
  label: string;
  size: number;
  where: string;
}

export interface RecalledDto {
  id: string;
  at: string | number;
  stepId: string | null;
  source: "user_memory" | "thread";
  key: string;
  value: string;
  from: string | null;
}

export interface TaskResult {
  text: string;
  origin: "model" | "fallback";
}

export interface WaitingPlanStep {
  id: string;
  instruction: string;
  route: string;
  expected: string;
}

export interface WaitingPlan {
  kind: "plan";
  request: {
    id: string;
    planId: string;
    steps: WaitingPlanStep[];
  };
}

export type ApprovalTier = "green" | "yellow" | "red";

export interface ApprovalBlacklistInfo {
  id: string;
  level: "blocked" | "sensitive";
}

export interface WaitingApproval {
  kind: "approval";
  request: {
    id: string;
    mcp: string;
    tool: string;
    capability: string;
    reason: string;
    args: Record<string, unknown>;
    /** Si es verdadero se ofrece «Aprobar siempre en esta tarea» (nunca para lo obligatorio de Guard). */
    canRemember?: boolean;
    tier?: ApprovalTier;
    blacklist?: ApprovalBlacklistInfo;
  };
}

export type QuestionSource = "model" | "process";

export interface WaitingQuestion {
  kind: "question";
  question: {
    id: string;
    stepId: string;
    question: string;
    source: QuestionSource;
    pid?: string;
  };
}

export type Waiting = WaitingPlan | WaitingApproval | WaitingQuestion;

export interface ModelPauseDto {
  since: number;
  model: string;
}

export interface TaskDto {
  v: 1;
  n: number;
  task: TaskInfo;
  plans: PlanDto[];
  steps: StepDto[];
  calls: CallDto[];
  errors: ErrorDto[];
  facts: Record<string, FactEntry>;
  refs: RefDto[];
  recalled: RecalledDto[];
  result: TaskResult | null;
  waiting: Waiting | null;
  paused: ModelPauseDto | null;
}

export interface TaskSummary {
  id: string;
  state: TaskState;
  mode: ExecutionMode;
  request: string;
  stopReason?: StopReason | null;
  startedAt: number | string;
  n?: number;
  waiting?: Waiting["kind"] | null;
}

export interface McpToolDto {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type UnavailableServers = Record<string, { reason: string; since: number }>;

export interface ApiErrorBody {
  error: string;
}

export interface OkResponse {
  ok?: boolean;
}

export interface InitiateTaskResponse {
  task: TaskDto;
}

export interface StateResponse {
  task: TaskDto | null;
  tasks: TaskSummary[];
  discoveredTools: Record<string, McpToolDto[]>;
  unavailableServers: UnavailableServers;
}

export interface DiscoveryResponse {
  tools: Record<string, McpToolDto[]>;
  unavailableServers?: UnavailableServers;
  error?: string;
}

export interface SseSnapshot {
  type: "snapshot";
  task: TaskDto | null;
  tasks: TaskSummary[];
  discoveredTools: Record<string, McpToolDto[]>;
  unavailableServers: UnavailableServers;
}

export interface SseCreated {
  type: "created";
  taskId: string;
  n: number;
  summary: TaskSummary;
}

export interface SseChangeOp {
  op: "add" | "update" | "set" | "finish";
  target: string;
  value: unknown;
}

export interface SseChange {
  type: "change";
  taskId: string;
  n: number;
  at: number | string;
  ops: SseChangeOp[];
}

export interface SseWaiting {
  type: "waiting";
  taskId: string;
  waiting: Waiting | null;
}

export interface SsePaused {
  type: "paused";
  taskId: string;
  paused: ModelPauseDto | null;
}

export type SseMessage = SseSnapshot | SseCreated | SseChange | SseWaiting | SsePaused;

// Tipos de configuración para SettingsModal
export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowedDirectories?: string[];
}

export interface QwenMaxTokens {
  arguments: number;
  plan: number;
  replan: number;
  final: number;
}

export interface BlacklistEntry {
  tool: string;
  pattern?: string;
  reason: string;
  level?: "blocked" | "sensitive";
}

export interface UserEnvironment {
  platform: "windows" | "macos" | "linux";
  home: string;
  desktop?: string;
  documents?: string;
  downloads?: string;
  now: string;
  timeZone: string;
}

export interface EngineLimits {
  maxSteps: number;
  maxReplans: number;
  maxEscalations: number;
  maxItemFailures: number;
  maxCallsPerStep: number;
  maxAttemptsPerStep: number;
  maxNotAccomplishedPerRoute: number;
  maxRepeatsPerStep: number;
  maxReviewRejectionsPerStep: number;
  maxVerifyRejectionsPerStep: number;
  maxUserRejectionsPerStep: number;
  maxDeniedPerStep: number;
  maxQuestionsPerStep: number;
  maxProcessPromptsPerStep: number;
}

export interface JarvisConfig {
  qwenUrl: string;
  qwenModel: string;
  thinking: boolean;
  qwenNumCtx: number;
  qwenMaxTokens: QwenMaxTokens;
  modelKeepAlive?: string;
  qwenTimeoutMs: number;
  qwenThinkingTimeoutMs: number;
  decisionUrl: string;
  decisionModel: string;
  decisionMaxContext: number;
  decisionTimeoutMs: number;
  modelUnavailablePauseMaxMs?: number;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  mcpTimeoutMs: number;
  toolTimeoutsMs?: Record<string, number>;
  modelTimeoutsMs?: Record<string, number>;
  runCommandDefaultWaitSec?: number;
  runCommandMaxWaitSec?: number;
  webJudgeTimeoutMs?: number;
  sseKeepAliveMs?: number;
  shutdownDrainMs?: number;
  traceEnabled: boolean;
  tracePath: string;
  refsDir?: string;
  retentionDays?: number;
  logRetentionDays?: number;
  retentionMaxMb?: number;
  blacklist?: BlacklistEntry[];
  autoMode?: boolean;
  approvalTiers?: boolean;
  reviewFullView?: boolean;
  reviewReads?: boolean;
  completionCoverageGuard?: boolean;
  webSearchUseJudge?: boolean;
  voiceEnabled?: boolean;
  telegramVoice?: boolean;
  voiceUrl?: string;
  voiceName?: string;
}

export type ConfigPatch = Partial<
  Omit<JarvisConfig, "desktopCommanderMcp" | "freeSearchMcp" | "qwenMaxTokens">
> & {
  desktopCommanderMcp?: Partial<StdioServerConfig>;
  freeSearchMcp?: Partial<StdioServerConfig>;
  qwenMaxTokens?: Partial<QwenMaxTokens>;
};
