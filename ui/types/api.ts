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
  | "unrecoverable";

export interface TaskInfo {
  id: string;
  mode: ExecutionMode;
  request: string;
  state: TaskState;
  stopReason?: StopReason;
  startedAt: string;
}

export interface PlanDto {
  id: string;
  at: string;
  trigger: "initial" | "user_feedback" | "step_failure";
  feedback?: string;
  stepId?: string;
}

export type StepState = "pending" | "running" | "completed" | "failed";

export interface StepDto {
  id: string;
  at: string;
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
  | "refs_unresolved"
  | "loop_blocked"
  | "user_rejected"
  | "tool_rejected"
  | "info_missing"
  | string;

export interface CallDto {
  id: string;
  stepId: string;
  at: string;
  route: string;
  tool: string;
  kind: "read" | "write";
  args: Record<string, unknown>;
  sig: string;
  status: CallStatus;
  verdict: "approved" | "rejected" | null;
  reason?: string;
  summary?: string;
  ref?: string;
}

export interface ErrorDto {
  id: string;
  stepId: string;
  at: string;
  kind: "service_unavailable";
}

export interface FactEntry {
  value: unknown;
  stepId: string;
  at: string;
}

export interface RefDto {
  id: string;
  stepId: string;
  at: string;
  label: string;
  size: number;
  where: string;
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

export interface WaitingApproval {
  kind: "approval";
  request: {
    id: string;
    mcp: string;
    tool: string;
    capability: string;
    reason: string;
    args: Record<string, unknown>;
  };
}

export interface WaitingQuestion {
  kind: "question";
  question: {
    stepId: string;
    question: string;
  };
}

export type Waiting = WaitingPlan | WaitingApproval | WaitingQuestion;

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
  result: TaskResult | null;
  waiting: Waiting | null;
}

export interface TaskSummary {
  id: string;
  state: TaskState;
  mode: ExecutionMode;
  request: string;
  startedAt: string;
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

export interface SseCreated {
  type: "created";
  taskId: string;
  n: number;
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
  at: string;
  ops: SseChangeOp[];
}

export interface SseWaiting {
  type: "waiting";
  taskId: string;
  waiting: Waiting | null;
}

export type SseMessage = SseCreated | SseChange | SseWaiting;

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
  verify: number;
  final: number;
}

export interface BlacklistEntry {
  tool: string;
  pattern?: string;
  reason: string;
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
  maxUserRejectionsPerStep: number;
  maxQuestionsPerStep: number;
}

export interface JarvisConfig {
  qwenUrl: string;
  qwenModel: string;
  thinking: boolean;
  qwenNumCtx: number;
  qwenMaxTokens: QwenMaxTokens;
  qwenTimeoutMs: number;
  qwenThinkingTimeoutMs: number;
  decisionUrl: string;
  decisionModel: string;
  decisionMaxContext: number;
  decisionTimeoutMs: number;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  mcpTimeoutMs: number;
  traceEnabled: boolean;
  tracePath: string;
  refsDir?: string;
  retentionDays?: number;
  blacklist?: BlacklistEntry[];
  autoMode?: boolean;
}

export type ConfigPatch = Partial<
  Omit<JarvisConfig, "desktopCommanderMcp" | "freeSearchMcp" | "qwenMaxTokens">
> & {
  desktopCommanderMcp?: Partial<StdioServerConfig>;
  freeSearchMcp?: Partial<StdioServerConfig>;
  qwenMaxTokens?: Partial<QwenMaxTokens>;
};
