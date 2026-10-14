# Contexto y Memoria en JARVIS Core

> Última revisión: **2026-10-13** (v1.3 — Memoria Factual Continua, Effects, Handoffs y Recuperación Progresiva)

JARVIS Core administra la información contextual que reciben los modelos diferenciando dos canales estrictos: el clasificador estructurado **Decision 2.0 (Eos-0.8B)** y el razonador LLM **Qwen 3.5 9B**.

- Para **Decision 2.0** (`src/core/decision.ts`), el contexto se condensa en un objeto sintético `state` que agrega la meta actual (`taskMessage`), el historial compacto (`LOG` y `FAIL`), las acciones previas ejecutadas (`attempts`), el último resultado observable y variables operativas relevantes, evaluado junto a preguntas estructuradas (`questions`).
- Para **Qwen 3.5 9B** (`src/core/reasoner/qwen.ts`), el contexto se ensambla jerárquicamente a partir de directivas de sistema por etapa y un bloque estructurado compuesto por la meta (`GOAL`), el historial continuo no degradado (`LOG`), el plan activo (`PLAN`), la capa de efectos secundarios confirmados (`EFFECTS`), el registro de fallos (`FAIL`), los hechos deterministas extraídos (`FACTS`), la definición de la herramienta seleccionada con su esquema JSON limpio (`SCHEMA`), la última observación sanitizada (`<obs>`) y los datos de transferencia previa (`HANDOFF`).

---

## 1. Construcción del Contexto para Modelos

Orden y fuentes de los bloques que componen el contexto inyectado en Qwen (ilustrado para la generación de argumentos en `PROMPTS.ARGUMENTS.buildUserPrompt`):

| Orden | Bloque | Fuente en Runtime | Propósito y Contenido |
|:---:|---|---|---|
| **1** | **Directivas de Sistema** | `PROMPTS.ARGUMENTS.SYSTEM` | Reglas de respuesta exclusiva en JSON estricto, adherencia obligatoria al SCHEMA y prohibición de inventar parámetros. |
| **2** | **Meta (`GOAL`)** | `task.message` | Objetivo general solicitado por el usuario (ej. `"Busca en la web el precio de Bitcoin y guárdalo en archivo"`). |
| **3** | **Plan Activo (`PLAN`)** | `buildPlanLines(task)` | Etapas del plan con estado (`[x]` completado, `[>]` actual, `[ ]` pendiente) y criterios observables. |
| **4** | **Historial Continuo (`LOG`)** | `task.memory.log` | Entradas históricas sin colapso estadístico prematuro (hasta 30 entradas): `stepSeq\|tool\|status\|finding`. |
| **5** | **Efectos Confirmados (`EFFECTS`)** | `task.memory.effects` | Registro de mutaciones reales aplicadas sobre el entorno (`step\|tool\|mutación confirmada`) para evitar re-mutaciones redundantes. |
| **6** | **Registro de Fallos (`FAIL`)** | `task.memory.fail` | Causas de error técnico, denegaciones de Guard o rechazos del operador (hasta 5 entradas más recientes). |
| **7** | **Hechos Estructurados (`FACTS`)** | `task.memory.facts` | Pares clave-valor extraídos deterministamente (`path`, `win`, `pid`, `url`, `cand`). |
| **8** | **Definición de Herramienta (`TOOL`)** | `tool.name` y descripción breve | Identificador de la herramienta elegida y resumen de su capacidad operativa. |
| **9** | **Esquema Limpio (`SCHEMA`)** | `cleanInputSchema(tool.inputSchema)` | JSON Schema depurado sin campos redundantes (`$schema`, `title`, `additionalProperties`, `examples`). |
| **10** | **Última Observación (`LAST`)** | `context.lastCallCompactObs` | Observación compacta del resultado anterior delimitada por etiquetas `<obs>...</obs>` previamente sanitizada con `safe()`. |
| **11** | **Handoff Determinista (`HANDOFF`)** | `applyStepHandoff(step, context)` | Hechos clave, referencias temporales (`[ref:rX]`) y hallazgos transferidos directamente desde la etapa previa. |
| **12** | **Error Previo de Schema** | `promptData.previousError` | En reintentos de Qwen (`MAX_ARG_RETRIES = 2`), descripción exacta del campo faltante o formato inválido para auto-corrección. |
| **13** | **Instrucción de la Etapa (`TASK`)** | `step.instruction` | Objetivo operativo concreto a resolver en la llamada actual. |

---

## 2. Prompts Centralizados del Sistema

Estructuras administradas en `src/core/reasoner/prompts.ts`:

| Prompt / Builder | Destinatario | Propósito Operativo |
|---|:---:|---|
| `PROMPTS.ARGUMENTS` | Qwen 3.5 9B | Instruye la generación estricta de parámetros JSON conformes al `cleanInputSchema` de la herramienta. |
| `PROMPTS.PLAN` | Qwen 3.5 9B | Solicita descomponer el objetivo en una lista ordenada de hasta 15 etapas verificables con dependencias y criterios de éxito. |
| `PROMPTS.REPLAN` | Qwen 3.5 9B | Reformula exclusivamente las etapas pendientes ante desviaciones recuperables conservando las etapas completadas. |
| `PROMPTS.STAGE_VERIFICATION` | Qwen 3.5 9B | Evalúa si la evidencia observable de una etapa cumple su `expectedOutcome`, clasificando en las 4 situaciones normativas. |
| `PROMPTS.FINAL_RESPONSE` | Qwen 3.5 9B | Sintetiza la respuesta final al operador en lenguaje natural basándose estrictamente en `LOG`, `FACTS` y `EFFECTS`. |
| `DECISION_PROMPTS.buildDecisionOne` | Decision 2.0 (Eos) | Construye el estado y las preguntas para enrutamiento estructural (`route`: choice) y dependencia de contexto (`needs_context`: noul). |
| `DECISION_PROMPTS.buildDecisionTwo` | Decision 2.0 (Eos) | Construye el estado y la pregunta `selected_tool` (choice entre herramientas descubiertas con advertencias anti-repetición). |
| `DECISION_PROMPTS.buildStepVerification` | Decision 2.0 (Eos) | Evalúa binariamente sobre señales limpias la validez técnica (`ok`) y cumplimiento de instrucción (`cumple`) por argmax. |

---

## 3. Capas de Memoria y Ciclo de Vida

```
                      TASK MEMORY (Memoria de Tarea en JarvisCore)
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ 1. LOG CONTINUO     Hasta 30 entradas completas sin colapso a 1-N               │
  │    (log)            Formato: stepSeq|tool|status|finding                       │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ 2. HECHOS FACTUALES Pares clave-valor deterministas extraídos por ResultProcessor│
  │    (facts)          Claves: path, win, pid, url, cand                           │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ 3. EFECTOS          Registro acumulado de mutaciones confirmadas sobre el disco │
  │    (effects)        o procesos del sistema para evitar re-mutaciones redundantes│
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ 4. COLA DE FALLOS   Últimos 5 errores técnicos, bloqueos Guard o denegaciones   │
  │    (fail)           Formato: tool -> motivo exacto del fallo                    │
  ├─────────────────────────────────────────────────────────────────────────────────┤
  │ 5. SCRATCHPAD       Pizarra operativa en memoria: variables temporales activas  │
  │    (scratchpad)     window_handle, process_id, selected_result, etc.            │
  └─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                     RefStore (Almacén Volátil en Memoria)
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ Salidas completas masivas indexadas por ref:r1, ref:r2... aisladas por taskId.  │
  │ Consultable interactivamente en la UI vía /api/jarvis/ref/:refKey               │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 LOG Continuo sin Colapso Estadístico Prematuro
- **Comportamiento v1.3:** Se eliminó el mecanismo legado que colapsaba agresivamente el historial en una sola línea `1-N: X ok, Y err` al superar 12 entradas.
- **Capacidad:** Ahora se preserva el historial textual continuo completo con todas sus herramientas, códigos de salida y hallazgos detallados hasta **30 entradas**, cubriendo ampliamente el límite estructural de `MAX_STEPS = 15` sin degradación semántica.

### 3.2 Capa de Efectos Secundarios Confirmados (`effects`)
- Cada vez que una herramienta de mutación (`policy.mutates || policy.capability !== "READ"`) concluye satisfactoriamente, se invoca `addEffectEntry(context, ...)`.
- Registra el paso, la herramienta y el cambio confirmado en el entorno (ej. `"s2|write_file: Archivo version.txt creado en disco"`).
- Se inyecta en los prompts de generación de argumentos y en la síntesis de la respuesta final para prevenir llamadas duplicadas sobre archivos ya creados o modificados.

### 3.3 Handoff Determinista entre Etapas
- Tipado en `StepHandoff` e implementado mediante `applyStepHandoff(step, context)`.
- Si un paso declara dependencias (`dependencies: ["s1"]`) o sigue inmediatamente a otro paso, el prompt del nuevo paso se enriquece de forma determinista con el prefijo:
  `[HANDOFF s1 (tool_name)]: finding | key=value [ref:rX]`
- Permite que el razonador conozca exactamente la ruta, el identificador de proceso o la URL obtenida por el paso precedente sin necesidad de deducirlo del historial global.

### 3.4 Almacén de Referencias Temporales (`RefStore`)
- Implementado en `src/core/processor/resultProcessor.ts`.
- Métodos públicos: `put(content, taskId)`, `get(refKey, taskId)`, `has(refKey, taskId)`, `list(taskId)` y `clear(taskId)`.
- Almacena el texto íntegro devuelto por herramientas (ej. 50.000 caracteres de salida de terminal o páginas web completas).
- En el prompt de los modelos se inyecta únicamente el hallazgo sintético (`compactObs`) y el token de referencia `[ref:rX]`.
- Al concluir o cancelarse la tarea, `RefStore.clear(taskId)` libera inmediatamente la memoria ocupada.

---

## 4. Política de Memoria Contextual Progresiva (2 → 5 → 10)

En estricta conformidad con la Sección 7.1 del Plan Maestro v1.3, el sistema evita saturar la ventana de contexto de los modelos mediante un escalado progresivo y determinista:

| Nivel de Memoria | Elementos Inyectados | Activación y Criterio |
|:---:|:---:|---|
| **Nivel 1 (Inicial)** | **2** elementos más recientes | Configuración predeterminada al arrancar la tarea. Suficiente para la mayoría de llamadas secuenciales atómicas. |
| **Nivel 2 (Intermedio)** | **5** elementos relevantes | Activado automáticamente cuando Decision #1 emite la señal `needsContext === true` ($p \ge 0.5$) o tras el primer fallo de herramienta. |
| **Nivel 3 (Techo Máximo)** | **10** elementos relevantes | Techo absoluto de contexto activado en flujos de escalación crítica (`handleEscalation`) o replanificación estructural en PLAN. |

La función `expandMemoryContext(context)` gobierna las transiciones entre niveles, impidiendo que historiales masivos desplacen las directivas de seguridad o los esquemas de herramientas.

---

## 5. Sustitución de Referencias con `RefResolver`

Antes de que los argumentos generados por Qwen sean evaluados por la compuerta de seguridad Guard o despachados a los servidores MCP, `RefResolver.resolveReferences(args, taskId)`:

1. Escanea recursivamente cadenas, arreglos y objetos en búsqueda de tokens sintéticos `{{ref:rX}}`, `{{rX}}` o `ref:rX`.
2. Si el token existe en `RefStore`, extrae el contenido íntegro.
3. Si el contenido corresponde a un objeto JSON válido, lo parsea e inyecta como estructura nativa; si es texto plano, lo sustituye en la cadena.
4. **Garantía de Seguridad:** Guard inspecciona los argumentos ya resueltos (rutas reales, comandos desempaquetados), imposibilitando que comandos destructivos se oculten tras referencias temporales.

---

## 6. Persistencia y Gestión de Estado entre Reinicios

- **Almacenamiento en Disco:** Las tareas se serializan en `jarvis-tasks.json` tras cada transición de estado mediante `persistTasks()`, conservando las últimas 20 tareas en total.
- **Volatilidad de `RefStore`:** `RefStore` reside estrictamente en memoria volátil de Node.js. Por diseño normativo, los contenidos masivos de herramientas no se persisten en disco para evitar archivos de estado descomunales o filtración de datos sensibles en texto claro.
- **Recuperación tras Reinicio:** Si el servidor se reinicia mientras existían tareas en estado `RUNNING` o pasos en `WAITING_APPROVAL`, `loadPersistedTasks` transiciona limpiamente la tarea a `CANCELLED` y los pasos a `BLOCKED` con el mensaje: `"Tarea interrumpida: servidor reiniciado durante la ejecución"`.
