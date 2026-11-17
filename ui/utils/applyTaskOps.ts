import type {
  CallDto,
  ErrorDto,
  FactEntry,
  PlanDto,
  RecalledDto,
  RefDto,
  SseChangeOp,
  StepDto,
  StopReason,
  TaskDto,
  TaskResult,
  TaskState,
  TaskSummary,
} from "../types/api.ts";

function appendUniqueById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((existing) => existing.id === item.id) ? [...list] : [...list, item];
}

/**
 * Aplica un lote de operaciones normalizadas (`change.ops`) sobre un `TaskDto` local
 * manteniendo la inmutabilidad estructural para React.
 */
export function applyTaskOps(prev: TaskDto, nextN: number, ops: readonly SseChangeOp[]): TaskDto {
  let task = prev.task;
  let plans: PlanDto[] | null = null;
  let steps: StepDto[] | null = null;
  let calls: CallDto[] | null = null;
  let errors: ErrorDto[] | null = null;
  let refs: RefDto[] | null = null;
  let recalled: RecalledDto[] | null = null;
  let facts: Record<string, FactEntry> | null = null;
  let result = prev.result;

  for (const op of ops) {
    if (op.op === "add") {
      switch (op.target) {
        case "plans":
          plans = appendUniqueById(plans ?? prev.plans, op.value as PlanDto);
          break;
        case "steps":
          steps = appendUniqueById(steps ?? prev.steps, op.value as StepDto);
          break;
        case "calls":
          calls = appendUniqueById(calls ?? prev.calls, op.value as CallDto);
          break;
        case "errors":
          errors = appendUniqueById(errors ?? prev.errors, op.value as ErrorDto);
          break;
        case "refs":
          refs = appendUniqueById(refs ?? prev.refs, op.value as RefDto);
          break;
        case "recalled":
          recalled = appendUniqueById(recalled ?? prev.recalled, op.value as RecalledDto);
          break;
      }
      continue;
    }

    if (op.op === "update") {
      if (op.target.startsWith("s")) {
        const patch = op.value as Partial<StepDto>;
        const base = steps ?? prev.steps;
        steps = base.map((s) => (s.id === op.target ? { ...s, ...patch } : s));
      } else if (op.target.startsWith("c")) {
        const patch = op.value as Partial<CallDto>;
        const base = calls ?? prev.calls;
        calls = base.map((c) => (c.id === op.target ? { ...c, ...patch } : c));
      }
      continue;
    }

    if (op.op === "set") {
      if (op.target === "result") {
        result = op.value as TaskResult;
      } else if (op.target.startsWith("facts.")) {
        const key = op.target.slice("facts.".length);
        facts = { ...(facts ?? prev.facts), [key]: op.value as FactEntry };
      }
      continue;
    }

    if (op.op === "finish" && op.target === "task") {
      const finishVal = op.value as { state: TaskState; stopReason?: StopReason | null };
      task = {
        ...task,
        state: finishVal.state,
        stopReason: finishVal.stopReason ?? null,
      };
    }
  }

  return {
    ...prev,
    n: nextN,
    task,
    plans: plans ?? prev.plans,
    steps: steps ?? prev.steps,
    calls: calls ?? prev.calls,
    errors: errors ?? prev.errors,
    refs: refs ?? prev.refs,
    recalled: recalled ?? prev.recalled,
    facts: facts ?? prev.facts,
    result,
  };
}

/**
 * Actualiza una fila de `TaskSummary` con la versión `n` y el posible cierre (`finish`).
 */
export function applyOpsToSummary(summary: TaskSummary, nextN: number, ops: readonly SseChangeOp[]): TaskSummary {
  let state = summary.state;
  let stopReason = summary.stopReason;
  for (const op of ops) {
    if (op.op === "finish" && op.target === "task") {
      const finishVal = op.value as { state: TaskState; stopReason?: StopReason | null };
      state = finishVal.state;
      stopReason = finishVal.stopReason ?? null;
    }
  }
  return {
    ...summary,
    n: nextN,
    state,
    stopReason,
  };
}

export function summaryFromDto(dto: TaskDto): TaskSummary {
  return {
    id: dto.task.id,
    mode: dto.task.mode,
    request: dto.task.request,
    state: dto.task.state,
    stopReason: dto.task.stopReason ?? null,
    startedAt: dto.task.startedAt,
    n: dto.n,
    waiting: dto.waiting?.kind ?? null,
  };
}
