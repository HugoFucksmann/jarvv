# JARVIS back — pendientes de revisión

Oct 27, 2026 · @colo f

## Estado

Cada ítem del informe original se constató contra el código; lo que sigue abierto exige una decisión o una validación tuya.

| Ítem | Resultado |
| --- | --- |
| A1, A2, A3, A5 | Aplicado (etapa 1) |
| B1, B2, C2, H1 | Aplicado (etapas 2 y 3) |
| D1 | Aplicado: `generatePlan(userMessage, signal?, revision?)`, con `PlanRevision { feedback, existingPlanSummary }` |
| D5, D6 | Aplicado (aprobado por ti) |
| D4 | Cerrado sin cambios: el operando `BLOCKED` de `modeEngines.ts:571` es redundante y se conserva |
| Errores de tipo en `qwen.ts` (`Validation`) | Corregidos con `=== true` / `=== false` |
| `strict` en `tsconfig.json` | Agregado; falta validar con `tsc` |
| C1, A4a, A4b, B3, B4 | Sin cambios, ya resueltos como "se mantiene" |

**Evidencia de D4.** `blockStep` (`callExecutor.ts:412-424`) fija `step.state = "BLOCKED"` y devuelve siempre `signals: { denied: true }`. Solo se llama desde `authorizeCall` (DENY de Guard y rechazo del usuario). Las otras dos asignaciones de `BLOCKED` son `modeEngines.ts:384` (anti-loop de FAST, inalcanzable desde `runPlanLoop`) y `:603` (PLAN, posterior al chequeo y con `return`).

## Validaciones pendientes

Tres comprobaciones dependen de tu entorno y de los archivos que no vi.

1. **`npx tsc --noEmit` con `strict: true`.** Verifiqué solo siete archivos (`types`, `context`, `modelIterations`, `modeEngines`, `core`, `qwen`, `prompts`) con stubs de los módulos ausentes. `strict` activa varias reglas a la vez, y puede dar errores nuevos en `callExecutor.ts`, `decision.ts`, `server.ts`, `ui/` y `scripts/`. Si no quieres atacarlos ahora, se borra la línea `"strict": true`.
2. **`npx tsc -v` y dónde apareció el error de `Phase` (editor o consola).** Es el dato abierto de H1: explica por qué el editor marcaba errores que `tsc --noEmit` no mostraba.
3. **Llamadores de `generatePlan` con la firma anterior.** La búsqueda cubrió `*.ts` y `*.tsx`; no `.js`, `.mjs` ni `.json`. Cualquier llamador que se me escapó lo marcará `tsc`.

## Estructural

Nueve puntos, todos confirmados en el código y ninguno es un error. Cambiar cualquiera toca infraestructura, flujo o core, así que requiere tu aprobación.

| Punto | Evidencia en el código | Qué implica cambiarlo | Recomendación |
| --- | --- | --- | --- |
| D2. Llamadas MCP no cancelables | `server.callTool(tool.name, args)` sin señal (`callExecutor.ts:504`); al cancelar, el resultado tardío se descarta (`:514-517`) y la herramienta sigue corriendo | Señal opcional en `mcp/types.ts`, los servidores MCP y `transport.ts` (no vistos) | Dejar, salvo un caso real (búsqueda larga imposible de parar) |
| D3. `stepIndex` según quién emite | `blockStep` (`:422`) y `authorizeCall` (`:446`) emiten sin `stepIndex`; `modeEngines` lo incluye | Cambia el contrato SSE que consume la UI | Dejar |
| D8-a. Estado mutable compartido | `callExecutor` modifica `task.state` (`:443`, `:460`) y `step.state` (`:419`, `:445`, `:468`); también `core` y `modeEngines` | Extraer una máquina de estados obliga a reordenar eventos | Dejar |
| D8-b. Dependencias concretas | `core.ts` recibe `Decision20Engine` y `DiscoveryEngine` (constructor, `:51-53`); `callExecutor.ts:178` deriva tipos de `DiscoveryEngine`; solo `ILLMClient` es interfaz | Interfaces nuevas y ajustes en `engineDeps.ts` (no visto) | Dejar, salvo que necesites mocks |
| D8-c. Singletons estáticos | `RefStore` (`context.ts:348`, `core.ts:371`) y `ConfigManager` (`qwen.ts`) se usan directo | Hacerlos inyectables toca cada módulo que los usa | Dejar |
| D8-d. Eventos sin tipo | `CoreEvent.data: Record<string, unknown>` (`types.ts:542`); `modelIterations.ts` castea a 7 interfaces locales de payload. El informe hablaba de `as any`: ya no hay ninguno en los archivos revisados | Unión discriminada por `type`; alcanza a todos los emisores (el informe cuenta \~35-40) | Abordable: es la deuda con más beneficio |
| D8-e. Dos vocabularios de estado de llamada | `CallStatus` (`types.ts:123-126`) y `StepExecutionStatus` (`:367`); `classifyCall` (`callExecutor.ts:102`) y `settleCall` (`:782-794`) traducen | Unificar cambia el resultado que consume `modeEngines` | Dejar |
| D8-f. `types.ts` concentra 73 exports | Verificado: incluye dos funciones (`isExecutableRoute`, `isTerminalState`) y constantes | Dividir el archivo cambia imports en todo el proyecto | Dejar |
| D8-g. Forma del plan repartida | `qwen.ts`, `prompts.ts`, `modeEngines.ts` y `modelIterations.ts`; este último acepta ambos nombres (`goal`/`instruction`, `suggested_mcp`/`route`). D1 ya redujo la firma de `generatePlan` | Un tipo único de paso afecta a los cuatro archivos y a la UI | Dejar |

## Duplicaciones y estilo

De la sección 3 del informe original, un punto ya no aplica y los demás siguen. Ninguno cambia el flujo; el del prompt cambia el texto que recibe Qwen.

| Punto | Estado actual | Acción posible |
| --- | --- | --- |
| Límites de memoria repetidos (`memoryRetrievalLimit: 2`, tope `5`) | Ya no aplica: `context.ts:82` usa `PROGRESSIVE_MEMORY_TIERS[0]` y `:197` usa `MAX_FAIL_ENTRIES` | Ninguna |
| Generación de ids | Tres sitios: `task_` (`core.ts:155`) y `approval_` (`callExecutor.ts:78`) con el mismo patrón de `Math.random`; `call_` (`callExecutor.ts:99`) con otro formato | Un helper común para los dos primeros; sin efecto en el comportamiento |
| `clipLine` y `clip` | `context.ts:231` y `prompts.ts:56`, con el mismo comportamiento | Exportar uno desde un módulo común |
| Números mágicos | `context.ts` ya los nombra (`MAX_LOG_ENTRIES`, `PLAN_WINDOW_*`); quedan `200` y `150` literales en `planLine` (`:239`). No vi los extractores ni `taskConclusion` | Nombrar los literales de `planLine`; revisar los otros dos cuando los pases |
| Estilo mezclado | 4 espacios en `modeEngines.ts` y `context.ts`; 2 en `qwen.ts`, `core.ts`, `prompts.ts` y `modelIterations.ts`. \` |  |
| Prompt de planificación | `prompts.ts:296` tiene doble espacio y las primeras seis líneas están en inglés, el resto en español | Cambia la entrada a Qwen y existe una copia en `scripts/eval/llm/prompts/Q1.ts`: decisión tuya |
| Comentarios que citan documentos ausentes (`§10.x`, `MCP_REAL_OUTPUTS`) | No aparecen en los ocho archivos revisados; sin verificar en el resto | `findstr /s /n "§ MCP_REAL_OUTPUTS" src\*.ts` |

## Logs y otros hallazgos

Seis puntos sin cambios de código. Los marcados "no vi" dependen de archivos que no tengo.

| Punto | Estado | Para decidir |
| --- | --- | --- |
| Logs con datos de la tarea (Grupo E) | Decidido: se dejan. Hay 52 llamadas a `console.*` en los archivos que vi (`modeEngines` 24, `qwen` 10, `callExecutor` 9, `core` 8, `context` 1). Imprimen argumentos de herramientas (`callExecutor.ts:500`, 300 caracteres), el resultado MCP (`:511`, 400), prompts y respuestas de Qwen (`qwen.ts`, 200, 300 y 400) y el `feedback` completo del usuario (`core.ts:237`) | Reabrir si los logs salen de tu máquina |
| Capacidades sin uso: `COMMAND_EXECUTION`, `DOWNLOAD`, `CONFIGURATION` | Declaradas en `types.ts:334-341`. Que ninguna herramienta las use lo dice el informe; no vi `manifest.ts` | Pasar `manifest.ts`; si se confirma, quitarlas o dejarlas como reserva |
| Alias de servidores en `DiscoveryEngine` (A4b) | Sin evidencia de uso ni de daño. `mcpRouter.ts` toma el nombre desde la URL y `server.ts` monta `/mcp` para inspectores externos | `mcpRouter.ts` y `findstr /s /n "/mcp/" ui\*.ts ui\*.tsx` |
| `taskTrace.ts` no crea el directorio (B4) | Si no existe, la traza se pierde con un `console.warn`. Dato del informe; no vi el archivo | Crear el directorio al escribir, si la traza te importa |
| `appendFileSync` en `taskTrace.ts` (B3) | Una escritura por tarea; sin impacto demostrado | Dejar |
| `rm -rf /<ruta>` dispara DENY (C1) | Decidido: se mantiene la protección | Ninguna |
