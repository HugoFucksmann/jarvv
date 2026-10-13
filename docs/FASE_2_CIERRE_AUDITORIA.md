# JARVIS Core — Cierre Formal de Fase 2: Erradicación de Límites de Llamadas, Auditoría de Cancelación y Memoria Progresiva

**Fecha:** 13 de octubre de 2026  
**Documento de Referencia:** `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md` (Fase 2)  
**Estado:** Fase 2 COMPLETADA Y VALIDADA  

---

## 1. Erradicación Total de Límites de Llamadas

En estricta conformidad con la Sección 2.2 y los Criterios de Aceptación 1 y 2 del Plan Maestro, se han suprimido de forma integral y verificable todos los límites y cortes artificiales de invocaciones:

### Modificaciones en el Código:
1. **`src/core/types.ts`:**
   - Eliminadas las constantes globales `MAX_TOOL_CALLS_PER_STEP = 4` y `MAX_TOOL_CALLS_TASK = 30`.
   - Se ratifican como únicos límites globales de referencia `MAX_STEPS = 15`, `MAX_REPLAN = 2`, `MAX_ARG_RETRIES = 2` y `MAX_ESCALATIONS = 2`.
2. **`src/core/callExecutor.ts`:**
   - Eliminado el import de `MAX_TOOL_CALLS_TASK`.
   - Eliminada la condición de parada artificial `if (context.totalToolCalls > MAX_TOOL_CALLS_TASK)`.
   - Se conserva el incremento métrico `context.totalToolCalls++` exclusivamente para telemetría, auditoría y resúmenes de tarea (`[Task Summary]`), sin imponer topes sobre la ejecución.
3. **`src/core/modeEngines.ts`:**
   - Eliminados los imports de `MAX_TOOL_CALLS_PER_STEP` y `MAX_TOOL_CALLS_TASK`.
   - En `runFastLoop`: Suprimido el corte artificial `if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK)`. La parada de la tarea se rige legítimamente por `task.stepSeq >= MAX_STEPS (15)`.
   - En `runPlanLoop`: Suprimido el corte artificial `if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK)` y el mini-loop restringido `while (stepCalls < MAX_TOOL_CALLS_PER_STEP ...)`. El paso en modo PLAN se ejecuta de forma continua evaluando el cumplimiento factual del criterio (`judgement.met`), errores de ejecución o bloqueos de bucle infinito (`blocked_loop`).
4. **Verificación Anti-Pools:**
   - Se auditó el código completo para certificar que no subsistan pools sustitutos (como pools de 15 o 30 llamadas) ni multiplicadores alternativos. La protección contra iteraciones descontroladas descansa en el mecanismo anti-bucles por firma (`nonReadCounter`), los reintentos locales acotados (`MAX_ARG_RETRIES = 2`) y el límite estructural `MAX_STEPS = 15`.

---

## 2. Memoria Contextual Progresiva (2 → 5 → 10)

Conforme a la Sección 7.1 y el Criterio de Aceptación 8, se formalizó e implementó la política de recuperación contextual progresiva sin sobrecargar el contexto con historiales completos ni salidas brutas:

### Modificaciones en el Código:
1. **Niveles Tipados (`src/core/types.ts`):**
   - Incorporada la tupla inmutable `PROGRESSIVE_MEMORY_TIERS = [2, 5, 10] as const`.
   - Definido el tipo `ProgressiveMemoryLimit = 2 | 5 | 10`.
2. **Contexto de Ejecución (`src/core/context.ts`):**
   - Agregado el campo `memoryRetrievalLimit: ProgressiveMemoryLimit` a `TaskExecutionContext`, inicializado en `2` (Nivel 1).
   - Implementada la función de ampliación determinista `expandMemoryContext(context: TaskExecutionContext): ProgressiveMemoryLimit`:
     - Nivel 1 (Inicial): Máximo de 2 elementos más relevantes.
     - Nivel 2 (Ampliación por insuficiencia o `d1.needsContext`): Expansión a 5 elementos relevantes.
     - Nivel 3 (Ampliación máxima): Expansión hasta 10 elementos relevantes (techo definitivo).
3. **Generación Compacta de Historial (`buildHistoryContext`):**
   - Parámetro de límite integrado: `buildHistoryContext(task, limit = 2, sessionHistory?)`.
   - Recuperación de hasta `limit` líneas recientes de `LOG` y hasta `min(limit, 5)` líneas de `FAIL`.
   - Soporte para incluir hasta `limit` mensajes pertinentes del historial de sesión sin volcar transcripciones redundantes.
4. **Integración con Decision Engine y Motores (`src/core/modeEngines.ts`):**
   - Inyección de `buildHistoryContext(task, context.memoryRetrievalLimit || 2)` en las llamadas a `evaluateDecisionOne`.
   - Activación automática de `expandMemoryContext(context)` cuando Decision #1 emite la señal `needsContext === true` o cuando se activan los flujos de recuperación `handleEscalation` o `handleReplan`.

---

## 3. Cancelación Simple e Invarianza de Estados Terminales

Conforme a la Sección 8.2 y el Criterio de Aceptación 3, se auditó y reforzó el ciclo de vida de cancelación simple para garantizar la invarianza de estados terminales y la neutralización de resultados tardíos:

### Modificaciones en el Código:
1. **Invarianza de Estados Terminales (`src/core/types.ts`):**
   - Definida la lista `TERMINAL_TASK_STATES = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const`.
   - Implementada la función de guarda `isTerminalState(state: TaskState): boolean`.
2. **Orquestador Central (`src/core/core.ts`):**
   - En `cancelTask`:
     - Se permite la cancelación inmediata de tareas en cualquier estado no terminal (incluyendo `RUNNING`, `WAITING_APPROVAL` o esperas de confirmación de plan).
     - Si la tarea ya se encuentra en un estado terminal, se descarta la operación.
     - Se aborta la señal `context.abortController.abort()`, se fija `context.task.state = "CANCELLED"`, se rechaza formalmente cualquier aprobación pendiente en Guard (`onDeny`), se limpia la memoria volátil de referencias (`RefStore.clear(taskId)`) y se emite el evento `TASK_STATE_CHANGED`.
   - En `confirmPlan`:
     - Se bloquea la reactivación si la tarea fue cancelada o está en un estado terminal (`if (context.isCancelled || isTerminalState(context.task.state)) return;`).
   - En `runTaskPipeline` (captura de errores):
     - Se verifica `!context.isCancelled && !isTerminalState(context.task.state)` antes de transicionar a `FAILED`, evitando sobreescribir `CANCELLED`.
3. **Protección contra Resultados Tardíos (`src/core/modeEngines.ts`):**
   - En `concludeTask`:
     - Guarda inicial: Si la tarea fue cancelada (`context.isCancelled || task.state === "CANCELLED"`), se descarta en silencio la conclusión y se limpia `RefStore`.
     - Guarda post-generación: Si la generación de la respuesta final de Qwen concluye tras una cancelación en vuelo, el resultado tardío se descarta sin sobreescribir el estado `CANCELLED`.
   - En `initiatePlanMode`:
     - Comprobaciones antes y después de `qwenEngine.generatePlan`. Si la tarea fue cancelada, no se genera el plan ni se sobreescribe el estado a `FAILED`.
   - En `runFastLoop` y `runPlanLoop`:
     - Guarda en el ciclo principal: `while (!context.isCancelled && !isTerminalState(task.state))`.
     - Comprobaciones inmediatas tras llamadas a LLM y MCP para abortar la ejecución si la tarea fue cancelada.
   - En `executeCall` (`src/core/callExecutor.ts`):
     - Si `context.isCancelled` está activo, se interrumpe el despacho a servidores MCP antes del envío físico.

---

## 4. Matriz de Verificación y Criterios de Salida de Fase 2

| Requisito / Acción | Estado | Evidencia en Código |
|---|---|---|
| Eliminación de `MAX_TOOL_CALLS_TASK` (30) | ✅ CUMPLIDO | Eliminado de `types.ts`, `callExecutor.ts` y `modeEngines.ts`. |
| Eliminación de `MAX_TOOL_CALLS_PER_STEP` (4) | ✅ CUMPLIDO | Eliminado de `types.ts` y del mini-loop de `modeEngines.ts:runPlanLoop`. |
| Prohibición de nuevos pools alternativos | ✅ CUMPLIDO | Ningún pool artificial agregado; parada gobernada por `MAX_STEPS = 15`. |
| Memoria contextual progresiva (2 → 5 → 10) | ✅ CUMPLIDO | Implementado en `types.ts`, `context.ts` y accionado en `modeEngines.ts`. |
| Cancelación simple e ignorar resultados tardíos | ✅ CUMPLIDO | Implementado en `core.ts` (`cancelTask`, `confirmPlan`) y `modeEngines.ts`. |
| Invarianza de estados terminales | ✅ CUMPLIDO | Guardas activas en `concludeTask`, `runFastLoop`, `runPlanLoop` e `initiatePlanMode`. |
| Compilación y Lint limpios | ✅ CUMPLIDO | `tsc --noEmit` (0 errores) y `vite build` (compilación exitosa). |

**Criterio de Salida de Fase 2:** **100% CUMPLIDO Y CERTIFICADO**.
El sistema queda completamente preparado para proceder a la **Fase 3: Implementación de Motor Unificado (`runStep`) e Integración de Eos**.
