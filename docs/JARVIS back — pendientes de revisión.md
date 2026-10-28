# JARVIS back — pendientes de revisión

Oct 27, 2026 · @colo f

## Estado

Cada ítem del informe original se constató contra el código; lo que sigue abierto exige una decisión o una validación tuya.

| Ítem | Resultado |
| --- | --- |
| A1, A2, A3, A5 | Aplicado (etapa 1) |
| B1, B2, C2, H1 | Aplicado (etapas 2 y 3) |
| D1 | Aplicado: `generatePlan(userMessage, signal?, revision?)`, con `PlanRevision { feedback, existingPlanSummary }` |
| Campos sin uso en `Step` | Aplicado: removidos `candidate_tools` y `dependencies` de `Step` y de la UI (`PlanReview.tsx`, `StepItem.tsx`) |
| `tsconfig.json` | Aplicado: removidos `allowJs` y `experimentalDecorators`; `strict: true` validado con `tsc` limpio |
| `deriveTaskView` y `rawInteractions` | Aplicado: removida función huérfana de `debugAccumulator.ts` y campo en `TaskMemory` |
| Unificación de `clip` / `clipTail` | Aplicado: exportados `clip` y `clipTail` desde `utils.ts`, consumidos por `prompts.ts` y `context.ts` |
| Números mágicos en `planLine` | Aplicado: nombrados como `PLAN_RUNNING_INSTRUCTION_CHARS` y `PLAN_RUNNING_OUTCOME_CHARS` en `context.ts` |
| Generación de IDs | Aplicado: helper `newId` en `utils.ts` usado en `initiateTask` (`core.ts`) y `requestUserApproval` (`callExecutor.ts`) |
| Capacidades reservadas | Documentado en `Capability` (`types.ts`): aclarado que `COMMAND_EXECUTION` es usada por `UNKNOWN_TOOL_POLICY` y `start_process` usa `PROCESS_CONTROL`; `DOWNLOAD` y `CONFIGURATION` quedan reservadas |
| Directorio de trazas (B4) | Aplicado: `recordTaskTrace` (`taskTrace.ts`) asegura el directorio con `mkdirSync({ recursive: true })` |
| Comentarios con `§` y `MCP_REAL_OUTPUTS` | Aplicado: eliminadas citas a secciones huérfanas y reemplazado `MCP_REAL_OUTPUTS` por "formato observado de la herramienta" |
| D5, D6 | Aplicado (aprobado por ti) |
| D4 | Cerrado sin cambios: el operando `BLOCKED` en `runPlanLoop` (`modeEngines.ts`) es redundante y se conserva |
| Errores de tipo en `qwen.ts` (`Validation`) | Corregidos; `tsc` limpio confirma el narrowing sin necesidad de `=== true` / `=== false` |
| `scratchpadDelta.process_id = undefined` | Validado: `executeMcpCall` (`callExecutor.ts`, `Object.assign`) y `ResultProcessor.process` (spread) lo preservan deliberadamente |
| D8-d (fase back) | Aplicado: `src/core/events.ts` con `CoreEventDataMap` (18 eventos vivos tipados), `DISCOVERY_REFRESH` eliminado y `emitEvent` genérico |
| D8-f (`types.ts` modularizado) | Aplicado: dividido en 9 submódulos en `src/core/types/` (`audit`, `decision`, `execution`, `limits`, `mcp`, `plan`, `policy`, `routes`, `task`) re-exportados por barrel en `types.ts` sin alterar imports externos |
| D8-g (Forma del plan y contrato Qwen) | Aplicado: `PlanStepWire` en `types/plan.ts`, validación compile-time con `STEP_WIRE_PROPERTIES satisfies Record<keyof PlanStepWire, JsonSchema>`, traducción única en `parsePlanSteps`, y `modelIterations.ts` tipado con `Step[]` (eliminados `PlanStepData` y alias) |
| Re-export `errorMessage` en `taskConclusion.ts` | Eliminado (código muerto: todos los módulos lo importan de `utils.ts`) |
| Alias de servidores en `DiscoveryEngine` (A4b) | Aplicado: eliminados alias informales (`desktop`, `commander`, `search`, `web`) de `normalizeServerName` en `discovery.ts` |
| C1, A4a, B3 | Sin cambios, ya resueltos como "se mantiene" |

**Evidencia de D4.** `blockStep` en `callExecutor.ts` fija `step.state = "BLOCKED"` y devuelve siempre `signals: { denied: true }`. Solo se llama desde `authorizeCall` (DENY de Guard y rechazo del usuario). Las otras dos asignaciones de `BLOCKED` son en `runFastLoop` (`modeEngines.ts`, anti-loop de FAST, inalcanzable desde `runPlanLoop`) y en `runPlanLoop` (PLAN, posterior al chequeo y con `return`).

## Validaciones realizadas y estado

1. **`npm run lint` (`tsc --noEmit`).** El script `"lint"` de `package.json` ejecuta `tsc --noEmit`. Se corrió reiteradas veces en todo el proyecto; compila en limpio con código de salida 0 (sin errores en backend, scripts ni ui). Adicionalmente, `npm run build` (`vite build`) completó con código 0.
2. **Llamadores de `generatePlan`.** Constatados y actualizados en `modifyPlan` (`core.ts`) e `initiatePlanMode` (`modeEngines.ts`).
3. **Limpieza UI de dependencias/herramientas candidatas.** Eliminados los bloques condicionales en `PlanReview.tsx` y `StepItem.tsx`.
4. **`deriveTaskView` y `rawInteractions`.** Eliminados por completo de `ui/utils/debugAccumulator.ts` y `src/core/types.ts`.
5. **`clip` y `clipTail` + constantes de `planLine`.** Unificados en `src/core/utils.ts` y constantes nombradas en `src/core/context.ts`.
6. **IDs unificados y trazas.** `newId` en `utils.ts` y creación recursiva de directorio en `recordTaskTrace`.
7. **Limpieza de citas huérfanas en comentarios.** Comprobado grep en 0 ocurrencias de `§` y `MCP_REAL_OUTPUTS` en `src`, `scripts` y `ui`.
8. **Modularización de `types.ts` (D8-f).** Separado en 9 archivos de dominio en `src/core/types/`. El barrel raíz `src/core/types.ts` mantiene intacto el contrato para todos los consumidores del repositorio.
9. **Contrato de paso Qwen vs Dominio (D8-g).** Formalizado contrato de red en `PlanStepWire` y validado contra el schema JSON con `satisfies`. `parsePlanSteps` actúa como frontera única hacia `PlanStep`. Todos los emisores (`core.ts:278`, `modeEngines.ts:292, 490`) emiten `Step[]`, permitiendo sanear `modelIterations.ts` eliminando `PlanStepData` y los fallbacks de alias.

## Estructural

Seis puntos abiertos que tocan infraestructura, flujo o core, y requieren decisión/aprobación. (D8-d, D8-f y D8-g ya fueron resueltos y movidos a la tabla de Estado).

| Punto | Evidencia en el código | Qué implica cambiarlo | Recomendación |
| --- | --- | --- | --- |
| D2. Llamadas MCP no cancelables | `server.callTool(tool.name, args)` sin señal en `executeMcpCall` (`callExecutor.ts`); al cancelar, el resultado tardío se descarta y la herramienta sigue corriendo | Señal opcional en `mcp/types.ts`, los servidores MCP y transportes | Dejar, salvo un caso real (búsqueda larga imposible de parar) |
| D3. `stepIndex` según quién emite | `blockStep` y `authorizeCall` en `callExecutor.ts` emiten sin `stepIndex`; `modeEngines.ts` lo incluye | Cambia el contrato SSE que consume la UI | Dejar |
| D8-a. Estado mutable compartido | `callExecutor.ts` modifica `task.state` y `step.state`; también `core.ts` y `modeEngines.ts` | Extraer una máquina de estados obliga a reordenar eventos | Dejar |
| D8-b. Dependencias concretas | `JarvisCore` recibe `Decision20Engine` y `DiscoveryEngine` (constructor); `callExecutor.ts` deriva tipos de `DiscoveryEngine`; solo `ILLMClient` es interfaz | Interfaces nuevas y ajustes en `engineDeps.ts` | Dejar, salvo que necesites mocks |
| D8-c. Singletons estáticos | `RefStore` (`context.ts`, `core.ts`) y `ConfigManager` (`qwen.ts`) se usan directo | Hacerlos inyectables toca cada módulo que los usa | Dejar |
| D8-e. Dos vocabularios de estado de llamada | `CallStatus` y `StepExecutionStatus` en `types.ts`; `classifyCall` y `settleCall` en `callExecutor.ts` traducen | Unificar cambia el resultado que consume `modeEngines` | Dejar |

## Duplicaciones y estilo

De la sección 3 del informe original, un punto ya no aplica y los demás siguen. Ninguno cambia el flujo; el del prompt cambia el texto que recibe Qwen.

| Punto | Estado actual | Acción posible |
| --- | --- | --- |
| Límites de memoria repetidos (`memoryRetrievalLimit: 2`, tope `5`) | Ya no aplica: `context.ts` usa `PROGRESSIVE_MEMORY_TIERS[0]` y `MAX_FAIL_ENTRIES` | Ninguna |
| Generación de ids | Unificado: `newId` en `utils.ts` usado en `initiateTask` (`core.ts`) y `requestUserApproval` (`callExecutor.ts`) | Aplicado |
| `clip` y `clipTail` | Unificado: exportados `clip` y `clipTail` en `utils.ts`, consumidos por `prompts.ts` y `context.ts` | Aplicado |
| Números mágicos en `planLine` | Nombrados como `PLAN_RUNNING_INSTRUCTION_CHARS` (200) y `PLAN_RUNNING_OUTCOME_CHARS` (150) en `context.ts` | Aplicado |
| `deriveTaskView` y `rawInteractions` | Eliminada la función sin llamadores en `debugAccumulator.ts` y el campo en `TaskMemory` (`types.ts`) | Aplicado |
| Comentarios que citan documentos ausentes (`§10.x`, `MCP_REAL_OUTPUTS`) | Limpiados: removidas citas a secciones huérfanas y sustituido por "formato observado de la herramienta" | Aplicado |
| Estilo mezclado | 4 espacios en `modeEngines.ts` y `context.ts`; 2 en `qwen.ts`, `core.ts`, `prompts.ts` y `modelIterations.ts`. | Dejar o formatear cuando se decida |
| Prompt de planificación | `prompts.ts` tiene doble espacio y las primeras seis líneas están en inglés, el resto en español | Cambia la entrada a Qwen y existe una copia en `scripts/eval/llm/prompts/Q1.ts`: decisión tuya |

## Logs y otros hallazgos

Puntos de análisis operativo y hallazgos cerrados.

| Punto | Estado | Para decidir |
| --- | --- | --- |
| Logs con datos de la tarea (Grupo E) | Decidido: se dejan. Hay 52 llamadas a `console.*` (`modeEngines` 24, `qwen` 10, `callExecutor` 9, `core` 8, `context` 1). | Reabrir si los logs salen de la máquina local |
| Capacidades sin uso: `COMMAND_EXECUTION`, `DOWNLOAD`, `CONFIGURATION` | `COMMAND_EXECUTION` la usa `UNKNOWN_TOOL_POLICY`; `start_process` usa `PROCESS_CONTROL`. `DOWNLOAD` y `CONFIGURATION` no las usa ninguna tool hoy y quedan reservadas en `types.ts` | Documentado (dejadas reservadas) |
| `taskTrace.ts` no crea el directorio (B4) | Resuelto: `recordTaskTrace` crea recursivamente el directorio padre antes de hacer `appendFileSync` | Aplicado |
| Alias de servidores en `DiscoveryEngine` (A4b) | Eliminados alias no canónicos de `normalizeServerName` en `discovery.ts`; los servidores solo se identifican por sus nombres reales (`desktop_commander` y `free_search`) | Aplicado |
| `appendFileSync` en `taskTrace.ts` (B3) | Una escritura por tarea; sin impacto demostrado | Dejar |
| `rm -rf /<ruta>` dispara DENY (C1) | Decidido: se mantiene la protección | Ninguna |
