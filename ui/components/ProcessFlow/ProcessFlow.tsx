import React, { useMemo } from "react";
import { History, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import type { Task, CoreEvent } from "../../../src/core/types.ts";
import { TaskOverview } from "./components/TaskOverview.tsx";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";
import { Separator } from "../Shared/Separator.tsx";
import { getActivityPhrase } from "../../utils/taskStatus.ts";
import type { ActionResult } from "../../types/ui.ts";

interface ProcessFlowProps {
  task: Task | null;
  events?: CoreEvent[];
  isExecuting?: boolean;
  onConfirmPlan: () => ActionResult;
  onRejectPlan?: (reason?: string) => ActionResult;
  onModifyPlan?: (feedback: string) => ActionResult;
  onCancelTask: () => ActionResult;
  onNewTask?: () => void;
}

export const ProcessFlow: React.FC<ProcessFlowProps> = ({
  task,
  events = [],
  isExecuting = false,
  onConfirmPlan,
  onRejectPlan,
  onModifyPlan,
  onCancelTask,
  onNewTask,
}) => {
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const activity = useMemo(
    () => getActivityPhrase(task, lastEvent, isExecuting),
    [task, lastEvent, isExecuting]
  );

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
    <section className="flex flex-col gap-4 px-6 py-4">
      <TaskOverview task={task} onNewTask={onNewTask} />

      {/* Tarea 2: Indicador de 3 estados (trabajando, esperando al usuario, terminada) con frase de rol */}
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs font-mono transition-colors ${activity.stateGroup === "working"
            ? "bg-sky-950/40 border-sky-800/60 text-sky-200"
            : activity.stateGroup === "waiting"
              ? "bg-amber-950/40 border-amber-800/60 text-amber-200"
              : "bg-slate-900/50 border-slate-800 text-slate-300"
          }`}
      >
        {activity.stateGroup === "working" && (
          <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
        )}
        {activity.stateGroup === "waiting" && (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
        )}
        {activity.stateGroup === "finished" && (
          task.state === "COMPLETED" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : task.state === "FAILED" ? (
            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800">
            {activity.stateGroup === "working"
              ? "Trabajando"
              : activity.stateGroup === "waiting"
                ? "Esperando al usuario"
                : "Terminada"}
          </span>
          <span className="font-medium">{activity.label}</span>
        </div>
      </div>

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