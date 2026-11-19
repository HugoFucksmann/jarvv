# Revisión de desalineación: dos bucles (`reactive` vs `deliberative`)

> **Estado: diagnóstico sobre código vigente (solo análisis en `.md`, sin editar `src/`).**  
> Hallazgos verificados directamente contra `src/core/engine/`, `src/core/ctx/` y `docs/arquitectura/`.

---

## 1. Veredicto

El diagnóstico de tu agente es **correcto**: el proyecto rompió el principio de **un único bucle compartido que solo difiere al inicio antes de entrar**.

1. En `src/core/engine/runTask.ts:65`, `runTask` bifurca toda la ejecución de la tarea en **dos funciones y dos bucles `for (;;)` separados**: `runReactive(env)` (`75-159`) y `runDeliberative(env)` (`161-204`).
2. La divergencia **no se limita a la preparación previa al bucle**: ambos bucles difieren en el control de tope global de pasos, la carga de memoria/hilo al inicio, la creación/obtención del paso, la verificación de cierre al completar y la estrategia, contadores y reglas de recuperación al fallar.
3. Además, esa separación se filtró hacia abajo en **10 archivos adicionales** del motor, el contexto y las vistas (`stepLoop.ts`, `probes.ts`, `completion.ts`, `recoveryShadow.ts`, `ctx/context.ts`, `ctx/closure.ts`, `ctx/validate.ts`, `ctx/views/route.ts`, `ctx/views/shared.ts`, `ctx/views/args.ts`, `ctx/views/verify.ts` y `ctx/views/final.ts`).

---

## 2. Comparación directa de los dos bucles en `runTask.ts`

| Aspecto | Bucle `runReactive` (`runTask.ts:75-159`) | Bucle `runDeliberative` (`runTask.ts:161-204`) | Desalineación detectada |
|---|---|---|---|
| **Entrada pre-bucle** | `detectContinuation` (`thread`) → `recordInitialRecalled` (`user_memory` + `thread`) → `classifyRequest` (D0: corta en `chat` o siembra `single` en `ReactiveList`). | `recordUserMemory` (sin `detectContinuation` ni `thread`) → `generatePlan({ kind: "initial" })` → bucle de confirmación humana (`confirmPlan` + `user_feedback`). | El inicio pre-bucle es legítimamente distinto, pero en deliberativo **no corre `detectContinuation` / `thread`** (`PENDIENTES_CODIGO.md:130`). |
| **Guarda de tope de pasos (`maxSteps`)** | En cada vuelta verifica `stepsExhausted(ctx)` (`runTask.ts:104`, `limits.ts:59`), que cuenta todos los pasos (`ctx.find("steps", {}).length >= BUDGET.maxSteps`) y cierra `max_steps`. | **No verifica `stepsExhausted(ctx)` ni devuelve `max_steps`** (`runTask.ts:181-203`). Solo `planInput` (`adapters.ts:110-111`) limita el tamaño del plan nuevo a `BUDGET.maxSteps - completed`. | Al no restar pasos `failed` marcados como `superseded`, deliberativo con replans puede superar `BUDGET.maxSteps` pasos en `ctx.steps`, mientras reactivo corta estricto. |
| **Origen de la agenda** | Lista efímera fuera de `TaskContext` (`ReactiveList` en RAM local de `runReactive`). Llama a `generatePending` cuando `list.needsModel`. | Pasos ya persistidos en `TaskContext` (`ctx.current().step`). | Dos modelos de agenda incompatibles: en reactivo la agenda vive fuera de `ctx` y se inserta paso a paso; en deliberativo vive en `ctx.steps` vinculado a `ctx.plans`. |
| **Apertura del paso (`runStep`)** | Pasa `StepSeed = { kind: "reactive", instruction: list.head }`. `stepLoop.ts:59` crea el paso con `planId: null, route: null, expected: null`. | Pasa `StepSeed = { kind: "planned", stepId: current.id }`. `stepLoop.ts:66` actualiza un paso existente de `pending` a `running`. | `stepLoop.ts:52-53` acopla explícitamente `seed.kind` con `ctx.task.mode` y bifurca la creación vs promoción del paso. |
| **Al completarse un paso** | `list.completeHead()` → si `list.isEmpty`, consulta **Decisión 5** (`confirmCompletion` + `completionCoverageGuard`) y, si D5 duda, reactiva al LLM (`list.askModelToConfirm()`, hasta `MAX_REOPENS = 2`). | `continue` → al inicio de la vuelta evalúa `planClosure(ctx.find("steps", {})) === "completed"` y cierra directo. | Deliberativo no tiene verificación global de cumplimiento contra el `request` (ni D5 ni guarda de cobertura de archivos). |
| **Al fallar un paso** | 1. Chequea **racha consecutiva** (`escalationsExceeded`: `consecutiveFailedSteps > BUDGET.maxEscalations`, se reinicia al completar un paso).<br>2. Ejecuta `shadowRecovery` (`recoveryShadow.ts` + `recoveryRules.ts`).<br>3. `list.failHead(cause)` → `generatePending` + `ReactiveList.applyModelList` (`identical_rewrite`, `identical_retry` tras `tool_failed`, `no_replacement`, `skips_failed_item`). | 1. Chequea **total acumulado** (`replansExhausted`: `replansDone >= BUDGET.maxReplans`, nunca se reinicia al completar pasos).<br>2. **No ejecuta `shadowRecovery` ni `recoveryRules`.**<br>3. Llama directo a `generatePlan({ kind: "step_failure" })` sin detectar reescritura idéntica ni paradas duras (`hardStop`). | Políticas de fallo, contadores, detección de bucles de reescritura y telemetría de `recovery` completamente divergentes. |
| **Motivo de detención por agotamiento** | `no_alternatives` (por racha de fallos o rechazo de `applyModelList` / `applyModelDone`). | `replans_exhausted` (por tope de replans o replan inválido). | Dos `StopReason` y dos criterios de conteo distintos para el mismo evento (no poder recuperar un paso fallido). |

---

## 3. Puntos fuera de `runTask.ts` donde se filtró la separación de modos

La separación de bucles provocó o consolidó ramificaciones `mode === "reactive"` / `"deliberative"` en capas que deberían ser agnósticas del modo una vez iniciado el bucle:

### 3.1 Motor (`src/core/engine/`)
- **`src/core/engine/stepLoop.ts:44, 52-67, 96`**:
  - Define `StepSeed` como unión discriminada por modo y lanza error si `reactive !== (seed.kind === "reactive")`.
  - Línea `96`: `availableRoutes(env, stepId, reactive ? EXECUTABLE_ROUTES : [plannedRoute as ExecutableRoute])`. En deliberativo entra igual a D1 pero con una sola ruta fija (`shortcut: true` en `decision.ts:216-220`).
- **`src/core/engine/probes.ts:32-33`**:
  - `probeCallOf` pasa `ctx.task.request` en reactivo y `stepText` en deliberativo (tanto en `request` como en `step`). En deliberativo, además, no pasa `step.expected` a las sondas.
- **`src/core/engine/completion.ts:53`**:
  - `confirmCompletion` corta de entrada si `ctx.task.mode !== "reactive" || ctx.canFinish() !== "completed"`.
- **`src/core/engine/recoveryShadow.ts` y `src/core/engine/runTask.ts:150`**:
  - El modo sombra de `recovery` y las reglas deterministas de `recoveryRules.ts` (ej. `hardStop` por `user_rejected`, `denied`, `permission_denied`, `repeat_blocked`) solo se invocan en el `case "failed"` de `runReactive`.

### 3.2 Contexto, validación e invariantes (`src/core/ctx/`)
- **`src/core/ctx/validate.ts:123, 157-166, 254`**:
  - `checkPlanInput`: prohíbe `plans` en reactivo.
  - `checkStepInput`: en reactivo prohíbe `planId`, `route` y `expected` (obliga `null`); en deliberativo exige los tres no nulos.
  - `checkStepPatch`: prohíbe `superseded` en reactivo.
- **`src/core/ctx/context.ts:212` y `src/core/ctx/closure.ts:34-52, 83-89`**:
  - `ctx.canFinish()` devuelve `null` fijo si `mode !== "reactive"`.
  - `assertFinalState` valida dos invariantes de cierre `completed` incompatibles: `planClosure(steps)` en deliberativo frente a `canFinish(calls)` en reactivo.

### 3.3 Vistas de contexto (`src/core/ctx/views/`)
- **`src/core/ctx/views/route.ts:14, 22-27`** (`forRoute`): en reactivo incluye `request`, `lastResult` y `done`; en deliberativo devuelve `null`, `null` y `[]`.
- **`src/core/ctx/views/shared.ts:154, 168-171`** (`taskPartsOf`, compartido por `forArgs` y `forReview`): en reactivo llena `done` y deja `stepsDone: []`; en deliberativo llena `stepsDone` y deja `done: []`.
- **`src/core/ctx/views/args.ts:49`** (`forArgs`): envía `request: data.task.request` solo en reactivo (`null` en deliberativo), por lo que en deliberativo el generador de argumentos no ve `REQUEST:`.
- **`src/core/ctx/views/verify.ts:27, 32`** (`forVerify`): envía `done` solo en reactivo (`[]` en deliberativo, aunque `previous` sí se envía en ambos).
- **`src/core/ctx/views/final.ts:36, 40`** (`forFinal`): envía `steps` solo en deliberativo (`[]` en reactivo).

---

## 4. En qué punto y cómo se desalineó el proyecto

La desalineación ocurrió en **dos momentos claros** verificables en el historial técnico y los comentarios del código:

### Momento 1: Separación de modelos de datos y entrada del motor (base del núcleo, `v0.6.0`)
Al diseñar `TaskContext` (`src/core/ctx/`) y `runTask.ts`:
- Se concibió el modo **deliberativo** alrededor de entidades persistidas en el contexto (`plans` + `steps` precreados con `route` y `expected`, reemplazados vía `superseded`), cerrando por `planClosure(steps)`.
- Se concibió el modo **reactivo** **sin representación de la agenda en el contexto** (una lista local en RAM dentro de `runReactive`, creando cada `step` recién al ejecutarlo y cerrando por `canFinish(calls)`).
- En lugar de abstraer una **única agenda/estrategia de pasos** antes de entrar al bucle y que ambos modos recorrieran el mismo bucle de ejecución, se escribieron dos bucles completos en `runTask.ts` (`runReactive` y `runDeliberative`), compartiendo únicamente `runStep` → `runCall` y `finalize`.

### Momento 2: Evolución asimétrica posterior guiada por `eval/` y trazas reales
Una vez que existían dos bucles independientes, todas las mejoras iterativas de confiabilidad, contexto y control de fallos se conectaron **exclusivamente sobre `runReactive`** (y sobre etapas medidas en `eval/` para el flujo reactivo), ampliando la brecha:
1. **Hilo con tarea anterior (`thread.ts`, `detectContinuation`)**: se agregó solo al inicio de `runReactive`, dejando a `runDeliberative` sin continuidad de hilo.
2. **Clasificación rápida D0 (`firstQuery`, `classifyRequest`)**: si bien conceptualmente pertenece al tramo **previo** al bucle, quedó encapsulada dentro de `runReactive` en lugar de formar parte de una fase inicial unificada.
3. **Control determinista de lista y reescrituras (`pendingList.ts` y `ReactiveList` en `REFACTOR_CORE`)**: el código pasó a conservar los ítems futuros, exigir cambio real al reescribir (`identical_rewrite`), conceder un reintento idéntico solo tras `tool_failed` (`identical_retry`), bloquear saltos (`skips_failed_item`) y permitir reaperturas (`MAX_REOPENS`). Ninguno de esos mecanismos existe en `runDeliberative` al replanificar.
4. **Cierre por Decisión 5 (`completion.ts` + `completionCoverageGuard`)**: se implementó con guarda explícita `ctx.task.mode !== "reactive"`, dejando el cierre deliberativo sin chequeo global contra `request`.
5. **Recuperación unificada (`recoveryShadow.ts` + `recoveryRules.ts`)**: se conectó solo en el `case "failed"` de `runReactive`, privando a `runDeliberative` de reglas de parada dura (`hardStop`) y de telemetría `recovery` en trazas reales.
6. **Ajustes de contadores y contexto**: reactivo migró `maxEscalations` a racha reiniciable (`consecutiveFailedSteps`), sumó `stepsExhausted` en su bucle e inyectó `REQUEST:` en `forArgs` y `probeCallOf`; deliberativo conservó `replansDone` acumulado, nunca recibió `stepsExhausted` en su bucle y quedó sin `REQUEST:` en `forArgs`.

---

## 5. Cómo queda respecto al principio buscado (referencia para unificación futura)

Bajo el principio de **1 único bucle compartido que solo difiere al inicio antes de entrar**, la frontera debería quedar así:

1. **Únicamente antes del bucle (preparación por modo)**:
   - Carga inicial común de `recalled` (`user_memory` y, si aplica, `detectContinuation` + `thread`).
   - **Rama reactiva pre-bucle**: `D0` (`classifyRequest`: atajo `chat` o semilla `single`) / primera lista de pendientes.
   - **Rama deliberativa pre-bucle**: `generatePlan("initial")` + bucle de confirmación humana (`confirmPlan` / `user_feedback`).
2. **Dentro del único bucle compartido (`for (;;)` en `runTask.ts`)**:
   - **Un único chequeo de entrada por vuelta**: cancelación + `stepsExhausted(ctx)` (`maxSteps` uniforme para ambos modos).
   - **Un único despacho a `runStep(env, ...)`**: sin bifurcaciones por modo dentro del bucle de paso más allá de si el paso trae ruta sugerida/fija o abierta.
   - **Un único manejo de `completed`**: marcar paso cumplido, obtener el siguiente paso pendiente de la agenda común y, al quedar vacía, aplicar la misma política de confirmación de cierre (`confirmCompletion` / cierre).
   - **Un único manejo de `failed`**: aplicar `recoveryRules` / `shadowRecovery` y contadores consistentes antes de pedir reemplazo del paso fallido o replanificar según el modo.
3. **Vistas y contexto**: eliminar gradualmente las ramas `mode === "reactive"` en `forArgs`, `forRoute`, `forVerify`, `forFinal`, `probes.ts` y `completion.ts` para que ambos modos se beneficien por igual de `REQUEST:`, `user_memory`/`thread`, `hardStop` y la verificación global de cierre.
