> **Estado: implementado.** El análisis es histórico: D1 y D2 ya no ofrecen `fin` ni `ask_user`, D4 usa `VERIFY_CHECKS` y `verdictOf(answers)`, D3 usa la tabla `REVIEW_OPTIONS`, `StepVerificationResult` y `runVerification` ya no existen y las constantes duplicadas se unificaron en `BUDGET`. Ver `PLAN_REFACTOR_FLUJO.md` (pasos 1, 2, 4, 5 y 7) y `CORE_FLOW.md`.

# Jarvis · Revisión de uso de d3 y plan de mejoras (v4)

**Objetivo:** que d3 (modelo de decisión) pueda recibir un conjunto variable de preguntas y opciones, para que el eval decida cuál combinación es la mejor. Secundario: simplificar Jarvis donde haya complejidad innecesaria.

**Fuera de alcance:** diseño concreto de preguntas/opciones (lo decide el eval), calidad de prompts, longitud de contexto, el eval en sí (se refactoriza cuando `src` esté actualizado), el límite de longitud de las descripciones de herramientas (lo gestiona el usuario).

**Este documento no cambia código:** es la entrada para el agente de proyecto.

**Marcas**
- **[V]** visto directamente en el código o confirmado por el grep del proyecto (`grep_usos_revision_d3.md`): `prompts.ts`, `deps.ts`, `adapters.ts`, `callRunner.ts`, `stepLoop.ts`, `engine/verify.ts`, `failures.ts`, `retries.ts`, `capture.ts`, `decision.ts` (core), `llmTransport.ts`, `types.ts` (raíz, solo barril), `types/decision.ts`, `config.ts`, `limits.ts`, `budget.ts`, `tools/manifest.ts`, `ctx/types.ts`, `ctx/validate.ts`, `ctx/apply.ts`, `ctx/derive.ts`, `ctx/views/types.ts`, `ctx/views/messages.ts`, `ctx/views/shared.ts`, `ctx/views/route.ts`, `ctx/views/review.ts`, `ctx/views/verify.ts`, `render/messages.ts`, `trace/recorder.ts`.
- **[H]** hipótesis: depende de un archivo no visto (`ctx/closure.ts`, el eval).

La marca **[A]** (afirmado sin ver) de la v3 ya no se usa: todo lo que tenía esa marca fue verificado.

**Aviso de nombres:** en el código, los comentarios que dicen "D3", "D4", "D15", etc. (p. ej. en `engine/verify.ts`, `llmTransport.ts`, `budget.ts`) son *decisiones de diseño* del proyecto, no las decisiones d3 de este documento. Aquí D1–D4 son las cuatro consultas al modelo (ruta, herramienta, revisión, verificación).

---

## 0. Resumen

1. **El límite de "solo `ok` y `cumple`" es de código propio, no de d3 ni de `systemOne`.** `parseResponse` itera sobre cualquier número de preguntas **[V]**. Lo que está fijo es `runVerification`, `StepVerificationResult`, `verdictOf(ok, cumple)`, el veredicto binario con dos razones cerradas y el texto literal de las preguntas **[V]** (§2).
2. **Agregar una pregunta que solo se registra ya es posible hoy en las cuatro decisiones**: se agrega en el constructor de prompts, `parseResponse` la valida y queda en `rawInput`/`rawOutput` de la traza **[V]** (§3.2). Lo que falta es poder que una pregunta *decida*.
3. **Propuesta mínima (§3):** D4 con preguntas en tabla y una regla `verdictOf(answers)`; D3 con opciones en tabla. D1 y D2 no se tocan ahora; el camino para extenderlos está descrito.
4. La versión 1 del documento tenía mucho diseño de preguntas y calibración: se retiró, lo decide el eval.
5. **Alcance verificado (v4):** los cambios de §3.1 (D4) y §3.3 (D3) tienen todos sus archivos afectados vistos y los usos del proyecto relevados. El único contacto con el eval es `NOUL_APPROVE` (§3.1, punto 7).

---

## 1. Mapa de llamadas a d3

Todas salen por `Decision20Engine.systemOne` → `POST {decisionUrl}/v1/systemone` con `{ model, state, questions }` **[V]**. `questions` es `clave → { type, instructions, criteria? }` **[V]**.

**Flujo [V]:** `runStep` (`stepLoop.ts`) llama **D1** en cada vuelta, en ambos modos. Si D1 da una ruta, `runCall` hace: descubrir → **D2** → argumentos (LLM) → refs → `sig`/anti-loop → Guard → **D3** → confirmación → despacho → procesar → registrar → **D4** (`verifyCall`).

| # | Método | Clave | Tipo | Opciones | Texto real |
|---|---|---|---|---|---|
| D1 | `chooseRoute` → `buildRouteChoice` | `route` | `choice` | Rutas con herramienta usable + `fin` (solo reactivo y si `canFinish()` no es `null`) + `ask_user` (si `canAsk`) | Rutas: `DESTINATIONS[ruta].description`, con sufijo ` [the last attempt on this route failed]` si falló. `fin`: dos textos según haya progreso. `ask_user`: `ASK_USER_DESCRIPTION` **[V]** |
| D2 | `chooseTool` → `buildToolChoice` | `selected_tool` | `choice` | Herramientas usables de la ruta + `ask_user` (si `allowAsk`) | `shortDesc(description)`: primera oración, recortada a `MAX_TOOL_DESC_CHARS`; sufijo ` [last attempt failed]` **[V]** |
| D3 | `reviewArgs` → `buildArgsReview` | `review` | `choice` | `approved`, `args_invalid`, `info_missing` (`tool_rejected` se quitó el 2026-11-07: ver `conclusiones.md`) | Literales en `buildArgsReview` **[V]** |
| D4 | `verifyResult` → `buildResultVerification` | `ok`, `cumple` | `noul` ×2 | — | Literales en `buildResultVerification`; el texto de `cumple` depende del criterio (solicitud / paso con `expected` / paso sin `expected`) **[V]** |

**Contenido del `state`** (armado en `adapters.ts` a partir de las vistas `ctx/views/*`, saneado y recortado con `BUDGET.caps`) **[V]**:
- D1/D2 (`forRoute`): solicitud (reactivo) o paso (deliberativo), último resultado, hechas, intentos no aprobados, entrada del usuario, entorno; D2 agrega `Route` y filtra los intentos a esa ruta.
- D3 (`forReview`): solicitud/paso, pasos hechos, hechas, fallos del paso, entrada del usuario, entorno, últimas lecturas (`<obs>`), llamada candidata (ruta/herramienta, descripción, schema, args).
- D4 (`forVerify`): criterio (solicitud o paso+esperado), hechas, entrada del usuario, llamada evaluada (`<obs>`: cabecera, args, resumen, ref).

**Atajos sin consulta [V]:**
- D1 con una sola opción (`chooseRoute`); D2 con una sola herramienta y sin `ask_user` (`chooseTool`). En esos casos las preguntas extra tampoco se harían.
- D4 no se consulta con `tool_error`/`exception` (se rechaza con `no_usable_data`) ni con `interrupted`/`denied` (sin veredicto). `no_data` y `not_found` sí se consultan.

**Hechos del flujo [V] que afectan al costo:**
- En deliberativo, D1 también corre en cada vuelta: `allowFin` es falso, pero `allowAsk` es verdadero al empezar el paso, así que hay 2 opciones (ruta del plan vs `ask_user`) y sí se consulta al modelo.
- Una llamada puede costar D1 + D2 + D3 + D4 + 1 llamada al LLM de argumentos. El tope es `BUDGET.maxCallsPerStep` (8), y `callsInStep` (`ctx/derive.ts`) cuenta toda llamada del paso salvo `user_rejected`, incluidas las no ejecutadas.

**Visibilidad de lo enviado [V]:** `captureDecision` (`capture.ts`) envuelve las cuatro decisiones (`route`, `tool`, `review`, `verify`) y `recorder.ts` guarda `input`/`output` crudos de cada una en `jarvis-traces.jsonl`. El payload completo que se envía a d3 está ahí, así que **no hace falta ningún flag `DECISION_DEBUG`**. El log de consola `[Decision → SEND]` corta a 200 caracteres pero no afecta a la traza.

---

## 2. Qué impide hoy variar preguntas y opciones

El límite está en código propio. `parseResponse` valida cualquier conjunto de preguntas **[V]**.

| Decisión | Estado actual | Qué lo impide |
|---|---|---|
| **D1** | Opciones dinámicas (`criteria` desde `data.routes`) **[V]** | `chooseRoute` lee solo `questions.route` y devuelve **una acción** (`route`/`fin`/`ask_user`). Una pregunta extra puede agregarse y registrarse, pero no puede cambiar la acción. |
| **D2** | Opciones dinámicas **[V]** | Igual: una pregunta, una acción. |
| **D3** | 4 opciones, literal en `buildArgsReview` **[V]** | `ARGS_REVIEWS` (`deps.ts`) está acoplado a `CallStatus`: `runCall` hace `const status: CallStatus = review.value.review` y lo registra como `status` **[V]**. Una opción de rechazo nueva exige un status nuevo en `NOT_EXECUTED_CALL_STATUSES` (`ctx/types.ts`), en `STATUS_NOTES` (`ctx/views/messages.ts`, mapa exhaustivo: el compilador lo obliga) y, si corresponde, en `ARGS_SHOWN_STATUSES` **[V]**. `checkCallInput` valida `status` contra `CALL_STATUSES`, así que ahí se propaga solo **[V]**. `ctx/apply.ts` solo propaga el status (`checkCallInput`, `assertVerifiable`) y `ctx/derive.ts` no tiene lista propia que haya que ampliar: un status no ejecutado cuenta como fallo (`status !== "ok"`), como intento (no aprobado) y como llamada del paso (`callsInStep`), y queda fuera de `isExecuted`, es decir, no entra en el anti-loop **[V]**. Lo único sin ver es `ctx/closure.ts` (`isEffect`, `canFinish`, `hasApprovedCall`) **[H]**. |
| **D4** | 2 preguntas, literal en `buildResultVerification` **[V]** | (a) `StepVerificationResult` (`types/decision.ts`) tiene campos fijos `ok`, `cumple`, `okProbability`, `cumpleProbability` **[V]**. (b) `runVerification` (`decision.ts`) lee solo `ok` y `cumple` con `NOUL_APPROVE` (> 0.5 estricto) **[V]**. (c) `verdictOf(ok, cumple)` en `engine/verify.ts`: falla `ok` → `no_usable_data`; falla solo `cumple` → `not_accomplished` **[V]**. (d) `CALL_VERDICTS` binario y `VERDICT_REASONS` con 2 valores; `checkCallPatch` exige razón con `rejected` y `null` con `approved`; `REASON_NOTES` exhaustivo **[V]**. |

**`noul` con `criteria` [V]:** `DecisionQuestionNoul` admite `criteria: { true, false }` (opcional): qué significa responder sí y no. Lo usa solo el eval por ahora (`eval/core/d4_checks.ts`); las preguntas de producción no lo llevan.

**Trampa en `parseResponse` [V]:** el código es `if (question.type === "choice") {...} else {...}`; todo lo que no es `choice` se valida como `noul` sin avisar. Si algún día se agrega otro tipo de pregunta (p. ej. `score`), pasaría por la rama `noul`. La cabecera de `decision.ts` ya dice que `score` no se implementa, así que hoy no es un bug; basta un `switch` exhaustivo si se agrega un tipo.

**Riesgos de agregar preguntas [V]:**
- Si el modelo omite una pregunta o responde fuera de rango, `parseResponse` lanza `DecisionValidationError` (inválida); `queryModel` repite una vez (`BUDGET.invalidResponseRetries`) y, si persiste, `closeOnFailure` registra `service_unavailable` y la tarea cierra `unrecoverable`. Más preguntas por consulta = más posibilidades de ese cierre.
- `decisionTimeoutMs` por defecto es 30000. Es un presupuesto total que incluye el reintento de transporte: `llmTransport.ts` reintenta una vez tras 1 s ante fallo de red o HTTP 503, y **nunca** ante timeout ni cancelación. Un timeout o una red persistente se convierte en `DecisionServiceUnavailableError` y también cierra la tarea. Más preguntas = más latencia contra el mismo presupuesto.
- Contexto: `decisionMaxContext` por defecto es 16384; un desborde cierra con `unrecoverable` sin repetir (`overflow`). No se valida ahora.

---

## 3. Propuesta mínima

Principio: no tocar `ctx` ni el veredicto binario; que probar combinaciones en el eval sea editar datos y no tipos.

### 3.1 D4: verificación con preguntas variables (cambio a hacer)

1. **Vocabulario en `deps.ts`** (donde ya vive `ARGS_REVIEWS`): una tabla `VERIFY_CHECKS` de `{ key, reason }`, hoy `ok → no_usable_data` y `cumple → not_accomplished`. El orden de la tabla fija la precedencia de la razón (hoy `no_usable_data` gana).
2. **Texto de las preguntas en `prompts.ts`:** un `Record<clave, (data) => DecisionQuestionNoul>` tipado contra las claves de `VERIFY_CHECKS`, de modo que el compilador obligue a que ambas tablas coincidan (mismo patrón que `STATUS_NOTES` y `REASON_NOTES`). `buildResultVerification` arma `questions` recorriendo la tabla. El texto de `cumple` sigue dependiendo del criterio, por eso es función.
3. **`verifyResult` devuelve probabilidades por clave:** `{ answers: Record<clave, number>, rawInput, rawOutput, timing }` en lugar de `StepVerificationResult`. `runVerification` desaparece (hoy es "común" pero tiene un solo llamador, `verifyResult`, confirmado por el grep **[V]**). `decision.ts` deja de convertir a booleanos.
4. **`verdictOf(answers)` en `engine/verify.ts`** con el umbral (`NOUL_APPROVE` se mueve ahí junto con la regla): hoy aprueba si todas superan 0.5; si no, rechaza con la razón de la primera clave que falla en el orden de la tabla. Es la misma regla de hoy; la definitiva sale del eval.
5. **`ctx` no se toca:** el veredicto sigue `approved`/`rejected` y la razón es una de las dos existentes; `checkCallPatch` sigue válido y `ctx/apply.ts` solo escribe `verdict` y `reason` una vez **[V]**. El detalle por pregunta queda en la traza.
6. **Paridad:** con la tabla `[ok, cumple]` el resultado debe ser idéntico al actual antes de agregar nada.
7. **Archivos afectados y usos relevados [V, grep]:**
   - `StepVerificationResult`: solo `types/decision.ts` (definición), `engine/deps.ts` (import y firma de `verifyResult`) y `decision.ts`. El eval no lo usa.
   - `runVerification`: solo `decision.ts`. El eval la menciona en comentarios (`eval/core/variants/labels.ts:8` y `:228`), que quedarán obsoletos.
   - `NOUL_APPROVE`: definido en `decision.ts` y usado en `decision.ts`, `eval/core/contract.ts:15` (lo re-exporta desde `src/core/decision.ts`), `eval/core/questions.ts:160` y `eval/core/variants/labels.ts:260-261`. **Al moverlo a `engine/verify.ts`, el re-export de `contract.ts` deja de compilar hasta el refactor del eval**, que ya está planificado.
   - Nota para el refactor del eval: `labels.ts` reimplementa la regla de `runVerification` (`okProb > NOUL_APPROVE`, `cumpleProb > NOUL_APPROVE`). Una vez que exista `verdictOf(answers)` podría reutilizarla en lugar de duplicarla; se decide en ese refactor.
   - Archivos de `src` a cambiar: `types/decision.ts`, `core/decision.ts`, `engine/deps.ts`, `reasoner/prompts.ts`, `engine/verify.ts`.

### 3.2 D1, D2, D3: cambiar la pregunta o agregar otra

Lo que se puede hacer **hoy**, sin cambios de código fuera del constructor de prompts **[V]**:

| Qué quiero | Cómo | Cambio necesario |
|---|---|---|
| Cambiar el texto de la pregunta u opciones | Editar `instructions`/`criteria` en `buildRouteChoice`, `buildToolChoice` o `buildArgsReview` | Solo el constructor |
| Agregar una pregunta extra que **solo se registre** | Agregar la clave en `questions` del constructor. `parseResponse` la valida; queda en `rawInput`/`rawOutput` de la traza | Solo el constructor |
| Agregar una pregunta extra que **cambie la decisión** | Hace falta que la respuesta llegue a una regla | Ver abajo |

Para el tercer caso, el cambio mínimo es el mismo que en D4: el método (`chooseRoute`, `chooseTool`, `reviewArgs`) devuelve además `answers` (campo nuevo en `DecisionTrace`) y la regla que combina respuestas vive en una función única por decisión, como `verdictOf` en D4. Hoy esa regla es "la opción elegida de la pregunta principal" (`route`, `selected_tool`, `review`). **No se construye hasta que el eval lo pida**, porque agrega un campo a los tres tipos de retorno sin necesidad actual.

Dos cuidados si se hace:
- Los atajos de una sola opción (D1, D2) no consultan al modelo: no habría `answers` de preguntas extra.
- Una pregunta extra en D3 que implique un rechazo nuevo exige un status nuevo (ver §2, D3), con tres puntos de cambio: `NOT_EXECUTED_CALL_STATUSES`, `STATUS_NOTES` y, si corresponde, `ARGS_SHOWN_STATUSES`. `ctx/derive.ts` y `ctx/apply.ts` no necesitan cambios **[V]**. Una pregunta que solo informe puede mapearse a un status existente.

### 3.3 D3: opciones desde una tabla (cambio a hacer)

`ARGS_REVIEWS` ya es la lista de opciones (`deps.ts`). Se agrega en `prompts.ts` un `Record<ArgsReview, string>` con el texto de cada opción, y `buildArgsReview` lo recorre. El beneficio es el guard del compilador (una opción nueva en `ARGS_REVIEWS` sin texto no compila, y sin status válido tampoco, por la línea `const status: CallStatus = ...`). Variar solo textos ya es posible hoy; esto es orden, no capacidad.

Usos de `ARGS_REVIEWS` relevados **[V, grep]**: `decision.ts:239` (`ARGS_REVIEWS.find`) y, en el eval, `contract.ts:16` (re-export desde `engine/deps.ts`, donde sigue viviendo) y la validación de `labels.ts:218-220`. Como todos leen la misma constante, esta tabla no los afecta.

### 3.4 Pendiente de decisión del usuario

1. D1–D3: ¿agregar `answers` en `DecisionTrace` ahora, o solo cuando el eval pida que una pregunta decida? (Recomendado: cuando lo pida.)
2. **Opcional, no se hace salvo que el usuario lo pida: conservar el crudo cuando d3 responde algo inválido.** Hoy la traza queda con `input`/`output` en `null` en ese caso, porque `captureDecision` lee el crudo de `error.raw` y `DecisionValidationError` y `DecisionServiceUnavailableError` (`llmTransport.ts`) no lo llevan: `DecisionValidationError` solo tiene `overflow`. Las clases del LLM sí lo traen (`LLMValidationError.raw`, `LLMServiceUnavailableError.raw`). El cambio sería agregar un `raw?: { rawInput, rawOutput, timing? }` opcional a `DecisionValidationError` y pasarlo donde lo lanza `decision.ts`. Es justo el caso más útil para depurar con más preguntas, pero es un cambio de código fuera del objetivo.

---

## 4. Limpieza confirmada o a verificar

| # | Qué | Estado |
|---|---|---|
| S1 | Constantes duplicadas con el mismo valor: `MAX_STEPS` (`limits.ts`) = `BUDGET.maxSteps` = 15; `LLM_INVALID_OUTPUT_RETRIES` = `BUDGET.invalidResponseRetries` = 1; `MAX_SCRATCHPAD_RESULTS` = `BUDGET.extract.searchResultsShown` = 10 (el comentario de `budget.ts` dice "antes `MAX_SCRATCHPAD_RESULTS`"). `LLM_TRANSPORT_*` no es un duplicado. Falta saber quién importa cada una para decidir cuál se elimina | **[V]**; importadores sin relevar |
| S2 | Nombres: `Decision20Engine`, "Decision 2.0" en mensajes de error y comentarios de `config.ts`, etiquetas `Decision #1/#2/#3` vs `Verification`; y el choque entre las "D3/D4" de decisiones de diseño y las decisiones d3 (ver Aviso de nombres) | **[V]** |
| S3 | ~~Comentario obsoleto de `score`~~ **Descartada [V]:** la cabecera de `decision.ts` dice que el contrato define `score` pero que no se usa ni se implementa; es correcto | descartada |
| S4 | `switch` exhaustivo en `parseResponse` (§2); solo si se agrega otro tipo de pregunta | **[V]** |
| S5 | `buildDecisionRequest` tipa `config` con `ReturnType<typeof import(...)>`; usar `JarvisConfig` | **[V]** |
| S6 | `MAX_TOOL_DESC_CHARS` (80): `manifest.ts` (`def`) falla al arrancar si una descripción lo excede, así que el recorte posterior a ese valor en `shortDesc` no puede actuar, y el comentario de `limits.ts` aún dice que Decision recorta. Dejar un solo mecanismo. No toca el valor del límite, que gestiona el usuario | **[V]**; a criterio del usuario |
| S7 | `ReviewView` es exactamente `ArgsView` sin `refs` ni `effects`; derivar con `Omit`. Cambio estético | **[V]** |
| S8 | ~~Duplicación `ctx/views/messages` ↔ `render/messages`~~ **Descartada [V]:** una es inglés para modelos y la otra español para el usuario | descartada |
| S10 | `qwenMaxTokens.verify` es configuración huérfana: ninguna etapa lo lee (`stageRequests.ts` solo lee `arguments`, `final`, `plan` y `replan`). Aparece en `config.ts` (interfaz L25, comentario de `verify_stage` L34, default L75, parser L153), `jarvis-config.json:10` y `ui/types/api.ts:241`. Antes de borrarlo, confirmar con grep de `.verify` y `verify:` en `ui/` que nada más lo use | **[V, grep]** |
| S11 | `adapters.ts`: el comentario de cabecera dice que solo se usan `renderArgs` y `renderAsk`, pero importa `renderPlan` | **[V]** |
| S12 | `prompts.ts`: re-export de `Attempt` "para no romper a quien lo importa"; verificar si alguien lo importa de ahí | **[V]** + **[H]** |

---

## 5. Pendiente de verificar

Todo lo necesario para los cambios de §3.1 (D4) y §3.3 (D3) está certificado. Queda solo:
1. `ctx/closure.ts` (`isEffect`, `canFinish`, `hasApprovedCall`): únicamente si D3 llega a necesitar un status nuevo **[H]**.
2. Importadores de `MAX_STEPS`, `LLM_INVALID_OUTPUT_RETRIES`, `MAX_SCRATCHPAD_RESULTS` y `Attempt`: solo para la limpieza S1 y S12 (no bloquea nada).
3. Grep de `.verify` y `verify:` en `ui/`, antes de borrar `qwenMaxTokens.verify` (S10).
4. El eval queda fuera de alcance; sus puntos de contacto con este cambio están en §3.1, punto 7.

---

## 6. Plan priorizado

| Prioridad | Tarea | Resultado |
|---|---|---|
| ~~P0~~ | ~~Búsqueda de usos y revisión de `llmTransport.ts`~~ | Hecho en v4 (§3.1 punto 7, §2 riesgos, §3.4) |
| **P1** | D4: tablas `VERIFY_CHECKS` + preguntas, `verifyResult` con `answers`, `verdictOf(answers)` con `NOUL_APPROVE` incluido, con paridad `[ok, cumple]` | Mismo comportamiento, preguntas variables |
| **P2** | D3: tabla de opciones en `prompts.ts` | Guard del compilador al variar opciones |
| **P3** | Correr el eval con combinaciones; si una pregunta de D1/D2/D3 debe decidir, `answers` + regla (§3.2); si D3 necesita un rechazo nuevo, status nuevo (tres puntos de cambio, §3.2) | Cambios de tipo solo si se justifican |
| **P4** | Limpieza §4 (S1, S2, S5–S7, S10–S12) | Menos deuda |