# Auditoría de la Traza (`jarvis-traces.jsonl`) — Documento derivado

> Documento derivado de `docs/AUDITORIA_MEMORIA_CONTEXTO_TRAZA.md` (Pasada 4, verificación adversarial), que se conserva intacto como fuente histórica. Este archivo es solo una **reorganización**: el contenido se copió tal cual; no se verificaron hallazgos contra el código ni se agregaron hallazgos nuevos.
> Documento hermano: `docs/AUDITORIA_MEMORIA_CONTEXTO.md`.

## 1. Encabezado

### 1.1. Alcance
`jarvis-traces.jsonl`, escrito por `src/core/taskTrace.ts` y consumido únicamente por `lab` (`lab/extract-cases.ts`). Incluye `callSeq`, `resultPreview`, la etapa `REPLAN`, métricas de latencia/tokens, cota de `toolRuns.args`, ciclo terminal y pérdida de datos.

Quedan fuera (ver `AUDITORIA_MEMORIA_CONTEXTO.md`): las estructuras de memoria y contexto que alimentan los prompts. El botón "Copiar auditoría" de la UI es un tercer artefacto (solo UI; sin complejidad para el backend; usa `modelIterations`, que el front ya tiene).

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
| **INC-002** (`callSeq` en `toolRuns`) | **CONFIRMADO** | `lab/extract-cases.ts:242` busca `tr.callSeq === seq`. Al faltar, cae en el fallback `tr.step === step` que desalinea o duplica ejecuciones en pasos con reintentos o llamadas múltiples. Es **NECESARIO** para `lab`. |
| **INC-003** (Etapa `REPLAN` en ciclo y traza) | **CONFIRMADO** | `handleReplan` emite `PLAN_GENERATED` y `debugAccumulator.ts` fuerza `stage: "PLAN_GENERATION"`. `ui/components/DecisionStream/components/ModelIterationCard.tsx:55` ya contempla `case "REPLAN": return "Replanificación";`. Compatible 100% con UI. Se mantiene en Fase 1 (A.6). |
| **INC-004** (Decision #1 en modo PLAN) | **CONFIRMADO** (Bloque D) | Intencional en el diseño original. Se confirmó en `lab/extract-cases.ts:89-98` que el laboratorio NO extrae ni evalúa esta llamada. Permanece en Bloque D (fuera de fase). |
| **INC-010** (Auditoría UI vs Traza en disco) | **CORREGIDO** (Reclasificada) | **Reclasificada a nota documental de severidad baja**. El botón de UI y la traza en disco tienen propósitos y esquemas distintos por diseño. La UI lee de memoria volátil y `lab` lee del JSONL; no hay inconsistencia ni cambios de código en backend. |
| **INC-011** (Métricas de latencia y tokens) | **CORREGIDO** (Bloque D) | Se verificó que `lab/extract-cases.ts` NO copia ni evalúa `latencyMs`, `promptTokens` ni `completionTokens`. En `ui/`, `ModelIterationCard.tsx` no renderiza latencia (`grep -rn "latency" ui/` = 0 coincidencias). A.7 (tocar 6 archivos) pasa al Bloque D para evitar complejidad innecesaria. |
| **INC-012** (Cota de `toolRuns.args`) | **CONFIRMADO** | `lab/extract-cases.ts` no evalúa ni guarda `args` en `CaseReferenceToolRun`. Acotar strings a 2000 caracteres en `taskTrace.ts:46` es seguro y protege contra JSONL gigantes. Se unifica en Fase 2 (A.8). |
| **A.6** | Cubre INC-003 | Fase 1 |
| **A.8** | Cubre INC-002 e INC-012 | Fase 2 |
| **A.7** (antiguo; métricas) | Retirado de la fase activa | Trasladado al Bloque D (INC-011) |

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

> Esta sección es idéntica en `AUDITORIA_MEMORIA_CONTEXTO.md`.

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

- **P1 — JSONL exclusivo para lab; sin endpoint de rehidratación**: no se añade complejidad al backend para rehidratar tareas desde disco en la UI. El endpoint de lectura histórica de trazas para la UI queda descartado (INC-010).
- **P3 — Salida inmediata ante SIGINT**: el proceso finaliza de inmediato; las tareas en vuelo no dejan traza. Graceful shutdown descartado.
- **Bloque D**: ver sección 8.3.

---

## 6. Fichas de inconsistencia

Estructura de cada ficha solicitada: estado de verificación, evidencia, solución, riesgos y certeza.

**Observación importante**: el documento original **no contiene las fichas completas** de INC-001…INC-014 (solo la fila de la bitácora, los bloques de soporte, el plan de acción y la tabla de cobertura). Por la regla de no reconstruir, cada ficha queda marcada y con la información mínima que sí existe. Lo disponible en los bloques de soporte está en la sección 7.

### INC-002 — `callSeq` / `resultPreview`
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO. `callSeq` NECESARIO para `lab`; `resultPreview` ÚTIL (ver 7.1 y 7.3). Plan: A.8.

### INC-003 — Etapa `REPLAN` en ciclo y traza
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO. Evidencia de UI en Bloque 6 (sección 7.5). Plan: A.6.

### INC-004 — Decision #1 en modo PLAN (Bloque D)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO (Bloque D). Intencional en el diseño original; `lab/extract-cases.ts:89-98` no extrae ni evalúa esta llamada.

### INC-010 — Nota documental: botón de UI vs. traza
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO (Reclasificada a nota documental, severidad baja). Evidencia en Bloque 0 (sección 7.1). Resolución por documentación (Bloque B).

### INC-011 — Métricas de latencia y tokens (Bloque D)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CORREGIDO (Bloque D). Evidencia en Bloque 0 y Bloque 2 (secciones 7.1 y 7.2).

### INC-012 — Cota de `toolRuns.args`
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- Estado: CONFIRMADO. Plan: A.8 (Fase 2).

---

## 7. Secciones de soporte

### 7.0. Análisis exhaustivo de duplicidad y pérdida en la traza (2.3)
`[CONTENIDO NO DISPONIBLE EN LA FUENTE — reconstruir en la etapa de auditoría]`
- El original no incluye la sección 2.3: tabla de caminos terminales, protección `context.traced`, producción de `ModelIteration`, integridad y errores de escritura, matriz campo por campo `taskTrace.ts` vs. `lab/extract-cases.ts`. Solo existen fragmentos parciales en los Bloques 0, 4 y 5 (abajo).

### 7.1. Bloque 0 — Reclasificación de INC-010 y necesidad real de cambios de traza

#### 7.1.1. Reclasificación de INC-010
- **Nueva clasificación**: Nota documental / Arquitectura intencional (Severidad: BAJA).
- **Justificación**:
  1. En `ui/components/DecisionStream/DecisionStream.tsx:121-143`, la función `buildAuditJson` opera puramente sobre estado reactivo local del componente React:
     ```ts
     // ui/components/DecisionStream/DecisionStream.tsx:121-143
     const buildAuditJson = () => {
       const rootData: Record<string, any> = {
         taskId: task?.id || "current",
         exportedAt: new Date().toISOString(),
         taskState: task?.state || "UNKNOWN",
         mode: task?.mode || "NORMAL",
         isPartialExport: Boolean(isExecuting || task?.state === "RUNNING"),
         totalIterations: modelIterations.length,
         modelsSummary: { eos_0_8b: totalEos, qwen_3_5_9b: totalQwen },
       };
       ...
       rootData.iterations = modelIterations;
       return JSON.stringify(rootData, null, 2);
     };
     ```
  2. En el cliente React, `modelIterations` proviene de dos únicas fuentes:
     - El stream SSE (`/api/jarvis/events`), procesado por `recordEvent` en `ui/hooks/useJarvis.ts:305` mediante `createIterationFromEvent`.
     - El snapshot de estado (`/api/jarvis/state`), donde `useJarvis.ts:75-79` toma `task.modelIterations` retenido en RAM o invoca `reconstructIterationsFromTask(task)`.
  3. No se realiza ninguna llamada de red adicional al pulsar el botón; usa exclusivamente los datos que el front ya tiene en memoria.
  4. Búsqueda global confirma que `lab/` **jamás consume el JSON del botón** (solo lee `jarvis-traces.jsonl` vía `readline` en `lab/extract-cases.ts:276-280`).
  5. Búsqueda global en `src/server/jarvisRouter.ts` y en `ui/` confirma que **ninguno lee `jarvis-traces.jsonl`**.
  6. Conforme a la Decisión P1 del usuario, no se debe añadir complejidad al backend para rehidratar tareas desde disco en la UI. INC-010 queda resuelta formalmente mediante documentación en Bloque B.

#### 7.1.2. Clasificación de necesidad de campos propuestos para la traza (A.7 y A.8)

Se analizó cada campo de la traza contrastándolo con el consumidor real (`lab/extract-cases.ts`, `lab/run.ts`, `lab/evaluate.ts` y casos existentes en `lab/cases/`):

| Campo | Propuesto en | Presencia en `lab/extract-cases.ts` | Uso Real en `lab` | Clasificación | Decisión de Plan |
|---|---|---|---|:---:|---|
| **`callSeq`** | A.8 | `TraceToolRun.callSeq?: number \| string;` (opcional en tipo, línea 55) | Leído en línea 242 (`tr.callSeq === seq`). Si falta, el fallback `tr.step === step` asigna erróneamente el primer toolRun en pasos con múltiples llamadas. | **NECESARIO** | Se mantiene en Fase 2 (A.8), calculado en `taskTrace.ts`. |
| **`resultPreview`** | A.8 | `TraceToolRun.resultPreview?: string;` (opcional en tipo, línea 61) | Copiado en línea 252 a `CaseReferenceToolRun.resultPreview`. Ningún evaluador ni benchmark de `lab` lo comprueba; solo sirve de consulta humana en borradores. | **ÚTIL** | Se incluye en `taskTrace.ts` (A.8) porque su coste es de 1 sola línea (`c.evidence?.obs.slice(0, 500)`). |
| **`latencyMs`** | A.7 | `TraceCall.latencyMs?: number;` (opcional en tipo, línea 48) | **NO se lee en ninguna parte de `lab`**: no se copia a `CaseReference` ni a `LabCase`. `lab/run.ts:253` mide la latencia de sus propios benchmarks en tiempo de ejecución. | **INNECESARIO** en lab / **ÚTIL** en UI | **Pasa al Bloque D**. Requiere tocar 6 archivos de `src` para un dato que `lab` no usa y que la UI hoy no muestra. |
| **`promptTokens`** | A.7 | `TraceCall.promptTokens?: number;` (opcional en tipo, línea 49) | **NO se lee en ninguna parte de `lab`**. `CaseReference` no posee campos de tokens. | **INNECESARIO** | **Pasa al Bloque D**. |
| **`completionTokens`** | A.7 | `TraceCall.completionTokens?: number;` (opcional en tipo, línea 50) | **NO se lee en ninguna parte de `lab`**. | **INNECESARIO** | **Pasa al Bloque D**. |
| **Cota de `args`** | A.8 | `TraceToolRun.args?: Record<string, unknown>;` (opcional en tipo, línea 58) | `findMatchingToolRun` **ni siquiera copia `args`** a `CaseReferenceToolRun` (líneas 246-253). | **ÚTIL** (defensivo) | Se mantiene en Fase 2 (A.8) para evitar que escrituras de archivos grandes generen líneas JSONL de cientos de KB. Coste: 1 archivo (`taskTrace.ts`). |

#### 7.1.3. Reducción del plan de acción
- **Ítem A.7 (Propagación masiva de métricas)**: Se **retira de la fase activa y se traslada al Bloque D**.
  - *Coste ahorrado*: Modificación de 6 archivos (`src/core/reasoner/qwen.ts`, `src/core/decision.ts`, `src/core/callExecutor.ts`, `src/core/modeEngines.ts`, `src/core/core.ts`, `src/core/debugAccumulator.ts`) y más de 80 líneas de código para campos que nadie consume.
- **Ítem A.8 (Correcciones de traza en `taskTrace.ts`)**: Se reduce exclusivamente a lo necesario y útil defensivo en un único archivo (`src/core/taskTrace.ts`):
  1. Correlación estricta de `callSeq`.
  2. Previsualización breve de `resultPreview`.
  3. Cota segura de caracteres en strings de `toolRuns.args`.

#### 7.1.4. Reclasificación de severidades (parte de traza, copiada del Bloque 8)
- **INC-010**: Reclasificada de "alta" a **nota documental de severidad baja**.
- **INC-011**: Reclasificada a **Bloque D** (mejora de observabilidad opcional, fuera de fase).

### 7.2. Bloque 2 — Métricas (estado y análisis técnico)

#### Definición actual en código
```ts
// src/core/types.ts:22-32
export interface ModelIterationMetrics {
  latencyMs?: number;
  tokens?: {
    input?: number;
    output?: number;
  };
  confidence?: number;
  signals?: Record<string, unknown>;
  verdict?: string;
  isStepSuccess?: boolean;
}
```

#### Verificación de lectores de métricas
- `grep -rn "metrics.*tokens\|\.tokens\b" src/ ui/ lab/` arrojó **cero coincidencias** (exit code 1). Nadie lee `metrics.tokens`.
- `grep -rn "latency" ui/` arrojó **cero coincidencias** (exit code 1).
- La afirmación de pasadas anteriores de que `ModelIterationCard.tsx:47` contemplaba `metrics.latencyMs` era errónea (la línea 47 es `case "ARGUMENT_GENERATION": return "Generación Argumentos";`).
- Al haberse demostrado en el Bloque 0 que `lab` no lee `latencyMs` ni tokens de la traza, el ítem A.7 se traslada al Bloque D. `types.ts` no se modifica en esta fase.

### 7.3. Bloque 4 — Traza (A.8) y correlación en lab

#### Nombre del stage
- En `src/core/types.ts:14`: `ModelStage = ... | "ARGUMENT_GENERATION" | ...`
- En `src/core/debugAccumulator.ts:136`: `stage: "ARGUMENT_GENERATION"`
- El nombre es **estrictamente `"ARGUMENT_GENERATION"`**.

#### Ruptura de la relación FIFO en caminos de error
Se analizó si emparejar `s.calls` con `calls.filter(stage === "ARGUMENT_GENERATION")` en orden FIFO se mantiene 1:1 en todos los caminos de ejecución:
- En `src/core/callExecutor.ts:241-249`:
  ```ts
  } catch (argErr) {
      if (!(argErr instanceof LLMValidationError)) throw argErr;
      ...
      recordFailedCall(context, step, { tool: selectedTool.name, error: argsError });
      return { status: "logical_error", step, error: argsError };
  }
  ```
  Si la generación de argumentos falla por validación tras los reintentos internos, se invoca `recordFailedCall`, agregando una llamada física a `step.calls`. Sin embargo, `deps.emitEvent("ARGUMENTS_GENERATED", ...)` **nunca se emitió** (está en la línea 258). Por ende, `step.calls` tiene 1 llamada, pero en `calls` hay **0** iteraciones de `ARGUMENT_GENERATION` para ese paso.
- Si el paso se reintenta posteriormente o si otro paso genera argumentos exitosamente, el emparejamiento FIFO asignará el `seq` de una llamada posterior a la llamada fallida previa, produciendo una desalineación silenciosa en la traza.

#### Solución técnica
Para evitar desalineaciones por FIFO:
1. Al emitirse `ARGUMENTS_GENERATED`, se registra en el `StepCall` el identificador unívoco de la iteración (`callRecord.iterationId = iteration.id`).
2. En `src/core/taskTrace.ts`, tras calcular `calls` y asignar los `seq = i + 1`, se indexa un mapa `iterationIdToSeq: Map<string, number>`.
3. Al mapear `toolRuns`, se resuelve: `callSeq: c.iterationId ? iterationIdToSeq.get(c.iterationId) ?? null : null`.
4. De este modo, la fuente única de verdad sigue residiendo en `taskTrace.ts` tras el filtrado, pero el enlace es biunívoco e inmune a llamadas fallidas intermedias.

### 7.4. Bloque 5 — Pérdida de datos y ciclo de vida terminal

#### Generación de `id` en `debugAccumulator.ts` y deduplicación en `core.ts:103`
- Los IDs de iteración se generan como: `iter_${ts}_eos_d1_${expectedStepId}`, `iter_${ts}_qwen_args_${stepId}`, etc., donde `ts = event.timestamp || Date.now()`.
- En `core.ts:103-107`:
  ```ts
  const existingIdx = ctx.task.modelIterations.findIndex((it) => it.id === iteration.id);
  if (existingIdx >= 0) {
    ctx.task.modelIterations[existingIdx] = iteration;
  } else {
    ctx.task.modelIterations.push(iteration);
  }
  ```
- Si dos eventos generasen el mismo ID (ej. dos eventos emitidos sincrónicamente en el mismo milisegundo), el segundo pisaría al primero. Añadir un contador incremental `_seq` asegura inmunidad contra colisiones en el mismo milisegundo.

#### Pasos en replanificación y `toolRuns`
- En `src/core/modeEngines.ts:349-354` (`handleReplan`): los pasos fallidos o reemplazados **no se eliminan de `task.steps`**, sino que se marcan con `superseded = true`, y los nuevos pasos se agregan con `task.steps.push(...newSteps)`.
- Por consiguiente:
  1. Las llamadas `s.calls` de los pasos superseded siguen vivas en `task.steps`.
  2. Al construir `toolRuns` (`task.steps.flatMap(...)`), las ejecuciones físicas anteriores se serializan íntegramente.
  3. El conjunto `stepIds` en `taskTrace.ts:28` contiene tanto los pasos previos como los nuevos; ninguna iteración queda desvinculada como `step: null`.

#### Reintentos intermedios de inferencia
- Se confirma que `dispatchValidated` (`qwen.ts:520-547`) ejecuta reintentos internos sin emitir eventos SSE.
- La traza en disco registra únicamente la última llamada efectiva devuelta por el despachador.
- Se registra formalmente como **decisión de diseño pendiente** (no alterar en esta fase). Ver Bloque D.

#### Manejo de errores en `taskTrace.ts`
- En `src/core/taskTrace.ts:20-23`: `context.traced = true;` se ejecuta en la línea 21, **antes** del bloque `try`.
- Si `JSON.stringify` o `fs.appendFileSync` fallan por error de I/O o memoria, la tarea queda marcada permanentemente como trazada. Si el orquestador llamase a `concludeTask` de nuevo, la traza se pierde en silencio.
- **Acción en A.8**: Marcar `context.traced = true;` únicamente al final del bloque `try`, tras la escritura exitosa en disco.

### 7.5. Bloque 6 — Compatibilidad de UI y etapa `REPLAN` (A.6)

Se revisaron todas las referencias a `stage` y `"PLAN_GENERATION"` / `"REPLAN"` en `ui/`:
- `ui/components/DecisionStream/components/ModelIterationCard.tsx:51-56`:
  ```tsx
  case "PLAN_GENERATION":
    return "Planificación Global";
  case "REPLAN":
    return "Replanificación";
  ```
  La UI **ya cuenta con el caso `"REPLAN"`** en su selector de títulos.
- `ui/components/DecisionStream/components/ModelIterationCard.tsx:561-564`: cualquier etapa que no sea una decisión o verificación cae automáticamente en el visor detallado de razonamiento (renderizando `rawInput`/`rawOutput` y datos estructurados).
- `ui/components/ProcessFlow/ProcessFlow.tsx:50`: `const isMaterialReplan = (task.replans ?? 0) > 0;` es una variable puramente local de cálculo visual; nadie lee la propiedad `isMaterialReplan: false` emitida en el payload de `PLAN_GENERATED`.
- **Conclusión (copiada)**: Emitir `isReplan: true` y asignar `stage: "REPLAN"` es 100% seguro y compatible con la UI existente.

### 7.6. Referencia cruzada
La relación entre `ui/utils/debugAccumulator.ts` y `src/core/debugAccumulator.ts` (re-export de `createIterationFromEvent`, e impacto de A.6 sobre la UI en vivo) está documentada en el Bloque 1 de `AUDITORIA_MEMORIA_CONTEXTO.md` (sección 7.1).

---

## 8. Plan de acción (ítems de este documento)

### 8.1. Fase 1

#### Ítem A.6: Emisión e identificación inequívoca de la etapa `REPLAN` (INC-003)
- **Archivos a modificar**: `src/core/modeEngines.ts`, `src/core/debugAccumulator.ts`.
- **Acción concreta**:
  1. En `modeEngines.ts:360` (`handleReplan`): añadir `isReplan: true` al payload emitido en `PLAN_GENERATED`.
  2. En `debugAccumulator.ts:225`: si `data.isReplan === true`, asignar `stage: "REPLAN"` y `stepTitle: "Replanificación Autónoma de Etapas"`.
- **Riesgo**: Cero. Compatible 100% con `ModelIterationCard.tsx` en UI.
- **Prueba manual**: Provocar un fallo en un paso de modo PLAN que dispare replanificación; comprobar en la UI que la iteración se titule "Replanificación" y que la traza JSONL consigne `stage: "REPLAN"`.

### 8.2. Fase 2 — Instrumentación de traza para laboratorio

#### Ítem A.8: Correlación estricta de `callSeq`, `resultPreview` y cota de `args` en traza (INC-002, INC-012)
- **Archivos a modificar**: `src/core/taskTrace.ts`; `src/core/callExecutor.ts` (únicamente para propagar el `iterationId` en `StepCall`).
- **Acción concreta**:
  1. En `callExecutor.ts:514-528`: asignar `iterationId: argIterationId` en `callRecord`.
  2. En `taskTrace.ts`:
     - Calcular `calls` y construir un mapa unívoco `iterationId -> seq` para llamadas `ARGUMENT_GENERATION`.
     - Asignar `callSeq: c.iterationId ? iterationMap.get(c.iterationId) ?? null : null` en cada `toolRun`.
     - Asignar `resultPreview: (c.evidence?.obs || c.evidence?.summary || "").slice(0, 500) || undefined`.
     - Acotar strings en `toolRuns.args` que superen 2000 caracteres con un marcador `[... recortado en traza]`.
     - Mover `context.traced = true` al final del bloque `try` tras la escritura efectiva en disco.
- **Riesgo**: Cero para UI y backend.
- **Prueba manual**: Ejecutar una tarea completa y correr `npx tsx lab/extract-cases.ts`, comprobando que los casos en `lab/cases/arguments/_drafts/` tengan su bloque `toolRun` enlazado exactamente con `callSeq`.

### 8.3. Bloque B — Correcciones de documentación (parte de este documento)

Copiado del Bloque B del original, apartado que corresponde a la traza (INC-010 y decisiones P1/P3):
- **`docs/CONTEXT_AND_MEMORY.md`, Sección 4**: Documentar formalmente la tabla de los tres artefactos independientes, explicitando la pureza volátil de la auditoría de UI (Decisión P1) y que el proceso finaliza de inmediato ante SIGINT (Decisión P3).
- INC-010 queda resuelta mediante esta documentación (Bloque B.1).

El resto del Bloque B (hechos sin veredicto, `scratchpad` vs `context.lastCall*`, resolución de INC-014, sincronización de `CORE_FLOW.md`) está en `AUDITORIA_MEMORIA_CONTEXTO.md`.

### 8.4. Bloque D — Funcionalidades nuevas y observabilidad opcional (fuera de esta fase)

1. **Propagación masiva de métricas de latencia y tokens (antiguo A.7 / INC-011)**:
   - *Coste*: Modificación de `qwen.ts`, `decision.ts`, `callExecutor.ts`, `modeEngines.ts`, `core.ts`, `debugAccumulator.ts`.
   - *Motivo de exclusión*: No es requerido por `lab` ni mostrado por `ui`.
2. **Poblado de `candidate_tools` en `Step`**: Mantener sin poblar (funcionalidad nueva).
3. **Inclusión de Decision #1 en modo PLAN (INC-004)**: Mantener diseño original (no requerido por `lab`).
4. **Endpoint de lectura histórica de trazas para UI (INC-010)**: Descartado por Decisión P1.
5. **Graceful Shutdown ante SIGINT**: Descartado por Decisión P3.
6. **Reintentos correctivos que no quedan en la traza**: decisión de diseño pendiente (ver Bloque 5, "Reintentos intermedios de inferencia"). Coste: `qwen.ts` y eventos.

---

## 9. Puntos abiertos a verificar (no son hallazgos confirmados)

1. **A.8 / `iterationId`**: no está definido cómo `callExecutor` obtiene el id de la iteración `ARGUMENT_GENERATION` (el id se genera en `createIterationFromEvent`). Falta añadir `types.ts` (campo `StepCall.iterationId?`) a los archivos y enumerar todos los puntos donde se crea un `StepCall` (Guard denegado, anti-loop, argumentos inválidos, error de despacho) para saber cuáles quedan con `callSeq = null`.
2. **`context.traced`**: mover la bandera al final del `try` no está justificado (no hay camino de reintento; el fallo ya se captura con `console.warn`). Verificar si la construcción de `calls`/`toolRuns` está dentro del `try`.
3. **Colisión de ids** de iteración: no está cerrada (el contador `_seq` no figura en ningún ítem). Verificar también si los `step.id` de pasos nuevos tras replan son únicos respecto a los `superseded`.
4. **A.6**: evidencia de UI incompleta; revisar contadores `totalEos`/`totalQwen`, `groupIterationsByStep` y `reconstructIterationsFromTask` (la vista reconstruida seguiría mostrando `PLAN_GENERATION`).
5. `resultPreview` es solo ÚTIL y la cota de `args` es defensiva: confirmar si entran o se difieren.
6. Los reintentos correctivos de salida inválida no quedan en la traza (solo el último intento): decisión de diseño pendiente (Bloque D).

---

## 10. Puntos de contacto con `AUDITORIA_MEMORIA_CONTEXTO.md`

- **Archivos compartidos**: `src/core/debugAccumulator.ts` (A.6, aquí), `src/core/callExecutor.ts` (A.8 aquí; A.4 y A.3 en el documento de memoria), y `src/core/types.ts` (A.1 en el documento de memoria y `StepCall.iterationId` de A.8 aquí).
- **Origen común**: el botón de UI y la traza leen `modelIterations`.
- **Orden acordado**: primero memoria y contexto; la traza se aborda después.

---

## 11. Tabla de cobertura de este documento

| Inconsistencia / Tarea | Acción Asignada | Fase / Bloque | Estado |
|---|---|:---:|:---:|
| **INC-002** (`callSeq` en traza) | **Ítem A.8** (`taskTrace.ts`, `callExecutor.ts`) | Fase 2 | Cubierto |
| **INC-003** (Etapa `REPLAN` en ciclo y traza) | **Ítem A.6** (`modeEngines.ts`, `debugAccumulator.ts`) | Fase 1 | Cubierto |
| **INC-004** (Decision #1 en modo PLAN) | **Bloque D.3** (Fuera de fase por diseño) | Bloque D | Justificado |
| **INC-010** (Auditoría UI vs Traza en disco) | **Bloque B.1** (Reclasificada como nota documental; Decisión P1) | Bloque B | Cubierto |
| **INC-011** (Métricas de latencia y tokens) | **Bloque D.1** (Trasladado a Bloque D por coste innecesario) | Bloque D | Justificado |
| **INC-012** (Cota de `toolRuns.args`) | **Ítem A.8** (`taskTrace.ts`) | Fase 2 | Cubierto |

Ítems del plan en este documento: A.6 (Fase 1), A.8 (Fase 2), antiguo A.7 (Bloque D). El resto (A.1–A.5, A.9) está en `AUDITORIA_MEMORIA_CONTEXTO.md`.