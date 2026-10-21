# Plan de Implementación — Mejora del Debug Visual de JARVIS

Este plan técnico aborda la optimización integral de la observabilidad y depuración visual en la interfaz de JARVIS, respetando estrictamente las restricciones normativas (sin cambios en backend, sin nuevas dependencias, sin romper contratos y preservando la identidad visual oscura de alta fidelidad).

---

## 1. Diagnóstico Comprobado de la Pérdida de Información Visual

La investigación sobre el código fuente reveló tres causas simultáneas por las cuales desaparecen los datos visuales:

1. **Selección excluyente del último evento en `DecisionStream.tsx` (Líneas 17–19):**
   - El componente ejecuta `[...events].reverse().find(e => e.type === "...")`, por lo que en cada nuevo paso sobrescribe las tarjetas de los pasos anteriores. Al finalizar el paso 2, las decisiones y verificaciones del paso 1 se vuelven invisibles.
2. **Buffer de eventos truncado y volátil en `useJarvis.ts` (Líneas 155 y 201):**
   - El estado `events` se trunca a 50 eventos (`slice(-49)`), descartando los primeros pasos en tareas medianas.
   - Al iniciar una nueva tarea (`runTask`) o seleccionar una tarea del historial (`selectHistoricalTask`), se ejecuta `setEvents([])`, y dado que `/api/jarvis/state` no incluye el historial de eventos en su snapshot, las tarjetas de decisiones desaparecen por completo.
3. **Desmontaje total de `StepTimeline` durante revisiones en `ProcessFlow.tsx` (Línea 56):**
   - La condición `!isAwaitingPlanConfirmation` desmonta el componente `StepTimeline` cuando se genera un plan o cuando ocurre una replanificación material (`isMaterialReplan`), haciendo que todos los pasos y resultados previos desaparezcan de la vista hasta que el usuario vuelva a confirmar.

---

## 2. Decisiones de Diseño y Arquitectura Visual (Confirmadas con el Usuario)

- **Ubicación del Historial de Modelos:** Columna central, expandiendo la sección de `DecisionStream` en un flujo de tarjetas ordenadas y auditables.
- **Organización de Iteraciones:** Agrupadas jerárquicamente por paso de ejecución (`Paso #1`, `Paso #2`...), con capacidad de colapso/expansión individual o global.
- **Visor de Contexto Actual:** Nueva pestaña **`Estado`** en el panel inferior `ContextInspector`, sincronizada en tiempo real con el estado vivo de la sesión.
- **Estilo Visual & Anti-Slop:** 
  - Tipografía monoespaciada para entradas/salidas de modelos (`font-mono`), `tabular-nums` para latencias y tokens.
  - Zero-pill discipline: metadatos limpios separados por `·`, sin cápsulas estáticas ni brillos innecesarios.
  - Botón de copiado con icono accesible y feedback reactivo temporal (2 segundos) en cada card.

---

## 3. Secuencia de Implementación Paso a Paso

### Fase 1: Estructuración y Acumulador de Iteraciones de Modelos (Frontend State)
- **Archivo:** `src/hooks/useJarvis.ts` / nuevo helper tipado `src/types/debug.ts` (o extensiones en `src/core/types.ts`).
- **Qué se hará:**
  1. Diseñar el modelo de datos `ModelIteration`:
     - `id`: identificador único (`iter_${timestamp}_${model}`).
     - `model`: `"EOS_0_8B"` | `"QWEN_3_5_9B"`.
     - `stage`: `"DECISION_ONE"` | `"DECISION_TWO"` | `"STEP_VERIFICATION"` | `"PLAN_GENERATION"` | `"ARGUMENT_GENERATION"` | `"STAGE_VERIFICATION"` | `"REPLAN"` | `"FINAL_RESPONSE"`.
     - `stepId`: `s1`, `s2`... (o `global`).
     - `stepSeq`: índice secuencial de paso.
     - `timestamp`: marca temporal exacta.
     - `input`: payload exacto enviado o reconstruido fielmente a partir de los datos disponibles en el evento/contexto (objetivo, historial, herramientas descubiertas, schema limpio, evidencia).
     - `output`: respuesta devuelta por el modelo (opción seleccionada, probabilidades, JSON de argumentos, veredicto `ok`/`cumple`, plan estructurado, texto de respuesta final).
     - `metrics`: latencia calculada, confianza, señales detectadas.
  2. Implementar un acumulador en `useJarvis` que capture y agregue iteraciones tanto a partir del flujo de SSE en vivo (`DECISION_ONE`, `DECISION_TWO`, `ARGUMENTS_GENERATED`, `RESULT_PROCESSED`, `STAGE_VERIFIED`, `PLAN_GENERATED`, `FINAL_RESPONSE`) como a partir de la reconstrucción desde `task.steps[].calls` cuando se recarga la página o se selecciona una tarea histórica.
  3. Incrementar el límite del buffer de eventos a 500 y almacenar el acumulador indexado por `taskId` para que cambiar de tarea o navegar el historial nunca borre las iteraciones previas.

### Fase 2: Corrección de la Desaparición de Pasos en `ProcessFlow.tsx`
- **Archivo:** `src/components/ProcessFlow/ProcessFlow.tsx`
- **Qué se hará:**
  1. Modificar la disposición de `PlanReview` y `StepTimeline` para que **coexistan armónicamente**:
     - Si la tarea está esperando confirmación inicial de plan, mostrar el `PlanReview` como bloque primario de aprobación.
     - Si la tarea ya cuenta con pasos ejecutados o en curso y entra en replanificación material, mantener visible el `StepTimeline` con los pasos previos completados/fallidos y renderizar el `PlanReview` como bloque contextual de revisión de las nuevas etapas propuestas, sin ocultar el trabajo ya realizado.
  2. Garantizar que los veredictos de Eos (`ok` y `cumple`) y las llamadas MCP archivadas en `step.calls` permanezcan desplegables y visibles en todo momento.

### Fase 3: Rediseño del `DecisionStream` — Historial Agrupado por Paso con Cards Independientes
- **Archivos:** `src/components/DecisionStream/DecisionStream.tsx`, nuevos componentes `ModelIterationCard.tsx` y `StepIterationGroup.tsx`.
- **Qué se hará:**
  1. Transformar `DecisionStream` para soportar tanto la vista compacta/resumen como la vista expandida con **todas las iteraciones de la sesión**.
  2. Agrupar las iteraciones por paso (`Paso #1`, `Paso #2`, `Planificación Global`, `Cierre`), mostrando un header claro con estado del paso, subsistema y conteo de llamadas.
  3. Cada card de iteración contendrá:
     - Header con distintivo de modelo (`Eos-0.8B` en cian/azul, `Qwen 3.5 9B` en violeta/índigo), etiqueta de etapa, timestamp y duración.
     - Pestañas o secciones colapsables claramente diferenciadas: **"Entrada (Prompt / Estado)"** y **"Salida (Respuesta / Decisión)"**.
     - Renderizado de JSON formateado o texto con scroll contenido y tipografía monoespaciada limpia.
     - Botón superior derecho de **"Copiar iteración"** (icono `Copy` / `Check`), que genera un JSON estructurado con `{ id, timestamp, model, stage, input, output, metrics }` y lo copia al portapapeles.

### Fase 4: Nuevo Visor de Contexto Actual en `ContextInspector`
- **Archivos:** `src/components/ContextInspector/ContextInspector.tsx`, nuevo componente `SessionStateView.tsx`.
- **Qué se hará:**
  1. Añadir la pestaña **`Estado`** en `ContextInspector` junto a las existentes (`Memoria`, `Scratchpad`, `Evidencias`, `Catálogo`).
  2. La vista de `Estado` presentará de forma consolidada e interactiva todo el contexto vivo que JARVIS mantiene:
     - **Meta Activa (`Goal`):** Instrucción original del usuario y modo (`NORMAL` / `PLAN`).
     - **Historial Continuo (`LOG`):** Líneas completas registradas (hasta 30 entradas), con estado y hallazgo.
     - **Último Resultado Observable (`Last Result / Obs`):** Última observación compacta generada y herramientas previas.
     - **Hechos Extraídos (`FACTS`):** Pares clave-valor confirmados (`path`, `win`, `pid`, `url`, etc.).
     - **Efectos Secundarios (`EFFECTS`):** Mutaciones aplicadas en disco o procesos.
     - **Variables Operativas (`Scratchpad`):** Pizarra de trabajo en memoria.
     - **Registro de Fallos (`FAIL`):** Errores recientes o denegaciones de Guard.
  3. Botón de copiado integral para volcar todo el contexto actual en formato Markdown o JSON de depuración.

### Fase 5: Pruebas de Integración y Verificación Rigurosa
- **Verificación empírica:**
  1. Ejecución de tareas con múltiples pasos en modo FAST y en modo PLAN para comprobar que todas las iteraciones de Eos y Qwen permanecen en pantalla.
  2. Comprobar que pausar por aprobación (`WAITING_APPROVAL`) o confirmación de plan (`WAITING_INPUT`) no oculta la información previa.
  3. Comprobar que seleccionar tareas históricas en `HistoryMenu` restaura correctamente los pasos y sus iteraciones.
  4. Probar la función de copiado en todas las cards y validar que el contenido copiado contenga entrada y salida completas.
  5. Ejecutar `tsc --noEmit` y `compile_applet` para garantizar 0 regresiones.

---

## 4. Archivos Afectados

| Archivo | Naturaleza del Cambio |
|---|---|
| `src/hooks/useJarvis.ts` | Almacenamiento no destructivo de iteraciones y sincronización SSE/snapshot. |
| `src/components/ProcessFlow/ProcessFlow.tsx` | Coexistencia de `StepTimeline` y `PlanReview` sin desmontaje de datos. |
| `src/components/DecisionStream/DecisionStream.tsx` | Flujo cronológico agrupado por paso con tarjetas independientes. |
| `src/components/DecisionStream/components/ModelIterationCard.tsx` | Card individual para iteración de Eos/Qwen con botón de copiado. |
| `src/components/DecisionStream/components/StepIterationGroup.tsx` | Contenedor colapsable por paso de ejecución. |
| `src/components/ContextInspector/ContextInspector.tsx` | Incorporación de la pestaña `Estado`. |
| `src/components/ContextInspector/components/SessionStateView.tsx` | Vista en tiempo real del contexto completo de JARVIS. |
