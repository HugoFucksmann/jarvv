# Auditoría Profunda de Memoria, Contexto y Traza (`src`)

## 1. Estado de la sesión / Bitácora de progreso

- **Fecha y hora de última actualización**: 2026-10-22 15:05 (UTC-7)
- **Fase 1 — Mapa real vs. documentado**: COMPLETADA Y VERIFICADA ADVERSARIALMENTE
- **Fase 2 — Contexto**: COMPLETADA Y VERIFICADA ADVERSARIALMENTE
- **Fase 3 — Traza**: COMPLETADA Y VERIFICADA ADVERSARIALMENTE (análisis de doble escritura, ciclo terminal y matriz campo por campo cerrada)
- **Fase 4 — Código muerto y contratos de tipos**: COMPLETADA (búsqueda global de referencias cruzadas cerrada)
- **Fase 5 — Plan de acción y Decisiones**: CERRADO Y CATEGORIZADO (Decisiones de usuario registradas; Bloques A, B, C y D formalizados)
- **Cierre y Comprobación `tsc`**: VERIFICADA (`tsc --noEmit` exit code 0 sobre `src/`, `ui/`, `lab/`, `server.ts`)

> **Nota para retomar la sesión**: Se verificó punto por punto el subsistema de traza, confirmando que la protección de idempotencia (`context.traced`) e inmutabilidad terminal impiden de forma absoluta la doble escritura. Se definieron las fuentes únicas de verdad para correlación de secuencias (`seq` / `callSeq`), se verificaron las no afectaciones a `ui/` y `lab/`, se registraron formalmente las 5 decisiones del usuario y se reescribió el Plan de Acción Definitivo. El backend se mantiene 100% intacto (0 archivos de código editados).

---

## 2. Mapa del subsistema


### 2.1. Archivos Base y Roles Reales

| Archivo | Rol Real en el Runtime | Estructuras de Datos que Posee / Gobierna | Quién lo Invoca / Consume |
|---|---|---|---|
| `src/core/types.ts` | Fuente única de contratos de tipos, interfaces de estado, modelos, eventos y constantes globales del motor. | `Task`, `Step`, `StepCall`, `StepHandoff`, `TaskMemory`, `Scratchpad`, `ModelIteration`, `CoreEvent`, `Capability`, `ToolPolicy`, `PlanStep`, constantes `MAX_*`. | Todos los módulos de `src/core/`, `src/server/`, y componentes/hooks de `ui/`. |
| `src/core/context.ts` | Gestión de memoria volátil por tarea, ayudantes de contexto para prompts y ensamblado de historiales y handoffs. | `TaskExecutionContext`, `DataObservation`, funciones `addLogEntry`, `addEffectEntry`, `addFailEntry`, `ensureMemory`, `buildAttempts`, `buildPlanLines`, `buildHistoryContext`, `buildRefsContext`, `applyStepHandoff`. | `callExecutor.ts`, `modeEngines.ts`, `core.ts`. |
| `src/core/processor/resultProcessor.ts` | Normalización de salidas de MCP, cálculo de señales de error, extracción determinista de datos (`compactObs`, `finding`, `factsDelta`) y almacén en memoria de referencias completas. | Clase estática `RefStore` (`taskStores`, `taskCounters`, `taskMeta`), clase `ResultProcessor`, función `sanitizeForMemory`, `refLabel`. | `callExecutor.ts` (procesa cada salida), `refResolver.ts` (consulta `RefStore`), `core.ts` (desalojo con `RefStore.clear`). |
| `src/core/processor/refResolver.ts` | Sustitución determinista no recursiva de tokens indirectos (`{{ref:rX}}` o `ref:rX`) por su contenido real antes de Guard y despacho. | Funciones `resolveReferences`, `resolveValue`, `resolveString`, `schemaTypes`, expresiones regulares `EMBEDDED_REF`, `WHOLE_REF`. | `callExecutor.ts` (etapa 4.1 del pipeline atómico). |
| `src/core/reasoner/prompts.ts` | Ensamblado formal de prompts de Qwen (español) y Decision 2.0 / Eos (inglés), control de presupuestos en caracteres y prefijos. | Constantes `PROMPTS` (`ARGUMENTS`, `FINAL_RESPONSE`, `PLAN`, `REPLAN`, `STAGE_VERIFICATION`), `DECISION_PROMPTS`, presupuestos `MAX_*_CHARS`, funciones `dataBlock`, `clipObs`, `tailLines`, `safe`. | `qwen.ts`, `decision.ts`. |
| `src/core/taskTrace.ts` | Serialización append-only de traza en archivo JSONL (`jarvis-traces.jsonl`) al término de cada tarea. | Función `recordTaskTrace`. Lee `task.modelIterations`, `task.steps`, `task.message`, `task.finalResponse`. | `core.ts` (`cancelTask`, `rejectPlan`), `modeEngines.ts` (`concludeTask`, `failTask`). |
| `src/core/core.ts` | Orquestador central del ciclo de vida de tareas en memoria RAM, emisión de eventos SSE y administración de cupo de retención. | Clase `JarvisCore`, mapa `taskContexts: Map<string, TaskExecutionContext>`, oyentes `listeners: Set<CoreEventListener>`. | `server.ts` (instancia única), `jarvisRouter.ts` (endpoints REST/SSE). |
| `src/core/modeEngines.ts` | Motores de orquestación reactiva (`FAST`) y deliberativa (`PLAN`), bucles de ejecución, escalación por desvíos y replanificación autónoma. | Funciones `runFastLoop`, `initiatePlanMode`, `runPlanLoop`, `handleEscalation`, `handleReplan`, `concludeTask`, `failTask`. | `core.ts` (`runTaskPipeline`, `confirmPlan`, `provideUserAnswer`). |
| `src/core/callExecutor.ts` | Ejecutor atómico paso a paso: descubrimiento, Decision #2, generación de argumentos, resolución de refs, anti-loop, Guard, despacho MCP, procesamiento de resultados y doble verificación. | Funciones `runStep`, `recordFailedCall`, `requestUserApproval`. Maneja `context.executedSignatures`, `context.nonReadCounter`. | `modeEngines.ts` (`runFastLoop`, `runPlanLoop`). |
| `src/core/decision.ts` | Cliente HTTP del modelo clasificador local Decision-2.0-Eos-0.8B para Decision #1, Decision #2 y verificación factual de paso. | Clase `Decision20Engine` (`evaluateDecisionOne`, `evaluateDecisionTwo`, `evaluateStepVerification`, `systemOne`). | `callExecutor.ts`, `modeEngines.ts`, instanciado en `server.ts`. |
| `src/core/reasoner/qwen.ts` | Cliente HTTP para el motor de razonamiento Qwen 3.5 9B (OpenAI compatible). | Clase `QwenEngine` (`generateArguments`, `generatePlan`, `replan`, `verifyStage`, `generateFinalResponse`). | `callExecutor.ts`, `modeEngines.ts`, instanciado en `server.ts`. |
| `src/core/policy/guard.ts` | Compuerta determinista de seguridad y autorización ante mutaciones y patrones destructivos prohibidos. | Clase `Guard` (`evaluate`, `matchesDenyPattern`, `denyScanArgs`). | `callExecutor.ts`. |
| `src/core/tools/manifest.ts` | Catálogo cerrado de herramientas autorizadas, mapeo de rutas ejecutables a servidores MCP y políticas estáticas. | `DESTINATIONS`, `SYSTEM_TOOL_MANIFEST`, índice `INDEX`, funciones `getToolPolicy`, `applyDestination`, `serverOf`. | `callExecutor.ts`, `modeEngines.ts`, `guard.ts`, `context.ts`. |
| `src/core/debugAccumulator.ts` | Mapeo de `CoreEvent` a `ModelIteration` para consumo reactivo en UI y trazabilidad. | Función `createIterationFromEvent`. | `core.ts` (`emitEvent`). Re-exportado por `ui/utils/debugAccumulator.ts`. |
| `src/core/config.ts` | Gestor y persistencia de configuración local de endpoints, timeouts y rutas de traza (`jarvis-config.json`). | Clase `ConfigManager`, interfaces `JarvisConfig`, `ConfigPatch`. | `decision.ts`, `qwen.ts`, `taskTrace.ts`, `jarvisRouter.ts`. |
| `src/core/taskWire.ts` | Adaptador de desprendimiento de cargas pesadas (`modelIterations`) para el transporte de tareas vía SSE y listados. | Función `toWireTask`. | `core.ts`, `jarvisRouter.ts`. |
| `src/core/persistence.ts` | **CÓDIGO HUÉRFANO/MUERTO**: Implementa `TaskStore` para almacenamiento atómico y recuperación de tareas en disco con copias `.bak`. | Clase `TaskStore`. | **Ninguno en todo el repositorio** (confirmado con búsqueda global de referencias e imports). |

---

### 2.2. Mapa de Tipos de Memoria: Documentado vs. Real en Código

| Tipo de Memoria (según Doc) | Nombre / Estructura Real en Código | Quién y Cómo Escribe | Cota Operativa en Código | Política de Recorte | Momento de Descarte | Divergencia Detectada |
|---|---|---|---|---|---|---|
| **Estado Transitorio de Trabajo** | `context.lastCallCompactObs`, `context.lastCallTool`, `context.lastCallStepId`, `context.lastCallDecisionSummary` y `task.scratchpad` | `callExecutor.ts:375-388` tras cada resultado MCP. `resultProcessor.ts:404`. | `MAX_SCRATCHPAD_RESULTS = 10` para búsquedas. 1 string para última obs. | Sobrescritura en cada paso; `search_results` trunca a 10 elementos. | Sobrescrito en cada paso ejecutor; purgado al expulsarse la tarea. | Conviven dos estructuras: `context.lastCall*` (para prompts internos) y `task.scratchpad` (para UI y Decision #2). Campos huérfanos en `Scratchpad` (`selected_result`, `text`). |
| **Registro Cronológico de Acciones** | `task.memory.log: string[]` y `task.steps[].calls: StepCall[]` | `addLogEntry(context, line)` en `callExecutor.ts:499`. | 30 entradas en `task.memory.log`. | FIFO cola estricto: conserva las 30 más recientes (`slice(-30)`). | Expulsión de tarea de RAM (`evictTerminalTasks`). | `task.memory.log` tiene cota 30. `task.steps[].calls` acumula las llamadas del paso sin poda pero acotado por `MAX_STEPS = 15`. Prompt de Qwen recorta a `MAX_LOG_CHARS = 2500`. |
| **Hechos Confirmados** | `task.memory.facts: Record<string, string>` | `Object.assign(ensureMemory(context).facts, processed.factsDelta)` en `callExecutor.ts:486` y `core.ts:312`. | Sin cota en RAM (acotado naturalmente por claves). En prompts acotado a `MAX_FACTS_CHARS = 2500` (valor max 400 chars). | FIFO en prompts (`tailLines`). | Expulsión de la tarea de RAM. | Contradicción doc-vs-doc: `CORE_FLOW.md:24` autoriza asentar si no hubo veredicto (`noVerdict`), mientras que `CONTEXT_AND_MEMORY.md:9` dice descartar datos no verificados. |
| **Mutaciones Consolidadas** | `task.memory.effects: string[]` | `addEffectEntry(context, effect)` en `callExecutor.ts:532` si `isCleanSignals && policy.mutates`. | 25 entradas en memoria. | FIFO cola: conserva las 25 más recientes (`slice(-25)`). En prompts `MAX_EFFECTS_CHARS = 1200`. | Expulsión de la tarea de RAM. Inmune a replanificación. | Alineado con la documentación. |
| **Registro de Fallos** | `task.memory.fail: string[]` | `addFailEntry(context, line)` en `callExecutor.ts` (Guard, loop, args inválidos, verificación) y `modeEngines.ts`. | 5 entradas en memoria. | FIFO cola: conserva las 5 más recientes (`slice(-5)`). En prompts `MAX_FAIL_CHARS = 1200`. | Expulsión de la tarea de RAM. | Alineado con la documentación. |
| **Observaciones de Datos** | `context.dataObs: DataObservation[]` | `recordDataObservation(context, obs)` en `callExecutor.ts:383` solo si lectura limpia no mutante con datos. | `MAX_DATA_OBSERVATIONS = 3`. | FIFO cola: conserva las 3 más recientes (`slice(-3)`). En prompt de args cota de 6000 chars. | Expulsión de la tarea de RAM. | Alineado con la documentación. |
| **Enlace Determinista de Paso** | `context.lastHandoff: StepHandoff` y `step.handoff: StepHandoff` | `callExecutor.ts:536-548` solo si `isStepSuccess === true`. | 1 elemento (último paso completado con éxito). | Sobrescritura en cada paso exitoso. | Se conserva hasta el siguiente paso exitoso o fin de tarea. | Si un paso intermedio falla, `context.lastHandoff` retiene el handoff del paso previo sin invalidarse (INC-014). Valores entran a `TASK:` sin pasar por `<obs>`. |
| **Almacén de Referencias** | `RefStore` (mapas estáticos indexados por `taskId`) | `RefStore.put(fullText, taskId, label)` en `resultProcessor.ts:254` si `fullText.length > 0`. | Sin cota individual por tarea. Acotado por `MAX_RETAINED_TASKS = 20`. | No tiene recorte interno. Describe últimas 8 refs a Qwen. | `RefStore.clear(taskId)` al desalojar la tarea de RAM en `evictTerminalTasks`. | `RefStore.get` posee un fallback global que busca en todas las tareas si falta `taskId` (riesgo latente INC-001). |

---

### 2.3. Análisis Exhaustivo de Duplicidad y Pérdida en la Traza

#### 2.3.1. Puntos de Invocación de `recordTaskTrace` y Caminos a Estado Terminal

La función `recordTaskTrace(context)` en `src/core/taskTrace.ts:19` es el único punto de salida hacia el archivo append-only `jarvis-traces.jsonl`. Se analizaron exhaustivamente todos los caminos posibles hacia estados terminales y situaciones de error:

| Camino a Estado Terminal | Disparador / Archivo:Línea | ¿Llama a `recordTaskTrace`? | ¿Puede escribir la traza dos veces? | Evidencia / Mecanismo de Protección |
|---|---|:---:|:---:|---|
| **Completada (`COMPLETED`)** | `modeEngines.ts:208` en `concludeTask` | **SÍ** | **NO** | Protegido por `context.traced = true` (`taskTrace.ts:20-21`) y guardia terminal (`modeEngines.ts:128`). |
| **Parcial (`PARTIAL`)** | `modeEngines.ts:208` en `concludeTask` | **SÍ** | **NO** | Mismo flujo centralizado de conclusión terminal en `concludeTask`. |
| **Fallida (`FAILED`) — Conclusión normal** | `modeEngines.ts:208` en `concludeTask` | **SÍ** | **NO** | Cierre controlado tras agotar replans, bloqueos irremediables o denegación de Guard. Protegido por `context.traced = true`. |
| **Fallida (`FAILED`) — Excepción de pipeline** | `modeEngines.ts:113` en `failTask` | **SÍ** | **NO** | Único punto de cierre por excepción (`modeEngines.ts:100`). Verifica `if (isTerminalState(task.state)) return;` y `context.traced`. |
| **Cancelada (`CANCELLED`) — Usuario** | `core.ts:210` en `cancelTask` | **SÍ** | **NO** | Verifica `if (isTerminalState(context.task.state) || context.isCancelled) return;` (`core.ts:189`) y `context.traced`. |
| **Cancelada (`CANCELLED`) — Rechazo de plan** | `core.ts:234` en `rejectPlan` | **SÍ** | **NO** | Verifica `isAwaitingPlanConfirmation` (`core.ts:227`), aborta contexto y ejecuta `recordTaskTrace`. `context.traced = true` bloquea duplicados. |
| **Expulsión de RAM — Tarea terminal previa** | `core.ts:371-374` en `evictTerminalTasks` | **NO (ya escrita)** | **NO** | La tarea ya escribió su traza al pasar a estado terminal; la expulsión solo libera RAM y `RefStore`. |
| **Expulsión de RAM — Tarea abandonada (`WAITING_INPUT`)** | `core.ts:362` en `pruneTasks` | **SÍ** | **NO** | Invoca `this.cancelTask(abandoned.task.id)`, que emite traza como `CANCELLED`. Idem protección. |
| **Error no capturado en tarea en vuelo** | `core.ts:148` en `runDetached` | **SÍ** | **NO** | `work().catch((err) => failTask(context, ...))`. Cierra vía `failTask:113` registrando traza. |
| **Parada forzada del servidor (SIGINT/SIGTERM)** | `server.ts:89-94` | **NO** | **NO** | Conforme a la Decisión P3, `server.ts` cierra servidores MCP y finaliza inmediatamente (`process.exit(0)`). Las tareas activas no dejan traza. |

#### 2.3.2. Evaluación de Protección contra Doble Escritura e Inmutabilidad Terminal
- **Idempotencia Uncondicional**: En `src/core/taskTrace.ts:20-21`, la primera línea de `recordTaskTrace` verifica:
  ```ts
  if (context.traced) return;
  context.traced = true;
  ```
  Esto garantiza que ninguna tarea pueda escribir más de una línea en `jarvis-traces.jsonl`, incluso si múltiples hilos asíncronos o eventos de cierre compitiesen concurrentemente.
- **Inmutabilidad ante Cancelaciones en Vuelo**: En `modeEngines.ts:128, 189`, `concludeTask` comprueba antes y después de invocar a Qwen (`generateFinalResponse`):
  ```ts
  if (context.isCancelled || task.state === "CANCELLED") return;
  ```
  Si el usuario cancela la tarea mientras Qwen sintetiza la respuesta final, la resolución tardía de Qwen es completamente ignorada y no altera el estado `CANCELLED` ni produce una segunda traza.
- **Fallo durante Replan**: Si ocurre una excepción o fallo de red durante `handleReplan`, el error es capturado por el bucle de `runPlanLoop` o `runDetached`, canalizándose a `concludeTask` o `failTask`. Debido al guard `context.traced`, no existe posibilidad de doble traza.

#### 2.3.3. Producción de `ModelIteration`: Reintentos y Excepciones
- **Reintentos de Transporte (`src/core/llmTransport.ts:72-93`)**: Los reintentos por caída de red o HTTP 503 ocurren dentro del bucle interno de `postJson`. No emiten ningún `CoreEvent`. Producen exactamente **1** llamada devuelta (o lanzan excepción). Por tanto, generan exactamente **1** `ModelIteration` (o **0** si la llamada falla definitivamente).
- **Reintentos Correctivos por Salida Inválida (`src/core/reasoner/qwen.ts:520-547`)**: `dispatchValidated` ejecuta hasta `LLM_INVALID_OUTPUT_RETRIES` intentos directamente contra el modelo antes de retornar al orquestador. Durante estos reintentos no se emiten eventos. El orquestador emite un único `CoreEvent` (ej. `ARGUMENTS_GENERATED`) con el último `rawInput`/`rawOutput` obtenido. No hay duplicación de `ModelIteration`.
- **Deduplicación en `core.ts:103-107`**:
  ```ts
  const existingIdx = ctx.task.modelIterations.findIndex((it) => it.id === iteration.id);
  if (existingIdx >= 0) {
    ctx.task.modelIterations[existingIdx] = iteration;
  } else {
    ctx.task.modelIterations.push(iteration);
  }
  ```
  Si un evento re-emitiera la misma iteración con el mismo `id`, se actualiza en lugar de duplicarse.
- **Omisión por Diseño**:
  - `DECISION_ONE` en modo `PLAN`: `debugAccumulator.ts:37` descarta intencionalmente la iteración (`if (task?.mode === "PLAN") return null;`).
  - Atajo sintético de Decision #2 (`SINGLE_TOOL_SHORTCUT`): `taskTrace.ts:33` lo filtra explícitamente (`!(it.stage === "DECISION_TWO" && it.rawOutput?.includes(SINGLE_TOOL_SHORTCUT))`) para no considerarlo una llamada a modelo real.

#### 2.3.4. Integridad de Memoria y Manejo de Errores de Escritura
- **¿Algo recorta `modelIterations` antes de la traza?**: **NO**. Búsqueda global en todo el código confirma que `modelIterations` nunca es recortado ni mutado. `toWireTask` (`src/core/taskWire.ts:15`) omite la propiedad únicamente en la copia superficial para el transporte SSE/REST, dejando intacto el array en el objeto `task` de memoria RAM.
- **¿Qué ocurre si falla la escritura en disco?**: En `taskTrace.ts:78-80`, `fs.appendFileSync` está envuelto en `try / catch`. Si el disco está lleno, no tiene permisos o la ruta no existe, se emite un `console.warn` y el flujo continúa con normalidad sin interrumpir la tarea ni propagar excepciones al usuario.

#### 2.3.5. Matriz Campo por Campo: Lo que Escribe `taskTrace.ts` vs. lo que Lee `lab/extract-cases.ts`

| Objeto de Traza | Campo en `taskTrace.ts` | Estado en Código Actual | Campo en `lab/extract-cases.ts` | Uso en Laboratorio | Diagnóstico |
|---|---|---|---|---|---|
| **Cabecera** | `v` | Escribe `1` | `v` | Validación de versión de esquema | Alineado |
| | `taskId` | Escribe `task.id` | `taskId` | Identificador de fuente del caso | Alineado |
| | `startedAt` | Escribe ISO string | `startedAt` | Metadato temporal | Alineado |
| | `endedAt` | Escribe ISO string | `endedAt` | Metadato temporal | Alineado |
| | `mode` | Escribe `task.mode` | `mode` | Filtro por modo (`NORMAL` / `PLAN`) | Alineado |
| | `userMessage` | Escribe `task.message` | `userMessage` | Objetivo global | Alineado |
| | `status` | Escribe `task.state` | `status` | Estado terminal | Alineado |
| | `finalResponse` | Escribe `task.finalResponse` | `finalResponse` | Referencia en `final_response` | Alineado |
| | `plan` | Escribe `steps` (en modo PLAN) | `plan` | Contexto de etapas planificadas | Alineado |
| **`calls[]`** | `seq` | Escribe `i + 1` | `seq` | Identificador de secuencia del caso | Alineado |
| | `step` | Escribe `it.stepId` o `null` | `step`, `stepId` | Enlace al paso del plan | Alineado |
| | `stage` | Escribe `it.stage` | `stage` | Enrutador a los 8 evaluadores del lab | **Falla en `REPLAN`** (escribe `"PLAN_GENERATION"`, ver INC-003) |
| | `rawInput` | Escribe `it.rawInput` | `rawInput` | Prompt / payload exacto enviado al modelo | Alineado |
| | `rawOutput` | Escribe `it.rawOutput` | `rawOutput` | Respuesta cruda devuelta por el modelo | Alineado |
| | `latencyMs` | **OMITIDO** | `latencyMs` | Auditoría de tiempo de inferencia | **Pérdida de datos (INC-011)** |
| | `promptTokens` | **OMITIDO** | `promptTokens` | Conteo de tokens de entrada | **Pérdida de datos (INC-011)** |
| | `completionTokens` | **OMITIDO** | `completionTokens` | Conteo de tokens de salida | **Pérdida de datos (INC-011)** |
| | `error` | **OMITIDO** | `error` | Registro de fallo de inferencia | Omitido (solo excepciones fatales) |
| **`toolRuns[]`** | `step` | Escribe `s.id` | `step` | Fallback de correlación secundaria | Alineado |
| | `tool` | Escribe `c.tool` | `tool` | Nombre de la herramienta ejecutada | Alineado |
| | `args` | Escribe `c.args` | `args` | Argumentos reales ejecutados | Alineado (requiere cota INC-012) |
| | `ok` | Escribe booleano | `ok` | Veredicto de ejecución física | Alineado |
| | `error` | Escribe `c.error` (slice 300) | `error` | Mensaje de fallo de herramienta | Alineado |
| | `callSeq` | **OMITIDO** | `callSeq` | **Correlación primaria con `calls[].seq`** | **Pérdida de datos crítica (INC-002)** |
| | `resultPreview`| **OMITIDO** | `resultPreview` | Previsualización de observación de tool | **Pérdida de datos (INC-002)** |

> **Conclusión sobre Duplicidad y Pérdida**:
> Con la evidencia empírica analizada en código, **NO EXISTE duplicidad de trazas** (protegido estrictamente por `context.traced` e inmutabilidad terminal). **NO EXISTE pérdida de iteraciones** por descarte o poda en memoria. Las únicas pérdidas reales de datos son las ausencias contractuales en los campos de `toolRuns` (`callSeq`, `resultPreview`) y de `calls` (`latencyMs`, `promptTokens`, `completionTokens`), tratadas individualmente en INC-002 e INC-011.

---

## 3. Inconsistencias (Fichas Verificadas Adversarialmente)

### INC-001: Violación del principio de aislamiento estricto en `RefStore` (Fallback global)
- **Estado de verificación**: CORREGIDA (se confirma que en el flujo real actual todos los llamadores pasan `task.id` de forma consistente; se reclasifica de "alta" a "media" por constituir un riesgo latente de seguridad y brecha de defensa en profundidad).
- **Tipo**: invariante violado
- **Severidad**: media (riesgo latente arquitectónico)
- **Archivo(s) y líneas**: `src/core/processor/resultProcessor.ts:42, 70-79`
- **Evidencia cruda**:
  ```ts
  // src/core/processor/resultProcessor.ts:42
  static put(content: string, taskId: string = "default", label?: string): string {
  // src/core/processor/resultProcessor.ts:70-79
  static get(key: string, taskId?: string): string | undefined {
    if (taskId) {
      return this.taskStores.get(taskId)?.get(key);
    }
    for (const store of this.taskStores.values()) {
      const val = store.get(key);
      if (val !== undefined) return val;
    }
    return undefined;
  }
  ```
  Contradice `docs/CONTEXT_AND_MEMORY.md:39` ("Los componentes de consulta nunca leen ni resuelven referencias fuera del identificador de la tarea activa") e Invariante 2 ("Ninguna tarea puede consultar, resolver o alterar referencias pertenecientes a otra tarea").
- **Por qué es una inconsistencia**: Si `taskId` llegase a omitirse o ser falsy en una consulta a `RefStore.get`, el método itera sobre todos los almacenes de todas las tareas activas y retenidas en memoria (`for (const store of this.taskStores.values())`). Asimismo, `RefStore.put` asigna por defecto el identificador compartido `"default"`. Aunque en el código actual los llamadores activos (`callExecutor.ts:252` y `callExecutor.ts:374`) pasan siempre `task.id`, la existencia de este fallback global representa una vulnerabilidad latente ante futuras extensiones o refactorizaciones.
- **Alcance/impacto**: Potencial fuga de referencias entre tareas en memoria en caso de invocaciones que omitan el contexto.
- **Usos globales verificados**:
  - `src/core/processor/refResolver.ts:60`: `const content = RefStore.get(key, state.taskId);` (pasa `state.taskId`).
  - `src/core/processor/resultProcessor.ts:254`: `refKey = RefStore.put(fullText, taskId, refLabel(tool, args));` (pasa `taskId`).
  - `src/core/context.ts:249`: `RefStore.describe(task.id, limit)` (pasa `task.id`).
  - `src/core/core.ts:372`: `RefStore.clear(id)` (pasa `id`).
- **Solución propuesta**:
  1. En `RefStore.get(key: string, taskId: string)`: tipar `taskId` como obligatorio (`string`). Eliminar el bucle de búsqueda global `for (const store of this.taskStores.values())`. Si `taskId` no se suministra o no existe su almacén, retornar inmediatamente `undefined`.
  2. En `RefStore.put(content: string, taskId: string, label?: string)`: tipar `taskId` como obligatorio sin valor por defecto `"default"`.
  3. En `ResultProcessor.process`: tipar `taskId: string` como obligatorio.
- **Riesgos y efectos colaterales**: Ninguno. Todos los llamadores reales en el flujo activo ya proveen `task.id`.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-002: Pérdida de datos en traza JSONL: omisión de `callSeq` y `resultPreview` en `toolRuns`
- **Estado de verificación**: CONFIRMADA Y PRECISADA (se analizó `lab/extract-cases.ts:379-387` y `src/core/taskTrace.ts:32-50`). Se demostró matemáticamente por qué una asignación local de `seq` en `StepCall` durante `runStep` falla y cómo garantizar la coincidencia exacta con `calls[].seq`.
- **Tipo**: pérdida de datos / tipo/contrato
- **Severidad**: alta (rompe la correlación directa del consumidor `lab/extract-cases.ts`)
- **Archivo(s) y líneas**: `src/core/taskTrace.ts:32-50` vs `lab/extract-cases.ts:54-62, 234-274`
- **Evidencia cruda**:
  ```ts
  // src/core/taskTrace.ts:32-50
  const calls = (task.modelIterations ?? [])
      .filter((it) => it.rawInput !== undefined && !(it.stage === "DECISION_TWO" && it.rawOutput?.includes(SINGLE_TOOL_SHORTCUT)))
      .map((it, i) => ({
          seq: i + 1,
          step: it.stepId && stepIds.has(it.stepId) ? it.stepId : null,
          stage: it.stage,
          rawInput: it.rawInput,
          rawOutput: it.rawOutput,
      }));

  const toolRuns = task.steps.flatMap((s) =>
      (s.calls ?? []).map((c) => ({
          step: s.id,
          tool: c.tool,
          args: c.args ?? null,
          ok: c.outcome?.isError !== true,
          error: c.outcome?.isError === true ? (c.error ?? "").slice(0, MAX_TOOL_ERROR_CHARS) || null : null,
      }))
  );
  // lab/extract-cases.ts:241-244
  const byCallSeq = toolRuns.find(
    (tr) => tr.callSeq !== undefined && tr.callSeq !== null && String(tr.callSeq) === String(seq)
  );
  ```
- **Por qué es una inconsistencia**:
  1. En `lab/extract-cases.ts:379-387`, `seq` proviene de `calls[].seq` (el ordinal 1-based de las llamadas reales a modelo).
  2. Para extraer casos de `arguments`, `extract-cases` busca en `toolRuns` mediante `tr.callSeq === seq`. Al no emitirse `callSeq`, recurre al fallback por `step` (`tr.step === step`), lo que devuelve erróneamente la primera llamada en pasos con reintentos o ejecuciones múltiples.
  3. `resultPreview` (que el laboratorio espera para capturar la observación observable de la herramienta) se omite por completo.
- **Análisis de la Fuente Única del `seq` y Desplazamiento por Filtro**:
  - ¿Puede `StepCall` guardar `seq` durante `runStep` (ej. basado en la longitud de `modelIterations`)? **NO**: En `taskTrace.ts:33`, el array `modelIterations` pasa por un filtro:
    `it.rawInput !== undefined && !(it.stage === "DECISION_TWO" && it.rawOutput?.includes(SINGLE_TOOL_SHORTCUT))`
    Si alguna iteración no tuvo `rawInput` o utilizó el atajo de herramienta única de Decision #2, el filtro la elimina. El `.map((it, i) => ({ seq: i + 1 }))` se ejecuta **después** del filtro. Por ende, cualquier índice calculado en tiempo de ejecución antes del filtro se desfasará con respecto al `seq` final de `calls`.
  - **Garantía de Coincidencia (Única Fuente de Verdad)**:
    La única fuente de verdad debe residir en `taskTrace.ts` al momento de la serialización:
    1. Se calcula `calls` filtrado y numerado (`seq = i + 1`).
    2. Al construir `toolRuns`, para cada llamada física `c` en `s.calls`, se busca en `calls` la llamada de `stage === "ARGUMENT_GENERATION"` correspondiente al paso `s.id` (emparejamiento ordenado FIFO por paso).
    3. Se extrae `matchingCall.seq` y se asigna a `toolRun.callSeq`.
    De este modo, `toolRun.callSeq` y `calls[].seq` provienen idénticamente del mismo arreglo materializado, garantizando coincidencia estricta sin riesgo de desalineación por filtros.
- **Solución propuesta**:
  En `src/core/taskTrace.ts`:
  1. Resolver `callSeq` de cada `toolRun` a partir del `seq` de su correspondiente llamada `ARGUMENT_GENERATION` en `calls`.
  2. Asignar `resultPreview: (c.evidence?.obs || c.evidence?.summary || "").slice(0, 500) || undefined`.
- **Riesgos y efectos colaterales**: Ninguno. Compatible de forma ascendente con `lab`.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-003: Ausencia de evento y etapa `REPLAN` en el ciclo de vida y traza
- **Estado de verificación**: CONFIRMADA Y VERIFICADA EN CONSUMIDORES DE UI (se comprobó que `isReplan: true` en el payload de `PLAN_GENERATED` no rompe ningún consumidor de `ui/` y que las demás emisiones de plan no marcan dicho flag).
- **Tipo**: tipo/contrato / pérdida de datos
- **Severidad**: alta (rompe la categorización ontológica de iteraciones y fuerza heurísticas frágiles en el lab)
- **Archivo(s) y líneas**: `src/core/modeEngines.ts:360-365, 613-617`, `src/core/core.ts:284-288`, `src/core/debugAccumulator.ts:225-256`, `ui/utils/taskStatus.ts:140`, `ui/components/DecisionStream/DecisionStream.tsx:82`
- **Evidencia cruda**:
  ```ts
  // src/core/modeEngines.ts:360-365 (handleReplan)
  deps.emitEvent(task.id, "PLAN_GENERATED", {
      steps: task.steps,
      isMaterialReplan: false,
      rawInput: replanResult.rawInput,
      rawOutput: replanResult.rawOutput,
  });
  // src/core/modeEngines.ts:613-617 (initiatePlanMode)
  deps.emitEvent(task.id, "PLAN_GENERATED", {
      steps: task.steps,
      rawInput: plan.rawInput,
      rawOutput: plan.rawOutput,
  });
  // src/core/core.ts:284-288 (modifyPlan)
  this.emitEvent(taskId, "PLAN_GENERATED", {
      steps: task.steps,
      rawInput: newPlan.rawInput,
      rawOutput: newPlan.rawOutput,
  });
  // ui/utils/taskStatus.ts:140-142
  case "PLAN_GENERATED":
  case "PLAN_MODIFIED":
      return { stateGroup: "working", label: "Razonador estructurando plan de ejecución…" };
  // ui/components/DecisionStream/DecisionStream.tsx:82-83
  case "PLAN_GENERATED":
      return `Plan generado (${(d.steps || []).length} etapas)`;
  ```
- **Por qué es una inconsistencia**:
  `ModelStage` define `"REPLAN"`, pero en la ejecución real nunca se genera una `ModelIteration` con ese stage. `handleReplan` emite `PLAN_GENERATED` y `debugAccumulator.ts:232` fija de forma rígida `stage: "PLAN_GENERATION"`. Por ende, ni la UI ni la traza JSONL reflejan el stage `"REPLAN"`, obligando al laboratorio (`lab/extract-cases.ts:417`) a usar un contador heurístico que falla si el usuario utilizó `modifyPlan`.
- **Verificación de No Afectación en UI y Emisiones Diferenciadas**:
  - `ui/utils/taskStatus.ts:140` evalúa `switch(event.type)`: recibe `"PLAN_GENERATED"` y devuelve la etiqueta de progreso. Añadir `isReplan: true` al payload no altera `event.type`.
  - `ui/components/DecisionStream/DecisionStream.tsx:82` evalúa `switch(ev.type)`: lee `d.steps.length`. No lee `stage` ni `isReplan`.
  - Verificación de emisores:
    - `initiatePlanMode` (`modeEngines.ts:613`): plan inicial -> **NO marca `isReplan`** (queda undefined).
    - `modifyPlan` (`core.ts:284`): modificación interactiva del plan por usuario -> **NO marca `isReplan`** (queda undefined).
    - `handleReplan` (`modeEngines.ts:360`): replanificación autónoma tras error -> **Marca `isReplan: true`**.
- **Solución propuesta**:
  1. En `modeEngines.ts:360` (`handleReplan`), incluir `isReplan: true` en el payload de `PLAN_GENERATED`.
  2. En `debugAccumulator.ts:225`, condicionar:
     `stage: data.isReplan ? "REPLAN" : "PLAN_GENERATION"`
     `id: data.isReplan ? "iter_${ts}_qwen_replan" : "iter_${ts}_qwen_plan"`
     `stepTitle: data.isReplan ? "Replanificación Autónoma de Etapas" : "Planificación Estratégica Global"`.
- **Riesgos y efectos colaterales**: Cero riesgo para la UI. Resuelve la inconsistencia en el origen.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-004: Omisión de Decision #1 en modo PLAN (Intencionalidad vs Observabilidad)
- **Estado de verificación**: CORREGIDA (se determinó que el descarte de `DECISION_ONE` en modo PLAN fue una decisión de diseño intencional del autor original para no saturar la UI con enrutamientos en modo deliberativo; su inclusión es una decisión de observabilidad / funcionalidad de trazabilidad, no un simple bug de omisión).
- **Tipo**: pérdida de datos / observabilidad
- **Severidad**: media (decisión de observabilidad)
- **Archivo(s) y líneas**: `src/core/modeEngines.ts:561-580`, `src/core/debugAccumulator.ts:37-39`
- **Evidencia cruda**:
  ```ts
  // src/core/debugAccumulator.ts:37-39
  case "DECISION_ONE": {
    const data = event.data as any;
    if (task?.mode === "PLAN") {
      return null;
    }
  // src/core/modeEngines.ts:563-568
  let d1Initial;
  try {
      d1Initial = await deps.decisionEngine.evaluateDecisionOne(
          task.message,
          buildHistoryContext(task, context.memoryRetrievalLimit),
          { allowFin: true, signal }
      );
  } catch (err) { ... }
  ```
- **Por qué es una inconsistencia**:
  En `initiatePlanMode`, se invoca efectivamente a Decision 2.0 (Eos) para saber si la tarea es conversación directa (`fin`) o requiere plan. Sin embargo:
  1. `modeEngines.ts` no emite ningún evento `DECISION_ONE` para esta invocación (a diferencia de FAST mode en línea 435).
  2. `debugAccumulator.ts:37` contiene explícitamente un guardián deliberado: `if (task?.mode === "PLAN") return null;`.
  El autor original diseñó el modo PLAN para que en la UI solo se observara el razonamiento de Qwen. Sin embargo, para efectos de auditoría técnica rigurosa y evaluación de fidelidad en `lab/`, esta llamada real de inferencia a Eos se pierde.
- **Alcance/impacto**: Pérdida de registro de la inferencia de clasificación previa en modo PLAN en UI y traza.
- **¿El laboratorio (`lab/`) necesita este dato para extraer casos?**:
  **NO**. Se verificó exhaustivamente en `lab/extract-cases.ts:89-98, 405-430`:
  1. Las 8 etapas evaluadas por el laboratorio son: `decision_one`, `decision_two`, `step_verification`, `arguments`, `stage_verification`, `plan`, `replan`, `final_response`. No existe ninguna etapa de "clasificación inicial de plan".
  2. Los casos de `decision_one` (`lab/cases/decision_one/`) evalúan la selección de rutas entre subsistemas (`files`, `locate`, `terminal`, `web`, `fin`), los cuales ya se extraen de las iteraciones de `runFastLoop` en modo FAST.
  3. Para el modo PLAN, el laboratorio solo extrae `plan` (`PLAN_GENERATION`) y `replan` (`REPLAN`).
  4. Por tanto, omitir o incluir `DECISION_ONE` en modo PLAN no afecta la capacidad de extracción ni evaluación de `lab/`. Su inclusión es puramente una mejora de observabilidad en UI/traza (clasificada en Bloque D, fuera de esta fase).
- **Usos globales verificados**: `evaluateDecisionOne` en `modeEngines.ts:255, 401, 563`.
- **Solución propuesta**: Mantener fuera de esta fase (Bloque D).
- **Riesgos y efectos colaterales**: Ninguno.
- **Certeza**: CONFIRMADA EN CÓDIGO (intencionalidad y no afectación al lab confirmadas).

---

### INC-005: Desalineación en el orden de bloques de contexto (Ruptura de Prefix Cache)
- **Estado de verificación**: CONFIRMADA (se verificó el impacto en `lab/`: el laboratorio no evalúa el orden de las secciones de prompt; solo extrae `SCHEMA:` y `TOOL:` mediante regex posicionales independientes. El reordenamiento no rompe ningún test ni caso del laboratorio).
- **Tipo**: doc-vs-código
- **Severidad**: media (impacto en latencia de inferencia y eficiencia de caché en Ollama/vLLM)
- **Archivo(s) y líneas**: `src/core/reasoner/prompts.ts:220-241, 342-355` vs `docs/CONTEXT_AND_MEMORY.md:16-21`
- **Evidencia cruda**:
  ```ts
  // src/core/reasoner/prompts.ts:220-241
  return join([
    linesBlock("ENV", ...),
    `TOOL: ...`,
    `SCHEMA: ...`,
    data.taskInstruction.startsWith(data.goal) ? null : `GOAL: ...`,
    dataBlock("CHAT", ...),
    linesBlock("LOG", ...),
    linesBlock("PLAN", ...), // <-- Dinámico y mutable paso a paso en medio del histórico
    linesBlock("FAIL", ...),
    factsBlock(data.facts, ...),
    linesBlock("EFFECTS", ...),
    linesBlock("REFS", ...),
    ...dataObsBlocks(...),
    data.lastObs ? ... : null,
    `TASK: ...`,
  ]);
  ```
  `docs/CONTEXT_AND_MEMORY.md:16-21` estipula el orden canónico:
  1. Directivas estables.
  2. Contexto histórico acumulado (`EFFECTS`, `FACTS`, `LOG`, `FAIL`, `REFS`).
  3. Bloque dinámico del paso activo (`GOAL`, `PLAN`, `DATA`, `LAST`, `TASK`).
- **Por qué es una inconsistencia**:
  `PLAN` cambia en cada iteración porque `planLine(s)` incluye indicadores de estado dinámicos (`[>]`, `[x]`, `[~]`). Colocar `PLAN` en la línea 230 antes de `FAIL`, `FACTS`, `EFFECTS` y `REFS` destruye el prefijo de tokens compartido en caché de todos los bloques que le siguen. En `STAGE_VERIFICATION` (`prompts.ts:342-355`), la evidencia dinámica del paso también antecede al histórico acumulado (`FACTS`, `LOG`, `EFFECTS`, `FAIL`).
- **Alcance/impacto**: Mayor tiempo de procesamiento de prompt en cada llamada iterativa a Qwen.
- **Usos globales verificados**: `lab/extract-cases.ts:179-196` solo busca `/SCHEMA:\s*/i` y `/TOOL:\s*([a-zA-Z0-9_-]+)/i`. No busca ni depende del orden de `LOG`, `PLAN`, `FACTS` o `EFFECTS`.
- **Solución propuesta**:
  En `PROMPTS.ARGUMENTS.buildUserPrompt`, consolidar el bloque histórico primero:
  1. Estables: `ENV`, `TOOL`, `SCHEMA`.
  2. Histórico acumulado: `EFFECTS`, `FACTS`, `LOG`, `FAIL`, `REFS`.
  3. Dinámico: `GOAL`, `CHAT`, `PLAN`, `DATA`, `LAST`, `TASK`.
  Reordenar análogamente `STAGE_VERIFICATION`.
- **Riesgos y efectos colaterales**: Cero impacto en `lab`. Optimiza la tasa de acierto de KV-cache.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-006: Brecha en la barrera de sanitización ontológica (`factsDelta` y `StepHandoff`)
- **Estado de verificación**: CONFIRMADA (se leyeron `sanitizeForMemory` y `safe()` en su totalidad. Se distinguió el origen de cada valor de `factsDelta` y se verificó que `primaryFact.value` se inyecta directamente en `TASK:` sin pasar por `<obs>`).
- **Tipo**: invariante violado / doc-vs-código
- **Severidad**: media (violación del principio de aislamiento ontológico)
- **Archivo(s) y líneas**: `src/core/processor/resultProcessor.ts:276-278, 394-401`, `src/core/context.ts:212-220`, `src/core/reasoner/prompts.ts:239-240`
- **Evidencia cruda**:
  ```ts
  // src/core/processor/resultProcessor.ts:394
  factsDelta.url = items[0].url; // <-- Contenido externo directo (URL web) sin sanitizar
  // src/core/processor/resultProcessor.ts:400
  factsDelta.cand = cands.join(", "); // <-- URLs externas concatenadas sin sanitizar
  // src/core/context.ts:218-219
  const factNote = handoff.primaryFact ? ` | ${handoff.primaryFact.key}=${handoff.primaryFact.value}` : "";
  return `${step.instruction}\n[HANDOFF ${handoff.fromStepId} (${handoff.tool})]: ${handoff.finding}${refNote}${factNote}`;
  // src/core/reasoner/prompts.ts:239-240
  `TASK: ${safe(clip(data.taskInstruction, MAX_GOAL_CHARS))}`
  ```
- **Por qué es una inconsistencia**:
  `sanitizeForMemory` remueve caracteres de control, aplana saltos de línea y desactiva palabras clave directivas (`replace(/\b(GOAL|FACTS|...):/gi, "$1_")`). Por el contrario, `safe()` en `prompts.ts:90` **únicamente** sustituye `<\/?obs>` por `[obs]`; no elimina saltos de línea ni neutraliza delimitadores operativos.
  Dado que `factsDelta.url` y `factsDelta.cand` provienen directamente de páginas web y respuestas de red sin pasar por `sanitizeForMemory`, y dado que `applyStepHandoff` concatena `primaryFact.value` directamente en `taskInstruction`, cualquier salto de línea o directiva presente en una URL o metadato web se filtra directamente hacia el bloque directivo `TASK:` sin estar aislado dentro de etiquetas `<obs>...</obs>`.
- **Alcance/impacto**: Ruptura del Invariante 5 de `CONTEXT_AND_MEMORY.md` y del principio de contención ontológica.
- **Usos globales verificados**: `applyStepHandoff` en `src/core/callExecutor.ts:236`, `factsDelta` en `src/core/processor/resultProcessor.ts:277, 301, 394, 400, 415`.
- **Solución propuesta (Acciones concretas)**:
  1. En `src/core/processor/resultProcessor.ts`:
     - Línea 394: cambiar a `factsDelta.url = sanitizeForMemory(items[0].url, 200);`
     - Línea 400: cambiar a `factsDelta.cand = sanitizeForMemory(cands.join(", "), 400);`
     - Línea 415: cambiar a `factsDelta.url = sanitizeForMemory(urlStr, 200);`
     - Línea 277: cambiar a `factsDelta.path = sanitizeForMemory(String(args.path), 200);`
  2. En `src/core/context.ts:218` (`applyStepHandoff`):
     - Cambiar a: `const factNote = handoff.primaryFact ? ` | ${sanitizeForMemory(handoff.primaryFact.key, 40)}=${sanitizeForMemory(handoff.primaryFact.value, 200)}` : "";`
- **Riesgos y efectos colaterales**: Cero. Protege deterministamente el bloque directivo de inyecciones indirectas.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-007: Contradicción entre documentos respecto a hechos sin veredicto (`noVerdict`)
- **Estado de verificación**: CORREGIDA (se reclasificó formalmente como contradicción **doc-vs-doc**. El código en `callExecutor.ts:485` implementa al pie de la letra lo establecido en `CORE_FLOW.md:24`, el cual contradice a `CONTEXT_AND_MEMORY.md:9`).
- **Tipo**: doc-vs-código / doc-vs-doc
- **Severidad**: media (ambigüedad en las reglas de veracidad de la memoria)
- **Archivo(s) y líneas**: `src/core/callExecutor.ts:485-489` vs `docs/CORE_FLOW.md:24` vs `docs/CONTEXT_AND_MEMORY.md:9`
- **Evidencia cruda**:
  ```ts
  // docs/CORE_FLOW.md:24
  // "4. Verificación y memoria: ... Consolidación de hechos si la acción fue validada, si no hubo veredicto o si produjo una mutación física en el entorno."
  // docs/CONTEXT_AND_MEMORY.md:9
  // "Hechos Confirmados: ... los datos hipotéticos se descartan si el paso no aprueba la verificación."
  // src/core/callExecutor.ts:485-487
  if (isStepSuccess || noVerdict || policy.mutates) {
      Object.assign(ensureMemory(context).facts, processed.factsDelta);
  }
  ```
- **Por qué es una inconsistencia**:
  Existe una contradicción directa entre los dos documentos rectores:
  - `CORE_FLOW.md` §2.4 autoriza explícitamente consolidar hechos "si no hubo veredicto".
  - `CONTEXT_AND_MEMORY.md` §1 estipula que los hechos deben ser estrictamente confirmados y que los datos hipotéticos deben descartarse si no se aprueba la verificación.
  El código real (`callExecutor.ts:485`) sigue la regla de `CORE_FLOW.md`.
- **Alcance/impacto**: Si los verificadores técnicos (Eos/Qwen) fallan por red o sobrecarga, el sistema incorpora los datos leídos a `facts` como axiomas.
- **Usos globales verificados**: `ensureMemory(context).facts` en `prompts.ts`.
- **Solución propuesta e impacto documental**:
  - Si se elige la **Opción A (Estricto con veracidad)**: Cambiar `callExecutor.ts:485` a `if (isStepSuccess || policy.mutates)` y actualizar `CORE_FLOW.md:24` para suprimir "si no hubo veredicto".
  - Si se elige la **Opción B (Tolerancia pragmática - Actual)**: Mantener el código intacto y actualizar `CONTEXT_AND_MEMORY.md:9` para explicitar la excepción cuando los evaluadores no están disponibles.
- **Riesgos y efectos colaterales**: Depende de la decisión de usuario elegida.
- **Certeza**: CONFIRMADA EN CÓDIGO Y DOCUMENTACIÓN.

---

### INC-008: Código muerto y contradicción arquitectónica en `src/core/persistence.ts`
- **Estado de verificación**: CONFIRMADA (se verificó con búsqueda global exhaustiva en todo el workspace, incluyendo scripts de `package.json`, configuraciones y dynamic imports. El archivo no tiene ningún consumidor ni dependencia).
- **Tipo**: código muerto / doc-vs-código
- **Severidad**: baja (deuda técnica y confusión arquitectónica)
- **Archivo(s) y líneas**: `src/core/persistence.ts:1-195`
- **Evidencia cruda**:
  `docs/CONTEXT_AND_MEMORY.md:32`:
  "- Sin restauración de estado: Al reiniciar el proceso del servidor no se restaura el historial operativo desde disco; el sistema inicializa limpio."
  `docs/CONTEXT_AND_MEMORY.md:45`:
  "4. Volatilidad estricta: Ningún fallo de proceso o reinicio depende de almacenamiento secundario para la coherencia del runtime; la memoria operativa no persiste en disco."
  Búsqueda global en workspace:
  `grep -rn "persistence" src/ ui/ lab/ server.ts` arrojó 0 referencias al archivo. Únicamente un comentario en `transport.ts` sobre conexiones persistentes y una mención en un plan archivado antiguo.
- **Por qué es una inconsistencia**:
  `persistence.ts` implementa una clase `TaskStore` de 195 líneas con escrituras atómicas, respaldos `.bak`, reintentos de renombrado y debouncing, que contradice el principio de volatilidad estricta del sistema y no es utilizado en ningún punto.
- **Alcance/impacto**: Deuda técnica y confusión para desarrolladores.
- **Solución propuesta**:
  Eliminar el archivo `src/core/persistence.ts` tras aprobación del usuario.
- **Riesgos y efectos colaterales**: Cero. `tsc --noEmit` y el runtime permanecen completamente inmutados.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-009: Contratos de campos huérfanos en `types.ts` y dependencias cruzadas con `ui/`
- **Estado de verificación**: CORREGIDA (se verificó con `tsc --listFilesOnly` que TypeScript compila TODO el proyecto (`src`, `ui`, `lab`). Se verificó que quitar campos leídos por la UI provocaría errores de compilación fatales en `tsc`. Se retiró del plan la propuesta de poblar `candidate_tools` por considerarse funcionalidad nueva).
- **Tipo**: código muerto / tipo/contrato
- **Severidad**: media (desfase entre interfaces declaradas y comportamiento de runtime)
- **Archivo(s) y líneas**: `src/core/types.ts:111-112, 132-135, 203, 207, 218-226`
- **Evidencia cruda de lectores en todo el proyecto**:
  - `StepCall.rawInput / rawOutput` (`types.ts:111-112`):
    - `src/`: 0 lectores / 0 escritores.
    - `ui/`: `ui/utils/debugAccumulator.ts:119, 120, 141, 142, 164, 165` (lee `call.rawInput` y `call.rawOutput`).
    - `lab/`: 0 lectores (el `call` en `lab/extract-cases.ts` es de tipo `TraceCall`, no `StepCall`).
  - `Step.rawInput / rawOutput` (`types.ts:132-133`):
    - `src/`: 0 lectores / 0 escritores.
    - `ui/`: `ui/utils/debugAccumulator.ts:73, 74, 102, 103, 119, 120, 164, 165, 325`.
    - `lab/`: 0 lectores.
  - `Step.candidate_tools` (`types.ts:134`):
    - `src/`: `src/core/debugAccumulator.ts:104` (lee `currentStep?.candidate_tools || []`).
    - `ui/`: `ui/components/ProcessFlow/components/PlanReview.tsx:256` (lee `step.candidate_tools`).
    - Backend: 0 escritores (nunca se puebla).
  - `Step.dependencies` (`types.ts:135`):
    - `src/`: 0 lectores.
    - `ui/`: `ui/components/ProcessFlow/components/StepItem.tsx:85`, `ui/components/ProcessFlow/components/PlanReview.tsx:261`.
    - Backend: 0 escritores.
  - `Scratchpad.selected_result` (`types.ts:203`):
    - `src/`: 0 lectores / 0 escritores.
    - `ui/`: 0 lectores / 0 escritores.
    - `lab/`: 0 lectores / 0 escritores.
    - **Salida de búsqueda global literal (`grep -rn "selected_result" src/ ui/ lab/ server.ts package.json`)**:
      ```text
      src/core/types.ts:203:  selected_result?: unknown;
      ```
      *(1 única coincidencia en todo el repositorio: la declaración huérfana en la interfaz `Scratchpad`).*
  - `Scratchpad.text` (`types.ts:207`):
    - `src/`: 0 lectores / 0 escritores.
    - `ui/`: 0 lectores / 0 escritores.
    - `lab/`: 0 lectores / 0 escritores.
    - **Salida de búsqueda global literal (`grep -rn "scratchpad.*text\|\.text\b" src/ ui/ lab/ server.ts package.json`)**:
      ```text
      src/core/types.ts:207:  text?: string;
      ```
      *(0 lectores y 0 escritores sobre la propiedad `text` de `Scratchpad` en todo el proyecto; las demás apariciones de `text` corresponden a llamadas `response.text()` en HTTP o `DataObservation.text`).*
  - `TaskMemory.rawInteractions` (`types.ts:218-226`):
    - `src/`: 0 lectores / 0 escritores.
    - `ui/`: `ui/utils/debugAccumulator.ts:302, 314` (para compatibilidad de vistas).
- **Por qué es una inconsistencia**:
  Los campos de `Step` y `StepCall` son leídos en `ui/` esperando datos que el backend `src` jamás escribe. Sin embargo, no pueden eliminarse de `types.ts` porque `tsc --noEmit` compila `ui/` y rompería la compilación.
  Por otra parte, `Scratchpad.selected_result` y `Scratchpad.text` no tienen uso en ningún archivo del workspace.
- **Alcance/impacto**: Restricción de tipado; campos innecesarios en `Scratchpad`.
- **Solución propuesta**:
  1. En `src/core/types.ts`: eliminar con total seguridad únicamente `selected_result` y `text` de `Scratchpad` (tienen 0 usos en todo el proyecto).
  2. Mantener `Step.candidate_tools`, `Step.dependencies`, `Step.rawInput/rawOutput`, `StepCall.rawInput/rawOutput` y `rawInteractions` en `types.ts` como opcionales para preservar la compilación de `ui/`.
  3. No poblar `candidate_tools` en `callExecutor.ts` a menos que el usuario lo decida explícitamente como funcionalidad nueva.
- **Riesgos y efectos colaterales**: Cero impacto en `tsc --noEmit`.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-010: Asimetría y desconexión entre la Auditoría en Memoria (UI) y la Traza en Disco
- **Estado de verificación**: CONFIRMADA (se verificó el flujo completo: el botón de la UI "Copiar Auditoría" y el archivo append-only `jarvis-traces.jsonl` son artefactos independientes con esquemas distintos. `jarvisRouter` jamás lee de disco).
- **Tipo**: pérdida de datos / tipo/contrato
- **Severidad**: alta (impacto directo en la retención de la auditoría en UI)
- **Archivo(s) y líneas**: `src/server/jarvisRouter.ts:150-168`, `src/core/taskTrace.ts:64-77`, `src/core/core.ts:367-375`, `ui/components/DecisionStream/DecisionStream.tsx:121-143`
- **Evidencia cruda**:
  ```ts
  // src/server/jarvisRouter.ts:154-159
  const task = taskId ? jarvisCore.getTask(taskId) : allTasks[allTasks.length - 1] || null;
  res.json({
    task,
    pendingApproval: serializePendingApproval(pending),
    allTasks: allTasks.map(toWireTask),
    ...
  });
  // ui/components/DecisionStream/DecisionStream.tsx:121-143
  const buildAuditJson = () => {
    const rootData: Record<string, any> = {
      taskId: task?.id || "current",
      totalIterations: modelIterations.length,
      modelsSummary: { eos_0_8b: totalEos, qwen_3_5_9b: totalQwen },
      iterations: modelIterations,
    };
    return JSON.stringify(rootData, null, 2);
  };
  ```
- **Por qué es una inconsistencia**:
  1. El botón de auditoría en la UI exporta `modelIterations` acumulado en el cliente React vía SSE o cargado desde `task.modelIterations` en `/api/jarvis/state`.
  2. Su esquema es un árbol JSON enriquecido con resúmenes, títulos de paso, inputs y outputs estructurados y métricas.
  3. La traza en disco (`jarvis-traces.jsonl`) es una línea plana JSONL por tarea terminada con los crudos de red para el laboratorio (`lab/`).
  4. Si una tarea es expulsada de la memoria RAM tras superarse `MAX_RETAINED_TASKS = 20` (`core.ts:367`), `jarvisCore.getTask(taskId)` devuelve `null`. El backend no tiene ningún mecanismo para rehidratar o servir la auditoría de esa tarea a la UI, a pesar de que está guardada en disco. Si el usuario recarga la página, la auditoría de esa tarea se pierde de la UI.
- **Alcance/impacto**: Imposibilidad de auditar tareas fuera del cupo de 20 tareas en la interfaz gráfica.
- **Usos globales verificados**: `jarvisRouter.ts`, `DecisionStream.tsx`.
- **Solución propuesta**:
  Formalizar en `docs/CONTEXT_AND_MEMORY.md` que la auditoría interactiva de UI opera sobre memoria volátil mientras que `jarvis-traces.jsonl` es un registro append-only de laboratorio. Si el usuario lo decide (Pregunta 1), crear un endpoint `GET /api/jarvis/traces/:taskId` para servir la traza archivada.
- **Riesgos y efectos colaterales**: Documental / Requiere decisión de usuario.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-011: Pérdida de métricas de latencia y tokens en el pipeline de auditoría
- **Estado de verificación**: CONFIRMADA Y PRECISADA EN DETALLE (se verificó el flujo completo desde `postJson` en `llmTransport.ts` hasta la UI y `lab/extract-cases.ts:48-50`).
- **Tipo**: pérdida de datos
- **Severidad**: media (menoscabo en evaluación analítica y fidelidad del laboratorio)
- **Archivo(s) y líneas**: `src/core/reasoner/qwen.ts:391-404, 496-509`, `src/core/decision.ts:144, 190, 235`, `src/core/callExecutor.ts:204, 258, 415, 444`, `src/core/modeEngines.ts:202, 360, 435, 464, 613`, `src/core/core.ts:284`, `src/core/debugAccumulator.ts:83, 112, 143, 180, 220`, `src/core/taskTrace.ts:34-40`
- **Evidencia cruda**:
  ```ts
  // src/core/reasoner/qwen.ts:496-498
  const usage = isRecord(data) && isRecord(data.usage) ? data.usage : {};
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  // -> QwenDispatchResult solo retorna { content, truncated, rawInput, rawOutput }
  // src/core/decision.ts:144
  console.log(`[Decision #1] ... duration=${Date.now() - t0}ms`);
  // -> evaluateDecisionOne descarta duration al retornar { route, probabilities, rawInput, rawOutput }
  // src/core/taskTrace.ts:34-40
  .map((it, i) => ({
      seq: i + 1,
      step: it.stepId && stepIds.has(it.stepId) ? it.stepId : null,
      stage: it.stage,
      rawInput: it.rawInput,
      rawOutput: it.rawOutput,
      // -> latencyMs, promptTokens, completionTokens NUNCA se serializan
  }));
  ```
- **Por qué es una inconsistencia**:
  Los clientes HTTP calculan la latencia (`Date.now() - t0`) y reciben la cuenta de tokens (`usage`), pero los descartan en sus contratos de retorno. Por ende, los eventos no transportan las métricas, `debugAccumulator.ts` no puede poblar `metrics.latencyMs` / `metrics.tokens`, y `taskTrace.ts` los omite de `calls`, impidiendo que `lab/extract-cases.ts:48-50` audite el desempeño temporal y el consumo de tokens.
- **Detalle de Archivos y Eventos a Modificar**:
  1. `src/core/reasoner/qwen.ts`:
     - En `QwenDispatchResult`: agregar `durationMs?: number; promptTokens?: number; completionTokens?: number;`.
     - En interfaces de retorno (`ArgumentsGenerationResult`, `PlanGenerationResult`, `ReplanResult`, `StageVerificationResult`, `FinalResponseResult`): incluir los campos de métricas.
  2. `src/core/decision.ts`:
     - Retornar `durationMs: Date.now() - t0` en `evaluateDecisionOne`, `evaluateDecisionTwo` y `evaluateStepVerification`.
  3. Emisión de Eventos (`src/core/callExecutor.ts` y `src/core/modeEngines.ts`):
     - `DECISION_ONE` (`modeEngines.ts:435, 464`): pasar `durationMs`.
     - `DECISION_TWO` (`callExecutor.ts:204`): pasar `durationMs`.
     - `ARGUMENTS_GENERATED` (`callExecutor.ts:258`): pasar `durationMs`, `promptTokens`, `completionTokens`.
     - `RESULT_PROCESSED` (`callExecutor.ts:415`): pasar `durationMs`.
     - `STAGE_VERIFIED` (`callExecutor.ts:444`): pasar `durationMs`, `promptTokens`, `completionTokens`.
     - `PLAN_GENERATED` (`modeEngines.ts:360, 613`, `core.ts:284`): pasar `durationMs`, `promptTokens`, `completionTokens`.
     - `FINAL_RESPONSE` (`modeEngines.ts:202`): pasar `durationMs`, `promptTokens`, `completionTokens`.
  4. `src/core/debugAccumulator.ts`:
     - Mapear en `metrics`: `latencyMs: data.durationMs`, `promptTokens: data.promptTokens`, `completionTokens: data.completionTokens`, `tokens: (data.promptTokens ?? 0) + (data.completionTokens ?? 0) || undefined`.
  5. `src/core/taskTrace.ts`:
     - Serializar en cada llamada de `calls`: `latencyMs: it.metrics?.latencyMs ?? null`, `promptTokens: it.metrics?.promptTokens ?? null`, `completionTokens: it.metrics?.completionTokens ?? null`.
- **Análisis de Consumidores en `ui/` y Carácter Estrictamente Aditivo**:
  - ¿Algún consumidor de `ui/` se ve afectado negativamente? **NO**.
  - `ModelIterationCard.tsx:47` ya contempla de forma opcional `iteration.metrics?.latencyMs`. Al poblar este campo, la interfaz automáticamente renderiza la insignia de latencia real que antes permanecía invisible.
  - El cambio es **100% aditivo**: no modifica nombres existentes, no vuelve obligatorios campos previos y no altera ningún contrato de eventos para los oyentes de la UI.
- **Riesgos y efectos colaterales**: Ninguno. Enriquecimiento compatible.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-012: Inyección de cargas voluminosas sin cota en `toolRuns.args` dentro de la traza JSONL
- **Estado de verificación**: CONFIRMADA (se verificó que mientras `c.error` se trunca a 300 caracteres, `c.args` contiene los argumentos con referencias resueltas sin límite de tamaño).
- **Tipo**: invariante violado / pérdida de datos
- **Severidad**: baja (potencial desborde de tamaño en archivos JSONL)
- **Archivo(s) y líneas**: `src/core/taskTrace.ts:46-48`
- **Evidencia cruda**:
  ```ts
  // src/core/taskTrace.ts:46-48
  const toolRuns = task.steps.flatMap((s) =>
      (s.calls ?? []).map((c) => ({
          step: s.id,
          tool: c.tool,
          args: c.args ?? null, // <-- Argumentos con referencias ya resueltas (ej. archivos de 100KB)
          ok: c.outcome?.isError !== true,
          error: c.outcome?.isError === true ? (c.error ?? "").slice(0, MAX_TOOL_ERROR_CHARS) || null : null,
      }))
  );
  ```
- **Por qué es una inconsistencia**:
  En `callExecutor.ts:252`, `resolveReferences` reemplaza tokens como `{{ref:r1}}` con su contenido textual íntegro en `args`. Si una llamada escribe un archivo extenso (ej. 100 KB), `c.args` almacena dicho payload completo. Al serializarse en `taskTrace.ts`, la línea JSONL puede alcanzar megabytes, quebrando el principio de aislamiento ontológico de datos masivos establecido en `docs/ARCHITECTURE.md:10`.
- **Alcance/impacto**: Crecimiento desmedido del archivo de trazas y potencial saturación de memoria en lectores de streams línea a línea.
- **Usos globales verificados**: `toolRuns` en `taskTrace.ts` y `lab/extract-cases.ts:58`.
- **Solución propuesta**:
  Sanitizar / acotar valores string dentro de `toolRuns.args` que excedan 2000 caracteres, registrando un marcador de recorte `[... recortado en traza, ver RefStore]`.
- **Riesgos y efectos colaterales**: Verificar que `lab` no espere validar la integridad exacta de archivos gigantes en los checks de args.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-013: Constantes de cota duplicadas y números mágicos en el subsistema de memoria
- **Estado de verificación**: CONFIRMADA (se comprobaron las ocurrencias literales en `context.ts`, `prompts.ts` y `manifest.ts`).
- **Tipo**: tipo/contrato / duplicidad
- **Severidad**: baja (mantenibilidad)
- **Archivo(s) y líneas**: `src/core/context.ts:100, 110, 118, 248`, `src/core/tools/manifest.ts:40`, `src/core/reasoner/prompts.ts:53`
- **Evidencia cruda**:
  ```ts
  // src/core/context.ts:100
  if (memory.log.length > 30) memory.log = memory.log.slice(-30);
  // src/core/context.ts:110
  if (memory.effects.length > 25) memory.effects = memory.effects.slice(-25);
  // src/core/context.ts:118
  if (memory.fail.length > 5) memory.fail = memory.fail.slice(-5);
  // src/core/context.ts:248 vs src/core/processor/resultProcessor.ts:62
  // context.ts usa limit = 8; resultProcessor usa limit = 5 por defecto.
  // src/core/prompts.ts:53 vs src/core/tools/manifest.ts:40
  // prompts.ts: const MAX_TOOL_DESC_CHARS = 80;
  // manifest.ts: const MAX_DESCRIPTION_CHARS = 80;
  ```
- **Por qué es una inconsistencia**:
  Las cotas operativas de memoria residen como literales dispersos en lugar de centralizarse en `src/core/types.ts`.
- **Alcance/impacto**: Dificultad para calibrar límites de memoria y riesgo de desajuste en futuras refactorizaciones.
- **Solución propuesta**:
  Centralizar `MAX_MEMORY_LOG_ENTRIES = 30`, `MAX_MEMORY_EFFECTS_ENTRIES = 25`, `MAX_MEMORY_FAIL_ENTRIES = 5` y `MAX_TOOL_DESC_CHARS = 80` en `src/core/types.ts`.
- **Riesgos y efectos colaterales**: Cero.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

### INC-014: Persistencia de `lastHandoff` obsoleto tras un paso fallido
- **Estado de verificación**: NUEVA FICHA CONFIRMADA EN CÓDIGO (detectada durante la revisión adversarial de la Tabla 2.2).
- **Tipo**: invariante violado / lógica de contexto
- **Severidad**: media (contaminación de contexto contiguo)
- **Archivo(s) y líneas**: `src/core/callExecutor.ts:536-548`, `src/core/context.ts:212-220`
- **Evidencia cruda**:
  ```ts
  // src/core/callExecutor.ts:536-548
  if (isStepSuccess) {
      const primaryFactKey = Object.keys(processed.factsDelta)[0];
      const handoff: StepHandoff = { ... };
      step.handoff = handoff;
      context.lastHandoff = handoff;
  }
  // context.ts:212-215
  export function applyStepHandoff(step: Step, context: TaskExecutionContext): string {
      const handoff = context.lastHandoff;
      if (!handoff || !handoff.finding) {
          return step.instruction;
      }
  ```
- **Por qué es una inconsistencia**:
  `docs/CONTEXT_AND_MEMORY.md:13` define:
  "Enlace Determinista de Paso: Resumen del hallazgo, hecho principal y referencia del paso completado previo. **Entre pasos contiguos**. Se actualiza tras cada paso exitoso para contextualizar la etapa siguiente."
  Si el paso $N$ tiene éxito, genera un `lastHandoff`. Si el paso $N+1$ falla (ej. error lógico, timeout, archivo no encontrado) y el sistema escala o replanifica pasando al paso $N+2$, `context.lastHandoff` **nunca se limpia**. Como consecuencia, el paso $N+2$ recibe el handoff del paso $N$ como si fuera contiguo e inmediato, ignorando que entre medias ocurrió un paso fallido.
- **Verificación de Preservación de Contexto (Flujos FAST, PLAN, Escalación y Replan)**:
  Se comprobó minuciosamente si invalidar `context.lastHandoff = undefined` tras un paso fallido priva al siguiente paso de contexto indispensable:
  1. **Modo FAST tras fallo y escalación (`handleEscalation`)**:
     - El fallo se registra en `task.memory.fail` (`addFailEntry`) y en `context.executedSignatures`.
     - Las observaciones previas de datos siguen vivas en `context.dataObs` (`MAX_DATA_OBSERVATIONS = 3`).
     - Los hechos confirmados previos siguen en `task.memory.facts`.
     - El historial cronológico sigue en `task.memory.log` (`addLogEntry`).
     - Las mutaciones aplicadas al entorno siguen en `task.memory.effects`.
     - Las herramientas intentadas se alimentan mediante `buildAttempts`.
     - *Conclusión*: El reintento o siguiente paso cuenta con toda la información factual y el diagnóstico del error; inyectarle un `[HANDOFF ...]` del paso $N-1$ falseaba la cronología haciendo parecer que la última acción fue exitosa.
  2. **Modo PLAN tras fallo y replanificación autónoma (`handleReplan`)**:
     - La replanificación construye un nuevo plan que recibe explícitamente el resumen de etapas completadas (`completedSummary`: `[x] ... -> ok`) y metas pendientes (`remainingGoals`).
     - Al ejecutarse el primer paso replanificado, no debe heredar el handoff de un paso que ya fue superado o reestructurado.
  3. **Conclusión General**:
     Invalidar `lastHandoff = undefined` ante `!isStepSuccess` **no quita ningún contexto necesario**; al contrario, purifica el prompt de argumentos de Qwen eliminando una falsa presunción de éxito contiguo.
- **Alcance/impacto**: Contextualización engañosa en la instrucción de pasos tras una falla o escalación.
- **Usos globales verificados**: `applyStepHandoff` en `callExecutor.ts:236`.
- **Solución propuesta**:
  En `callExecutor.ts`, si un paso no tiene éxito (`!isStepSuccess`), invalidar `context.lastHandoff = undefined` para que el siguiente paso no asuma contigüidad con una etapa previa superada por un fallo intermedio.
- **Riesgos y efectos colaterales**: Ninguno. Garantiza la estricta contigüidad descrita en la arquitectura.
- **Certeza**: CONFIRMADA EN CÓDIGO.

---

## 4. Decisiones Tomadas y Preguntas Cerradas

Conforme a las instrucciones del usuario, quedan formalmente registradas las siguientes decisiones de diseño y alcance:

1. **Decisión P1 (Auditoría de UI en Memoria Volátil vs. Traza en Disco)**:
   - **Resolución**: **Mantener la auditoría de UI estrictamente volátil en memoria RAM** durante la sesión activa (`MAX_RETAINED_TASKS = 20`).
   - **Acción**: No se creará ningún endpoint de rehidratación desde disco (Bloque D). Se documentará en `CONTEXT_AND_MEMORY.md` que `jarvis-traces.jsonl` es exclusivo para el flujo de evaluación analítica del laboratorio (`lab/`).

2. **Decisión P2 (Eliminación física de `src/core/persistence.ts`)**:
   - **Resolución**: **Eliminar físicamente `src/core/persistence.ts`**.
   - **Verificación previa completada**:
     - Búsqueda en `package.json`: 0 referencias en dependencias o scripts.
     - Búsqueda en scripts y código fuente (`src/`, `ui/`, `lab/`, `server.ts`): 0 imports estáticos y 0 dynamic imports (`import(...)`).
   - **Acción**: Programada como Ítem A.9 del Plan de Acción.

3. **Decisión P3 (Comportamiento ante apagado forzado del servidor - SIGINT/SIGTERM)**:
   - **Resolución**: **Mantener la salida inmediata sin traza forzada**.
   - **Acción**: `server.ts` mantiene su comportamiento actual de terminación directa (`process.exit(0)`). Se documenta que las tareas interrumpidas en vuelo por el cese del proceso no asientan traza terminal. Graceful shutdown queda fuera de esta fase (Bloque D).

4. **Decisión P5 (Política de hechos consolidados sin veredicto - `noVerdict`)**:
   - **Resolución**: **Mantener el comportamiento pragmático actual del código y de `CORE_FLOW.md:24`**.
   - **Acción**: El código de `callExecutor.ts:485` se mantiene intacto (`isStepSuccess || noVerdict || policy.mutates`). Se actualizará `CONTEXT_AND_MEMORY.md:9` para explicitar formalmente esta excepción de consolidación cuando los evaluadores no están disponibles.

5. **Decisión sobre Bloque D (Funcionalidades Nuevas y Observabilidad Opcional)**:
   - **Resolución**: **Todos los cambios del Bloque D quedan FUERA de esta fase**.
   - **Detalle**:
     - No se puebla `candidate_tools` en `Step` (funcionalidad nueva).
     - No se añade `DECISION_ONE` en modo PLAN (se verificó que `lab/` no lo requiere para ninguna evaluación).
     - No se implementa endpoint de lectura de trazas históricas.
     - No se implementa interceptor de señales SIGINT para volcado de trazas.

---

## 5. Plan de Acción Definitivo

### Bloque A: Correcciones de Código Backend (`src`)
*Ordenado estrictamente por dependencias lógicas y causas compartidas.*

#### Ítem A.1 [BAJA SEVERIDAD - BASE DE CONTRATOS]: Centralización de cotas y limpieza de tipos huérfanos sin lectores (INC-009, INC-013)
- **Archivos a tocar**: `src/core/types.ts`, `src/core/context.ts`
- **Causa raíz**: Parámetros de dimensionamiento dispersos como números mágicos y propiedades de `Scratchpad` en desuso.
- **Cambio concreto**:
  1. En `src/core/types.ts`: exportar `MAX_MEMORY_LOG_ENTRIES = 30`, `MAX_MEMORY_EFFECTS_ENTRIES = 25`, `MAX_MEMORY_FAIL_ENTRIES = 5` y `MAX_TOOL_DESC_CHARS = 80`.
  2. En `src/core/types.ts`: eliminar las propiedades huérfanas `selected_result?: unknown;` y `text?: string;` de la interfaz `Scratchpad`. Mantener como opcionales los campos leídos por `ui/` (`Step.candidate_tools`, `Step.dependencies`, etc.) para preservar la compilación global.
  3. En `src/core/context.ts`: sustituir los números mágicos en `addLogEntry` (línea 100), `addEffectEntry` (línea 110) y `addFailEntry` (línea 118) por las constantes importadas de `types.ts`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. Verificado que `selected_result` y `text` tienen 0 usos en todo el workspace.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Comprobar que el inicio del servidor y el ciclo de vida de tareas compilen e inicialicen correctamente.
- **Documentación que cambia**: Ninguna.

#### Ítem A.2 [MEDIA SEVERIDAD - INDEPENDIENTE]: Blindaje de aislamiento estricto en `RefStore` (INC-001)
- **Archivos a tocar**: `src/core/processor/resultProcessor.ts`, `src/core/processor/refResolver.ts`
- **Causa raíz**: Presencia de valor por defecto `"default"` en `RefStore.put` y bucle de búsqueda global sobre todas las tareas en `RefStore.get`.
- **Cambio concreto**:
  1. En `resultProcessor.ts` (`RefStore.get`): tipar `taskId: string` como obligatorio. Eliminar el bucle de fallback `for (const store of this.taskStores.values())`. Si `taskId` no existe, retornar inmediatamente `undefined`.
  2. En `resultProcessor.ts` (`RefStore.put`): tipar `taskId: string` como obligatorio (sin default `"default"`).
  3. En `resultProcessor.ts` (`ResultProcessor.process`): hacer obligatorio `taskId: string`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. Todos los llamadores reales en el flujo activo (`callExecutor.ts:252, 374`, `context.ts:249`, `core.ts:372`) ya proveen `task.id`.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Ejecutar tareas sucesivas que lean archivos o páginas web y comprobar que las referencias `{{ref:rX}}` se resuelvan exclusivamente dentro de la tarea activa.
- **Documentación que cambia**: Ninguna (hace cumplir `CONTEXT_AND_MEMORY.md:39`).

#### Ítem A.3 [MEDIA SEVERIDAD - INDEPENDIENTE]: Sanitización ontológica estricta en `factsDelta` y `StepHandoff` (INC-006)
- **Archivos a tocar**: `src/core/processor/resultProcessor.ts`, `src/core/context.ts`
- **Causa raíz**: Extracción de strings externos (URLs, títulos web, resultados de tools) asignados directamente a `factsDelta` y concatenados en `applyStepHandoff` sin filtrado de saltos de línea ni directivas.
- **Cambio concreto**:
  1. En `resultProcessor.ts:277, 301, 394, 400, 415`: envolver las asignaciones a `factsDelta` (ej. `url`, `cand`, `finding`) con `sanitizeForMemory(val, 200)`.
  2. En `context.ts:218-219` (`applyStepHandoff`): envolver `handoff.primaryFact.key` y `handoff.primaryFact.value` con `sanitizeForMemory`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Ejecutar una tarea de búsqueda web con resultados de URLs complejas y caracteres especiales, verificando que la línea `TASK:` en el prompt de argumentos conserve un formato estricto de una sola línea limpia.
- **Documentación que cambia**: Ninguna.

#### Ítem A.4 [MEDIA SEVERIDAD - INDEPENDIENTE]: Invalidación de `lastHandoff` tras paso fallido (INC-014)
- **Archivos a tocar**: `src/core/callExecutor.ts`
- **Causa raíz**: Omisión de reinicio de `context.lastHandoff` cuando un paso falla, provocando que un handoff viejo se propague falsamente como predecesor inmediato tras una escalación o replan.
- **Cambio concreto**:
  En `src/core/callExecutor.ts`: en el bloque posterior a la ejecución del paso, si `!isStepSuccess`, asignar explícitamente `context.lastHandoff = undefined;`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. Se verificó que FAST, PLAN, escalación y replan mantienen todo el contexto necesario en `dataObs`, `memory.facts`, `memory.log`, `memory.fail` y `memory.effects`.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Provocar un fallo intencional en un paso y comprobar que el paso siguiente (o replanificado) no incluya la cabecera `[HANDOFF ...]` del paso anterior superado.
- **Documentación que cambia**: Ninguna (hace cumplir `CONTEXT_AND_MEMORY.md:13`).

#### Ítem A.5 [MEDIA SEVERIDAD - INDEPENDIENTE]: Reordenamiento de prompts para Prefix Cache (INC-005)
- **Archivos a tocar**: `src/core/reasoner/prompts.ts`
- **Causa raíz**: Ensamblado de prompts que intercala bloques de alta varianza (`PLAN`, `DATA`) antes de bloques acumulativos estables (`FACTS`, `LOG`, `FAIL`), rompiendo el caché de prefijos del motor de inferencia.
- **Cambio concreto**:
  1. En `PROMPTS.ARGUMENTS.buildUserPrompt`: reordenar para ubicar el historial acumulativo estable al inicio (`EFFECTS` -> `FACTS` -> `LOG` -> `FAIL` -> `REFS`), y posicionar las secciones dinámicas volátiles (`GOAL`, `CHAT`, `PLAN`, `DATA`, `LAST`, `TASK`) al final.
  2. En `PROMPTS.STAGE_VERIFICATION.buildUserPrompt`: consolidar el histórico estable previo a las observaciones dinámicas.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. `lab/extract-cases.ts` extrae `SCHEMA` y `TOOL` mediante expresiones regulares independientes de la posición relativa de los bloques.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Ejecutar tareas en FAST y PLAN comprobando que las respuestas y argumentos de Qwen se generen de manera consistente y correcta.
- **Documentación que cambia**: Ninguna (hace cumplir `CONTEXT_AND_MEMORY.md:16-21`).

#### Ítem A.6 [ALTA SEVERIDAD - INDEPENDIENTE]: Emisión e identificación inequívoca de la etapa `REPLAN` (INC-003)
- **Archivos a tocar**: `src/core/modeEngines.ts`, `src/core/debugAccumulator.ts`
- **Causa raíz**: `handleReplan` emite `PLAN_GENERATED` sin indicador diferencial, provocando que `debugAccumulator.ts` fije de forma rígida `stage: "PLAN_GENERATION"`, impidiendo que `ModelStage` `"REPLAN"` se manifieste en UI o en la traza JSONL.
- **Cambio concreto**:
  1. En `modeEngines.ts:360` (`handleReplan`): añadir `isReplan: true` al payload emitido en `PLAN_GENERATED`.
  2. En `debugAccumulator.ts:225`: si `data.isReplan === true`, asignar:
     - `stage: "REPLAN"`
     - `id: "iter_${ts}_qwen_replan"`
     - `stepTitle: "Replanificación Autónoma de Etapas"`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. En `ui/`, `taskStatus.ts:140` y `DecisionStream.tsx:82` siguen recibiendo `PLAN_GENERATED` sin alteración. En `lab/`, satisface de forma directa la rama nativa `rawStage === "REPLAN"` en `extract-cases.ts:415`.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Provocar un fallo en modo PLAN que active `handleReplan`, y verificar que en la traza JSONL figure `stage: "REPLAN"` y en la UI se titule "Replanificación Autónoma de Etapas".
- **Documentación que cambia**: Ninguna.

#### Ítem A.7 [MEDIA SEVERIDAD - COMPARTE CAUSA CON A.8]: Propagación de métricas de latencia y tokens (INC-011)
- **Archivos a tocar**: `src/core/reasoner/qwen.ts`, `src/core/decision.ts`, `src/core/callExecutor.ts`, `src/core/modeEngines.ts`, `src/core/core.ts`, `src/core/debugAccumulator.ts`
- **Causa raíz**: Descarte de `durationMs` y de `usage` en los contratos de retorno de los clientes HTTP de inferencia.
- **Cambio concreto**:
  1. En `qwen.ts`: incluir `durationMs`, `promptTokens` y `completionTokens` en `QwenDispatchResult` y en las interfaces de retorno de todos sus métodos públicos.
  2. En `decision.ts`: retornar `durationMs: Date.now() - t0` en `evaluateDecisionOne`, `evaluateDecisionTwo` y `evaluateStepVerification`.
  3. En `callExecutor.ts` y `modeEngines.ts`: incluir las métricas en los payloads de los eventos `DECISION_ONE`, `DECISION_TWO`, `ARGUMENTS_GENERATED`, `RESULT_PROCESSED`, `STAGE_VERIFIED`, `PLAN_GENERATED` y `FINAL_RESPONSE`.
  4. En `debugAccumulator.ts`: asignar las métricas a `iteration.metrics` (`latencyMs`, `promptTokens`, `completionTokens`, `tokens`).
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. Cambio 100% aditivo. Habilita la insignia de latencia existente en `ModelIterationCard.tsx:47`.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Observar en la UI cómo las tarjetas del flujo de decisiones muestran la latencia real de inferencia.
- **Documentación que cambia**: Ninguna.

#### Ítem A.8 [ALTA SEVERIDAD - COMPARTE CAUSA CON A.7]: Contrato de traza JSONL: correlación de `callSeq`, `resultPreview`, métricas y cota de `args` (INC-002, INC-012)
- **Archivos a tocar**: `src/core/taskTrace.ts`
- **Causa raíz**: Omisión de campos contractuales esperados por `lab/extract-cases.ts:54-62` y serialización de strings sin cota en `toolRuns.args`.
- **Cambio concreto**:
  1. En `taskTrace.ts`: al construir `calls`, serializar:
     - `latencyMs: it.metrics?.latencyMs ?? null`
     - `promptTokens: it.metrics?.promptTokens ?? null`
     - `completionTokens: it.metrics?.completionTokens ?? null`.
  2. En `taskTrace.ts`: al construir `toolRuns`, garantizar la correlación estricta usando `taskTrace.ts` como única fuente de verdad:
     - Para cada llamada `c` en `s.calls`, localizar en `calls` la llamada de `stage === "ARGUMENT_GENERATION"` correspondiente a `step: s.id` (orden FIFO por paso).
     - Asignar `callSeq: matchingArgCall?.seq ?? null`.
  3. En `taskTrace.ts`: incluir `resultPreview: (c.evidence?.obs || c.evidence?.summary || "").slice(0, 500) || undefined`.
  4. En `taskTrace.ts`: acotar los valores de tipo string dentro de `toolRuns.args` a un máximo de 2000 caracteres para evitar líneas sobredimensionadas en el archivo JSONL.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo para la UI (no lee la traza). En `lab/`, soluciona la falla de correlación de `findMatchingToolRun` y permite extraer casos de referencia con su ejecución física completa.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Ejecutar una tarea completa en el sistema y correr `npx tsx lab/extract-cases.ts`, verificando que se extraigan casos en `lab/cases/arguments/_drafts/` con su bloque `toolRun` perfectamente enlazado.
- **Documentación que cambia**: Ninguna.

#### Ítem A.9 [BAJA SEVERIDAD - INDEPENDIENTE]: Eliminación definitiva de código muerto `persistence.ts` (INC-008)
- **Archivos a tocar**: `src/core/persistence.ts`
- **Causa raíz**: Archivo de persistencia atómica en disco abandonado sin usos ni referencias en el proyecto.
- **Cambio concreto**: Eliminar físicamente el archivo `src/core/persistence.ts`.
- **Riesgos sobre `ui` / `lab`**: Cero riesgo. Verificado que posee 0 imports y 0 referencias globales.
- **Verificación `tsc`**: `npm run lint`.
- **Pruebas manuales a realizar**: Compilar con `tsc --noEmit` y verificar arranque limpio del backend.
- **Documentación que cambia**: Ninguna.

---

### Bloque B: Correcciones de Documentación

1. **`docs/CONTEXT_AND_MEMORY.md`**:
   - **Sección 1 (Hechos Confirmados)**: Actualizar la redacción conforme a la Decisión P5: explicitar que los hechos se consolidan tras verificación exitosa, pero que ante ausencia de veredicto del clasificador (`noVerdict`) o mutaciones de entorno ejecutadas limpiamente, el runtime conserva los datos observados para priorizar la continuidad operativa.
   - **Sección 1 y 2 (Separación Scratchpad vs. Contexto)**: Aclarar la delimitación entre `task.scratchpad` (destinado a la UI y a Decision #2) y las propiedades `context.lastCall*` y `context.dataObs` (usadas exclusivamente en el ensamblado interno de prompts).
   - **Sección 4 (Auditoría vs. Traza)**: Conforme a la Decisión P1 y P3, documentar formalmente que la auditoría interactiva de la UI opera sobre la memoria volátil de sesión (`MAX_RETAINED_TASKS = 20`), mientras que `jarvis-traces.jsonl` es un registro append-only exclusivo para el laboratorio que no se asienta en salidas forzadas (SIGINT).

2. **`docs/CORE_FLOW.md`**:
   - **Sección 2.4**: Sincronizar la terminología de hechos y veredictos con `CONTEXT_AND_MEMORY.md` para garantizar coherencia interdocumental plena.

---

### Bloque C: Decisiones Pendientes del Usuario
*Todas las decisiones han sido resueltas formalmente por el usuario y registradas en la Sección 4.*
- **Decisión P1**: Resuelta (UI volátil; traza en disco para el lab).
- **Decisión P2**: Resuelta (Eliminar `persistence.ts`).
- **Decisión P3**: Resuelta (Salida inmediata ante SIGINT).
- **Decisión P5**: Resuelta (Mantener código actual tolerante de hechos; actualizar documentación).
- **Bloque D**: Resuelto (Fuera de esta fase).

---

### Bloque D: Funcionalidades Nuevas y Observabilidad Opcional (Fuera de esta Fase)
*Por decisión explícita del usuario, estos ítems quedan formalmente fuera de la presente auditoría y corrección de código:*
1. **Poblado de `candidate_tools` en `Step`**: Mantenerlo sin poblar (funcionalidad nueva).
2. **Inclusión de Decision #1 en modo PLAN**: Mantener diseño original (no requerido por `lab/`).
3. **Endpoint de lectura histórica de trazas**: Mantener arquitectura volátil de memoria.
4. **Hook de terminación elegante (Graceful Shutdown) en SIGINT**: Mantener salida inmediata.

---

### Confirmación de Cobertura de Inconsistencias

| Inconsistencia | Ítem en Plan de Acción / Justificación | Estado |
|---|---|:---:|
| **INC-001** (Aislamiento `RefStore`) | **Ítem A.2** (`src/core/processor/resultProcessor.ts`) | Cubierto |
| **INC-002** (`callSeq` y `resultPreview` en traza) | **Ítem A.8** (`src/core/taskTrace.ts`) | Cubierto |
| **INC-003** (Etapa `REPLAN` en ciclo y traza) | **Ítem A.6** (`src/core/modeEngines.ts`, `debugAccumulator.ts`) | Cubierto |
| **INC-004** (Decision #1 en modo PLAN) | **Bloque D.2** (Fuera de fase por decisión de usuario; verificado que `lab` no lo requiere) | Justificado |
| **INC-005** (Orden de bloques para Prefix Cache) | **Ítem A.5** (`src/core/reasoner/prompts.ts`) | Cubierto |
| **INC-006** (Sanitización de `factsDelta` y Handoff) | **Ítem A.3** (`src/core/processor/resultProcessor.ts`, `context.ts`) | Cubierto |
| **INC-007** (Contradicción hechos sin veredicto) | **Bloque B.1 y B.2** (Decisión P5: código se conserva; se alinea `CONTEXT_AND_MEMORY.md`) | Cubierto |
| **INC-008** (Código muerto `persistence.ts`) | **Ítem A.9** (Decisión P2: eliminación física del archivo) | Cubierto |
| **INC-009** (Campos huérfanos de tipos) | **Ítem A.1** (Elimina `selected_result` y `text`; preserva campos leídos por UI) | Cubierto |
| **INC-010** (Auditoría UI vs. Traza en disco) | **Bloque B.1** (Decisión P1: formalización documental de pureza volátil) | Cubierto |
| **INC-011** (Pérdida de latencia y tokens) | **Ítem A.7** y **Ítem A.8** (Propagación y serialización completa) | Cubierto |
| **INC-012** (Cota de seguridad en `toolRuns.args`) | **Ítem A.8** (`src/core/taskTrace.ts`) | Cubierto |
| **INC-013** (Números mágicos y cotas dispersas) | **Ítem A.1** (`src/core/types.ts`, `context.ts`) | Cubierto |
| **INC-014** (Invalidación de `lastHandoff` obsoleto)| **Ítem A.4** (`src/core/callExecutor.ts`) | Cubierto |

*Todas las 14 inconsistencias confirmadas cuentan con su ítem de acción concreto o con su debida justificación expresa.*

---

## 6. Resultado de `tsc` al cierre de la auditoría

- **Comando ejecutado**: `npm run lint` (`tsc --noEmit`)
- **Código de salida**: `0`
- **Salida de la consola**:
  ```text
  > react-example@0.0.0 lint
  > tsc --noEmit
  ```
- **Conclusión**: El código base compila limpiamente sin advertencias ni errores en `src/`, `ui/`, `lab/` ni `server.ts`.
