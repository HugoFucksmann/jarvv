import React, { memo } from "react";
import { Loader2, RefreshCw, MessageSquare } from "lucide-react";
import type { CallDto, ErrorDto, ExecutionMode, FactEntry, PlanDto, StepDto, TaskState } from "../../../types/api.ts";
import { parseProcessPids } from "../../../utils/taskStatus.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
  steps: StepDto[];
  plans?: PlanDto[];
  calls?: CallDto[];
  errors?: ErrorDto[];
  processFact?: FactEntry | null;
  taskState?: TaskState;
  mode?: ExecutionMode;
  onViewRef?: (refId: string) => void;
  onViewQueries?: (callId: string) => void;
  allCalls?: CallDto[];
}

const StepTimelineBase: React.FC<StepTimelineProps> = ({
  steps,
  plans = [],
  calls = [],
  errors = [],
  processFact,
  taskState,
  mode,
  onViewRef,
  onViewQueries,
  allCalls,
}) => {
  const isTerminal =
    taskState === "completed" ||
    taskState === "partial" ||
    taskState === "failed" ||
    taskState === "cancelled";
  const isTaskActive = !isTerminal;
  const activeProcessPids = parseProcessPids(processFact);

  if (steps.length === 0) {
    if (!isTaskActive) return null;
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin text-accent-400" />
        {mode === "deliberative"
          ? "Generando el plan de ejecución…"
          : "Iniciando y ejecutando el primer paso…"}
      </div>
    );
  }

  // Mapa de planes posteriores al inicial para mostrar el motivo de replanificación en la línea de tiempo
  const replansById = new Map<string, PlanDto>();
  plans.slice(1).forEach((p) => replansById.set(p.id, p));

  // Encontrar el índice del paso en ejecución
  const currentStepIndex = steps.findIndex((s) => s.state === "running" && !s.superseded);

  return (
    <div className="flex flex-col gap-1">
      {steps.map((step, idx) => {
        const prevStep = idx > 0 ? steps[idx - 1] : null;
        const planChanged = Boolean(step.planId && step.planId !== prevStep?.planId && replansById.has(step.planId));
        const replan = planChanged && step.planId ? replansById.get(step.planId) : undefined;

        const stepCalls = calls.filter((c) => c.stepId === step.id);
        const stepErrors = errors.filter((e) => e.stepId === step.id);
        const stepProcessPids =
          processFact && processFact.stepId === step.id && activeProcessPids.length > 0
            ? activeProcessPids
            : [];
        const isCurrent = isTaskActive && (idx === currentStepIndex || (currentStepIndex === -1 && idx === steps.length - 1));

        return (
          <React.Fragment key={`step-${step.id || idx}`}>
            {replan && (
              <div className="my-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-xs text-slate-300">
                {replan.trigger === "user_feedback" ? (
                  <MessageSquare className="w-3.5 h-3.5 text-accent-400 shrink-0" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                )}
                <span className="font-medium text-slate-200">
                  {replan.trigger === "user_feedback"
                    ? "Plan ajustado por el usuario"
                    : "Replanificación automática"}
                </span>
                {replan.feedback && (
                  <span className="text-slate-400 truncate" title={replan.feedback}>
                    · «{replan.feedback}»
                  </span>
                )}
                {replan.at && (
                  <span className="ml-auto text-[11px] text-slate-500 tabular-nums shrink-0">
                    {new Date(replan.at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            )}
            <StepItem
              step={step}
              calls={stepCalls}
              errors={stepErrors}
              processPids={stepProcessPids}
              index={idx}
              isCurrent={isCurrent}
              isLast={idx === steps.length - 1}
              onViewRef={onViewRef}
              onViewQueries={onViewQueries}
              allCalls={allCalls || calls}
              taskState={taskState}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const StepTimeline = memo(StepTimelineBase);