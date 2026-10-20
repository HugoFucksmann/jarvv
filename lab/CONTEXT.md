# JARVIS Lab — Documento de Contexto y Transferencia Técnica

Este documento constituye la memoria de diseño, arquitectura y referencia técnica de `lab/` para que cualquier sesión o agente nuevo retome el trabajo sin releer todo el historial de conversaciones.

---

## 1. Propósito y Filosofía del Laboratorio

JARVIS es un agente personal y determinista para PC (entorno Windows). Utiliza dos modelos complementarios:
- **Decision-2.0-Eos-0.8B ("Eos"):** Clasificador de decisiones y enrutamiento estructural. Corre en un servidor local propio (`POST http://127.0.0.1:8765/v1/decide`). Contrato estricto: `{ state: string, questions: Record<string, DecisionQuestion> }` → `{ answers: Record<string, DecisionAnswer> }`.
- **Qwen 3.5 9B ("Qwen"):** Razonamiento, extracción de argumentos, planes y síntesis final vía Ollama (`POST http://127.0.0.1:11434/v1/chat/completions`, dialecto OpenAI-compatible).

`lab/` es el laboratorio paralelo para evaluar y contrastar variantes de prompts contra el comportamiento estable (`stable`) de JARVIS, sobre casos históricos reales y casos de prueba, con métricas cuantitativas reproducibles y sin efectos colaterales (sin tocar MCP ni escribir fuera de `lab/`).

Actualmente implementa dos etapas:
- `decision_one` (Eos; internamente `DECISION_ONE`)
- `arguments` (Qwen; internamente `ARGUMENT_GENERATION`)

Las otras 6 etapas (`decision_two`, `step_verification`, `plan`, `replan`, `stage_verification`, `final_response`) están catalogadas en `lab/types.ts` y `lab/adapter.ts` y lanzan `LabStageNotImplementedError` hasta su posterior incorporación.

---

## 2. Visión del Laboratorio en Dos Fases

El laboratorio está diseñado como la base de arquitectura para un futuro proceso de automejora de prompts:

### Fase 1: Evaluación Aislada por Etapa sobre Casos Reales (Estado Actual)
- **Alcance:** Repetición y evaluación de una sola etapa (aislada) sobre casos extraídos de trazas reales.
- **Funcionamiento:** Se congela el estado o la entrada del paso (`rawInput`), se envía al modelo evaluado (con el prompt estable o la variante), se ejecutan checks sintácticos y semánticos (`valid_json`, `choice_equals`, `matches_schema`, `field_equals`) y se calculan tasas de acierto y latencias.
- **Propósito:** Optimizar localmente cada prompt (por ejemplo, reducir tokens en SYSTEM de arguments, clarificar descripciones en criteria de Eos) sin riesgo de descalabrar el flujo general del agente.

### Fase 2: Ejecución del Agente Completo con Inyección de Prompts en Entorno Aislado (A Futuro)
- **Alcance:** Correr el agente JARVIS completo de punta a punta ejecutando una tarea de usuario de principio a fin, pero inyectando variantes de prompt experimentales para evaluar el impacto global en la tasa de resolución de tareas.
- **Requisitos arquitectónicos necesarios antes de Fase 2:**
  1. *Punto de inyección en `src/`:* Mecanismo para que `QwenEngine` y `Decision20Engine` puedan recibir un diccionario opcional de prompts alternativos por tarea (sin modificar las constantes estables de `prompts.ts`).
  2. *Entorno seguro de ejecución:* Herramientas MCP simuladas o un sandbox / carpeta temporal dedicada para que las acciones (`write_file`, comandos de consola) no alteren archivos reales de la PC durante la optimización automática.
  3. *Criterio de éxito por tarea:* Definición de oráculos de evaluación a nivel tarea (verificación de estado final del entorno y cumplimiento de meta) más allá de los checks unitarios por paso.

---

## 3. Reglas Estrictas de Diseño

1. **Aislamiento absoluto:** `src/` nunca importa de `lab/`.
2. **Puente único:** Dentro de `lab/`, **únicamente `adapter.ts`** tiene permitido importar de `src/`.
3. **Reutilización sin duplicación:** Reutiliza de `src/` lo exportado (`ConfigManager`, `postJson`, `estimateTokens`, `TransportError`, `PROMPTS`, `parseJsonObject`, `validateArgs`, `stripThink`). La única reescritura es el validador de respuestas de Eos (`parseDecisionResponse`), necesario porque `Decision20Engine.parseResponse` es privado.
4. **Cero efectos colaterales:** No ejecuta servidores MCP. Escrituras de disco acotadas a `lab/results/` (con flag inmutable `"wx"`) y `lab/cases/<etapa>/_drafts/`.
5. **Separación de roles:** Quien propone (`prompts/variants/`) no evalúa (`cases/` y `evaluate.ts`).
6. **Sin dependencias externas:** ESM nativo, TypeScript con `npx tsx`, sin librerías adicionales ni suites pesadas de testing.
7. **Sin simulaciones:** Nunca se inventan respuestas. Si un endpoint local está caído (`ECONNREFUSED`), la corrida aborta inmediatamente sin generar archivos vacíos.

---

## 4. Mapa Exhaustivo de `src/` (Rutas y Funciones Clave)

Para cada componente del núcleo del cual depende `lab/` o con el cual se integrará:

### A. Prompts Centralizados (`src/core/reasoner/prompts.ts`)
- `dataBlock` (~línea 109): Formatea bloques de datos externos delimitados por `<obs>...</obs>` saneando texto con `safe()`.
- `clipObs` (~línea 72): Truncamiento que preserva marcadores `ref:rX`.
- `retryNote` (~línea 151): Genera la advertencia de corrección tras una salida inválida (`ERROR_PREVIO:...`).
- `PROMPTS.ARGUMENTS.SYSTEM` (~línea 211): Prompt de sistema en vivo para generación de argumentos de Qwen.
- `PROMPTS.ARGUMENTS.buildUserPrompt` (~línea 220): Ensambla el prompt de usuario con bloques `ENV`, `TOOL`, `SCHEMA`, `GOAL`, `TASK`, etc.
- `PROMPTS.FINAL_RESPONSE` (~líneas 245-265): Prompt y constructor de respuesta final.
- `PROMPTS.PLAN` (~líneas 269-294): Prompt y constructor para planificación estructurada.
- `PROMPTS.REPLAN` (~líneas 298-321): Prompt y constructor para replanificación ante desvíos.
- `PROMPTS.STAGE_VERIFICATION` (~líneas 325-355): Prompt y constructor para supervisión semántica de etapas.
- `DECISION_PROMPTS.buildDecisionOne` (~líneas 440-470): Construye `{ state, questions }` para enrutamiento inicial.
- `DECISION_PROMPTS.buildDecisionTwo` (~líneas 473-496): Construye `{ state, questions }` para selección de herramienta dentro del MCP.
- `DECISION_PROMPTS.buildStepVerification` (~líneas 502-530): Construye `{ state, questions }` con preguntas binarias `noul` (`ok`, `cumple`).

### B. Motor de Razonamiento Qwen (`src/core/reasoner/qwen.ts`)
- `stripThink` (~línea 181): Remueve bloques `<think>` (cerrados, huérfanos o sin cerrar).
- `parseJsonObject` (~línea 234): Extrae objetos JSON respetando llaves balanceadas, markdown fences y direct parsing.
- `validateArgs` (~línea 286): Valida argumentos contra el `inputSchema` de la herramienta. Admite tokens `{{ref:rX}}`.
- `QwenEngine.resolveUrl` (~línea 409): Resuelve URL garantizando sufijo `/v1/chat/completions`.
- `QwenEngine.dispatchPrompt` (~línea 424): Guarda de tokens (`qwenNumCtx - promptEstimate >= 256`), llamada `postJson`, extracción de `content`, `usage`, `finish_reason` y cálculo de `truncated`.
- `QwenEngine.dispatchValidated` (~línea 516): Lógica de reintentos en producción (1 reintento con error previo, 1.5x tokens, temperatura 0.3).
- `QwenEngine.generateArguments` (~línea 550): Ejecuta la llamada para argumentos. Líneas 569-571 eliminan claves opcionales con valor `null`.
- `QwenEngine.generateFinalResponse` (~línea 582): Genera respuesta final en texto libre.
- `QwenEngine.generatePlan` (~línea 609): Genera plan estructurado con `PLAN_JSON_SCHEMA`.
- `QwenEngine.replan` (~línea 650): Ejecuta replanificación.
- `QwenEngine.verifyStage` (~línea 699): Verificación semántica de etapa.

### C. Motor de Decisiones Eos (`src/core/decision.ts`)
- `Decision20Engine.systemOne` (~línea 55): Invoca `POST /v1/decide` con `{ state, questions }`. Valida presupuesto con `decisionMaxContext`.
- `Decision20Engine.evaluateDecisionOne` (~línea 112): Orquesta Decision #1.
- `Decision20Engine.evaluateDecisionTwo` (~línea 149): Orquesta Decision #2.
- `Decision20Engine.evaluateStepVerification` (~línea 198): Orquesta verificación factual de paso.
- `Decision20Engine.parseResponse` (~línea 260, privado): Valida la estructura de `answers` contra las opciones declaradas en `criteria`.

### D. Transporte y Configuración
- `src/core/llmTransport.ts`:
  - `estimateTokens` (~línea 31): Estimación conservadora de tokens (`Math.ceil(text.length / 3)`).
  - `postJson` (~línea 61): Petición POST con timeout combinado con `AbortSignal`, reintentos de red y headers de túnel.
  - `TransportError` (~línea 21): Error tipificado (`"timeout" | "network"`).
- `src/core/config.ts`:
  - `ConfigManager.getConfig` (~línea 177): Obtiene copia profunda de la configuración activa.
  - Claves leídas por el laboratorio: `qwenUrl`, `qwenModel`, `qwenNumCtx`, `qwenMaxTokens.arguments`, `qwenTimeoutMs`, `decisionUrl`, `decisionMaxContext`, `decisionTimeoutMs`.

### E. Model Iterations y Depuración (`src/types/debug.ts` & `src/utils/debugAccumulator.ts`)
- `ModelIteration` (`src/types/debug.ts` ~línea 30): Registro formal de cada llamada a modelo (`id`, `taskId`, `model`, `stage`, `stepId`, `stepSeq`, `input`, `output`, `rawInput`, `rawOutput`, `metrics`).
- `createIterationFromEvent` (`src/utils/debugAccumulator.ts` ~línea 27): Reconstruye una iteración desde eventos de Core.

### F. Estado de Tareas en Memoria y Puntos de Cierre (Ganchos para Trazas)
- **Estado en memoria:** `JarvisCore.taskContexts` (`src/core/core.ts` ~línea 37) mantiene `Map<string, TaskExecutionContext>`. No existe base de datos en disco ni persistencia en JSON para tareas; todo vive en el proceso en memoria.
- **Punto de Cierre Principal:** `concludeTask` (`src/core/modeEngines.ts` ~línea 117). Es invocado cuando una tarea finaliza con éxito o fallo controlado (`COMPLETED`, `PARTIAL`, `FAILED`), genera la respuesta final con Qwen, establece `task.state = state` (~línea 192) y emite `FINAL_RESPONSE` y `TASK_STATE_CHANGED`. **Este es el hook primario para registrar la traza.**
- **Punto de Cierre por Excepción no Atrapada:** `failTask` (`src/core/modeEngines.ts` ~línea 99). Establece `task.state = "FAILED"` y emite evento.
- **Punto de Cierre por Cancelación:** `JarvisCore.cancelTask` (`src/core/core.ts` ~línea 187). Establece `task.state = "CANCELLED"`.
- **Alternativa Desacoplada para Trazas:** Registrar un listener en `jarvisCore.addEventListener` que capture eventos de tipo `TASK_STATE_CHANGED` cuando `isTerminalState(task.state)` sea verdadero.

---

## 5. Hallazgos Empíricos y Particularidades de los Modelos

1. **Determinismo de Eos:**
   En pruebas empíricas, Eos-0.8B produjo distribuciones de probabilidad idénticas en 3 repeticiones sobre el mismo caso. Por ello, `lab/config.json` fija `decision_one: 1` repetición por caso para evitar mediciones redundantes.
2. **Latencia de Carga en Qwen (Warmup):**
   La primera llamada de inferencia a Qwen puede tardar ~9 segundos debido a la carga en memoria de pesos de Ollama, en contraste con ~0,7 segundos en llamadas subsiguientes. Por ello, `run.ts` ejecuta un `warmup` previo descartado de las métricas, y `evaluate.ts` calcula y reporta la **mediana** de latencia además del promedio.
3. **Caso `example-routing-files` es Sintético:**
   El caso `lab/cases/decision_one/example-routing-files.json` fue creado a mano para validar la estructura del laboratorio. No proviene de una traza real y cualquier variación en su resultado no debe interpretarse como una señal de regresión real de producción.
4. **Nota Técnica sobre Timeouts en Etapas Futuras (MEN-01):**
   Para `arguments`, `config.qwenTimeoutMs` es idéntico a producción porque no usa thinking. Al implementar `plan` o `replan` en `lab/adapter.ts`, debe usarse `config.qwenThinkingTimeoutMs` tal como hace `qwen.ts:465`.

---

## 6. Contrato del Registro de Trazas (`jarvis-traces.jsonl`)

Archivo JSONL ubicado en la raíz del proyecto (una línea por tarea concluida):
```json
{
  "v": 1,
  "taskId": "task-...",
  "startedAt": "2026-10-20T10:00:00.000Z",
  "endedAt": "2026-10-20T10:00:03.000Z",
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
      "rawOutput": "{\"answers\":{...}}",
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
      "args": { "path": "C:\\..." },
      "ok": true,
      "error": null
    }
  ]
}
```

### Reglas de Valores:
- `status`: Cadena que refleja el `task.state` real de Jarvis (`"COMPLETED"`, `"FAILED"`, `"CANCELLED"`, `"PARTIAL"`). Estados intermedios como `"WAITING_INPUT"` no se registran.
- `mode`: Cadena abierta que refleja el modo real (`"FAST"` | `"PLAN"`).
- `stage`: Nombres en mayúsculas (`"DECISION_ONE"`, `"ARGUMENT_GENERATION"`, etc.).
- Tolerancia: El extractor trata `status` y `mode` como texto libre y tolera llamadas sin `seq` o `step` mediante identificadores alternativos y avisos en consola.
