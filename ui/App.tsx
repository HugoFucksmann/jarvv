import { useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { useFocusShortcut } from "./hooks/useFocusShortcut.ts";
import { isTerminalState } from "../src/core/types.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { PromptInput } from "./components/PromptInput/PromptInput.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { DecisionStream } from "./components/DecisionStream/DecisionStream.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { TaskOverview } from "./components/ProcessFlow/components/TaskOverview.tsx";
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
  // Sin actividad de modelos no se reserva la columna lateral.
  const hasActivity = events.length > 0 || modelIterations.length > 0;
  const isTaskActive = Boolean(task && !isTerminalState(task.state));

  // Una sola fuente para la pregunta interactiva: existe solo mientras la tarea espera una respuesta.
  const waitingReason = task?.waitingReason;
  const userAnswer = useMemo(
    () =>
      isWaitingInput && waitingReason === "user_answer"
        ? { question: userQuestion, onSubmit: provideUserAnswer }
        : null,
    [isWaitingInput, waitingReason, userQuestion, provideUserAnswer]
  );

  // El input está deshabilitado mientras hay una tarea activa: se enfoca cuando React lo rehabilita.
  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Estables: los diálogos suscriben listeners (Escape) con estas funciones y no deben re-suscribirse en cada render.
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const dismissNewTask = useCallback(() => setIsNewTaskConfirmOpen(false), []);

  const handleCancel = useCallback(() => {
    void cancelTask();
  }, [cancelTask]);

  const handleNewTask = () => {
    if (task?.state === "RUNNING") {
      setIsNewTaskConfirmOpen(true);
      return;
    }

    clearTaskView();
    focusInput();
  };

  const handleConfirmCancelAndNewTask = async () => {
    // Si el back no confirma la cancelación, la vista no se limpia. El diálogo se cierra para que el motivo
    // (banner de error) quede visible en lugar de quedar tapado por el fondo del modal.
    if (task?.id && !(await cancelTask(task.id))) {
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
        isWaitingInput={isWaitingInput}
        waitingReason={waitingReason}
        mcpCount={Object.keys(discoveredTools).length}
        unavailableCount={Object.keys(unavailableServers).length}
        mcpInitStatus={mcpInitStatus}
        tasks={allTasks}
        activeTaskId={task?.id}
        onSelectTask={selectHistoricalTask}
      />

      {error && <ErrorBanner message={error} onClose={clearError} />}

      <main className="flex-1 overflow-y-auto">
        {/* En pantallas anchas: el trabajo de la tarea a la izquierda y la actividad de los modelos (depuración) fija a la derecha. */}
        <div
          className={`mx-auto w-full px-6 2xl:px-10 pb-6 grid gap-x-8 ${hasActivity
              ? "max-w-[2200px] xl:grid-cols-[minmax(0,1fr)_minmax(28rem,38%)]"
              : "max-w-6xl"
            }`}
        >
          <div className="min-w-0 flex flex-col">
            {/* Cabezal fijo: instrucción, estado de la tarea y lo que pide una acción del usuario siempre a la vista. */}
            <div className="sticky top-0 z-30 flex flex-col gap-2.5 pt-4 pb-3 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/70">
              <PromptInput
                inputRef={inputRef}
                onRun={runTask}
                onCancel={handleCancel}
                mode={mode}
                isBusy={isTaskActive}
                isExecuting={isExecuting}
                isWaitingInput={isWaitingInput}
              />
              {task && <TaskOverview task={task} events={events} onNewTask={handleNewTask} />}
              <GuardBanner pending={pendingApproval} userAnswer={userAnswer} />
            </div>

            <ProcessFlow
              task={task}
              onConfirmPlan={confirmPlan}
              onRejectPlan={rejectPlan}
              onModifyPlan={modifyPlan}
              onCancelTask={handleCancel}
            />
          </div>

          <aside
            aria-label="Actividad de los modelos"
            className="min-w-0 xl:sticky xl:top-0 xl:self-start xl:max-h-[calc(100vh-4.5rem)] xl:border-l xl:border-slate-800/70 xl:pl-6 xl:overflow-y-auto xl:pt-2"
          >
            <DecisionStream
              events={events}
              modelIterations={modelIterations}
              isExecuting={isExecuting}
              task={task}
            />
          </aside>
        </div>
      </main>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={closeSettings}
            onConfigSaved={refreshDiscovery}
          />
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