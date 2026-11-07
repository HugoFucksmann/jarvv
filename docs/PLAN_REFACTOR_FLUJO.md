# Plan de refactor del flujo

Estado: **pasos 1 a 7 ejecutados** (el paso 8, el eval, está en `PLAN_EVAL.md`). Lo que quedó abierto está en `PENDIENTES_FUERA_DE_FLUJO.md`; el comportamiento vigente, en `CORE_FLOW.md`. Alcance: solo el flujo (etapas, orden, transiciones, bucles, cierre). Lo demás está en `PENDIENTES_FUERA_DE_FLUJO.md`. El refactor del ctx está terminado y no se rediseña.

Reglas: sin tests nuevos ni modificados; sin cambios fuera de este plan; sin hardening ni pulido (desarrollo local). Cada paso se aplica por separado, para poder comparar las trazas de antes y después.

## Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Modos | Se mantienen los dos. Reactivo: rápido y autónomo. Deliberativo: tareas largas. |
| 2 | Código huérfano | Se elimina. |
| 3 | Topes | Una sola fuente (`BUDGET`), valores altos: pasos 100, replans 10, llamadas por paso 50. Se suben después de los pasos 2 a 4. |
| 4 | `ask_user` | Sale de D1 y D2. Solo se ofrece tras `info_missing` de D3 o ante atasco. Máximo una pregunta por paso. |
| 5 | Reactivo | Lista de pendientes generada por un LLM aparte (qwen3.5:4b, sin thinking). El primer pendiente es la instrucción del paso. |
| 6 | Herramienta fallida | Deja de ofrecerse en el paso solo si falló con los mismos argumentos. |
| 7 | Eval | Fuera de este plan; ver `PENDIENTES_FUERA_DE_FLUJO.md`. |
| 8 | Tablas de preguntas de d3 | Las define el eval; agregar una pregunta debe ser simple. |
| 9 | Prompts | Inyectables en `Decision20Engine` y `QwenEngine` (constructor, con el de producción por defecto) y en `stageRequests`. |
| 10 | Ids de etapa | Una sola lista en `src`, con tipo derivado; la traza y el eval la importan. Los ids son los de la traza. |

## Pasos (en este orden)

### 1. Limpieza de código huérfano y duplicados — HECHO
Eliminados `BUDGET.planRegenerationRetries`, `MAX_SCRATCHPAD_RESULTS`, `StepRoute`, el re-export de `Attempt` y el tipo `Attempt` con su archivo `types/execution.ts` (nadie más lo usaba). `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` salieron de `types/limits.ts`: `qwen.ts` y `stageRequests.ts` leen `BUDGET.maxSteps` y `BUDGET.invalidResponseRetries`. `tsc --noEmit` sin errores.

### 2. `ask_user` — HECHO
Implementado: `BUDGET.maxQuestionsPerStep` (1); `ctx.canAsk` se reemplazó por `ctx.questionsAsked(stepId)` y la regla vive en `canAskUser` (`retries.ts`); `ask_user` salió de los tipos, prompts y entradas de D1 y D2; `runStep` pregunta tras `info_missing` y ante el tope de llamadas. `tsc --noEmit` sin errores.
- Quitar `ask_user` de las opciones de D1 y D2: `allowAsk` en `buildRouteChoice`/`buildToolChoice`, el parámetro de `toolInput` y `CallOutcome.ask_user` (`runCall` ya no devuelve ese resultado).
- Se pregunta solo en dos casos, ambos en `runStep`:
  - La llamada se registra con `status = info_missing` (D3): se pregunta directo, sin volver a D1.
  - El paso llegaría al tope de llamadas (hoy `failStep("call_cap")`): se pregunta antes de fallar. "Atasco" = tope de llamadas. Con el tope en 50 casi no se dispara; el disparador real es `info_missing`.
- Tope de una pregunta por paso: `canAsk` usa `questionsAsked` (hoy privada en `derive.ts`) y deja de basarse en "respuesta posterior a la última llamada".
- La respuesta sigue entrando como hecho `answer_<paso>_<n>`; no cambia. El prompt de `ask` ya cubre el caso "la revisión paró por falta de información".

### 3. Herramienta fallida en el paso — HECHO
Implementado: `failedRepeatTools(calls, stepId)` en `ctx/derive.ts`, expuesto como `ctx.failedRepeatTools(stepId)`; `usableTools` y `availableRoutes` reciben el `stepId` y filtran. `tsc --noEmit` sin errores.
- Regla derivable del contexto: en el paso hay una llamada `loop_blocked` de la herramienta T cuya llamada ejecutada idéntica anterior (misma herramienta y firma, `isRepeat` mira toda la tarea) falló. Desde entonces T no se ofrece en ese paso.
- Se aplica en `usableTools` (`callRunner.ts`), que usan tanto `availableRoutes` como `discoverTools`. Una ruta sin herramientas utilizables sale de las opciones de D1; sin ninguna, el paso falla por `no_tools`.
- La firma solo existe tras generar los argumentos, así que la exclusión no evita esa consulta: cuesta como máximo una consulta de argumentos desperdiciada por herramienta y paso.
- Con argumentos distintos, la herramienta sigue disponible.
- Es una excepción a la regla documentada "la herramienta fallida no se bloquea".

### 4. Reactivo con lista de pendientes — HECHO
Implementado, con estas diferencias respecto del texto de abajo:
- El tope de tokens de `pending` está en `BUDGET.pending.maxTokens` (como `BUDGET.ask`), no en `qwenMaxTokens`: no se tocaron `config.ts`, `jarvis-config.json` ni `ui/types/api.ts`.
- El paso reactivo exige `instruction` (no solo la permite); `planId`, `route` y `expected` siguen en `null`.
- Los campos `request` de `RouteView`, `ArgsView`, `ReviewView`, `DecisionFrame` y `ReviewDecisionInput` se eliminaron (quedaban siempre `null`); `render/args.ts` y `prompts.ts` se tocaron solo para quitar esa línea. `forAsk` conserva `request` (línea GOAL) además del paso.
- La rama `source: "request"` del criterio de D4 se eliminó aquí (estaba prevista en el paso 7).
- Código nuevo: `engine/pending.ts` (`generatePending`), `ctx/views/pending.ts` (`forPending`), `render/pending.ts`, `generatePendingFromView` (interfaz, `qwen.ts`, `capture.ts`), `pendingStageRequest` y `PROMPTS.PENDING_VIEW` (texto provisorio).
- `FIN` y `ASK_USER` quedaron sin uso en `src`; solo el eval los importa (ver `PENDIENTES_FUERA_DE_FLUJO.md`).
- `tsc --noEmit` sin errores; no se corrió el flujo real.

Detalle original:
- **Dónde vive:** la lista completa es una variable local del bucle reactivo (engine). En el ctx solo entra el primer pendiente, como `instruction` del paso.
- **ctx:** relajar en `checkStepInput` solo la regla del modo reactivo: `instruction` puede ser no nula; `planId`, `route` y `expected` siguen en `null`. No se agregan campos.
- **Vista nueva `forPending`:** aditiva. Recibe la lista anterior como parámetro. Entrada: solicitud, lista anterior, llamadas aprobadas (args y `summary` recortado), fallos del paso anterior con su razón, respuestas del usuario, efectos.
- **Cuándo:** al inicio de cada vuelta de `runReactive`, después del chequeo de `max_steps` y antes de `runStep`. La semilla reactiva de `runStep` pasa a llevar la instrucción, que se escribe al crear el paso ([stepLoop.ts:53](../src/core/engine/stepLoop.ts)).
- **Un paso reactivo sigue siendo una llamada aprobada** (`runStep` devuelve `completed` con la primera aprobada), por eso la lista se regenera en cada vuelta.
- **Vistas de D1, D2, args, D3 y D4:** en reactivo se comportan como en deliberativo: `request = null` y `step` con la instrucción. No se tocan `render/` ni los prompts (ya aceptan "Request:" y "Step:", y D4 ya tiene el criterio por instrucción).
- **Intentos de D1 y D2:** en reactivo, solo los del paso actual (como en deliberativo). Se eliminan las ramas `reactive` de `buildRouteView`. Los fallos de pasos anteriores los ve solo el generador de la lista; el anti-bucle sigue siendo de toda la tarea. Si el generador repite la instrucción tras un fallo, D1 y D2 no recuerdan ese fallo; lo acotan las 2 escalaciones.
- **`fin`:** sale del flujo de paso. Se eliminan `FIN` y `allowFin` en D1, `StepOutcome.fin` y el caso `fin` de `runDeliberative`. En reactivo D1 queda solo con rutas (con una sola ruta, sin consulta). El cierre pasa a `runReactive`, antes de crear el paso, así que ya no queda un paso vacío por `fin`.
- **Formato de salida:** lista completa nueva (medido: 10/15 contra 7/15 de la alternativa por índices).
- **Lista vacía** (`canFinish()` decide el cierre):
  - Sin llamadas (primera vuelta): un reintento; si vuelve vacía se acepta y la tarea cierra `completed` sin llamadas (solicitudes conversacionales).
  - Con una llamada aprobada: se acepta y cierra `completed`.
  - Con una `user_rejected` y ninguna aprobada: se acepta y cierra `no_alternatives`.
  - Solo fallos (`canFinish()` da `null`): no se acepta; un reintento y, si persiste, la solicitud entera como instrucción de ese paso.
- **Salida inválida:** un reintento y luego `service_unavailable` (mismo camino que d3: `queryModel` y `closeOnFailure`).
- **Consulta nueva al modelo generativo (`pending`).** "Etapa" aquí es una consulta a un modelo, como `args`, `question` o `final`; no tiene relación con el plan del modo deliberativo. Hace falta, en `src`:
  - Un método en la interfaz del LLM del engine (`EngineLLM`, `deps.ts`), como `generateQuestion`, y su implementación en `qwen.ts` (con validación de la lista).
  - El wrapper de traza en `capture.ts` (se agrega `pending` a `CaptureStage`; el paso 6 lo pasa a la lista única).
  - `pendingStageRequest` en `stageRequests.ts` y el prompt en `prompts.ts`.
  - Thinking apagado y un tope de tokens propio: `qwenMaxTokens.pending`, en `config.ts`, `jarvis-config.json` y `ui/types/api.ts`.
- **Traza:** etapa `pending` en `models`, con `input` y `output` como las demás.
- **Prompt:** lo ajusta el usuario; no se diseña acá (se deja un texto provisorio).

### 5. Topes altos — HECHO
Aplicado en `BUDGET` (`maxSteps` 100, `maxReplans` 10, `maxCallsPerStep` 50; `maxEscalations` sigue en 2) y comentarios actualizados.
- En `BUDGET`: pasos 100, replans 10, llamadas por paso 50.
- El planificador recibe `BUDGET.maxSteps - completed` y lo muestra en el prompt ("MAX_STEPS: 100"); un plan podría salir mucho más largo. El límite de ejecución y el de planificación son hoy el mismo número.
- Actualizar los comentarios con los números viejos (15, 16 y 8) en `runTask.ts`, `stepLoop.ts` y `prompts.ts` (comentario de `buildArgsReview`).

### 6. Preparación para el eval — HECHO
Implementado: `PromptSet` (en `stageRequests.ts`) y el parámetro `prompts` con default en las cinco funciones de `stageRequests`; `QwenEngine` y `Decision20Engine` reciben los prompts por constructor; `types/stages.ts` con `STAGES`, `StageId`, `STAGE_KIND` y `StageKind`; `CaptureStage` se eliminó (capture y recorder usan `StageId`); el recorder deja `step = null` en la etapa `pending`. `tsc --noEmit` sin errores.

**6a. Prompts inyectables.**
- `Decision20Engine` recibe el conjunto de prompts de decisión en el constructor (por defecto `DECISION_PROMPTS`) y usa `this.prompts` donde hoy lee la constante global.
- `QwenEngine` recibe el conjunto generativo (por defecto `PROMPTS`) y lo pasa a `stageRequests`.
- Las funciones de `stageRequests.ts` reciben un parámetro final `prompts` con default. El tipo `PromptSet` es la versión ensanchada de `typeof PROMPTS` (con `as const` un texto distinto no compila); definición en `plan_prompts_enteros.md`, 4.1.
- `server.ts` no cambia: usa los defaults. Comportamiento de producción intacto.

**6b. Ids de etapa en una sola lista.**
- Archivo `src/core/types/stages.ts`, exportado por el barril: `STAGES` como tupla `as const` (`route`, `tool`, `review`, `verify`, `args`, `question`, `plan`, `final`, `pending`) y `StageId` derivado de ella (`(typeof STAGES)[number]`).
- `STAGE_KIND` con `satisfies Record<StageId, "decision" | "generative">`: agregar una etapa sin clasificarla no compila.
- `CaptureStage` pasa a ser `StageId`; `capture.ts`, el registrador de traza y la UI importan de ahí. No quedan listas paralelas de nombres en `src`.
- Los ids son los de la traza; el eval los adopta cuando se toque (ver `PENDIENTES_FUERA_DE_FLUJO.md`).

### 7. Preguntas de D3 y D4 (`jarvis-revision-d3.md`) — HECHO
Implementado: `VERIFY_CHECKS`, `VerifyCheckKey` y `VerifyDecision` en `engine/deps.ts`; `verifyResult` devuelve `answers` (probabilidades por pregunta) y `runVerification` desapareció; `StepVerificationResult` se eliminó; `verdictOf(answers)` y `NOUL_APPROVE` viven en `engine/verify.ts`; `VERIFY_QUESTIONS` y `REVIEW_OPTIONS` en `prompts.ts`, tipadas contra las tablas, y los constructores las recorren. Mismo orden y mismos textos que antes. `eval/core/contract.ts` reexporta `NOUL_APPROVE` desde `engine/verify.ts`. `tsc --noEmit` sin errores.
- P1: `VERIFY_CHECKS` para D4, `verifyResult` devuelve `answers`, `verdictOf(answers)` en `engine/verify.ts` (con `NOUL_APPROVE` movido ahí).
- P2: tabla de opciones de D3 en `prompts.ts`.
- `answers` en D1–D3 solo cuando el eval lo pida.
- Efecto de los pasos 2 y 4 sobre este paso:
  - D4: el criterio de `forVerify` es siempre el paso. Ya quedó hecho en el paso 4: `cumple` tiene dos variantes (paso con y sin `expected`).
  - D1 en deliberativo queda con una sola opción (la ruta del paso) y toma el atajo sin consulta; D2 con una sola herramienta también (`allowAsk` desaparece).
  - La opción `info_missing` de D3 pasa a disparar la pregunta en `runStep`; la tabla de opciones debe dejarlo explícito.

### 8. Eval
Fuera de este plan. Todo lo del eval (quitar comparación de modelos y los flags `--llm-model`/`--d-model`, prompts enteros, etapa `pending`, nombres de etapa) está en `PENDIENTES_FUERA_DE_FLUJO.md`. Lo único que el flujo le exige al eval es que `forPending` reciba la lista anterior como parámetro, para poder ejecutarse por separado.

## Ajuste posterior a las pruebas reales
- Tope de rechazos de la revisión por paso: `BUDGET.maxReviewRejectionsPerStep` (2, es decir un reintento). Al segundo `tool_rejected` o `args_invalid` en el mismo paso, `runStep` lo falla con la causa `review_rejected`; la escalación (reactivo) o el replan (deliberativo) reencauzan. Motivo: el anti-bucle solo compara llamadas ejecutadas, así que un candidato idéntico rechazado se repetía hasta el tope de 50 llamadas. Archivos: `budget.ts`, `engine/retries.ts`, `engine/outcomes.ts`, `engine/stepLoop.ts`.

## Verificado contra el código
- `canFinish()` ([closure.ts:34](../src/core/ctx/closure.ts)): `completed` sin llamadas o con alguna aprobada; `no_alternatives` solo con una `user_rejected` y ninguna aprobada; `null` con llamadas, ninguna aprobada ni `user_rejected`.
- `recentFailures` filtra por el paso actual en `forArgs` y `forReview` (bloque FAIL). `forRoute` reactivo usa hoy los intentos de toda la tarea; el plan lo pasa a por paso.
- `isRepeat` es de toda la tarea.
- Los motores se crean sin parámetros en `server.ts` (líneas 67-68); `EngineDeps` ya inyecta `decision`, `llm`, `discovery`, `vault` y `sink`.

## Riesgos conocidos
- El 4b puede descartar un pendiente en silencio y producir un `fin` prematuro. Se mide en las trazas. En la primera vuelta una lista vacía se acepta (tras un reintento), así que una tarea con acciones puede cerrar sin hacer nada.
- Si el generador repite la instrucción tras un fallo, D1 y D2 no ven el fallo (intentos por paso). Lo acotan las 2 escalaciones y el anti-bucle.
- El reactivo se parece al deliberativo; lo que lo distingue es que la lista se regenera y se adapta en cada vuelta, sin confirmación ni ruta por paso.
- Que D1 deje de tener sesgo léxico con la instrucción corta no está probado.

## Fuera de alcance
Todo lo listado en `PENDIENTES_FUERA_DE_FLUJO.md` (d3, prompts, configuración, eval no ligado al flujo).
