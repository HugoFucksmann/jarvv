import React from "react";
import { Task } from "../../core/types.ts";
import { TaskOverview } from "./components/TaskOverview.tsx";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";

interface ProcessFlowProps {
  task: Task | null;
  onConfirmPlan: () => void;
  onCancelTask: () => void;
}

export const ProcessFlow: React.FC<ProcessFlowProps> = ({
  task,
  onConfirmPlan,
  onCancelTask,
}) => {
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-slate-500">
        <p className="text-sm">No hay tareas activas en este momento.</p>
        <p className="text-xs font-mono text-slate-600 mt-1">
          Ingresa una instrucción arriba o selecciona uno de los escenarios para iniciar el flujo.
        </p>
      </div>
    );
  }

  const isAwaitingPlanConfirmation = task.mode === "PLAN" && task.planConfirmed === false;

  return (
    <section className="flex flex-col gap-4 px-6 py-4">
      {/* 1. Header Overview */}
      <TaskOverview task={task} />

      {/* 2. Plan Confirmation Gate (if PLAN mode) */}
      {isAwaitingPlanConfirmation && (
        <PlanReview
          steps={task.steps}
          onConfirm={onConfirmPlan}
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
