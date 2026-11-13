import React, { useState } from "react";
import { History, Terminal } from "lucide-react";
import type { TaskDto, RefDto } from "../../types/api.ts";
import { PlanReview } from "./components/PlanReview.tsx";
import { StepTimeline } from "./components/StepTimeline.tsx";
import { FinalResponseView } from "./components/FinalResponseView.tsx";
import { FailureAnalysis } from "./components/FailureAnalysis.tsx";
import { ArtifactsList } from "./components/ArtifactsList.tsx";
import { RefViewerModal } from "./components/RefViewerModal.tsx";
import { TraceViewerModal } from "./components/TraceViewerModal.tsx";
import { Separator } from "../Shared/Separator.tsx";
import { FOCUS_SHORTCUT_LABEL } from "../../utils/platform.ts";
import type { ActionResult } from "../../types/ui.ts";

interface ProcessFlowProps {
  task: TaskDto | null;
  onConfirmPlan: () => ActionResult;
  onRejectPlan?: () => ActionResult;
  onModifyPlan?: (feedback: string) => ActionResult;
  onCancelTask: () => ActionResult;
  onOpenTrace?: () => void;
  onOpenCallTrace?: (callId: string) => void;
  onSpeak?: (text: string) => void;
  onStopSpeech?: () => void;
  speechStatus?: "idle" | "loading" | "playing";
}

export const ProcessFlow: React.FC<ProcessFlowProps> = ({
  task,
  onConfirmPlan,
  onRejectPlan,
  onModifyPlan,
  onCancelTask,
  onOpenTrace: externalOpenTrace,
  onOpenCallTrace: externalOpenCallTrace,
  onSpeak,
  onStopSpeech,
  speechStatus,
}) => {
  const [internalTraceOpen, setInternalTraceOpen] = useState(false);
  const [internalCallId, setInternalCallId] = useState<string | null>(null);
  const [activeRefId, setActiveRefId] = useState<string | null>(null);
  const [activeRefMeta, setActiveRefMeta] = useState<RefDto | undefined>(undefined);

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-slate-900 border border-slate-800">
          <Terminal className="w-5 h-5 text-accent-400" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-base font-medium text-slate-200">Todavía no hay tareas</p>
          <p className="text-sm text-slate-500 max-w-sm">
            Escribe una instrucción arriba y pulsa Enter. Con{" "}
            <kbd className="px-1.5 py-0.5 text-[11px] font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded">
              {FOCUS_SHORTCUT_LABEL}
            </kbd>{" "}
            vuelves al campo desde cualquier lugar.
          </p>
        </div>
      </div>
    );
  }

  const handleOpenTrace = () => {
    if (externalOpenTrace) {
      externalOpenTrace();
    } else {
      setInternalCallId(null);
      setInternalTraceOpen(true);
    }
  };

  const isTerminalTask = task.task.state !== "running";
  const handleViewQueries = isTerminalTask
    ? (callId: string) => {
      if (externalOpenCallTrace) externalOpenCallTrace(callId);
      else {
        setInternalCallId(callId);
        setInternalTraceOpen(true);
      }
    }
    : undefined;

  const handleViewRef = (refId: string, meta?: RefDto) => {
    const foundMeta = meta || task.refs?.find((r) => r.id === refId);
    setActiveRefMeta(foundMeta);
    setActiveRefId(refId);
  };

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
      onViewRef={handleViewRef}
      onViewQueries={handleViewQueries}
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
            <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
                <History className="w-3.5 h-3.5 text-accent-400" />
                <span className="font-semibold text-slate-200">
                  Pasos previos ({executedCount} ejecutados)
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

      {/* Auditoría de fallo o conclusión parcial (stopReason + escrituras) */}
      <FailureAnalysis task={task} />

      {/* Artefactos, referencias, procesos en segundo plano y respuestas */}
      <ArtifactsList task={task} onViewRef={handleViewRef} />

      {/* Respuesta final si ya está sintetizada */}
      {task.result && (
        <FinalResponseView result={task.result} onOpenTrace={handleOpenTrace} onSpeak={onSpeak} onStopSpeech={onStopSpeech} speechStatus={speechStatus} />
      )}

      {/* Modal visor de referencia */}
      {activeRefId && (
        <RefViewerModal
          taskId={task.task.id}
          refId={activeRefId}
          refMeta={activeRefMeta}
          onClose={() => {
            setActiveRefId(null);
            setActiveRefMeta(undefined);
          }}
        />
      )}

      {/* Modal visor de traza de auditoría */}
      {internalTraceOpen && (
        <TraceViewerModal
          taskId={task.task.id}
          taskRequest={task.task.request}
          initialCallId={internalCallId}
          onClose={() => setInternalTraceOpen(false)}
        />
      )}
    </section>
  );
};