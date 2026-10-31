import React, { memo } from "react";
import { isTerminalState } from "../../../../src/core/types.ts";
import type { Step, Task, TaskState } from "../../../../src/core/types.ts";
import { MODELS } from "../../../../src/core/models.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
    steps: Step[];
    currentStepIndex: number;
    taskState?: TaskState;
    mode?: Task["mode"];
}

const StepTimelineBase: React.FC<StepTimelineProps> = ({
    steps,
    currentStepIndex,
    taskState,
    mode,
}) => {
    const isTaskActive = taskState ? !isTerminalState(taskState) : true;

    if (steps.length === 0) {
        // Una tarea terminada sin pasos es una respuesta directa: no hay pipeline que mostrar
        if (!isTaskActive) return null;
        return (
            <div className="py-8 text-center text-xs font-mono text-slate-500">
                {mode === "PLAN"
                    ? `Generando plan estratégico con ${MODELS.QWEN_3_5_9B.short}...`
                    : "Iniciando pipeline y solicitando Decision #1..."}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            {steps.map((step, idx) => (
                <StepItem
                    key={`step-${step.id || "item"}-${step.rev ?? 0}-${idx}`}
                    step={step}
                    index={idx}
                    isCurrent={isTaskActive && idx === currentStepIndex}
                    isLast={idx === steps.length - 1}
                />
            ))}
        </div>
    );
};

export const StepTimeline = memo(StepTimelineBase);