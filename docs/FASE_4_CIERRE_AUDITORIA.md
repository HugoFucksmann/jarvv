# REPORTE DE EJECUCIÓN Y CIERRE FORMAL: FASE 4
**Fecha de Certificación:** 2026-10-13  
**Alcance:** Manejo Factual, Sustitución de Referencias {{ref:rX}}, Consolidación de Memoria (LOG continuo, FACTS, effects), Handoff Determinista y Reintentos sin Evasión de Seguridad.  
**Estado:** ✅ COMPLETADA Y CERTIFICADA (Criterios de salida 100% satisfechos).

---

## 1. Sustitución de Referencias Temporales {{ref:rX}} antes de Guard

En estricta conformidad con la Sección 3, la Sección 11 (Fase 4) y el Criterio de Aceptación 7 de `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md`:
* **Módulo `RefResolver` (`src/core/processor/refResolver.ts`):**
  - Implementa la función determinista `resolveReferences(args, taskId)` que recorre de forma recursiva (objetos, arreglos y cadenas escalares) los argumentos generados por Qwen.
  - Soporta sintaxis estándar `{{ref:rX}}`, variantes compactas `{{rX}}` y referencias literales exactas `ref:rX`.
  - Si el contenido referenciado en `RefStore` corresponde a una estructura JSON válida, se parsea e inserta como objeto/arreglo nativo; si es texto libre, se inyecta la transcripción íntegra en la cadena.
  - Las referencias no existentes se registran en `unresolvedRefs` sin abortar la ejecución, emitiendo una advertencia explícita.
* **Integración en el Motor Unificado `runStep` (`src/core/callExecutor.ts:235-246`):**
  - La sustitución de referencias se ejecuta inmediatamente después de la generación de argumentos (`deps.qwenEngine.generateArguments`) y **estrictamente antes** de la comprobación anti-bucles y de la evaluación de políticas de seguridad (`Guard.evaluate`).
  - **Garantía de Seguridad:** `Guard` inspecciona los argumentos reales y completamente resueltos (rutas verdaderas, comandos terminales decodificados, scripts desempaquetados), imposibilitando que comandos destructivos o accesos a rutas prohibidas se oculten tras tokens sintéticos.

---

## 2. Consolidación de Capas de Memoria Factual (LOG Continuo, FACTS y Effects)

En conformidad con las Secciones 3.2.5, 7.1, 7.2 y 11:
* **LOG Continuo sin Colapso Estadístico Prematuro (`src/core/context.ts:60-70`):**
  - Se eliminó el mecanismo legado que colapsaba agresivamente las líneas del historial cuando superaban 12 entradas en un resumen numérico `1-N: X ok, Y err`.
  - Ahora se conserva el historial textual continuo completo con todas sus herramientas, códigos de salida y hallazgos (`finding`) hasta 30 entradas, cubriendo holgadamente el límite estructural de `MAX_STEPS = 15` sin degradación de detalle semántico.
* **Capa de Efectos Secundarios Confirmados (`effects`):**
  - Tipada en `types.ts:131` dentro de `TaskMemory` e inicializada en `core.ts:117, 327`.
  - Cuando una llamada concluye con éxito y ejecuta mutaciones sobre el entorno (`policy.mutates || policy.capability !== "READ"`), se invoca `addEffectEntry(context, ...)` registrando el identificador del paso, la herramienta y el efecto aplicado (`callExecutor.ts:486-489`).
  - Los efectos acumulados se inyectan en los prompts de generación de argumentos (`PROMPTS.ARGUMENTS`) y en la redacción de la respuesta final (`PROMPTS.FINAL_RESPONSE`).
* **FACTS y Almacén `RefStore`:**
  - `RefStore` (`src/core/processor/resultProcessor.ts:29-75`) incorpora los métodos auxiliares `has` y `list` por `taskId`.
  - Los hechos deterministas (`factsDelta`: `path`, `win`, `el`, `pid`, `url`, `cand`) se propagan a `task.memory.facts` y alimentan las decisiones de los modelos.

---

## 3. Handoff Determinista entre Pasos Completados

En conformidad con la Sección 11 (Fase 4, Acción 4):
* **Estructura Tipada `StepHandoff` (`src/core/types.ts:64-72`):**
  - Define `fromStepId`, `tool`, `finding`, `primaryFact` (primer hecho clave extraído, ej. `path=...`), `refKey`, `factsDelta` y `timestamp`.
  - Se asocia formalmente al paso ejecutado (`step.handoff`) y al contexto de ejecución (`context.lastHandoff`).
* **Función de Aplicación de Handoff (`applyStepHandoff` en `src/core/context.ts:182-211`):**
  - Cuando se prepara la instrucción de un nuevo paso, enriquece determinísticamente el prompt con los datos del paso previo inmediato (`[HANDOFF sX (tool)]: finding | key=value [ref:rX]`).
  - Si el paso declara dependencias explícitas (`dependencies: ["s1", "s2"]`), extrae los resúmenes y referencias de todos los pasos precedentes indicados.

---

## 4. Encadenamiento en PLAN y Frontera Técnica de Reintentos vs Replanificación

En conformidad con las Secciones 3.2.5, 6.1, 6.2 y 13.2 (Puntos 6 y 19):
* **Encadenamiento y Detección de Invalidación de Dependencias (`src/core/modeEngines.ts:610-635`):**
  - Antes de entregar una etapa a `runStep`, `runPlanLoop` valida determinísticamente que todas las etapas listadas en `step.dependencies` se encuentren en estado `COMPLETED`.
  - Si alguna dependencia no fue satisfecha con éxito (por ejemplo, falló o fue omitida), se detecta la **invalidación de dependencias** conforme a la Sección 6.2 y se activa automáticamente la replanificación acotada (`handleReplan`) en lugar de despachar una etapa condenada al fracaso.
* **Frontera Técnica entre FAST y PLAN:**
  1. **Nivel de Paso (Flujo FAST):**
     - Reintentos locales acotados: errores de schema de argumentos gestionados en `generateArguments` (`MAX_ARG_RETRIES = 2`).
     - Recuperación técnica de UI: refresco del árbol de accesibilidad en Windows ante `stale_element` (`callExecutor.ts:347-361`).
     - Señales limpias vs errores técnicos gestionados determinísticamente sin consultar a Eos.
  2. **Nivel de Etapa (Capa PLAN):**
     - Replanificación estructural acotada por `MAX_REPLAN = 2` y por la regla de cambio material (`isMaterialReplan`).
     - Activada únicamente cuando los mecanismos de FAST se agotan, cuando una etapa sufre una desviación recuperable evaluada por Qwen (`verifyStage`), o cuando el fallo de un paso invalida las dependencias de etapas posteriores.

---

## 5. Auditoría de Seguridad: Prohibición Absoluta de Eludir Guard DENY

En conformidad con las Secciones 3.2.7, 6.2 y el Criterio 7 de Aceptación:
* Se certificó empíricamente contra el código fuente (`callExecutor.ts:269-307`, `modeEngines.ts:129-135, 641-647`):
  1. Si `Guard` emite `DENY` o el usuario rechaza la acción en `APPROVAL`, el paso queda marcado irreversiblemente como `BLOCKED` con la señal `signals.denied = true`.
  2. En FAST: `handleEscalation` comprueba `if (execResult.signals?.denied)` y concluye la tarea inmediatamente como `PARTIAL` o `FAILED` sin reintentar ni conmutar de subsistema.
  3. En PLAN: `runPlanLoop` comprueba `if (execResult.signals?.denied || step.state === "BLOCKED")` y concluye la tarea inmediatamente como `PARTIAL` o `FAILED` sin invocar jamás `handleReplan`.
  4. Ninguna replanificación ni sustitución de argumentos puede eludir una denegación de seguridad.

---

## 6. Matriz de Validación de Criterios de Salida de Fase 4

| Requisito / Acción de Fase 4 | Estado | Evidencia en Código y Pruebas |
| :--- | :---: | :--- |
| Sustitución de referencias `{{ref:rX}}` antes de Guard | ✅ CUMPLIDO | `refResolver.ts:1-100`, `callExecutor.ts:236-246`; evaluado en `test-phase4.ts` |
| Argumentos resueltos validados por Guard | ✅ CUMPLIDO | `Guard.evaluate(server, tool, args)` recibe `args` post-sustitución (`callExecutor.ts:277`) |
| Consolidación de LOG continuo sin colapso prematuro | ✅ CUMPLIDO | `context.ts:60-70`; 15 pasos conservados sin colapso `1-N` verificado en `test-phase4.ts` |
| Registro de efectos secundarios (`effects`) | ✅ CUMPLIDO | `types.ts:131`, `context.ts:74-84`, `callExecutor.ts:486-489`, `prompts.ts:64, 85, 119, 176` |
| Handoff determinista entre pasos | ✅ CUMPLIDO | `StepHandoff` en `types.ts:64`, `applyStepHandoff` en `context.ts:182`, inyectado en `callExecutor.ts:211` |
| Encadenamiento de etapas y verificación de dependencias en PLAN | ✅ CUMPLIDO | `modeEngines.ts:610-635` valida dependencias previas antes de despachar cada etapa |
| Reglas de reintentos acotadas sin eludir Guard DENY | ✅ CUMPLIDO | `callExecutor.ts:269-307`, `modeEngines.ts:129-135, 641-647`; DENY jamás reintentado |
| Suite de pruebas automatizada de Fase 4 | ✅ CUMPLIDO | `test-phase4.ts`: 18/18 aserciones superadas exitosamente (código de salida 0) |
| Compilación y tipado estricto sin errores | ✅ CUMPLIDO | `tsc --noEmit` limpio (0 errores); `compile_applet` (Vite) exitoso |

**Criterio de Salida de Fase 4:** **100% CUMPLIDO Y CERTIFICADO**.  
El sistema cuenta con transferencia factual robusta, sustitución de referencias validada por Guard, memoria continua y handoff determinista, quedando listo para la **Fase 5: Interfaz de Usuario y Sincronización en Tiempo Real**.
