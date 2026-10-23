# Plan de Implementación de la Arquitectura Unificada JARVIS: FAST y PLAN

**Documento Técnico Integral, Verificación Empírica y Especificación de Migración**  
**Fecha de Actualización:** 23 de octubre de 2026  
**Referencia:** Código fuente del repositorio (`src/`, `server.ts`, `ui/`) y Especificación de Arquitectura Objetivo (`FAST y PLAN`)  
**Estado:** Verificado, consolidado y completado para ejecución

---

## 1. Objetivo, Alcance y Reglas Metodológicas

### 1.1. Objetivo
El objetivo de este documento es formalizar la especificación técnica y el plan de migración paso a paso para unificar los modos de ejecución `FAST` y `PLAN` bajo un **único motor reactivo común** en JARVIS.

En la arquitectura objetivo:
- **Motor reactivo común (FAST):** Ejecuta dinámicamente cualquier objetivo asignado (sea la instrucción global del usuario o una etapa específica de un plan) mediante la secuencia: selección dinámica de ruta (Decision #1), selección de herramienta (Decision #2), generación de argumentos (Qwen), evaluación de compuerta de seguridad (Guard), despacho MCP, normalización de resultados (Result Processor), verificación y clasificación estructurada del fallo (Decision #3 / Eos) y recuperación local de fallos acotados.
- **Capa deliberativa (PLAN):** No duplica ni mantiene un motor de ejecución paralelo. Su responsabilidad es orquestar el trabajo en etapas secuenciales orientadas a objetivos, solicitar la aprobación humana inicial, activar una etapa por vez sobre el motor reactivo común, y gatillar la replanificación global con Qwen (en modo pensamiento) cuando la recuperación local de la etapa se agote o el fallo sea irrecuperable.

### 1.2. Alcance
- **Componentes incluidos:**
  - Orquestación central y ciclo de vida de tareas en [core.ts](file:///home/hugo/jarvv/src/core/core.ts).
  - Bucles de ejecución de modo y escalaciones en [modeEngines.ts](file:///home/hugo/jarvv/src/core/modeEngines.ts).
  - Pipeline de ejecución de herramientas en [callExecutor.ts](file:///home/hugo/jarvv/src/core/callExecutor.ts).
  - Adaptador e inferencias de Decision 2.0 (Eos) en [decision.ts](file:///home/hugo/jarvv/src/core/decision.ts) y [prompts.ts](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts).
  - Razonador Qwen (planificación, argumentos y replanificación) en [qwen.ts](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts).
  - Definición de tipos y contratos de datos en [types.ts](file:///home/hugo/jarvv/src/core/types.ts).
  - Trazabilidad y telemetría en [taskTrace.ts](file:///home/hugo/jarvv/src/core/taskTrace.ts) y [debugAccumulator.ts](file:///home/hugo/jarvv/src/core/debugAccumulator.ts).
  - Endpoints de backend y eventos en [jarvisRouter.ts](file:///home/hugo/jarvv/src/server/jarvisRouter.ts) y consumidores en [ui/](file:///home/hugo/jarvv/ui).
- **Límites de alcance (exclusiones):**
  - No se agregan nuevas herramientas ni servidores MCP ajenos a los existentes.
  - No se modifica la compuerta de seguridad Guard para eludir o flexibilizar políticas de seguridad.
  - No se altera la persistencia externa ni se crea base de datos en disco (la traza JSONL permanece append-only).

### 1.3. Reglas Metodológicas
1. **Verificación empírica estricta:** Todo comportamiento actual se contrasta contra el código fuente real. No se dan por válidas afirmaciones previas sin comprobación directa de líneas y archivos.
2. **Respeto a decisiones no resueltas:** Las decisiones de diseño pendientes no se asumen unilateralmente; se explicitan sus alternativas técnicas y sus consecuencias.
3. **No regresión funcional ni rotura de tipos:** Toda modificación respeta el sistema de tipos comprobado mediante `tsc --noEmit` y el empaquetado de producción `npm run build`.

---

## 2. Arquitectura Actual Comprobada

### 2.1. Desacoplamiento Existente y Duplicidad de Orquestación
Actualmente, el repositorio implementa dos bucles completamente separados en [modeEngines.ts](file:///home/hugo/jarvv/src/core/modeEngines.ts):

1. **Bucle `FAST` (`runFastLoop`, líneas 395–546):**
   - Evalúa Decision #1 dinámicamente en cada ciclo (`evaluateDecisionOne`, línea 406).
   - Valida si corresponde terminar (`route === "fin"`, líneas 441–476).
   - Instancia un paso sintético (`s1`, `s2`, ...) con `instruction: task.message` y le asigna la ruta elegida por Decision #1 (`step.route = selectedRoute`, líneas 486–495).
   - Invoca [runStep](file:///home/hugo/jarvv/src/core/callExecutor.ts#L149-L589).
   - Ante errores lógicos, invoca [handleEscalation](file:///home/hugo/jarvv/src/core/modeEngines.ts#L218-L287) (línea 541), la cual incrementa `context.escalations` (límite `MAX_ESCALATIONS = 2`) y consulta a Decision #1 para conmutar de ruta o concluir.

2. **Bucle `PLAN` (`runPlanLoop`, líneas 621–727):**
   - No ejecuta Decision #1 para seleccionar rutas.
   - Las etapas (`task.steps`) son creadas en [initiatePlanMode](file:///home/hugo/jarvv/src/core/modeEngines.ts#L551-L619) a partir de la salida de `qwenEngine.generatePlan`.
   - Qwen asigna estáticamente a cada etapa una ruta obligatoria a través del campo `suggested_mcp` ([qwen.ts:331-334](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L331-L334)), que la función [planStepsToSteps](file:///home/hugo/jarvv/src/core/modeEngines.ts#L55-L66) copia directamente a `step.route`.
   - `runPlanLoop` toma la etapa en `PENDING` y despacha directamente a [runStep](file:///home/hugo/jarvv/src/core/callExecutor.ts#L149) asumiendo la ruta fija prefijada por Qwen.
   - **Ausencia total de reintentos locales:** Si [runStep](file:///home/hugo/jarvv/src/core/callExecutor.ts#L149) devuelve `logical_error` o excepción (y no es `insufficient_info` ni veto de Guard), `runPlanLoop` salta directamente a [handleReplan](file:///home/hugo/jarvv/src/core/modeEngines.ts#L657-L723), invocando una costosa replanificación global con Qwen sin intentar corregir argumentos ni cambiar de herramienta dentro de la etapa.

### 2.2. Flujo de Ejecución en `runStep` ([callExecutor.ts](file:///home/hugo/jarvv/src/core/callExecutor.ts))
El pipeline de ejecución de cada paso individual se ejecuta en el siguiente orden:
1. **Descubrimiento y catálogo:** Obtiene herramientas del destino prefijado en `step.route` (líneas 155–170). Si existe `context.excludedToolForNextCall`, filtra la herramienta fallida anterior (líneas 172–179).
2. **Decision #2 (Eos):** Selecciona la herramienta concreta mediante inferencia estructurada de tipo `choice` (líneas 182–190).
3. **Generación de argumentos (Qwen):** Genera los argumentos de la herramienta validándolos contra el esquema JSON (líneas 213–242).
4. **Anti-bucle:** Comprueba si la firma `servidor:herramienta:hash(args):m<counter>` ya fue ejecutada (líneas 285–298).
5. **Compuerta de seguridad Guard:** Evalúa `Guard.evaluate(server, tool, args)` (líneas 301–347):
   - Si es `"DENY"`: asigna `step.state = "BLOCKED"`, emite `signals: { denied: true }` y aborta el despacho.
   - Si es `"APPROVAL"`: suspende en `WAITING_INPUT/approval`. Si el usuario deniega, asigna `step.state = "BLOCKED"`, emite `signals: { denied: true }` y aborta.
6. **Despacho MCP:** Ejecuta la herramienta física en el servidor MCP (líneas 355–365).
7. **Procesamiento de resultados:** [ResultProcessor](file:///home/hugo/jarvv/src/core/processor/resultProcessor.ts) extrae observaciones compactas, aísla cargas voluminosas en `RefStore` y calcula señales (`exit_code`, `empty_output`, etc., líneas 367–402).
8. **Verificación y doble juez (Discrepancia principal):**
   - **Eos (Decision #3):** Si las señales son limpias, evalúa `evaluateStepVerification` (líneas 412–423). Solo pregunta `ok` y `cumple` (`noul`). **No clasifica fallos**.
   - **Qwen (Segundo juez):** Si `eosPassed` es falso y `task.mode === "PLAN"`, invoca [qwenEngine.verifyStage](file:///home/hugo/jarvv/src/core/callExecutor.ts#L432-L458) y emite el evento `STAGE_VERIFIED`.
   - Si `task.mode === "NORMAL"` (FAST), no hay segundo juez y el fallo se devuelve genérico (`failReason`, líneas 470–482).

---

## 3. Arquitectura Objetivo Acordada

```
                                SOLICITUD DE USUARIO
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
             [ Modo FAST ]                               [ Modo PLAN ]
                   │                                           │
                   │                             Qwen genera plan en etapas
                   │                             (objetivos, criterios, sin ruta fija)
                   │                                           │
                   │                             Usuario aprueba plan inicial
                   │                                           │
                   │                               Activa etapa vigente
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       MOTOR REACTIVO COMÚN (FAST)     │
                     │                                       │
                     │ 1. Decision #1: selecciona ruta       │
                     │ 2. Decision #2: selecciona tool       │
                     │ 3. Qwen: genera argumentos            │
                     │ 4. Guard: autorización obligatoria    │
                     │ 5. MCP: ejecuta herramienta           │
                     │ 6. Result Processor: procesa y aísla  │
                     │ 7. Decision #3 (Eos): verificación    │
                     │    + clasificación (1 inferencia)     │
                     └───────────────────┬───────────────────┘
                                         │
                          ¿Cumplió el objetivo del paso?
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
                      [ SÍ ]                           [ NO ]
                         │                               │
        ¿Modo PLAN con etapas pendientes?        Recuperación local acotada
                 │             │                 (args, tool o ruta alternativa)
               [ SÍ ]        [ NO ]                      │
                 │             │                   ¿Se resolvió?
                 │             ▼                         │
                 │      Concluir tarea             ┌─────┴─────┐
                 │       (COMPLETED)               ▼           ▼
                 │                               [ SÍ ]      [ NO ]
                 │                                 │           │
                 └───────────────┐                 │     ¿Modo PLAN o FAST?
                                 │                 │           │
                                 ▼                 │     ┌─────┴─────────────┐
                        Activar siguiente etapa ───┘     ▼                   ▼
                        en motor reactivo común       [ PLAN ]            [ FAST ]
                                                         │                   │
                                                  Qwen replanifica    Escalación FAST
                                                  etapas pendientes   o concluir
                                                         │            (PARTIAL/FAILED)
                                                  Continúa PLAN       
```

### 3.1. Principios Invariantes de la Arquitectura Objetivo
1. **Un solo motor reactivo:** No existen dos mecanismos distintos para ejecutar herramientas. PLAN no ejecuta herramientas directamente; activa secuencialmente sus etapas sobre el motor reactivo FAST.
2. **Selección dinámica de rutas:** El plan aprobado describe qué objetivos y criterios de cumplimiento deben lograrse. Decision #1 selecciona dinámicamente la ruta en tiempo de ejecución.
3. **Decisión 3 (Eos) unificada:** Eos evalúa en una **única inferencia estructurada** si la etapa se cumplió (`ok`, `cumple`) y, en caso negativo, la tipología estructurada del fallo (`failure_type`). Qwen se retira del flujo de verificación caliente (`verifyStage` se elimina del pipeline de ejecución).
4. **Recuperación local escalonada:** Los fallos subsanables (argumentos inválidos, herramienta errónea) se reintentan localmente dentro de la etapa mediante un contador acotado (`localRetries`), antes de gatillar una replanificación completa.
5. **Veto terminal de seguridad:** Una denegación de Guard o el rechazo interactivo del usuario detiene la tarea de forma inmediata y definitiva (`FAILED` o `PARTIAL`). Queda terminantemente prohibido reintentar o replanificar para eludir una restricción de seguridad.
6. **Replanificación autónoma orientada al remanente:** Cuando la recuperación local se agota en PLAN, Qwen (en modo pensamiento) reorganiza exclusivamente las etapas pendientes. Las etapas verificadas como completadas nunca se vuelven a ejecutar.

---

## 4. Hallazgos Verificados y Discrepancias Confirmadas

| ID | Componente / Asunto | Estado Actual Comprobado en Código | Comportamiento Objetivo Acordado | Discrepancia Confirmada |
|---|---|---|---|---|
| **H-01** | Verificación Eos (Decision #3) | [prompts.ts:494–522](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts#L494-L522) y [decision.ts:198–238](file:///home/hugo/jarvv/src/core/decision.ts#L198-L238): solo formula y valida `ok` y `cumple` (`noul`). | Eos evalúa en una única llamada combinada: `ok`, `cumple` y `failure_type` (`choice`). | **Inconsistencia crítica:** Eos carece de clasificación de fallos en el código actual. |
| **H-02** | Segundo juez en PLAN (`verifyStage`) | [callExecutor.ts:432–458](file:///home/hugo/jarvv/src/core/callExecutor.ts#L432-L458) y [qwen.ts:699–740](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L699-L740): Qwen clasifica como segundo juez si Eos rechaza en PLAN. | Eos es el único verificador en el flujo caliente. `verifyStage` se retira de [callExecutor.ts](file:///home/hugo/jarvv/src/core/callExecutor.ts). | **Inconsistencia crítica:** Duplicidad de inferencia y asimetría entre FAST y PLAN. |
| **H-03** | Veto absoluto de Guard ante `DENY` | [callExecutor.ts:304–341](file:///home/hugo/jarvv/src/core/callExecutor.ts#L304-L341) genera `signals.denied`. [modeEngines.ts:228–233](file:///home/hugo/jarvv/src/core/modeEngines.ts#L228-L233) y [668–672](file:///home/hugo/jarvv/src/core/modeEngines.ts#L668-L672) concluyen la tarea sin reintentos ni replan. | Ratificado. Un rechazo de Guard jamás se reintenta ni replanifica; clausura inmediatamente la tarea. | **Comportamiento confirmado y ratificado como regla de seguridad.** |
| **H-04** | Rutas prefijadas en PLAN vs Decision #1 | [qwen.ts:331–334](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L331-L334) exige `suggested_mcp`. [modeEngines.ts:55–65](file:///home/hugo/jarvv/src/core/modeEngines.ts#L55-L65) fija la ruta. `runPlanLoop` no evalúa Decision #1. | El plan organiza etapas por objetivos; Decision #1 evalúa la ruta dinámicamente en tiempo de ejecución. | **Discrepancia arquitectónica mayor:** El plan actual acopla rutas fijas y elude Decision #1 en PLAN. |
| **H-05** | Reintentos locales en PLAN | [modeEngines.ts:650–726](file:///home/hugo/jarvv/src/core/modeEngines.ts#L650-L726): ante cualquier fallo de [runStep](file:///home/hugo/jarvv/src/core/callExecutor.ts#L149), escala inmediatamente a `handleReplan`. | Reintentos locales acotados por etapa (`localRetries`) antes de gatillar la replanificación global. | **Omisión funcional:** Falta la mecánica de recuperación local en la etapa de PLAN. |
| **H-06** | Contadores y límites | `MAX_STEPS = 15`, `MAX_ESCALATIONS = 2`, `MAX_REPLAN = 2` en [types.ts:351–353](file:///home/hugo/jarvv/src/core/types.ts#L351-L353). `step.questionsAsked` acotado a 2 en [modeEngines.ts:692](file:///home/hugo/jarvv/src/core/modeEngines.ts#L692). | Se preservan todos los límites existentes y se introduce el límite acotado de reintentos locales de etapa. | **Confirmado:** No hay colisiones de contadores. |
| **H-07** | Consolidación de hechos (`facts`) | [core.ts:312](file:///home/hugo/jarvv/src/core/core.ts#L312) (`user_answer`) y [callExecutor.ts:488](file:///home/hugo/jarvv/src/core/callExecutor.ts#L488) (`factsDelta` si `isStepSuccess`, `noVerdict` o `mutates`). | Los hechos confirmados y mutaciones físicas se conservan. | **Confirmado:** Implementación coherente en dos puntos. |

---

## 5. Inventario Completo de Archivos y Símbolos Afectados

### 5.1. Backend (`src/core/` y `src/server/`)
1. **[src/core/types.ts](file:///home/hugo/jarvv/src/core/types.ts):**
   - `Step`: añadir `localRetries?: number`, `criterioCumplimiento?: string`, `restricciones?: string[]`.
   - `PlanStep`: modificar propiedades según resolución de `suggested_mcp` (hacerlo opcional o removerlo).
   - `StepExecutionResult`: actualizar `failureType?: StageFailureType`, tipificar nuevo veredicto unificado; retirar dependencia hacia `StageVerificationResult`.
   - `StepExecutionSignals`: incorporar señal determinista de error de infraestructura si aplica.
   - Constantes de límites: declarar `MAX_LOCAL_RETRIES`.
   - `TaskEventType`: evaluar obsolescencia o mantenimiento del evento `STAGE_VERIFIED`.
2. **[src/core/reasoner/prompts.ts](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts):**
   - `DECISION_PROMPTS.buildStepVerification`: incorporar la pregunta de tipo `choice` (`failure_type`) con su `criteria`.
   - `PROMPTS.PLAN.SYSTEM` y `buildUserPrompt`: ajustar directivas sobre etapas (eliminar obligatoriedad de `suggested_mcp`).
   - `PROMPTS.REPLAN.SYSTEM`: sincronizar estructura con la del plan inicial.
   - `PROMPTS.STAGE_VERIFICATION`: desincorporar del camino caliente de ejecución.
3. **[src/core/decision.ts](file:///home/hugo/jarvv/src/core/decision.ts):**
   - `Decision20Engine.evaluateStepVerification`: actualizar para recibir y parsear `failure_type` (`choice`) y su distribución de probabilidades.
4. **[src/core/callExecutor.ts](file:///home/hugo/jarvv/src/core/callExecutor.ts):**
   - `runStep`:
     - Integrar la selección dinámica de Decision #1 si la etapa no tiene ruta fijada.
     - Consumir el `failure_type` de Eos.
     - Asignar deterministamente `transient_technical` ante excepciones de transporte o salida de MCP sin llamar a Eos.
     - Retirar la llamada a `deps.qwenEngine.verifyStage`.
     - Preservar la emisión de `RESULT_PROCESSED` enriquecida con la tipificación del fallo.
5. **[src/core/modeEngines.ts](file:///home/hugo/jarvv/src/core/modeEngines.ts):**
   - `planStepsToSteps`: adaptar a la nueva estructura de `PlanStep`.
   - `runFastLoop`: sincronizar con el motor común unificado.
   - `runPlanLoop`:
     - Delegar la ejecución de cada etapa al motor reactivo común.
     - Implementar el ciclo de reintento local acotado por `MAX_LOCAL_RETRIES` ante fallos recuperables.
     - Invocar `handleReplan` únicamente cuando los reintentos locales se agoten o el fallo sea irrecuperable.
   - `handleEscalation`: conservar el bloqueo absoluto ante `signals.denied`.
   - `handleReplan`: asegurar que el prompt de replanificación reciba el estado consolidado de la etapa fallida y sus efectos físicos intactos.
6. **[src/core/reasoner/qwen.ts](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts):**
   - `parsePlanSteps`: adaptar validación según la decisión sobre `suggested_mcp`.
   - `verifyStage`: marcar en desuso o reorientar si se utiliza para clarificación de preguntas al usuario.
7. **[src/core/taskTrace.ts](file:///home/hugo/jarvv/src/core/taskTrace.ts):**
   - Asegurar que la serialización de `plan.steps` soporte etapas con ruta dinámica asignada.
8. **[src/core/debugAccumulator.ts](file:///home/hugo/jarvv/src/core/debugAccumulator.ts):**
   - Adaptar acumuladores de eventos a la verificación unificada de Eos.

### 5.2. Capa de Presentación e Integración (`ui/`)
1. **[ui/components/DecisionStream/DecisionStream.tsx](file:///home/hugo/jarvv/ui/components/DecisionStream/DecisionStream.tsx):**
   - Líneas 72–81: soportar la visualización del resultado de verificación y tipología de fallo provisto en `RESULT_PROCESSED`.
2. **[ui/utils/taskStatus.ts](file:///home/hugo/jarvv/ui/utils/taskStatus.ts):**
   - Sincronizar el cálculo de estado de la etapa con la verificación provista por Eos.
3. **[ui/types/ui.ts](file:///home/hugo/jarvv/ui/types/ui.ts) y [ui/services/jarvisApi.ts](file:///home/hugo/jarvv/ui/services/jarvisApi.ts):**
   - Mantener compatibilidad estricta con el modo de ejecución (`"NORMAL" | "PLAN"`).

---

## 6. Plan de Migración Ordenado por Fases y Dependencias

La implementación debe realizarse en un orden secuencial estricto, donde cada fase deja el repositorio en estado compilable (`tsc --noEmit`) y funcionalmente coherente.

```
┌────────────────────────────────────────────────────────┐
│ Fase 1: Contratos de Datos, Esquemas y Tipos           │
│         (types.ts, config, esquemas Eos/Qwen)          │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Fase 2: Verificación Unificada en Decision #3 (Eos)    │
│         (prompts.ts, decision.ts, desacoplar verify)   │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Fase 3: Motor Reactivo Común y Selección Dinámica      │
│         (callExecutor.ts, Decision #1 en etapa)        │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Fase 4: Orquestación PLAN: Reintentos y Replan         │
│         (runPlanLoop, localRetries, handleReplan)      │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Fase 5: Trazabilidad, Observabilidad y UI              │
│         (taskTrace.ts, debugAccumulator, UI stream)    │
└────────────────────────────────────────────────────────┘
```

### Fase 1: Contratos de Datos, Esquemas y Tipos
- **Dependencias:** Ninguna (base tipológica).
- **Acciones:**
  1. En [types.ts](file:///home/hugo/jarvv/src/core/types.ts), definir el tipo `StageFailureType`:
     ```typescript
     export type StageFailureType =
       | "transient_technical"
       | "invalid_arguments"
       | "inadequate_strategy"
       | "uncertain_side_effect"
       | "insufficient_info"
       | "unrecoverable";
     ```
  2. Agregar `localRetries: number` en la interfaz `Step`.
  3. Declarar la constante `MAX_LOCAL_RETRIES = 2` (o el valor acordado en la decisión D-2).
  4. Ajustar `PlanStep` según la resolución adoptada para `suggested_mcp` (D-1).
  5. Extender `StepExecutionResult` con `failureType?: StageFailureType`.
- **Criterio de aceptación:** `tsc --noEmit` compila sin errores.

### Fase 2: Verificación y Clasificación Unificada en Decision #3 (Eos)
- **Dependencias:** Fase 1 completada.
- **Acciones:**
  1. En [prompts.ts:494](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts#L494), actualizar `DECISION_PROMPTS.buildStepVerification` para incorporar la pregunta `failure_type` de tipo `choice`:
     ```typescript
     questions: {
       ok: { type: "noul", instructions: "Does the result contain usable data (not empty and not an error message)?" },
       cumple: { type: "noul", instructions: "Does the result accomplish the step instruction?" },
       failure_type: {
         type: "choice",
         instructions: "If the instruction was not accomplished, classify the primary reason:",
         criteria: {
           invalid_arguments: "Missing parameters, wrong syntax or bad arguments for the tool",
           inadequate_strategy: "Wrong tool chosen or route inadequate; need a different approach",
           uncertain_side_effect: "The action may have mutated state but result is ambiguous",
           insufficient_info: "Crucial information from the user is missing to proceed",
           unrecoverable: "The goal cannot be accomplished due to external or permanent barriers"
         }
       }
     }
     ```
  2. En [decision.ts:198](file:///home/hugo/jarvv/src/core/decision.ts#L198), actualizar `evaluateStepVerification` para parsear la respuesta `failure_type` validada por `parseResponse`.
  3. En [callExecutor.ts:406](file:///home/hugo/jarvv/src/core/callExecutor.ts#L406):
     - Asignar `transient_technical` de forma determinista ante fallos de infraestructura sin invocar inferencias innecesarias.
     - Retirar la invocación a `deps.qwenEngine.verifyStage` del flujo caliente.
     - Normalizar `StepExecutionResult` con el veredicto y `failureType`.
- **Criterio de aceptación:** Las verificaciones de paso en FAST y PLAN devuelven tipificación estructurada en una única llamada HTTP a Eos. `tsc --noEmit` pasa limpio.

### Fase 3: Motor Reactivo Común y Selección Dinámica de Ruta
- **Dependencias:** Fases 1 y 2 completadas.
- **Acciones:**
  1. En [prompts.ts:260](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts#L260) y [qwen.ts:316](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L316), actualizar la generación de planes para que las etapas especifiquen qué lograr (objetivo y criterios) sin imponer obligatoriamente rutas cerradas.
  2. En [callExecutor.ts:154](file:///home/hugo/jarvv/src/core/callExecutor.ts#L154), permitir que si la etapa no tiene una ruta prefijada (o si entra al motor común), Decision #1 evalúe dinámicamente la ruta antes de Decision #2.
  3. En [modeEngines.ts](file:///home/hugo/jarvv/src/core/modeEngines.ts), unificar el flujo para que [runStep](file:///home/hugo/jarvv/src/core/callExecutor.ts#L149) represente la ejecución canónica e invariable de cualquier etapa/paso.
- **Criterio de aceptación:** Una etapa de PLAN selecciona su ruta en tiempo de ejecución a través de Decision #1. `tsc --noEmit` y `npm run build` pasan sin errores.

### Fase 4: Orquestación en Modo PLAN: Reintentos Locales y Replanificación
- **Dependencias:** Fases 1 a 3 completadas.
- **Acciones:**
  1. En [modeEngines.ts:621](file:///home/hugo/jarvv/src/core/modeEngines.ts#L621) (`runPlanLoop`):
     - Implementar la evaluación de fallos devueltos por el motor común:
       - Si `signals.denied`: concluir la tarea inmediatamente (`FAILED`/`PARTIAL`). Prohibido reintentar o replanificar.
       - Si `isStepSuccess`: marcar `COMPLETED`, resetear contadores locales y avanzar a la siguiente etapa.
       - Si fallo recuperable (`invalid_arguments`, `inadequate_strategy`, `transient_technical`):
         - Si `step.localRetries < MAX_LOCAL_RETRIES`: incrementar `step.localRetries`, alimentar el contexto de reintento (excluir tool en `inadequate_strategy`, inyectar error en argumentos si `invalid_arguments`) y reejecutar la etapa localmente.
         - Si `step.localRetries >= MAX_LOCAL_RETRIES`: escalar a `handleReplan`.
       - Si fallo irrecuperable (`unrecoverable` o `uncertain_side_effect`): saltar los reintentos locales y escalar directamente a `handleReplan`.
       - Si `insufficient_info`: suspender en `WAITING_INPUT/user_answer` conforme al límite `MAX_USER_QUESTIONS_PER_STEP`.
  2. En [modeEngines.ts:289](file:///home/hugo/jarvv/src/core/modeEngines.ts#L289) (`handleReplan`):
     - Preservar las etapas completadas como hechos consolidados inmutables.
     - Transmitir la lista completa de `effects` acumulados para evitar duplicar acciones destructivas.
- **Criterio de aceptación:** Errores transitorios o de argumentos se corrigen localmente en la etapa sin replanificar. El agotamiento de reintentos activa la replanificación acotada por `MAX_REPLAN = 2`.

### Fase 5: Trazabilidad, Observabilidad y Capa UI
- **Dependencias:** Fases 1 a 4 completadas.
- **Acciones:**
  1. En [taskTrace.ts:52](file:///home/hugo/jarvv/src/core/taskTrace.ts#L52), actualizar la serialización del plan para reflejar fielmente la ruta ejecutada por etapa.
  2. En [debugAccumulator.ts:188](file:///home/hugo/jarvv/src/core/debugAccumulator.ts#L188), asegurar que la telemetría capture la verificación unificada de Eos y la tipología de fallo.
  3. En [ui/components/DecisionStream/DecisionStream.tsx](file:///home/hugo/jarvv/ui/components/DecisionStream/DecisionStream.tsx), verificar que los eventos `RESULT_PROCESSED` muestren adecuadamente la tipificación de fallo y el veredicto en tiempo real.
- **Criterio de aceptación:** Las trazas y la interfaz web reflejan las etapas, los reintentos locales y las replanificaciones sin errores de renderizado ni discrepancias de tipos.

---

## 7. Contratos y Flujos que Deben Modificarse

### 7.1. Contrato de Inferencia de Decision #3 (Eos)
- **Endpoint:** `POST /v1/decide`
- **Payload anterior:**
  ```json
  {
    "state": "Step instruction: ...\nResult: ...",
    "questions": {
      "ok": { "type": "noul", "instructions": "Does the result contain usable data...?" },
      "cumple": { "type": "noul", "instructions": "Does the result accomplish the step instruction?" }
    }
  }
  ```
- **Payload propuesto:**
  ```json
  {
    "state": "Step instruction: ...\nExpected outcome: ...\nTool: ...\nResult: ...",
    "questions": {
      "ok": { "type": "noul", "instructions": "Does the result contain usable data (not empty and not an error message)?" },
      "cumple": { "type": "noul", "instructions": "Does the result accomplish the step instruction?" },
      "failure_type": {
        "type": "choice",
        "instructions": "If not accomplished, classify the failure:",
        "criteria": {
          "invalid_arguments": "Wrong parameters or format",
          "inadequate_strategy": "Inadequate tool or route",
          "uncertain_side_effect": "State mutated but outcome unclear",
          "insufficient_info": "User clarification needed",
          "unrecoverable": "Permanent roadblock"
        }
      }
    }
  }
  ```

### 7.2. Contrato de Etapas del Plan (`PlanStep`)
- **Contrato actual:**
  ```typescript
  export interface PlanStep {
    id: string;
    instruction: string;
    route: ExecutableRoute; // Fijado obligatoriamente por Qwen
    expectedOutcome: string;
  }
  ```
- **Contrato propuesto:**
  ```typescript
  export interface PlanStep {
    id: string;
    instruction: string;
    expectedOutcome: string;
    suggestedRoute?: ExecutableRoute; // Opcional / sugerencia no vinculante
    criterioCumplimiento?: string;
    restricciones?: string[];
  }
  ```

---

## 8. Manejo de Errores, Recuperación, Seguridad, Contadores y Estados Terminales

### 8.1. Matriz Taxonómica de Fallos y Acciones de Recuperación

| Tipología de Fallo | Origen del Dictamen | Acción en Modo FAST | Acción en Modo PLAN | Reintenta Guard | Efecto en Contadores |
|---|---|---|---|---|---|
| **Veto de Seguridad (`Guard DENY` / Rechazo interactivo)** | Guard / Usuario | Bloqueo terminal inmediato (`FAILED`/`PARTIAL`). | Bloqueo terminal inmediato (`FAILED`/`PARTIAL`). Prohibido replanificar. | **NO**. Bloqueo definitivo. | Concluye la tarea. |
| **Fallo Técnico Transitorio (`transient_technical`)** | Runtime (Timeout MCP, error proceso) | Escalación FAST (Decision #1). | Reintento local idéntico con backoff si no muta el entorno. | Sí, reevalúa Guard. | Incrementa `step.localRetries`. |
| **Argumentos Inválidos (`invalid_arguments`)** | Decision #3 (Eos) | Reintento de generación de argumentos con Qwen inyectando error. | Reintento local: Qwen regenera argumentos con contexto de error. | Sí, reevalúa Guard con nuevos args. | Incrementa `step.localRetries`. |
| **Herramienta / Ruta Inadecuada (`inadequate_strategy`)** | Decision #3 (Eos) | Escalación FAST: excluye tool y Decision #1 conmuta ruta. | Reintento local: excluye tool en la etapa; Decision #1/2 selecciona alternativa. | Sí, reevalúa Guard con nueva tool. | Incrementa `step.localRetries`. |
| **Resultado Incierto con Mutación (`uncertain_side_effect`)** | Decision #3 (Eos) | No reintentar la acción a ciegas; forzar lectura de observación. | Salta reintentos locales; escala a `handleReplan` informando efecto en `effects`. | Sí, ante cualquier acción nueva. | Preserva `effects`. Si reintento agotado, `replans++`. |
| **Falta de Información del Usuario (`insufficient_info`)** | Decision #3 (Eos) | Solicitar aclaración o concluir parcial si no es interactivo. | Suspende en `WAITING_INPUT/user_answer`. | Sí, al reanudar. | Incrementa `step.questionsAsked` (máx 2). |
| **Fallo Irrecuperable (`unrecoverable`)** | Decision #3 (Eos) | Escalación a Decision #1 o conclusión si no hay alternativas. | Salta reintentos locales; escala directamente a `handleReplan` con Qwen. | Sí, en nuevo plan. | Incrementa `task.replans` (máx 2). |

### 8.2. Contadores del Sistema y Garantías Anti-Bucle

| Contador / Límite | Valor Máximo | Nivel | Comportamiento al Alcanzar el Límite |
|---|---|---|---|
| `MAX_LOCAL_RETRIES` | 2 (propuesta D-2) | Por etapa | Agotados los 2 reintentos locales, PLAN escala a `handleReplan`. En FAST, escala a Decision #1. |
| `MAX_REPLAN` | 2 | Por tarea | Si se agotan 2 replanificaciones globales con Qwen, la tarea concluye como `PARTIAL` o `FAILED`. |
| `MAX_ESCALATIONS` | 2 | Por tarea (FAST) | Si se agotan 2 escalaciones en FAST, la tarea concluye como `PARTIAL` o `FAILED`. |
| `MAX_USER_QUESTIONS_PER_STEP` | 2 | Por etapa | Si se formulan 2 preguntas sin resolver la duda, se trata como desviación recuperable y escala a replan. |
| `MAX_STEPS` | 15 | Global | Límite infranqueable de iteraciones para impedir bucles infinitos. |
| `consecutiveLoopBlocks` | 2 | Contexto | 2 bloqueos idénticos consecutivos por anti-loop cierran la tarea como `PARTIAL`. |

---

## 9. Criterios de Aceptación por Fase

- **Fase 1 (Contratos):**
  - Todas las interfaces en [types.ts](file:///home/hugo/jarvv/src/core/types.ts) compilan limpiamente sin advertencias.
  - La suite de compilación estática (`tsc --noEmit` y `npm run build`) finaliza con código de salida 0.
- **Fase 2 (Eos Unificado):**
  - Decision #3 envía una única solicitud HTTP para `ok`, `cumple` y `failure_type`.
  - [callExecutor.ts](file:///home/hugo/jarvv/src/core/callExecutor.ts) ya no realiza llamadas a `qwenEngine.verifyStage`.
  - La latencia por paso ejecutado se reduce al eliminar el clasificador redundante.
- **Fase 3 (Motor Común y Ruta Dinámica):**
  - Las etapas de PLAN ejecutan Decision #1 al activarse, seleccionando la ruta correspondiente a la etapa.
  - El código de ejecución de pasos es idéntico entre FAST y PLAN.
- **Fase 4 (Recuperación y Replan):**
  - Fallos simulados de sintaxis de argumentos o herramienta errónea se resuelven en el reintento local sin modificar el plan.
  - Ante fallos irrecuperables o reintentos locales agotados, se ejecuta la replanificación automática con Qwen.
  - Un rechazo de Guard concluye la tarea inmediatamente sin ejecutar replanificaciones.
- **Fase 5 (Observabilidad y UI):**
  - Las trazas en disco registran con precisión los intentos locales y las replanificaciones.
  - La interfaz de usuario refleja los estados de las etapas y las transiciones a `WAITING_INPUT`.

---

## 10. Riesgos, Aspectos no Verificados y Decisiones Pendientes

### 10.1. Riesgos Identificados y Mitigaciones
1. **Riesgo de formulación de preguntas al usuario sin Qwen en el camino crítico:**
   - *Riesgo:* Eos (0.8B) es un clasificador categórico; no genera lenguaje natural. Si clasifica `insufficient_info`, no puede redactar la pregunta para el usuario.
   - *Mitigación:* Definir una invocación puntual y ligera a Qwen únicamente para redactar la pregunta cuando Eos dictamine `insufficient_info`, o estructurar la pregunta a partir de plantillas deterministas con la instrucción y observación.
2. **Riesgo de saturación de contexto en reintentos locales:**
   - *Riesgo:* Acumular intentos fallidos en el prompt de argumentos puede acercar la ventana al límite de tokens.
   - *Mitigación:* Limitar los intentos inyectados a los últimos 2 (`MAX_LOCAL_RETRIES = 2`) y aplicar truncamiento determinista (`clip`).
3. **Riesgo de elusión inadvertida de Guard:**
   - *Riesgo:* Que un reintento local repita una llamada rechazada.
   - *Mitigación:* Ratificación del veto absoluto: si `Guard.evaluate === "DENY"` o el usuario rechaza, la tarea muere inmediatamente; no hay retorno a los bucles de reintento.

### 10.2. Decisiones Pendientes que Requieren Intervención del Usuario

#### Decisión Pendiente 1: Tratamiento de `suggested_mcp` en el plan generado por Qwen
- **Contexto:** Actualmente Qwen asigna una ruta fija (`suggested_mcp`) por etapa. La arquitectura acordada establece que el plan define qué lograr y Decision #1 selecciona la ruta dinámicamente.
- **Alternativas:**
  - **Alternativa 1A (Eliminación completa):** Se remueve `suggested_mcp` del esquema JSON y de los prompts de Qwen. Cada etapa solo contiene `goal` y `expected_outcome`. Decision #1 elige la ruta al 100% en tiempo de ejecución.
    - *Ventaja:* Desacoplamiento total; el plan no asume herramientas y Decision #1 opera libremente.
    - *Desventaja:* Requiere actualizar los prompts de `PLAN` y `REPLAN` y los esquemas de validación de Qwen.
  - **Alternativa 1B (Conservación como sugerencia opcional no vinculante):** Qwen puede incluir `suggested_route` como orientación opcional. Decision #1 recibe esa sugerencia en su contexto, pero conserva plena autonomía para elegir otra ruta.
    - *Ventaja:* Mayor compatibilidad hacia atrás con trazas históricas y ejemplos del laboratorio.
    - *Desventaja:* Qwen podría sesgar innecesariamente a Decision #1.

#### Decisión Pendiente 2: Número máximo de reintentos locales por etapa (`MAX_LOCAL_RETRIES`)
- **Contexto:** Define cuántas veces puede el motor común intentar resolver una etapa fallida antes de declarar la etapa irrecuperable y replanificar todo el trabajo restante.
- **Alternativas:**
  - **Alternativa 2A: `MAX_LOCAL_RETRIES = 2` (Recomendado):** Permite un reintento para corregir argumentos y un segundo reintento para conmutar de herramienta si la primera falló (hasta 3 ejecuciones en total de la etapa).
  - **Alternativa 2B: `MAX_LOCAL_RETRIES = 1`:** Permite un único reintento correctivo rápido. Si falla, replanifica de inmediato con Qwen. Reduce el tiempo de espera pero aumenta la frecuencia de replanificaciones globales.

#### Decisión Pendiente 3: Política de hechos (`facts`) en la replanificación
- **Contexto:** Cuando una etapa falla y se gatilla `handleReplan`, ¿qué ocurre con los datos almacenados en `task.memory.facts`?
- **Alternativas:**
  - **Alternativa 3A: Append-only físico con sobreescritura semántica (Recomendado):** Los hechos nunca se eliminan físicamente. La corrección se logra inyectando el resultado del paso fallido (`failedStepResult`) en el prompt del replan para que Qwen descarte hipótesis refutadas.
  - **Alternativa 3B: Reversión o purga de hechos de la etapa fallida:** Al fallar la etapa, se revocan o eliminan las claves agregadas por esa etapa específica en `processed.factsDelta`, impidiendo que datos potencialmente erróneos lleguen al replanificador.

#### Decisión Pendiente 4: Formulación de la pregunta interactiva ante `insufficient_info`
- **Contexto:** Al retirar `verifyStage` de Qwen del camino crítico, Eos clasifica `insufficient_info` pero no redacta texto libre.
- **Alternativas:**
  - **Alternativa 4A:** Si Eos dictamina `insufficient_info`, invocar una llamada puntual a Qwen (`buildUserQuestionPrompt`) exclusivamente para redactar la pregunta concreta dirigida al usuario.
  - **Alternativa 4B:** Pausar en `WAITING_INPUT/user_answer` utilizando una plantilla estructurada predefinida que expone la instrucción de la etapa y solicita aclaración directa.

---

## 11. Referencias Precisas al Código Fuente Comprobado

1. **Inferencia y preguntas de Decision #3 en Eos:**
   - [src/core/reasoner/prompts.ts:494–522](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts#L494-L522) (`buildStepVerification`).
   - [src/core/decision.ts:198–238](file:///home/hugo/jarvv/src/core/decision.ts#L198-L238) (`evaluateStepVerification`).
2. **Segundo juez redundante en PLAN:**
   - [src/core/callExecutor.ts:432–458](file:///home/hugo/jarvv/src/core/callExecutor.ts#L432-L458) (llamada a `deps.qwenEngine.verifyStage`).
   - [src/core/reasoner/qwen.ts:699–740](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L699-L740) (`verifyStage`).
   - [src/core/reasoner/prompts.ts:317–348](file:///home/hugo/jarvv/src/core/reasoner/prompts.ts#L317-L348) (`STAGE_VERIFICATION`).
3. **Veto absoluto de Guard:**
   - [src/core/callExecutor.ts:304–311](file:///home/hugo/jarvv/src/core/callExecutor.ts#L304-L311) (caso `Guard.evaluate === "DENY"`).
   - [src/core/callExecutor.ts:331–341](file:///home/hugo/jarvv/src/core/callExecutor.ts#L331-L341) (caso denegación interactiva del usuario).
   - [src/core/modeEngines.ts:228–233](file:///home/hugo/jarvv/src/core/modeEngines.ts#L228-L233) (bloqueo terminal en `handleEscalation`).
   - [src/core/modeEngines.ts:668–672](file:///home/hugo/jarvv/src/core/modeEngines.ts#L668-L672) (bloqueo terminal en `runPlanLoop`).
4. **Contadores y cotas operativas:**
   - [src/core/types.ts:351–353](file:///home/hugo/jarvv/src/core/types.ts#L351-L353) (`MAX_STEPS = 15`, `MAX_ESCALATIONS = 2`, `MAX_REPLAN = 2`).
   - [src/core/types.ts:363](file:///home/hugo/jarvv/src/core/types.ts#L363) (`MAX_USER_QUESTIONS_PER_STEP = 2`).
   - [src/core/modeEngines.ts:298–305](file:///home/hugo/jarvv/src/core/modeEngines.ts#L298-L305) (límite monótono de `task.replans`).
5. **Bucles de modo y orquestación:**
   - [src/core/modeEngines.ts:395–546](file:///home/hugo/jarvv/src/core/modeEngines.ts#L395-L546) (`runFastLoop`).
   - [src/core/modeEngines.ts:551–619](file:///home/hugo/jarvv/src/core/modeEngines.ts#L551-L619) (`initiatePlanMode`).
   - [src/core/modeEngines.ts:621–727](file:///home/hugo/jarvv/src/core/modeEngines.ts#L621-L727) (`runPlanLoop`).
   - [src/core/core.ts:336–345](file:///home/hugo/jarvv/src/core/core.ts#L336-L345) (`runTaskPipeline`).
6. **Esquema de etapas y rutas:**
   - [src/core/reasoner/qwen.ts:68–73](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L68-L73) (`STEP_ITEM_SCHEMA`).
   - [src/core/reasoner/qwen.ts:316–341](file:///home/hugo/jarvv/src/core/reasoner/qwen.ts#L316-L341) (`parsePlanSteps`).
   - [src/core/modeEngines.ts:55–66](file:///home/hugo/jarvv/src/core/modeEngines.ts#L55-L66) (`planStepsToSteps`).
7. **Anti-bucle y registro de firmas:**
   - [src/core/callExecutor.ts:285–298](file:///home/hugo/jarvv/src/core/callExecutor.ts#L285-L298) (detección anti-loop).
   - [src/core/callExecutor.ts:352](file:///home/hugo/jarvv/src/core/callExecutor.ts#L352) (adición de firma previa al despacho).
8. **Almacén de hechos y mutaciones físicas:**
   - [src/core/callExecutor.ts:488](file:///home/hugo/jarvv/src/core/callExecutor.ts#L488) (asignación de `factsDelta`).
   - [src/core/callExecutor.ts:533–535](file:///home/hugo/jarvv/src/core/callExecutor.ts#L533-L535) (registro de `effects`).
   - [src/core/core.ts:312](file:///home/hugo/jarvv/src/core/core.ts#L312) (registro de hechos tras respuesta del usuario).
