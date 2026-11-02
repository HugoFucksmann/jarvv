/**
 * Módulo `ctx`: contexto de una tarea (PLAN_CONTEXT.md v0.28).
 * Fase 1: esquema, vocabularios, `create` (`context`, `fromSnapshot`), `apply`, lectura, eventos y snapshot.
 * Fase 2: derivaciones (`derive.ts`) y las seis vistas estructuradas (`views/`), expuestas como `ctx.view.<vista>`.
 * Este paquete no importa nada fuera de `ctx/`. El texto de los prompts lo arman los renderizadores de `src/core/render/`.
 */

export { create } from "./create.ts";
export type { CreateContextParams } from "./create.ts";
export { TaskContext } from "./context.ts";
export type { ChangeListener } from "./context.ts";
export { ContextError } from "./errors.ts";
export type { ContextErrorCode, ValidationRule } from "./errors.ts";
export {
  CALL_KINDS,
  CALL_STATUSES,
  CALL_VERDICTS,
  CONTEXT_VERSION,
  ERROR_KINDS,
  EXECUTED_CALL_STATUSES,
  NOT_EXECUTED_CALL_STATUSES,
  PLAN_TRIGGERS,
  RESULT_ORIGINS,
  SECTION_NAMES,
  STEP_STATES,
  STOP_REASONS,
  TASK_MODES,
  TASK_STATES,
  TERMINAL_TASK_STATES,
  VERDICT_REASONS,
  VERIFIABLE_CALL_STATUSES,
} from "./types.ts";
export type {
  ApplyResult,
  Call,
  CallInput,
  CallKind,
  CallPatch,
  CallStatus,
  CallVerdict,
  ChangeEvent,
  ChangeMeta,
  ContextData,
  ContextElement,
  ContextLimits,
  ContextOptions,
  CurrentView,
  ElementOf,
  ErrorEntry,
  ErrorInput,
  ErrorKind,
  Fact,
  FactInput,
  FactTarget,
  FinishValue,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  NormalizedOp,
  Op,
  Plan,
  PlanInput,
  PlanTrigger,
  Ref,
  RefInput,
  ResultEntry,
  ResultOrigin,
  SectionName,
  Step,
  StepInput,
  StepPatch,
  StepState,
  StopReason,
  TaskInfo,
  TaskMode,
  TaskState,
  TerminalTaskState,
  VerdictReason,
} from "./types.ts";
// Derivaciones de cierre (Fase 1) y derivaciones de 5.4 (Fase 2): funciones puras sobre arreglos y datos.
export { canFinish, hasApprovedCall, hasApprovedOk, hasEffects, isEffect, planClosure, terminalStateFor } from "./closure.ts";
export {
  argsRetries,
  callsInStep,
  effectsOf,
  escalationCount,
  handoffOf,
  isExecuted,
  isFailure,
  isPossibleEffect,
  isRepeat,
  isTransientFailure,
  lastN,
  lastReadsWithData,
  possibleEffectsOf,
  recentFailures,
  recentWindowSize,
  replansDone,
  resultRetries,
} from "./derive.ts";
export type { Handoff, RepeatOptions } from "./derive.ts";
// Vistas (sección 8): tipos estructurados y frases fijas por `status` y por `reason`.
export { ARGS_SHOWN_STATUSES, REASON_NOTES, STATUS_NOTES } from "./views/messages.ts";
export type {
  ArgsView,
  ArgsViewOptions,
  AttemptView,
  AvailableRefView,
  CallView,
  ContextViews,
  EffectView,
  FactView,
  FallbackView,
  FeedbackView,
  FinalView,
  HandoffView,
  PlanView,
  PlanViewOptions,
  ReadArgKeys,
  RefView,
  RouteView,
  ShownRange,
  StepView,
  VerifyView,
  WindowOptions,
} from "./views/types.ts";