# Mapa del Código Fuente de JARVIS Core

## 1. Árbol de Archivos del Proyecto
.
├── docs
│   ├── ARCHITECTURE.md
│   ├── CODEBASE_MAP.md
│   ├── CONTEXT_AND_MEMORY.md
│   ├── CORE_FLOW.md
│   ├── Correcciones_revision.md
│   ├── JARVIS back — notas de revisión (inconsistencias y fricciones).md
│   ├── JARVIS back — pendientes de revisión.md
│   ├── plan_simple.md
│   └── salidas_tools_MCP.md
├── src
│   ├── core
│   │   ├── mcp
│   │   │   ├── desktopCommanderMcp.ts
│   │   │   ├── discovery.ts
│   │   │   ├── freeSearchMcp.ts
│   │   │   ├── transport.ts
│   │   │   └── types.ts
│   │   ├── policy
│   │   │   └── guard.ts
│   │   ├── processor
│   │   │   ├── extractors
│   │   │   │   ├── files.ts
│   │   │   │   ├── freeSearch.ts
│   │   │   │   ├── generic.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── process.ts
│   │   │   │   └── types.ts
│   │   │   ├── refResolver.ts
│   │   │   ├── refStore.ts
│   │   │   ├── resultProcessor.ts
│   │   │   └── text.ts
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
│   │   ├── engineDeps.ts
│   │   ├── environment.ts
│   │   ├── llmTransport.ts
│   │   ├── modeEngines.ts
│   │   ├── modelIterations.ts
│   │   ├── models.ts
│   │   ├── stepEvents.ts
│   │   ├── taskConclusion.ts
│   │   ├── taskTrace.ts
│   │   ├── taskWire.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   └── server
│       ├── jarvisRouter.ts
│       └── mcpRouter.ts
├── eval_scan.txt
├── index.html
├── jarvis-config.json
├── metadata.json
├── package.json
├── readme.md
├── server.ts
├── tsconfig.json
└── vite.config.ts

---

## 2. Mapa de Dependencias por Importaciones

