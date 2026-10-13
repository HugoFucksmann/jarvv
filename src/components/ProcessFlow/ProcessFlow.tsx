import React from "react";
import type { Task } from "../../core/types.ts";
import { TaskOverview } from "./components/TaskOverview.tsx";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";

interface ProcessFlowProps {
  task: Task | null;
  onConfirmPlan: () => void | Promise<void>;
  onRejectPlan?: (reason?: string) => void | Promise<void>;
  onModifyPlan?: (feedback: string) => void | Promise<void>;
  onCancelTask: () => void | Promise<void>;
  onNewTask?: () => void;
}

export const ProcessFlow: React.FC<ProcessFlowProps> = ({
  task,
  onConfirmPlan,
  onRejectPlan,
  onModifyPlan,
  onCancelTask,
  onNewTask,
}) => {
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-slate-500">
        <p className="text-sm">No hay tareas activas en este momento.</p>
        <p className="text-xs font-mono text-slate-600 mt-1">
          Ingresa una instrucción en la línea de comando superior para iniciar el flujo.
        </p>
      </div>
    );
  }

  const isAwaitingPlanConfirmation = task.mode === "PLAN" && task.planConfirmed === false;

  return (
    <section className="flex flex-col gap-4 px-6 py-4">
      {/* 1. Header Overview */}
      <TaskOverview task={task} onNewTask={onNewTask} />

      {/* 2. Plan Confirmation Gate (if PLAN mode) */}
      {isAwaitingPlanConfirmation && (
        <PlanReview
          steps={task.steps}
          replans={task.replans}
          onConfirm={onConfirmPlan}
          onReject={onRejectPlan}
          onModify={onModifyPlan}
          onCancel={onCancelTask}
        />
      )}

      {/* 3. Steps Timeline */}
      {!isAwaitingPlanConfirmation && (
        <StepTimeline
          steps={task.steps}
          currentStepIndex={task.currentStep}
        />
      )}

      {/* 4. Final Synthesized Output */}
      {task.finalResponse && (
        <FinalResponseView response={task.finalResponse} />
      )}
    </section>
  );
};
