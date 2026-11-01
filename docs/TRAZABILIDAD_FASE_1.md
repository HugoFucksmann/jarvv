# Trazabilidad regla → código · Fase 1 (módulo `ctx`)

Base: `PLAN_CONTEXT.md` **v0.28**. Los archivos están en `src/core/ctx/`, salvo la tabla de configuración (`src/core/budget.ts`), que `ctx/` no importa. Una regla sin fila se considera no implementada; las que no corresponden a esta fase o a `apply` están al final, con su fase.

Convenciones: `Draft.x` es un método privado de la clase `Draft` de `apply.ts`. «Fin de lote» = `Draft.checkEnd`, que corre una sola vez sobre la vista final del lote.

## 1. Validación de `apply` (sección 6, reglas 1 a 7)

| # | Regla | Archivo · función |
|---|---|---|
| 1 | La tarea está abierta; si es terminal, solo se admite escribir `result` (una vez, en un `apply` posterior al `finish`) | `apply.ts` · `Draft.process` (comprueba `Draft.isClosed`: estado previo terminal o `finish` anterior en el mismo lote) |
| 1 | `result` solo se escribe con la tarea ya terminal, en un `apply` posterior al `finish` (con la tarea `running`, o en el mismo lote que `finish`, se rechaza) | `apply.ts` · `Draft.set` (rama `result`: `this.data.task.state === "running"`) |
| 2 | Operación bien formada: objeto `{ op, target, value }` sin campos extra, `op` ∈ add/update/set/finish, `target` texto, `value` presente | `apply.ts` · `Draft.process` |
| 2 | Lote no vacío | `apply.ts` · `prepareBatch` |
| 2 | El destino existe: sección de `add`; id de `update` (formato y existencia); `facts.<clave>` o `result` de `set`; `task` de `finish` | `apply.ts` · `Draft.add` (default), `Draft.update`, `Draft.set`, `Draft.finishTask`; `ids.ts` · `parseId`, `existsIn` |
| 3 | JSON plano (sin `undefined`, no finitos, instancias, huecos) y **profundidad máxima = regla de validación** (`jsonMaxDepth` recibido por parámetro; excederla es error de tope, regla 7) | `json.ts` · `jsonProblem`, `isPlainObject`; `validate.ts` · `checkArgs`, `ensureObject` |
| 3 | Campos exactamente los del esquema, todos presentes (lo que no aplica vale `null`) | `validate.ts` · `ensureKeys` (usado por todos los `check*`) |
| 3 | Nulables: `null` o texto no vacío, nunca `""` | `validate.ts` · `nullableText`, `reqText` |
| 3 | Vocabularios de 5.3 | `validate.ts` · `oneOf`, `nullableOneOf`; `types.ts` · listas `*_STATES`, `*_STATUSES`, etc. y `VERDICT_REASONS` (dentro de `ctx/`, decisión del usuario) |
| 3 | Valores por defecto: `add` completa `id`, `at`, `verdict = null`, `reason = null`, `superseded = false` y el `state` inicial; quien ejecuta no los escribe (se rechazan como campo desconocido) | `apply.ts` · `Draft.add` |
| 3 | `steps` estricto: reactivo → `planId`, `instruction`, `route` y `expected` valen `null`; deliberativo → los cuatro obligatorios (`expected` también; `null` solo en reactivo) | `validate.ts` · `checkStepInput` |
| 4 | Campos mutables: `steps` → `state`, `superseded`; `calls` → `verdict` y `reason` juntos | `validate.ts` · `checkStepPatch`, `checkCallPatch` |
| 4 | `verdict` y `reason` se escriben **una sola vez** (mientras `verdict` sea `null`); un reintento es una llamada nueva | `apply.ts` · `Draft.update` (rama `calls`) |
| 4 | `plans`, `errors`, `refs` inmutables | `apply.ts` · `Draft.update` (rama `default`) |
| 4 | `task.state` solo lo cambia `finish` (no hay otro camino de escritura sobre `task`) | `apply.ts` · `Draft.finishTask`, `Draft.commit` |
| 4 | `facts`: cambia `value`; `stepId` y `at` se actualizan en cada `set` | `apply.ts` · `Draft.set` (rama `facts.`) |
| 4 | `result` se escribe una sola vez (mientras sea `null`) | `apply.ts` · `Draft.set` (rama `result`, `Draft.currentResult`) |
| 5 | Las referencias existen: `plan.stepId`, `step.planId`, `call.stepId`, `call.ref`, `error.stepId`, `ref.stepId`, `fact.stepId` | `validate.ts` · `checkPlanInput`, `checkStepInput`, `checkCallInput`, `checkErrorInput`, `checkRefInput`, `checkFactInput` |
| 5 | Las referencias se resuelven contra el contexto previo al lote (un lote no puede usar ids que él mismo crea) | `apply.ts` · `prepareBatch` (`env: CheckEnv`), `Draft.update` (`existsIn` sobre `this.data`) |
| 6 | Transiciones de `step.state` (al final del lote) | `apply.ts` · `ALLOWED_STEP_TRANSITIONS`, `Draft.checkEnd` |
| 6 | Invariante 1: `superseded` solo de `false` a `true`, y nunca en un paso `completed` | `apply.ts` · `Draft.checkEnd` |
| 6 | Invariante 2: como máximo un paso vigente `running` (incluye pasos agregados en el lote) | `apply.ts` · `Draft.checkEnd` (`Draft.finalSteps`) |
| 6 | Invariante 3: `finish` con `completed` — deliberativo: el cierre del plan da `completed`; reactivo: `canFinish()` da `completed` | `closure.ts` · `assertFinalState` (llamado desde `Draft.checkEnd`) |
| 7 | Tope de `summary` | `validate.ts` · `nullableText` (en `checkCallInput`) con `limits.summaryMax`; el valor (2500) lo define `src/core/budget.ts` · `BUDGET.summaryMax` y lo pasa quien crea el contexto |
| 7 | Tope de los strings de `args` (`ARGS_MAX`) | `validate.ts` · `checkArgs` con `limits.argsStringMax`; **se calcula desde el catálogo** (`argCaps`, respaldo `BUDGET.argsStringDefault`) por quien crea el contexto, no está en la tabla |
| 7 | Tope del valor de un hecho | `validate.ts` · `nullableText` (en `checkFactInput`) con `limits.factValueMax` (valor en `BUDGET.factValueMax`) |
| 7 | Formato de clave de `facts`: `^[a-z][a-z0-9_]*$` | `validate.ts` · `checkFactKey` |

## 2. Atomicidad, evento y API (sección 6)

| Regla | Archivo · función |
|---|---|
| Un lote se aplica completo o no se aplica: ante cualquier error lanza, no cambia nada y no emite evento | `apply.ts` · `prepareBatch` (valida sobre un borrador sin tocar `data`), `Draft.commit` (solo corre si todo pasó); `context.ts` · `TaskContext.apply` |
| Un lote no puede usar ids que él mismo crea; ids consecutivos dentro del lote | `apply.ts` · `Draft.nextId`, `Draft.update`; `ids.ts` · `makeId` |
| `apply(ops, meta?)` devuelve `{ n, ids }`; acepta una operación o un arreglo | `context.ts` · `TaskContext.apply`; `apply.ts` · `prepareBatch` |
| `add` asigna `id` (prefijo + conteo de la sección + 1) y `at` | `apply.ts` · `Draft.add`; `ids.ts` · `makeId`, `ID_PREFIX` |
| Cada `apply` exitoso incrementa `n` y emite un único evento `change` `{ n, at, ops, meta }` con las operaciones normalizadas | `context.ts` · `TaskContext.apply`, `TaskContext.emit`; `apply.ts` · `Draft.record` |
| Suscriptores (`ctx.on("change", fn)`) de solo lectura: no pueden llamar a `apply`; si fallan, el cambio no se revierte | `context.ts` · `TaskContext.on`, `TaskContext.emit` (bandera `emitting`, `try/catch`); elementos y ops congelados: `json.ts` · `deepFreeze` |
| `meta` opcional, opaco y categórico | `validate.ts` · `checkMeta` |
| `ctx.get(id)` y `ctx.get("facts.clave")` | `query.ts` · `getElement`; `context.ts` · `TaskContext.get` |
| `ctx.find(sección, where)` incluye los reemplazados por un replan | `query.ts` · `findElements`; `context.ts` · `TaskContext.find` |
| `ctx.current()` → `{ step, lastCall }`: paso vigente `running` o, si no hay, el primer vigente `pending`; última llamada | `query.ts` · `currentOf`; `context.ts` · `TaskContext.current` |
| `create.context({ id, request, mode }, options)`: `id` recibido, reloj (`now`) y topes por parámetro; sin valores por defecto | `create.ts` · `create.context`; `types.ts` · `ContextOptions`, `ContextLimits` |
| `ctx.snapshot()`; `ctx.n` fuera del JSON. **No hay `ctx.load`**: el único camino para cargar un estado es `create.fromSnapshot(snapshot, options)` | `snapshot.ts` · `cloneData`, `parseSnapshot`; `context.ts` · `TaskContext.snapshot`, `TaskContext.n`; `create.ts` · `create.fromSnapshot` |
| `create.fromSnapshot` rechaza snapshots con un `v` distinto (validación completa de snapshot **como está implementada**, decisión del usuario) | `snapshot.ts` · `parseSnapshot` (código `snapshot_version`) |
| `isClosed()` | `context.ts` · `TaskContext.isClosed` |

## 3. Esquema y campos (sección 5, 5.1, 5.2)

| Regla | Archivo · función |
|---|---|
| Esquema del objeto de contexto `{ v, task, plans, steps, calls, errors, facts, refs, result }` | `types.ts` · `ContextData` y las interfaces de elementos |
| Estado inicial: `running`, `stopReason = null`, arreglos vacíos, `facts = {}`, `result = null`; `startedAt` con el reloj inyectado | `create.ts` · `create.context` |
| `v: 1` | `types.ts` · `CONTEXT_VERSION` |
| Ids `p/s/c/e/r` + número creciente, únicos, nunca reutilizados ni renumerados; nada se borra (no existe operación de borrado) | `ids.ts` · `makeId`, `parseId`; `types.ts` · `Op` (solo add, update, set, finish) |
| `stepId` en `steps` se omite; en `plans` es el paso que falló (`step_failure`), en los demás `null`; en `errors` es obligatorio | `validate.ts` · `checkPlanInput`, `checkErrorInput`; `apply.ts` · `Draft.add` |
| `plans`: `feedback` solo en `user_feedback`; `stepId` solo en `step_failure`; solo modo deliberativo | `validate.ts` · `checkPlanInput` |
| `steps`: en reactivo `planId`, `instruction`, `route` y `expected` valen `null`; en deliberativo los cuatro son obligatorios | `validate.ts` · `checkStepInput` |
| `steps.state` al nacer: `pending` si trae `planId`, `running` si no | `apply.ts` · `Draft.add` (rama `steps`) |
| `superseded` solo existe en deliberativo; `false` al crearse | `validate.ts` · `checkStepPatch`; `apply.ts` · `Draft.add` |
| `calls.args` es `null` solo en `args_invalid`; `sig` es `null` cuando no hubo argumentos resueltos (`args_invalid`, `refs_unresolved`) y existe en el resto | `validate.ts` · `checkCallInput` |
| `calls.verdict`/`reason`: `null` al crearse; `rejected` requiere `reason`; `reason` solo con `rejected`; una sola vez | `apply.ts` · `Draft.add`, `Draft.update`; `validate.ts` · `checkCallPatch` |
| `calls.summary`: `null` o texto no vacío hasta el tope | `validate.ts` · `checkCallInput`, `nullableText` |
| `calls.ref`: `null` o id de una ref existente (primero se agrega la ref y después la llamada, en dos `apply`) | `validate.ts` · `checkCallInput` |
| `refs`: `label`, `size` (entero ≥ 0), `where` | `validate.ts` · `checkRefInput` |
| `errors.kind = service_unavailable` | `validate.ts` · `checkErrorInput`; `types.ts` · `ERROR_KINDS` |
| `facts`: `{ value, stepId, at }`, `value` texto o `null` (retirado) | `validate.ts` · `checkFactInput`; `apply.ts` · `Draft.set` |
| `result`: `{ text, origin }`, `origin` ∈ model/fallback | `validate.ts` · `checkResultInput` |

## 4. Estados y vocabularios (5.3)

| Regla | Archivo · función |
|---|---|
| Vocabularios de `task.state`, `stopReason`, `step.state`, `call.status`, `call.verdict`, `error.kind` | `types.ts` (listas y tipos) |
| `call.status`: ejecutadas / no ejecutadas / `denied` con dos orígenes | `types.ts` · `EXECUTED_CALL_STATUSES`, `NOT_EXECUTED_CALL_STATUSES`, `CALL_STATUSES` |
| Se verifica toda llamada ejecutada salvo `interrupted` y `denied` | `types.ts` · `VERIFIABLE_CALL_STATUSES`; `validate.ts` · `assertVerifiable` (llamado desde `Draft.update`) |
| `call.reason`: valores iniciales `no_usable_data`, `not_accomplished` (provisorio) | `types.ts` · `VERDICT_REASONS`, `VerdictReason` |
| Estado terminal congelado: después de él solo se escribe `result`, una vez, en un `apply` posterior | `apply.ts` · `Draft.process`, `Draft.set` |
| `task.state` pasa de `running` a un terminal; un terminal no tiene salida | `apply.ts` · `Draft.process` (regla 1), `Draft.finishTask` |
| `stopReason` solo en `partial`, `failed` y `cancelled`; `completed` no lleva motivo | `closure.ts` · `assertFinalState` |
| Estado terminal por motivo: `max_steps`, `loop_blocked`, `replans_exhausted`, `no_alternatives`, `unrecoverable` → `partial` si hay efectos o llamada aprobada con `status = ok`, si no `failed`; `security_denied` → `failed`; `user_cancelled` → `cancelled` | `closure.ts` · `terminalStateFor`, `assertFinalState` (llamado desde `Draft.checkEnd`) |
| Transiciones de `step.state`: `pending → running`, `running → completed`, `running → failed`; `completed` y `failed` son finales | `apply.ts` · `ALLOWED_STEP_TRANSITIONS`, `Draft.checkEnd` |

## 5. Derivaciones que `apply` necesita (5.4)

| Regla | Archivo · función |
|---|---|
| Efectos: `calls` con `kind = write` y `status = ok`, cualquier veredicto | `closure.ts` · `hasEffects` |
| Existe llamada aprobada: `verdict = approved`, de cualquier `status` | `closure.ts` · `hasApprovedCall` |
| Para `partial` solo cuenta `status = ok` | `closure.ts` · `hasApprovedOk` |
| Cierre con `fin` (reactivo): `canFinish()` | `closure.ts` · `canFinish` |
| Cierre del plan (deliberativo) | `closure.ts` · `planClosure` |

## 6. Principios, persistencia y presupuesto

| Regla | Archivo · función |
|---|---|
| Principio 1: lo calculable no se guarda (no hay campos derivados en el esquema) | `types.ts` · `ContextData` |
| Principio 3: todo elemento de `plans`, `steps`, `calls`, `errors`, `refs` tiene identificador y marca de tiempo | `apply.ts` · `Draft.add` |
| Principio 5: el contexto no conoce herramientas, modelos ni traza ni valores propios (no importa nada fuera de `ctx/`; `id`, reloj y topes se inyectan) | todos los archivos; `types.ts` · `ContextOptions`; `create.ts` |
| Principio 6: una sola puerta de escritura (`apply`); lo expuesto es de solo lectura | `context.ts` · `TaskContext.apply`; elementos congelados con `deepFreeze` |
| Principio 7: nada se borra | `types.ts` · `Op` (sin operación de borrado) |
| Almacenamiento: JSON plano en memoria; snapshot en JSON | `types.ts` · `ContextData`; `snapshot.ts` · `cloneData` |
| `apply` nunca recorta: rechaza los excesos | `validate.ts` · `nullableText`, `checkArgs`, `checkFactInput` (todos lanzan, ninguno recorta) |
| Un solo lugar define los valores provisorios, **fuera de `ctx/`** | `src/core/budget.ts` · `BUDGET`, `BUDGET_META` (el contexto recibe los topes por `ContextOptions`; `ctx/budget.ts` es una lápida a borrar) |

## 7. Reglas del diseño que NO se implementan en `apply` (con su fase)

| Regla | Dónde vive | Fase |
|---|---|---|
| Un plan solo se agrega con 1 a 15 pasos; `max_steps` cuenta pasos; antes del paso 16 la tarea cierra | Ejecutor (el contexto no conoce los topes de proceso; `apply` ve el plan antes que sus pasos). `BUDGET.maxSteps` queda en la tabla | 5 y 6 |
| Topes de replans, escalaciones, reintentos, llamadas por paso, preguntas por paso | Ejecutor; valores en `BUDGET` | 5 y 6 |
| Recorte de strings de `args` (`argCaps`), `summary`, hechos; cálculo de `argsStringMax` desde el catálogo | Quien ejecuta, antes de escribir (`apply` solo valida) | 4 y 5 |
| Anti-loop `isRepeat`, ventanas por escalaciones, contadores, handoff, fallos recientes, evidencia | `derive.ts` | 2 |
| Vistas `forPlan`, `forRoute`, `forArgs`, `forVerify`, `forFinal`, `forFallback` y `ctx.view.*` | `views/` | 2 |
| `canFinish()`, `hasApprovedCall()` como métodos de `TaskContext` | funciones puras ya en `closure.ts`; el método se agrega junto a `isRepeat` | 2 |
| Orden de cierre en cancelación (`interrupted` → `finish` → `result`) | Ejecutor (`closeout.ts`); `apply` lo hace posible porque `result` se admite tras el terminal | 5 y 6 |
| Creación de `error` según `kind` y cierre con `unrecoverable` | Ejecutor | 5 y 6 |
| Rutas de `refs`, retención, `refsMaxAgeDays` | `refs/` | 3 |

## 8. Reglas que se decidieron **no** validar en `apply`

| Regla | Motivo |
|---|---|
| Motivos de detención por modo (`no_alternatives` solo reactivo, `replans_exhausted` solo deliberativo) | v0.28: `apply` no valida motivos por modo; solo exige que el estado terminal corresponda al motivo (`closure.ts` · `assertFinalState`) |