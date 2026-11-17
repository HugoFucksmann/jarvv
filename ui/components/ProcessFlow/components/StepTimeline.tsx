import React, { memo } from "react";
import { Loader2 } from "lucide-react";
import type { CallDto, ErrorDto, ExecutionMode, FactEntry, StepDto, TaskState } from "../../../types/api.ts";
import { parseProcessPids } from "../../../utils/taskStatus.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
  steps: StepDto[];
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

  // Encontrar el índice del paso en ejecución
  const currentStepIndex = steps.findIndex((s) => s.state === "running" && !s.superseded);

  return (
    <div className="flex flex-col gap-1">
      {steps.map((step, idx) => {
        const stepCalls = calls.filter((c) => c.stepId === step.id);
        const stepErrors = errors.filter((e) => e.stepId === step.id);
        const stepProcessPids =
          processFact && processFact.stepId === step.id && activeProcessPids.length > 0
            ? activeProcessPids
            : [];
        const isCurrent = isTaskActive && (idx === currentStepIndex || (currentStepIndex === -1 && idx === steps.length - 1));

        return (
          <StepItem
            key={`step-${step.id || idx}`}
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
        );
      })}
    </div>
  );
};

export const StepTimeline = memo(StepTimelineBase);