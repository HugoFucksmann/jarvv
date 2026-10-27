# JARVIS back — notas de revisión

Observaciones detectadas durante el refactor de `src`. **Ninguna fue corregida**: el refactor no cambia lógica ni flujo. Sirve de lista de trabajo para la próxima implementación.

## 1. Inconsistencias de comportamiento (no tocadas)

- **`generatePlan` con 6 parámetros posicionales opcionales.** `core.modifyPlan` la llama como `(message, undefined, signal, undefined, feedback, summary)`. Cambiar la firma rompe a cualquier cliente o mock que la implemente.
- **Las llamadas MCP no se pueden cancelar.** `server.callTool(name, args)` no recibe la señal de cancelación: al cancelar solo se descarta el resultado tardío, la herramienta sigue corriendo.
- **Payload distinto para el mismo evento.** `STEP_STATE_CHANGED` y `STEP_COMPLETED` llevan `stepIndex` cuando los emiten los modos FAST/PLAN y no lo llevan cuando los emite el ejecutor (aprobación y bloqueo). Se preservó a propósito en `stepEvents.ts`.
- **Guard.** `rm -rf /<cualquier ruta>` dispara DENY (falso positivo ya documentado). `approvalReason` interpola `args.command || args.cmd || tool`, que puede imprimir `[object Object]` si no es texto.
- **PLAN y denegación.** `signals?.denied || step.state === "BLOCKED"`: el segundo operando parece redundante (`blockStep` fija ambos), pero no lo verifiqué en todos los caminos.
- **`decision.ts`.** La URL se arma con `endsWith("/v1/decide")`: una barra final tras `/v1/decide` genera una ruta duplicada.
- **`llmTransport.ts`.** Envía siempre `ngrok-skip-browser-warning` y `bypass-tunnel-reminder`, aunque el endpoint no sea un túnel.
- **Logs con datos de la tarea.** `console.*` imprime argumentos de herramientas y payloads de Decision (hasta 300–400 caracteres). Hay unas 65 llamadas sin una capa de logging común.
- **`taskTrace.ts`.** `appendFileSync` bloquea el event loop; si el directorio de la traza no existe, el error se ignora en silencio.
- **`RefStore.clear("")`** (`if (taskId)`) borra todas las tareas.
- **`core.modifyPlan.reportFailure`** emite `TASK_STATE_CHANGED` con `WAITING_INPUT` sin cambiar el estado.
- **`resultProcessor.process`** tiene `args = {}` por defecto antes de un parámetro obligatorio (`taskId`): quien lo llame debe pasar `undefined`.
- **`discovery.ts`.** `catch (err: any)`, caché de 30 s fija y alias de servidores escritos en el código.
- **Dos funciones con nombre parecido y reglas distintas:** `taskConclusion.resolveFailureState` (cuenta COMPLETED en todos los pasos, incluidos reemplazados) y `modeEngines.resolveIncompleteState` (cuenta COMPLETED o UNVERIFIED solo en los vigentes).

## 2. Lo que complica simplificar o modularizar

- **Estado mutable compartido.** `task`, `step` y `context` los modifican `callExecutor`, `modeEngines` y `core` (`cancelTask`, `provideUserAnswer`). Las transiciones de estado están repartidas con el orden de eventos pegado a cada una, lo que impide extraer una máquina de estados sin cambiar eventos.
- **Singletons estáticos.** `RefStore` y `ConfigManager` se usan directo desde varios módulos (contexto, procesador, traza, resolver, Decision, Qwen). No son inyectables y obligan a pruebas con parches.
- **`EngineDependencies` expone clases concretas** (`Decision20Engine`, `DiscoveryEngine`), no interfaces; solo `ILLMClient` lo es.
- **Eventos sin tipo.** Unos 40 puntos de emisión con `Record<string, unknown>`; `modelIterations.ts` descubre la forma de cada payload por convención y usa `event.data as any` (7 veces) y `!`.
- **Dos vocabularios de estado de una llamada:** `StepCall.status` (`ok | unverified | rejected | tool_error…`) y `StepExecutionResult.status` (`ok | logical_error | unverified | blocked_loop`). Cada módulo traduce a mano.
- **Casts de estrechamiento.** Tres `(task.state as TaskState)` / `(step.state as StepState)` en `modeEngines.ts` existen solo porque TypeScript asume el valor asignado antes del `await`.
- **`types.ts`** concentra \~70 exports (tipos, constantes y dos funciones: `isTerminalState`, `isExecutableRoute`).
- **`generatePlan`/`replan`** acopladas a la forma de `PlanStep` en `qwen.ts`; cualquier cambio de plan toca `qwen.ts`, `prompts.ts`, `modeEngines.ts` y `modelIterations.ts`.

## 3. Duplicaciones menores que se dejaron

- `memoryRetrievalLimit: 2` repite `PROGRESSIVE_MEMORY_TIERS[0]`; los topes `30`/`5` de LOG/FAIL aparecen también como `Math.min(limit, 5)`.
- Generación de ids (`task_…`, aprobación, `call_…`) escrita tres veces.
- `clipLine` (context) y `clip` (prompts) hacen lo mismo.
- Números mágicos en extractores (8, 40, 15, 30 líneas) y en `taskConclusion` (3, 5, 2, 200, 600, 1500).
- Estilo mezclado: sangría de 2 y 4 espacios, `||` y `??`, español e inglés en nombres, comentarios y prompts. El prompt de planificación tiene una línea con doble espacio y mezcla de idiomas.
- Algunos comentarios citan documentos que no están en el repositorio (`§10.x`, `MCP_REAL_OUTPUTS`).

## 4. Qué cambió fuera de "calidad de código"

Nada de lógica. Única diferencia de build: `mcp/discovery.ts` y `mcp/types.ts` importaban tipos sin `import type`; funcionaba con `tsc`, pero falla si el código se ejecuta con eliminación de tipos (`tsx`, `isolatedModules`, `verbatimModuleSyntax`).
