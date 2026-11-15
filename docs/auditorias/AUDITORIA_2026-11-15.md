# Auditoría Técnica Integral — Jarvis Backend (2026-11-15)

- **Alcance:** código de producción en `server.ts`, `src/core/`, `src/server/`, `src/telegram/`, `src/voice/`, `src/tools/`, contratos con `ui/types/api.ts`, pruebas en `tests/` y documentación en `docs/`. No se modificó ni evaluó el laboratorio `eval/`.
- **Restricciones respetadas:** prompts intactos, flujo de producción intacto, arquitectura unidireccional verificada por `tests/architecture.test.ts` y sin dependencias circulares (`madge`).

---

## 1. Diagnóstico General

El núcleo de Jarvis presenta una arquitectura **coherente, proporcional a su complejidad y bien delimitada por capas**:

- **`src/core/ctx/`** es puro respecto del motor, modelos, herramientas y red: toda mutación pasa por un lote atómico en `apply.ts` y las derivaciones se recalculan en `derive.ts` / `closure.ts`.
- **Seguridad determinista** (`Guard`, `commandRules.ts`, `blacklist.ts`, `tiers.ts`, `readOnly.ts`, `sensitivePaths.ts`, `egress.ts`) actúa delante de todo despacho y concentra la política de herramientas en `tools/manifest.ts`.
- **Ciclo de vida y recursos:** el host coordina el apagado ordenado (`tasks.cancelAll()` → `tasks.drain(6000)` → `servers.close()` paralelo → cierre HTTP) y la retención en disco (`retention.ts`) protege las refs de las tareas activas o retenidas en RAM.
- **Puntos endurecidos en esta auditoría:** se cerraron brechas puntuales de unicidad en claves de espera en Telegram, saneado `<obs>` en bloques de hilo/ruta, cota de reintentos por helpers faltantes en terminal, timeout/cierre en probe de `ffmpeg`, fuga de listener `abort` en backoff de transporte, duplicación de `normalizeArgs`, y cálculo muerto de `lastResult` en `decisionFrame`.

---

## 2. Evidencia Verificada (`archivo:línea`) de los 8 Puntos Clave

1. **`src/core/tasks.ts` (fachada, hilos por sesión, retención en RAM y apagado):**
   - Límite de sesiones recordadas para hilo: `MAX_PREVIOUS_SESSIONS = 20` (`src/core/tasks.ts:77`) y `previousBySession` Map (`L85`).
   - En `start(message, mode, sessionKey = "default")` (`src/core/tasks.ts:119-164`), vence entradas tras `THREAD_TTL_MS` (`L139-140`) y al completar con `origin === "model"` actualiza LRU descartando la sesión más antigua si supera `MAX_PREVIOUS_SESSIONS` (`L154-164`).
   - `drain(timeoutMs)` (`src/core/tasks.ts:179-190`) espera `Promise.allSettled([...this.inFlight])` en carrera contra un timeout y limpia siempre el timer en `finally`.
   - `prune()` y `evictFinished()` (`src/core/tasks.ts:319-333`) expulsan tareas cerradas con respuesta cuando `this.tasks.size > MAX_RETAINED_TASKS` y, si persiste exceso, cancelan la tarea en espera más antigua.

2. **`src/core/memory.ts` y `src/core/engine/thread.ts` (memoria entre tareas):**
   - `memory.ts:19-94` lee `data/memory.json` mediante `createMemoryReader` (`L80-94`) cacheado por `mtimeMs` de `fs.statSync`. Limita a `MAX_FACTS = 200`, clave ≤ 80 caracteres, valor ≤ 300 caracteres, y `selectFacts` (`L60-71`) selecciona hasta `MAX_FACTS_PER_PROMPT = 3` (`L25`) comparando raíces por prefijo de 5 letras (`stems`).
   - `engine/thread.ts:14-35` fija `THREAD_TTL_MS = 10 * 60 * 1000`, `THREAD_ANSWER_CHARS = 500` y `CONTINUATION_APPROVE = 0.3`. `previousTaskOf` (`L24-27`) recorta la respuesta y `threadBlock` (`L33-34`) sanea `previous.request` y `previous.answer` con `safe()` antes de envolver en `<obs>...</obs>`.

3. **`src/core/ctx/derive.ts` (aislamiento estricto de `ctx/`):**
   - Sus únicas importaciones reales (`src/core/ctx/derive.ts:9-12`) son `./closure.ts`, `./errors.ts` y `./types.ts`. No importa nada de `engine/`, `models/`, `tools/`, `policy/`, `trace/` ni `server/`, cumpliendo el invariante verificado por `tests/architecture.test.ts`.

4. **Lectura HTTP de trazas vs. «el backend nunca la lee»:**
   - El **motor** nunca lee trazas ni restaura estado desde disco, pero el **servidor HTTP** sí expone lectura bajo demanda en `src/server/jarvisRouter.ts:181-187`: `GET /tasks/:taskId/trace?format=` llama a `readTraceFile(ConfigManager.getConfig().tracePath, req.params.taskId, format)` (`summary` | `json` | `full`).
   - Se actualizaron `docs/ARCHITECTURE.md` (`L12, L33`) y `docs/CONTEXT_AND_MEMORY.md` (`L182`) para distinguir explícitamente «el motor nunca la lee» del endpoint de lectura `GET /api/jarvis/tasks/:taskId/trace`.

5. **Configuración en caliente vs. valores fijados al arrancar:**
   - **En caliente (`ConfigSource` evaluada en cada uso):**
     - `autoMode`, `approvalTiers` y `blacklist` (compilada bajo demanda al cambiar su JSON) en `src/core/engine/services.ts:63-84`.
     - `desktopCommanderMcp.allowedDirectories` en `src/core/mcp/desktopCommanderMcp.ts:52-54,86` y `mcpTimeoutMs` en la factory del transporte (`L45`).
     - Modelos, URLs, tokens, timeouts y `keep_alive` en `Decision20Engine` (`decision.ts`) y `QwenEngine` (`qwen.ts`).
     - `webSearchUseJudge` en `server.ts:78` y voz (`voiceEnabled`, `telegramVoice`, `voiceName`, `voiceUrl`) en `server.ts:90-94`.
     - `traceEnabled` y `tracePath` al iniciar/finalizar cada tarea en `TaskTraceRecorder` (`trace/recorder.ts:83`).
   - **Fijos al arrancar:**
     - `refsDir`, `guardScope.protectedDirs`, `guardScope.relativeBases` (`desktopCommanderMcp.cwd`) y la ruta base de `data/memory.json` se calculan una sola vez en `createEngineServices` (`src/core/engine/services.ts:55-61,76-85`). Note que el archivo `data/memory.json` en esa ruta sí se recarga por `mtimeMs`, pero mover `refsDir` o cambiar `cwd`/`command`/`args`/`env` de MCP exige reiniciar, consistente con `LAUNCH_ONLY_KEYS` (`src/core/config.ts:98`) y `FILE_ONLY_KEYS` (`src/core/config.ts:104`).

6. **Expulsión de tareas retenidas y protección de refs en disco:**
   - `MAX_RETAINED_TASKS = 20` (`src/core/types/limits.ts:2`).
   - Al crear una tarea nueva, `TaskManager.prune()` (`src/core/tasks.ts:319-333`) expulsa primero terminales con respuesta hasta quedar `<= 20`.
   - `server.ts:87` pasa `() => tasks.taskIds()` a `startRetention(getConfig, ...)`, y `runRetention` (`src/core/retention.ts:106-107`) protege `refsDir/<taskId>` de toda tarea que siga retenida en memoria aunque exceda `retentionDays`.

7. **`DEFAULT_CONFIG` frente a `jarvis-config.json`:**
   - `DEFAULT_CONFIG` (`src/core/config.ts:121-164`) define valores conservadores si falta el archivo: `qwenModel: "qwen3.5:4b"`, `decisionModel: "d3:2b"`, `autoMode: false`, `approvalTiers: false`.
   - `jarvis-config.json:1-54` incluido en el proyecto activa los modelos de solo texto y autonomía por niveles: `qwenModel: "qwen3.5:4b-text"`, `decisionModel: "d3:2b-text"`, `autoMode: true`, `approvalTiers: true`. Documentado explícitamente en `docs/ARCHITECTURE.md:69` y `docs/CORE_FLOW.md:165`.

8. **D3 como última barrera con `autoMode` y comportamiento con `approvalTiers`:**
   - En `src/core/engine/callRunner.ts:365-426`:
     - Con `autoMode: true` y `approvalTiers: false`, una escritura del catálogo omitida de confirmación humana (`askUser === false`) pasa por D3 (`L412-426`), un modelo de 2B con umbral `REVIEW_APPROVE` (`0.6`) o `BUDGET.sensitiveApprove` (`0.65`) si coincide con `blacklist` nivel `sensitive` (`L419-424`). `guard.mandatory` y herramientas no catalogadas siguen pidiendo confirmación al usuario (`L392`).
     - Con `approvalTiers: true`, `approvalTierOf` (`src/core/policy/tiers.ts:44-77`) clasifica escrituras en `green`, `yellow` o `red` (`callRunner.ts:368`). `red`, `guard.mandatory === true` o cualquier coincidencia en `blacklist` (salvo `blocked`, que ya rechazó en `L370`) piden confirmación al usuario (`L390-391`); `green` omite confirmación y D3 (`tier !== "green"` en `L412`), delegando en la poscondición en disco y sondas (`D4`); `yellow` omite confirmación y pasa por D3 con umbral estricto (`strict` en `L419`). `Guard.evaluate` con `DENY` (`L359-360`) y `blacklist` `blocked` (`L370`) bloquean siempre.

---

## 3. Cambios Aplicados sin Alterar Flujo ni Prompts (Directiva 1)

| Ítem | Cambio implementado y evidencia (`archivo:línea`) | Cobertura / verificación |
|---|---|---|
| Clave única en `PendingQuestion` / Telegram | `PendingQuestion.id` generado con `newId("question")` (`src/core/engine/runtime.ts:54-58,191-194`), sincronizado en `ui/types/api.ts:136-143`, y usado por `waitKey`/`tagOf` en `src/telegram/bot.ts:63-65`. | `tests/telegram.test.ts:156-176` verifica dos preguntas en el mismo `stepId` con `id`/`waitKey`/`tagOf` distintos y `callback_data <= 64` bytes. |
| Saneado `safe()` contra cierre falso de `<obs>` | `safe()` exportado en `src/core/text.ts:13-17` y `src/core/models/prompts.ts:22-23`; aplicado en `threadBlock` (`src/core/engine/thread.ts:34`), `buildContinuation` (`src/core/models/prompts.ts:396`) y `Request:` de `buildRouteChoice` (`src/core/models/prompts.ts:493`). | `tests/thread.test.ts:29-39` y `tests/route_request.test.ts:50-57` prueban `"</obs>"` y `"<obs>"`. |
| Cota de reintentos en `TerminalProvider.start()` | `helpersAttempt = 0` acotado por `MAX_HELPERS_ATTEMPTS` (`src/tools/terminal/terminalProvider.ts:338-376`); si el archivo de ayudas sigue ausente al agotar intentos, activa `helpersDisabled = true` y corta la recursión. | `tests/run_command.test.ts` compila (las pruebas de proceso vivo se ejecutan solo en `win32`; se omite test mock invasivo para no introducir ganchos artificiales). |
| `ffmpegAvailable()` con `windowsHide` y timeout | `src/voice/opus.ts:32-53`: agrega `FFMPEG_PROBE_TIMEOUT_MS = 5000`, `{ stdio: "ignore", windowsHide: true }`, bandera `settled`, `timer.unref()` y `probe.kill()`. | `tests/voice.test.ts:96-116` verifica `false` ante binario inexistente y ante timeout vencido. |
| Limpieza de listener `abort` en backoff | `src/core/models/transport.ts:151-161`: registra `onAbort` y ejecuta `signal.removeEventListener("abort", onAbort)` cuando vence `setTimeout` sin aborto. | Compilado y cubierto por `tests/` sin fugas de listeners. |
| Unificación de `normalizeArgs` Guard/Blacklist | Movido a `src/core/policy/commandRules.ts:94-96`, importado por `src/core/policy/guard.ts:28,166` y `src/core/policy/blacklist.ts:24,71`. | `tests/policy.test.ts:73-80` prueba paridad de comportamiento con rutas Windows, mayúsculas y espacios. |
| Eliminar cálculo muerto de `lastResult` en D1/D2 | Eliminado `lastResultText` en `src/core/engine/adapters.ts:146-156` (`decisionFrame` emite `lastResult: null`); `src/core/contracts.ts:70-71` documenta legado. | Actualizado `tests/__golden__/render.json:65,104`; suite completa en verde. |
| Documentación alineada y consolidación `run_command` | Actualizados `docs/JARVIS_API.md`, `docs/CONTEXT_AND_MEMORY.md`, `docs/CORE_FLOW.md`, `docs/ARCHITECTURE.md`; consolidado `src/tools/terminal/Revisión de la tool run_command (Jarvis).md` en `docs/REVISION_run_command.md` (§12) y eliminado el duplicado en `src/tools/terminal/`. | Verificado contra implementaciones reales y lista de `src/core/`. |

---

## 4. Refactors Evaluados con Criterio (Directiva 2)

### Aplicados

1. **`resolveUrl` delega en `chatUrl` (`src/core/models/qwen.ts:29,420-431`, `src/core/models/warmup.ts:18-22`):** elimina duplicación real de normalización `/v1` y `/v1/chat/completions` manteniendo las validaciones específicas de Qwen (`!base` y rechazo de `/generate` / `/api/chat`).
2. **Eliminar estado global de módulo `coherenceWarned` (`src/core/engine/services.ts:38-58`):** evita estado mutable compartido entre tests o múltiples instancias de `createEngineServices`; ahora avisa una vez por invocación.
3. **Compartir `JUDGE_BATCH` vía contrato (`src/core/tools/judge.ts:26-32`, `src/core/models/decision.ts:58-59,129`, `src/tools/web/webSearchProvider.ts:502`):** `webSearchProvider.ts` ya no duplica la constante ni la importa desde `models/decision.ts`, respetando la frontera de arquitectura por medio de `FragmentJudge.batchSize ?? JUDGE_BATCH`.

### Descartados (justificación en una línea)

1. **Regex de encabezados (`PENDING_VIEW`, `render/pending.ts`, `trace/format.ts:215-221`):** son expresiones cortas y estables sobre formatos ya cubiertos por tests golden; extraer constantes compartidas acoplaría `trace/` y `models/` sin reducir fragilidad real.
2. **Estado `normalizedRefCache` (`src/core/engine/precheck.ts:132-150`):** ya está acotado en `WeakMap<TaskContext, WeakMap<PrecheckDisk, ...>>` y se limpia explícitamente al cerrar cada tarea con `clearSourceCache`, por lo que no filtra estado global.
3. **Subdividir `runCall` (`src/core/engine/callRunner.ts:266-505`):** es un pipeline secuencial lineal de 12 fases con cierres locales (`record`, `reject`, `finishWithVerification`); trocearlo en subfunciones dispersaría el control de cancelación y orden de registro.
4. **Partir `src/core/models/prompts.ts`:** es un catálogo único de prompts que comparte helpers locales (`safe`, `clip`, `linesBlock`, `join`) y es importado ampliamente por producción y `eval/`; dividirlo crearía reexports innecesarios.

---

## 5. Registro Consolidado de Hallazgos

| Hallazgo | Prioridad | Archivos principales | Estado | Fecha |
|---|---|---|---|---|
| ID único en `PendingQuestion` y botones Telegram | Alta | `src/core/engine/runtime.ts`, `ui/types/api.ts`, `src/telegram/bot.ts`, `tests/telegram.test.ts` | Resuelto | 2026-11-15 |
| Neutralizar `</obs>` en hilo y `Request:` de D1 | Alta | `src/core/text.ts`, `src/core/engine/thread.ts`, `src/core/models/prompts.ts`, `tests/thread.test.ts`, `tests/route_request.test.ts` | Resuelto | 2026-11-15 |
| Límite de reintentos por helpers faltantes en `start()` | Media | `src/tools/terminal/terminalProvider.ts` | Resuelto (falta corrida viva en Windows) | 2026-11-15 |
| Timeout y `windowsHide` en `ffmpegAvailable()` | Media | `src/voice/opus.ts`, `tests/voice.test.ts` | Resuelto | 2026-11-15 |
| Remover listener `abort` al vencer backoff de transporte | Baja | `src/core/models/transport.ts` | Resuelto | 2026-11-15 |
| Unificar `normalizeArgs` entre Guard y Blacklist | Baja | `src/core/policy/commandRules.ts`, `src/core/policy/guard.ts`, `src/core/policy/blacklist.ts`, `tests/policy.test.ts` | Resuelto | 2026-11-15 |
| Eliminar cálculo muerto de `lastResult` en D1/D2 | Baja | `src/core/engine/adapters.ts`, `src/core/contracts.ts`, `tests/__golden__/render.json` | Resuelto | 2026-11-15 |
| Reusar `chatUrl` en `QwenEngine.resolveUrl` | Baja | `src/core/models/qwen.ts`, `src/core/models/warmup.ts` | Resuelto (refactor) | 2026-11-15 |
| Quitar flag global `coherenceWarned` | Baja | `src/core/engine/services.ts` | Resuelto (refactor) | 2026-11-15 |
| Compartir `JUDGE_BATCH` vía `FragmentJudge` | Baja | `src/core/tools/judge.ts`, `src/core/models/decision.ts`, `src/tools/web/webSearchProvider.ts` | Resuelto (refactor) | 2026-11-15 |
| Alinear `JARVIS_API`, `CONTEXT_AND_MEMORY`, `CORE_FLOW`, `ARCHITECTURE` | Media | `docs/*.md` | Resuelto | 2026-11-15 |
| Consolidar revisión `run_command` y borrar duplicado en `src/tools/terminal/` | Baja | `docs/REVISION_run_command.md`, `src/tools/terminal/` | Resuelto | 2026-11-15 |
| Descartar refactors que no aportan (`regex`, `precheck` cache, `runCall`, `prompts.ts`) | — | `src/core/trace/format.ts`, `src/core/engine/precheck.ts`, `src/core/engine/callRunner.ts`, `src/core/models/prompts.ts` | Descartado | 2026-11-15 |
| Incluir `lastResult` aprobado en `done` de `forRoute` (`P-EVAL-01`) | Alta | `src/core/ctx/views/route.ts:27`, `tests/__golden__/render.json` | Resuelto (0 regresiones en eval 573/624 91.8% y golden actualizado) | 2026-11-15 |
| Quitar mención al parámetro `shell` en `osLine("windows")` (`P-EVAL-02`) | Baja | `src/core/models/prompts.ts:131-135` | Descartado (sin mejora real en validez de comandos; se preserva baseline) | 2026-11-15 |
| Traducir `retryNote` al inglés (`P-EVAL-03`) | Baja | `src/core/models/prompts.ts:86-89` | Descartado (empate exacto 10/12 en reintentos, sin evidencia de beneficio) | 2026-11-15 |
| Cuerpos de error HTTP 200 en `/api/mcp/*` | Baja | `src/server/mcpRouter.ts` | Documentado sin cambios | 2026-11-15 |

---

## 6. Resultados de Evaluación Experimental (P-EVAL-01, P-EVAL-02, P-EVAL-03)

### P-EVAL-01 — Restaurar última lectura aprobada en `done` de `forRoute`
- **Cambio:** En `src/core/ctx/views/route.ts:27`, se eliminó el filtro `.filter((c) => c.id !== last?.id)`, de modo que `done` contiene todas las llamadas aprobadas (D1 y D2 ya no sufren ceguera sobre lecturas previas).
- **Medición A/B (`eval/cli.ts --stages=route,tool_choice --repeat=3` sobre suites completas: 624 evaluaciones):**
  - Línea base: `573/624` pasados (`91.8%`, macro `95.7%`, p50 86ms).
    - `route_16_cases`: `45/48` (`93.8%`)
    - `route_gemai`: `39/48` (`81.3%`)
    - `route_terminal_explicit`: `225/246` (`91.5%`)
    - `route_terminal_goals`: `228/246` (`92.7%`)
    - `tool_choice_16_cases`: `36/36` (`100.0%`)
  - Con P-EVAL-01: `573/624` pasados (`91.8%`, macro `95.7%`, p50 86ms).
    - **Exactamente 0 regresiones** en todos los datasets.
    - Suite complementaria `route_D1_hard` (38 casos x 3 repeticiones): `111/114` pasados (`97.4%`).
  - Verificación `safe()` en `threadBlock` y `Request:`: evaluado en `continuation, pending, route` (`route_16_cases` 93.8% 30/32, `llm_pending` 81.3% 52/64) confirmando que no degrada ninguna etapa.
- **Acción:** **Aplicado**. Se actualizó `tests/__golden__/render.json` (agregando la llamada aprobada `c3 s2 files/read_file` en `done` de `routeInput` y `toolInput`). El campo `lastResult` en `contracts.ts` se preserva como legado documental opcional por compatibilidad con variantes históricas de `eval/variants/` (`route_lean`, `tool_choice_lean`), pero ya no se renderiza en producción.

### P-EVAL-02 — Mención de `shell` en `ARGUMENTS_VIEW.osLine("windows")`
- **Evaluación:** Suite `eval/datasets/arguments/` (363 casos en 5 datasets x 3 repeticiones) + `eval:psvalid`:
  - Línea base: `328/363` (`90.4%`); psvalid: `cmd` 97% (114/117), `hard` 94% (31/33), `llm_arguments` 88% (21/24), `extra_hard` 96% (26/27).
  - Con recorte de `shell`: `331/363` (`91.2%`); psvalid idéntico (`cmd` 97%, `hard` 94%, `llm_arguments` 88%, `extra_hard` 96%).
- **Acción:** **Descartado**. No arrojó reducción de alucinaciones ni mejora sintáctica en comandos PowerShell (variación dentro del margen de ruido del modelo generativo). Se mantiene la redacción aprobada de producción.

### P-EVAL-03 — Traducción de `retryNote` al inglés
- **Evaluación:** Medición sobre casos de reintento por salida inválida / bloqueo (`args_blocked_repeat` x 2 repeticiones):
  - Línea base (español): `10/12` (`83.3%`).
  - Con `retryNote` en inglés (`PREVIOUS_ERROR:...`): `10/12` (`83.3%`), p50 equivalente.
- **Acción:** **Descartado**. Empate estricto sin evidencia empírica de mejora en recuperación ante reintentos. Se preserva el prompt original de producción.
