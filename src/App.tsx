/**
 * JARVIS Core v2.2 — Main Application Entry View
 * Composes modular sections with clean hierarchy, zero-pill discipline,
 * and high-fidelity UX focused on deterministic process and workflow.
 */

import { useState, lazy, Suspense } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { CommandSection } from "./components/CommandSection/CommandSection.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { DecisionStream } from "./components/DecisionStream/DecisionStream.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { ContextInspector } from "./components/ContextInspector/ContextInspector.tsx";
import { AlertCircle, X } from "lucide-react";

// Code-splitting heavy modal to optimize initial bundle size (PERF-01)
const SettingsModal = lazy(() =>
  import("./components/SettingsModal/SettingsModal.tsx").then((m) => ({
    default: m.SettingsModal,
  }))
);

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const {
    task,
    mode,
    setMode,
    pendingApproval,
    events,
    discoveredTools,
    extraCapabilities,
    unavailableServers,
    error,
    clearError,
    isExecuting,
    runTask,
    cancelTask,
    confirmPlan,
    approvePending,
    denyPending,
    refreshDiscovery,
  } = useJarvis();

  const mcpServerCount = Object.keys(discoveredTools).length;
  const unavailableCount = Object.keys(unavailableServers).length;

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. Header — Top Bar Contract */}
      <TopBar
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isExecuting={isExecuting}
        mcpCount={mcpServerCount}
        unavailableCount={unavailableCount}
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
        {/* 2. Command Section — Input & Presets */}
        <CommandSection
          onRun={runTask}
          onCancel={cancelTask}
          isExecuting={isExecuting}
          mode={mode}
        />

        {/* 3. Guard Banner — Displayed only when APPROVAL gate triggers */}
        <GuardBanner
          pending={pendingApproval}
          onApprove={approvePending}
          onDeny={denyPending}
        />

        {/* 4. Decision Stream — Live Decision #1, #2 & Operational Event Trace */}
        <DecisionStream events={events} />

        {/* 5. Process Flow — Plan review, step timeline, verification, final output */}
        <div className="flex-1">
          <ProcessFlow
            task={task}
            onConfirmPlan={confirmPlan}
            onCancelTask={cancelTask}
          />
        </div>
      </main>

      {/* 6. Context Inspector — Scratchpad, Evidence, Memoria & Discovered Tools */}
      <ContextInspector
        scratchpad={task?.scratchpad || {}}
        steps={task?.steps || []}
        memory={task?.memory}
        discoveredTools={discoveredTools}
        extraCapabilities={extraCapabilities}
        unavailableServers={unavailableServers}
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
    </div>
  );
}
