import React from "react";
import { PromptInput } from "./components/PromptInput.tsx";
import { PresetScenarios } from "./components/PresetScenarios.tsx";

interface CommandSectionProps {
  onRun: (prompt: string, mode?: "NORMAL" | "PLAN") => void;
  onCancel: () => void;
  isExecuting: boolean;
  mode: "NORMAL" | "PLAN";
}

export const CommandSection: React.FC<CommandSectionProps> = ({
  onRun,
  onCancel,
  isExecuting,
  mode,
}) => {
  return (
    <section className="flex flex-col gap-2.5 px-6 pt-5 pb-3">
      <PromptInput
        onRun={(p) => onRun(p, mode)}
        onCancel={onCancel}
        isExecuting={isExecuting}
        mode={mode}
      />
      <PresetScenarios onSelect={onRun} disabled={isExecuting} />
    </section>
  );
};
