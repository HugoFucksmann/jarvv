# Plan de Implementación — Contexto único por tarea (PLAN_CONTEXT v0.30)

> **Estado:** Propuesta de plan de implementación — pendiente de validación final por el autor.
> **Base constatada:** `docs/PLAN_CONTEXT.md` (v0.30 confirmado) + lectura exhaustiva de `src/`.
> **Regla de oro:** No implementar nada en esta fase. Validar con `npx tsc --noEmit` al término de cada fase.

---

## 0. Convenciones y base de trabajo

- **[DOC §N]**: Afirmación o regla extraída de `PLAN_CONTEXT.md` v0.30, sección N.
- **[CÓD]**: Afirmación sobre el código actual de `src/`, con cita de `archivo:línea`.
- **Alcance estricto (100% backend `src/`):** No se toca `ui/`, `lab/` ni `scripts/`. No se inventarían sus consumidores, no se listan impactos en ellos y no se construyen adaptadores ni shims de compatibilidad en el backend. El frontend se adaptará integralmente al final. SSE, traza y eventos leen directamente del `ctx` en su fase respectiva, sin conservar nada legacy para ellos.
- **Criterio de equivalencia y migración:**
  - Las fases estructurales tempranas (F0–F3b) mantienen equivalencia estricta del comportamiento externo del sistema.
  - En la fase de vistas (F4), se busca transmitir la **misma información** a los modelos: cada consumidor genera en paralelo el prompt legacy y el nuevo, registra sus diferencias en log, continúa enviando el legacy y solo conmuta al nuevo tras aprobación explícita.
  - En la fase de traza y eventos (F6), se actualiza el contrato de salida hacia `ctx.snapshot()`.
  - La fase final (F7) es un borrado puro de estructuras y funciones legacy.
- **Trazabilidad de cambios:** Cada fase se asocia a un commit de Git atómico para permitir reversión limpia e independiente si fuera necesario.

---

## 1. Mapa concepto → código actual (secciones 5 a 9 de v0.30)

### 1.1 Estructura del objeto de contexto (§5)

| Concepto DOC (§5) | Estado | Código actual | Diferencia constatada |
|---|---|---|---|
| `v: 1` | **Ausente** | — | No existe versionado de esquema. |
| `task.id` | Cubierto | `Task.id` [`types/task.ts:91`] | Idéntico. |
| `task.mode` | Parcial | `Task.mode` [`types/task.ts:93`] | Doc: `"reactive" \| "deliberative"`. Código: `"NORMAL" \| "PLAN"`. Se mapea en el borde del router; la API HTTP conserva `"NORMAL"` y `"PLAN"`. |
| `task.request` | Parcial | `Task.message` [`types/task.ts:92`] | Mismo dato con distinto nombre (`message` vs `request`). |
| `task.state` | Parcial | `TaskState` [`types/task.ts:5-11`] | Doc: `running`, `completed`, `partial`, `failed`, `cancelled`. Código actual incluye `WAITING_INPUT`. |
| `task.stopReason` | **Ausente** | — | Actualmente el motivo viaja como string ad-hoc en llamadas a `concludeTask` [`taskConclusion.ts:40`]. |
| `task.startedAt` | Parcial | `context.startTime` [`context.ts:45`] | Vive en `TaskExecutionContext`, no en el modelo de datos de la tarea. |
| `plans[]` | **Ausente** | — | Solo existe el plan vigente en `task.steps`. No hay historial versionado de planes. |
| `steps[]` | Parcial | `Task.steps: Step[]` [`types/task.ts:94`] | `Step` actual mezcla campos de planificación con campos de ejecución de llamadas. |
| `step.planId` | **Ausente** | — | No existe trazabilidad del plan que originó el paso. |
| `step.instruction` | Cubierto | `Step.instruction` [`types/task.ts:31`] | En reactivo pasa a valer `null` [DOC §5.2]; hoy lleva `task.message` [`modeEngines.ts:416`]. |
| `step.route` | Cubierto | `Step.route` [`types/task.ts:29`] | En reactivo vale `null` en el paso y se lee de la llamada. |
| `step.expected` | Parcial | `Step.expectedOutcome` [`types/task.ts:42`] | Mismo dato (`null` en reactivo). |
| `step.state` | Parcial | `StepState` [`types/task.ts:18-25`] | Doc tiene 4 estados (`pending`, `running`, `completed`, `failed`). Código tiene 7 (incluye `UNVERIFIED`, `BLOCKED`, `WAITING_APPROVAL`). |
| `step.superseded` | Cubierto | `Step.superseded` [`types/task.ts:41`] | Existe y se usa en `handleReplan` [`modeEngines.ts:233`]. |
| `calls[]` (a nivel tarea) | **Parcial** | `Step.calls?: StepCall[]` [`types/execution.ts:26`] | Las llamadas hoy están anidadas en `Step`. El doc las sube al nivel de tarea con `stepId`. |
| `call.id` | Parcial | `StepCall.id` [`types/execution.ts:27`] | Hoy formato `call_sN_M_ts`. Doc: `cN` secuencial único en la tarea. |
| `call.stepId` | **Ausente** | — | Implícito hoy por estar anidado en el paso. |
| `call.route` | **Ausente** | — | No se persiste en la llamada; hoy se deduce del paso padre. |
| `call.tool` | Cubierto | `StepCall.tool` [`types/execution.ts:29`] | Idéntico. |
| `call.kind` (`read \| write`) | **Ausente** | — | Hoy se evalúa dinámicamente con `getToolPolicy().mutates` [`callExecutor.ts:294`]. |
| `call.args` | Parcial | `StepCall.args` [`types/execution.ts:30`] | Hoy guarda argumentos ya resueltos [`callExecutor.ts:695`]. Doc exige argumentos propuestos por el modelo (refs sin resolver, strings recortados con marcador `…(+N)`). |
| `call.sig` | **Ausente** | — | Hoy la firma anti-loop está en `context.executedSignatures: Set<string>` [`context.ts:39`], pero no en la llamada. |
| `call.status` | Parcial | `CallStatus` [`types/execution.ts:10-13`] | Requiere incorporar `server_denied`, `interrupted`, `tool_rejected`, `info_missing` y separar `verdict`. |
| `call.verdict` + `call.reason` | **Ausente** | `StepCall.verification` [`types/execution.ts:52`] | Hoy `VERIFIED \| NOT_REQUIRED \| UNVERIFIED`. El doc separa el resultado técnico (`status`) del veredicto (`approved \| rejected \| null`) y su motivo cerrado (`reason`). |
| `call.summary` | Parcial | `StepCall.evidence.summary` + `obs` [`types/execution.ts:46`] | Se unifican en `summary` (≤ 2500 caracteres, generado sin modelo). |
| `call.ref` | Parcial | `StepCall.evidence.ref` [`types/execution.ts:48`] | Hoy contiene `<mcp>:<tool>:<refKey>`. El doc exige solo el `id` corto (`rN`). |
| `errors[]` | **Ausente** | — | Errores de servicio hoy van como texto plano en `task.memory.fail` [`context.ts:150`]. |
| `facts` | Parcial | `TaskMemory.facts` [`types/task.ts:70`] | Hoy es `Record<string, string>`. Doc exige `{ [clave]: { value, stepId, at } }`. |
| `refs[]` | Parcial | `RefStore` [`processor/refStore.ts`] | Hoy el texto vive solo en memoria RAM. Doc exige guardar en disco (`where`) y metadata en contexto (`label`, `size`). |
| `result` | Parcial | `Task.finalResponse` [`types/task.ts:101`] | Mismo dato con estructura `{ text, origin: "model" \| "fallback" }`. |

---

### 1.2 Vocabularios y estados (§5.3)

| Campo | Valores DOC | Código actual | Diferencia |
|---|---|---|---|
| `task.state` | `running, completed, partial, failed, cancelled` | `TaskState` [`types/task.ts:5-11`] | Mayúsculas + `WAITING_INPUT`. |
| `task.stopReason` | `max_steps, no_alternatives, security_denied, user_cancelled, replans_exhausted, unrecoverable` | Strings libres en `concludeTask` | No existe como campo tipado. |
| `step.state` | `pending, running, completed, failed` | 7 estados [`types/task.ts:18`] | Se eliminan `UNVERIFIED`, `BLOCKED`, `WAITING_APPROVAL`. |
| `call.status` | Ejecutadas: `ok, no_data, not_found, tool_error, exception, server_denied, interrupted`. No ejecutadas: `args_invalid, refs_unresolved, loop_blocked, denied, user_rejected, tool_rejected, info_missing` | `CallStatus` [`types/execution.ts:10`] | Faltan `server_denied, interrupted, tool_rejected, info_missing`. Se eliminan `unverified` y `rejected` (pasan a `verdict`). |
| `call.verdict` | `approved, rejected, null` | `VerificationState` | Simplificado a 3 estados. |
| `call.reason` | `no_usable_data, not_accomplished` (tentativos) | No existe | Campo nuevo. |
| `error.kind` | `service_unavailable` | `FailKind` [`context.ts:150`] | Hoy produce líneas en `memory.fail`. |

---

### 1.3 Escritura: `ctx.apply` (§6)

| Concepto DOC (§6) | Estado | Código actual |
|---|---|---|
| API única `ctx.apply(ops, meta?)` | **Ausente** | Mutaciones directas sobre `task.*` dispersas en `core.ts`, `modeEngines.ts`, `callExecutor.ts`. |
| Operaciones `add, update, set, finish` | **Ausente** | No tipadas ni encapsuladas. |
| Defaults automáticos (`id, at, verdict=null, reason=null, superseded=false, state`) | Parcial | Asignados manualmente en cada punto de despacho. |
| Validación previa centralizada y atómica (7 reglas de §6) | **Ausente** | Validaciones ad-hoc. |
| Invariantes al cierre del lote (§5.3) | **Ausente** | No se validan de forma centralizada. |
| Evento `change` sincrónico por `apply` | **Ausente** | Eventos heterogéneos de `CoreEvent`. |
| Consultas `ctx.get(id)`, `ctx.find(sección, where)`, `ctx.current()` | **Ausente** | Recorridos directos de arreglos en `Task`. |
| `createTaskContext`, `ctx.snapshot()`, `createFromSnapshot` | **Ausente** | No existe serialización estandarizada v1. |
| Contador interno secuencial `ctx.n` | **Ausente** | No existe. |

---

### 1.4 Vistas por consumidor (§8)

| Vista DOC (§8) | Consumidor | Equivalente actual | Diferencia |
|---|---|---|---|
| `forPlan` | Replanificador | `ReplanPromptData` [`modeEngines.ts:239`] | Debe incluir todos los efectos sin recorte y posibles efectos; falla en voz alta si exceden límite. |
| `forRoute` | Decision #1 | `buildHistoryContext` + `buildAttempts` [`modeEngines.ts:78`] | Vista formalizada sobre `ctx.calls`, `ctx.facts`. |
| `forArgs` | Generación de argumentos | `ArgumentPromptData` [`callExecutor.ts:296`] | Lee instrucción + handoff (en reactivo lee `task.request`); incluye marcador `…(+N)`. |
| `forVerify` | Verificación de paso | `evaluateStepVerification` [`callExecutor.ts:560`] | Paso, criterio, llamada evaluada (resumen y ref), efectos del paso. |
| `forFinal` | Redacción final LLM | `FinalResponsePromptData` [`taskConclusion.ts:176`] | Si los efectos no caben, cae a `forFallback` (`origin: "fallback"`). |
| `forFallback` | Respuesta de respaldo | `buildFallbackResponse` [`taskConclusion.ts:103`] | Efectos completos sin límite de modelo, fallos y hechos. |
| Consultas de control | Motores | `isStopped`, `hasUnresolvedUnverified`, anti-loop | Se reemplazan por `ctx.isRepeat(tool, sig, { exempt })`, `ctx.canFinish()`, `ctx.hasApprovedCall()`, `ctx.isClosed()`. |

---

### 1.5 Presupuesto y crecimiento (§9)

| Regla DOC (§9) | Estado | Código actual |
|---|---|---|
| `summary` ≤ 2500 caracteres | Cubierto | `MAX_EVIDENCE_OBS_CHARS = 2500` [`types/limits.ts:9`]. |
| Recorte de strings en `args` (300 default, excepción por parámetro) con marcador `…(+N)` | **Ausente** | Argumentos se guardan completos tras resolución. |
| `ARGS_MAX` global validado en `apply` | **Ausente** | No se valida tope de argumentos en el contexto. |
| Valor de `fact` ≤ 500 caracteres con marcador `…(+N)` | **Ausente** | Sin restricción de longitud. |
| Profundidad JSON ≤ 6 en `apply` | **Ausente** | Sin restricción de profundidad. |
| Ventanas recientes crecen con escalaciones [2, 5, 10] | Parcial | `PROGRESSIVE_MEMORY_TIERS` [`limits.ts:16`] en memoria legacy. |
| Efectos nunca recortados en `forPlan` (falla en voz alta si exceden) | **Ausente** | `buildAllEffects` no valida contra límites del modelo. |
| Saneado de texto externo solo en vistas | Parcial | `sanitizeForMemory` aplicado prematuramente en llamadas y memoria. |

---

### 1.6 Traza (§7)

| Concepto DOC (§7) | Estado | Código actual |
|---|---|---|
| Traza fuera del contexto | Cubierto | `taskTrace.ts` opera de forma externa. |
| Snapshot al terminar | Parcial | Guarda estructura de `Task` legacy, no `ctx.snapshot()`. |
| Entrada y salida cruda de modelos por paso | Cubierto | `modelIterations.ts` registra iteraciones. |
| Datos fuera del contexto: I/O cruda de modelos por `stepId`, orden y `n`; intervalo y resultado crudo de llamadas sin ref | Parcial | Disperso entre `modelIterations` y `taskTrace`. |

---

## 2. Discrepancias verificadas y análisis técnico

### 2.1 Discrepancias DOC vs. Código

- **D1. Estados de espera y control de flujo:** `task.state = "WAITING_INPUT"` y `task.waitingReason` en `core.ts:417` y `modeEngines.ts:513` se eliminan del contexto. Las esperas son control de flujo del ejecutor; el estado de la tarea permanece `"running"`.
- **D2. Separación de `server_denied` y Guard `denied`:** En el código actual, `signals.denied` en `resultProcessor.ts:92` activa `concludeAsFailure(..., GUARD_DENIED_REASON)` en `modeEngines.ts:560`. En el diseño, `server_denied` proviene del resultado de la herramienta, deja el paso `failed` y permite recuperación del modo; `denied` proviene de Guard antes de ejecutar y cierra la tarea con `security_denied`.
- **D3. Segundo juez de verificación:** `callExecutor.ts:582` ejecuta `deps.llm.verifyStage` (Qwen) en modo PLAN ante fallos de Decision. Se elimina por completo; ante falta de verificador persistente la tarea cierra con `unrecoverable`.
- **D4. `ask_user` unificado:** Hoy solo existe en PLAN (`modeEngines.ts:509`), disparado por el segundo juez con tope 2 (`MAX_USER_QUESTIONS_PER_STEP`). El diseño lo habilita en reactivo y deliberativo como opción del modelo de decisión con tope de 1 por paso.
- **D5. Versionado de planes ante feedback del usuario:** `modifyPlan` en `core.ts:220` pisa el plan actual reseteando los pasos; `rejectPlan` [`core.ts:206`] cancela la tarea. El diseño crea un nuevo `PlanEntry` (`trigger: "user_feedback"`) conservando el historial.
- **D6. `user_rejected` en reactivo vs deliberativo:** Hoy `blockStep` [`callExecutor.ts:393`] deja el paso `BLOCKED` y cierra la tarea en ambos modos. En el diseño: en deliberativo deja el paso `failed` y dispara replan; en reactivo deja la llamada registrada como `user_rejected`, el paso permanece `running` y el modelo de decisión decide de nuevo dentro del mismo paso (pudiendo `canFinish()` resolver a `no_alternatives`).
- **D7. Doble `apply` en ejecución de llamadas:** Hoy `settleCall` [`callExecutor.ts:636`] registra y verifica en una mutación indivisa. El diseño exige registrar la llamada al terminar el intento con `verdict = null` y actualizar `verdict` y `reason` en un segundo `apply` tras la consulta de verificación.
- **D8. Argumentos en la llamada:** `callExecutor.ts:695` guarda argumentos sustituidos (`resolvedArgs`). El doc exige los argumentos propuestos por el modelo, con referencias sin resolver y strings recortados con marcador `…(+N)`.
- **D9. Paso reactivo creado en `running`:** Hoy `runFastLoop` [`modeEngines.ts:413`] crea el paso después de seleccionar ruta. El diseño lo crea en `running` antes de consultar al modelo de decisión, de modo que toda llamada e intento tenga `stepId`.
- **D10. Persistencia de refs independiente del id:** `RefStore` actual mantiene strings en un Map en memoria. El doc exige escribir el archivo en disco antes de registrar el elemento en el contexto. El nombre del archivo en disco no depende del id `rN`.
- **D11. Errores estructurados:** `task.memory.fail` aloja strings con formato arbitrario; el diseño requiere `errors[]` con `{ id, stepId, at, kind: "service_unavailable" }`.

---

## 3. Decisiones de diseño y arquitectura del contexto

### 3.1 Módulo del contexto puro en `src/core/ctx/` (Principio 5)
- Para evitar colisiones de resolución con el archivo existente `src/core/context.ts`, el nuevo módulo puro se ubica en `src/core/ctx/` (`src/core/ctx/types.ts`, `src/core/ctx/taskContext.ts`, `src/core/ctx/views.ts`, `src/core/ctx/index.ts`).
- **Aislamiento absoluto:** `src/core/ctx/` no importa herramientas, manifiesto, modelos LLM, traza ni motores de modo. Únicamente maneja tipos y estructuras puras.
- **Atomicidad mediante registro de deshacer (Undo Log):**
  - No se clona profundamente el contexto en cada `apply`.
  - Las operaciones del lote se validan y se aplican en orden sobre el estado en memoria, registrando cada cambio en una pila de deshacer (*undo log*).
  - Al concluir el lote se evalúan los invariantes finales de §5.3. La validación de la operación `finish` comprueba la derivación estricta del estado terminal (`partial` o `failed`) desde la tabla de §5.3.
  - Si una operación falla o un invariante no se cumple, se ejecutan las acciones de reversa del *undo log* en orden inverso, restaurando el estado original de forma exacta sin emitir eventos.
  - Si el lote es válido, se incrementa `ctx.n` y se emite el evento `change` sincrónico a suscriptores de solo lectura.

### 3.2 Autoridad única para los identificadores de refs (`rN`)
- **Problema constatado:** Hoy `RefStore` numera internamente sus propias claves `rN` (`counter: number` en [`refStore.ts:38`](file:///e:/colo/jarvv/src/core/processor/refStore.ts#L38)). En el nuevo diseño, `ctx.apply` es la única autoridad que genera y garantiza la unicidad de los identificadores `rN` al registrar un elemento en `refs`.
- **Solución y transición entre F2 y F3:**
  - En **F2**, `RefStore` pasa a indexar contenidos por su ruta en disco (`where`).
  - Desde **F3**, `RefStore` **deja de numerar claves por su cuenta**. El flujo es estrictamente:
    1. `RefStore.saveToFile(content, taskId, label)` escribe el archivo crudo en disco y devuelve `{ where, size, label }`.
    2. El llamador ejecuta `ctx.apply({ op: "add", target: "refs", value: { label, size, where } })`.
    3. `ctx.apply` asigna el id único `rN` y lo devuelve en el resultado de la operación.
    4. `RefStore` registra el mapeo `(taskId, rN) -> where` (manteniendo caché en memoria `where -> content`).
    5. `resolveReferences` resuelve los tokens `{{ref:rN}}` consultando `id -> ctx.refs -> where` (a través de `RefStore.getById(taskId, "rN")`).
  - **Garantía de no divergencia:** Existe una sola autoridad para la secuencia `rN` (`ctx.apply`). Ningún componente numera refs fuera de él.

### 3.3 Gestión de esperas en el ejecutor (`TaskExecutionContext`)
- Las esperas del usuario no forman parte del estado del contexto de datos (`ctx.task.state` permanece `"running"`), pero el backend debe poder gestionar y reanudar activamente sus esperas.
- `TaskExecutionContext` mantiene formalmente el estado de espera en runtime:
  - `pendingApproval: PendingApproval | null` (aprobación de mutación Guard).
  - `pendingQuestion: PendingQuestion | null` (pregunta interactiva `ask_user`).
  - `awaitingPlanConfirmation: boolean` (espera de aceptación inicial de plan).
- El contrato SSE de F6 incluirá estos tres campos de control junto al snapshot para que los clientes puedan interactuar con las pausas del sistema sin que ensucien el modelo de datos persistente.

### 3.4 Recolector de traza externo (`TraceCollector`)
- Dado que en F7 se eliminarán los campos temporales `rawInput`, `rawOutput` de `Step` y `rawPlanInput`, `rawPlanOutput` de `Task`, se define formalmente el **`TraceCollector`** en `src/core/taskTrace.ts` como dueño exclusivo de la telemetría fuera del contexto (§7).
- **Enlace temporal de llamadas:** Cuando se consulta a un modelo (selección de tool, generación de argumentos), la llamada aún no se ha ejecutado y su `call.id` no existe en `ctx.calls`. El `TraceCollector` registra la interacción del modelo indexada temporalmente por `(stepId, turnOrder, n)`. Cuando la ejecución concluye y `ctx.apply` asigna el id `cN`, el ejecutor invoca `traceCollector.linkCall(stepId, turnOrder, callId)`.

### 3.5 Firmas y presupuesto de las vistas (`ctx.view.*`)
El submódulo `src/core/ctx/` es puro y **no conoce herramientas ni límites de modelos**. Todo presupuesto es inyectado como parámetro por el llamador:

```ts
// Firmas puras en src/core/ctx/views.ts
export function forRoute(ctx: TaskContext, budget: { maxAttempts: number; maxFailures: number }): RouteViewData;
export function forArgs(ctx: TaskContext, stepId: string, budget: { maxReads: number; defaultStringCap: number }): ArgumentViewData;
export function forVerify(ctx: TaskContext, stepId: string, callId: string): VerifyViewData;
export function forPlan(ctx: TaskContext, budget: { maxStepsWindow: number; maxFailures: number; maxModelChars: number }): PlanViewData;
export function forFinal(ctx: TaskContext, budget: { maxEffectsChars: number; maxEvidence: number }): FinalViewData;
export function forFallback(ctx: TaskContext): FallbackViewData;
```
- Cada vista devuelve una estructura de datos tipada (`*ViewData`). Las funciones complementarias de formateo renderizan el texto final y aplican el saneado de caracteres externos.
- Si en `forPlan` los efectos sin recortar superan `maxModelChars`, arroja error fatal (falla en voz alta).
- Si en `forFinal` los efectos superan `maxEffectsChars`, retorna la señal `fallbackRequired: true` para que el llamador active `forFallback`.

### 3.6 Seguridad en lectura de refs (`DesktopCommanderMCPServer`)
- Para evitar conceder permisos excesivos de escritura o listado sobre el sistema de archivos, **no se añade `refsPath` a `allowedDirectories` en la configuración**.
- En su lugar, el wrapper `DesktopCommanderMCPServer` ([`desktopCommanderMcp.ts`](file:///e:/colo/jarvv/src/core/mcp/desktopCommanderMcp.ts)) se modifica para que, ante cualquier llamada a herramientas de **solo lectura** (`read_file`), permita el acceso si la ruta solicitada pertenece a `refsPath`, independientemente de si `allowedDirectories` está poblado. Herramientas mutadoras (`write_file`, `move_file`, `create_directory`) continúan bloqueadas por la lista restrictiva.

---

## 4. Fases de implementación ordenadas por dependencia

```
F0 (Configuración, manifiesto y seguridad)
 └── F1 (Módulo de contexto puro en src/core/ctx/)
      └── F2 (Refs en disco indexadas por where)
           └── F3 (Escritura en paralelo + comparación en log al cierre)
                └── F3b (Comportamientos previos a vistas: 3b.1 -> 3b.2 -> 3b.3 -> 3b.4 -> 3b.5)
                     └── F4 (Vistas ctx.view.* + migración total de lecturas)
                          └── F5 (Comportamientos posteriores a vistas: F5.1 -> F5.2)
                               └── F6 (Traza, eventos y SSE desde ctx)
                                    └── F7 (Limpieza definitiva y borrado puro de legacy)
```

---

### Fase 0 — Configuración, topes, manifiesto y seguridad

**Archivos afectados:**
- `src/core/types/limits.ts`
- `src/core/config.ts`
- `src/core/tools/manifest.ts`
- `src/core/mcp/desktopCommanderMcp.ts`

**Qué cambia:**
1. En `limits.ts`: agregar constantes tentativas (§10.1):
   - `ARGS_STRING_DEFAULT_CAP = 300` // tentativo (doc §10.1)
   - `FACT_VALUE_MAX = 500` // tentativo (doc §10.1)
   - `JSON_MAX_DEPTH = 6` // tentativo (doc §10.1)
   - `MAX_CALLS_PER_STEP = 8` // tentativo (doc §10.1)
   - `MAX_ARG_RETRIES_PER_STEP = 1` // tentativo (doc §10.1)
   - `MAX_RESULT_RETRIES_PER_STEP = 1` // tentativo (doc §10.1)
   - `PLAN_FEEDBACK_MAX = 1000` // tentativo (doc §10.1)
2. En `config.ts`: incorporar `refsPath: string` a `JarvisConfig` (por defecto `./jarvis-refs/`, subcarpeta por `taskId`, sin borrado automático).
3. En `manifest.ts`:
   - Añadir campos opcionales en `ToolDefinition` y `ToolOptions`: `argCaps?: Readonly<Record<string, number>>`.
   - Declarar excepción para `terminal:start_process`: `argCaps: { command: 1000 }` (confirmada contra [`context.ts:271`](file:///e:/colo/jarvv/src/core/context.ts#L271) y [`manifest.ts:150-152`](file:///e:/colo/jarvv/src/core/tools/manifest.ts#L150-L152)).
   - Declarar exenciones `loopExempt: true` en `locate:get_more_search_results` y `terminal:read_process_output`.
   - Exportar función `getGlobalArgsMax(): number`.
4. En `desktopCommanderMcp.ts`: permitir operaciones de lectura (`read_file`) bajo `refsPath` sin exigir que figure en `allowedDirectories`.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Validar arranque de configuración y llamada a `getGlobalArgsMax()`.
**Git commit sugerido:** `git commit -m "fase 0: configuracion, topes, manifiesto y seguridad de refs"`

---

### Fase 1 — Módulo de contexto puro (`src/core/ctx/`)

**Archivos afectados:**
- `src/core/ctx/types.ts` (nuevo)
- `src/core/ctx/taskContext.ts` (nuevo)
- `src/core/ctx/index.ts` (nuevo)

**Qué cambia:**
1. Definición estricta de interfaces según §5: `TaskContext`, `PlanEntry`, `ContextStep`, `ContextCall`, `ContextError`, `RefEntry`, `FactEntry`, `ContextResult`.
2. Vocabularios estrictos de §5.3 (`task.state`, `task.stopReason`, `step.state`, `call.status`, `call.verdict`, `call.reason`, `error.kind`).
3. `createTaskContext(options)` con estado inicial normalizado.
4. `ctx.apply(ops, meta?)`:
   - Operaciones soportadas: `add`, `update`, `set`, `finish`.
   - Reversión atómica mediante registro de deshacer (*undo log*), sin clonar el contexto.
   - Defaults: `id` secuencial con prefijo (`p1`, `s1`, `c1`, `e1`, `r1`), `at`, `verdict=null`, `reason=null`, `superseded=false`, estado de paso inicial.
   - Validación de `finish`: valida la derivación estricta del estado terminal (`partial` o `failed`) desde la tabla de §5.3 según la presencia de efectos o llamadas aprobadas con `status = ok`.
   - Comprobación de invariantes al final del lote (§5.3).
   - Emisión de evento sincrónico `change` con `{ n, at, ops, meta }`.
5. Consultas directas: `ctx.get(id)`, `ctx.find(sección, where)`, `ctx.current()`, `ctx.isClosed()`.
6. Serialización canónica: `ctx.snapshot()` y `createFromSnapshot(json)` (rechaza versiones distintas de `v: 1`).
7. Comprobación de pureza (Principio 5): ninguna importación externa a `src/core/ctx/`.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Crear un script de comprobación real en `scratch/test-ctx.ts` (en el workspace), instanciar el contexto, aplicar operaciones y comprobar reversión en caso de fallos.
**Git commit sugerido:** `git commit -m "fase 1: modulo de contexto puro con undo log"`

---

### Fase 2 — Almacenamiento de refs en disco indexadas por `where`

**Archivos afectados:**
- `src/core/processor/refStore.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/taskTrace.ts`

**Qué cambia:**
1. Modificar `RefStore`:
   - Escribe el archivo físico en `${refsPath}/${taskId}/` con nombre unívoco **independiente del id de ref** (ej. `payload_${Date.now()}_${hash}.txt`).
   - Retorna `{ where, size, label }`.
   - Se indexa internamente por `where`.
2. Integración en `resultProcessor.ts`: cuando el resultado tiene texto extenso, escribe el archivo físico y devuelve la metadata lista para registrar la ref.
3. Actualizar `taskTrace.ts:rawResultOf` para resolver el contenido leyendo de disco (`where`) si no está en memoria.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Ejecutar una tarea con búsqueda web; comprobar que en `jarvis-refs/<taskId>/` se generan los archivos crudos y que el contenido es íntegro.
**Git commit sugerido:** `git commit -m "fase 2: persistencia fisica de refs en disco"`

---

### Fase 3 — Escritura en paralelo y comparación en log al cierre

**Archivos afectados:**
- `src/core/context.ts`
- `src/core/core.ts`
- `src/core/modeEngines.ts`
- `src/core/callExecutor.ts`
- `src/core/taskConclusion.ts`
- `src/core/processor/refResolver.ts`

**Qué cambia:**

#### 3.1 Mapeo Legacy → Contexto (decisiones explícitas y pérdidas)

| Estado / Estructura Legacy | Mapeo hacia `TaskContext` | Pérdida o Diferencia |
|---|---|---|
| `task.state = "WAITING_INPUT"` | Se mapea a `task.state = "running"` | Pérdida intencional: la espera es control de flujo del ejecutor, no estado de la tarea. |
| `step.state = "BLOCKED"` | Se mapea a `step.state = "failed"` | Pérdida de la categoría `BLOCKED`; la causa queda en `call.status` (`loop_blocked`, `denied`, `user_rejected`). |
| `step.state = "UNVERIFIED"` | Se mapea a `step.state = "completed"` si corrió limpia sin veredicto; transitoriamente queda `running` mientras `verdict = null`. | Desaparece `UNVERIFIED` como estado de paso. |
| `step.state = "WAITING_APPROVAL"` | Se mapea a `step.state = "running"` | Pérdida del estado de espera transitorio. |
| Segundo juez (Qwen) | Se registra la llamada con su status técnico y `verdict` de Decision; si Qwen diverge, no se refleja en `ctx`. | Pérdida del veredicto semántico alternativo. |
| `denied` unificado (Guard vs servidor) | `[DENIED]` en resultado se mapea a `server_denied` (paso `failed`); Guard DENY se mapea a `denied` (cierra con `security_denied`). | Se recupera la distinción semántica. |
| `Scratchpad` completo | Solo el hecho `process` se persiste en `facts`; el resto se omite. | Pérdida de variables temporales de scratchpad no formalizadas como hechos. |
| `TaskMemory.log` | Se mapea a `ctx.calls` con `summary` determinista y `status`. | Pérdida del formato de texto plano con pipes (`|`). |
| `TaskMemory.fail` | Se mapea a `calls` fallidas y `errors[]`. | Se estructura en objetos tipados. |

#### 3.2 Implementación del espejo
1. **Aislamiento en modo sombra:** Toda llamada a `ctx.apply` se ejecuta protegida por un bloque `try/catch`. Los fallos nunca se propagan a la tarea legacy en ejecución; se registran en log y se contabilizan como discrepancia al cierre.
2. **Autoridad de refs en `ctx.apply`:** `RefStore` deja de generar secuencias `rN`. `ctx.apply` asigna el id único `rN`. `RefStore` registra `id -> where` y `resolveReferences` resuelve tokens `{{ref:rN}}` consultando dicho índice.
3. **Registro de llamadas (D7 y D8):**
   - Primer `apply`: Al terminar el intento, llamada con `status` técnico final, `args` propuestos (sin resolver, strings recortados con marcador `…(+N)`), `sig` (hash de args resueltos), `kind`, `summary` unificado (≤ 2500 chars), `ref` (`rN`) y `verdict = null`, `reason = null`.
   - Segundo `apply` (D7): Tras la verificación de Decision, se actualizan juntos `verdict` (`approved` | `rejected`) y `reason`.
4. **Ciclo de vida de `process`:** Al iniciar proceso `ok`, se registra `facts.process`; al terminar o retornar `not_found`, se retira (`value: null`).
5. **Manejo de interrupciones:**
   - `interrupted` se registra exclusivamente en el bloque `finally` del ejecutor de llamadas si la ejecución de la herramienta empezó y no terminó. `cancelTask` no interviene en el registro de llamadas en vuelo.
   - `cancelTask` ejecuta `ctx.apply({ op: "finish", value: { state: "cancelled", stopReason: "user_cancelled" } })` **sin marcar pasos como superseded**.
6. **Guard DENY:** Registra llamada `denied` antes del `finish` con `security_denied`.
7. **Respuestas de usuario:** `answer_<stepId>` recortado a 500 caracteres con marcador `…(+N)`; la respuesta íntegra va a refs.
8. **Manejo de errores y orígenes de `unrecoverable`:**
   - Cuando se captura un fallo de servicio de infraestructura, se registra un `errors[]` con `{ kind: "service_unavailable", stepId }`.
   - Se mapean los orígenes de `unrecoverable`:
     1. Planificador caído o plan inicial inválido persistente (cierra con `unrecoverable` sin error estructurado).
     2. Verificador de decisión caído de forma persistente (registra `service_unavailable` y cierra con `unrecoverable`).
     3. `forPlan` cuyos efectos no caben en el límite del modelo (cierra con `unrecoverable`).
9. **Comparación al cierre sobre observables estables:** En `concludeTask` / `failTask`, se compara entre `task` y `ctx`: llamadas por herramienta con su status y `sig`, efectos confirmados, claves de hechos, estado terminal y resultado final.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Ejecutar tareas en NORMAL y PLAN; validar que el log diagnósticos reporte coincidencia sin alterar la respuesta externa.
**Git commit sugerido:** `git commit -m "fase 3: escritura en paralelo y diagnostico al cierre"`

---

### Fase 3b — Comportamientos previos a las vistas (uno por fase)

#### 3b.1 (D9) — Paso reactivo creado en `running` antes de Decision #1
- **Archivos:** `src/core/modeEngines.ts`.
- **Cambio:** En `runFastLoop`, el paso se crea en estado `running` antes de invocar a `askDecisionOne`, asignándole su `stepId` de inmediato.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Ejecutar tarea reactiva; comprobar que las decisiones y llamadas ocurren con `stepId` asignado desde el inicio.
- **Git commit sugerido:** `git commit -m "fase 3b.1: paso reactivo creado en running antes de decision"`

#### 3b.2 (5a) — `server_denied` separado de `denied` (Guard)
- **Archivos:** `src/core/processor/resultProcessor.ts`, `src/core/callExecutor.ts`, `src/core/modeEngines.ts`.
- **Cambio:** `[DENIED]` en el resultado de la herramienta genera `signals.server_denied = true` (no `denied`). La llamada se registra como `server_denied`, el paso queda `failed` y el motor prosigue con la recuperación del modo (escalación o replan) en lugar de abortar la tarea.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Ejecutar comando sobre archivo protegido; verificar que el paso falla pero la tarea continúa buscando alternativas.
- **Git commit sugerido:** `git commit -m "fase 3b.2: separacion de server_denied frente a guard denied"`

#### 3b.3 (5b) — Comportamiento de `loop_blocked` y `user_rejected`
- **Archivos:** `src/core/callExecutor.ts`, `src/core/modeEngines.ts`.
- **Cambio:** Se elimina el estado de paso `BLOCKED`.
  - `loop_blocked`: deja el paso en `failed` en **ambos modos** (reactivo y deliberativo).
  - `user_rejected`: en deliberativo deja el paso en `failed` y dispara replanificación con la instrucción visible en los fallos. En reactivo **no deja el paso en `failed`**: la llamada queda registrada como `user_rejected`, el paso permanece `running` y el modelo de decisión decide de nuevo dentro del mismo paso (pudiendo `canFinish()` resolver a `no_alternatives`).
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Provocar loop y rechazar confirmación en reactivo y deliberativo; verificar estados correspondientes.
- **Git commit sugerido:** `git commit -m "fase 3b.3: loop_blocked y user_rejected dejan paso failed"`

#### 3b.4 (5c) — Eliminación del segundo juez de verificación (Qwen)
- **Archivos:** `src/core/callExecutor.ts`, `src/core/events.ts`.
- **Cambio:** Se elimina la llamada a `deps.llm.verifyStage`. Solo Decision evalúa el resultado. Si la verificación no está disponible de forma persistente, se registra error `service_unavailable` y la tarea cierra con `unrecoverable`. Se suprime el evento `STAGE_VERIFIED`.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Ejecutar tarea en PLAN; validar ausencia de consultas hacia Qwen para verificación intermedia.
- **Git commit sugerido:** `git commit -m "fase 3b.4: eliminacion del segundo juez de verificacion"`

#### 3b.5 (5f) — Esperas como control de flujo del ejecutor
- **Archivos:** `src/core/core.ts`, `src/core/modeEngines.ts`, `src/core/callExecutor.ts`, `src/server/jarvisRouter.ts`.
- **Cambio:** Durante las esperas de confirmación de plan, aprobación Guard o respuesta a pregunta, el estado de la tarea permanece `"running"`.
- **Usos migrados de `WAITING_INPUT` y `waitingReason`:**
  - `callExecutor.ts:417-421, 435`: Se elimina la mutación de `task.state = "WAITING_INPUT"`. La espera de aprobación se gestiona en `context.pendingApproval`.
  - `core.ts:138-139`: `isAwaitingPlanConfirmation` pasa a consultar `context.awaitingPlanConfirmation` en `TaskExecutionContext`.
  - `core.ts:285`: `provideUserAnswer` valida la presencia de `context.pendingQuestion`.
  - `core.ts:345`: `findOldestWaitingTask` busca tareas con esperas activas (`pendingApproval || pendingQuestion || awaitingPlanConfirmation`).
  - `modeEngines.ts:475-484`: Al generar plan inicial, activa `context.awaitingPlanConfirmation = true` sin alterar `task.state`.
  - `modeEngines.ts:513-520`: `suspendForUserAnswer` almacena en `context.pendingQuestion`.
  - `modeEngines.ts:530, 554`: Los bucles comprueban si la ejecución está en pausa o detenida sin consultar `WAITING_INPUT`.
  - `jarvisRouter.ts:52, 59, 103, 119`: Los endpoints consultan los estados de espera en `TaskExecutionContext`.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Pausar por aprobación Guard o plan; validar en logs que el estado de la tarea permanece `"running"`.
- **Git commit sugerido:** `git commit -m "fase 3b.5: esperas como control de flujo del ejecutor"`

---

### Fase 4 — Vistas del contexto (`ctx.view.*`) y migración total de lecturas

**Archivos afectados:**
- `src/core/ctx/views.ts` (nuevo módulo)
- `src/core/callExecutor.ts`
- `src/core/modeEngines.ts`
- `src/core/taskConclusion.ts`
- `src/core/decision.ts`

**Qué cambia:**
1. Implementación de funciones de vista pura en `src/core/ctx/views.ts` con sus firmas y presupuestos inyectados (§3.5).
2. **Diferencias informativas por vista (Misma información):**
   - **`forRoute`:**
     - *Legacy:* `logLines` con formato pipe `|` y lista de strings de intentos fallidos.
     - *Nuevo:* Intentos recientes agrupados por herramienta/ruta desde `ctx.calls`, status estructurado, hechos vigentes y fallos recientes en ventana escalada (2, 5 o 10).
   - **`forArgs`:**
     - *Legacy:* `logLines` completas, `failLines` completas, `dataObs` en memoria RAM.
     - *Nuevo:* Instrucción del paso + handoff (o solicitud original si reactivo); últimas lecturas con datos estructuradas desde `calls`; referencias disponibles desde `ctx.refs`; efectos consolidados; hechos; y **únicamente los fallos del paso actual**. Strings recortados con marcador `…(+N)`.
   - **`forVerify`:**
     - *Legacy:* instrucción, nombre de tool, `decisionSummary` con finding, `evidence.summary`, `expectedOutcome`, `compactObs`.
     - *Nuevo:* Paso, criterio esperado, llamada evaluada (`summary` y `ref` con tamaño y ruta), y efectos confirmados del paso.
   - **`forPlan`:**
     - *Legacy:* pasos anteriores, error del paso fallido, `facts`, efectos recortados a 1000 caracteres.
     - *Nuevo:* Solicitud original, ventana de pasos, **todos los efectos sin recortar** (uno por línea), posibles efectos de llamadas interrumpidas/fallidas, hechos, fallos recientes en ventana escalada, y `feedback` de planes anteriores.
   - **`forFinal`:**
     - *Legacy:* `logLines` (hasta 10), `failLines`, `facts`, efectos (hasta 10), 3 evidencias.
     - *Nuevo:* Solicitud, estado terminal y motivo `stopReason`, estado de cada paso, evidencia de llamadas, efectos y posibles efectos, y hechos. Si excede presupuesto de modelo, cae a `forFallback`.
   - **`forFallback`:**
     - *Legacy:* `STATE_LABEL`, motivo de aborto, 5 líneas de log, hechos, 2 lecturas.
     - *Nuevo:* Estado, `stopReason`, fallos estructurados, efectos completos y posibles efectos, hechos y últimas acciones deterministas.
3. **Mecanismo de migración segura:** En cada consumidor se renderizan ambos prompts, se registran sus diferencias en log diagnósticos, se sigue enviando el prompt legacy y se conmuta al nuevo tras validación del usuario.
4. **Migración de todas las lecturas de control:**
   - Pasos vigentes y replans derivados desde `ctx.steps` y `ctx.plans`.
   - Conteo de escalaciones derivado desde pasos `failed`.
   - Límite `max_steps`: en reactivo se evalúa antes de crear el paso 16 para cerrar con `max_steps`.
   - Consultas `ctx.isRepeat(tool, sig, { exempt })`, `ctx.canFinish()`, `ctx.hasApprovedCall()`, `ctx.isClosed()`.
5. **Criterio de salida verificable:** Una búsqueda global en el repositorio no debe encontrar ninguna lectura de campos de `Task` legacy fuera del mecanismo de escritura en espejo.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Ejecutar tareas y verificar en logs que la información provista por las nuevas vistas es equivalente y coherente con las decisiones tomadas.
**Git commit sugerido:** `git commit -m "fase 4: vistas del contexto y migracion total de lecturas"`

---

### Fase 5 — Comportamientos posteriores a las vistas

#### F5.1 — `ask_user` en ambos modos (tope 1 por paso)
- **Archivos:** `src/core/modeEngines.ts`, `src/core/callExecutor.ts`, `src/core/core.ts`.
- **Cambio:** Disponible en reactivo y deliberativo si no existe un hecho previo `answer_<stepId>` para el paso actual. La redacción de la pregunta la realiza el modelo generador de argumentos utilizando una vista derivada de `forArgs`. Al recibirse la respuesta, se almacena el hecho en `facts` recortado a 500 chars (y completo en refs) y el paso continúa su ciclo.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Provocar `ask_user` en reactivo; responder la pregunta y verificar la reanudación del ciclo.
- **Git commit sugerido:** `git commit -m "fase 5.1: ask_user unificado con redaccion por modelo de argumentos"`

#### F5.2 — Planes versionados con `user_feedback`
- **Archivos:** `src/core/core.ts`, `src/core/modeEngines.ts`, `src/core/types/limits.ts`.
- **Cambio:**
  - `modifyPlan`: agrega un nuevo registro a `plans[]` con `trigger: "user_feedback"`, almacenando la instrucción en `feedback` (recortada a `PLAN_FEEDBACK_MAX`). Marca pasos no completados como `superseded: true` y añade los nuevos pasos.
  - `rejectPlan`: registra rechazo y concluye con `user_cancelled`.
  - Validación de 1 a 15 pasos por el cliente del modelo: se aplica obligatoriamente tanto al plan inicial como a los replanes. Si la salida es inválida, se repite una vez; de persistir, el plan inicial cierra con `unrecoverable` y el replan con `replans_exhausted`.
- **Verificación `tsc`:** Limpio.
- **Prueba manual:** Modificar un plan en espera de confirmación; constatar que el historial conserva el plan anterior y activa la nueva versión.
- **Git commit sugerido:** `git commit -m "fase 5.2: planes versionados user_feedback"`

---

### Fase 6 — Traza, eventos y SSE desde el contexto

**Archivos afectados:**
- `src/core/taskTrace.ts`
- `src/core/events.ts`
- `src/core/stepEvents.ts`
- `src/core/modelIterations.ts`
- `src/server/jarvisRouter.ts`

**Qué cambia:**
1. `taskTrace.ts`: Formalización del `TraceCollector` externo (§3.4). Genera la traza consumiendo `ctx.snapshot()`. Guarda I/O cruda de modelos identificada por `stepId`, orden y versión `n`, y enlazada con `call.id`. Guarda intervalo de ejecución y resultado crudo de llamadas sin ref (o ruta `where`).
2. `jarvisRouter.ts`: el payload SSE transmite directamente `{ event, snapshot: ctx.snapshot(), pendingApproval, pendingQuestion, awaitingPlanConfirmation }`.
3. `events.ts`:
   - Se eliminan del mapa: `STAGE_VERIFIED`, `PLAN_MODIFIED`, `PLAN_REJECTED`.
   - `STEP_STATE_CHANGED` refleja los 4 estados canónicos (`pending`, `running`, `completed`, `failed`).
   - `TASK_STATE_CHANGED` prescinde de `waitingReason`.
4. `modelIterations.ts`: snapshots leen exclusivamente de `ctx.calls`, `ctx.facts` y `ctx.errors`.

**Verificación con `tsc`:** `npx tsc --noEmit` limpio.
**Prueba manual:** Ejecutar tarea y verificar que el archivo JSONL de traza contenga el snapshot v1 y las referencias a archivos en disco legibles.
**Git commit sugerido:** `git commit -m "fase 6: traza, eventos y sse alimentados desde ctx"`

---

### Fase 7 — Limpieza definitiva y borrado puro de legacy

**Archivos afectados:**
- `src/core/types/task.ts`
- `src/core/types/execution.ts`
- `src/core/context.ts`
- `src/core/core.ts`

**Qué cambia:**
1. Eliminación pura de campos en desuso en `Task` y tipos de ejecución (sin crear adaptadores ni proyecciones artificiales):
   - `scratchpad`, `memory`, `replans`, `escalations`, `stepSeq`, `currentStep`, `planConfirmed`, `pendingQuestion`, `userAnswers`, `waitingReason`, `rawPlanInput`, `rawPlanOutput`, `rawFinalInput`, `rawFinalOutput`.
   - En `Step`: `mcp`, `tool`, `args`, `evidence`, `verification`, `outcome`, `error`, `handoff`, `rawInput`, `rawOutput`, `questionsAsked`, `rev`.
   - Tipos eliminados: `Scratchpad`, `TaskMemory`, `PendingQuestion`, `UserAnswer`, `WaitingReason`, `StepCall`, `StepState` (`UNVERIFIED`, `BLOCKED`, `WAITING_APPROVAL`), `TaskState` (`WAITING_INPUT`).
2. Eliminación de funciones legacy en `context.ts`:
   - `createEmptyMemory`, `ensureMemory`, `addLogEntry`, `addFailEntry`, `recordFailure`.
   - `buildHistoryContext`, `buildDecisionMemory`, `buildAttempts`, `DataObservation`, `recordDataObservation`.
   - `buildEffectsContext`, `buildPlanLines`, `applyStepHandoff`, `buildRefsContext`.
   - `hasUnresolvedUnverified`, `expandMemoryContext`, `describeFailure`.
3. Simplificación de `TaskExecutionContext`: conserva únicamente objetos no serializables de control en ejecución (`abortController`, `isCancelled`, `pendingApproval`, `pendingQuestion`, `awaitingPlanConfirmation`, `traced`, `ctx`). Se elimina `startTime` (ya cubierto por `ctx.task.startedAt`).
4. Reemplazo de `context.ts` por reexportación limpia desde `src/core/ctx/`.

**Verificación con `tsc`:** `npx tsc --noEmit` debe quedar 100% limpio en todo el proyecto backend.
**Prueba manual:** Batería completa de pruebas funcionales (reactivo, deliberativo, cancelaciones, fallos, anti-loop) confirmando estabilidad total.
**Git commit sugerido:** `git commit -m "fase 7: borrado puro de estructuras y funciones legacy"`

---

## 5. Reporte técnico y respuestas de comprobación

### 5.1 Comprobación sobre lectura de archivos (`read_file` offset y length)
- **(a) Existencia de `length` en el esquema real del servidor:** En el código fuente del proyecto (`src/core/tools/manifest.ts:131`), `read_file` no restringe `params`, por lo que hereda dinámicamente el esquema del servidor `@wonderwhy-er/desktop-commander`. En la documentación del proyecto (`docs/salidas_tools_MCP.md:15`) y en el extractor (`extractors/files.ts:32`) se documenta el soporte de `offset` (línea inicial). Sin embargo, el esquema JSON real expuesto por el proceso MCP en runtime **no está verificado estáticamente en el repositorio** y debe validarse en la inicialización de herramientas del servidor.
- **(b) Archivo de una sola línea muy larga:** Dado que Desktop Commander y el extractor procesan líneas delimitadas por `\n`, un archivo de texto extenso que consista en una única línea (por ejemplo, un JSON minificado sin saltos de línea de 50.000 caracteres) no puede ser paginado por líneas (`offset 1` devuelve la línea entera).
- **(c) Formato de texto de los archivos de refs:** Los archivos físicos de refs guardan el texto crudo retornado por la herramienta (bloques de texto unidos). En herramientas como `free_search:search`, el texto devuelto ya contiene saltos de línea naturales separando snippets. Para herramientas con texto monolítico sin saltos de línea, la lectura por trozos dependerá de la capacidad de segmentación del servidor.

### 5.2 Parámetro `command: 1000` en manifiesto
- Confirmado en [`src/core/tools/manifest.ts:150-152`](file:///e:/colo/jarvv/src/core/tools/manifest.ts#L150-L152): herramienta `terminal:start_process`, parámetro `command`. Declarado en `argCaps: { command: 1000 }` (refleja [`context.ts:271`](file:///e:/colo/jarvv/src/core/context.ts#L271)).

### 5.3 Origen de la pregunta de `ask_user`
- Confirmado en [`src/core/callExecutor.ts:582`](file:///e:/colo/jarvv/src/core/callExecutor.ts#L582) y [`src/core/modeEngines.ts:509`](file:///e:/colo/jarvv/src/core/modeEngines.ts#L509): en la base actual la generaba el segundo juez (Qwen `verifyStage`). Al eliminarse el segundo juez en v0.30, la redacción se traslada al modelo generador de argumentos mediante vista especializada de `forArgs` (F5.1).
