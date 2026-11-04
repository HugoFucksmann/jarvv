import { useState, useRef, useCallback, lazy, Suspense } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { useFocusShortcut } from "./hooks/useFocusShortcut.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { PromptInput } from "./components/PromptInput/PromptInput.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { TaskOverview } from "./components/ProcessFlow/components/TaskOverview.tsx";
import { NewTaskDialog } from "./components/NewTaskDialog/NewTaskDialog.tsx";
import { ErrorBanner } from "./components/Shared/ErrorBanner.tsx";

const SettingsModal = lazy(() =>
  import("./components/SettingsModal/SettingsModal.tsx").then((m) => ({
    default: m.SettingsModal,
  }))
);

function isTerminalState(state?: string): boolean {
  return (
    state === "completed" ||
    state === "partial" ||
    state === "failed" ||
    state === "cancelled"
  );
}

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
    waiting,
    waitingKind,
    isWaiting,
    isExecuting,
    discoveredTools,
    unavailableServers,
    mcpInitStatus,
    error,
    clearError,
    runTask,
    cancelTask,
    confirmPlan,
    rejectPlan,
    modifyPlan,
    provideUserAnswer,
    approvePending,
    denyPending,
    refreshDiscovery,
    clearTaskView,
    selectHistoricalTask,
  } = useJarvis();

  const isTaskActive = Boolean(task && !isTerminalState(task.task.state));

  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const dismissNewTask = useCallback(() => setIsNewTaskConfirmOpen(false), []);

  const handleCancel = useCallback(() => {
    void cancelTask();
  }, [cancelTask]);

  const handleNewTask = () => {
    if (task?.task.state === "running") {
      setIsNewTaskConfirmOpen(true);
      return;
    }

    clearTaskView();
    focusInput();
  };

  const handleConfirmCancelAndNewTask = async () => {
    if (task?.task.id && !(await cancelTask(task.task.id))) {
      setIsNewTaskConfirmOpen(false);
      return;
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
        onOpenSettings={openSettings}
        isExecuting={isExecuting}
        isWaitingInput={isWaiting}
        waitingReason={waitingKind}
        mcpCount={Object.keys(discoveredTools).length}
        unavailableCount={Object.keys(unavailableServers).length}
        mcpInitStatus={mcpInitStatus}
        tasks={allTasks}
        activeTaskId={task?.task.id}
        onSelectTask={selectHistoricalTask}
      />

      {error && <ErrorBanner message={error} onClose={clearError} />}

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 2xl:px-10 pb-6 flex flex-col">
          {/* Cabezal fijo: instrucción, estado de la tarea y acciones de autorización */}
          <div className="sticky top-0 z-30 flex flex-col gap-2.5 pt-4 pb-3 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/70">
            <PromptInput
              inputRef={inputRef}
              onRun={runTask}
              onCancel={handleCancel}
              mode={mode}
              isBusy={isTaskActive}
              isExecuting={isExecuting}
              isWaitingInput={isWaiting}
            />
            {task && <TaskOverview task={task} onNewTask={handleNewTask} />}
            <GuardBanner
              waiting={waiting}
              onApprove={approvePending}
              onDeny={denyPending}
              onAnswer={provideUserAnswer}
            />
          </div>

          <ProcessFlow
            task={task}
            onConfirmPlan={confirmPlan}
            onRejectPlan={rejectPlan}
            onModifyPlan={modifyPlan}
            onCancelTask={handleCancel}
          />
        </div>
      </main>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={closeSettings} onConfigSaved={refreshDiscovery} />
        </Suspense>
      )}

      {isNewTaskConfirmOpen && (
        <NewTaskDialog
          onConfirm={handleConfirmCancelAndNewTask}
          onDismiss={dismissNewTask}
        />
      )}
    </div>
  );
}
