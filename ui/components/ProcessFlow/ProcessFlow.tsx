import React from "react";
import { History } from "lucide-react";
import type { Task } from "../../../src/core/types.ts";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";
import { Separator } from "../Shared/Separator.tsx";
import { FOCUS_SHORTCUT_LABEL } from "../../utils/platform.ts";
import type { ActionResult } from "../../types/ui.ts";

interface ProcessFlowProps {
  task: Task | null;
  onConfirmPlan: () => ActionResult;
  onRejectPlan?: (reason?: string) => ActionResult;
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
          Escribe una instrucción arriba y pulsa Enter. Con {FOCUS_SHORTCUT_LABEL} vuelves al campo desde cualquier lugar.
        </p>
      </div>
    );
  }

  // El back declara la espera con `waitingReason`; con `planConfirmed === false` también aparecía durante la generación del plan.
  const isAwaitingPlanConfirmation = task.state === "WAITING_INPUT" && task.waitingReason === "plan_confirmation";
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
    <section className="flex flex-col gap-5 py-4">
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