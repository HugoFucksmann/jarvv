# Mapa del Código Fuente de JARVIS Core

## 1. Árbol de Archivos del Proyecto

├── docs
│   ├── ARCHITECTURE.md
│   ├── CODEBASE_MAP.md
│   ├── CONTEXT_AND_MEMORY.md
│   ├── CORE_FLOW.md
│   ├── Desicion-2.0-Eos.md
│   ├── Desktop CommanderMCP.md
│   ├── free-search-mcp.md
│   ├── INCONSISTENCIAS.md
│   ├── MCP_TOOLS_SNAPSHOT.md
│   ├── TOOLS_AND_SECURITY.md
│   └── WindowsMCP.md
├── src
│   ├── components
│   │   ├── CommandSection
│   │   │   ├── components
│   │   │   │   └── PromptInput.tsx
│   │   │   └── CommandSection.tsx
│   │   ├── ContextInspector
│   │   │   ├── components
│   │   │   │   ├── DiscoveryCatalogView.tsx
│   │   │   │   ├── EvidenceView.tsx
│   │   │   │   ├── MemoryView.tsx
│   │   │   │   ├── ScratchpadView.tsx
│   │   │   │   └── SessionStateView.tsx
│   │   │   └── ContextInspector.tsx
│   │   ├── DecisionStream
│   │   │   ├── components
│   │   │   │   ├── DecisionOneView.tsx
│   │   │   │   ├── DecisionTwoView.tsx
│   │   │   │   ├── DecisionVerificationView.tsx
│   │   │   │   ├── ModelIterationCard.tsx
│   │   │   │   └── StepIterationGroup.tsx
│   │   │   └── DecisionStream.tsx
│   │   ├── GuardBanner
│   │   │   ├── components
│   │   │   │   └── ApprovalAction.tsx
│   │   │   └── GuardBanner.tsx
│   │   ├── ProcessFlow
│   │   │   ├── components
│   │   │   │   ├── FinalResponseView.tsx
│   │   │   │   ├── PlanReview.tsx
│   │   │   │   ├── StepItem.tsx
│   │   │   │   ├── StepTimeline.tsx
│   │   │   │   └── TaskOverview.tsx
│   │   │   └── ProcessFlow.tsx
│   │   ├── SettingsModal
│   │   │   └── SettingsModal.tsx
│   │   ├── Shared
│   │   │   ├── MarkdownRenderer.tsx
│   │   │   └── StatusDot.tsx
│   │   └── TopBar
│   │       ├── components
│   │       │   ├── BrandWordmark.tsx
│   │       │   ├── HistoryMenu.tsx
│   │       │   ├── ModeSelector.tsx
│   │       │   └── SystemStatus.tsx
│   │       └── TopBar.tsx
│   ├── core
│   │   ├── mcp
│   │   │   ├── desktopCommanderMcp.ts
│   │   │   ├── discovery.ts
│   │   │   ├── freeSearchMcp.ts
│   │   │   ├── transport.ts
│   │   │   ├── types.ts
│   │   │   └── windowsMcp.ts
│   │   ├── policy
│   │   │   ├── guard.ts
│   │   │   └── policyRegistry.ts
│   │   ├── processor
│   │   │   ├── refResolver.ts
│   │   │   └── resultProcessor.ts
│   │   ├── reasoner
│   │   │   ├── prompts.ts
│   │   │   └── qwen.ts
│   │   ├── tools
│   │   │   └── manifest.ts
│   │   ├── callExecutor.ts
│   │   ├── config.ts
│   │   ├── context.ts
│   │   ├── core.ts
│   │   ├── decision.ts
│   │   ├── modeEngines.ts
│   │   └── types.ts
│   ├── hooks
│   │   └── useJarvis.ts
│   ├── services
│   │   └── jarvisApi.ts
│   ├── types
│   │   └── debug.ts
│   ├── utils
│   │   ├── apiUrl.ts
│   │   └── debugAccumulator.ts
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .gitignore
├── index.html
├── jarvis-config.json
├── jarvis-tasks.json
├── metadata.json
├── package.json
├── PLAN_IMPLEMENTACION_MIGRACION_V1.3.md
├── readme.md
├── server.ts
├── test-phase4.ts
├── test-phase5.ts
├── test-phase6.ts
├── tsconfig.json
└── vite.config.ts

---

## 2. Mapa de Dependencias por Importaciones

{
  "App.tsx": [
    "components/CommandSection/CommandSection.tsx",
    "components/ContextInspector/ContextInspector.tsx",
    "components/DecisionStream/DecisionStream.tsx",
    "components/GuardBanner/GuardBanner.tsx",
    "components/ProcessFlow/ProcessFlow.tsx",
    "components/SettingsModal/SettingsModal.tsx",
    "components/TopBar/TopBar.tsx",
    "hooks/useJarvis.ts"
  ],
  "components/CommandSection/CommandSection.tsx": [
    "components/CommandSection/components/PromptInput.tsx"
  ],
  "components/CommandSection/components/PromptInput.tsx": [],
  "components/ContextInspector/ContextInspector.tsx": [
    "components/ContextInspector/components/DiscoveryCatalogView.tsx",
    "components/ContextInspector/components/EvidenceView.tsx",
    "components/ContextInspector/components/MemoryView.tsx",
    "components/ContextInspector/components/ScratchpadView.tsx",
    "components/ContextInspector/components/SessionStateView.tsx",
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "components/ContextInspector/components/DiscoveryCatalogView.tsx": [
    "core/mcp/types.ts",
    "core/types.ts",
    "services/jarvisApi.ts"
  ],
  "components/ContextInspector/components/EvidenceView.tsx": [
    "core/types.ts"
  ],
  "components/ContextInspector/components/MemoryView.tsx": [
    "core/types.ts",
    "services/jarvisApi.ts"
  ],
  "components/ContextInspector/components/ScratchpadView.tsx": [
    "core/types.ts"
  ],
  "components/ContextInspector/components/SessionStateView.tsx": [
    "core/types.ts"
  ],
  "components/DecisionStream/DecisionStream.tsx": [
    "components/DecisionStream/components/DecisionOneView.tsx",
    "components/DecisionStream/components/DecisionTwoView.tsx",
    "components/DecisionStream/components/DecisionVerificationView.tsx",
    "components/DecisionStream/components/StepIterationGroup.tsx",
    "core/types.ts",
    "types/debug.ts",
    "utils/debugAccumulator.ts"
  ],
  "components/DecisionStream/components/DecisionOneView.tsx": [
    "core/types.ts"
  ],
  "components/DecisionStream/components/DecisionTwoView.tsx": [
    "core/types.ts"
  ],
  "components/DecisionStream/components/DecisionVerificationView.tsx": [
    "core/types.ts"
  ],
  "components/DecisionStream/components/ModelIterationCard.tsx": [
    "types/debug.ts"
  ],
  "components/DecisionStream/components/StepIterationGroup.tsx": [
    "components/DecisionStream/components/ModelIterationCard.tsx",
    "types/debug.ts"
  ],
  "components/GuardBanner/GuardBanner.tsx": [
    "components/GuardBanner/components/ApprovalAction.tsx",
    "core/types.ts"
  ],
  "components/GuardBanner/components/ApprovalAction.tsx": [
    "core/types.ts"
  ],
  "components/ProcessFlow/ProcessFlow.tsx": [
    "components/ProcessFlow/components/FinalResponseView.tsx",
    "components/ProcessFlow/components/PlanReview.tsx",
    "components/ProcessFlow/components/StepTimeline.tsx",
    "components/ProcessFlow/components/TaskOverview.tsx",
    "core/types.ts"
  ],
  "components/ProcessFlow/components/FinalResponseView.tsx": [
    "components/Shared/MarkdownRenderer.tsx"
  ],
  "components/ProcessFlow/components/PlanReview.tsx": [
    "core/types.ts"
  ],
  "components/ProcessFlow/components/StepItem.tsx": [
    "core/types.ts"
  ],
  "components/ProcessFlow/components/StepTimeline.tsx": [
    "components/ProcessFlow/components/StepItem.tsx",
    "core/types.ts"
  ],
  "components/ProcessFlow/components/TaskOverview.tsx": [
    "components/Shared/StatusDot.tsx",
    "core/types.ts"
  ],
  "components/SettingsModal/SettingsModal.tsx": [
    "core/config.ts",
    "services/jarvisApi.ts"
  ],
  "components/Shared/MarkdownRenderer.tsx": [],
  "components/Shared/StatusDot.tsx": [],
  "components/TopBar/TopBar.tsx": [
    "components/TopBar/components/BrandWordmark.tsx",
    "components/TopBar/components/HistoryMenu.tsx",
    "components/TopBar/components/ModeSelector.tsx",
    "components/TopBar/components/SystemStatus.tsx",
    "core/types.ts"
  ],
  "components/TopBar/components/BrandWordmark.tsx": [],
  "components/TopBar/components/HistoryMenu.tsx": [
    "components/Shared/StatusDot.tsx",
    "core/types.ts"
  ],
  "components/TopBar/components/ModeSelector.tsx": [],
  "components/TopBar/components/SystemStatus.tsx": [
    "components/Shared/StatusDot.tsx"
  ],
  "core/callExecutor.ts": [
    "core/context.ts",
    "core/decision.ts",
    "core/mcp/discovery.ts",
    "core/policy/guard.ts",
    "core/policy/policyRegistry.ts",
    "core/processor/refResolver.ts",
    "core/processor/resultProcessor.ts",
    "core/reasoner/qwen.ts",
    "core/types.ts"
  ],
  "core/config.ts": [],
  "core/context.ts": [
    "core/reasoner/prompts.ts",
    "core/types.ts"
  ],
  "core/core.ts": [
    "core/callExecutor.ts",
    "core/context.ts",
    "core/decision.ts",
    "core/mcp/discovery.ts",
    "core/modeEngines.ts",
    "core/processor/resultProcessor.ts",
    "core/reasoner/qwen.ts",
    "core/types.ts",
    "utils/debugAccumulator.ts"
  ],
  "core/decision.ts": [
    "core/config.ts",
    "core/reasoner/prompts.ts",
    "core/types.ts"
  ],
  "core/mcp/desktopCommanderMcp.ts": [
    "core/config.ts",
    "core/mcp/transport.ts",
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "core/mcp/discovery.ts": [
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "core/mcp/freeSearchMcp.ts": [
    "core/config.ts",
    "core/mcp/transport.ts",
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "core/mcp/transport.ts": [
    "core/config.ts",
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "core/mcp/types.ts": [
    "core/types.ts"
  ],
  "core/mcp/windowsMcp.ts": [
    "core/config.ts",
    "core/mcp/transport.ts",
    "core/mcp/types.ts",
    "core/types.ts"
  ],
  "core/modeEngines.ts": [
    "core/callExecutor.ts",
    "core/context.ts",
    "core/policy/policyRegistry.ts",
    "core/processor/resultProcessor.ts",
    "core/reasoner/qwen.ts",
    "core/types.ts"
  ],
  "core/policy/guard.ts": [
    "core/policy/policyRegistry.ts",
    "core/types.ts"
  ],
  "core/policy/policyRegistry.ts": [
    "core/tools/manifest.ts",
    "core/types.ts"
  ],
  "core/processor/refResolver.ts": [
    "core/processor/resultProcessor.ts"
  ],
  "core/processor/resultProcessor.ts": [
    "core/policy/policyRegistry.ts",
    "core/types.ts"
  ],
  "core/reasoner/prompts.ts": [
    "core/types.ts"
  ],
  "core/reasoner/qwen.ts": [
    "core/config.ts",
    "core/mcp/discovery.ts",
    "core/reasoner/prompts.ts",
    "core/tools/manifest.ts",
    "core/types.ts"
  ],
  "core/tools/manifest.ts": [
    "core/types.ts"
  ],
  "core/types.ts": [
    "types/debug.ts"
  ],
  "hooks/useJarvis.ts": [
    "core/mcp/types.ts",
    "core/types.ts",
    "services/jarvisApi.ts",
    "types/debug.ts",
    "utils/apiUrl.ts",
    "utils/debugAccumulator.ts"
  ],
  "index.css": [],
  "main.tsx": [
    "App.tsx",
    "index.css"
  ],
  "services/jarvisApi.ts": [
    "core/config.ts",
    "core/mcp/types.ts",
    "core/types.ts",
    "utils/apiUrl.ts"
  ],
  "types/debug.ts": [],
  "utils/apiUrl.ts": [],
  "utils/debugAccumulator.ts": [
    "core/types.ts",
    "types/debug.ts"
  ]
}
