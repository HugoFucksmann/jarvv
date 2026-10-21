import React from "react";
import { PromptInput } from "../PromptInput/PromptInput.tsx";

interface CommandSectionProps {
  onRun: (prompt: string, mode?: "NORMAL" | "PLAN") => void;
  onCancel: () => void;
  isExecuting: boolean;
  isWaitingInput?: boolean;
  isTaskActive?: boolean;
  mode: "NORMAL" | "PLAN";
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const CommandSection: React.FC<CommandSectionProps> = ({
  onRun,
  onCancel,
  isExecuting,
  isWaitingInput,
  isTaskActive,
  mode,
  inputRef,
}) => {
  return (
    <section className="flex flex-col gap-2.5 px-6 pt-5 pb-3">
      <PromptInput
        inputRef={inputRef}
        onRun={(p) => onRun(p, mode)}
        onCancel={onCancel}
        isExecuting={isExecuting}
        isWaitingInput={isWaitingInput ?? false}
        isTaskActive={isTaskActive}
        mode={mode}
      />
    </section>
  );
};
