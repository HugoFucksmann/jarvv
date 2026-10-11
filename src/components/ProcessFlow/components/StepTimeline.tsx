import React from "react";
import { Step } from "../../../core/types.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
  steps: Step[];
  currentStepIndex: number;
}

export const StepTimeline: React.FC<StepTimelineProps> = ({ steps, currentStepIndex }) => {
  if (steps.length === 0) {
    return (
      <div className="py-8 text-center text-xs font-mono text-slate-500">
        Iniciando pipeline y solicitando Decision #1...
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-slate-800/60">
      {steps.map((step, idx) => (
        <StepItem
          key={`step-${step.id || "item"}-${step.rev ?? 0}-${idx}`}
          step={step}
          index={idx}
          isCurrent={idx === currentStepIndex}
        />
      ))}
    </div>
  );
};
