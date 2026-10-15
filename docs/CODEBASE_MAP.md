# Mapa del Código Fuente de JARVIS Core

## 1. Árbol de Archivos del Proyecto

|-- docs
|   |-- ARCHITECTURE.md
|   |-- CODEBASE_MAP.md
|   |-- CONTEXT_AND_MEMORY.md
|   |-- CORE_FLOW.md
|   |-- Desicion-2.0-Eos.md
|   |-- Desktop CommanderMCP.md
|   |-- free-search-mcp.md
|   |-- INCONSISTENCIAS.md
|   |-- MCP_TOOLS_SNAPSHOT.md
|   |-- TOOLS_AND_SECURITY.md
|   \-- WindowsMCP.md
|-- src
|   |-- components
|   |   |-- CommandSection
|   |   |   |-- components
|   |   |   |   \-- PromptInput.tsx
|   |   |   \-- CommandSection.tsx
|   |   |-- ContextInspector
|   |   |   |-- components
|   |   |   |   |-- DiscoveryCatalogView.tsx
|   |   |   |   |-- EvidenceView.tsx
|   |   |   |   |-- MemoryView.tsx
|   |   |   |   |-- ScratchpadView.tsx
|   |   |   |   \-- SessionStateView.tsx
|   |   |   \-- ContextInspector.tsx
|   |   |-- DecisionStream
|   |   |   |-- components
|   |   |   |   |-- DecisionOneView.tsx
|   |   |   |   |-- DecisionTwoView.tsx
|   |   |   |   |-- DecisionVerificationView.tsx
|   |   |   |   |-- ModelIterationCard.tsx
|   |   |   |   \-- StepIterationGroup.tsx
|   |   |   \-- DecisionStream.tsx
|   |   |-- GuardBanner
|   |   |   |-- components
|   |   |   |   \-- ApprovalAction.tsx
|   |   |   \-- GuardBanner.tsx
|   |   |-- ProcessFlow
|   |   |   |-- components
|   |   |   |   |-- FinalResponseView.tsx
|   |   |   |   |-- PlanReview.tsx
|   |   |   |   |-- StepItem.tsx
|   |   |   |   |-- StepTimeline.tsx
|   |   |   |   \-- TaskOverview.tsx
|   |   |   \-- ProcessFlow.tsx
|   |   |-- SettingsModal
|   |   |   \-- SettingsModal.tsx
|   |   |-- Shared
|   |   |   |-- MarkdownRenderer.tsx
|   |   |   \-- StatusDot.tsx
|   |   \-- TopBar
|   |       |-- components
|   |       |   |-- BrandWordmark.tsx
|   |       |   |-- HistoryMenu.tsx
|   |       |   |-- ModeSelector.tsx
|   |       |   \-- SystemStatus.tsx
|   |       \-- TopBar.tsx
|   |-- core
|   |   |-- mcp
|   |   |   |-- desktopCommanderMcp.ts
|   |   |   |-- discovery.ts
|   |   |   |-- freeSearchMcp.ts
|   |   |   |-- transport.ts
|   |   |   |-- types.ts
|   |   |   \-- windowsMcp.ts
|   |   |-- policy
|   |   |   |-- guard.ts
|   |   |   \-- policyRegistry.ts
|   |   |-- processor
|   |   |   |-- refResolver.ts
|   |   |   \-- resultProcessor.ts
|   |   |-- reasoner
|   |   |   |-- prompts.ts
|   |   |   \-- qwen.ts
|   |   |-- tools
|   |   |   \-- manifest.ts
|   |   |-- callExecutor.ts
|   |   |-- config.ts
|   |   |-- context.ts
|   |   |-- core.ts
|   |   |-- decision.ts
|   |   |-- llmTransport.ts
|   |   |-- modeEngines.ts
|   |   \-- types.ts
|   |-- hooks
|   |   \-- useJarvis.ts
|   |-- services
|   |   \-- jarvisApi.ts
|   |-- types
|   |   \-- debug.ts
|   |-- utils
|   |   |-- apiUrl.ts
|   |   \-- debugAccumulator.ts
|   |-- App.tsx
|   |-- index.css
|   \-- main.tsx
|-- .gitignore
|-- index.html
|-- jarvis-config.json
|-- jarvis-tasks.json
|-- metadata.json
|-- package.json
|-- readme.md
|-- server.ts
|-- tsconfig.json
\-- vite.config.ts

---

## 2. Mapa de Dependencias por Importaciones

{
  "server.ts": [
    "src/core/config.ts",
    "src/core/core.ts",
    "src/core/decision.ts",
    "src/core/mcp/desktopCommanderMcp.ts",
    "src/core/mcp/discovery.ts",
    "src/core/mcp/freeSearchMcp.ts",
    "src/core/mcp/types.ts",
    "src/core/mcp/windowsMcp.ts",
    "src/core/processor/resultProcessor.ts",
    "src/core/reasoner/qwen.ts",
    "src/core/types.ts"
  ],
  "src/App.tsx": [
    "src/components/CommandSection/CommandSection.tsx",
    "src/components/ContextInspector/ContextInspector.tsx",
    "src/components/DecisionStream/DecisionStream.tsx",
    "src/components/GuardBanner/GuardBanner.tsx",
    "src/components/ProcessFlow/ProcessFlow.tsx",
    "src/components/SettingsModal/SettingsModal.tsx",
    "src/components/TopBar/TopBar.tsx",
    "src/hooks/useJarvis.ts"
  ],
  "src/components/CommandSection/CommandSection.tsx": [
    "src/components/CommandSection/components/PromptInput.tsx"
  ],
  "src/components/CommandSection/components/PromptInput.tsx": [],
  "src/components/ContextInspector/ContextInspector.tsx": [
    "src/components/ContextInspector/components/DiscoveryCatalogView.tsx",
    "src/components/ContextInspector/components/EvidenceView.tsx",
    "src/components/ContextInspector/components/MemoryView.tsx",
    "src/components/ContextInspector/components/ScratchpadView.tsx",
    "src/components/ContextInspector/components/SessionStateView.tsx",
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/components/ContextInspector/components/DiscoveryCatalogView.tsx": [
    "src/core/mcp/types.ts",
    "src/core/types.ts",
    "src/services/jarvisApi.ts"
  ],
  "src/components/ContextInspector/components/EvidenceView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/ContextInspector/components/MemoryView.tsx": [
    "src/core/types.ts",
    "src/services/jarvisApi.ts"
  ],
  "src/components/ContextInspector/components/ScratchpadView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/ContextInspector/components/SessionStateView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/DecisionStream/DecisionStream.tsx": [
    "src/components/DecisionStream/components/DecisionOneView.tsx",
    "src/components/DecisionStream/components/DecisionTwoView.tsx",
    "src/components/DecisionStream/components/DecisionVerificationView.tsx",
    "src/components/DecisionStream/components/StepIterationGroup.tsx",
    "src/core/types.ts",
    "src/types/debug.ts",
    "src/utils/debugAccumulator.ts"
  ],
  "src/components/DecisionStream/components/DecisionOneView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/DecisionStream/components/DecisionTwoView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/DecisionStream/components/DecisionVerificationView.tsx": [
    "src/core/types.ts"
  ],
  "src/components/DecisionStream/components/ModelIterationCard.tsx": [
    "src/types/debug.ts"
  ],
  "src/components/DecisionStream/components/StepIterationGroup.tsx": [
    "src/components/DecisionStream/components/ModelIterationCard.tsx",
    "src/types/debug.ts"
  ],
  "src/components/GuardBanner/GuardBanner.tsx": [
    "src/components/GuardBanner/components/ApprovalAction.tsx",
    "src/core/types.ts"
  ],
  "src/components/GuardBanner/components/ApprovalAction.tsx": [
    "src/core/types.ts"
  ],
  "src/components/ProcessFlow/ProcessFlow.tsx": [
    "src/components/ProcessFlow/components/FinalResponseView.tsx",
    "src/components/ProcessFlow/components/PlanReview.tsx",
    "src/components/ProcessFlow/components/StepTimeline.tsx",
    "src/components/ProcessFlow/components/TaskOverview.tsx",
    "src/core/types.ts"
  ],
  "src/components/ProcessFlow/components/FinalResponseView.tsx": [
    "src/components/Shared/MarkdownRenderer.tsx"
  ],
  "src/components/ProcessFlow/components/PlanReview.tsx": [
    "src/core/types.ts"
  ],
  "src/components/ProcessFlow/components/StepItem.tsx": [
    "src/core/types.ts"
  ],
  "src/components/ProcessFlow/components/StepTimeline.tsx": [
    "src/components/ProcessFlow/components/StepItem.tsx",
    "src/core/types.ts"
  ],
  "src/components/ProcessFlow/components/TaskOverview.tsx": [
    "src/components/Shared/StatusDot.tsx",
    "src/core/types.ts"
  ],
  "src/components/SettingsModal/SettingsModal.tsx": [
    "src/core/config.ts",
    "src/services/jarvisApi.ts"
  ],
  "src/components/Shared/MarkdownRenderer.tsx": [],
  "src/components/Shared/StatusDot.tsx": [],
  "src/components/TopBar/TopBar.tsx": [
    "src/components/TopBar/components/BrandWordmark.tsx",
    "src/components/TopBar/components/HistoryMenu.tsx",
    "src/components/TopBar/components/ModeSelector.tsx",
    "src/components/TopBar/components/SystemStatus.tsx",
    "src/core/types.ts"
  ],
  "src/components/TopBar/components/BrandWordmark.tsx": [],
  "src/components/TopBar/components/HistoryMenu.tsx": [
    "src/components/Shared/StatusDot.tsx",
    "src/core/types.ts"
  ],
  "src/components/TopBar/components/ModeSelector.tsx": [],
  "src/components/TopBar/components/SystemStatus.tsx": [
    "src/components/Shared/StatusDot.tsx"
  ],
  "src/core/callExecutor.ts": [
    "src/core/context.ts",
    "src/core/decision.ts",
    "src/core/llmTransport.ts",
    "src/core/mcp/discovery.ts",
    "src/core/policy/guard.ts",
    "src/core/processor/refResolver.ts",
    "src/core/processor/resultProcessor.ts",
    "src/core/reasoner/qwen.ts",
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/config.ts": [],
  "src/core/context.ts": [
    "src/core/reasoner/prompts.ts",
    "src/core/types.ts"
  ],
  "src/core/core.ts": [
    "src/core/callExecutor.ts",
    "src/core/context.ts",
    "src/core/decision.ts",
    "src/core/llmTransport.ts",
    "src/core/mcp/discovery.ts",
    "src/core/modeEngines.ts",
    "src/core/processor/resultProcessor.ts",
    "src/core/reasoner/qwen.ts",
    "src/core/types.ts",
    "src/utils/debugAccumulator.ts"
  ],
  "src/core/decision.ts": [
    "src/core/config.ts",
    "src/core/llmTransport.ts",
    "src/core/reasoner/prompts.ts",
    "src/core/types.ts"
  ],
  "src/core/llmTransport.ts": [
    "src/core/types.ts"
  ],
  "src/core/mcp/desktopCommanderMcp.ts": [
    "src/core/config.ts",
    "src/core/mcp/transport.ts",
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/core/mcp/discovery.ts": [
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/core/mcp/freeSearchMcp.ts": [
    "src/core/config.ts",
    "src/core/mcp/transport.ts",
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/core/mcp/transport.ts": [
    "src/core/config.ts",
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/core/mcp/types.ts": [
    "src/core/types.ts"
  ],
  "src/core/mcp/windowsMcp.ts": [
    "src/core/config.ts",
    "src/core/mcp/transport.ts",
    "src/core/mcp/types.ts",
    "src/core/types.ts"
  ],
  "src/core/modeEngines.ts": [
    "src/core/callExecutor.ts",
    "src/core/context.ts",
    "src/core/llmTransport.ts",
    "src/core/processor/resultProcessor.ts",
    "src/core/types.ts"
  ],
  "src/core/policy/guard.ts": [
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/policy/policyRegistry.ts": [
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/processor/refResolver.ts": [
    "src/core/processor/resultProcessor.ts"
  ],
  "src/core/processor/resultProcessor.ts": [
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/reasoner/prompts.ts": [
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/reasoner/qwen.ts": [
    "src/core/config.ts",
    "src/core/llmTransport.ts",
    "src/core/processor/refResolver.ts",
    "src/core/reasoner/prompts.ts",
    "src/core/tools/manifest.ts",
    "src/core/types.ts"
  ],
  "src/core/tools/manifest.ts": [
    "src/core/types.ts"
  ],
  "src/core/types.ts": [
    "src/types/debug.ts"
  ],
  "src/hooks/useJarvis.ts": [
    "src/core/mcp/types.ts",
    "src/core/types.ts",
    "src/services/jarvisApi.ts",
    "src/types/debug.ts",
    "src/utils/apiUrl.ts",
    "src/utils/debugAccumulator.ts"
  ],
  "src/index.css": [],
  "src/main.tsx": [
    "src/App.tsx",
    "src/index.css"
  ],
  "src/services/jarvisApi.ts": [
    "src/core/config.ts",
    "src/core/mcp/types.ts",
    "src/core/types.ts",
    "src/utils/apiUrl.ts"
  ],
  "src/types/debug.ts": [],
  "src/utils/apiUrl.ts": [],
  "src/utils/debugAccumulator.ts": [
    "src/core/types.ts",
    "src/types/debug.ts"
  ],
  "vite.config.ts": []
}

