# Evolución del backend (`src/` y `server.tsx`) para mayor visibilidad en UI, tiempo real y configuración en caliente

**Fecha:** 2026-11-16  
**Alcance:** Investigación de solo lectura sobre el estado actual del backend (`src/` y `server.tsx`) para tres objetivos:
1. Exponer más información útil hacia la UI.
2. Habilitar actualizaciones y streaming en tiempo real hacia la UI.
3. Permitir que la configuración (`jarvis-config.json` / `ConfigManager` / servicios) se actualice sin reiniciar JARVIS.

En cada frente, las modificaciones y opciones propuestas están **ordenadas estrictamente de menor a mayor complejidad agregada al backend** (impacto en contratos, concurrencia, persistencia, ciclo de vida de subprocesos y riesgo de regresiones).

---

## 0. Línea base verificada en el código actual

Antes de proponer cambios, este es el flujo real verificado en `src/` y `server.tsx`:

- **Composición al arranque (`server.tsx`)**: `main()` instancia una sola vez `DesktopCommanderMCPServer`, `FreeSearchMCPServer`, `TerminalProvider`, `WebSearchProvider`, `DiscoveryEngine`, `Decision20Engine`, `QwenEngine`, `TaskManager`, el ciclo `startRetention` (cada 6 h) y opcionalmente `startTelegram`.
- **Estado de cada tarea (`src/core/tasks.ts`, `src/core/ctx/context.ts`, `src/core/engine/runtime.ts`)**:
  - `TaskContext` (`ctx`) persiste los hechos del dominio vía `apply()` en `data/tasks/<id>.jsonl` (`src/core/taskLog.ts`) y emite eventos `change` síncronos con `{ n, at, ops }`.
  - `TaskRuntime` (`runtime`) mantiene el estado efímero de flujo (`waiting`, `paused`, `alwaysApproved`, `userRejected`, `AbortController`) y emite `onChange` (`waiting`) y `onPause` (`paused`).
  - `TaskTraceRecorder` (`src/core/trace/recorder.ts`) escucha `CaptureSink` (`llm` y `tool`), `ctx.on("change")`, `onWaiting` y `onPaused`, acumula todo en RAM y **recién lo escribe a disco en `finish()`**, al terminar la tarea.
- **Transporte HTTP/SSE (`src/server/jarvisRouter.ts`)**:
  - `GET /api/jarvis/events` emite por SSE únicamente 4 tipos de `TaskEvent`: `created`, `change` (`ops`), `waiting` y `paused`.
  - `GET /api/jarvis/state` devuelve `{ task, tasks, discoveredTools, unavailableServers }`, ejecutando `await discoveryEngine.discoverAll()` en cada consulta.
  - `GET /api/jarvis/tasks/:taskId/trace` lee exclusivamente archivos ya cerrados en disco (`summary.md`, `trace.json`, `full.json.gz`), devolviendo `404` mientras la tarea sigue en curso.
- **Configuración (`src/core/config.ts`, `src/core/engine/services.ts`, `src/server/jarvisRouter.ts`)**:
  - `ConfigManager` carga `jarvis-config.json` una sola vez al iniciar (`static currentConfig`) y expone `getConfig()` / `updateConfig(patch)`.
  - `POST /api/jarvis/config` pasa el cuerpo por `withoutLaunchFields()`, que descarta `FILE_ONLY_KEYS` (`refsDir`, `tracePath`) y `LAUNCH_ONLY_KEYS` (`command`, `args`, `env`, `cwd` de `desktopCommanderMcp` y `freeSearchMcp`).

---

## 1. Frente 1 — Mostrar más información en la UI

### 1.0 Datos que el backend ya envía hoy (sin cambios de backend)

Antes de modificar `src/`, conviene distinguir qué información **ya viaja en `TaskDto`** (`src/core/tasks.ts` + `src/core/ctx/types.ts`) y hoy puede consumirse directamente desde la UI sin costo en backend:
- `recalled`: entradas de `user_memory` y `thread` (`source`, `key`, `value`, `from`, `stepId`, `at`).
- `errors`: registros `service_unavailable` por `stepId`.
- `facts`: incluyendo `facts.process` (PIDs activos conocidos por el paso) y `answer_*` (respuestas del usuario e incluso el sufijo `_p<pid>`).
- `paused`: `{ since, model }` cuando la tarea está pausada por modelo no disponible.
- `calls[].sig`, `calls[].kind`, `calls[].verdict`, `calls[].reason`, `calls[].ref` y `plans[].trigger`/`feedback`/`stepId`.

### 1.1 Nivel 1 — Complejidad Baja (proyecciones de solo lectura sin tocar el motor)

Cambios localizados en `jarvisRouter.ts`, `TaskManager` (`tasks.ts`) o `limits.ts`, sin alterar `runTask`, `TaskContext` ni `TaskRuntime`.

1. **Diagnósticos operativos de `TaskManager` y límites completos (`GET /state` o `GET /diagnostics`, `GET /limits`)**
   - **Qué falta exponer**:
     - En `TaskManager` (`src/core/tasks.ts`): `activeCount()` vs `MAX_ACTIVE_TASKS` (`4`), cantidad en RAM vs `MAX_RETAINED_TASKS` (`20`), mapa `unreadable` (logs corruptos que no se cargaron, con su motivo) y `restartedOnStartup` (tareas interrumpidas al reiniciar el servidor).
     - En `DiscoveryEngine` (`src/core/mcp/discovery.ts`) y `StdioMcpTransport` (`src/core/mcp/transport.ts`): hoy `unavailableServers` muestra servidores fallidos, pero no el estado vivo de cada proveedor (`isConnected()`, `version`, `permanentFailure`, cantidad de herramientas en caché y antigüedad de la caché `lastFetched`).
     - En `GET /limits` (`src/core/engine/limits.ts`): `limitValues()` solo devuelve los 14 topes de `LIMIT_SCOPES`; quedan fuera otros topes útiles de `BUDGET` (`src/core/budget.ts`), `MAX_ACTIVE_TASKS`, `MAX_RETAINED_TASKS`, `MAX_LIVE_PROCESSES` (`8`) y `THREAD_TTL_MS` (`10 min`).
   - **Archivos a tocar**: `src/core/tasks.ts` (getters de solo lectura), `src/core/mcp/discovery.ts` (estado por servidor), `src/core/engine/limits.ts`, `src/server/jarvisRouter.ts`.
   - **Complejidad y riesgo**: Muy bajos; solo lectura de estructuras ya existentes.

2. **Lectura paginada / parcial de `refs` (`GET /tasks/:taskId/refs/:refId`)**
   - **Qué falta exponer**: hoy `readRef` (`src/core/tasks.ts` + `src/core/refs/refVault.ts`) lee y devuelve hasta `REF_MAX_CHARS` (`5_000_000` caracteres) en bloque como `text/plain`. Para archivos o salidas grandes, la UI no puede pedir solo los primeros/últimos N bytes o un rango paginado con tamaño total.
   - **Implementación**: agregar query params opcionales `?offset=&limit=` (o `?head=&tail=`) y cabeceras/JSON opcional con `size` real.
   - **Archivos a tocar**: `src/core/refs/refVault.ts`, `src/core/tasks.ts`, `src/server/jarvisRouter.ts`.
   - **Complejidad y riesgo**: Bajos; retrocompatible si sin parámetros sigue devolviendo `text/plain` completo.

3. **Inspección de procesos vivos y finalizados de terminal (`GET /processes` o dentro de `/diagnostics`)**
   - **Qué falta exponer**: `TerminalProvider` (`src/tools/terminal/terminalProvider.ts`) mantiene en RAM `procs` (`pid`, `taskId`, `command`, `cwd`, `startedAt`, `done`, `detached`, `orphan`, `waitingPrompt`, `totalChars`, `outputChars`) y `ended` (`exitCode`, `stopped`, `durationMs`). La UI solo ve esto si el modelo llama a `list_processes`.
   - **Implementación**: método de solo lectura `getProcessSnapshot()` en `TerminalProvider` expuesto en `jarvisRouter.ts` (y opcionalmente acción de UI para detener procesos huérfanos).
   - **Archivos a tocar**: `src/tools/terminal/terminalProvider.ts`, `src/server/jarvisRouter.ts` (o `server.tsx` al pasar el snapshot).
   - **Complejidad y riesgo**: Bajos (solo lectura de `Map`s en memoria).

### 1.2 Nivel 2 — Complejidad Media (extender `TaskRuntime` y `TaskDto` con estado efímero del motor)

Requiere instrumentar puntos concretos del motor (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `finalize.ts`) hacia `TaskRuntime`, **sin alterar `TaskContext` ni el esquema de `taskLog.ts`**.

1. **Sub-fase activa en vuelo (`activity` en `TaskRuntime` y `TaskDto`)**
   - **Problema actual**: en `callRunner.ts`, una llamada (`CallDraft`) recién se registra en `TaskContext` cuando termina (`register()` en línea 135/582). Durante todo el tiempo que la tarea consulta modelos o espera a una herramienta, la UI solo ve el paso en estado `running` sin saber si está clasificando (D0), planificando, eligiendo ruta (D1), eligiendo herramienta (D2), generando argumentos (LLM), revisando argumentos (D3), ejecutando `callTool`, verificando (D4/sondas), evaluando cierre (D5) o redactando la respuesta final (LLM 3).
   - **Implementación**:
     - Definir `TaskActivity` en `src/core/engine/runtime.ts`: `{ stage, stepId, route?, tool?, attempt?, startedAt, detail? }` (o `null` cuando está en espera/terminada).
     - Actualizar `runtime.setActivity(...)` en los bordes de `runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `verify.ts`, `planner.ts`, `pending.ts`, `finalize.ts`.
     - Incluir `activity: TaskActivity | null` en `TaskDto` (`src/core/tasks.ts`).
   - **Complejidad y riesgo**: Medios; no rompe `TaskContext` ni logs en disco, solo requiere limpiar siempre en bloques `finally` al cancelar/cerrar.

2. **Estado reactivo oculto y resultado de D0/hilo (`reactiveState` en `TaskRuntime` / `TaskDto`)**
   - **Qué vive solo como variables locales en `runTask.ts`**:
     - En `runReactive` (`src/core/engine/runTask.ts:79-85`): `pending: string[]` (cola de pendientes restante), `settled: string[]` (ítems cumplidos/abandonados), `abandoned: number`, `headFailures: number`, `reopens: number`.
     - Resultado de D0 (`classifyRequest` en `src/core/engine/classify.ts`): si clasificó como `chat`, `single`, `multi` o degradó por fallo, más `probabilities` y `multi`.
     - Resultado de `detectContinuation` (`follows` vs umbral `CONTINUATION_APPROVE`), incluso cuando quedó por debajo y no generó entrada en `recalled`.
     - Última probabilidad de D5 (`env.completion.last` en `src/core/engine/env.ts` y `completion.ts`).
   - **Implementación**: espejar estos datos en `TaskRuntime` (o en un objeto `executionMeta` dentro de `TaskDto`), ya que por diseño `TaskContext` no guarda la lista de pendientes ni probabilidades (`principio 5`).
   - **Archivos a tocar**: `src/core/engine/runtime.ts`, `src/core/engine/runTask.ts`, `src/core/engine/classify.ts`, `src/core/engine/completion.ts`, `src/core/tasks.ts`.

3. **Metadatos de seguridad, aprobaciones recordadas y preguntas tipadas (`Guard` / `Tiers` / `Blacklist` / `PendingQuestion`)**
   - **Qué falta hoy en `TaskDto` y `Waiting`**:
     - `PendingQuestion` (`src/core/engine/runtime.ts:56-59`) no tiene `id` propio (a diferencia de `ApprovalRequest` y `PlanApprovalRequest`) ni distingue si la pregunta viene del modelo (`ask_user`) o de un proceso en vivo (`waiting_input` + `pid`). Eso impide validar `waitId` en `POST /user-answer` o mostrar badge específico de terminal interactiva.
     - `ApprovalRequest` no incluye el `tier` calculado (`green` / `yellow` / `red` de `tiers.ts`) ni el detalle de `blacklistMatch` (`id`, `level`), ni se expone qué claves están activas en `runtime.alwaysApproved` y `runtime.userRejected`.
     - Falta `startedAt` de cada intento en `Call` (hoy `Call.at` es el instante en que se registró tras terminar; la duración real de la herramienta o de D1–D4 no está en `TaskDto`, solo en la traza post-mortem).
   - **Opciones**:
     - *Opción A (solo en `TaskRuntime` / `TaskDto`)*: agregar `id` y `source` (`"model" | "process"`) + `pid?` a `PendingQuestion`, enriquecer `ApprovalRequest` con `tier?` y `blacklist?`, y exponer `rememberedApprovalsCount` / `rejectedKeysCount` en `TaskDto`.
     - *Opción B (incluye duración por llamada)*: calcular `durationMs` en `callRunner.ts` y adjuntarlo en un mapa auxiliar `callTimings` en `TaskRuntime` (sin tocar `TaskContext`).

### 1.3 Nivel 3 — Complejidad Alta (traza en vivo, sub-llamadas y ampliación del esquema de contexto)

1. **Inspección en vivo de la traza mientras la tarea está `running`**
   - **Problema actual**: `TaskTraceRecorder` (`src/core/trace/recorder.ts`) ya tiene en memoria `models[]`, `tools[]`, `waits[]`, `pauses[]`, `refSizes` y `rawResults`, pero `release()` borra todo tras `finish()` y `jarvisRouter.ts` (`GET /tasks/:taskId/trace`) lee solo del disco cuando la tarea ya cerró.
   - **Implementación**:
     - Añadir `recorder.liveSnapshot()` en `TaskTraceRecorder` que devuelva `{ models: this.models.map(slimQuery), tools: this.tools.map(slimTool), waits: [...], pauses: [...] }` sin esperar a `finish()` (y manteniendo fuera `rawResults` sin serializar para no bloquear el event loop).
     - En `TaskManager.getTrace(taskId, format)` / `jarvisRouter.ts`: si la tarea sigue viva en `this.tasks`, servir `recorder.liveSnapshot()` para `?format=json` o `buildSummary(...)` para `?format=summary`; si ya terminó o fue expulsada de RAM, hacer fallback a `readTraceFile(...)` en disco.
     - Opcionalmente, extraer también de `LLMValidationError.attempts` (`qwen.ts:506`) los intentos inválidos previos (hoy `capture.ts:48` solo lee `error.raw` del último intento, perdiendo los `failedAttempts` previos si falló o si reintentó con éxito en el 2.º intento).
   - **Archivos a tocar**: `src/core/trace/recorder.ts`, `src/core/trace/format.ts`, `src/core/models/qwen.ts`, `src/core/engine/capture.ts`, `src/core/tasks.ts`, `src/server/jarvisRouter.ts`.
   - **Complejidad y riesgo**: Altos por cuidado de memoria/CPU (no serializar `rawResults` pesados en caliente ni bloquear el loop si la UI consulta repetidamente).

2. **Progreso estructurado de herramientas compuestas (`web_search` y `ToolHost`)**
   - `WebSearchProvider` (`src/tools/web/webSearchProvider.ts`) ejecuta internamente `search` → `judge.score` (extractos) → `fetch` (N páginas) → `read_doc` (`readWhole`) → `judge.score`, y `judgeMeta` queda solo dentro de `meta` del `MCPCallResult` (descartado parcialmente al resumir en `processResult` o guardado en la traza cruda).
   - Exponer métricas de búsqueda (fuentes encontradas, páginas bloqueadas, si usó juez 2B o cayó a BM25, URLs leídas) requiere o bien ampliar `Call`/resumen o emitir metadatos desde `ToolHost` / `CaptureSink` hacia `TaskRuntime`/`TaskTraceRecorder`.

3. **Persistir más campos en el historial (`TaskContext` + `taskLog.ts`)**
   - Si se desea que campos como `Call.durationMs`, `Call.tier`, `D0` o la evolución de `pending` sobrevivan al reinicio del servidor y al desalojo de RAM (`MAX_RETAINED_TASKS = 20`), hay que extender `ContextData`/`Op` (`src/core/ctx/types.ts`, `apply.ts`, `validate.ts`) y actualizar `LOG_SCHEMA_VERSION` + `convertLogSchema` (`src/core/taskLog.ts`) manteniendo compatibilidad hacia atrás con logs v1 existentes.

---

## 2. Frente 2 — Mostrar información en tiempo real en la UI

### 2.0 Cuellos de botella actuales del modelo SSE + `GET /state`

Hoy la UI abre `EventSource("/api/jarvis/events")`, recibe `created` / `change` / `waiting` / `paused`, y vuelve a pedir `GET /api/jarvis/state`. Eso genera tres limitaciones reales en `src/`:
1. **Refetch pesado**: cada `GET /state` ejecuta `await discoveryEngine.discoverAll()` y serializa el `TaskDto` completo + `tasks[]` completo, aunque solo haya cambiado un veredicto o una `waiting`.
2. **Silencios largos entre `apply()`**: entre `add steps` y `add calls` pueden pasar **20–180 segundos** (pensamiento + generación de argumentos + ejecución de `run_command` / `web_search` + verificación D4) sin ningún evento SSE, salvo que ocurra una espera o una pausa de modelo.
3. **Sin streaming de salida**: `QwenEngine` envía `stream: false` (`src/core/models/qwen.ts:401`) y `TerminalProvider` acumula stdout/stderr en `OutputBuffer` hasta `settle()` (`src/tools/terminal/terminalProvider.ts:580`).

### 2.1 Nivel 1 — Complejidad Baja (aprovechar y aligerar lo ya existente en SSE y REST)

1. **Aplicar deltas `ops` en el cliente en vez de refetch completo de `GET /state`**
   - **Qué ya existe en el back**: el evento `change` (`src/core/tasks.ts:78`) ya transporta `{ taskId, n, at, ops }` con las `NormalizedOp` exactas (`add plans/steps/calls/errors/refs/recalled`, `update` de paso/llamada, `set facts.*/result`, `finish`).
   - **Qué falta en el back**:
     - Al conectar `GET /api/jarvis/events`, el cliente puede perder eventos entre `GET /state` y `EventSource`. Agregar soporte de evento inicial `hello` / `snapshot` (o parámetro `?taskId=` + `Last-Event-ID` con pequeño ring buffer de eventos recientes en `TaskManager`) elimina la ventana de carrera.
     - Incluir en `created` el `TaskSummary` completo (no solo `{ taskId, n }`) y emitir `summary` (o derivarlo en UI desde `ops`) para no tener que refetching `tasks[]`.
     - Crear endpoint ligero `GET /api/jarvis/tasks/:taskId` que devuelva solo `TaskDto` sin ejecutar `discoveryEngine.discoverAll()`.
   - **Archivos a tocar**: `src/core/tasks.ts`, `src/server/jarvisRouter.ts`.
   - **Complejidad y riesgo**: Bajos; el contrato de `ops` ya existe y es inmutable/congelado en `TaskContext`.

2. **Separar el catálogo MCP de `/state` y notificar cambios por SSE**
   - `GET /state` llama a `discoveryEngine.discoverAll()` en cada refetch (`jarvisRouter.ts:186`). Aunque `DiscoveryEngine` tiene TTL de 30 s (`TOOLS_CACHE_TTL_MS`), si un servidor falla o caduca el TTL, bloquea `/state`.
   - Emitir un evento SSE `discovery` cuando `discoverAll(true)` / `refresh-discovery` actualiza herramientas o cambia `unavailableServers`, y añadir una variante `GET /state?includeTools=0` (o leer solo caché síncrona en `/state` dejando el refresco asíncrono aparte).

3. **Evento SSE para cambio de configuración y procesos**
   - Emitir evento SSE `config` (con `sanitizeConfigForHttp`) cada vez que `ConfigManager.updateConfig` modifica valores (por ejemplo si Telegram ejecuta `/auto on` o `/voz on` mientras la UI está abierta — hoy la UI no se entera en tiempo real cuando Telegram cambia `autoMode` o `voiceEnabled`).

### 2.2 Nivel 2 — Complejidad Media (eventos granulares de ejecución y traza en vivo)

1. **Evento SSE `activity` (sub-etapa actual en tiempo real)**
   - Exponer desde `TaskRuntime` (`onActivity`) → `TaskManager` (`TaskEvent` tipo `"activity"`) → SSE cada transición de etapa (`continuation`, `first_query`, `pending`, `plan`, `route`, `tool`, `args`, `review`, `tool_exec`, `verify`, `probe`, `completion`, `ask`, `final`) con `{ taskId, activity }`.
   - Permite mostrar un indicador vivo exacto ("D2 eligiendo herramienta en `desktop_commander`…", "Ejecutando `web_search`…", "D4 verificando resultado…") en lugar de un spinner genérico.
   - **Consideración de back**: usar throttle mínimo o emisión solo en cambio de etapa (unas 5–15 veces por paso), por lo que no satura SSE ni a `telegram/bot.ts` (que simplemente ignora tipos de evento que no maneja en `handle()`).

2. **Eventos SSE de traza incremental (`trace_model`, `trace_tool`)**
   - En `TaskTraceRecorder` (`onModel` y `onTool`), además de guardar en `this.models` y `this.tools`, emitir un callback opcional hacia `TaskManager` con el registro `slimQuery` / `slimTool` recién completado.
   - Puede ir en el mismo `/events` (bajo opt-in `?include=trace` para no enviar payload extra a Telegram o clientes simples) o en un stream específico `/api/jarvis/tasks/:taskId/trace/events`.

3. **Evento SSE para cola `pending` reactiva (`reactive_pending`)**
   - Emitir `{ taskId, pending, settled, abandoned }` cuando `generatePending` devuelve lista o `runReactive` consume/abandona un ítem (`runTask.ts:122-183`). Da visibilidad inmediata de cuántos pasos faltan en modo reactivo.

### 2.3 Nivel 3 — Complejidad Alta (streaming continuo de modelos y stdout de terminal)

1. **Streaming en vivo de salida de `run_command` y herramientas largas**
   - **Base existente**: `TerminalProvider.collect()` (`src/tools/terminal/terminalProvider.ts:488-515`) ya decodifica `stdout` y `stderr` chunk a chunk en UTF-8 / OEM (`OutputDecoder` + `LineAssembler`) y dispara `t.events.emit("activity")`.
   - **Qué hay que modificar**:
     - Extender `ToolCallOptions` (`src/core/tools/provider.ts`) con `onProgress?: (chunk: ToolProgress) => void` (líneas limpias recién ensambladas, `pid`, `stream: "stdout" | "stderr"`).
     - En `TerminalProvider.collect()`, enviar los fragmentos nuevos al `onProgress` de la llamada activa (con batching/throttle cada ~100–250 ms y tope de tamaño por evento para no disparar `SSE_MAX_BUFFERED_BYTES` de 4 MB en comandos ruidosos como `npm install` o `dir /s`).
     - Propagar desde `callRunner.ts` → `TaskRuntime` → `TaskManager` → SSE (`tool_output` con `{ taskId, stepId, tool, pid?, chunk }`).
     - Manejar cancelación (`raceCancel`): si se cancela la llamada en vuelo, dejar de emitir chunks de esa llamada inmediatamente aunque el proceso tarde unos ms en cerrarse.
   - **Complejidad y riesgo**: Altos; requiere control estricto de backpressure/rate-limit para evitar congelar el navegador o desconectar el SSE por buffer excedido.

2. **Streaming de tokens del LLM generativo (`QwenEngine` con `stream: true`)**
   - **Estado actual**: `QwenEngine.buildRequestBody()` fija `stream: false` (`src/core/models/qwen.ts:401`) y `postJson()` (`src/core/models/transport.ts:135`) espera `await response.text()`.
   - **Por qué es complejo en JARVIS y opciones por orden**:
     - *Opción A (Complejidad Media-Alta — streaming solo en `final_response` y `generateQuestion`)*:
       - Son las únicas etapas de texto libre para el usuario.
       - Requiere agregar `postSseStream()` en `src/core/models/transport.ts` para leer frames `data: {...}` de `/v1/chat/completions` (`choices[0].delta.content` y posible `reasoning_content` / bloques `<think>`), manteniendo el `AbortSignal` y el timeout.
       - **Retos específicos verificados en el código**:
         1. *Filtrado de `<think>`*: `qwen.ts:83-106` aplica `stripThink` por seguridad para que el razonamiento no salga mezclado; en streaming se necesita una máquina de estados incremental que separe `<think>...</think>` (para ocultarlo o enviarlo en un canal separado `thinkingDelta`).
         2. *Reintento de Qwen*: si la primera respuesta sale vacía o truncada (`dispatchValidated` en `qwen.ts:481`), hay un reintento automático; el SSE debe poder enviar `llm_stream_reset` para descartar un intento abortado/vacío.
         3. *Post-procesamiento en `finalize.ts`*: `finalize.ts:72-78` antepone `renderStatusNote` (si la tarea fue parcial/fallida), aplica `stripNoChangesFiller` (DN-2.10) y agrega `renderPlaceNote` al final. Con streaming hay que emitir el encabezado fijo antes de empezar el stream y al cerrar enviar el texto final reconciliado (`set result`) para corregir si `stripNoChangesFiller` limpió una frase.
     - *Opción B (Complejidad Muy Alta — streaming también en etapas JSON: `plan`, `pending`, `args`)*:
       - El modelo emite JSON (a veces envuelto en fences o `<think>`), y si falla validación se reintenta con temperatura 0.3. No aporta valor directo al usuario mostrar JSON crudo parcial salvo progreso ("generando paso 2 del plan…") mediante parser incremental tolerante, a cambio de alta complejidad en `qwen.ts`.
   - **Nota sobre Decision 2.0**: `Decision20Engine` (`src/core/models/decision.ts`) consulta `/v1/systemone` devolviendo probabilidades puntuales (`choice`/`noul`), normalmente en ~50–200 ms; no aplica streaming de tokens.

3. **Canal SSE dedicado por tarea o suscripción filtrada**
   - Si se agrega streaming de stdout y de tokens, conviene separar `/api/jarvis/events` (eventos estructurales livianos: `created`, `change`, `waiting`, `paused`, `activity`, `config`) de `/api/jarvis/tasks/:taskId/stream` (tokens LLM y stdout crudo de consola), o permitir `?streams=tokens,tool_output` en `/events` para que clientes como Telegram (`src/telegram/bot.ts`) o pestañas en segundo plano no reciban megabytes de deltas innecesarios (recordar límite global `MAX_SSE_CLIENTS = 8` en `src/core/types/limits.ts`).

---

## 3. Frente 3 — Actualizar `config` sin reiniciar JARVIS

### 3.0 Auditoría completa de cómo se consume `JarvisConfig` hoy

| Categoría | Claves en `src/core/config.ts` | Comportamiento actual sin reiniciar |
|---|---|---|
| **1. Ya dinámicas (se leen en cada uso vía `getConfig()`)** | `qwenUrl`, `qwenModel`, `thinking`, `qwenNumCtx`, `qwenMaxTokens`, `modelKeepAlive`, `qwenTimeoutMs`, `qwenThinkingTimeoutMs`, `decisionUrl`, `decisionModel`, `decisionMaxContext`, `decisionTimeoutMs`, `modelUnavailablePauseMaxMs`, `autoMode`, `approvalTiers`, `reviewFullView`, `reviewReads`, `completionCoverageGuard`, `webSearchUseJudge`, `webJudgeTimeoutMs`, `desktopCommanderMcp.allowedDirectories`, `runCommandDefaultWaitSec`, `runCommandMaxWaitSec`, `mcpTimeoutMs`, `toolTimeoutsMs`, `modelTimeoutsMs`, `voiceEnabled`, `telegramVoice`, `voiceUrl`, `voiceName`, `shutdownDrainMs` | **Funcionan en caliente** tras `POST /config` (toman efecto en la siguiente llamada a modelo/herramienta/TTS o cierre). |
| **2. Dinámicas solo parcialmente o para nuevas instancias** | `traceEnabled`, `sseKeepAliveMs`, `retentionDays`, `logRetentionDays`, `retentionMaxMb` | - `traceEnabled`: aplica solo a tareas nuevas (`TaskTraceRecorder` lee en su constructor, `recorder.ts:84`).<br>- `sseKeepAliveMs`: aplica solo a nuevas conexiones SSE; las abiertas conservan el `setInterval` inicial (`jarvisRouter.ts:255`).<br>- `retention*`: aplica en la próxima corrida cada 6 h (`RETENTION_INTERVAL_MS`), no inmediatamente tras guardar. |
| **3. Congeladas al arranque por bug/diseño estático (¡desalineación real!)** | `blacklist`, `desktopCommanderMcp.cwd` (en `guardScope.relativeBases`) | - `blacklist`: `createEngineServices` llama a `compileBlacklist(config.blacklist)` **una sola vez** al iniciar (`services.ts:70`). Aunque `POST /config` la acepta y la guarda en `jarvis-config.json`, el motor sigue usando la compilación del arranque.<br>- `desktopCommanderMcp.cwd`: `toolBaseDir` la lee en vivo (`services.ts:77`), pero `guardScope.relativeBases` la captura una sola vez al arrancar (`services.ts:59-67`). Además el subproceso stdio `desktop_commander` sigue en el `cwd` original. |
| **4. Bloqueadas por `withoutLaunchFields` y cacheadas al arranque** | `FILE_ONLY_KEYS`: `refsDir`, `tracePath` (+ derivada `tasksDir` y `memoryFile`)<br>`LAUNCH_ONLY_KEYS`: `command`, `args`, `env`, `cwd` de `desktopCommanderMcp` y `freeSearchMcp` | - Ignoradas por `POST /config` (`jarvisRouter.ts:36-53`) por seguridad y ciclo de vida.<br>- Editando `jarvis-config.json` manualmente **tampoco se recargan** sin reiniciar: `ConfigManager.currentConfig` solo se lee al cargar el módulo (`config.ts:342`), `TaskManager.tasksDir` se fija en el constructor (`tasks.ts:127`), `RefVault` y `memoryProvider` se crean una vez en `services.ts`, y `StdioMcpTransport` guarda su `config` de arranque (`transport.ts:92`). |
| **5. Solo variables de entorno / `.env`** | `PORT`, `HOST`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MODE`, `HF_TOKEN`, `dotenvKeys()` | Leídas una sola vez en `server.tsx` al arrancar (`telegramConfigFromEnv`, `envRemove` de `TerminalProvider`). |

---

### 3.1 Nivel 1 — Complejidad Baja (corregir lo que ya debería ser en caliente)

Cambios puntuales en `services.ts`, `callRunner.ts`, `config.ts`, `jarvisRouter.ts` y `server.tsx`, sin reescribir subprocesos ni migración de directorios.

1. **Hacer reactiva `blacklist` en caliente**
   - **Problema**: `EngineServices.blacklist` y `EngineDeps.blacklist` son un objeto `Blacklist` compilado una vez en `services.ts:70`.
   - **Implementación**:
     - Cambiar en `EngineDeps` (`src/core/contracts.ts`) y `EngineServices` (`src/core/engine/services.ts`) `blacklist: Blacklist | (() => Blacklist)` (o resolver en `services.ts` con caché por referencia/hash de `config.blacklist` para no recompilar expresiones regulares en cada llamada si no cambió).
     - En `callRunner.ts` (`usableTools` y `blacklistMatch`) y `stepLoop.ts`, leer el getter actualizado (o fijar una lectura coherente por paso/llamada).
   - **Complejidad y riesgo**: Muy bajos; corrige una inconsistencia real donde `POST /config` hoy promete actualizar `blacklist` pero no surte efecto hasta reiniciar.

2. **Hacer dinámico `guardScope.relativeBases` con `desktopCommanderMcp.cwd`**
   - **Implementación**: en `services.ts` y `src/core/policy/guard.ts`, permitir que `ProtectedPaths.relativeBases` sea función o recomputarlo en cada llamada usando `getConfig().desktopCommanderMcp.cwd`, en lugar de congelar `[process.cwd(), desktop.cwd]` en `createEngineServices`.
   - *(Nota: el `cwd` físico del subproceso MCP `desktop_commander` sigue perteneciendo a Nivel 2/3 porque requiere reiniciar el proceso hijo).*

3. **Bus de suscripción en `ConfigManager` (`ConfigManager.onChange`) para reacciones ligeras**
   - Agregar `onChange(listener)` en `src/core/config.ts` que notifique `{ prev, next }` tras cada `updateConfig()` (o recarga). Con eso se resuelven en pocos archivos cuatro brechas actuales:
     - **Re-precalentamiento de modelos (`server.tsx` + `src/core/models/warmup.ts`)**: si cambiaron `qwenUrl`, `qwenModel`, `decisionUrl` o `decisionModel`, lanzar `void warmUpModels(getConfig)` en segundo plano (sin bloquear la respuesta HTTP de `POST /config`, opcionalmente con `AbortController` para cancelar un warmup previo si vuelven a cambiar la config).
     - **Disparar retención inmediata (`server.tsx` + `src/core/retention.ts`)**: si bajaron `retentionDays`, `logRetentionDays` o `retentionMaxMb` (o pasaron de `0` a `>0`), ejecutar `runRetention(...)` con un pequeño debounce.
     - **Actualizar `sseKeepAliveMs` en conexiones SSE ya abiertas (`jarvisRouter.ts`)**: reemplazar `setInterval(..., getSseKeepAliveMs())` por un `setTimeout` encadenado que vuelva a leer `getSseKeepAliveMs()` en cada ping (o rearmar el timer al recibir `ConfigManager.onChange`).
     - **Notificar por SSE `config` actualizado**: si Telegram o un script llama a `POST /config`, la UI recibe el cambio en vivo sin esperar recarga de página.

4. **Permitir ajustar `traceEnabled` durante una tarea o reflejar el estado vigente en el resumen**
   - Si se desea que activar `traceEnabled` a mitad de una tarea o desactivarlo aplique de inmediato: hoy es de complejidad baja solo si se documenta que rige por tarea nueva (comportamiento sano para no generar trazas mutiladas a mitad de ejecución), mientras que el cierre/retención ya se adaptan al instante.

### 3.2 Nivel 2 — Complejidad Media (recarga de `jarvis-config.json` desde disco + reinicio seguro de MCPs en reposo y Telegram)

1. **Recarga en vivo de `jarvis-config.json` sin usar `POST /config` (`ConfigManager.reloadFromDisk()`)**
   - **Por qué es clave**: `LAUNCH_ONLY_KEYS` y `FILE_ONLY_KEYS` están bloqueados en `POST /config` por seguridad (`withoutLaunchFields` evita que un cliente local sin auth inyecte binarios arbitrarios por HTTP). Pero editar `jarvis-config.json` en disco hoy **tampoco surte efecto hasta reiniciar**.
   - **Opciones de disparo**:
     - *Opción A (explícita)*: endpoint `POST /api/jarvis/config/reload` (sin aceptar body arbitrario: solo ordena releer `jarvis-config.json` del disco con `normalize()`).
     - *Opción B (automática)*: `fs.watch` (con debounce de 200–300 ms y fallback por `mtimeMs` como ya hace `src/memory/`) sobre `jarvis-config.json`, ignorando eventos causados por `saveConfig()` propio. Si el JSON en disco tiene un error de sintaxis mientras el usuario lo edita, conservar la última `currentConfig` válida y loguear advertencia.
   - **Archivos a tocar**: `src/core/config.ts`, `src/server/jarvisRouter.ts`.

2. **Reinicio / reconexión en caliente de servidores MCP (`desktop_commander`, `free_search`) cuando hay `0` tareas activas**
   - **Problema actual**: `DesktopCommanderMCPServer` (`src/core/mcp/desktopCommanderMcp.ts:47`) y `FreeSearchMCPServer` (`src/core/mcp/freeSearchMcp.ts:15`) construyen una instancia única de `StdioMcpTransport` con una copia estática de `config` (`this.config`). Además `DiscoveryEngine` (`src/core/mcp/discovery.ts`) cachea `toolsCache` por 30 s y `unavailableServers`.
   - **Implementación (estrategia de "esperar a reposo / diferir si hay tareas activas")**:
     - Detectar en `ConfigManager.onChange` si cambiaron `command`, `args`, `env` o `cwd` de `desktopCommanderMcp` o `freeSearchMcp`.
     - Si `tasks.activeCount() > 0`, marcar un flag `pendingMcpReload` (y opcionalmente exponerlo en `/diagnostics` o en respuesta de `/config/reload`) para aplicarlo automáticamente en cuanto `inFlight` o `activeCount()` vuelva a `0`.
     - Cuando no hay tareas activas:
       1. Construir la nueva instancia de `DesktopCommanderMCPServer` / `FreeSearchMCPServer` (o hacer que `StdioMcpTransport` lea `() => StdioServerConfig` dinámico y `reconnect()` tome la nueva config al relanzar).
       2. Cerrar el transporte anterior (`await oldServer.close()`).
       3. Registrar en `DiscoveryEngine` (`registerServer(newServer)` — ya limpia `toolsCache` y `unavailableServers`), y lanzar `await discoveryEngine.discoverAll(true)`.
   - **Archivos a tocar**: `src/core/mcp/transport.ts`, `src/core/mcp/desktopCommanderMcp.ts`, `src/core/mcp/freeSearchMcp.ts`, `src/core/mcp/discovery.ts`, `server.tsx`.

3. **Recarga de `.env` y reinicio en caliente del bot de Telegram (`src/telegram/bot.ts`)**
   - **Implementación**:
     - Encapsular la lectura de `.env` + `telegramConfigFromEnv` en una función recargable dentro de `server.tsx`.
     - En `TerminalProvider` (`src/tools/terminal/terminalProvider.ts:231`): cambiar `envRemove` a getter `() => ReadonlySet<string>` para que nuevas variables secretas en `.env` queden filtradas de `run_command` sin reiniciar.
     - Si cambian `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` o `TELEGRAM_MODE`: ejecutar `stopTelegram?.()` (que ya aborta SSE y llama a `bot.stop()`) y volver a lanzar `startTelegram(...)` solo si el bot no está en mitad de una tarea (`starting` / `current`), o diferirlo hasta que termine.
   - **Nota**: cambiar `PORT` o `HOST` del servidor HTTP Express requiere rebind del socket (`server.close()` + `listen()`), lo cual corta conexiones SSE/HTTP abiertas y rara vez justifica hacerse sin reinicio.

### 3.3 Nivel 3 — Complejidad Alta (recarga sin espera con tareas activas y cambio dinámico de rutas en disco)

1. **Cambio en caliente de `FILE_ONLY_KEYS` (`refsDir`, `tracePath` y derivada `tasksDir` / `memory.json`)**
   - **Por qué es complejo (riesgos reales verificados en el código)**:
     1. **Rutas cacheadas en múltiples módulos**:
        - `TaskManager.tasksDir` se fija una vez en el constructor (`src/core/tasks.ts:127`).
        - `createEngineServices` crea un único `RefVault` con `root = path.resolve(config.refsDir)` (`src/core/refs/refVault.ts:85`), `guardScope.protectedDirs = [refsDir, tasksDir, process.cwd()]`, `guardScope.protectedFiles = [memoryFile]`, `memory` y `memoryProvider` (`src/core/engine/services.ts:54-81`).
     2. **Aislamiento de seguridad en `RefVault.readAll`**: `refVault.ts:118-121` rechaza con `outside_dir` cualquier `ref.where` que no esté dentro de `root`. Si cambia `refsDir` en caliente, todas las tareas retenidas en RAM perderían acceso a sus `refs` previas (y `openTaskLog` de tareas activas seguiría escribiendo en el `tasksDir` viejo mientras `TaskManager.list()` buscaría en el nuevo).
     3. **Consistencia de `TaskManager.summaries` y `restoreFromDisk`**: `summaries` solo indexa el `tasksDir` leído al inicio (`tasks.ts:335-371`).
   - **Opciones de diseño**:
     - *Opción A (Complejidad Media-Alta — transición ordenada en reposo + multi-raíz para lectura)*:
       - Exigir/esperar `tasks.activeCount() === 0` (y `inFlight` vacío para que terminen las escrituras asíncronas de `TaskTraceRecorder.write()`).
       - Mantener un array de `legacyVaults` / `legacyTracePaths` de solo lectura en `TaskManager` para que tareas ya cargadas de la sesión puedan seguir sirviendo `GET /refs/:refId` y `GET /trace`.
       - Reconstruir `vault`, `guardScope`, `memoryProvider` (`services.ts`), actualizar `this.tasksDir` y re-ejecutar `restoreFromDisk()` sobre el nuevo directorio, limpiando o fusionando `this.tasks` y `this.summaries`.
       - Lanzar `runRetention` usando las rutas nuevas (y sin borrar tareas protegidas).
     - *Opción B (Complejidad Alta — snapshot de almacenamiento por tarea)*:
       - Cada `TaskEntry` guarda su propio `vault`, `tasksDir` y `tracePath` fijados al momento de `start()`. Las tareas en curso terminan limpiamente en su carpeta original; las nuevas nacen en las nuevas rutas. `TaskManager` y `RefVault` resuelven las lecturas consultando la raíz asociada a cada `taskId`.

2. **Cambio en caliente de `LAUNCH_ONLY_KEYS` con tareas activas en vuelo (versionado por generación de servidor MCP)**
   - Si no se quiere bloquear/esperar a que terminen todas las tareas para reiniciar `desktop_commander` o `free_search`:
     - Envolver cada `IMCPServer` en un gestor por generaciones (`v1`, `v2`) con contador de referencias (`activeTasks` o `pendingCalls`).
     - La tarea que ya empezó sigue usando `v1` hasta terminar (`onTaskEnd` y cierre diferido cuando `refCount === 0`); las tareas nuevas se vinculan a `v2` (y `DiscoveryEngine` mantiene catálogo por versión o limpia caché tras el swap).
   - **Complejidad y riesgo**: Altos; para la mayoría de casos prácticos, la estrategia de Nivel 2 (aplicar el reinicio del MCP al vaciarse las tareas activas o mediante botón "Aplicar al quedar libre") da el 95% del beneficio con una fracción del código.

3. **Permitir editar `LAUNCH_ONLY_KEYS` o `FILE_ONLY_KEYS` desde la UI (`POST /config`)**
   - **Advertencia arquitectónica verificada en `server.tsx:61-82` y `jarvisRouter.ts:33-53`**: hoy la API HTTP **no tiene autenticación** y en el entorno actual `localOnly()` está comentado. Quitar `withoutLaunchFields()` permitiría que cualquier petición HTTP local o por proxy cambie `desktopCommanderMcp.command` a un ejecutable arbitrario (ejecución remota de código) o apunte `refsDir` a una carpeta del usuario donde luego actúe `retention.ts`.
   - **Requisito previo obligatorio si se quisiera habilitar**: introducir autenticación de sesión/token admin o una lista blanca estricta de binarios/rutas base permitidas antes de exponer estas claves por HTTP.

---

## 4. Hoja de ruta sugerida (orden costo / beneficio)

| Prioridad | Cambio | Frente | Complejidad | Archivos principales |
|---|---|---|---|---|
| **1 (Quick win)** | Convertir `blacklist` y `guardScope.relativeBases` en lectura viva + `ConfigManager.onChange` (warmup modelos, retención, SSE keepalive y evento `config`) | Config | **Baja** | `src/core/config.ts`, `src/core/contracts.ts`, `src/core/engine/services.ts`, `src/core/engine/callRunner.ts`, `src/core/policy/guard.ts`, `src/server/jarvisRouter.ts`, `server.tsx` |
| **2 (Quick win)** | Exponer diagnósticos de `TaskManager`, estado de servidores MCP, `GET /tasks/:id` ligero y deltas SSE completos (`snapshot` inicial + `TaskSummary`) | Info + Tiempo real | **Baja** | `src/core/tasks.ts`, `src/core/mcp/discovery.ts`, `src/core/engine/limits.ts`, `src/server/jarvisRouter.ts` |
| **3** | Añadir `activity`, estado reactivo (`pending`/`settled`/`abandoned`), resultado de D0/hilo y `id`/`source` en `PendingQuestion` dentro de `TaskRuntime` + evento SSE `activity` | Info + Tiempo real | **Media** | `src/core/engine/runtime.ts`, `src/core/engine/runTask.ts`, `src/core/engine/stepLoop.ts`, `src/core/engine/callRunner.ts`, `src/core/engine/classify.ts`, `src/core/tasks.ts` |
| **4** | Traza en vivo (`TaskTraceRecorder.liveSnapshot()` + `?live=1` en `GET /trace` y evento SSE opt-in) | Info + Tiempo real | **Media-Alta** | `src/core/trace/recorder.ts`, `src/core/trace/format.ts`, `src/core/tasks.ts`, `src/server/jarvisRouter.ts` |
| **5** | Recarga desde disco de `jarvis-config.json` (`reloadFromDisk` / watcher) + reinicio seguro de MCPs y Telegram cuando `activeCount === 0` | Config | **Media** | `src/core/config.ts`, `src/core/mcp/transport.ts`, `src/core/mcp/discovery.ts`, `src/tools/terminal/terminalProvider.ts`, `server.tsx` |
| **6** | Streaming de salida de `run_command` (`onProgress` throttled en `TerminalProvider`) y streaming de tokens en `QwenEngine` (`final_response` / `question`) | Tiempo real | **Alta** | `src/tools/terminal/terminalProvider.ts`, `src/core/tools/provider.ts`, `src/core/models/transport.ts`, `src/core/models/qwen.ts`, `src/core/engine/finalize.ts`, `src/server/jarvisRouter.ts` |
| **7** | Cambio en vivo de `refsDir` / `tracePath` / `tasksDir` y versionado de MCPs con tareas activas | Config | **Alta** | `src/core/tasks.ts`, `src/core/taskLog.ts`, `src/core/refs/refVault.ts`, `src/core/engine/services.ts`, `src/core/mcp/discovery.ts` |
