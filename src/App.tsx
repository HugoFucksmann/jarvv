/**
 * JARVIS Core v1.0 — Main Application Entry View
 * Composes modular sections with clean hierarchy, zero-pill discipline,
 * and high-fidelity UX focused on process and workflow.
 */

import { useState } from "react";
import { useJarvis } from "./hooks/useJarvis.ts";
import { TopBar } from "./components/TopBar/TopBar.tsx";
import { CommandSection } from "./components/CommandSection/CommandSection.tsx";
import { GuardBanner } from "./components/GuardBanner/GuardBanner.tsx";
import { DecisionStream } from "./components/DecisionStream/DecisionStream.tsx";
import { ProcessFlow } from "./components/ProcessFlow/ProcessFlow.tsx";
import { ContextInspector } from "./components/ContextInspector/ContextInspector.tsx";
import { SettingsModal } from "./components/SettingsModal/SettingsModal.tsx";

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
    isExecuting,
    runTask,
    cancelTask,
    confirmPlan,
    approvePending,
    denyPending,
    refreshDiscovery,
  } = useJarvis();

  const mcpServerCount = Object.keys(discoveredTools).length;

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. Header — Top Bar Contract */}
      <TopBar
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isExecuting={isExecuting}
        mcpCount={mcpServerCount}
      />

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

        {/* 4. Decision Stream — Live Decision #1 and #2 (Kai-0.6B) */}
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
      />

      {/* 7. Settings Modal for configuring Qwen 3.5 9B, Decision 2.0 and MCP URLs */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onConfigSaved={refreshDiscovery}
      />
    </div>
  );
}
