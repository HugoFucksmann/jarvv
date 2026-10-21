import { useState, useRef, lazy, Suspense } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { useFocusShortcut } from "./hooks/useFocusShortcut.ts";
import { isTerminalState } from "./core/types.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { PromptInput } from "./components/PromptInput/PromptInput.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { DecisionStream } from "./components/DecisionStream/DecisionStream.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { NewTaskDialog } from "./components/NewTaskDialog/NewTaskDialog.tsx";
import { ErrorBanner } from "./components/Shared/ErrorBanner.tsx";

const SettingsModal = lazy(() =>
  import("./components/SettingsModal/SettingsModal.tsx").then((m) => ({
    default: m.SettingsModal,
  }))
);

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskConfirmOpen, setIsNewTaskConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusShortcut(inputRef);

  const {
    task,
    allTasks,
    mode,
    setMode,
    pendingApproval,
    userQuestion,
    events,
    modelIterations,
    discoveredTools,
    unavailableServers,
    mcpInitStatus,
    error,
    clearError,
    isExecuting,
    runTask,
    cancelTask,
    confirmPlan,
    rejectPlan,
    modifyPlan,
    provideUserAnswer,
    refreshDiscovery,
    clearTaskView,
    selectHistoricalTask,
  } = useJarvis();

  const isWaitingInput = task?.state === "WAITING_INPUT";
  const isTaskActive = Boolean(task && !isTerminalState(task.state));

  // Una sola fuente para la pregunta interactiva: existe solo mientras la tarea espera una respuesta
  const userAnswer =
    isWaitingInput && task?.waitingReason === "user_answer"
      ? { question: userQuestion, onSubmit: provideUserAnswer }
      : null;

  // El input está deshabilitado mientras hay una tarea activa: se enfoca cuando React lo rehabilita
  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    void cancelTask();
  };

  const handleNewTask = () => {
    if (task?.state === "RUNNING") {
      setIsNewTaskConfirmOpen(true);
      return;
    }
    clearTaskView();
    focusInput();
  };

  const handleConfirmCancelAndNewTask = async () => {
    if (task?.id) {
      await cancelTask(task.id);
    }
    clearTaskView();
    setIsNewTaskConfirmOpen(false);
    focusInput();
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      <TopBar
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isExecuting={isExecuting}
        isWaitingInput={isWaitingInput}
        waitingReason={task?.waitingReason}
        mcpCount={Object.keys(discoveredTools).length}
        unavailableCount={Object.keys(unavailableServers).length}
        mcpInitStatus={mcpInitStatus}
        tasks={allTasks}
        activeTaskId={task?.id}
        onSelectTask={selectHistoricalTask}
      />

      {error && <ErrorBanner message={error} onClose={clearError} />}

      <main className="flex-1 flex flex-col overflow-y-auto max-w-5xl w-full mx-auto pb-4">
        <PromptInput
          inputRef={inputRef}
          onRun={runTask}
          onCancel={handleCancel}
          mode={mode}
          isBusy={isTaskActive}
          isExecuting={isExecuting}
          isWaitingInput={isWaitingInput}
        />

        <GuardBanner pending={pendingApproval} userAnswer={userAnswer} />

        <DecisionStream
          events={events}
          modelIterations={modelIterations}
          isExecuting={isExecuting}
          task={task}
        />

        <div className="flex-1">
          <ProcessFlow
            task={task}
            onConfirmPlan={confirmPlan}
            onRejectPlan={rejectPlan}
            onModifyPlan={modifyPlan}
            onCancelTask={handleCancel}
            onNewTask={handleNewTask}
          />
        </div>
      </main>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setIsSettingsOpen(false)} onConfigSaved={refreshDiscovery} />
        </Suspense>
      )}

      {isNewTaskConfirmOpen && (
        <NewTaskDialog
          onConfirm={handleConfirmCancelAndNewTask}
          onDismiss={() => setIsNewTaskConfirmOpen(false)}
        />
      )}
    </div>
  );
}