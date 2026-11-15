# Auditoría de Invariantes — Refactor de Tarea Única (Jarvis v1)

- **Alcance:** eliminación de la maquinaria de paralelismo de tareas en Jarvis v1 («un usuario, una sola tarea a la vez entre PC y Telegram») en `server.ts`, `src/core/`, `src/server/`, `src/telegram/`, `ui/`, `scripts/validate/`, `tests/` y `docs/`.
- **Archivos intocados (restricción explícita):** `src/core/models/prompts.ts`, `src/core/ctx/views/route.ts`, `src/core/engine/adapters.ts`, `src/core/contracts.ts`, `tests/__golden__/render.json`.

---

## 1. Invariantes Implementados y Evidencia (`archivo:línea`)

### I1. Una sola tarea activa a la vez (`active` + promesa única `inFlight`, HTTP `409`)
- **Límites (`src/core/types/limits.ts:1-2`):** eliminado `MAX_ACTIVE_TASKS`. Se conserva `MAX_RETAINED_TASKS = 20` exclusivamente para el historial en memoria de tareas terminadas.
- **Fachada (`src/core/tasks.ts:76-84,101-104,139-143,163-176`):**
  - Eliminados el mapa unificado `tasks`, el `Set` `inFlight` y `activeCount()`.
  - `TaskManager` mantiene un único slot activo (`private active: ActiveRun | null`) y una única promesa en curso (`private inFlight: Promise<void> | null`) que cubre la ejecución completa de `runTask`, `remember`, el cierre de la traza (`recorder.finish()`) y `completeActive`.
  - `start(message, mode)` rechaza sincrónicamente con `TaskBusyError` (`activeTaskId`) si `this.active !== null || this.inFlight !== null`. El lugar no se libera hasta cerrar la respuesta final y la traza.
- **Router HTTP (`src/server/jarvisRouter.ts:5,98-111`):**
  - `POST /api/jarvis/process` captura `TaskBusyError` y responde HTTP **`409 Conflict`** con `{ error }` (ya no responde `429` para tareas).
  - Se conserva `429` únicamente para el tope de conexiones SSE (`MAX_SSE_CLIENTS = 8`, `src/server/jarvisRouter.ts:213`).
- **`drain(timeoutMs)` (`src/core/tasks.ts:231-243`):** espera únicamente a `this.inFlight` en carrera contra el timeout (sin `Set`).

### I2. Liberación ante cancelación aunque la ejecución quede colgada (`/cancel`, `settleCancel`, `forceRelease`)
- **`cancel(taskId)` (`src/core/tasks.ts:192-203`):** aborta `entry.runtime.cancel()` y, si corresponde a la tarea activa, arma un timer `.unref()` (`cancelGraceMs`, por defecto `1500 ms` vía `TaskManagerOptions`, `src/core/tasks.ts:41-44,99,125-128`) que ejecuta `forceRelease`.
- **`settleCancel(taskId, graceMs?)` (`src/core/tasks.ts:209-225`):** invocado por `POST /api/jarvis/cancel` (`src/server/jarvisRouter.ts:114-123`). Espera la finalización normal hasta `graceMs`; si la ejecución sigue colgada (`this.active === target`), invoca `forceRelease` (`src/core/tasks.ts:393-421`):
  - Marca `target.detached = true` (una resolución tardía de la promesa colgada ya no puede pisar `previousTask` ni el slot de una tarea posterior) y libera `active` e `inFlight`.
  - Cierra pasos `running` como `failed`, cierra el contexto en `cancelled` / `user_cancelled` con respuesta de respaldo (`renderFallback`), notifica `discovery.notifyTaskEnd(id, "cancelled")`, cierra `recorder.finish()` y archiva en `history`.
- **Apagado del servidor (`src/core/tasks.ts:246-248`, `server.ts:110`, `scripts/validate/rerun_task.ts:125`, `scripts/validate/tasks_e2e.ts:166`):** `cancelAll()` pasa a `cancelActive()`, que aborta la tarea activa sin forzar liberación prematura para que `drain(timeoutMs)` respete su plazo.

### I3. Verificación cross-canal (UI web y Telegram)
- **Independencia de HTTP `429`:**
  - UI: `ui/services/jarvisApi.ts:40-46` y `ui/hooks/useJarvis.ts:81-91` muestran directamente `errorData.error` en cualquier `!res.ok` sin inspeccionar `429`.
  - Telegram: `src/telegram/api.ts:24-25` y `src/telegram/bot.ts:433-434` devuelven y reenvían `json?.error` ante cualquier `!res.ok`.
- **Telegram frente a tarea iniciada desde PC:**
  - Telegram solo abre flujo SSE propio para tareas iniciadas por el bot (`src/telegram/bot.ts:25,435-439`), por lo que **no puede cancelar directamente una tarea iniciada desde la PC/interfaz web**.
  - `TaskBusyError` (`src/core/tasks.ts:80`) informa en ambos canales cómo destrabar: *«Ya hay una tarea en curso; esperá a que termine o cancelala desde la interfaz web (botón Cancelar) o con /cancel en Telegram si la iniciaste ahí.»*
  - En `/cancel` (`src/telegram/bot.ts:364-374`), si `!current`, el bot consulta `GET /state`: cuando detecta `state.data.task?.state === "running"`, responde `"La tarea en curso se inició desde la interfaz web (PC); cancelala desde allí."`.

### I4. Hilo global único (`previousTask`, TTL 10 min)
- **Eliminación de sesiones por pestaña/canal:** eliminados `MAX_PREVIOUS_SESSIONS`, `previousBySession`, la política LRU y el parámetro `sessionKey` de `TaskManager.start` (`src/core/tasks.ts:109,140,158-160,185-189`), `jarvisApi.initiateTask` (`ui/services/jarvisApi.ts:92-96`), `CLIENT_ID_STORAGE_KEY` / `clientIdRef` (`ui/hooks/useJarvis.ts`) y el envío desde Telegram (`src/telegram/bot.ts:433`).
- **Estado único global:** `TaskManager.previousTask` conserva la última tarea `completed` con `result.origin === "model"` con expiración a `THREAD_TTL_MS` (10 min).
- **Compatibilidad HTTP:** `POST /api/jarvis/process` (`src/server/jarvisRouter.ts:99-106`) sigue aceptando e ignorando `sessionKey` si algún cliente antiguo lo envía.

### I5. Historial acotado de terminadas sin cancelar esperas + primitivas para subagentes futuros
- **Historial (`src/core/tasks.ts:106,325-332,423-431`):** `history` retiene hasta `MAX_RETAINED_TASKS = 20` tareas terminadas en orden cronológico y descarta las más antiguas al archivar. Nunca expulsa ni cancela una tarea activa en espera (`plan`, `approval`, `question`).
- **Contratos conservados:** se mantienen `taskId` y `waitId` en todos los endpoints y DTOs (`src/server/jarvisRouter.ts`, `JARVIS_API.md`).
- **Primitivas de aislamiento preservadas para subagentes paralelos futuros:**
  - `TerminalProvider` (`src/tools/terminal/terminalProvider.ts`: propiedad por `taskId`, conjunto `starting`, límite `maxLive` y limpieza en `onTaskEnd`).
  - `ToolCallOptions.taskId` (`src/tools/provider.ts`).
  - `TaskRuntime` por ejecución (`src/core/engine/runtime.ts`), `RefVault` por `taskId` (`src/core/refs/refVault.ts`), `TaskTraceRecorder` y `withTraceIndexLock` (`src/core/trace/`), y `ToolHost` (`src/core/tools/host.ts`).

---

## 2. Archivos Actualizados

| Área | Archivos modificados |
|---|---|
| Núcleo y servidor | `src/core/types/limits.ts`, `src/core/tasks.ts`, `src/server/jarvisRouter.ts`, `server.ts` |
| UI y Telegram | `ui/services/jarvisApi.ts`, `ui/hooks/useJarvis.ts`, `src/telegram/bot.ts` |
| Scripts de validación | `scripts/validate/rerun_task.ts`, `scripts/validate/tasks_e2e.ts` |
| Tests | `tests/taskmanager.test.ts`, `tests/http.test.ts`, `tests/inv_state_config_transport.test.ts`, `tests/inv_engine.test.ts` |
| Documentación | `docs/JARVIS_API.md`, `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md`, `docs/CONTEXT_AND_MEMORY.md`, `docs/PENDIENTES.md`, `docs/TELEGRAM_Y_VOZ.md`, `docs/auditorias/AUDITORIA_INVARIANTES.md` |

---

## 3. Verificación Ejecutada

- **Búsqueda de símbolos obsoletos:** `grep` de `MAX_ACTIVE_TASKS`, `activeCount`, `cancelAll`, `previousBySession`, `MAX_PREVIOUS_SESSIONS` y `clientId` en `src/`, `tests/`, `ui/`, `server.ts` y `scripts/` sin coincidencias.
- **Chequeo de tipos (`npm run lint` → `tsc --noEmit`):** sin errores tras el último cambio.
- **Compilación (`npm run build` → `vite build`):** sin errores tras el último cambio.
- **Pruebas unitarias e integración enfocadas** (`tests/taskmanager.test.ts`, `tests/http.test.ts`, `tests/telegram.test.ts`, `tests/inv_state_config_transport.test.ts`, `tests/architecture.test.ts`):
  - **43/43 activas en verde** (1 omitida en Linux: `TerminalProvider.start` en Windows).
  - Cubiertos explícitamente: rechazo `TaskBusyError` / HTTP `409` incluso tras estado terminal mientras cierra respuesta/traza, liberación por `/cancel` (`settleCancel`) y vencimiento automático de `cancelGraceMs`, aislamiento ante resolución tardía (`detached`) sin pisar slot activo ni hilo global, hilo sin sobrescritura ante respaldo/cancelación y TTL 10 min, retención FIFO de 20 terminadas sin cancelar espera activa, idempotencia y `404` de `/cancel`, `GET /tasks/:id/trace` según estado y `JarvisApi.get`.
- **Suite completa (`npm test`):** `444` pruebas (`409` en verde, `32` omitidas por entorno Windows, `3` fallos preexistentes en `tests/inv_engine.test.ts` — Invariantes 1, 4/5 y 8, ya registrados en `docs/auditorias/AUDITORIA_2026-11-15.md:165`).
