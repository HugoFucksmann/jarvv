import React from "react";
import { History } from "lucide-react";
import type { Task } from "../../../src/core/types.ts";
import { TaskOverview } from "./components/TaskOverview.tsx";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";
import { Separator } from "../Shared/Separator.tsx";

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
  const isMaterialReplan = (task.replans ?? 0) > 0;
  const hasExecutedSteps = task.steps.some(
    (s) => s.state !== "PENDING" || (s.calls && s.calls.length > 0)
  );
  const executedCount = task.steps.filter((s) => s.state !== "PENDING").length;

  const timeline = (
    <StepTimeline
      steps={task.steps}
      currentStepIndex={task.currentStep}
      taskState={task.state}
      mode={task.mode}
    />
  );

  return (
    <section className="flex flex-col gap-4 px-6 py-4">
      <TaskOverview task={task} onNewTask={onNewTask} />

      {isAwaitingPlanConfirmation ? (
        <div className="flex flex-col gap-3">
          <PlanReview
            steps={task.steps}
            replans={task.replans}
            onConfirm={onConfirmPlan}
            onReject={onRejectPlan}
            onModify={onModifyPlan}
            onCancel={onCancelTask}
          />

          {/* Con pasos ya ejecutados o tras una replanificación material, el timeline sigue visible */}
          {(hasExecutedSteps || isMaterialReplan) && (
            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 px-1">
                <History className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-slate-300">
                  Pasos Previos Ejecutados y En Curso ({executedCount} ejecutados)
                </span>
                <Separator />
                <span className="text-slate-500">
                  Consulte abajo las evidencias y llamadas MCP acumuladas
                </span>
              </div>
              {timeline}
            </div>
          )}
        </div>
      ) : (
        timeline
      )}

      {task.finalResponse && (
        <FinalResponseView response={task.finalResponse} rawOutput={task.rawFinalOutput} />
      )}
    </section>
  );
};