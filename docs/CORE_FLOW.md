# Flujo Principal de JARVIS Core

> Última revisión: **2026-10-13** (v1.3 — Motor Unificado `runStep`, Argmax Eos y Coordinación PLAN)

Cuando el usuario envía una instrucción y elige un modo (`NORMAL` / FAST o `PLAN`) desde la interfaz web o mediante `POST /api/jarvis/process`, el orquestador autoritativo `JarvisCore` inicializa un contexto de tarea (`TaskExecutionContext`) con estado `RUNNING` y arranca la ejecución asíncrona. 

- En modo **FAST**, el bucle `runFastLoop` evalúa iterativamente el enrutamiento con Decision #1 (sub-sistemas `windows`, `desktop_commander`, `free_search` o `fin`) y canaliza la ejecución de cada acción hacia el motor unificado `runStep`.
- En modo **PLAN**, el orquestador opera como una capa pura de coordinación y supervisión: `initiatePlanMode` solicita a Qwen 3.5 9B un plan estructurado de hasta 15 etapas verificables utilizando un catálogo compacto de herramientas, suspende la tarea en `WAITING_INPUT` (`waitingReason: "plan_confirmation"`) sin temporizador de expiración hasta que el usuario confirme, rechace o solicite modificaciones, y luego entrega cada etapa de forma secuencial al motor unificado `runStep`. Tras la ejecución del paso, Qwen evalúa el resultado observable mediante `verifyStage` para determinar si la etapa está cumplida, si requiere aclaración interactiva (`user_answer`), si activa replanificación acotada (`handleReplan`, sujeta a la regla de cambio material `isMaterialReplan`), o si concluye por bloqueo no recuperable.

---

## Diagrama del Flujo de Ejecución (v1.3)

```mermaid
flowchart TD
    Start([Instrucción del usuario: mensaje + modo]) --> InitTask[JarvisCore: initiateTask, estado RUNNING]
    InitTask --> CheckMode{¿Modo de ejecución?}

    %% ============================================================
    %% MODO PLAN (COORDINACIÓN Y SUPERVISIÓN)
    %% ============================================================
    CheckMode -- PLAN --> PlanGen[Qwen: generatePlan estructurado con catálogo compacto]
    PlanGen --> PlanWait[/Pausa: WAITING_INPUT plan_confirmation sin timeout/]
    
    PlanWait --> PlanAction{Acción del usuario en UI}
    PlanAction -- Rechazar --> PlanReject[rejectPlan: estado CANCELLED, emite PLAN_REJECTED] --> TaskDone
    PlanAction -- Modificar --> PlanModify[modifyPlan: Qwen regenera plan con feedback] --> PlanWait
    PlanAction -- Confirmar --> PlanConfirm[confirmPlan: estado RUNNING, inicia runPlanLoop]
    
    PlanConfirm --> PlanNextStep{¿Quedan etapas pendientes?}
    PlanNextStep -- No --> GenFinal[Qwen: generateFinalResponse]
    PlanNextStep -- Sí --> CheckDeps{¿Dependencias cumplidas?\nCOMPLETED en steps previos}
    
    CheckDeps -- No (Invalidación) --> PlanReplan[handleReplan: Qwen replanifica restantes]
    CheckDeps -- Sí --> ExecRunStep[Delegar etapa al Motor Unificado runStep]

    %% ============================================================
    %% MODO FAST (EJECUCIÓN DIRECTA)
    %% ============================================================
    CheckMode -- NORMAL / FAST --> FastLoop[runFastLoop: iteración de paso]
    FastLoop --> D1[Decision #1: evaluateDecisionOne en Eos]
    D1 --> CheckD1{Ruta seleccionada por argmax}
    
    CheckD1 -- "fin" --> CheckFinValid{¿Fin validado?\nPrimera iteración o acciones verificadas previas}
    CheckFinValid -- Sí --> GenFinal
    CheckFinValid -- No --> D1Fallback[Redirigir a mejor ruta alternativa desktop_commander] --> ExecRunStep

    CheckD1 -- "windows | desktop_commander | free_search" --> ExecRunStep

    %% ============================================================
    %% MOTOR UNIFICADO: runStep (src/core/callExecutor.ts)
    %% ============================================================
    subgraph UnifiedRunStep ["Motor Unificado de Paso (runStep)"]
        Disc[Discovery: obtener herramientas del MCP activo] --> ToolChoice{¿Candidato único?}
        ToolChoice -- Sí (1 tool) --> SingleTool[Seleccionar tool directamente con confianza 1.0]
        ToolChoice -- No (>1 tools) --> D2[Decision #2: evaluateDecisionTwo en Eos por argmax]
        
        SingleTool & D2 --> ValidateTool{¿Tool existe en catálogo activo?}
        ValidateTool -- No --> FatalToolErr[DecisionValidationError: denegar ejecución]
        ValidateTool -- Sí --> QwenArgs[Qwen: generateArguments con JSON schema limpio]
        
        QwenArgs --> ArgRetry{¿Schema válido?\nReintentos <= 2}
        ArgRetry -- No --> ArgFail[Error de argumentos: registrar en FAIL]
        ArgRetry -- Sí --> RefResolve[RefResolver: sustituir {{ref:rX}} desde RefStore]
        
        RefResolve --> AntiLoop{¿Pasa Anti-Loop?\nFirma repetida sin lectura}
        AntiLoop -- No --> LoopBlock[status: blocked_loop, registrar en FAIL]
        AntiLoop -- Sí --> GuardCheck{Guard: evaluate sobre args resueltos\nALLOW / APPROVAL / DENY}
        
        GuardCheck -- DENY --> GuardDeny[Paso BLOCKED: signals.denied = true]
        GuardCheck -- APPROVAL --> GuardWait[/Pausa: WAITING_INPUT approval sin timeout/]
        GuardWait --> UserDecision{Decisión del usuario}
        UserDecision -- Rechazar --> UserDeny[Paso BLOCKED: signals.denied = true]
        UserDecision -- Aprobar --> DispatchMCP[Despachar tool por stdio al servidor MCP]
        GuardCheck -- ALLOW --> DispatchMCP
        
        DispatchMCP --> WindowsStale{¿Windows staleElement?}
        WindowsStale -- Sí --> WinRefreshTree[Refrescar árbol de ventanas y reintentar 1 vez]
        WinRefreshTree --> ProcessResult
        WindowsStale -- No --> ProcessResult[ResultProcessor: deltas, hechos, señales y RefStore]
        
        ProcessResult --> CheckClean{¿Señales físicas limpias?\nexit_code=0, sin error/timeout/stale}
        CheckClean -- No (Error físico) --> StepFail[Determinar fallo directamente sin consultar a Eos]
        CheckClean -- Sí (CLEAN) --> EosVerif[Eos: evaluación binaria ok y cumple por argmax]
        
        EosVerif --> StepVerifResult{¿ok=true Y cumple=true?}
        StepVerifResult -- Sí --> StepOk[Actualizar LOG: ok, hechos y efectos confirmados]
        StepVerifResult -- No --> StepFail
    end

    %% ============================================================
    %% CONTROL POST-EJECUCIÓN: FAST vs PLAN
    %% ============================================================
    StepOk --> CheckLoopMode{¿Modo de ejecución?}
    StepFail --> CheckLoopMode
    GuardDeny & UserDeny --> DenyHandle[Seguridad: Prohibido eludir DENY] --> ConcludePartial

    %% Flujo FAST Post-Ejecución
    CheckLoopMode -- FAST --> CheckFastResult{¿Paso exitoso?}
    CheckFastResult -- Sí --> CheckFastSteps{¿task.stepSeq < 15?}
    CheckFastSteps -- Sí --> FastLoop
    CheckFastSteps -- No --> ConcludePartial[concludeTask: estado PARTIAL o FAILED]
    
    CheckFastResult -- No --> FastEscalation[handleEscalation: código determinista + Eos D1]
    FastEscalation --> EscAction{¿Conmutar ruta o abortar?\nescalations <= 2}
    EscAction -- switch_mcp --> FastLoop
    EscAction -- abort o agotado --> ConcludePartial

    %% Flujo PLAN Post-Ejecución
    CheckLoopMode -- PLAN --> PlanStageVerif[Qwen: verifyStage evaluación semántica de etapa]
    PlanStageVerif --> StageSituation{Clasificación normativa de etapa}
    
    StageSituation -- "completed" --> PlanNextStep
    StageSituation -- "insufficient_info" --> UserAnswerWait[/WAITING_INPUT: user_answer sin timeout/]
    UserAnswerWait --> UserAnswers[Operador provee respuesta vía POST /user-answer] --> ExecRunStep
    StageSituation -- "unrecoverable_blocked" --> ConcludePartial
    StageSituation -- "recoverable_deviation" --> CheckReplans{¿replans < 2?}
    
    CheckReplans -- No --> ConcludePartial
    CheckReplans -- Sí --> PlanReplan
    
    PlanReplan --> MaterialCheck{¿isMaterialReplan?\nMutaciones Guard, >3 pasos o cambio objetivo}
    MaterialCheck -- Sí (Material) --> PlanWait
    MaterialCheck -- No (No material) --> PlanNextStep

    LoopBlock --> ConsecutiveCheck{¿2 bloqueos seguidos?}
    ConsecutiveCheck -- Sí --> ConcludePartial
    ConsecutiveCheck -- No --> FastLoop

    GenFinal --> TaskDone([Tarea COMPLETED: respuesta entregada y emitida por SSE])
    ConcludePartial --> TaskDone
```

---

## Secuencia Canónica de Ejecución de Pasos

| # | Fase | Descripción | Módulo y Código |
|---|---|---|---|
| **1** | **Iniciación** | Se recibe la instrucción del usuario y el modo (`NORMAL` o `PLAN`). Se genera `TaskExecutionContext`, estado `RUNNING`, y se emite `TASK_CREATED`. | `src/core/core.ts:initiateTask()` |
| **2** | **Coordinación (PLAN)** | Si el modo es `PLAN`, Qwen descompone la meta en etapas estructuradas con el catálogo compacto. La tarea se suspende en `WAITING_INPUT` (`plan_confirmation`) hasta la aprobación humana. | `src/core/modeEngines.ts:initiatePlanMode()` |
| **3** | **Enrutamiento (FAST)** | Si el modo es `FAST`, Decision 2.0 (Eos) evalúa la ruta óptima (`windows`, `desktop_commander`, `free_search` o `fin`) por mayor probabilidad (argmax). | `src/core/decision.ts:evaluateDecisionOne()` |
| **4** | **Resolución de Herramienta** | En `runStep`, si existe una sola herramienta descubierta se selecciona con confianza 1.0; si existen varias, Eos resuelve la herramienta mediante `evaluateDecisionTwo` por argmax. | `src/core/callExecutor.ts:150-205` |
| **5** | **Validación contra Catálogo** | Se verifica de forma estricta que la herramienta elegida exista en el catálogo de runtime (`validateToolExists`). Si no existe, se bloquea la ejecución con `DecisionValidationError`. | `src/core/callExecutor.ts:162-175` |
| **6** | **Generación de Argumentos** | Qwen 3.5 9B genera los parámetros JSON recibiendo el esquema limpio de la herramienta (`cleanInputSchema`), con `thinking: false` forzado y hasta 2 reintentos (`MAX_ARG_RETRIES = 2`). | `src/core/reasoner/qwen.ts:generateArguments()` |
| **7** | **Sustitución de Referencias** | `RefResolver` recorre recursivamente los argumentos e inyecta el contenido real de `RefStore` para cada token `{{ref:rX}}` antes de la evaluación de seguridad. | `src/core/processor/refResolver.ts:resolveReferences()` |
| **8** | **Prevención Anti-Loop** | Se valida la firma `${server}:${tool}:${args}:m${nonReadCounter}` impidiendo ejecutar llamadas idénticas consecutivas sin una lectura intermedia. | `src/core/callExecutor.ts:253-282` |
| **9** | **Evaluación de Guard** | Guard inspecciona los argumentos completamente resueltos: autoriza operaciones de lectura (`ALLOW`), exige autorización humana para mutaciones (`APPROVAL`) o bloquea patrones destructivos (`DENY`). | `src/core/policy/guard.ts:evaluate()` |
| **10** | **Suspensión por Aprobación** | Si Guard dictamina `APPROVAL`, la tarea entra en `WAITING_INPUT` (`waitingReason: "approval"`), suspendida indefinidamente sin temporizador hasta `POST /approve` o `/deny`. | `src/core/callExecutor.ts:301-332` |
| **11** | **Despacho Físico MCP** | Se transmite la solicitud JSON-RPC 2.0 por transporte `stdio` al proceso hijo correspondiente con control de timeout técnico (30 s). | `src/core/mcp/transport.ts:callTool()` |
| **12** | **Recuperación de Stale Element** | En Windows MCP, si se detecta un control de interfaz obsoleto (`stale_element`), se refresca el árbol de accesibilidad y se reintenta automáticamente una vez. | `src/core/callExecutor.ts:365-380` |
| **13** | **Procesamiento de Resultados** | `ResultProcessor` extrae el hallazgo sintético (`finding`), aísla el texto completo en `RefStore` bajo clave `rX`, detecta señales físicas y actualiza hechos deterministas (`facts`). | `src/core/processor/resultProcessor.ts:process()` |
| **14** | **Verificación Factual con Eos** | Sobre señales físicas limpias (CLEAN), Eos evalúa de forma binaria si la ejecución técnica es correcta (`ok`) y si satisface el objetivo de la instrucción (`cumple`) por argmax ($p \ge 0.5$). | `src/core/callExecutor.ts:401-440` |
| **15** | **Supervisión de Etapa (PLAN)** | En modo PLAN, Qwen evalúa el resultado observable mediante `verifyStage`, distinguiendo entre etapa cumplida, desviación recuperable (`handleReplan`), pregunta al usuario (`user_answer`) o bloqueo. | `src/core/modeEngines.ts:660-745` |
| **16** | **Síntesis de Respuesta Final** | Al concluir satisfactoriamente todos los pasos o validarse `fin`, Qwen redacta la respuesta final basada estrictamente en LOG, FACTS y EVID. Se limpian las referencias de la tarea en `RefStore`. | `src/core/modeEngines.ts:concludeTask()` |

---

## Decisiones y Criterios Técnicos de Bifurcación

- **Frontera Técnica entre FAST y PLAN:**
  - `FAST` es el motor de ejecución a nivel de llamada de herramienta. Maneja reintentos de schema (`MAX_ARG_RETRIES = 2`), recuperación de stale elements en Windows y conmutación de subsistema (`handleEscalation`).
  - `PLAN` es el supervisor de etapas. Nunca ejecuta herramientas directamente ni implementa mini-bucles; entrega cada etapa a `runStep` y reacciona a nivel estructural ante fallos o desviaciones con `handleReplan`.
- **Enrutamiento por Argmax en Eos (Decision #1):**
  - Eos resuelve la ruta por mayor probabilidad matemática entre `windows`, `desktop_commander`, `free_search` y `fin`. No se aplican umbrales arbitrarios de 0.51 o 0.60.
  - Si Eos emite `fin`, el Core valida determinísticamente si es admisible: en la primera iteración se permite como conversación directa; en iteraciones posteriores exige que existan acciones previas exitosas.
- **Inviolabilidad de Guard DENY:**
  - Si Guard emite `DENY` o el operador pulsa "Rechazar" en `GuardBanner`, el paso queda marcado como `BLOCKED` con la señal `signals.denied = true`.
  - **Prohibición de evasión:** En FAST concluye la tarea de inmediato; en PLAN detiene la tarea como `PARTIAL`/`FAILED` y queda categóricamente prohibido invocar `handleReplan` para eludir la política de seguridad.
- **Regla Determinista de Cambio Material (`isMaterialReplan`):**
  - Ante una desviación recuperable en PLAN, Qwen genera nuevas etapas para los pasos pendientes.
  - Se clasifica como **cambio material** si:
    1. Introduce herramientas que requieren autorización en Guard (`requiresApproval === true` o mutación de archivos/procesos).
    2. Incrementa en más de 3 etapas el trabajo restante.
    3. Altera sustancialmente la meta original declarada.
  - Si es material, la tarea entra automáticamente en `WAITING_INPUT` (`plan_confirmation`) requiriendo nueva aprobación del usuario. Si no es material, la ejecución continúa de forma autónoma.
- **Verificación Factual Binaria (`ok` / `cumple`):**
  - Sustituye a la anterior Decision #5.
  - Solo se consulta a Eos si las señales físicas son limpias (`isCleanSignals`). Ante excepciones, código de salida != 0, timeouts o recursos no encontrados, el Core dictamina fallo determinista directamente.
  - La respuesta de Eos se adopta por argmax ($p \ge 0.5$). Si el servicio Eos no responde pero las señales físicas son limpias, se aplica fallback determinista a éxito para evitar bloqueos por disponibilidad de red local.

---

## Límites de Ejecución y Parada Determinista

| Límite / Condición | Valor Oficial v1.3 | Semántica y Comportamiento en Runtime |
|---|:---:|---|
| `MAX_STEPS` | **15** | Límite estructural de pasos. Si `task.stepSeq >= 15`, la tarea se detiene limpiamente en estado `PARTIAL`. |
| `MAX_REPLAN` | **2** | Límite de replanificaciones acumuladas en PLAN. Si se agota, concluye la tarea en `PARTIAL`. |
| `MAX_ARG_RETRIES` | **2** | Reintentos locales en `generateArguments` reportando el error de schema previo. |
| `MAX_ESCALATIONS` | **2** | Conmutaciones de ruta en modo FAST ante fallos de herramientas. |
| `PROGRESSIVE_MEMORY_TIERS` | **2 → 5 → 10** | Recuperación progresiva del historial contextualmente relevante sin saturar la ventana del modelo. |
| `MAX_TOOL_CALLS_TASK` | **ERRADICADO** | Suprimido en Fase 2. No existen límites globales ni pools sustitutos de 30 llamadas. |
| `MAX_TOOL_CALLS_PER_STEP` | **ERRADICADO** | Suprimido en Fase 2. No existen mini-bucles de 4 llamadas por paso. |
| `DEADLINE_GLOBAL` | **NO IMPLEMENTADO** | No existe cronómetro de caducidad global por tarea. Las esperas en `WAITING_INPUT` no expiran. |

---

## Manejo de Errores y Matriz de Mitigación

| Error o Situación Anómala | Manejo en Motor FAST (`runStep`) | Manejo en Capa Coordinadora (`PLAN`) |
|---|---|---|
| **Fallo de Schema en Argumentos** | Reintenta localmente hasta 2 veces con `previousError`. Si se agota, falla el paso como `logical_error`. | Recibe `logical_error` de `runStep`, evalúa con `verifyStage` y activa `handleReplan`. |
| **Herramienta Fuera de Catálogo** | Bloquea inmediatamente con `DecisionValidationError` impidiendo despacho físico. | Detiene el plan o replanifica excluyendo la herramienta inválida. |
| **Denegación Guard o Rechazo Usuario** | Marca paso `BLOCKED`, fija `signals.denied = true` y detiene la tarea en `PARTIAL`/`FAILED`. | Detiene la tarea inmediatamente en `PARTIAL`/`FAILED`. **Prohibido replanificar.** |
| **Invocación Repetida (Anti-Loop)** | Retorna `status: "blocked_loop"`. Si ocurren 2 bloqueos seguidos, detiene la tarea en `PARTIAL`. | Tras fallo repetido, `verifyStage` clasifica bloqueo o activa replanificación con ruta alterna. |
| **Stale Element en Windows MCP** | Captura `staleElement: true`, invoca herramienta de árbol (`ui_get_window_tree`) y reintenta 1 vez. | Transparente para PLAN; se resuelve internamente dentro de `runStep`. |
| **Timeout de Transporte MCP (30s)** | Cancela el subproceso con `MCPTransportError` y marca el paso como fallido con `signals.timeout`. | Trata el timeout como desviación o fallo no recuperable según la criticidad de la etapa. |
| **Servicio Eos Inaccesible** | Si las señales físicas son limpias, aplica fallback determinista (`ok=true`, `cumple=true`). | Continúa la ejecución sin detener el flujo por indisponibilidad de Eos. |
| **Reinicio Imprevisto del Servidor** | `loadPersistedTasks` transiciona tareas en curso a `CANCELLED` y pasos a `BLOCKED`. | Previene ejecuciones fantasmas o estados corruptos tras rearranque. |

---

## Ejemplo de Traza Real de Extremo a Extremo (v1.3)

Instrucción del usuario en modo `NORMAL`: `"Busca en la web el precio actual de Bitcoin y guárdalo en un archivo btc.txt"`.

```
1. Recepción y Enrutamiento Inicial:
   → POST /api/jarvis/process {"message": "Busca en la web el precio actual de Bitcoin y guárdalo en btc.txt", "mode": "NORMAL"}
   → Core inicializa Task (id: task_174001, mode: NORMAL, state: RUNNING). Emite TASK_CREATED.
   → Decision #1 (Eos): state=[GOAL: ..., ATTEMPTS: []], questions=[route, needs_context]
   → Eos responde: route="free_search" (argmax: 89%), needs_context=0.04 (false).

2. Ejecución del Paso s1 en runStep:
   → Paso s1 instanciado (route: free_search, instruction: "Buscar precio actual de Bitcoin en la web").
   → DiscoveryEngine: cataloga herramientas activas de free_search (search, fetch, read_doc...).
   → Decision #2 (Eos): questions=[selected_tool] -> responde "search" (argmax: 95%).
   → Qwen generateArguments: recibe schema de "search", produce {"query": "Bitcoin current price USD", "max_results": 5}.
   → RefResolver: no detecta tokens en argumentos iniciales.
   → Anti-Loop: primera acción, pasa validación.
   → Guard: free_search:search -> capacidad READ -> ALLOW automático.
   → Despacho MCP stdio: envía JSON-RPC tools/call a free-search-mcp. Retorna 5 resultados web con precios.
   → ResultProcessor: extrae URL (https://coinmarketcap.com), genera finding: "5 resultados web, primero: Bitcoin USD $68,450", almacena salida completa en RefStore (r1).
   → Verificación Factual Eos: señales físicas limpias (exit_code=0) -> Eos evalúa ok=true (96%), cumple=true (93%).
   → Memoria: registra en LOG "1|search|ok|5 resultados web, primero: Bitcoin USD $68,450". FACTS: url=https://coinmarketcap.com.
   → Paso s1 transiciona a COMPLETED.

3. Siguiente Iteración en runFastLoop:
   → Decision #1 (Eos): state=[GOAL, LOG: paso 1 ok, FACTS, attempts: [free_search/search: ok]]
   → Eos responde: route="desktop_commander" (argmax: 85%).
   → Paso s2 instanciado (route: desktop_commander, instruction: "Guardar precio obtenido en btc.txt").
   → Handoff determinista: applyStepHandoff enriquece instrucción con "[HANDOFF s1 (search)]: url=https://coinmarketcap.com [ref:r1]".
   → Decision #2 (Eos): questions=[selected_tool] -> responde "write_file" (argmax: 92%).
   → Qwen generateArguments: genera {"path": "btc.txt", "content": "Precio actual Bitcoin: $68,450 USD {{ref:r1}}"}.
   → RefResolver: detecta "{{ref:r1}}", deserializa contenido de RefStore y genera el argumento real resuelto.
   → Guard: desktop_commander:write_file -> capacidad FILE_WRITE -> APPROVAL requerido.
   → Tarea pasa a WAITING_INPUT (waitingReason: "approval"), paso s2 pasa a WAITING_APPROVAL.
   → GuardBanner despliega en UI la solicitud sin temporizador de expiración.
   → Operador pulsa "Autorizar" -> POST /api/jarvis/approve.
   → Paso s2 regresa a RUNNING. Se despacha a desktop-commander vía stdio. Archivo btc.txt creado en disco.
   → ResultProcessor: finding: "Archivo btc.txt creado exitosamente". RefStore: r2.
   → Verificación Factual Eos: ok=true (98%), cumple=true (95%).
   → Memoria: registra LOG "2|write_file|ok|Archivo btc.txt creado exitosamente". Registra EFFECT "s2|write_file: Archivo btc.txt escrito".
   → Paso s2 transiciona a COMPLETED.

4. Conclusión de la Tarea:
   → Decision #1 (Eos): evalúa estado completo -> responde route="fin" (argmax: 91%).
   → Core valida condiciones de fin: 2 pasos completados satisfactoriamente, sin pasos UNVERIFIED pendientes -> Validado.
   → Qwen Etapa 6 (concludeTask): genera respuesta final en español basándose en LOG, FACTS y EFFECTS.
   → RefStore.clear("task_174001"): libera memoria volátil de la tarea.
   → Tarea transiciona a COMPLETED. Se emiten FINAL_RESPONSE y TASK_STATE_CHANGED.
```
