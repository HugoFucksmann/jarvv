import React from "react";
import { History } from "lucide-react";
import type { TaskDto } from "../../types/api.ts";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";
import { Separator } from "../Shared/Separator.tsx";
import { FOCUS_SHORTCUT_LABEL } from "../../utils/platform.ts";
import type { ActionResult } from "../../types/ui.ts";

interface ProcessFlowProps {
  task: TaskDto | null;
  onConfirmPlan: () => ActionResult;
  onRejectPlan?: () => ActionResult;
  onModifyPlan?: (feedback: string) => ActionResult;
  onCancelTask: () => ActionResult;
}

export const ProcessFlow: React.FC<ProcessFlowProps> = ({
  task,
  onConfirmPlan,
  onRejectPlan,
  onModifyPlan,
  onCancelTask,
}) => {
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 py-20 text-center">
        <p className="text-base font-medium text-slate-300">Todavía no hay tareas</p>
        <p className="text-sm text-slate-500 max-w-sm">
          Escribe una instrucción arriba y pulsa Enter. Con {FOCUS_SHORTCUT_LABEL} vuelves al
          campo desde cualquier lugar.
        </p>
      </div>
    );
  }

  const isAwaitingPlanConfirmation = task.waiting?.kind === "plan";
  const planWaiting = isAwaitingPlanConfirmation ? task.waiting : null;
  const isMaterialReplan = task.plans.length > 1;
  const hasExecutedSteps = task.steps.some(
    (s) => s.state !== "pending" || task.calls.some((c) => c.stepId === s.id)
  );
  const executedCount = task.steps.filter((s) => s.state !== "pending").length;

  const timeline = (
    <StepTimeline
      steps={task.steps}
      calls={task.calls}
      taskState={task.task.state}
      mode={task.task.mode}
    />
  );

  return (
    <section className="flex flex-col gap-5 py-4">
      {planWaiting && planWaiting.kind === "plan" ? (
        <div className="flex flex-col gap-3">
          <PlanReview
            steps={planWaiting.request.steps}
            onConfirm={onConfirmPlan}
            onReject={onRejectPlan}
            onModify={onModifyPlan}
            onCancel={onCancelTask}
          />

          {(hasExecutedSteps || isMaterialReplan) && (
            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 px-1">
                <History className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-slate-300">
                  Pasos Previos Ejecutados y En Curso ({executedCount} ejecutados)
                </span>
                <Separator />
                <span className="text-slate-500">
                  Consulte abajo las llamadas y evidencias acumuladas
                </span>
              </div>
              {timeline}
            </div>
          )}
        </div>
      ) : (
        timeline
      )}

      {task.result && <FinalResponseView result={task.result} />}
    </section>
  );
};
