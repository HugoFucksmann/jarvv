# Mapa del Código Fuente de JARVIS Core

> Última revisión: **2026-10-13** (v1.3 — Mapeo Completo Post-Fase 5)

## 1. Árbol de Archivos del Proyecto

```
/
├── .gitignore
├── Desicion-2.0-Eos.md
├── Desktop CommanderMCP.md
├── PLAN_IMPLEMENTACION_MIGRACION_V1.3.md
├── WindowsMCP.md
├── bun.lock
├── free-search-mcp.md
├── index.html
├── jarvis-config.json
├── jarvis-tasks.json
├── metadata.json
├── package.json
├── readme.md
├── server.ts
├── test-phase4.ts
├── test-phase5.ts
├── test-schema.ts
├── tsconfig.json
├── vite.config.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CODEBASE_MAP.md
│   ├── CONTEXT_AND_MEMORY.md
│   ├── CORE_FLOW.md
│   ├── FASE_0_CIERRE_AUDITORIA.md
│   ├── FASE_2_CIERRE_AUDITORIA.md
│   ├── FASE_3_CIERRE_AUDITORIA.md
│   ├── FASE_3B_CIERRE_AUDITORIA.md
│   ├── FASE_4_CIERRE_AUDITORIA.md
│   ├── FASE_5_CIERRE_AUDITORIA.md
│   ├── FASE_6_PREPARACION_AUDITORIA_INTEGRAL.md
│   ├── INCONSISTENCIAS.md
│   ├── MCP_TOOLS_SNAPSHOT.md
│   └── TOOLS_AND_SECURITY.md
│
└── src/
    ├── App.tsx
    ├── index.css
    ├── main.tsx
    │
    ├── components/
    │   ├── CommandSection/
    │   │   ├── CommandSection.tsx
    │   │   └── components/
    │   │       └── PromptInput.tsx
    │   │
    │   ├── ContextInspector/
    │   │   ├── ContextInspector.tsx
    │   │   └── components/
    │   │       ├── DiscoveryCatalogView.tsx
    │   │       ├── EvidenceView.tsx
    │   │       ├── MemoryView.tsx
    │   │       └── ScratchpadView.tsx
    │   │
    │   ├── DecisionStream/
    │   │   ├── DecisionStream.tsx
    │   │   └── components/
    │   │       ├── DecisionOneView.tsx
    │   │       ├── DecisionTwoView.tsx
    │   │       └── DecisionVerificationView.tsx
    │   │
    │   ├── GuardBanner/
    │   │   ├── GuardBanner.tsx
    │   │   └── components/
    │   │       └── ApprovalAction.tsx
    │   │
    │   ├── ProcessFlow/
    │   │   ├── ProcessFlow.tsx
    │   │   └── components/
    │   │       ├── FinalResponseView.tsx
    │   │       ├── PlanReview.tsx
    │   │       ├── StepItem.tsx
    │   │       ├── StepTimeline.tsx
    │   │       └── TaskOverview.tsx
    │   │
    │   ├── SettingsModal/
    │   │   └── SettingsModal.tsx
    │   │
    │   ├── Shared/
    │   │   ├── MarkdownRenderer.tsx
    │   │   └── StatusDot.tsx
    │   │
    │   └── TopBar/
    │       ├── TopBar.tsx
    │       └── components/
    │           ├── BrandWordmark.tsx
    │           ├── HistoryMenu.tsx
    │           ├── ModeSelector.tsx
    │           └── SystemStatus.tsx
    │
    ├── core/
    │   ├── callExecutor.ts
    │   ├── config.ts
    │   ├── context.ts
    │   ├── core.ts
    │   ├── decision.ts
    │   ├── modeEngines.ts
    │   ├── types.ts
    │   │
    │   ├── mcp/
    │   │   ├── desktopCommanderMcp.ts
    │   │   ├── discovery.ts
    │   │   ├── freeSearchMcp.ts
    │   │   ├── transport.ts
    │   │   ├── types.ts
    │   │   └── windowsMcp.ts
    │   │
    │   ├── policy/
    │   │   ├── guard.ts
    │   │   └── policyRegistry.ts
    │   │
    │   ├── processor/
    │   │   ├── refResolver.ts
    │   │   └── resultProcessor.ts
    │   │
    │   ├── reasoner/
    │   │   ├── prompts.ts
    │   │   └── qwen.ts
    │   │
    │   └── tools/
    │       └── manifest.ts
    │
    ├── hooks/
    │   └── useJarvis.ts
    │
    ├── services/
    │   └── jarvisApi.ts
    │
    └── utils/
        └── apiUrl.ts
```

---

## 2. Mapa de Dependencias por Importaciones

### 2.1 Host Autoritativo (`server.ts`)
- `dotenv/config`
- `express`, `fs`, `path`, `url`
- `src/core/mcp/windowsMcp.ts` (`WindowsMCPServer`)
- `src/core/mcp/desktopCommanderMcp.ts` (`DesktopCommanderMCPServer`)
- `src/core/mcp/freeSearchMcp.ts` (`FreeSearchMCPServer`)
- `src/core/mcp/types.ts` (`IMCPServer`)
- `src/core/mcp/discovery.ts` (`DiscoveryEngine`)
- `src/core/decision.ts` (`Decision20Engine`)
- `src/core/reasoner/qwen.ts` (`QwenEngine`)
- `src/core/core.ts` (`JarvisCore`)
- `src/core/config.ts` (`ConfigManager`)
- `src/core/types.ts` (`PendingApproval`)
- `src/core/processor/resultProcessor.ts` (`RefStore`)

### 2.2 Orquestador Central (`src/core/core.ts`)
- `node:fs`, `node:path`
- `src/core/types.ts` (`Task`, `TaskExecutionContext`, `CoreEvent`, `PendingApproval`, `isTerminalState`, etc.)
- `src/core/decision.ts` (`Decision20Engine`)
- `src/core/mcp/discovery.ts` (`DiscoveryEngine`)
- `src/core/reasoner/qwen.ts` (`QwenEngine`)
- `src/core/modeEngines.ts` (`runFastLoop`, `initiatePlanMode`, `runPlanLoop`, `EngineDependencies`)
- `src/core/processor/resultProcessor.ts` (`RefStore`)

### 2.3 Motor Unificado de Paso (`src/core/callExecutor.ts`)
- `src/core/types.ts` (`Step`, `StepExecutionResult`, `ProcessedResult`, `MAX_ARG_RETRIES`, etc.)
- `src/core/policy/guard.ts` (`Guard`)
- `src/core/policy/policyRegistry.ts` (`PolicyRegistry`)
- `src/core/processor/resultProcessor.ts` (`ResultProcessor`)
- `src/core/processor/refResolver.ts` (`resolveReferences`)
- `src/core/context.ts` (`addLogEntry`, `addFailEntry`, `addEffectEntry`, `applyStepHandoff`, `buildEffectsContext`, `buildPlanLines`)
- `src/core/decision.ts` (`DecisionValidationError`, `evaluateStepVerification`)
- `src/core/reasoner/qwen.ts` (`generateArguments`)

### 2.4 Coordinación de Modos (`src/core/modeEngines.ts`)
- `src/core/types.ts` (`Task`, `Step`, `MAX_STEPS`, `MAX_REPLAN`, `MAX_ESCALATIONS`, etc.)
- `src/core/callExecutor.ts` (`runStep`)
- `src/core/decision.ts` (`evaluateDecisionOne`)
- `src/core/reasoner/qwen.ts` (`generatePlan`, `verifyStage`, `generateFinalResponse`)
- `src/core/context.ts` (`buildHistoryContext`, `expandMemoryContext`, `addFailEntry`)
- `src/core/processor/resultProcessor.ts` (`RefStore`)

### 2.5 Seguridad y Manifiesto (`src/core/policy/*`, `src/core/tools/*`)
- `src/core/tools/manifest.ts`: define `SYSTEM_TOOL_MANIFEST` (61 herramientas) y `buildCompactCatalog`.
- `src/core/policy/policyRegistry.ts`: importa `SYSTEM_TOOL_MANIFEST` de `manifest.ts`.
- `src/core/policy/guard.ts`: importa `PolicyRegistry` de `policyRegistry.ts`.

### 2.6 Procesamiento Factual y Referencias (`src/core/processor/*`)
- `src/core/processor/resultProcessor.ts`: administra `RefStore` (almacén volátil) y extrae señales/hechos.
- `src/core/processor/refResolver.ts`: importa `RefStore` de `resultProcessor.ts` y sustituye referencias en argumentos.

### 2.7 Capa Cliente React (`src/App.tsx`, `useJarvis.ts`)
- `src/hooks/useJarvis.ts`: gestiona conexión SSE (`/api/jarvis/events`), polling de respaldo y llamadas REST a `jarvisApi.ts`.
- `src/services/jarvisApi.ts`: expone métodos cliente para `/api/jarvis/*` (incluyendo `/ref/:refKey`, `/confirm-plan`, `/reject-plan`, `/modify-plan`, `/user-answer`).
- `src/components/*`: componentes de UI desacoplados y modulares.

---

## 3. Resumen de Módulos Críticos por Responsabilidad

| Responsabilidad | Módulo Canónico | Puntos de Entrada Principales |
|---|---|---|
| **Punto de Entrada Full-Stack** | `server.ts` | `main()`, express routes `/api/jarvis/*`, `/api/mcp/*` |
| **Punto de Entrada Frontend** | `src/main.tsx` → `src/App.tsx` | Componente raíz React con `useJarvis` |
| **Control de Tareas y Persistencia** | `src/core/core.ts` | `JarvisCore.initiateTask()`, `cancelTask()`, `confirmPlan()` |
| **Ejecución Atómica de Paso** | `src/core/callExecutor.ts` | `runStep(context, step, deps)` |
| **Coordinación FAST & PLAN** | `src/core/modeEngines.ts` | `runFastLoop()`, `initiatePlanMode()`, `runPlanLoop()` |
| **Arbitraje y Verificación Eos** | `src/core/decision.ts` | `evaluateDecisionOne()`, `evaluateDecisionTwo()`, `evaluateStepVerification()` |
| **Razonamiento y Schemas Qwen** | `src/core/reasoner/qwen.ts` | `generateArguments()`, `generatePlan()`, `verifyStage()`, `concludeTask()` |
| **Compuerta de Seguridad** | `src/core/policy/guard.ts` | `Guard.evaluate(mcp, tool, args)` |
| **Catálogo Tipado de Herramientas**| `src/core/tools/manifest.ts` | `SYSTEM_TOOL_MANIFEST`, `buildCompactCatalog()` |
| **Sustitución de Referencias** | `src/core/processor/refResolver.ts` | `resolveReferences(args, taskId)` |
| **Almacén Volátil de Salidas** | `src/core/processor/resultProcessor.ts` | `RefStore.put()`, `get()`, `has()`, `list()`, `clear()` |
| **Inspección de Referencias en UI**| `src/components/ContextInspector/components/MemoryView.tsx` | Consulta interactiva con `jarvisApi.getRef()` |
| **Veredictos Factuales en UI** | `src/components/DecisionStream/components/DecisionVerificationView.tsx` | Visualización de señales limpias y probabilidades `ok` / `cumple` |
| **Aprobaciones sin Timeout en UI**| `src/components/GuardBanner/GuardBanner.tsx` | `ApprovalAction.tsx` y campo de respuesta para `user_answer` |
| **Ciclo Interactivo de Plan en UI**| `src/components/ProcessFlow/components/PlanReview.tsx` | Confirmación, rechazo y modificación de planes |
