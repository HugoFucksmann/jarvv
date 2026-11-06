# Estructura del directorio `src`

```text
src
├── core
│   ├── budget.ts
│   ├── config.ts
│   ├── ctx
│   │   ├── apply.ts
│   │   ├── closure.ts
│   │   ├── context.ts
│   │   ├── create.ts
│   │   ├── derive.ts
│   │   ├── errors.ts
│   │   ├── ids.ts
│   │   ├── index.ts
│   │   ├── json.ts
│   │   ├── query.ts
│   │   ├── snapshot.ts
│   │   ├── types.ts
│   │   ├── validate.ts
│   │   └── views
│   │       ├── args.ts
│   │       ├── ask.ts
│   │       ├── final.ts
│   │       ├── index.ts
│   │       ├── messages.ts
│   │       ├── plan.ts
│   │       ├── review.ts
│   │       ├── route.ts
│   │       ├── shared.ts
│   │       ├── types.ts
│   │       └── verify.ts
│   ├── decision.ts
│   ├── engine
│   │   ├── adapters.ts
│   │   ├── args.ts
│   │   ├── ask.ts
│   │   ├── callRunner.ts
│   │   ├── capture.ts
│   │   ├── deps.ts
│   │   ├── env.ts
│   │   ├── failures.ts
│   │   ├── finalize.ts
│   │   ├── outcomes.ts
│   │   ├── planner.ts
│   │   ├── retries.ts
│   │   ├── runTask.ts
│   │   ├── runtime.ts
│   │   ├── stepLoop.ts
│   │   └── verify.ts
│   ├── environment.ts
│   ├── llmTransport.ts
│   ├── mcp
│   │   ├── desktopCommanderMcp.ts
│   │   ├── discovery.ts
│   │   ├── freeSearchMcp.ts
│   │   ├── stdioServer.ts
│   │   ├── transport.ts
│   │   └── types.ts
│   ├── policy
│   │   └── guard.ts
│   ├── reasoner
│   │   ├── prompts.ts
│   │   ├── qwen.ts
│   │   └── stageRequests.ts
│   ├── refs
│   │   ├── refResolver.ts
│   │   └── refVault.ts
│   ├── render
│   │   ├── args.ts
│   │   ├── ask.ts
│   │   ├── errors.ts
│   │   ├── final.ts
│   │   ├── index.ts
│   │   ├── messages.ts
│   │   ├── plan.ts
│   │   └── shared.ts
│   ├── result
│   │   ├── extractors
│   │   │   ├── files.ts
│   │   │   ├── freeSearch.ts
│   │   │   ├── generic.ts
│   │   │   ├── index.ts
│   │   │   ├── process.ts
│   │   │   ├── shared.ts
│   │   │   └── types.ts
│   │   └── processResult.ts
│   ├── tasks.ts
│   ├── text.ts
│   ├── tools
│   │   └── manifest.ts
│   ├── trace
│   │   └── recorder.ts
│   ├── types
│   │   ├── audit.ts
│   │   ├── decision.ts
│   │   ├── execution.ts
│   │   ├── limits.ts
│   │   ├── mcp.ts
│   │   ├── plan.ts
│   │   ├── policy.ts
│   │   └── routes.ts
│   ├── types.ts
│   └── utils.ts
└── server
    ├── jarvisRouter.ts
    └── mcpRouter.ts

15 directories, 89 files
```

