import React, { memo } from "react";
import type { CallDto, ExecutionMode, StepDto, TaskState } from "../../../types/api.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
  steps: StepDto[];
  calls?: CallDto[];
  taskState?: TaskState;
  mode?: ExecutionMode;
  onViewRef?: (refId: string) => void;
  onViewQueries?: (callId: string) => void;
}

const StepTimelineBase: React.FC<StepTimelineProps> = ({
  steps,
  calls = [],
  taskState,
  mode,
  onViewRef,
  onViewQueries,
}) => {
  const isTerminal =
    taskState === "completed" ||
    taskState === "partial" ||
    taskState === "failed" ||
    taskState === "cancelled";
  const isTaskActive = !isTerminal;

  if (steps.length === 0) {
    if (!isTaskActive) return null;
    return (
      <div className="py-8 text-center text-xs font-mono text-slate-500">
        {mode === "deliberative"
          ? "Generando plan estratégico de ejecución…"
          : "Iniciando pipeline y ejecutando primer paso…"}
      </div>
    );
  }

  // Encontrar el índice del paso en ejecución
  const currentStepIndex = steps.findIndex((s) => s.state === "running" && !s.superseded);

  return (
    <div className="flex flex-col gap-1">
      {steps.map((step, idx) => {
        const stepCalls = calls.filter((c) => c.stepId === step.id);
        const isCurrent = isTaskActive && (idx === currentStepIndex || (currentStepIndex === -1 && idx === steps.length - 1));

        return (
          <StepItem
            key={`step-${step.id || idx}`}
            step={step}
            calls={stepCalls}
            index={idx}
            isCurrent={isCurrent}
            isLast={idx === steps.length - 1}
            onViewRef={onViewRef}
            onViewQueries={onViewQueries}
          />
        );
      })}
    </div>
  );
};

export const StepTimeline = memo(StepTimelineBase);
