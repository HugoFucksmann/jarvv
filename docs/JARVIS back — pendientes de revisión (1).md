# JARVIS back — pendientes de revisión

Actualizado el 29 de oct de 2026, después del desacople de motores, la reorganización de tipos y la limpieza de comentarios. Contiene solo lo que sigue abierto. Cada punto se verificó leyendo el código, sin ejecutar pruebas.

**Alcance de la verificación.** Se contrastó contra todo `src/` (`core`, `server` y `server.ts`): incluye `types.ts` y `types/*.ts`, `processor/**`, `mcp/**`, `tools/manifest.ts` y los dos routers. `ui/`, `lab/` y `scripts/` no se revisaron; lo que depende de ellos está marcado "sin confirmar".

## Retirado respecto a la versión anterior

- Todo lo marcado "Aplicado", y D4, C1, A4a y B3, que ya estaban cerrados.
- **D8-b (dependencias concretas): resuelto.** `engineDeps.ts` define `IDecisionEngine`, `IDiscoveryEngine` e `ILLMClient`; `JarvisCore` recibe `{ decisionEngine, discoveryEngine, llm }` y solo `server.ts` conoce las implementaciones.
- **D1 confirmado:** `generatePlan(userMessage, signal?, revision?)` coincide en `engineDeps.ts`, `qwen.ts`, `core.ts:238` y `modeEngines.ts:453`.
- **Confirmados en el código actual:** los 18 eventos de `CoreEventDataMap` tienen uso; `recordTaskTrace` crea el directorio con `mkdirSync({ recursive: true })`; las constantes de `planLine` están nombradas; `normalizeServerName` ya no existe; no quedan `§` ni `MCP_REAL_OUTPUTS`.
- **Resuelto en esta ronda:** `getAllServers()`, `ConfigManager.isConfigured()`, `setAllowedDirectories`/`getAllowedDirectories` y los re-exports de `callExecutor.ts` y `core.ts` (sin usos en `src/`, `ui/`, `lab/` ni `scripts/`); `buildHistoryContext` toma su valor por defecto de `PROGRESSIVE_MEMORY_TIERS[0]`; el bloque repetido de observación compacta de los extractores pasó a `compactObservation`; `ToolPolicy` sin `kind` y con campos obligatorios (`mutates` es la única representación); `blocked_loop` pasó a `loop_blocked`; `StdioConfig` se reemplazó por `StdioServerConfig` y el timeout de MCP se lee solo de `ConfigManager`; los dos adaptadores MCP comparten `StdioMcpServer`; se retiraron cinco campos de `free_search` sin lectores en `MCPCallResult`; la etiqueta del log de verificación usa el modelo configurado con el backend `d3`; `modelIterations.ts` solo acepta la forma de `STAGE_VERIFIED` que emite `events.ts`; se retiró `metrics.tokens` (sin lectores en `ui/`) junto con el campo `usage` que lo alimentaba; y en los routers, los alias `/task` y `/discovery` y las ramas `reject`/`modify` de `/confirm-plan` (la cita `§3.2.4` también salió).

## Seguridad y configuración

| Punto | Evidencia | Recomendación |
| --- | --- | --- |
| **`POST /config` guarda un comando que se ejecuta en el próximo arranque** (prioridad alta) | `jarvisRouter` pasa `req.body` a `ConfigManager.updateConfig`, y `normalize` (`config.ts`) solo valida tipos: acepta cualquier `desktopCommanderMcp.command`, `args`, `env`, `cwd` y `allowedDirectories`, y lo persiste en `jarvis-config.json`. El transporte copia esa configuración al construirse (`server.ts`), así que el cambio no actúa en vivo ni con `/reconnect`, pero sí en el siguiente arranque, donde `transport.ts` hace `spawn(command, args)` con `shell: true` en Windows (cmd.exe interpreta los argumentos). Un cambio guardado desde cualquier proceso o página local ejecuta un binario arbitrario la próxima vez que se inicie Jarvis, sin pasar por `Guard`. También permite redirigir `qwenUrl` y `decisionUrl`, a donde viaja el contenido de las tareas | Aceptar por HTTP solo una lista cerrada de campos (URLs, modelos, timeouts, `thinking`, trazas) y dejar la definición de los servidores MCP solo en `jarvis-config.json`. Confirmar antes si la UI edita esos campos |
| `allowedDirectories` vacío no restringe nada | `desktopCommanderMcp.ts` solo valida rutas si la lista tiene elementos, y el valor por defecto es `[]`. Solo cubre los argumentos de ruta que conoce (`path`, `paths`, `source`, `destination`, `directory`, `file`); el `command` de `start_process` no se restringe (lo cubre la aprobación de `Guard`). La lista se lee una sola vez al construir el adaptador, así que cambiarla por `POST /config` no tiene efecto hasta reiniciar | Decidir si vacío debe significar "nada permitido" o documentarlo en la configuración |
| Desktop Commander sin versión fijada | `config.ts`: `npx -y @wonderwhy-er/desktop-commander`, mientras `free-search-mcp` y `selectolax` sí van fijados. Los extractores (`process.ts`, `files.ts`) leen textos exactos de Desktop Commander (`Process started with PID`, `[Reading N lines…]`): un cambio de formato en una versión nueva rompe pid, exit code y detección de archivo vacío sin error de compilación. `-y` además instala y ejecuta el paquete sin confirmación | Fijar la versión, como ya se hizo con `free-search-mcp` |
| Trazas activas por defecto, sin rotación | `traceEnabled: true`. `taskTrace.ts` agrega a `jarvis-traces.jsonl` (en el directorio de trabajo) el mensaje del usuario, los `args` de cada llamada (incluido el contenido de archivos escritos), los `rawInput`/`rawOutput` de los modelos y hasta 20.000 caracteres por resultado. Crece sin límite | Dejar activo (lo consume `lab/`), pero definir rotación o tope de tamaño, y confirmar que el archivo está en `.gitignore` |
| Objetivo ambiguo en `/approve` y `/deny` | `JarvisCore.getPendingApproval(undefined)` devuelve la primera aprobación pendiente de **cualquier** tarea. La UI ya envía siempre `taskBody(taskId)`, así que exigir `taskId` es de bajo riesgo | Exigir `taskId` (400 si falta). Confirmar que `taskBody` nunca envía `undefined` |

## Estructural

| Punto | Evidencia en el código | Qué implica cambiarlo | Recomendación |
| --- | --- | --- | --- |
| D2. Llamadas MCP no cancelables | `callExecutor.ts:474`: `server.callTool(tool.name, args)` sin señal; al cancelar, el resultado tardío se descarta y la herramienta sigue corriendo | Señal opcional en `mcp/types.ts`, en los servidores MCP y en los transportes | Dejar, salvo un caso real (búsqueda larga imposible de parar) |
| D3. `stepIndex` según quién emite | `callExecutor.ts:397, 421, 444` emiten sin `stepIndex`; `modeEngines.ts` siempre lo incluye. `stepEvents.ts` lo documenta como diseño | Cambia el contrato SSE que consume la UI | Dejar |
| D8-a. Estado mutable compartido | Asignaciones directas a `task.state` y `step.state`: `modeEngines.ts` 14, `callExecutor.ts` 6, `core.ts` 5, `taskConclusion.ts` 2 | Extraer una máquina de estados obliga a reordenar eventos | Dejar |
| D8-c. Singletons y estado global | `ConfigManager` (`decision.ts`, `qwen.ts` 7 usos, `taskTrace.ts`, `jarvisRouter.ts`); `RefStore` estático (`core.ts:356`, `context.ts`, `taskTrace.ts`, `resultProcessor.ts`, `refResolver.ts`); caché de módulo en `getUserEnvironment()`; `warnedNotes` en `manifest.ts`; `Guard` estático | Hacerlos inyectables toca cada módulo que los usa. Hoy impide aislar la configuración o las referencias en un test | Dejar, salvo que se necesiten pruebas con configuración distinta |
| D8-e. Varios vocabularios de estado | `types/execution.ts`: `CallStatus` (por llamada), `StepExecutionStatus` (por ejecución de paso), `StepState` y `VerificationState` en mayúsculas; "unverified" aparece con tres grafías. El nombre del anti-loop ya coincide (`loop_blocked`). `classifyCall` y `settleCall` traducen entre ellos | Unificar cambia el resultado que consume `modeEngines` | Dejar |
| Memoria de `RefStore` sin tope por llamada | `resultProcessor.ts` guarda el `fullText` completo de cada llamada (solo se le quitan espacios en los extremos). `RefStore.clear` lo libera únicamente cuando la tarea se expulsa del historial, y `MAX_RETAINED_TASKS` es 20, así que hasta 20 tareas conservan sus resultados íntegros (una lectura grande de `read_file` o `fetch` ocupa lo mismo que su texto) | Topar el tamaño por referencia, o dejarlo si las lecturas grandes son raras | Dejar, salvo lecturas de archivos muy grandes |

## API HTTP (`jarvisRouter.ts`, `mcpRouter.ts`)

| Punto | Evidencia | Recomendación |
| --- | --- | --- |
| Tres criterios para "tarea objetivo" sin `taskId` | `/cancel` toma la primera tarea en `RUNNING`; `/confirm-plan`, `/reject-plan`, `/modify-plan` y `/user-answer` toman la última; `/approve` y `/deny` la primera con aprobación pendiente | Resolver junto con el punto de `/approve` y `/deny`: exigir siempre `taskId` |
| Convención de errores distinta | `jarvisRouter` responde 4xx/5xx; `mcpRouter` responde 200 con `{ error }` o `isError` en `/discover-all`, `/:server/tools`, `/:server/reconnect` y `/:server/call` | Dejar si el consumidor ya depende de ello |
| `catch (err: any)` en los routers | 9 ocurrencias (4 en `mcpRouter.ts`, 5 en `jarvisRouter.ts`); `server.ts` ya usa `unknown` | Cambiar a `unknown` y leer el mensaje con `errorMessage` de `utils.ts` |

## Adaptadores MCP y modelos

| Punto | Evidencia | Recomendación |
| --- | --- | --- |
| Los cambios de configuración de MCP no se aplican en vivo | `StdioMcpTransport` y `DesktopCommanderMCPServer` copian `command`, `args`, `env`, `cwd` y `allowedDirectories` al construirse. Solo `mcpTimeoutMs` se relee en cada llamada. `POST /config` y `updateConfig` sugieren lo contrario | Decidido: sin cambios por ahora (se retoma con seguridad) |
| `IMCPServer.version` sin uso y con valores fijos | Sin consumidores en `src/`. `DesktopCommanderMCPServer` declara `"2.1.0"` aunque el paquete no está fijado (`npx -y` sin versión); `FreeSearchMCPServer` declara `"0.13.1"`, que además repite la versión de `config.ts` | Eliminar el campo, o derivarlo del servidor al inicializar |
| `close()` no termina el árbol fuera de Windows ni espera a `taskkill` | En Windows lanza `taskkill /T /F` sin esperar a que termine, y `server.ts` hace `process.exit(0)` justo después de `Promise.allSettled`. En Linux y macOS solo envía SIGTERM al hijo directo, así que `npx` puede dejar el proceso `node` huérfano | Esperar el cierre del proceso; terminar el grupo de procesos fuera de Windows si se usa en otras plataformas |
| Cadenas mágicas entre adaptador y procesador | `desktopCommanderMcp.ts` emite `[DENIED]` y `resultProcessor.ts` lo reconoce al inicio del texto (igual con `[NOT_FOUND]`), sin una constante compartida | Una constante común |
| `any` en `transport.ts` | 5 usos: `resolve`, `reject`, `msg` y dos `catch (err: any)` | Pasar a `unknown` |
| `modelIterations.ts` no usa el tipado de eventos | `fromStageVerified` ya lee `CoreEventDataMap["STAGE_VERIFIED"]`, pero el resto de los constructores sigue declarando interfaces de payload propias con campos opcionales (`ModelExchange` y derivadas): un cambio en `events.ts` no rompe la compilación ahí | Derivar el resto de los payloads de `CoreEventDataMap`, un evento por vez |
| `modelIterations.ts` depende de `context.ts` | Lo comparte la UI (`createIterationFromEvent`) pero importa `buildEffectsContext` de `context.ts`, que arrastra `RefStore`, el manifest y el resto del contexto de ejecución | Mover `buildEffectsContext` a un módulo sin esas dependencias |
| Recorte redundante de la descripción de las herramientas | `shortDesc` (`prompts.ts:153`) recorta a `MAX_TOOL_DESC_CHARS`, pero el manifest ya rechaza al arrancar una descripción más larga y `applyDestination` la sustituye por la del manifest | Dejar como defensa, o retirar el recorte |
| Nombres de modelo fijos frente a la configuración | El log de verificación ya muestra `decisionModel` con el backend `d3`. `models.ts` y `ModelType` siguen fijando `"Qwen 3.5 9B"` y `"Eos-0.8B"`, que son las etiquetas de la UI aunque `qwenModel`, `decisionBackend` y `decisionModel` sean configurables | Derivar las etiquetas de la UI de la configuración, o aceptar que son fijas |

## Capas y código sin uso

| Punto | Evidencia | Recomendación |
| --- | --- | --- |
| `events.ts` depende de `processor/resultProcessor.ts` | Importa `ProcessedResult` solo como tipo, pero invierte las capas: el contrato de eventos, en la base, depende de un módulo de procesamiento que a su vez importa extractores y manifest. Es la raíz de ocho de los nueve ciclos de `madge`. Todos son de tipos, sin efecto en ejecución | Mover `ProcessedResult` a `types/` si algún día se quiere un grafo limpio sin configuración; si no, dejar |
| Ciclo `types/execution.ts ↔ types/task.ts` | El noveno ciclo de `madge`: `task.ts` importa `StepCall`, `Evidence` y otros de `execution.ts`, y `execution.ts` importa `Step` de `task.ts` solo para `StepExecutionResult`. Todo es de tipos | Mover `StepExecutionResult` a `task.ts`: el barril lo re-exporta igual y no cambia ningún import externo |
| `types/plan.ts` importa `UserEnvironment` de `environment.ts` | `environment.ts` usa APIs de Node. Hoy es `import type` y se borra al compilar | Dejar, manteniéndolo como `import type` |
| Recorte de texto con helpers dispersos y marcas distintas | `utils.clip`/`clipTail`, `text.clipAtWord`, `sanitizeForMemory` (termina en `...`), `fitFinding` y `headTail` (`…`), y `clipObs`/`tailLines`/`fitEvidence` en `prompts.ts` | Unificar solo si se vuelve a tocar el recorte |
| `processor/text.ts` y `RefStore` los usa todo el núcleo | `context.ts`, `core.ts`, `taskConclusion.ts` y `modeEngines.ts` los importan desde `processor/`, aunque `text.ts` se declara "sin dependencias" y existe `utils.ts` | Dejar, o moverlos a la raíz de `core/` |

## Duplicaciones y estilo

| Punto | Estado actual | Acción posible |
| --- | --- | --- |
| Límites de memoria con literales | `buildHistoryContext` ya usa `PROGRESSIVE_MEMORY_TIERS[0]` como valor por defecto. Quedan `DECISION_MEMORY_LINES = 2` (concepto distinto: líneas que ve Decision #2), `buildEffectsContext(limit = 5)`, `buildRefsContext(limit = 8)` y `RefStore.describe(limit = 5)` | Nombrar las constantes restantes si se vuelve a tocar el contexto |
| Números mágicos en los extractores | `files.ts` (8, 40, 30, 15), `freeSearch.ts` (300), `process.ts` (90, 60, 30), sin las constantes nombradas que sí tiene `context.ts` | Nombrarlos si se vuelve a tocar el formato |
| Inicializadores sin efecto | `let finding = ""; let compactObs = "";` se reasignan siempre antes de usarse en cuatro extractores | Declarar con `const` donde se asignan |
| `any` en el contrato de extractores | `mergedData: Record<string, any>` en `extractors/types.ts` y `resultProcessor.ts`; solo el segundo lleva `eslint-disable` | Pasar a `Record<string, unknown>` o unificar el tratamiento |
| Estilo mezclado | 4 espacios: `callExecutor`, `modeEngines`, `taskConclusion`, `stepEvents`, `engineDeps`, `environment`, `llmTransport`, `utils`, `context`, `taskTrace`, `refStore`, `text` y todos los extractores. 2 espacios: `types/*`, `core`, `server`, `decision`, `discovery`, `qwen`, `prompts`, `config`, `manifest`, `refResolver`, `resultProcessor` | Dejar o formatear cuando se decida |
| Prompt de planificación | `prompts.ts`, `PLAN.SYSTEM`: las primeras seis líneas están en inglés y la séptima queda unida con doble espacio (`…exhaustive analysis.  Descompón…`). Existe una copia en `scripts/eval/llm/prompts/Q1.ts` (sin confirmar) | Cambia la entrada a Qwen: decisión tuya |

## Logs

Decidido: los logs con datos de la tarea se dejan. El conteo del informe anterior (52 llamadas a `console.*`) estaba incompleto. En los archivos revisados hay 86: `modeEngines` 24, `qwen` 10, `callExecutor` 9, `core` 8, `decision` 7, `server` 7, `taskConclusion` 6, `transport` 6, `config` 2, y 1 en cada uno de `environment`, `llmTransport`, `discovery`, `context`, `taskTrace`, `manifest` y `refResolver`. `decision.ts` registra los primeros 200 caracteres de `state` y `questions`, y 600 de la respuesta. Reabrir solo si los logs salen de la máquina local. El archivo de trazas (ver Seguridad) es un caso aparte: persiste datos de las tareas en disco.
