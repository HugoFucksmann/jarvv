├── jarvis-refs
│   ├── task_1792362800032_h2si.json
│   ├── task_1792362860467_3azc.json
│   └── task_1792365996722_li2v.json
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
│   │   │   └── guard.ts
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
│   │   ├── environment.ts
│   │   ├── llmTransport.ts
│   │   ├── modeEngines.ts
│   │   ├── persistence.ts
│   │   ├── taskWire.ts
│   │   └── types.ts
│   ├── hooks
│   │   └── useJarvis.ts
│   ├── services
│   │   └── jarvisApi.ts
│   ├── types
│   │   └── debug.ts
│   ├── utils
│   │   ├── apiUrl.ts
│   │   ├── debugAccumulator.ts
│   │   └── routeLabels.ts
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .gitignore
├── dependencias.txt
├── index.html
├── jarvis-config.json
├── jarvis-tasks.json
├── jarvis-tasks.json.bak
├── metadata.json
├── package.json
├── readme.md
├── server.ts
├── tsconfig.json
└── vite.config.ts
