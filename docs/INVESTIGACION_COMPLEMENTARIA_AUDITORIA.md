# Investigación Complementaria de la Auditoría de JARVIS

**Documento Técnico Independiente y Verificación de Código Fuente**  
**Fecha de Actualización:** 23 de octubre de 2026  
**Referencia:** Código fuente del repositorio y Documento de Plan de Arquitectura Objetivo (`FAST y PLAN`)  
**Estado:** Verificado contra la implementación actual (Solo Lectura)

---

## 1. Objetivo y Alcance

### 1.1. Propósito
Documentar de forma exhaustiva los hallazgos técnicos derivados de la auditoría independiente del código fuente de JARVIS, incorporar las correcciones de inconsistencias documentales y contrastar el comportamiento actual del sistema frente al plan de arquitectura unificado para los modos `FAST` y `PLAN`.

Este informe delimita con precisión empírica los hechos comprobados en el código, las inconsistencias confirmadas frente al diseño objetivo y las decisiones de arquitectura pendientes de resolución por parte del usuario.

### 1.2. Reglas Metodológicas Aplicadas
- **Fuente de verdad empírica:** El código fuente en `src/`, `server.ts` y configuraciones es la única referencia del comportamiento real del sistema.
- **Referencia de arquitectura objetivo:** El plan acordado para la unificación de `FAST` y `PLAN` actúa como especificación de diseño deseado.
- **Trazabilidad estricta:** Toda conclusión técnica se respalda con la ruta de archivo, identificador de símbolo y rango exacto de líneas verificado.
- **Separación categórica:** Se diferencian taxativamente los hechos comprobados y las inconsistencias de código respecto de las decisiones de diseño pendientes.

---

## 2. Hallazgos Detallados por Tema

### 2.1. Verificación y Clasificación de Fallos en Eos (Decision #3)

#### Aclaración de Diseño Objetivo
En la arquitectura objetivo, Decision #3 (Eos) asume en una **única inferencia combinada** la doble responsabilidad de evaluar si el paso cumplió su instrucción y, en caso negativo, clasificar la tipología del fallo. El runtime debe consumir directamente el tipo de fallo de la respuesta de Eos, evitando latencias redundantes y prescindiendo de un segundo modelo clasificador en el camino crítico.

#### Comportamiento Existente Comprobado en el Código
1. **Construcción de preguntas en Eos (`src/core/reasoner/prompts.ts`, líneas 494–522):**  
   El método `DECISION_PROMPTS.buildStepVerification` genera únicamente **dos preguntas binarias de tipo `noul`**:
   ```typescript
   questions: {
     ok: {
       type: "noul",
       instructions: "Does the result contain usable data (not empty and not an error message)?",
     },
     cumple: {
       type: "noul",
       instructions: "Does the result accomplish the step instruction?",
     },
   }
   ```
   **Hecho comprobado:** En el código actual **no existe ninguna pregunta de clasificación de fallos** (`failure_type` o similar) dirigida a Eos en ningún módulo del sistema.
2. **Evaluación de la respuesta en el cliente HTTP (`src/core/decision.ts`, líneas 198–238):**  
   `Decision20Engine.evaluateStepVerification` solo extrae y valida probabilísticamente las respuestas asociadas a las claves `ok` y `cumple` frente al umbral `NOUL_APPROVE = 0.5`:
   ```typescript
   const ok = okProbability > NOUL_APPROVE;
   const cumple = cumpleProbability > NOUL_APPROVE;
   return { ok, cumple, okProbability, cumpleProbability, rawInput: response.rawInput, rawOutput: response.rawOutput };
   ```
3. **Resolución de fallos y segundo juez (`src/core/callExecutor.ts`, líneas 406–460):**  
   - La condición de éxito técnico es: `eosPassed = verificationDetail.ok && verificationDetail.cumple` (línea 423).
   - Si `eosPassed` es falso en modo `PLAN`, el código actual delega la verificación semántica y la clasificación en Qwen 3.5 mediante `deps.qwenEngine.verifyStage` (línea 434).
   - `verifyStage` (`src/core/reasoner/qwen.ts`, líneas 699–740; `prompts.ts`, líneas 317–332) clasifica la etapa en una de 4 categorías textuales:
     `"completed" | "recoverable_deviation" | "insufficient_info" | "unrecoverable_blocked"`.
   - En modo `FAST`, si Eos rechaza el paso, no se realiza ninguna clasificación estructurada: el sistema compone una cadena informativa `failReason` y devuelve `status: "logical_error"` (`callExecutor.ts`, líneas 470–482 y 585).

#### Inconsistencia Confirmada
Existe una discrepancia directa entre el código actual y el diseño objetivo:
- **En el código:** Eos solo evalúa si el resultado es usable y cumplió la instrucción (`ok`, `cumple`). La clasificación estructurada del fallo recae en Qwen (`verifyStage`) exclusivamente en modo `PLAN`, mientras que FAST carece de tipificación estructurada.
- **En el diseño objetivo:** La clasificación de fallos se centraliza en Decision #3 (Eos) para ambos modos (`FAST` y `PLAN`), incorporando la pregunta estructurada de tipo `choice` (`failure_type`) enviada en la misma inferencia. Si `cumple` resulta falso, el runtime adopta directamente el tipo de fallo clasificado por Eos.

---

### 2.2. Rechazos de Guard, Replanificación y Garantía del Límite `MAX_REPLAN`

#### Aclaración de Diseño Objetivo
Un rechazo de la compuerta de seguridad Guard o la denegación expresa del usuario en modo PLAN no debe clausurar la tarea de forma irreversible si la necesidad puede resolverse mediante una ruta alternativa autorizada. El diseño autoriza la replanificación controlada ante rechazos, garantizando que ninguna acción eluda los controles de autorización y que el ciclo de replanificaciones esté acotado por un límite estricto (`MAX_REPLAN = 2`).

#### Comportamiento Existente Comprobado en el Código
1. **Generación de la señal `denied` (`src/core/callExecutor.ts`, líneas 301–347):**  
   - **Caso DENY automático:** Si los argumentos coinciden con patrones destructivos del SO (`Guard.evaluate` retorna `"DENY"`, líneas 304–311), el paso pasa a `step.state = "BLOCKED"`, se registra en memoria negativa (`addFailEntry`) y en `calls`, y `runStep` retorna `{ status: "logical_error", step, error: step.error, signals: { denied: true } }`.
   - **Caso Denegación Interactiva:** Si la herramienta requiere aprobación (`"APPROVAL"`) y el usuario la deniega (`!approved`, líneas 331–341), el paso pasa a `step.state = "BLOCKED"` y se retorna el mismo resultado con `signals: { denied: true }`.
2. **Tratamiento en el bucle FAST (`src/core/modeEngines.ts`, líneas 228–233 y 537–544):**  
   Cuando `runFastLoop` recibe un error con `signals.denied`, invoca `handleEscalation`. Esta función verifica explícitamente:
   ```typescript
   if (execResult.signals?.denied) {
     console.warn(`[Escalation] Acción denegada por Guard o usuario (denied). Prohibido reintentar o conmutar para eludir seguridad.`);
     await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
     return false;
   }
   ```
   **Hecho comprobado:** En FAST, la denegación concluye inmediatamente la tarea como `FAILED` o `PARTIAL`.
3. **Tratamiento en el bucle PLAN (`src/core/modeEngines.ts`, líneas 668–672):**  
   En `runPlanLoop`, tras ejecutar `runStep`, el código aplica la siguiente compuerta terminal:
   ```typescript
   if (execResult.signals?.denied || (step.state as StepState) === "BLOCKED") {
     console.warn(`[PLAN] Acción denegada por Guard o usuario. Prohibido replanificar para eludir denegación.`);
     await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
     return;
   }
   ```
   **Inconsistencia confirmada:** El código actual en `modeEngines.ts` (líneas 668–672) **aborta tajantemente la tarea ante cualquier denegación de Guard o del usuario**, impidiendo que se invoque `handleReplan`.

#### Análisis de Seguridad y Control de Bucles
1. **¿Permitir la replanificación tras un rechazo elude la autorización?**  
   - **Hecho comprobado: No.** Ninguna herramienta MCP puede ejecutarse sin atravesar `runStep` (`src/core/callExecutor.ts`, línea 301).
   - `Guard.evaluate` (`src/core/policy/guard.ts`, líneas 29–56) es un evaluador estático, determinista y **estrictamente sin estado**. No posee caché de aprobaciones, listas blancas dinámicas ni autorizaciones heredadas.
   - Cualquier acción propuesta en una etapa replanificada se evaluará desde cero en `Guard.evaluate` antes del despacho (`callTool`). Si requiere confirmación, volverá a solicitarla al usuario de forma obligatoria.
2. **Mecanismo real de prevención de repetición (Aclaración sobre Anti-loop):**  
   - En `src/core/callExecutor.ts` (líneas 282–284 y 352), la firma `loopSignature` **solo se registra en `context.executedSignatures` en el paso 7, justo antes del despacho al servidor MCP**.
   - Como las acciones denegadas por Guard o rechazadas por el usuario se interrumpen en el paso 6 (líneas 310 y 340), **dichas llamadas no ingresan a `executedSignatures`**.
   - Por tanto, la protección contra la insistencia en acciones no autorizadas **no depende del filtro anti-loop**, sino de la combinación de la **evaluación stateless de `Guard`** y la cota estricta del contador **`MAX_REPLAN = 2`**.

#### Verificación Integral del Ciclo de Vida de `MAX_REPLAN`
Se rastreó exhaustivamente la definición, inicialización y consumo del contador:
- **Definición:** `export const MAX_REPLAN = 2;` (`src/core/types.ts`, línea 353).
- **Inicialización:** `replans: 0` al crear la tarea en `src/core/core.ts` (línea 170).
- **Validación e incremento:** En `handleReplan` (`src/core/modeEngines.ts`, líneas 298–304):
  ```typescript
  if ((task.replans || 0) >= MAX_REPLAN) {
    console.warn(`[PLAN] MAX_REPLAN (${MAX_REPLAN}) alcanzado.`);
    await concludeTask(context, resolveFailureState(task), deps, "Límite de replanificaciones alcanzado.");
    return false;
  }
  task.replans = (task.replans || 0) + 1;
  ```
- **Monotonía e invarianza:** `task.replans` **únicamente se incrementa** en la línea 304 de `modeEngines.ts`. No existe ningún método, endpoint (`jarvisRouter.ts`) o condición en todo el código base que lo decremente, lo reinicie o lo elimine.
- **Comportamiento ante sucesivos fallos:**
  - **1ª Replanificación:** `task.replans` pasa de `0` a `1`. Se genera el nuevo plan para etapas pendientes y la ejecución continúa.
  - **2ª Replanificación:** `task.replans` pasa de `1` a `2`. Se genera la segunda reformulación y la ejecución continúa.
  - **3er Intento de Replanificación:** La condición `(task.replans >= MAX_REPLAN)` evalúa `2 >= 2` (**TRUE**). Se emite advertencia, se concluye la tarea con `concludeTask` en estado terminal (`PARTIAL` o `FAILED`) y se retorna `false`, cerrando de forma definitiva el bucle de `runPlanLoop`.
- **Diferenciación con `modifyPlan` (`src/core/core.ts`, líneas 239–290):**  
  `modifyPlan` permite ajustar el borrador inicial a partir del feedback del usuario sin alterar `task.replans`. Esta función solo opera en el estado previo a la ejecución (`isAwaitingPlanConfirmation`: `state === "WAITING_INPUT"` y `waitingReason === "plan_confirmation"`). Una vez confirmado el plan (`confirmPlan`), pasa a `RUNNING` y la única vía de reformulación es `handleReplan`, sujeta a `MAX_REPLAN = 2`.

---

### 2.3. Diferenciación de Contadores del Sistema

Para evitar confusiones conceptuales durante la implementación, se delimitan los distintos contadores y límites del núcleo:

| Concepto | Variable / Símbolo | Límite Máximo | Ámbito de Aplicación | Estado Actual en el Código |
|---|---|---|---|---|
| **Replanificación Global** | `task.replans` | `MAX_REPLAN = 2` (`types.ts:353`) | Reformulación de etapas pendientes con Qwen en modo PLAN. | **Implementado y verificado en `modeEngines.ts:298`.** |
| **Escalación de Ruta FAST** | `context.escalations` | `MAX_ESCALATIONS = 2` (`types.ts:352`) | Reselección de ruta o herramienta con Decision #1 tras un fallo en FAST. | **Implementado y verificado en `modeEngines.ts:237`.** Independiente de `task.replans`. |
| **Preguntas al Usuario** | `step.questionsAsked` | `MAX_USER_QUESTIONS_PER_STEP = 2` (`types.ts:363`) | Aclaraciones interactivas por falta de datos en una etapa (`insufficient_info`). | **Implementado y verificado en `modeEngines.ts:692`.** Si se agota, escala a `handleReplan`. |
| **Tope Global de Pasos (FAST)** | `task.stepSeq` | `MAX_STEPS = 15` (`types.ts:351`) | Cota de iteraciones reactivas en FAST. | **Implementado y verificado en `modeEngines.ts:412`.** |
| **Reintentos Locales de Etapa** | *No implementado aún* | `MAX_LOCAL_RETRIES` *(propuesto)* | Reintentos acotados dentro del motor común reactivo antes de escalar a Replan. | **Pendiente de diseño.** El código actual en PLAN salta directo a replanificar ante cualquier fallo. |

---

### 2.4. Alcance y Evidencia de la Auditoría

#### Revisión Crítica de la Cobertura del Repositorio
La inspección detallada del código base establece la siguiente categorización de los componentes:

1. **Módulos con cobertura exhaustiva demostrada:**
   - Orquestación central y ciclo de vida de tareas (`src/core/core.ts`).
   - Motores de ejecución y bucles FAST / PLAN (`src/core/modeEngines.ts`).
   - Ejecutor atómico de herramientas MCP (`src/core/callExecutor.ts`).
   - Cliente HTTP y validación de Decision 2.0 (`src/core/decision.ts`).
   - Cliente OpenAI-compatible y prompts de Qwen 3.5 (`src/core/reasoner/qwen.ts`, `prompts.ts`).
   - Transporte HTTP, reintentos y backoff de LLMs (`src/core/llmTransport.ts`).
   - Catálogo formal de herramientas y políticas (`src/core/tools/manifest.ts`).
   - Compuerta de autorización y seguridad (`src/core/policy/guard.ts`).
   - Procesamiento de resultados y resolución de referencias (`src/core/processor/resultProcessor.ts`, `refResolver.ts`).
   - Gestión de contexto episódico y memoria (`src/core/context.ts`).
   - Contratos estructurales y tipos del sistema (`src/core/types.ts`).
   - Gestor de configuración persistente (`src/core/config.ts`).
   - Enrutadores HTTP y canal SSE (`src/server/jarvisRouter.ts`, `src/server/mcpRouter.ts`, `server.ts`).
   - Registro de trazas y serialización para transporte (`src/core/taskTrace.ts`, `src/core/taskWire.ts`).
   - Hook reactivo y componente central de visualización (`ui/hooks/useJarvis.ts`, `ui/components/ProcessFlow/ProcessFlow.tsx`).
2. **Módulos no cubiertos por la auditoría (Límites Metodológicos):**
   - Transición de procesos stdio en `src/core/mcp/transport.ts`.
   - Adaptador específico de servidor `src/core/mcp/freeSearchMcp.ts` y `src/core/mcp/desktopCommanderMcp.ts`.
   - Tipos de bajo nivel de servidores MCP en `src/core/mcp/types.ts` y discovery detallado en `src/core/mcp/discovery.ts`.
   - Utilidades de detección de entorno de usuario en `src/core/environment.ts`.
   - Acumulación de métricas de depuración en `src/core/debugAccumulator.ts`.
   - Componentes UI periféricos (`ui/components/DecisionStream/*`, `ui/components/GuardBanner/*`, `ui/components/SettingsModal/*`, `ui/components/TopBar/*`, `ui/components/PromptInput/*`).
   - Módulo de laboratorio y benchmarking en `lab/*` (`evaluate.ts`, `run.ts`, `extract-cases.ts`, etc.).
3. **Alcance real de la comprobación de compilación TypeScript (`compile_applet`):**
   - **Lo que valida de manera concluyente:** Integridad tipológica y sintáctica estricta bajo `tsconfig.json` y coherencia de importaciones/exportaciones entre módulos.
   - **Lo que NO puede validar:** Disponibilidad de red de los endpoints locales (`127.0.0.1:8765`, `127.0.0.1:11434`), respuesta probabilística en tiempo real de los modelos ni ejecución de los procesos binarios de MCP sobre el sistema operativo.

---

## 3. Matriz de Estado de Hallazgos e Inconsistencias

| Identificador | Elemento Investigado | Estado Actual | Ubicación en Código | Impacto en la Migración |
|---|---|---|---|---|
| **H-01** | Eos no clasifica fallos | **Inconsistencia confirmada** | `src/core/reasoner/prompts.ts:494`<br>`src/core/decision.ts:198` | Incorporar la pregunta estructurada `failure_type` (`choice`) al payload de `buildStepVerification`. |
| **H-02** | Qwen actúa como clasificador redundante en PLAN | **Inconsistencia confirmada** | `src/core/callExecutor.ts:432`<br>`src/core/reasoner/qwen.ts:699` | Retirar `verifyStage` del flujo caliente; Eos asume la clasificación unificada del fallo. |
| **H-03** | Bloqueo absoluto de replanificación ante rechazo de Guard | **Inconsistencia confirmada** | `src/core/modeEngines.ts:668–672` | Modificar la condición terminal para permitir la llamada a `handleReplan` respetando `MAX_REPLAN`. |
| **H-04** | Invarianza del límite `MAX_REPLAN = 2` | **Confirmado** | `src/core/types.ts:353`<br>`src/core/modeEngines.ts:298` | El contador `task.replans` es monótono creciente y no puede eludirse; garantiza que tras 2 replanificaciones la tarea concluya. |
| **H-05** | Imposibilidad de eludir Guard mediante replanificación | **Confirmado** | `src/core/callExecutor.ts:301`<br>`src/core/policy/guard.ts:29` | Toda acción replanificada vuelve a evaluarse por Guard antes de despacharse; no existe elusión de seguridad. |
| **H-06** | Ausencia de reintentos locales de etapa en PLAN | **Confirmado** | `src/core/modeEngines.ts:650–726` | En el código actual, PLAN no tiene reintentos locales; cualquier fallo escala de inmediato a `handleReplan`. |
| **H-07** | Distinción anti-loop vs Guard en acciones denegadas | **Confirmado (Aclaración técnica)** | `src/core/callExecutor.ts:282, 352` | Las acciones bloqueadas no entran a `executedSignatures`; la seguridad se apoya en `Guard` stateless + `MAX_REPLAN`. |
| **H-08** | Errata documental en cita de adición de `facts` | **Corregido** | `src/core/core.ts:312`<br>`src/core/callExecutor.ts:488` | `context.ts` tiene solo 249 líneas. La persistencia ocurre en `core.ts:312` (respuestas) y `callExecutor.ts:488` (delta). |
| **H-09** | Validación estática vs. runtime de `compile_applet` | **Confirmado (Aclaración metodológica)** | `package.json:13`<br>`tsconfig.json` | La compilación valida contratos de tipos y sintaxis, no el comportamiento dinámico de los procesos locales. |

---

## 4. Correcciones Metodológicas Incorporadas

1. **Estructura de inferencia de Decision #3:**  
   Queda ratificado por especificación de diseño que la consulta a Eos es **única y combinada** (`ok` + `cumple` + `failure_type`). No constituye una decisión pendiente.
2. **Tratamiento de rechazos de Guard en modo PLAN:**  
   El diseño autoriza la **replanificación controlada** ante denegaciones de Guard o rechazos de usuario. Dado que Guard carece de estado y `MAX_REPLAN = 2` detiene de forma determinista cualquier repetición, la replanificación no vulnera las políticas de seguridad.
3. **Mecanismo de corte de repeticiones:**  
   Se subsana la imprecisión sobre el anti-loop: las llamadas bloqueadas antes del despacho no generan firma de ejecución; la detención de bucles descansa exclusivamente en `Guard.evaluate` y `MAX_REPLAN`.
4. **Referencia de adición de hechos (`facts`):**  
   Se corrige la errata que citaba la línea inexistente `context.ts:312`, precisando que la inserción se realiza en `src/core/core.ts` (línea 312) y `src/core/callExecutor.ts` (línea 488).
5. **Inventario exhaustivo del backend:**  
   Se completa el catálogo de módulos analizados incorporando los 7 archivos centrales del backend omitidos en el informe preliminar.

---

## 5. Decisiones de Arquitectura Pendientes de Definición del Usuario

Para abordar la fase de implementación sin ambigüedades, se delimitan las **3 decisiones técnicas pendientes** que no están especificadas en el plan original ni pueden derivarse automáticamente del código existente:

### Decisión 1: Esquema formal de etapas en Qwen (`suggested_mcp`)
- **Situación en el código:** `STEP_ITEM_SCHEMA` (`src/core/reasoner/qwen.ts`, líneas 69 y 72) exige obligatoriamente `suggested_mcp: { enum: [...EXECUTABLE_ROUTES] }`, y `runPlanLoop` le asigna directamente la ruta a la etapa sin consultar a Decision #1.
- **Situación en el plan:** El plan objetivo (§3 y §8) establece que el plan no fija grupos de herramientas obligatorios y que Decision #1 elige la ruta dinámicamente en tiempo de ejecución.
- **Definición requerida:**  
  ¿Se retira por completo la propiedad `suggested_mcp` del esquema JSON que genera Qwen en `PLAN` y `REPLAN`, o se preserva como una sugerencia opcional no vinculante para enriquecer el contexto del prompt de Decision #1?

### Decisión 2: Número máximo de reintentos locales por etapa (`MAX_LOCAL_RETRIES`)
- **Situación en el código:** FAST utiliza `MAX_ESCALATIONS = 2` (`modeEngines.ts:237`), mientras que PLAN salta inmediatamente a `handleReplan` ante cualquier fallo (0 reintentos locales).
- **Situación en el plan:** El plan objetivo (§5 y §9) indica que la recuperación local debe resolver fallos acotados antes de replanificar, dejando el límite exacto sujeto a definición técnica.
- **Definición requerida:**  
  ¿Se ratifica la incorporación de un contador desacoplado de **2 reintentos locales** dentro del motor común reactivo (para fallos de argumentos o técnicos transitorios) antes de escalar a la replanificación global con Qwen?

### Decisión 3: Política de hechos (`facts`) en la replanificación
- **Situación en el código:** Los `facts` son de adición acumulativa estricta (*append-only*, `core.ts:312`, `callExecutor.ts:488`) y persisten intactos en memoria a lo largo de toda la tarea, incluso a través de sucesivos replanes (`modeEngines.ts:326`).
- **Situación en el plan:** El plan objetivo (§9) marca como pendiente definir las reglas para conservar o invalidar resultados tras una replanificación.
- **Definición requerida:**  
  ¿Se mantiene la política acumulativa *append-only* permanente, o se introduce un mecanismo en el contrato de replanificación para que Qwen o el runtime puedan purgar o invalidar hechos refutados por un fallo previo?
