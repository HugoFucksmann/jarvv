# JARVIS Lab — Documento de Contexto y Transferencia Técnica

Este documento constituye la memoria técnica integral, de diseño y de arquitectura de `lab/`. Su objetivo es permitir que cualquier agente o desarrollador retome el trabajo con fidelidad absoluta al estado real del código, sin necesidad de recurrir a historiales de conversación previos.

---

## 1. Propósito y Filosofía del Laboratorio

JARVIS es un agente personal y determinista para PC (entorno Windows local, ruta de proyecto `E:\colo\jarvv`). El sistema opera combinando dos modelos complementarios:
- **Decision-2.0-Eos-0.8B ("Eos"):** Clasificador de decisiones y enrutamiento estructural. Corre en un servidor local propio (`POST http://127.0.0.1:8765/v1/decide`). Contrato estricto: `{ state: string, questions: Record<string, DecisionQuestion> }` → `{ answers: Record<string, DecisionAnswer> }`.
- **Qwen 3.5 9B ("Qwen"):** Razonamiento, extracción de argumentos de herramientas, síntesis de planes y respuesta final vía Ollama (`POST http://127.0.0.1:11434/v1/chat/completions`, dialecto OpenAI-compatible).

`lab/` es un laboratorio paralelo e independiente dentro del repositorio para evaluar y contrastar variantes de prompts contra el comportamiento estable (`stable`) de JARVIS, sobre casos históricos reales y casos de prueba, con métricas cuantitativas reproducibles y sin efectos colaterales (sin tocar MCP ni escribir fuera de `lab/`).

### Estado de Implementación de Etapas en `lab/`:
- `decision_one` (Eos; internamente `DECISION_ONE`): **Implementada**.
- `arguments` (Qwen; internamente `ARGUMENT_GENERATION`): **Implementada**.
- `decision_two` (Eos; internamente `DECISION_TWO`): **Implementada** (Fase B).
- `step_verification` (Eos; internamente `STEP_VERIFICATION`): **Implementada** (Fase B).
- `stage_verification` (Qwen; internamente `STAGE_VERIFICATION`): **Implementada** (Fase C).
- `plan` (Qwen; internamente `PLAN_GENERATION`): **Implementada** (Fase C).
- `replan` (Qwen; internamente `REPLAN`): **Implementada** (Fase C).
- `final_response` (Qwen; internamente `FINAL_RESPONSE`): **Registrada en catálogo**, pendiente para Fase D.

---

## 2. Visión del Laboratorio en Dos Fases

El laboratorio se concibe como la base arquitectónica para un ciclo evolutivo de automejora de prompts:

### Fase 1: Evaluación Aislada por Etapa sobre Casos Reales (Estado Actual)
- **Alcance:** Repetición y evaluación de una sola etapa (aislada) sobre casos extraídos de trazas reales.
- **Funcionamiento:** Se congela la entrada del paso (`rawInput`), se envía al modelo evaluado (con el prompt estable o la variante), se ejecutan checks sintácticos y semánticos (`valid_json`, `choice_equals`, `matches_schema`, `field_equals`) y se calculan tasas de acierto y latencias.
- **Propósito:** Optimizar localmente cada prompt (por ejemplo, reducir tokens en SYSTEM de arguments, clarificar descripciones en criteria de Eos) sin riesgo de descalabrar el flujo general del agente.

### Fase 2: Ejecución del Agente Completo con Inyección de Prompts en Entorno Aislado (A Futuro)
- **Alcance:** Correr el agente JARVIS completo de punta a punta ejecutando una tarea de usuario de principio a fin, pero inyectando variantes de prompt experimentales para evaluar el impacto global en la tasa de resolución de tareas.
- **Requisitos arquitectónicos necesarios antes de Fase 2:**
  1. *Punto de inyección en `src/`:* Mecanismo para que `QwenEngine` y `Decision20Engine` puedan recibir un diccionario opcional de prompts alternativos por tarea (sin modificar las constantes estables de `prompts.ts`).
  2. *Entorno seguro de ejecución:* Herramientas MCP simuladas o un sandbox / carpeta temporal dedicada para que las acciones (`write_file`, comandos de consola) no alteren archivos reales de la PC durante la optimización automática.
  3. *Criterio de éxito por tarea:* Definición de oráculos de evaluación a nivel tarea (verificación de estado final del entorno y cumplimiento de meta) más allá de los checks unitarios por paso.

---

## 3. Reglas Estrictas de Diseño

1. **Aislamiento exterior absoluto:** No se modifica nada fuera de `lab/` (ni `src/`, ni `package.json`, ni `tsconfig.json`, ni el `.gitignore` raíz).
2. **Puente único:** `src/` nunca importa nada de `lab/`. Dentro de `lab/`, **únicamente `adapter.ts`** tiene permitido importar de `src/`.
3. **Reutilización sin duplicación:** Reutiliza de `src/` lo exportado (`ConfigManager`, `postJson`, `estimateTokens`, `TransportError`, `PROMPTS`, `parseJsonObject`, `validateArgs`, `stripThink`). La única reescritura es el validador mínimo de respuestas de Eos (`parseDecisionResponse`), necesario porque `Decision20Engine.parseResponse` es privado.
4. **Cero efectos colaterales:** No ejecuta servidores MCP. Escrituras de disco acotadas a `lab/results/` (con flag inmutable `"wx"`) y `lab/cases/<etapa>/_drafts/`.
5. **Separación de roles:** Quien propone (`prompts/variants/`) no evalúa (`cases/` y `evaluate.ts`).
6. **Sin dependencias externas:** ESM nativo, TypeScript con `npx tsx`, sin librerías adicionales ni suites pesadas de testing. Configuración en JSON (`lab/config.json`).
7. **Sin simulaciones:** Nunca se inventan respuestas. Si un endpoint local está caído (`ECONNREFUSED`), la corrida aborta inmediatamente sin generar archivos de resultados corruptos.

---

## 4. Mapa Completo de `lab/`

| Archivo / Ruta | Responsabilidad | Entradas | Salidas |
| :--- | :--- | :--- | :--- |
| `lab/config.json` | Configuración central del laboratorio: ruta del archivo de trazas y número de repeticiones por etapa. | — | Parámetros leídos por `loadConfig()` en runner y extractor. |
| `lab/types.ts` | Definiciones TypeScript de todos los contratos: etapas, splits, casos, checks, variantes, repeticiones y resultados. Cero imports. | — | Tipos exportados para todo `lab/`. |
| `lab/adapter.ts` | **Único puente con `src/`**. Resuelve URLs, ejecuta llamadas a Eos y Qwen reproduciendo el transporte de Jarvis, valida schemas y respuestas, y cataloga etapas activas y pendientes. | Casos tipados (`CaseInput*`) y variantes de prompt. | Salida de modelos, latencias, tokens, `parseAndValidate` y `parseOutput`. |
| `lab/extract-cases.ts` | Extractor de borradores desde JSONL de trazas reales. Analizador balanceado de `SCHEMA` y extractor tolerante con fallbacks de `seq` y `step`. Modo solo lectura sobre trazas. | `jarvis-traces.jsonl` (o fixture vía `--file`). | Archivos en `lab/cases/<etapa>/_drafts/` con `expect: null`. |
| `lab/run.ts` | Orquestador CLI de benchmarks (`npx tsx lab/run.ts <etapa> <prompt> [--split]`). Ejecuta llamada de warmup previa, mide repeticiones secuenciales, evalúa checks, computa promedio/mediana y guarda resultado atómico con `"wx"`. | Casos en `cases/<etapa>/` y variantes en `prompts/variants/<etapa>/`. | Archivo inmutable `lab/results/<timestamp>-<etapa>-<variante>.json`. |
| `lab/evaluate.ts` | Comparador CLI entre dos corridas (`npx tsx lab/evaluate.ts <A.json> <B.json>`). Valida integridad (rechaza caídas o 100% errores), compatibilidad de casos y muestra informe cuantitativo descriptivo con medianas y diferencias de probabilidad en Eos. | Dos archivos JSON de `lab/results/`. | Reporte comparativo en consola (stdout). |
| `lab/README.md` | Documentación operativa, tabla de etapas, comandos CLI, formato de casos/variantes y paridad con producción. | — | Guía de uso rápido para el desarrollador. |
| `lab/CONTEXT.md` | Memoria técnica profunda, mapas de funciones, hallazgos empíricos, decisiones y estado de pendientes (este archivo). | — | Documento de transferencia para agentes. |
| `lab/.gitignore` | Excluye borradores (`_drafts/`), casos reales del usuario (conservando `example-*`) y resultados (`results/*.json`, conservando `.gitkeep`). | — | Reglas locales de git. |
| `lab/cases/` | Casos de evaluación organizados por etapa (`decision_one/`, `arguments/`). Casos con `expect: null` se consideran pendientes y se omiten al correr. | — | Casos de prueba activos y subcarpeta `_drafts/`. |
| `lab/prompts/variants/` | Variantes experimentales de prompts organizadas por etapa: `.md` para Qwen (`arguments`), `.json` para Eos (`decision_one`). | — | Definiciones de variantes para el runner. |
| `lab/fixtures/example-traces.jsonl` | Registro sintético de 4 trazas representativas (FAST, PLAN, reintento, fallo de herramienta) para pruebas y validación del extractor sin depender de Jarvis. | — | Fixture de entrada para tests de extracción. |
| `lab/results/` | Almacén de archivos inmutables de resultados de benchmarks generados por `run.ts`. | — | Archivos `.json` de corridas (ignorados por git salvo `.gitkeep`). |

### Flujo de Trabajo Extremo a Extremo:
1. `jarvis-traces.jsonl` (trazas reales generadas por Jarvis en la raíz).
2. `npx tsx lab/extract-cases.ts`: genera borradores en `lab/cases/<etapa>/_drafts/` con `expect: null` y bloque `reference`.
3. Revisión humana: el desarrollador examina el borrador, define `expect: [...]` y mueve el archivo a `lab/cases/<etapa>/<id>.json`.
4. `npx tsx lab/run.ts <etapa> stable`: ejecuta el benchmark sobre el prompt estable y guarda `lab/results/<run-stable>.json`.
5. `npx tsx lab/run.ts <etapa> <variante>`: ejecuta el benchmark sobre la variante y guarda `lab/results/<run-variant>.json`.
6. `npx tsx lab/evaluate.ts <run-stable>.json <run-variant>.json`: despliega el reporte comparativo cuantitativo.

---

## 5. Mapa Exhaustivo de `src/` (Funciones Clave y Rutas)

Para cada componente del núcleo del cual depende `lab/` o con el cual interactuará, listado con el **nombre de la función primero** y su ubicación/línea aproximada:

### A. Prompts Centralizados (`src/core/reasoner/prompts.ts`)
- `clipObs` (`src/core/reasoner/prompts.ts` ~72): Trunca observaciones extensas preservando marcadores especiales de referencia `ref:rX`.
- `dataBlock` (`src/core/reasoner/prompts.ts` ~109): Envuelve bloques de datos externos en etiquetas `<obs>...</obs>` saneando caracteres de escape con `safe()`.
- `retryNote` (`src/core/reasoner/prompts.ts` ~151): Genera la advertencia de corrección para el reintento de Qwen tras una salida inválida (`ERROR_PREVIO:...`).
- `PROMPTS.ARGUMENTS.SYSTEM` (`src/core/reasoner/prompts.ts` ~212): Prompt de sistema vivo utilizado para la generación de argumentos de herramientas por Qwen.
- `PROMPTS.ARGUMENTS.buildUserPrompt` (`src/core/reasoner/prompts.ts` ~220): Ensambla el prompt de usuario concatenando bloques `ENV`, `TOOL`, `SCHEMA`, `GOAL`, `TASK`, etc.
- `PROMPTS.FINAL_RESPONSE` (`src/core/reasoner/prompts.ts` ~246): Prompt del sistema y constructor del mensaje de usuario para la síntesis de respuesta final.
- `PROMPTS.PLAN` (`src/core/reasoner/prompts.ts` ~270): Prompt del sistema y constructor para la generación de planes estructurados de pasos.
- `PROMPTS.REPLAN` (`src/core/reasoner/prompts.ts` ~299): Prompt del sistema y constructor para replanificación ante pasos fallidos o desvíos.
- `PROMPTS.STAGE_VERIFICATION` (`src/core/reasoner/prompts.ts` ~326): Prompt del sistema y constructor para supervisión y verificación semántica de etapas en modo PLAN.
- `DECISION_PROMPTS.buildDecisionOne` (`src/core/reasoner/prompts.ts` ~441): Construye el par `{ state, questions }` para el clasificador Eos en Decision #1 (selección de ruta: `files`, `locate`, `terminal`, `web`, `fin`).
- `DECISION_PROMPTS.buildDecisionTwo` (`src/core/reasoner/prompts.ts` ~473): Construye el par `{ state, questions }` para Decision #2 (selección de herramienta específica dentro del servidor MCP activo).
- `DECISION_PROMPTS.buildStepVerification` (`src/core/reasoner/prompts.ts` ~502): Construye preguntas de verificación factual `noul` (`ok`, `cumple`) para Eos.

### B. Motor de Razonamiento Qwen (`src/core/reasoner/qwen.ts`)
- `stripThink` (`src/core/reasoner/qwen.ts` ~181): Remueve bloques de razonamiento `<think>...</think>` (cerrados, huérfanos o sin cerrar) de la salida del modelo.
- `parseJsonObject` (`src/core/reasoner/qwen.ts` ~234): Extrae y parsea el primer objeto JSON válido contenido en una respuesta, soportando bloques markdown y caracteres adyacentes.
- `validateArgs` (`src/core/reasoner/qwen.ts` ~286): Valida argumentos contra el `inputSchema` de la herramienta (campos requeridos, tipos básicos, enums y tokens `{{ref:rX}}`).
- `resolveUrl` (`src/core/reasoner/qwen.ts` ~409): Resuelve y valida la URL de Ollama/Qwen garantizando que apunte a `/v1/chat/completions`.
- `dispatchPrompt` (`src/core/reasoner/qwen.ts` ~424): Aplica la guarda de tokens (`qwenNumCtx - promptEstimate >= 256`), llama a `postJson`, gestiona timeouts (thinking vs estándar) y extrae `content`, `usage`, `finish_reason` y el indicador de truncamiento `truncated`.
- `dispatchValidated` (`src/core/reasoner/qwen.ts` ~516): Implementa la política de reintentos de producción: si la salida no pasa la validación, realiza hasta 1 reintento inyectando `retryNote`, aumentando el presupuesto de tokens a 1.5x y fijando temperatura 0.3.
- `generateArguments` (`src/core/reasoner/qwen.ts` ~550): Orquesta la etapa de argumentos. En las líneas 569-571 elimina claves opcionales con valor `null` antes de validar con `validateArgs`.
- `generateFinalResponse` (`src/core/reasoner/qwen.ts` ~582): Genera la respuesta final al usuario en texto libre.
- `generatePlan` (`src/core/reasoner/qwen.ts` ~609): Genera el plan estructurado validado contra `PLAN_JSON_SCHEMA`.
- `replan` (`src/core/reasoner/qwen.ts` ~650): Genera el nuevo plan localizado a partir de un paso fallido.
- `verifyStage` (`src/core/reasoner/qwen.ts` ~699): Ejecuta la verificación semántica de etapa.

### C. Motor de Decisiones Eos (`src/core/decision.ts`)
- `systemOne` (`src/core/decision.ts` ~55): Invoca `POST /v1/decide` enviando `{ state, questions }`. Valida presupuesto de tokens contra `decisionMaxContext`.
- `evaluateDecisionOne` (`src/core/decision.ts` ~112): Orquesta Decision #1 usando `DECISION_PROMPTS.buildDecisionOne`.
- `evaluateDecisionTwo` (`src/core/decision.ts` ~149): Orquesta Decision #2 usando `DECISION_PROMPTS.buildDecisionTwo`.
- `evaluateStepVerification` (`src/core/decision.ts` ~198): Orquesta la verificación factual de pasos con Eos.
- `parseResponse` (`src/core/decision.ts` ~260, método privado): Valida que la respuesta contenga `answers`, verifica pertenencia de `choice` dentro de `criteria`, filtra probabilidades numéricas y valida rangos `noul` en `[0, 1]`.

### D. Transporte HTTP y Configuración (`src/core/llmTransport.ts` & `src/core/config.ts`)
- `estimateTokens` (`src/core/llmTransport.ts` ~31): Estimador rápido y conservador de tokens (`Math.ceil(text.length / 3)`).
- `postJson` (`src/core/llmTransport.ts` ~61): Cliente HTTP robusto con timeout mediante `AbortSignal`, reintentos ante desconexión de red y soporte para túneles locales.
- `TransportError` (`src/core/llmTransport.ts` ~21): Clase de error tipificado para fallos de red (`kind: "network"`) y expiraciones de tiempo (`kind: "timeout"`).
- `ConfigManager.getConfig` (`src/core/config.ts` ~177): Devuelve una copia profunda inmutable de la configuración activa del sistema. Claves relevantes para el laboratorio: `qwenUrl`, `qwenModel`, `qwenNumCtx`, `qwenMaxTokens.arguments`, `qwenTimeoutMs`, `qwenThinkingTimeoutMs`, `decisionUrl`, `decisionMaxContext`, `decisionTimeoutMs`.

### E. Model Iterations y Depuración (`src/types/debug.ts` & `src/utils/debugAccumulator.ts`)
- `ModelIteration` (`src/types/debug.ts` ~30): Estructura tipada que registra cada llamada a modelo en Jarvis: `id`, `taskId`, `model`, `stage`, `stepId`, `stepSeq`, `input`, `output`, `rawInput`, `rawOutput`, `metrics`.
- `createIterationFromEvent` (`src/utils/debugAccumulator.ts` ~27): Reconstruye una iteración tipada a partir de los eventos emitidos por el núcleo.

### F. Estado de Tareas en Memoria y Puntos de Cierre (`src/core/core.ts` & `src/core/modeEngines.ts`)
- `taskContexts` (`src/core/core.ts` ~37): `Map<string, TaskExecutionContext>` que almacena en memoria RAM todas las tareas activas y recientes. No existe base de datos ni persistencia previa en disco (`jarvis-tasks.json` fue eliminado).
- `concludeTask` (`src/core/modeEngines.ts` ~117): Punto central de finalización de tareas (éxitos o fallos controlados: `COMPLETED`, `PARTIAL`, `FAILED`). Genera la respuesta final con Qwen, actualiza `task.state = state`, emite eventos y descarta conclusiones tardías si la tarea fue cancelada previamente (~127, ~188). **Es el punto de instrumentación principal para el registro de trazas.**
- `failTask` (`src/core/modeEngines.ts` ~99): Punto de cierre ante excepciones no controladas. Establece `task.state = "FAILED"` y emite evento.
- `cancelTask` (`src/core/core.ts` ~186): Punto de cierre ante cancelación explícita del usuario. Establece `task.state = "CANCELLED"`.
- `enforceMaxRetainedTasks` (`src/core/core.ts` ~349-370): Expulsa tareas antiguas cuando `taskContexts.size > MAX_RETAINED_TASKS`, cancelando explícitamente aquellas abandonadas en estado `WAITING_INPUT`.
- Manejo de `WAITING_INPUT`: Estado no final y transitorio en el que la tarea espera intervención humana (`approval`, `plan_confirmation` o `user_answer`). La tarea se reanuda posteriormente; **nunca debe registrarse en el archivo de trazas en este estado**.

---

## 6. Decisiones de Diseño y Diferencias con Producción

| Aspecto | Comportamiento en Producción (`src/`) | Comportamiento en Laboratorio (`lab/`) | Justificación y Razón de Diseño |
| :--- | :--- | :--- | :--- |
| **Reintentos automáticos** | Si la salida no es JSON o no cumple el schema, `dispatchValidated` reintenta 1 vez con `retryNote`, 1.5x tokens y temperatura 0.3. | **Un solo intento por repetición** a temperatura base (0.1). Sin inyección de `retryNote`. | El laboratorio busca medir la capacidad pura y de primera pasada del prompt evaluado. Los reintentos enmascaran debilidades de redacción en los prompts. |
| **Schema en `arguments`** | Valida contra `data.tool.inputSchema` obtenido en vivo desde el proceso MCP conectado. | Valida contra `cleanedSchema` extraído del bloque `SCHEMA:` del user prompt mediante analizador de llaves balanceadas propio. | Permite correr benchmarks sobre casos históricos sin necesidad de levantar servidores MCP externos en ejecución. |
| **Stable de Eos (`decision_one`)** | Genera `{ state, questions }` en vivo llamando a `DECISION_PROMPTS.buildDecisionOne(data)` con el contexto actual. | Utiliza el `{ state, questions }` histórico guardado en el campo `input` del caso (tomado del `rawInput` original). | En casos históricos el estado del sistema (archivos, logs, memoria) ya fue renderizado y no se puede reconstruir en vivo sin el estado de la PC de ese momento. El hash estable se calcula sobre el contenido histórico. |
| **Paridad de `null` en opcionales (IMP-01)** | `qwen.ts:570` elimina claves con valor `null` si no están en `schema.required` antes de llamar a `validateArgs`. | `adapter.ts:341-345` replica exactamente la eliminación de claves con valor `null` no requeridas antes de llamar a `validateArgs`. | Paridad estricta: para los schemas de herramientas, un parámetro opcional en `null` representa "no utilizado", no un error de tipo. |
| **Integridad de Variantes Eos** | El código de producción define las opciones fijas en `criteria`. | `adapter.ts:382-448` valida que la variante **no agregue opciones nuevas al choice ni preguntas desconocidas**. Las opciones omitidas conservan su texto original. | Eos es un clasificador rígido sobre opciones prefijadas. Cambiar las opciones rompe el contrato y desvirtúa la comparabilidad del benchmark. |
| **Registro de Prompt Efectivo** | Solo se registra el payload crudo en la depuración en memoria. | `run.ts` registra el prompt efectivo fusionado (`effectivePromptsByCase`) y hashes SHA-256 (global e individual por caso). | Garantiza trazabilidad y reproducibilidad absoluta de la entrada exacta enviada al modelo. |

---

## 7. Hallazgos Empíricos y Particularidades de los Modelos

1. **Determinismo Estricto de Decision-2.0-Eos-0.8B (Ajuste A):**
   En pruebas empíricas directas, Eos-0.8B produjo distribuciones de probabilidad y selecciones de `choice` matemáticamente idénticas a través de 3 repeticiones consecutivas sobre el mismo caso. Por consiguiente, `lab/config.json` establece `decision_one: 1` repetición. Medir más repeticiones en Eos consume tiempo sin aportar información estocástica. Qwen mantiene 3 repeticiones por defecto debido a su naturaleza probabilística.
2. **Latencia de Calentamiento en Qwen (Warmup - Ajuste B):**
   La primera inferencia enviada a Ollama tras un período de inactividad o cambio de modelo incurre en una sobrecarga de carga de pesos en memoria RAM/VRAM de ~9 segundos, frente a los ~0,7 segundos de respuestas subsiguientes. Para evitar distorsionar las métricas:
   - `run.ts` ejecuta una llamada de calentamiento (`warmup`) previa por etapa, cuyo tiempo se descarta del promedio y mediana.
   - `evaluate.ts` calcula y muestra la **mediana de latencia** además del promedio, mitigando el impacto de valores atípicos.
3. **El Caso `example-routing-files` es Sintético y No es una Señal de Regresión:**
   El caso `lab/cases/decision_one/example-routing-files.json` fue redactado a mano para pruebas unitarias de estructura del laboratorio. En las pruebas iniciales, Eos seleccionó `locate` con probabilidad 0.59 frente a `files` con 0.05. Este comportamiento es producto de la redacción artificial del texto sintético y **no debe interpretarse como un fallo o regresión de JARVIS en producción**.
4. **Nota Técnica sobre Timeouts en Razonamiento (MEN-01):**
   En la etapa actual de `arguments`, `config.qwenTimeoutMs` es idéntico a producción porque la generación de argumentos se ejecuta con `thinking: false`. Sin embargo, al incorporar en el futuro las etapas de `plan` o `replan` en `lab/adapter.ts`, **se debe utilizar `config.qwenThinkingTimeoutMs`** tal como hace `qwen.ts:465`, dado que el modo de pensamiento prolongado de Qwen requiere presupuestos de tiempo significativamente mayores.

---

## 8. Contrato del Registro de Trazas (`jarvis-traces.jsonl`) y Estado de Implementación

### Estado Actual:
> **PENDIENTE DE IMPLEMENTACIÓN EN `src/` POR OTRO AGENTE**.
> El registro continuo de trazas en `jarvis-traces.jsonl` aún no está implementado en el núcleo de JARVIS. El extractor `extract-cases.ts` y el fixture `lab/fixtures/example-traces.jsonl` ya se encuentran totalmente preparados para consumir este formato cuando esté disponible.

### Estructura del Archivo JSONL:
El archivo reside en la raíz del proyecto (`./jarvis-traces.jsonl`), con una línea JSON por cada tarea concluida:
```json
{
  "v": 1,
  "taskId": "task-20261020-abc",
  "startedAt": "2026-10-20T10:00:00.000Z",
  "endedAt": "2026-10-20T10:00:03.500Z",
  "mode": "FAST",
  "userMessage": "Instrucción original del usuario",
  "status": "COMPLETED",
  "finalResponse": "Respuesta final entregada al usuario",
  "plan": null,
  "calls": [
    {
      "seq": 1,
      "step": 1,
      "stage": "DECISION_ONE",
      "rawInput": "{\"state\":\"...\",\"questions\":{...}}",
      "rawOutput": "{\"answers\":{\"route\":{\"choice\":\"files\",\"probabilities\":{\"files\":0.96}}}}",
      "latencyMs": 120,
      "promptTokens": 140,
      "completionTokens": 35,
      "retried": false,
      "error": null
    }
  ],
  "toolRuns": [
    {
      "step": 1,
      "tool": "read_file",
      "args": { "path": "C:\\Users\\User\\Desktop\\notas.txt" },
      "ok": true,
      "error": null
    }
  ]
}
```

### Reglas de Valores y Contrato:
- `v`: Versión entera del contrato (actualmente `1`).
- `status`: Cadena de texto abierta que refleja el `task.state` real de Jarvis al finalizar (`"COMPLETED"`, `"FAILED"`, `"CANCELLED"`, `"PARTIAL"` o cualquier estado derivado de `resolveFailureState`/`resolveIncompleteState`). **No usar enums cerrados**.
- `mode`: Cadena de texto abierta con el modo real de ejecución (`"FAST"` | `"PLAN"`), sin traducciones.
- `calls.stage`: Identificador de la etapa en mayúsculas (`"DECISION_ONE"`, `"ARGUMENT_GENERATION"`, etc.).
- `calls.rawInput`: Para Qwen es el objeto `{ model, messages, ... }`; para Eos es `{ state, questions }`.
- `calls.retried`: Booleano que indica si la llamada correspondió a un reintento tras salida inválida.
- `toolRuns`: Lista compacta de ejecuciones de herramientas durante la tarea (herramienta, argumentos, éxito `ok` y error). No incluye el cuerpo completo de la salida ni scratchpad.
- **Exclusión de estados intermedios:** La tarea **nunca** debe grabarse mientras se encuentre en `"WAITING_INPUT"`.

### Puntos Candidatos de Instrumentación en `src/`:
1. **Hook Primario en `concludeTask` (`src/core/modeEngines.ts` ~línea 117):**
   Es el punto por donde transcurre la finalización natural de toda tarea. Es invocado tras la respuesta final de Qwen. Se debe añadir la persistencia justo antes de retornar, teniendo en cuenta verificar que la tarea no haya sido cancelada tardíamente (`isTaskCancelled`).
2. **Hook de Fallo en `failTask` (`src/core/modeEngines.ts` ~línea 99):**
   Captura excepciones fatales no controladas y cierra la tarea en estado `FAILED`.
3. **Hook de Cancelación en `cancelTask` (`src/core/core.ts` ~línea 186):**
   Marca la tarea como `CANCELLED`.
4. **Acumulación de `calls` y `toolRuns`:**
   Dado que `taskContexts` en `core.ts:37` ya retiene el contexto en memoria durante la ejecución, basta con almacenar las iteraciones de `ModelIteration` y ejecuciones de herramientas en arrays dentro de `TaskExecutionContext` hasta el cierre de la tarea.
5. **Alternativa Desacoplada (Eventos):**
   Registrar un listener en `jarvisCore.addEventListener` que capture eventos `TASK_STATE_CHANGED` donde el nuevo estado sea terminal (`COMPLETED`, `FAILED`, `CANCELLED`, `PARTIAL`), escribiendo de forma atómica en el archivo de trazas.

---

## 9. Estado Actual del Laboratorio y Próximos Pasos

### Funcionalidades Completadas y Verificadas (Fases A, B y C):
- Contratos de tipos exhaustivos en `lab/types.ts`, incluyendo soporte para las 8 etapas y checks unitarios (`status_equals`, `has_question_for_user`, `action_equals`, `min_steps`, `max_steps`, `routes_allowed`, `contains_text`, `not_empty`, `min_length`).
- Adaptador de producción `lab/adapter.ts`:
  - Eos: `decision_one`, `decision_two` (con preservación de sufijo `[last attempt failed]` según B1), `step_verification`.
  - Qwen: despacho común `callQwenGeneric`, warmup liviano `warmupQwen` (sin pensamiento), `arguments`, `stage_verification` (`STAGE_VERIFICATION_JSON_SCHEMA`, `STAGE_STATUSES`), `plan` (`PLAN_JSON_SCHEMA`, `parsePlanSteps`, thinking con `qwenThinkingTimeoutMs`), `replan` (`REPLAN_JSON_SCHEMA`, validación equivalente inline, thinking con `qwenThinkingTimeoutMs`).
- Runner de benchmarks `lab/run.ts`:
  - Soporte para argumento `--case <id>`.
  - Calentamiento previo mínimo sin pensamiento para Qwen y decide liviano para Eos.
  - Comprobación de fidelidad de Qwen (B2): verificación de prompt SYSTEM vivo contra traza, y aviso explícito obligatorio `"sin recordedParams: no se pudo verificar la fidelidad"` cuando no esté registrado.
  - Evaluación exhaustiva de checks sintácticos y semánticos.
  - Registro de metadatos descriptivos en `RunRepetition` y `CaseRunResult` (`planStepCount`, `planRoutes`, `replanAction`, `stageVerificationStatus`).
- Evaluador comparativo `lab/evaluate.ts`:
  - Comparación de aciertos y latencias (promedio y mediana).
  - Desglose de checks individuales por caso.
  - Métricas específicas: probabilidades Eos, veredicto `ok` y `cumple`, pasos y rutas de `plan` y `replan`, estado y pregunta al usuario en `stage_verification`.
- Casos de prueba y variantes representativos (`example-*`) para las etapas activas.
- Extractor de casos `lab/extract-cases.ts` con mapeo de 8 etapas, saneamiento de reintentos con `ERROR_PREVIO:` y fallback de `replan`.

---

### Notas de Estado por Bloque (Fase C):
- **Bloque 1 (types.ts):** Incorporación de campos descriptivos opcionales en `RunRepetition` y `CaseRunResult` (`planStepCount`, `planRoutes`, `replanAction`, `stageVerificationStatus`).
- **Bloque 2 (adapter.ts):** Implementación de B1 (preservación de `[last attempt failed]` en criteria de `decision_two`). Implementación del despacho unificado `callQwenGeneric` y `warmupQwen`. Implementación de `stageVerificationStage`, `planStage` y `replanStage` con schemas JSON de producción, reutilización de `parsePlanSteps` y validación inline equivalente para replan. Actualización del catálogo `STAGES` y `assertStageImplemented`.
- **Bloque 3 (run.ts y evaluate.ts):** Soporte de `--case <id>`, implementación de B2 (fidelidad de Qwen con aviso explícito ante ausencia de `recordedParams`), warmup no invasivo, logging de progreso por repetición, evaluación de los 14 tipos de checks y despliegue descriptivo de pasos y rutas en `evaluate.ts`.
- **Bloque 4 (Casos y Variantes de Ejemplo):** Creación de casos representativos (`example-verify-stage.json`, `example-create-plan.json`, `example-replan-step.json`) y variantes `.md` correspondientes.

---

### Documentación de Equivalencia en Replan:
En producción (`src/core/reasoner/qwen.ts:666-681`), la validación de `replan` es inline dentro de `dispatchValidated`:
1. Comprueba truncamiento (`truncated`) y validez de JSON (`parseJsonObject`).
2. Si `action === "abort"`: retorna éxito con `reason: nonEmptyString(parsed.reason) ?? "Replan decidió abortar."`.
3. Si `action !== "continue"`: falla con error de acción inválida.
4. Si `action === "continue"`: llama a `parsePlanSteps(parsed.steps, nextStepNumber, false)` (prohíbe lista de pasos vacía y valida rutas contra `EXECUTABLE_ROUTES` y cantidad contra `MAX_STEPS`).
5. Asigna `objective: nonEmptyString(parsed.objective) ?? data.goal`.

En `lab/adapter.ts`, `replanStage.parseAndValidate` replica exactamente este comportamiento:
- Exige que `parsed.action` sea `"abort"` o `"continue"`.
- Si `action === "abort"`, valida que `steps` no contenga pasos (debe ser arreglo vacío o no existir).
- Si `action === "continue"`, exige `objective` no vacío y valida `steps` con `parsePlanSteps(parsed.steps, 1, false)`.
- Si cualquiera de estas condiciones no se cumple, `schemaValid` resulta `false` con el mensaje exacto correspondiente.

---

### Especificación y Diseño para Fase D (final_response):
> **Documentación de diseño previo — NO IMPLEMENTADA EN FASE C**.

- **Propósito:** Evaluar y contrastar la generación de la respuesta final al usuario en texto libre en español, cerrando la tarea con los hallazgos y datos de ejecución.
- **Ubicación en `src/`:**
  - Prompt: `PROMPTS.FINAL_RESPONSE` (`src/core/reasoner/prompts.ts` ~L246):
    - `SYSTEM`: `Eres JARVIS. Responde al usuario en español, de forma directa y completa a su solicitud original, con los datos y hallazgos concretos registrados en LOG, FACTS y EVID...`
    - `buildUserPrompt(data: FinalResponsePromptData)`: ensambla `GOAL`, `LOG`, `FACTS`, `EFFECTS`, `FAIL`, `EVID` y `MOTIVO DE DETENCIÓN`.
  - Método en `src/`: `generateFinalResponse` (`src/core/reasoner/qwen.ts` ~L582).
- **Parámetros del Modelo:**
  - Formato: texto libre (sin `response_format: json_object` ni `json_schema`).
  - Pensamiento: gobernado por `config.thinking` (por defecto `false` en Jarvis).
  - Timeout: `config.qwenTimeoutMs` (o `qwenThinkingTimeoutMs` si `config.thinking === true`).
  - Max tokens: `config.qwenMaxTokens.final`.
  - Temperatura base: 0.1.
- **Checks aplicables en `expect`:**
  - `not_empty`: verifica que la respuesta contenga texto sustantivo.
  - `contains_text`: verifica presencia de palabras clave o datos esenciales esperados (e.g. nombres de archivos, datos hallados, confirmación).
  - `min_length`: verifica longitud mínima en caracteres para evitar respuestas telegráficas o incompletas.
- **Visualización en `evaluate.ts`:**
  - Vista comparativa Side-by-Side (o bloques delimitados) que muestre en consola el texto generado por la Corrida A y la Corrida B para que el evaluador humano pueda juzgar tono, completitud, estilo y precisión sin depender exclusivamente de checks automatizados.
