# REPORTE DE EJECUCIÓN Y CIERRE FORMAL: FASE 3B
**Fecha de Certificación:** 2026-10-13  
**Alcance:** Capa de Coordinación del Modo PLAN sobre el Flujo FAST, Verificación Semántica por Etapa con Qwen, Gestión de Aprobación/Rechazo/Modificación de Planes en `WAITING_INPUT`, y Replanificación Determinista Acotada por Materialidad.  
**Estado:** ✅ COMPLETADA Y CERTIFICADA (Criterios de salida 100% satisfechos).

---

## 1. Principio Rector: Separación Estricta de Coordinación y Ejecución
En conformidad con las Secciones 3.2.1, 3.2.2 y los Criterios de Aceptación 12 y 13 de `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md`:
* **FAST como Motor de Ejecución:** `runStep` (en `src/core/callExecutor.ts`) es el único responsable de la selección de herramientas, generación de argumentos con Qwen, validación contra schemas reales, políticas de Guard, anti-loop, despacho y verificaciones a nivel de paso con Eos (`ok` / `cumple`).
* **PLAN como Capa de Coordinación y Supervisión:**
  - `runPlanLoop` (en `src/core/modeEngines.ts`) actúa exclusivamente como supervisor de etapas.
  - Se eliminó cualquier mini-bucle interno o lógica duplicada de ejecución en PLAN; cada etapa se delega limpia y atómicamente a `runStep(context, step, deps)`.
  - La coordinación preserva la inviolabilidad de las políticas de Guard: si un paso resulta denegado (`signals.denied` o estado `BLOCKED`), la tarea concluye de inmediato y queda categóricamente prohibido replanificar o reintentar para eludir la denegación.

---

## 2. Aprobación, Rechazo y Modificación Interactiva del Plan (`WAITING_INPUT`)
En conformidad con la Sección 3.2.4 y los Criterios 10 y 13:
1. **Suspensión sin Temporizadores:**
   - La tarea entra en `WAITING_INPUT` (`waitingReason: "plan_confirmation"`) tras la formulación del plan por parte de Qwen (`initiatePlanMode`).
   - El operador dispone de tiempo ilimitado sin `setTimeout` ni expiraciones automáticas.
2. **Aceptación (`confirmPlan`):**
   - Transiciona la tarea a `RUNNING`, fija `planConfirmed: true` e inicia la ejecución secuencial de etapas mediante `runPlanLoop`.
   - Endpoint: `POST /api/jarvis/confirm-plan` (con soporte para `{ action: 'confirm' }`).
3. **Rechazo (`rejectPlan`):**
   - No se ejecuta ninguna etapa. La tarea transiciona limpiamente a `CANCELLED`, se limpia `RefStore` y se emite el evento `PLAN_REJECTED`.
   - Endpoints: `POST /api/jarvis/reject-plan` y `POST /api/jarvis/confirm-plan` con `{ action: 'reject', reason: '...' }`.
4. **Solicitud de Modificación (`modifyPlan`):**
   - Qwen reevalúa la solicitud incorporando la retroalimentación del usuario (`feedback`) y la estructura del plan previo.
   - Genera el plan modificado y lo vuelve a presentar en `WAITING_INPUT` (`waitingReason: "plan_confirmation"`).
   - Endpoints: `POST /api/jarvis/modify-plan` y `POST /api/jarvis/confirm-plan` con `{ action: 'modify', feedback: '...' }`.
5. **Respuestas a Consultas Interactivas (`provideUserAnswer`):**
   - Resuelve el estado `WAITING_INPUT` (`waitingReason: "user_answer"`) cuando una etapa o herramienta local requiere datos indispensables del operador.
   - Endpoint: `POST /api/jarvis/user-answer`.

---

## 3. Verificación Semántica de Etapa con Qwen (`verifyStage`)
En conformidad con la Sección 3.2.6 y el Criterio 14:
* **Principio de Verificación Factual:** Que una herramienta finalice con código de salida 0 no implica necesariamente que la etapa haya cumplido su cometido.
* **Separación de Niveles de Evaluación:**
  - Eos evalúa la validez técnica y el cumplimiento inmediato de la instrucción del paso (`ok`, `cumple`).
  - Qwen 3.5 9B (`verifyStage`) evalúa el resultado observable global de la etapa frente al `expectedOutcome` del plan.
* **Mapeo Normativo de las Cuatro Situaciones:**
  1. `completed`: La etapa cumplió su objetivo observable. El plan continúa hacia la siguiente etapa.
  2. `recoverable_deviation`: La etapa no satisfizo el criterio esperado, pero es recuperable. Activa `handleReplan`.
  3. `insufficient_info`: Falta información indispensable que no puede obtenerse autónomamente. Transiciona a `WAITING_INPUT` (`waitingReason: "user_answer"`) suspendiendo la ejecución hasta la respuesta del usuario.
  4. `unrecoverable_blocked`: Bloqueo no recuperable o violación insubsanable. Marca el paso como `BLOCKED` y concluye la tarea como `PARTIAL` o `FAILED`.

---

## 4. Replanificación Acotada y Validación de Materialidad
En conformidad con las Secciones 3.2.4, 3.2.6, 6.2 y 13.2 (Punto 10):
* **Replanificación Localizada:** Modifica exclusivamente las etapas pendientes a partir del paso fallido, conservando intactas las etapas ya completadas.
* **Regla Determinista de Cambio Material (`isMaterialReplan`):**
  Un replanteo se clasifica formalmente como material si:
  1. Propone herramientas que requieren autorización en Guard (`requiresApproval` o mutaciones sensibles).
  2. Agrega más de 3 pasos nuevos respecto a los pasos pendientes.
  3. Altera sustancialmente el objetivo general del plan.
* **Comportamiento ante Cambio Material:**
  - Si es material: La tarea entra automáticamente en `WAITING_INPUT` (`waitingReason: "plan_confirmation"`), requiriendo nueva aprobación del operador antes de continuar.
  - Si no es material: Continúa la ejecución de forma autónoma sin detenciones innecesarias.
* **Límite Estructural:** Respeto irrestricto de `MAX_REPLAN = 2`.

---

## 5. Matriz de Validación de Criterios de Salida de Fase 3B
| Requisito / Criterio | Estado | Evidencia en Código |
| :--- | :---: | :--- |
| PLAN opera como capa de coordinación sobre FAST | ✅ CUMPLIDO | `runPlanLoop` en `src/core/modeEngines.ts:593-748` delega a `runStep` |
| Sin lógica de ejecución duplicada en PLAN | ✅ CUMPLIDO | Retirado mini-bucle de ejecución; selección, validación y despacho encapsulados en `runStep` |
| Aceptación, rechazo y modificación en `WAITING_INPUT` | ✅ CUMPLIDO | `confirmPlan`, `rejectPlan`, `modifyPlan` en `core.ts` y endpoints en `server.ts:150-215` |
| Verificación por etapa con Qwen (`verifyStage`) | ✅ CUMPLIDO | `STAGE_VERIFICATION` en `prompts.ts`, `verifyStage` en `qwen.ts`, 4 estados mapeados |
| Replanificación acotada y regla de materialidad | ✅ CUMPLIDO | `isMaterialReplan` y `handleReplan` en `modeEngines.ts:205-300` |
| Prohibición absoluta de eludir Guard DENY en PLAN | ✅ CUMPLIDO | Guardas activas en `modeEngines.ts:642-647` deteniendo inmediatamente |
| Persistencia y contexto compactos | ✅ CUMPLIDO | Metadatos mínimos persistidos en `jarvis-tasks.json`, `RefStore` volátil |
| Compilación y Tipado Limpios (0 errores) | ✅ CUMPLIDO | `tsc --noEmit` exitoso; `compile_applet` (Vite build) exitoso |
