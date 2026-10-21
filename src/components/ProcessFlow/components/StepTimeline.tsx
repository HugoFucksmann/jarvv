import React from "react";
import { isTerminalState } from "../../../core/types.ts";
import type { Step, Task, TaskState } from "../../../core/types.ts";
import { StepItem } from "./StepItem.tsx";

interface StepTimelineProps {
    steps: Step[];
    currentStepIndex: number;
    taskState?: TaskState;
    mode?: Task["mode"];
}

export const StepTimeline: React.FC<StepTimelineProps> = ({
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
                    ? "Generando plan estratégico con Qwen..."
                    : "Iniciando pipeline y solicitando Decision #1..."}
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
                    isCurrent={isTaskActive && idx === currentStepIndex}
                />
            ))}
        </div>
    );
};
