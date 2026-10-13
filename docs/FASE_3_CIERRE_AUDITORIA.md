# REPORTE DE EJECUCIÓN Y CIERRE FORMAL: FASE 3
**Fecha de Certificación:** 2026-10-13  
**Alcance:** Motor Unificado (`runStep`), Integración de Eos (Argmax), Verificación Factual (`ok` / `cumple`), Esperas `WAITING_INPUT` sin Timers y Migración de Escalación.  
**Estado:** ✅ COMPLETADA Y CERTIFICADA (Criterios de salida 100% satisfechos).

---

## 1. Mapeo y Cobertura de Responsabilidades de Ejecución (`runStep`)
Se verificó en el código fuente la unificación de la ejecución de pasos mediante la función atómica `runStep` en `src/core/callExecutor.ts`. Todas las responsabilidades operativas de ejecución previamente dispersas han quedado integradas en una secuencia canónica sin duplicaciones ni regresiones:

1. **Resolución Determinista y Catálogo Activo:**
   - Determinación del subsistema destino a partir de la ruta del paso o conmutaciones activas (`activeServerOverride`).
   - Obtención dinámica del catálogo real mediante `DiscoveryEngine` para servidores MCP externos (`windows`, `desktop_commander`, `free_search`) o catálogo plano local para herramientas internas (`recall`, `compose`, `ask_user`).
   - Filtrado automático de herramientas excluidas por fallos previos (`excludedToolForNextCall`).

2. **Selección de Herramienta en Eos (Argmax sin Umbrales):**
   - Resolución determinista directa por código si existe un candidato único disponible (`discoveredTools.length === 1`), emitiendo confianza 1.0 sin invocar HTTP.
   - Consulta a Eos mediante pregunta `choice` (`selected_tool`) cuando hay múltiples candidatos válidos.
   - Elección estricta por mayor probabilidad (argmax) sin umbrales arbitrarios de corte.
   - **Validación Estricta:** Verificación forzosa de que la herramienta seleccionada exista en el catálogo de descubrimiento activo (`validateToolExists`); ante discrepancia o herramienta no descubierta, la ejecución es denegada categóricamente (`DecisionValidationError`).

3. **Generación Limpia de Argumentos con Qwen:**
   - Inyección exclusiva del schema limpio (`cleanInputSchema`), suprimiendo `$schema`, `title`, `additionalProperties` y `examples`.
   - Soporte de reintentos locales de formato (`MAX_ARG_RETRIES = 2`) y señal de cancelación (`AbortSignal`).

4. **Prevención Factual de Bucles (Anti-Loop):**
   - Validación determinista con firma compuesta `${serverName}:${toolName}:${args}:m${nonReadCounter}`.
   - Distinción entre operaciones de lectura (`READ`) y mutación (`MUTATION`/`PROCESS_CONTROL`), impidiendo la repetición de acciones idénticas sin lecturas intermedias.

5. **Evaluación de Políticas de Seguridad (Guard):**
   - Inspección estricta de argumentos resueltos contra `PolicyRegistry`.
   - Veredicto `DENY`: bloqueo inmediato (`BLOCKED`, `signals.denied = true`), registrando el fallo y prohibiendo reintentos o replanteos para eludirlo.
   - Veredicto `APPROVAL`: transición a `WAITING_INPUT` (`waitingReason: "approval"`), suspendiendo la tarea indefinidamente sin temporizadores de caducidad hasta la decisión explícita del usuario (`approve` / `deny`).

6. **Despacho y Recuperación Local:**
   - Invocación a subprocesos MCP por stdio o handlers locales con captura estructurada de stdout/stderr.
   - Recuperación de stale element en Windows (`ui_get_window_tree` / refresh de snapshot) ante desincronización de handle.

7. **Procesamiento de Resultados y Extracción de Evidencias:**
   - Normalización estructurada mediante `ResultProcessor.process`.
   - Almacenamiento de referencias temporales en memoria (`RefStore.store`) acotado por `taskId`.
   - Actualización de `scratchpad`, `facts` y línea compacta en `LOG`.

8. **Verificación Factual con Eos (`ok` y `cumple`):**
   - Clasificación de señales técnicas físicas (`isCleanSignals`). Ante errores directos, código de salida != 0, timeouts o denegaciones, el Core gestiona el resultado determinísticamente sin consultar a Eos.
   - Sobre señales limpias (CLEAN), consulta binaria `noul` a Eos evaluando validez técnica/semántica (`ok`) y cumplimiento del criterio del paso (`cumple`).
   - Resolución por mayor probabilidad (argmax: $p \ge 0.5$) sin umbrales numéricos de corte.

---

## 2. Supresión de Umbrales Numéricos y Decisión por Argmax en Eos
Conforme a la Sección 4.2 y la Sección 10 de `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md`:
* **Decision #1 (`evaluateDecisionOne`):**
  - Eliminados los filtros `DECISION_MIN_CONFIDENCE` (0.51) y `DECISION_MIN_CONFIDENCE_POST_ACTION` (0.60) sobre la opción `fin`.
  - La opción seleccionada por Eos se acepta directamente por mayor probabilidad. Si Eos emite una opción fuera de catálogo, el Core selecciona la ruta válida con mayor probabilidad en la distribución.
  - La señal `needsContext` se evalúa estrictamente por argmax binario ($p \ge 0.5$).
* **Decision #2 (`evaluateDecisionTwo`):**
  - Resuelve la herramienta con mayor probabilidad devuelta por Eos.
  - Validación rígida contra las opciones suministradas en el prompt (`validateResponse`).
* **Decision #5 (Supresión de Override):**
  - Eliminado el override forzado que convertía fallos en éxitos cuando `confidence < 0.50 && exit_code === 0`.
  - Decision #5 queda formalmente deprecada y sustituida por la verificación factual `ok` y `cumple` sobre señales limpias en `runStep`.
* **Verificación de Etapa en PLAN (`evaluatePlanJudgement`):**
  - Evalúa `expected_outcome` mediante argmax binario (`cumple` vs `no_cumple`) sin umbrales numéricos de corte.

---

## 3. Estado `WAITING_INPUT` sin Temporizadores
Se ratificó y certificó la suspensión limpia sin temporizadores en todos los escenarios de interacción:
1. **Aprobación de Guard (`waitingReason: "approval"`):**
   - Implementada mediante promesa suspendida en `requestUserApproval`.
   - No contiene `setTimeout`, cronómetros de expiración ni rechazos por tiempo. La tarea espera de forma ilimitada la acción del usuario vía `POST /api/jarvis/approve` o `POST /api/jarvis/deny`.
2. **Confirmación de Plan (`waitingReason: "plan_confirmation"`):**
   - La tarea entra en `WAITING_INPUT` tras generar el plan y permanece en espera ilimitada hasta la invocación de `POST /api/jarvis/confirm-plan` o cancelación explícita.
3. **Pregunta al Usuario (`waitingReason: "user_answer"`):**
   - Herramienta local `ask_user` suspende limpiamente la ejecución para recibir la entrada interactiva del operador.

---

## 4. Migración de Escalación a Código y Eos
Se auditó exhaustivamente la función `handleEscalation` en `src/core/modeEngines.ts`:
* **Cobertura Completa de Responsabilidades:**
  - `qwenEngine.escalate` se limitaba a devolver `{ action: "switch_mcp" | "abort", mcp }` tras generar JSON con Qwen.
  - En el nuevo diseño, la escalación está 100% migrada al Core determinista y al arbitraje de Eos Decision #1:
    - **Protección de Seguridad:** Si `execResult.signals?.denied` es verdadero, no se reintenta ni conmuta para eludir seguridad; la tarea concluye de inmediato.
    - **Memoria Progresiva:** Expande automáticamente el contexto relevante (2 → 5 → 10 elementos) con `expandMemoryContext`.
    - **Límite de Escalaciones:** Acotado rigurosamente por `MAX_ESCALATIONS = 2`.
    - **Exclusión Local:** Excluye la herramienta fallida de la siguiente selección (`excludedToolForNextCall`).
    - **Arbitraje Rápido con Eos:** Evalúa alternativas viables mediante `evaluateDecisionOne`. Si Eos sugiere conmutación de subsistema, conmuta a la nueva ruta; si sugiere `fin`, concluye la tarea.
    - **Conmutación Determinista de Respaldo:** Si Eos falla o no cambia de ruta, el Core conmuta determinísticamente a un subsistema no fallido alternativo (`fallbackRoutes`).
* **Seguridad en PLAN:** Se incorporó en `runPlanLoop` la verificación estricta de que un paso denegado (`signals.denied` o `step.state === "BLOCKED"`) detiene la tarea inmediatamente y jamás invoca `handleReplan`.
* **Deprecación Formal:** `deps.qwenEngine.escalate` queda documentada como deprecada en `ILLMClient` y `QwenEngine`, demostrándose que no quedan llamadas activas en el runtime.

---

## 5. Matriz de Validación de Criterios de Salida de Fase 3
| Requisito / Criterio | Estado | Evidencia en Código |
| :--- | :---: | :--- |
| `runStep` como bucle atómico unificado | ✅ CUMPLIDO | `src/core/callExecutor.ts:112-504` ejecutado en FAST y PLAN |
| Responsabilidades auditadas y cubiertas | ✅ CUMPLIDO | Mapeo 1:1 formalizado en este informe y en `FASE_0_CIERRE_AUDITORIA.md` |
| Selección en Eos por Argmax sin umbrales | ✅ CUMPLIDO | `src/core/decision.ts:180-230, 410-476`; eliminación de `DECISION_MIN_CONFIDENCE` |
| Verificación binaria `ok` / `cumple` sobre CLEAN | ✅ CUMPLIDO | `src/core/callExecutor.ts:383-421`, `src/core/decision.ts:320-368` ($p \ge 0.5$) |
| `WAITING_INPUT` sin temporizadores | ✅ CUMPLIDO | Suspensión pura en `callExecutor.ts:42-71`, `modeEngines.ts:528-534` |
| Prohibición de eludir Guard DENY en PLAN | ✅ CUMPLIDO | `src/core/modeEngines.ts:618-623` detiene de inmediato sin replanificar |
| Migración de escalación a código y Eos | ✅ CUMPLIDO | `handleEscalation` en `modeEngines.ts:119-197`; `escalate` deprecado en `qwen.ts` |
| Compilación y Tipado Limpio (0 errores) | ✅ CUMPLIDO | `tsc --noEmit` exitoso; `compile_applet` (Vite) exitoso |
