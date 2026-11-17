import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { ArrowDown } from "lucide-react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { useFocusShortcut } from "./hooks/useFocusShortcut.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { PromptInput } from "./components/PromptInput/PromptInput.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { TaskOverview } from "./components/ProcessFlow/components/TaskOverview.tsx";
import { NewTaskDialog } from "./components/NewTaskDialog/NewTaskDialog.tsx";
import { ErrorBanner } from "./components/Shared/ErrorBanner.tsx";
import { EnvironmentModal } from "./components/TopBar/components/EnvironmentModal.tsx";
import { TraceViewerModal } from "./components/ProcessFlow/components/TraceViewerModal.tsx";

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
  const [isEnvironmentOpen, setIsEnvironmentOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isNewTaskConfirmOpen, setIsNewTaskConfirmOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useFocusShortcut(inputRef);

  const {
    task,
    allTasks,
    mode,
    setMode,
    waiting,
    waitingKind,
    isWaiting,
    paused,
    isPaused,
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
    refreshConfig,
    environment,
    limits,
    autoMode,
    voiceEnabled,
    speechStatus,
    speak,
    stopSpeech,
    clearTaskView,
    selectHistoricalTask,
  } = useJarvis();

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTaskActive = Boolean(task && !isTerminalState(task.task.state));
  const availableTaskIds = useMemo(() => new Set(allTasks.map((t) => t.id)), [allTasks]);

  useEffect(() => () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
  }, []);

  const currentTaskId = task?.task.id ?? null;
  useEffect(() => {
    setShowScrollBottom(false);
  }, [currentTaskId]);

  const focusInput = () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const openEnvironment = useCallback(() => setIsEnvironmentOpen(true), []);
  const closeEnvironment = useCallback(() => setIsEnvironmentOpen(false), []);
  const [traceCallId, setTraceCallId] = useState<string | null>(null);
  const openTrace = useCallback(() => {
    setTraceCallId(null);
    setIsTraceOpen(true);
  }, []);
  const openCallTrace = useCallback((callId: string) => {
    setTraceCallId(callId);
    setIsTraceOpen(true);
  }, []);
  const closeTrace = useCallback(() => setIsTraceOpen(false), []);
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
        isPaused={isPaused}
        pausedModel={paused?.model ?? null}
        mcpCount={Object.keys(discoveredTools).length}
        unavailableCount={Object.keys(unavailableServers).length}
        mcpInitStatus={mcpInitStatus}
        unavailableServers={unavailableServers}
        autoMode={autoMode}
        onOpenEnvironment={openEnvironment}
        tasks={allTasks}
        activeTaskId={task?.task.id}
        onSelectTask={selectHistoricalTask}
      />

      {error && <ErrorBanner message={error} onClose={clearError} />}

      <main
        ref={mainRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollBottom(distance > 240);
        }}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-5xl px-6 2xl:px-10 pb-12 flex flex-col">
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
              isPaused={isPaused}
            />
            {task && (
              <TaskOverview
                task={task}
                limits={limits}
                onNewTask={handleNewTask}
                onOpenTrace={openTrace}
              />
            )}
            {waiting && waiting.kind !== "plan" && (
              <div className="max-h-[45vh] overflow-y-auto">
                <GuardBanner
                  waiting={waiting}
                  onApprove={approvePending}
                  onApproveAlways={() => approvePending(undefined, undefined, true)}
                  onDeny={denyPending}
                  onAnswer={provideUserAnswer}
                />
              </div>
            )}
          </div>

          <ProcessFlow
            task={task}
            recentTasks={allTasks}
            availableTaskIds={availableTaskIds}
            onSelectTask={selectHistoricalTask}
            onConfirmPlan={confirmPlan}
            onRejectPlan={rejectPlan}
            onModifyPlan={modifyPlan}
            onCancelTask={handleCancel}
            onOpenTrace={openTrace}
            onOpenCallTrace={openCallTrace}
            onSpeak={voiceEnabled ? speak : undefined}
            onStopSpeech={voiceEnabled ? stopSpeech : undefined}
            speechStatus={speechStatus}
          />
        </div>

        {task && showScrollBottom && (
          <div className="sticky bottom-4 z-20 flex justify-end px-6 2xl:px-10 pointer-events-none">
            <button
              type="button"
              onClick={() => mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: "smooth" })}
              title="Bajar al final"
              aria-label="Bajar al final"
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/95 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-lg text-xs cursor-pointer transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5 text-accent-400" />
              <span>Bajar</span>
            </button>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={closeSettings}
            onConfigSaved={() => {
              void refreshDiscovery();
              void refreshConfig();
            }}
            onOpenEnvironment={() => {
              closeSettings();
              openEnvironment();
            }}
          />
        </Suspense>
      )}

      {isEnvironmentOpen && (
        <EnvironmentModal
          environment={environment}
          limits={limits}
          onClose={closeEnvironment}
        />
      )}

      {isTraceOpen && task && (
        <TraceViewerModal
          taskId={task.task.id}
          taskRequest={task.task.request}
          initialCallId={traceCallId}
          onClose={closeTrace}
        />
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
