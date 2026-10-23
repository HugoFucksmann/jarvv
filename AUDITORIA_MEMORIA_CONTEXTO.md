# Auditoría de Memoria y Contexto (`src`) — Documento derivado

> Documento derivado de `docs/AUDITORIA_MEMORIA_CONTEXTO_TRAZA.md` (Pasada 4, verificación adversarial), que se conserva intacto como fuente histórica. Este archivo es solo una **reorganización**: el contenido se copió tal cual; no se verificaron hallazgos contra el código ni se agregaron hallazgos nuevos.
> Documento hermano: `docs/AUDITORIA_TRAZA.md`.

## 1. Encabezado

### 1.1. Alcance
Estructuras que usa el core de `src` para construir lo que recibe cada llamada a modelo (Eos y Qwen): `task.memory.{log,facts,effects,fail}`, `context.dataObs`, `context.lastHandoff`, `context.lastCall*`, `task.scratchpad`, `RefStore`, `executedSignatures`, `nonReadCounter`, y los prompts que las consumen.

Quedan fuera (ver `AUDITORIA_TRAZA.md`): `jarvis-traces.jsonl` (`src/core/taskTrace.ts`) y su consumidor `lab`. El botón "Copiar auditoría" de la UI es un tercer artefacto (solo UI; sin complejidad para el backend; usa `modelIterations`, que el front ya tiene).

### 1.2. Regla rectora
**CERO líneas de código modificadas** en `src/`, `ui/`, `lab/` ni `server.ts` en esta fase. Únicamente se actualizan documentos analíticos.

### 1.3. Reglas de trabajo para agentes
- No ejecutar tests; solo `npm run lint` (`tsc --noEmit`).
- No agregar funcionalidades nuevas.
- No hacer suposiciones.
- Pegar evidencia real (salidas de comandos, líneas de código).
- Realizar búsquedas globales antes de modificar cualquier cosa.
- Soluciones definitivas y simples.

### 1.4. Estado heredado del original
- Última actualización del original: 2026-10-22 15:45 (UTC-7). Fase: Pasada 4 — verificación adversarial.
- Comprobación de tipos del original: `npm run lint` (`tsc --noEmit`) → exit code `0`.

---

## 2. Bitácora de progreso (fichas e ítems de este documento)

Fecha de última actualización de este documento (reorganización): 2026-10-22. Los estados se copiaron del original.

| Ficha / Ítem | Estado de Verificación | Resumen del Diagnóstico Adversarial (copiado) |
|---|:---:|---|
| **INC-001** (Aislamiento `RefStore`) | **CONFIRMADO** | En el runtime actual todos los llamadores activos proveen `task.id`. El método `RefStore.get` mantiene un bucle fallback `for (const store of this.taskStores.values())` y `RefStore.put` un default `"default"`. Representa una brecha de defensa en profundidad. Se mantiene en Fase 1 (A.2). |
| **INC-005** (Prefix Cache en prompts) | **CONFIRMADO** (Pendiente) | El orden actual en `prompts.ts:220-241` intercala `PLAN` y `DATA` antes de bloques estables (`FACTS`, `LOG`, `FAIL`), degradando el KV-cache. Queda en Fase 3 pendiente de decisión del usuario (A.5). |
| **INC-006** (Sanitización `factsDelta` y Handoff) | **CORREGIDO** | Se demostró que `finding` ya viene sanitizado con `sanitizeForMemory` en `resultProcessor.ts` y `refNote` es sintético (`rX`). La única brecha real externa está en `factsDelta.url` y `factsDelta.cand`. Se ajustó la solución para no usar `sanitizeForMemory(..., 120/200)` que corrompe URLs truncándolas con `...`. |
| **INC-007** (Hechos sin veredicto `noVerdict`) | **CONFIRMADO** (Decisión P5) | Contradicción doc-vs-doc entre `CORE_FLOW.md:24` y `CONTEXT_AND_MEMORY.md:9`. El código en `callExecutor.ts:485` se mantiene intacto; se documenta formalmente la excepción en Bloque B. |
| **INC-008** (Código muerto `persistence.ts`) | **CONFIRMADO** (Decisión P2) | Verificado con búsqueda global: 0 imports, 0 referencias en dependencias, scripts o dynamic imports. Se programa su eliminación en Fase 1 (A.9). |
| **INC-009** (Campos huérfanos en `types.ts`) | **CORREGIDO** | Se verificaron con `grep` literal 0 usos de `Scratchpad.selected_result` y `Scratchpad.text`. Por el contrario, `Step.rawInput/rawOutput` y `StepCall.rawInput/rawOutput` son leídos por `ui/utils/debugAccumulator.ts:73, 102, 119, 141`, por lo que deben conservarse como opcionales en `types.ts`. |
| **INC-013** (Constantes dispersas) | **CORREGIDO** | Se verificaron los archivos reales: unificar `MAX_TOOL_DESC_CHARS = 80` requiere tocar `types.ts`, `context.ts`, `manifest.ts:40` y `prompts.ts:53`. Se lista exhaustivamente en A.1. |
| **INC-014** (`lastHandoff` tras fallo) | **CORREGIDO** (Pendiente) | Se detectó que si `noVerdict === true` (evaluador caído), `isStepSuccess` es `false`. Invalidar el handoff a ciegas rompería el contexto contiguo incluso cuando la herramienta corrió limpia (P5). Se formula como INTERPRETACIÓN abierta para el usuario. |
| **A.1** | Cubre INC-009 e INC-013 | Fase 1 |
| **A.2** | Cubre INC-001 | Fase 1 |
| **A.3** | Cubre INC-006 | Fase 1 |
| **A.9** | Cubre INC-008 | Fase 1 |
| **A.4** | Cubre INC-014 | Fase 3 — pendiente de decisión del usuario |
| **A.5** | Cubre INC-005 | Fase 3 — pendiente de decisión del usuario |

---

## 3. Los tres artefactos del sistema: deslinde y relaciones

Tabla copiada del original. Los tres artefactos tienen ciclo de vida, formato y consumidores estrictamente independientes:

| Artefacto | Consumidor Exclusivo | Fuente de Datos Primaria | Vida Útil / Almacenamiento | Propósito y Naturaleza |
|---|---|---|---|---|
| **1. Botón "Copiar auditoría" (UI)** | Usuario / Operador humano de la interfaz gráfica web. | `task.modelIterations` (recibido por SSE `/api/jarvis/events` o cargado vía `/api/jarvis/state`). | Volátil (memoria RAM del navegador; retenido en backend hasta `MAX_RETAINED_TASKS = 20`). | Árbol JSON enriquecido con títulos de etapa legibles, métricas visuales, resúmenes de contexto y variables de scratchpad para inspección interactiva. No consume disco. |
| **2. Traza persistida (`jarvis-traces.jsonl`)** | Exclusivamente el subsistema de optimización de prompts (`lab/extract-cases.ts`). | `task.modelIterations` y `task.steps[].calls` serializados por `src/core/taskTrace.ts:64-77`. | Append-only en disco local (`jarvis-traces.jsonl`). Se escribe exactamente una vez por tarea terminada. | Líneas planas JSONL con entradas y salidas crudas (`rawInput`/`rawOutput`) de red para extracción y benchmarking de prompts en `lab`. |
| **3. Contexto y Memoria de Ejecución** | El motor de inferencia y orquestación backend (`src/core/`). | `TaskExecutionContext`, `task.memory` (`log`, `facts`, `fail`, `effects`), `context.dataObs`, `RefStore`. | Volátil en memoria RAM durante la vida activa de la tarea. Expulsada al superar cupo. | Estructuras en memoria podadas bajo presupuestos estrictos de caracteres para ensamblar los prompts hacia Qwen y Eos. |

> **Principio de No Inconsistencia** (copiado): El hecho de que el Botón (1) y la Traza (2) tengan esquemas y formatos distintos **NO es una inconsistencia**, sino un diseño deliberado adaptado a sus respectivos consumidores. Ambos comparten el mismo origen en memoria (`modelIterations`), por lo que cualquier adición o corrección a ese array (ej. la etapa `REPLAN` en INC-003) beneficia a ambos sin requerir duplicidades.

---

## 4. Flujo core de referencia (ancla contra la que se juzga todo)

> Esta sección es idéntica en `AUDITORIA_TRAZA.md`.

### 4.1. Según `docs/CORE_FLOW.md`

**Ciclo de vida**
1. **Recepción e inicio**: La instrucción del usuario ingresa al sistema y se registra una tarea activa en memoria.
2. **Selección de estrategia**: Según la modalidad seleccionada, el sistema activa la orquestación reactiva directa o la orquestación deliberativa por etapas.
3. **Planificación previa (solo modalidad deliberativa)**: El razonador formula una secuencia de etapas con criterios observables de éxito y la tarea se suspende a la espera de confirmación, ajuste o rechazo humano.
4. **Ejecución iterativa de pasos**: Cada acción individual atraviesa el pipeline indivisible del ejecutor atómico de herramientas.
5. **Evaluación de resultados**: Se contrasta el resultado técnico observable mediante el clasificador factual y, en modalidad deliberativa, mediante el supervisor semántico.
6. **Resolución de contingencias**: Los fallos recuperables activan escalación con cambio de ruta o replanificación autónoma; las dudas sobre información esencial suspenden la tarea para consultar al usuario.
7. **Conclusión y síntesis**: Al completarse los objetivos o alcanzarse un límite operativo, el sistema sintetiza una respuesta final con la evidencia acumulada y asienta la traza de la tarea.

**Bucle principal** — En cada ciclo de ejecución:
1. **Determinación de acción**: En modo reactivo, el clasificador evalúa el historial para elegir el destino operativo o declarar el fin. En modo deliberativo, se toma la etapa pendiente del plan vigente.
2. **Validación de fin**: La finalización reactiva requiere que exista al menos una acción productiva previa comprobada y que no existan pasos no verificados sin observar. De no cumplirse, la finalización se deniega y se fuerza a continuar con la ruta más adecuada.
3. **Pipeline atómico del paso**:
   - Selección de herramienta dentro del destino asignado.
   - Generación de argumentos estructurados conforme al esquema.
   - Sustitución determinista de tokens por contenidos del almacén de referencias.
   - Control anti-bucle: bloqueo de lecturas idénticas o acciones repetidas sin lecturas intermedias de confirmación.
   - Evaluación en la compuerta de seguridad (Guard): denegación terminal ante comandos destructivos o suspensión interactiva ante mutaciones sensibles.
   - Despacho hacia el servidor de herramientas bajo control de cancelación cooperativa.
   - Procesamiento de la salida cruda, extracción de hechos y aislamiento de cargas masivas.
4. **Verificación y memoria**: Verificación factual del resultado observable. Consolidación de hechos si la acción fue validada, si no hubo veredicto o si produjo una mutación física en el entorno.
5. **Corte o continuación**: El bucle prosigue mientras existan etapas pendientes o alternativas viables, y se detiene ante objetivo cumplido, cancelación del usuario, agotamiento de cotas operativas de pasos o bloqueos de seguridad.

**Rol del plan en el flujo**
- **Generación**: El razonador descompone la solicitud en etapas secuenciales con ruta asignada y criterio observable de éxito.
- **Intervención humana previa**: La tarea suspende su ejecución hasta que el usuario confirma el plan, solicita ajustes o lo cancela.
- **Ejecución y doble juez**: Cada etapa del plan se envía al ejecutor atómico. La verificación técnica factual es evaluada primero por el clasificador; si este no aprueba o no está disponible, el razonador evalúa semánticamente si la evidencia satisface el objetivo de la etapa.
- **Clarificación interactiva**: Si el razonador dictamina falta de información esencial del usuario, la tarea se suspende formulando una pregunta puntual. Al recibir la respuesta, esta se asienta como hecho, se incorpora a la instrucción de la etapa y la ejecución se reanuda. Si se alcanza el límite de preguntas permitidas, la situación se procesa como desviación y se activa replanificación.
- **Replanificación autónoma**: Ante una desviación técnica o semántica, el razonador reestructura exclusivamente las etapas pendientes. Las etapas completadas jamás se repiten y las mutaciones físicas consolidadas en el entorno se transmiten intactas para no duplicar acciones destructivas. El plan ajustado prosigue de manera autónoma sin requerir confirmación interactiva.

**Estados y transiciones**

| Estado Inicial | Transición | Estado Destino | Condición |
|---|---|---|---|
| Ninguno | Inicialización | En ejecución | Se crea la tarea y comienza la orquestación. |
| En ejecución | Suspensión interactiva | En espera de intervención | El plan inicial requiere aprobación, una herramienta sensible exige confirmación de seguridad, o se requiere una respuesta aclaratoria del usuario. |
| En espera de intervención | Reanudación interactiva | En ejecución | El usuario autoriza la mutación, confirma el plan, remite ajustes o provee la aclaración requerida. |
| En ejecución | Conclusión exitosa | Completada | Se cumplen los criterios observables de la tarea con todas las etapas vigentes verificadas. |
| En ejecución | Conclusión parcial | Parcial | Se alcanza la cota máxima de pasos permitidos, persisten bloqueos reiterados de bucle, o el plan concluye con etapas no verificadas. |
| En ejecución | Fallo terminal | Fallida | Acción denegada por patrón prohibido, rechazo expreso del usuario en la compuerta de seguridad, agotamiento de intentos de replanificación o error no recuperable. |
| En ejecución o En espera | Cancelación | Cancelada | El usuario interrumpe la tarea explícitamente en cualquier momento. |

**Errores y límites**
- **Transporte hacia modelos**: Los fallos transitorios de red o saturación temporal se reintentan una vez con espera progresiva antes de catalogar el servicio como no disponible. El agotamiento de tiempo de espera y la cancelación nunca se reintentan.
- **Salidas inválidas de modelos**: Si la respuesta de un modelo no respeta el esquema esperado o se corta, se efectúa un reintento correctivo inyectando el motivo del desvío en la siguiente invocación.
- **Escalación reactiva**: Ante un fallo de herramienta en modo reactivo, la herramienta fallida se excluye de la siguiente iteración, se amplía el contexto recuperado y el clasificador arbitra una ruta alternativa. Si el clasificador determina fin de alternativas o se agotan las cotas de escalación, la tarea concluye.
- **Tratamiento de incertidumbre**:
  - En modo reactivo, una acción sin veredicto no permite concluir la tarea de forma exitosa a menos que una acción posterior de lectura confirme el estado del entorno.
  - En modo deliberativo, una acción sin veredicto permite continuar con las etapas siguientes, pero si al finalizar persisten acciones sin verificar, la tarea concluye como parcial y no como completada.
- **Seguridad**: Toda denegación por política prohibida o rechazo humano en la compuerta de seguridad detiene la tarea de inmediato; está prohibido escalar o replanificar para evadir un bloqueo de seguridad.
- **Cancelación cooperativa**: La cancelación del usuario propaga una señal de aborto a todas las capas, descarta respuestas en vuelo y concluye la tarea inmediatamente sin catalogarse como error.

### 4.2. Resumen funcional (declarado por el usuario)

Consulta del usuario → Eos decide el grupo de herramientas (ruta) → Eos decide la herramienta exacta → Qwen genera los argumentos → se ejecuta → Eos valida. El antiloop actúa ANTES de ejecutar (como dice CORE_FLOW). El modo PLAN es una capa superior que separa la generación de planes y de replanes. En modo PLAN, si Eos no aprueba o no está disponible, valida Qwen (solo en modo PLAN).

### 4.3. Detalle de la validación de Eos

- Eos admite más de una pregunta (hay 2 configuradas). `DECLARADO POR EL USUARIO — pendiente de verificar contra el código y la documentación`
- Recibe una key con el contexto, otra con la instrucción y otra con las preguntas; las preguntas pueden ser sí/no o de varias opciones; devuelve probabilidad. `DECLARADO POR EL USUARIO — pendiente de verificar contra el código y la documentación`

---

## 5. Decisiones tomadas que aplican a este documento

> El original solo referencia estas decisiones por su código; no contiene una sección que las desarrolle. Se copia lo que el original y el encargo de reorganización indican.

- **P2 — Eliminar `persistence.ts`**: eliminación física de `src/core/persistence.ts` (INC-008, A.9).
- **P5 — Hechos sin veredicto**: el código en `callExecutor.ts:485` queda intacto; la documentación se alinea (INC-007; Bloque B). Se conservan hechos con `if (isStepSuccess || noVerdict || policy.mutates)`.
- **P1 — Auditoría de UI volátil** (solo la parte de memoria): la auditoría de UI es volátil; la memoria del backend se retiene en RAM hasta `MAX_RETAINED_TASKS = 20` (cupo de 20). La parte de JSONL exclusivo para lab y sin endpoint de rehidratación está en `AUDITORIA_TRAZA.md`.
- **P3 — Nota**: la memoria es RAM volátil, sin restauración. La parte de SIGINT (salida inmediata) está en `AUDITORIA_TRAZA.md`.
- **Bloque D general**: ver sección 8.3.

---

## 6. Fichas de inconsistencia

Estructura de cada ficha solicitada: estado de verificación, evidencia, solución, riesgos y certeza.

**Observación importante**: el documento original **no contiene las fichas completas** de INC-001…INC-014 (solo la fila de la bitácora, los bloques de soporte, el plan de acción y la tabla de cobertura). Por la regla de no reconstruir, cada ficha queda marcada y con la información mínima que sí existe. Lo disponible en los bloques de soporte se encuentra en la sección 7.

### INC-001 — Aislamiento de `RefStore`
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO. Severidad: reclasificada de "alta" a **media** (Bloque 8, ver 7.5).
- Información mínima: ver fila de bitácora (sección 2) y plan A.2 (sección 9.1).

### INC-005 — Orden de bloques / prefix cache
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO (Pendiente). Fase 3, A.5, pendiente de decisión del usuario.
- Información mínima: ver fila de bitácora (sección 2) y plan A.5.

### INC-006 — Saneamiento (`factsDelta` y Handoff)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO. Evidencia y solución ajustada en Bloque 3 (sección 7.3).
- Información mínima: ver fila de bitácora y plan A.3.

### INC-007 — Hechos sin veredicto (doc-vs-doc)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO (Decisión P5). Contradicción entre `CORE_FLOW.md:24` y `CONTEXT_AND_MEMORY.md:9`; código intacto; Bloque B.

### INC-008 — `persistence.ts` (código muerto)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO (Decisión P2). Búsqueda global: 0 imports, 0 referencias. A.9.

### INC-009 — Campos huérfanos de `types.ts`
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO. Evidencia en Bloque 1 (sección 7.1). A.1.

### INC-013 — Constantes de cota
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO. Archivos y acción en A.1 (sección 9.1) y Bloque 8 (7.5).

### INC-014 — Handoff tras paso fallido — **INTERPRETACIÓN pendiente del usuario**
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO (Pendiente). Marcada como INTERPRETACIÓN pendiente del usuario. Opciones y evidencia en Bloque 7 (sección 7.4).

---

## 7. Secciones de soporte

### 7.0. Mapa de archivos base (2.1) y mapa de tipos de memoria documentado vs. real (2.2)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- El original no incluye las secciones 2.1 ni 2.2. Lo único que las referencia es el Bloque 8 (divergencias descartadas "de la tabla 2.2", ver 7.5). Archivos base listados en `CORE_FLOW.md`: `src/core/core.ts`, `modeEngines.ts`, `callExecutor.ts`, `decision.ts`, `reasoner/qwen.ts`, `policy/guard.ts`, `types.ts`.

### 7.1. Bloque 1 — Evidencia real de INC-009 y relación con `debugAccumulator`

**Búsqueda global de propiedades huérfanas de `Scratchpad`** (`src/`, `ui/`, `lab/`, `server.ts`, `package.json`):

1. **`selected_result`**: `grep -rn "selected_result" src/ ui/ lab/ server.ts package.json`
   ```text
   src/core/types.ts:203:  selected_result?: unknown;
   ```
   Total de coincidencias: exactamente 1. Cero lectores, cero escritores, cero accesos en todo el proyecto.

2. **`Scratchpad.text`**: `grep -rni "scratchpad" src/ ui/ lab/ server.ts`
   ```text
   src/core/decision.ts:152:    scratchpadSummary?: string,
   src/core/decision.ts:176:      scratchpadContext: scratchpadSummary ?? "",
   src/core/types.ts:201:export interface Scratchpad {
   src/core/types.ts:208:  /** Total de resultados de la última búsqueda; `search_results` solo conserva los primeros MAX_SCRATCHPAD_RESULTS. */
   src/core/types.ts:251:  scratchpad: Scratchpad;
   src/core/types.ts:365:/** Resultados de búsqueda conservados en `scratchpad.search_results`. */
   src/core/types.ts:366:export const MAX_SCRATCHPAD_RESULTS = 10;
   src/core/callExecutor.ts:38:    buildScratchpadContextForDecision,
   src/core/callExecutor.ts:183:        buildScratchpadContextForDecision(task),
   src/core/callExecutor.ts:386:    // El scratchpad es solo estado visible ("lo último visto"); los facts se registran tras la verificación (más abajo).
   src/core/callExecutor.ts:387:    Object.assign(task.scratchpad, processed.scratchpadDelta);
   src/core/processor/resultProcessor.ts:6:  Scratchpad,
   src/core/processor/resultProcessor.ts:9:import { MAX_EVIDENCE_OBS_CHARS, MAX_SCRATCHPAD_RESULTS } from "../types.ts";
   src/core/processor/resultProcessor.ts:16:  scratchpadDelta: Partial<Scratchpad>;
   src/core/processor/resultProcessor.ts:147:  const shown = items.slice(0, MAX_SCRATCHPAD_RESULTS);
   src/core/processor/resultProcessor.ts:195:    const scratchpadDelta: Partial<Scratchpad> = {};
   src/core/processor/resultProcessor.ts:278:        scratchpadDelta.path = String(args.path);
   src/core/processor/resultProcessor.ts:302:        scratchpadDelta.process_id = String(pid);
   src/core/processor/resultProcessor.ts:395:          scratchpadDelta.url = items[0].url;
   src/core/processor/resultProcessor.ts:403:        // El scratchpad es estado visible, no contexto de modelo: se acota para no crecer sin límite.
   src/core/processor/resultProcessor.ts:404:        scratchpadDelta.search_results = items.slice(0, MAX_SCRATCHPAD_RESULTS).map((r) => ({
   src/core/processor/resultProcessor.ts:408:        scratchpadDelta.search_results_total = items.length;
   src/core/processor/resultProcessor.ts:416:        scratchpadDelta.url = urlStr;
   src/core/processor/resultProcessor.ts:468:      scratchpadDelta,
   src/core/reasoner/prompts.ts:50:const MAX_SCRATCHPAD_CHARS = 2000;
   src/core/reasoner/prompts.ts:383:  scratchpadContext: string;
   src/core/reasoner/prompts.ts:484:    const context = clipTail(data.scratchpadContext, MAX_SCRATCHPAD_CHARS);
   src/core/context.ts:138:export function buildScratchpadContextForDecision(task: Task): string {
   src/core/debugAccumulator.ts:14:const snapScratchpad = (t?: Task | null): Record<string, unknown> => {
   src/core/debugAccumulator.ts:15:  const copy: Record<string, unknown> = { ...(t?.scratchpad ?? {}) };
   src/core/debugAccumulator.ts:105:          variablesScratchpad: snapScratchpad(task),
   src/core/core.ts:167:      scratchpad: {},
   lab/CONTEXT.md:223:- `toolRuns`: Lista compacta de ejecuciones de herramientas durante la tarea...
   ```
   - Análisis (copiado): La propiedad `text` declarada en `Scratchpad` (`src/core/types.ts:207`) **no se escribe ni se lee en ningún archivo**. Las únicas apariciones de la palabra `.text` en el proyecto corresponden a `res.text()` en llamadas HTTP o a `DataObservation.text`.
   - Conclusión (copiada): Tanto `selected_result` como `text` en `Scratchpad` son 100% huérfanas y pueden eliminarse de `types.ts` con cero riesgo.

**Análisis de `ui/utils/debugAccumulator.ts` vs. `src/core/debugAccumulator.ts`**
- ¿Copia o re-export?: En `ui/utils/debugAccumulator.ts:10`:
  ```ts
  export { createIterationFromEvent } from "../../src/core/debugAccumulator.ts";
  ```
  La función `createIterationFromEvent` **es un re-export directo** del backend.
- Diferencias funcionales: `ui/utils/debugAccumulator.ts` implementa utilidades exclusivas de la UI: (1) `reconstructIterationsFromTask(task: Task)`: reconstruye iteraciones sintéticas para tareas históricas o tras recargar la página; (2) `groupIterationsByStep(iterations, steps)`: agrupa iteraciones por paso visual para el acordeón de `DecisionStream`.
- Impacto de cambios en `src` sobre la UI: ítem A.6 (`REPLAN`) — al modificarse `createIterationFromEvent`, la UI recibe `stage: "REPLAN"` en vivo por el re-export (ver `AUDITORIA_TRAZA.md`).

**Corrección de la afirmación "0 lectores en `src`"**
- `grep -rn "step\.rawInput\|step\.rawOutput" src/` → 0 coincidencias. `grep -rn "call\.rawInput\|call\.rawOutput" src/` → 0 coincidencias.
- `src/core/debugAccumulator.ts:66, 99, 129, 236` lee `data.rawInput` y `data.rawOutput` desde el payload del evento (`CoreEvent.data`), **no** desde `Step` ni `StepCall`.
- En `ui/utils/debugAccumulator.ts`, líneas 73-74, 102-103, 119-120: `reconstructIterationsFromTask` sí lee `step.rawInput`, `step.rawOutput`, `call.rawInput` y `call.rawOutput`.
- Corrección (copiada): `rawInput` y `rawOutput` tienen 0 lectores en `src/core/`, pero **sí en `ui/`**. Eliminarlos de `src/core/types.ts` causaría un fallo fatal de TypeScript en `npm run lint`. Deben mantenerse como opcionales.

### 7.2. Bloque 2 — Métricas
Pertenece a `AUDITORIA_TRAZA.md`.

### 7.3. Bloque 3 — Saneamiento ontológico (A.3)

**Contraste de funciones de saneamiento**
```ts
// src/core/processor/resultProcessor.ts:103-115
export function sanitizeForMemory(text: string, maxLen = 120): string {
  if (!text) return "";
  let clean = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/<\/?obs>/gi, "[obs]")
    .replace(/\b(GOAL|FACTS|LOG|FAIL|TASK|PLAN|CHAT|SCHEMA|TOOL|REFS|EFFECTS|LAST|DATA):/gi, "$1_")
    .trim();
  if (clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + "...";
  }
  return clean;
}

// src/core/reasoner/prompts.ts:90
const safe = (s: string): string => s.replace(/<\/?obs>/gi, "[obs]");
```
- ¿Trunca `sanitizeForMemory`?: **SÍ**. Si la longitud excede `maxLen`, trunca y añade `"..."`.
- ¿Altera URLs legítimas?: **SÍ, de forma destructiva**.
  1. Si una URL tiene más de 120 (o 200) caracteres, `clean.substring(0, maxLen - 3) + "..."` la corta y añade puntos suspensivos, volviéndola un enlace inválido.
  2. `replace(/\b(GOAL|...):/gi, "$1_")` alteraría cualquier parámetro de consulta que coincidiese con un token directivo.

**Consumo de `facts.url` y `facts.cand`**
- Se consumen en `src/core/reasoner/prompts.ts:115` (`factsBlock`):
  ```ts
  const factsBlock = (facts: Record<string, string> | undefined, maxChars: number): string | null =>
    facts
      ? linesBlock("FACTS", Object.entries(facts).map(([k, v]) => `${k}=${clip(v, MAX_FACT_VALUE_CHARS)}`), maxChars)
      : null;
  ```
- En `prompts.ts:37`, `MAX_FACT_VALUE_CHARS = 400`.
- Qwen lee `FACTS` y extrae esas URLs para generar argumentos en herramientas subsiguientes (`read_web_page`, `curl_fetch`). Truncar la URL en `resultProcessor.ts` con cota de 200 corrompe los datos que alimentan a los siguientes pasos.

**Estado de saneamiento en `applyStepHandoff`**
```ts
// src/core/context.ts:212-220
export function applyStepHandoff(step: Step, context: TaskExecutionContext): string {
    const handoff = context.lastHandoff;
    if (!handoff || !handoff.finding) return step.instruction;
    const refNote = handoff.refKey ? ` [ref:${handoff.refKey}]` : "";
    const factNote = handoff.primaryFact ? ` | ${handoff.primaryFact.key}=${handoff.primaryFact.value}` : "";
    return `${step.instruction}\n[HANDOFF ${handoff.fromStepId} (${handoff.tool})]: ${handoff.finding}${refNote}${factNote}`;
}
```
- `handoff.finding`: **YA VIENE SANEADO**. En `resultProcessor.ts:265, 275, 313, 375, 384, 391, 419, 427`, cada asignación a `finding` pasa por `sanitizeForMemory`.
- `refNote`: identificador sintético interno generado por `RefStore` (`r1`, `r2`, etc.). No contiene datos externos.
- `factNote`: contiene `primaryFact.key` y `primaryFact.value`; proviene de `processed.factsDelta`.

**Alcance real de saneamiento**
- Valores que componen `factsDelta`: `args.path` (`resultProcessor.ts:277`, generado internamente por el modelo); `pid` (`:301`, número del SO); `url` (`:394, 415`) y `cand` (`:400`): **contenido externo directo**.
- **Solución corregida para A.3** (copiada): no truncar URLs a 200 caracteres. Para URLs y candidatos en `factsDelta`, aplicar un saneamiento de una sola línea que remueva caracteres de control (`[\x00-\x1F\x7F]`), aplane saltos de línea y neutralice etiquetas `<obs>` sin añadir `"..."` destructivos, con límite amplio de hasta 400 caracteres (compatible con `MAX_FACT_VALUE_CHARS`).

### 7.4. Bloque 7 — INC-014 / A.4 (interpretación abierta de handoff)

**Relación entre `isStepSuccess`, `noVerdict` y handoff** — `src/core/callExecutor.ts:458-460`:
```ts
const isStepSuccess = isCleanSignals && (eosPassed || semantic?.status === "completed");
const noVerdict = eosUnavailable && !semantic;
```
- Si los verificadores están caídos (`noVerdict === true`), `isStepSuccess` es `false`.
- Conforme a P5, los hechos se conservan (`if (isStepSuccess || noVerdict || policy.mutates)`).
- Si se aplicara A.4 de forma estricta (`if (!isStepSuccess) context.lastHandoff = undefined;`), cada vez que los evaluadores no estén disponibles el handoff se destruiría, aunque la herramienta ejecutó limpiamente y sus hechos se consolidaron en memoria.

**Opciones para decisión del usuario** (INTERPRETACIÓN PENDIENTE):
- **Opción 1 (Invalidar handoff ante fallo real confirmado)**:
  - Lógica: si `!isStepSuccess && !noVerdict`, asignar `context.lastHandoff = undefined;`.
  - Efecto: si un paso falla con veredicto negativo, el siguiente paso (o el replan) no recibe la cabecera `[HANDOFF ...]`. Si no hubo veredicto (`noVerdict`), el handoff previo se respeta.
  - Riesgo: modifica el comportamiento de runtime de `callExecutor.ts`.
- **Opción 2 (Mantener comportamiento actual y alinear documentación)**:
  - Lógica: el código en `callExecutor.ts` se mantiene 100% intacto.
  - Fundamento: `docs/CONTEXT_AND_MEMORY.md:13` define el handoff como la "referencia del paso completado previo". Si el paso N-1 fue el último completado con éxito y el paso N falló, el paso N-1 sigue siendo literalmente el último paso completado con éxito disponible como anclaje contextual.
  - Acción: actualizar la documentación para explicitar que `context.lastHandoff` retiene el último paso exitoso hasta que otro paso exitoso lo reemplace. Cero riesgo de regresión en código.

### 7.5. Bloque 8 (parte de memoria) — Auditoría general del plan

**Consistencia interna y rutas corregidas**
- Se corrigió la ruta de prompts: `src/core/reasoner/prompts.ts` (en pasadas previas figuraba erróneamente como `src/core/prompts.ts`).
- Se verificó que todas las líneas citadas de código y documentación coinciden con el estado actual del repositorio.

**Completitud de archivos por ítem — A.1 (Unificación de cotas y tipos huérfanos)**
1. `src/core/types.ts`: exportar `MAX_MEMORY_LOG_ENTRIES = 30`, `MAX_MEMORY_EFFECTS_ENTRIES = 25`, `MAX_MEMORY_FAIL_ENTRIES = 5`, `MAX_TOOL_DESC_CHARS = 80`. Eliminar `selected_result` y `text` de `Scratchpad`.
2. `src/core/context.ts`: importar y usar las constantes en líneas 100, 110, 118. Unificar `limit = 8` en `buildRefsContext`.
3. `src/core/tools/manifest.ts`: reemplazar `const MAX_DESCRIPTION_CHARS = 80;` (línea 40) por `MAX_TOOL_DESC_CHARS` importado de `types.ts`.
4. `src/core/reasoner/prompts.ts`: reemplazar `const MAX_TOOL_DESC_CHARS = 80;` (línea 53) por la constante de `types.ts`.
5. `src/core/processor/resultProcessor.ts`: alinear `describe(taskId, limit = 8)`.

**Reclasificación de severidades** (copiada del original; la de INC-010/INC-011 está en `AUDITORIA_TRAZA.md`)
- **INC-001**: reclasificada de "alta" a **severidad media** (riesgo latente de defensa en profundidad; llamadores actuales ya pasan `task.id`).

**Descarte justificado de divergencias de la tabla 2.2 sin ficha**
1. **`steps[].calls` sin cota en memoria**: descartada como inconsistencia. Acotada naturalmente por el ciclo de vida de la tarea y `MAX_STEPS = 15`. Purge completo al expulsar la tarea de RAM.
2. **`facts` sin cota en RAM**: descartada como inconsistencia. Es un `Record<string, string>` cuyas claves son finitas y sobreescribibles. Acotado en prompts por `MAX_FACTS_CHARS = 2500`.
3. **Doble estructura `scratchpad` vs `context.lastCall*`/`dataObs`**: descartada como inconsistencia de código. Se documenta en Bloque B la separación entre estado público para UI/Decision #2 y contexto privado para construcción interna de prompts.

### 7.6. Secciones nuevas a rellenar en la etapa de auditoría (esqueleto vacío)

#### 7.6.1. Matriz de contexto por llamada

| Llamada a modelo | Modelo | Bloques / keys de contexto que recibe | Estructuras de memoria que lo alimentan | Cotas de caracteres | Observaciones |
|---|---|---|---|---|---|
| Decision #1 | | | | | |
| Decision #2 | | | | | |
| Verificación Eos | | | | | |
| ARGUMENTS | | | | | |
| STAGE_VERIFICATION | | | | | |
| PLAN | | | | | |
| REPLAN | | | | | |
| FINAL_RESPONSE | | | | | |

#### 7.6.2. Matriz de escritura de memoria

| Estructura | Quién escribe | Cuándo | Condición | Cota / descarte | Quién lee | Observaciones |
|---|---|---|---|---|---|---|
| `task.memory.log` | | | | | | |
| `task.memory.facts` | | | | | | |
| `task.memory.effects` | | | | | | |
| `task.memory.fail` | | | | | | |
| `context.dataObs` | | | | | | |
| `context.lastHandoff` | | | | | | |
| `context.lastCall*` | | | | | | |
| `task.scratchpad` | | | | | | |
| `RefStore` | | | | | | |
| `executedSignatures` | | | | | | |
| `nonReadCounter` | | | | | | |

---

## 8. Plan de acción (ítems de este documento)

### 8.1. Fase 1 — Consistencia estricta de bajo riesgo (sin cambio de comportamiento operativo)

#### Ítem A.1: Centralización de cotas y eliminación de propiedades huérfanas en `types.ts` (INC-009, INC-013)
- **Archivos a modificar**: `src/core/types.ts`, `src/core/context.ts`, `src/core/tools/manifest.ts`, `src/core/reasoner/prompts.ts`, `src/core/processor/resultProcessor.ts`.
- **Acción concreta**:
  1. En `src/core/types.ts`: exportar `MAX_MEMORY_LOG_ENTRIES = 30`, `MAX_MEMORY_EFFECTS_ENTRIES = 25`, `MAX_MEMORY_FAIL_ENTRIES = 5`, `MAX_TOOL_DESC_CHARS = 80`, `MAX_REFS_DESCRIPTIONS = 8`.
  2. En `src/core/types.ts`: suprimir `selected_result?: unknown;` y `text?: string;` de `Scratchpad`. Mantener como opcionales los campos leídos por la UI en `Step` y `StepCall`.
  3. En `src/core/context.ts`: usar las nuevas constantes en líneas 100, 110, 118 y 248.
  4. En `src/core/tools/manifest.ts:40`: usar `MAX_TOOL_DESC_CHARS`.
  5. En `src/core/reasoner/prompts.ts:53`: usar `MAX_TOOL_DESC_CHARS`.
  6. En `src/core/processor/resultProcessor.ts:62`: fijar default `limit = MAX_REFS_DESCRIPTIONS`.
- **Riesgo**: Cero. Comprobación vía `npm run lint`.
- **Prueba manual**: Iniciar `npm run dev`, verificar que el servidor levante limpiamente y que la interfaz responda sin errores en consola.

#### Ítem A.2: Aislamiento estricto de `RefStore` (INC-001)
- **Archivos a modificar**: `src/core/processor/resultProcessor.ts`, `src/core/processor/refResolver.ts`.
- **Acción concreta**:
  1. En `resultProcessor.ts` (`RefStore.get`): tipar `taskId: string` como obligatorio. Suprimir el bucle `for (const store of this.taskStores.values())`. Si `taskId` no existe, retornar `undefined`.
  2. En `resultProcessor.ts` (`RefStore.put`): tipar `taskId: string` como obligatorio (suprimir default `"default"`).
  3. En `resultProcessor.ts` (`ResultProcessor.process`): hacer `taskId: string` obligatorio.
- **Riesgo**: Cero. Todos los llamadores reales en el flujo activo ya suministran `task.id`.
- **Prueba manual**: Ejecutar una tarea que lea un archivo y verificar en la traza y en los prompts que las referencias `{{ref:r1}}` se resuelvan con normalidad.

#### Ítem A.3: Saneamiento ontológico seguro de URLs y contenido externo (INC-006)
- **Archivos a modificar**: `src/core/processor/resultProcessor.ts`, `src/core/context.ts`.
- **Acción concreta**:
  1. En `resultProcessor.ts`: crear un saneador de una sola línea no destructivo para URLs (`sanitizeExternalUrl`) que neutralice saltos de línea y etiquetas `<obs>` sin truncar con `...` hasta el límite de 400 caracteres (`MAX_FACT_VALUE_CHARS`). Aplicarlo a `factsDelta.url` (líneas 394, 415) y `factsDelta.cand` (línea 400).
  2. En `context.ts:218`: asegurar que `handoff.primaryFact.value` quede saneado en la misma línea de `TASK:`.
- **Riesgo**: Cero. Protege la inyección directiva sin romper URLs.
- **Prueba manual**: Ejecutar una búsqueda web con resultados de URLs complejas y confirmar que la herramienta siguiente pueda navegar a la URL sin fallos por enlaces cortados.

#### Ítem A.9: Eliminación física de código huérfano `persistence.ts` (INC-008)
- **Archivos a modificar**: `src/core/persistence.ts` (eliminación del archivo).
- **Acción concreta**: Eliminar físicamente el archivo `src/core/persistence.ts`.
- **Riesgo**: Cero (confirmado con búsqueda global de 0 dependencias).
- **Prueba manual**: Ejecutar `npm run lint` y confirmar 0 errores de compilación.

### 8.2. Fase 3 — Modificaciones de comportamiento (pendientes de decisión del usuario)

#### Ítem A.4: Tratamiento de `lastHandoff` tras paso fallido (INC-014)
- **Estado**: Pendiente de decisión del usuario entre:
  - *Opción 1*: Invalidar `context.lastHandoff = undefined` ante `!isStepSuccess && !noVerdict`.
  - *Opción 2*: Mantener comportamiento actual y alinear `CONTEXT_AND_MEMORY.md` para documentar que conserva el último paso exitoso como referencia base.
- **Prueba manual**: `[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]` (el original no define prueba manual para A.4).

#### Ítem A.5: Reordenamiento de bloques de prompt para Prefix Cache (INC-005)
- **Estado**: Pendiente de autorización del usuario para determinar si se reordenan las secciones en `src/core/reasoner/prompts.ts`.
- **Prueba manual**: `[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]` (el original no define prueba manual para A.5).

### 8.3. Bloque B — Correcciones de documentación (parte de este documento)

1. **`docs/CONTEXT_AND_MEMORY.md`**:
   - Sección 1: Alinear Hechos Confirmados con `CORE_FLOW.md:24` conforme a la Decisión P5.
   - Sección 1 y 2: Formalizar la separación entre `task.scratchpad` (UI / Decision #2) y `context.lastCall*` / `dataObs` (ensamblado de prompts).
   - Sección 4: Documentar formalmente la tabla de los tres artefactos independientes, explicitando la pureza volátil de la auditoría de UI (Decisión P1) y que el proceso finaliza de inmediato ante SIGINT (Decisión P3).
   - Sección 1: Documentar la resolución que elija el usuario para INC-014 (Handoff).
2. **`docs/CORE_FLOW.md`**:
   - Sincronizar terminología de hechos, veredictos y handoffs con `CONTEXT_AND_MEMORY.md`.

### 8.4. Bloque D — Fuera de fase (parte de este documento)
Sin ítems propios en el original asignados a memoria y contexto. Los ítems del Bloque D (métricas, `candidate_tools`, Decision #1 en modo PLAN, endpoint de trazas, graceful shutdown, reintentos correctivos) están en `AUDITORIA_TRAZA.md`.

---

## 9. Puntos abiertos a verificar (no son hallazgos confirmados)

1. **Efectos**: `CONTEXT_AND_MEMORY.md` dice "permanente; no se descarta" (invariante 1) pero el código conserva 25 (`slice(-25)`) y 1200 caracteres en prompts. La tabla 2.2 la marcó "alineada": revisar qué recibe exactamente `handleReplan` y `STAGE_VERIFICATION`.
2. `pruneTasks` cancela automáticamente tareas en `WAITING_INPUT`: no está documentado en `CORE_FLOW.md`.
3. El handoff se concatena a `step.instruction` (línea `TASK:`) mientras la doc lo describe como parte del bloque dinámico.
4. `task.scratchpad` alimenta a Decision #2 (Eos): uso no documentado. Los pasos `superseded` en `task.steps` tampoco están documentados.
5. La sanitización vive en `resultProcessor` (`sanitizeForMemory`) y `prompts.ts` (`safe`, más débil), no en el Gestor de Contexto como dice la doc; revisar toda entrada de contenido externo a prompts (`facts`, `scratchpad`, `search_results`, `HANDOFF`, resultados de herramientas, respuestas del usuario).
6. A.3: evaluar si `sanitizeForMemory(url, MAX_FACT_VALUE_CHARS)` basta sin helper nuevo; riesgo de que el reemplazo de `\b(GOAL|...):` altere URLs legítimas.
7. A.1/A.2: listar todos los llamadores de `RefStore.describe/put/get` y `ResultProcessor.process`; efecto de cambiar el default de `describe` (5→8); posibles ciclos de importación al mover constantes a `types.ts`; cambio concreto pendiente en `refResolver.ts`.
8. INC-009: la evidencia de ausencia de usos de `Scratchpad.text` debe apoyarse en `tsc` tras la eliminación, además de búsquedas de accesos dinámicos.
9. Documentar en la doc que en modo PLAN Decision #1 también se invoca al iniciar (fin vs. plan) y que la verificación de Eos usa 2 preguntas configuradas (si el código lo confirma).

---

## 10. Puntos de contacto con `AUDITORIA_TRAZA.md`

- **Archivos compartidos**: `src/core/debugAccumulator.ts` (A.6, en la traza), `src/core/callExecutor.ts` (A.8 en la traza; A.4 y A.3 aquí), y `src/core/types.ts` (A.1 aquí y `StepCall.iterationId` de A.8 en la traza).
- **Origen común**: el botón de UI y la traza leen `modelIterations`.
- **Orden acordado**: primero memoria y contexto; la traza se aborda después.

---

## 11. Tabla de cobertura de este documento

| Inconsistencia / Tarea | Acción Asignada | Fase / Bloque | Estado |
|---|---|:---:|:---:|
| **INC-001** (Aislamiento `RefStore`) | **Ítem A.2** (`resultProcessor.ts`, `refResolver.ts`) | Fase 1 | Cubierto |
| **INC-005** (Orden de bloques Prefix Cache) | **Ítem A.5** (`prompts.ts`) | Fase 3 | Pendiente Usuario |
| **INC-006** (Sanitización ontológica no destructiva) | **Ítem A.3** (`resultProcessor.ts`, `context.ts`) | Fase 1 | Cubierto |
| **INC-007** (Contradicción hechos sin veredicto) | **Bloque B.1 y B.2** (Decisión P5: código intacto; doc alineada) | Bloque B | Cubierto |
| **INC-008** (Código muerto `persistence.ts`) | **Ítem A.9** (Decisión P2: eliminación física) | Fase 1 | Cubierto |
| **INC-009** (Campos huérfanos `Scratchpad`) | **Ítem A.1** (Suprime `selected_result`/`text`; preserva campos UI) | Fase 1 | Cubierto |
| **INC-013** (Constantes de cota dispersas) | **Ítem A.1** (`types.ts`, `context.ts`, `manifest.ts`, `prompts.ts`) | Fase 1 | Cubierto |
| **INC-014** (Comportamiento de `lastHandoff`) | **Ítem A.4** (Presentación de opciones sin decidir por el usuario) | Fase 3 | Pendiente Usuario |

Ítems del plan en este documento: A.1, A.2, A.3, A.9 (Fase 1); A.4, A.5 (Fase 3). El resto de la numeración (A.6, A.7, A.8) está en `AUDITORIA_TRAZA.md`.