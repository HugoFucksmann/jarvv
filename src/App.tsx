

import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { isTerminalState } from "./core/types.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { CommandSection } from "./components/CommandSection/CommandSection.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { DecisionStream } from "./components/DecisionStream/DecisionStream.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { ContextInspector } from "./components/ContextInspector/ContextInspector.tsx";
import { AlertCircle, X, Loader2 } from "lucide-react";

// Code-splitting heavy modal to optimize initial bundle size (PERF-01)
const SettingsModal = lazy(() =>
  import("./components/SettingsModal/SettingsModal.tsx").then((m) => ({
    default: m.SettingsModal,
  }))
);

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    extraCapabilities,
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
    approvePending,
    denyPending,
    refreshDiscovery,
    clearTaskView,
    selectHistoricalTask,
  } = useJarvis();

  const isWaitingInput = task?.state === "WAITING_INPUT";
  const isTaskActive = Boolean(task && !isTerminalState(task.state));

  const [isNewTaskConfirmOpen, setIsNewTaskConfirmOpen] = useState(false);
  const [isCancellingForNew, setIsCancellingForNew] = useState(false);

  // Atajo global Ctrl+K / Cmd+K para enfocar el input de instrucción
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleNewTask = () => {
    // Si la tarea está en ejecución activa en el backend, pedir confirmación explícita
    if (task && task.state === "RUNNING") {
      setIsNewTaskConfirmOpen(true);
      return;
    }

    // Si no está en ejecución, limpiar la vista directamente y enfocar el input
    clearTaskView();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleConfirmCancelAndNewTask = async () => {
    setIsCancellingForNew(true);
    try {
      if (task?.id) {
        await cancelTask(task.id);
      }
      clearTaskView();
      setIsNewTaskConfirmOpen(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } finally {
      setIsCancellingForNew(false);
    }
  };

  const handleDismissNewTaskConfirm = () => {
    if (isCancellingForNew) return;
    setIsNewTaskConfirmOpen(false);
  };

  const mcpServerCount = Object.keys(discoveredTools).length;
  const unavailableCount = Object.keys(unavailableServers).length;

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. Header — Top Bar Contract with Session History (P3-02) */}
      <TopBar
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isExecuting={isExecuting}
        isWaitingInput={isWaitingInput}
        waitingReason={task?.waitingReason}
        mcpCount={mcpServerCount}
        unavailableCount={unavailableCount}
        mcpInitStatus={mcpInitStatus}
        tasks={allTasks}
        activeTaskId={task?.id}
        onSelectTask={selectHistoricalTask}
      />

      {/* Error Banner (INT-05) */}
      {error && (
        <div className="mx-6 mt-3 p-3 bg-rose-950/70 border border-rose-900 rounded-lg text-rose-200 text-xs flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-mono">{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            aria-label="Cerrar notificación de error"
            className="text-rose-400 hover:text-rose-200 cursor-pointer p-0.5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main scrollable body */}
      <main className="flex-1 flex flex-col overflow-y-auto max-w-5xl w-full mx-auto pb-4">
        {/* 2. Command Section — Input with Ref & ⌘K shortcut */}
        <CommandSection
          inputRef={inputRef}
          onRun={runTask}
          onCancel={() => {
            void cancelTask();
          }}
          isExecuting={isExecuting}
          isWaitingInput={isWaitingInput}
          isTaskActive={isTaskActive}
          mode={mode}
        />

        {/* 3. Guard Banner — Sticky high-visibility authorization gate */}
        <GuardBanner
          pending={pendingApproval}
          onApprove={approvePending}
          onDeny={denyPending}
          isWaitingUserAnswer={task?.state === "WAITING_INPUT" && task?.waitingReason === "user_answer"}
          userQuestion={userQuestion}
          onProvideUserAnswer={provideUserAnswer}
        />

        {/* 4. Decision Stream — Live Decision #1, #2 & Model Iterations by Step with Progressive Disclosure */}
        <DecisionStream
          events={events}
          modelIterations={modelIterations}
          isExecuting={isExecuting}
          task={task}
        />

        {/* 5. Process Flow — Plan review, step timeline, verification, final output, new query action */}
        <div className="flex-1">
          <ProcessFlow
            task={task}
            onConfirmPlan={confirmPlan}
            onRejectPlan={rejectPlan}
            onModifyPlan={modifyPlan}
            onCancelTask={() => {
              cancelTask();
            }}
            onNewTask={handleNewTask}
          />
        </div>
      </main>

      {/* 6. Context Inspector — Estado Vivo, Scratchpad, Evidence, Memoria & Discovered Tools with compact indicators */}
      <ContextInspector
        task={task}
        scratchpad={task?.scratchpad || {}}
        steps={task?.steps || []}
        memory={task?.memory}
        taskId={task?.id}
        discoveredTools={discoveredTools}
        extraCapabilities={extraCapabilities}
        unavailableServers={unavailableServers}
        mcpInitStatus={mcpInitStatus}
        onRefreshDiscovery={refreshDiscovery}
      />

      {/* 7. Settings Modal for configuring Qwen 3.5 9B, Decision 2.0 and MCP URLs (Lazy-loaded) */}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onConfigSaved={refreshDiscovery}
          />
        </Suspense>
      )}

      {/* 8. Modal de confirmación para cancelar tarea en ejecución al pulsar 'Nueva Tarea' (H-09) */}
      {isNewTaskConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-task-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 text-slate-100 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-900/60 text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 id="new-task-dialog-title" className="text-sm font-semibold text-slate-100">
                  Tarea en ejecución activa
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Hay una tarea actualmente procesando llamadas y modelos en el servidor backend. Para iniciar una nueva tarea limpia, es necesario cancelar la ejecución en curso.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                disabled={isCancellingForNew}
                onClick={handleDismissNewTaskConfirm}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={isCancellingForNew}
                onClick={handleConfirmCancelAndNewTask}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isCancellingForNew ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Cancelando...</span>
                  </>
                ) : (
                  <span>Cancelar tarea y empezar otra</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
