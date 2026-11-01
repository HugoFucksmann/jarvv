/**
 * Módulo `ctx`: contexto de una tarea (PLAN_CONTEXT.md v0.28).
 * Fase 1: esquema, vocabularios, `create` (`context`, `fromSnapshot`), `apply`, lectura, eventos y snapshot.
 * Este paquete no importa nada fuera de `ctx/`.
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
// Derivaciones de cierre que `apply` ya necesita; la Fase 2 agrega el resto junto a ellas.
export { canFinish, hasApprovedCall, hasApprovedOk, hasEffects, planClosure, terminalStateFor } from "./closure.ts";
