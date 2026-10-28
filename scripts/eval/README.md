# Framework de Evaluación (`scripts/eval`)

Dos suites de benchmarking independientes y desacopladas:

- **Decisión (`scripts/eval/decision/`):** evalúa modelos clasificadores y de scoring (**D3**, **Eos**) contra datasets etiquetados y variantes de prompts. Analiza métricas estadísticas de discriminación (AUC, umbrales óptimos, política de 3 bandas, validación cruzada).
- **Lenguaje / LLM (`scripts/eval/llm/`):** evalúa modelos de razonamiento y generación (**Qwen**, Llama, Mistral, etc.) en las 4 etapas de ejecución del agente (`plan`, `replan`, `arguments`, `final_response`) y compara estadísticamente versiones de prompts.

Patrón común: **dataset → prompt → runner → resultados → análisis**. Cada corrida registra trazas completas (`runs.jsonl`) y resúmenes compactos (`scores.json`).

---

## 1. Estructura

```text
scripts/
├── eval/
│   ├── README.md
│   │
│   ├── decision/                      # ── Benchmark de Modelos de Decisión (D3 / Eos) ──
│   │   ├── datasets/
│   │   │   ├── dataset_v1.jsonl       # Base (54 casos)
│   │   │   ├── dataset_v2.jsonl       # Trampas sutiles (44 casos)
│   │   │   └── dataset_v3.jsonl       # Validación ampliada (62 casos)
│   │   ├── prompts/                   # Variantes de prompts de decisión
│   │   │   ├── v0.ts … v2.ts          # Rondas históricas
│   │   │   ├── v3.ts                  # Ronda M0–M6
│   │   │   ├── v4.ts                  # Variantes aisladas
│   │   │   └── v5.ts                  # Dual Check con veto estricto AND
│   │   ├── core/
│   │   │   ├── client.ts              # Cliente HTTP (endpoints /predict, /score_choices)
│   │   │   ├── types.ts               # Tipos TestCase, RunRecord, GoldPostLabel
│   │   │   └── utils.ts               # Carga de datasets, permutaciones y export
│   │   ├── runner.ts                  # Runner CLI para modelos de decisión
│   │   ├── analyze.py                 # Análisis estadístico (AUC, umbrales, validación cruzada)
│   │   ├── CONCLUSIONES.md            # Histórico de reglas y hallazgos
│   │   └── connect_d3.md              # Credenciales y endpoints de D3
│   │
│   └── llm/                           # ── Benchmark de Modelos de Lenguaje (Qwen, etc.) ──
│       ├── datasets/
│       │   ├── cases_v1.ts            # Casos de prueba tipados v1
│       │   ├── cases_v2.ts            # Casos de prueba tipados v2 (dificultades easy/med/hard)
│       │   └── tool_schemas.json      # Schemas de herramientas MCP (usados por etapa arguments)
│       ├── prompts/
│       │   └── Q1.ts                  # Variantes experimentales de prompts
│       ├── core/
│       │   ├── client.ts              # Cliente agnóstico OpenAI-compatible (Ollama, vLLM, etc.)
│       │   ├── evaluator.ts           # Evaluador de 4 etapas (schemas, validación, métricas)
│       │   ├── types.ts               # Tipos agnósticos LlmTestCase, LlmEvalStage, etc.
│       │   └── promptBuilder.ts       # Ensamblador de prompts desde producción (prompts.ts)
│       ├── runner.ts                  # Runner CLI para etapas del LLM
│       └── compare.py                 # Comparador estadístico de versiones de prompts
│
└── results/
    ├── decision/
    │   └── <modelo>/                  # ej: d3, d3_remote
    │       ├── <fecha>_<dataset>_<prompts>[_<tag>]/
    │       │   ├── runs.jsonl
    │       │   ├── scores.json
    │       │   └── analysis.txt       # análisis individual de la corrida
    │       └── comparisons/           # análisis cruzados / validación cruzada
    │           └── <fecha>_<nombre>_analysis.txt
    │
    └── llm/
        └── <modelo>/                  # ej: qwen3.5_4b, qwen3.5_9b
            ├── <dataset>_<prompt>[_<tag>]/  # ej: v2_Q0 (Q0 = prod Jarvis), v2_Q1
            │   ├── runs.jsonl
            │   ├── scores.json
            │   └── summary.md         # resumen legible en Markdown de la corrida
            └── comparisons/           # comparaciones entre corridas (compare.py)
                └── <fecha>_<tags>_compare.md
```

---

## 2. Guía Rápida de Comandos

```bash
# ── Lenguaje / LLM (Qwen, etc.) ──────────────────────────────────────
# Mínimo indispensable: npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:4b
# Todas las flags disponibles:
npx tsx scripts/eval/llm/runner.ts \
  --model=qwen3.5:4b \
  --dataset=v2 \
  --prompts=prod \
  --stage=all \
  --url=http://127.0.0.1:11434 \
  --tag=mi_benchmark \
  --finalThinking=both \
  --timeout=60000 \
  --thinkingTimeout=120000 \
  --maxTokens=2048 \
  --numCtx=32768

# Comparar versiones de prompts (mínimo: compare.py <run_a> <run_b>):
python scripts/eval/llm/compare.py \
  Q0=qwen3.5_4b/v2_Q0 \
  Q1=qwen3.5_4b/v2_Q1 \
  --out=scripts/results/llm/qwen3.5_4b/comparisons/reporte.md

# ── Decisión (D3 / Eos) ──────────────────────────────────────────────
# Mínimo indispensable: npx tsx scripts/eval/decision/runner.ts
# Todas las flags disponibles:
npx tsx scripts/eval/decision/runner.ts \
  --model=d3 \
  --device=gpu \
  --dataset=v2 \
  --prompts=v5 \
  --tag=exp1 \
  --remote=false

# Analizar corrida / validación cruzada:
python scripts/eval/decision/analyze.py \
  scripts/results/decision/d3/2026-10-26_dataset_v1_v3/scores.json \
  scripts/results/decision/d3/2026-10-26_dataset_v2_v3/scores.json \
  --runs=M0_control,M3_cumple_evidence
```

---

## 3. Benchmark de Decisión (D3 / Eos)

| Parámetro | Valores | Default | Descripción |
|---|---|---|---|
| `--model` | `d3`, `eos` | `d3` | Backend de decisión a invocar. |
| `--device` | `gpu`, `cpu`, `remote` | `gpu` | Entorno de ejecución (`remote` usa API cloud). |
| `--dataset` | `v1`, `v2`, `v3` o ruta `.jsonl` | `v2` | Dataset etiquetado a evaluar. |
| `--prompts` | `v0` … `v5` o ruta `.ts` | `v2` | Módulo de variantes de prompts a correr. |
| `--tag` | texto libre | vacío | Etiqueta adicional para la carpeta de resultados. |

- El runner lee automáticamente las credenciales remotas desde `decision/connect_d3.md` (o `process.env.D3_API_KEY`).
- El análisis con un `scores.json` reporta AUC, precisión por umbrales y política de 3 bandas; con dos archivos realiza validación cruzada.

### Agregar una nueva versión de prompts de decisión

1. Crear `scripts/eval/decision/prompts/vN.ts` exportando la función `runEvaluation`.
2. Registrar cada variante utilizando los ayudantes del runner (`runNoul` para scoring continuo, `runChoice` para clasificación).
3. Correr `runner.ts --prompts=vN` sobre los datasets deseados y analizar con `analyze.py`.

---

## 4. Benchmark de Lenguaje / LLM

### Etapas evaluadas

| Etapa | Qué se verifica |
|---|---|
| `plan` | Descomposición en pasos válidos, rutas del manifiesto (`files`, `locate`, `terminal`, `web`), casos sin tools (`steps: []`). |
| `replan` | Decisión `continue`/`abort`, no duplicar pasos completados, respeto de efectos previos. |
| `arguments` | Cumplimiento estricto de `tool_schemas.json`, tipado, campos obligatorios, tokens `{{ref:rX}}`. |
| `final_response` | Apego a `FACTS`, `LOG` y `EVID`, justificación de abortos, ausencia de alucinaciones. |

### Motor de Evaluación (`core/evaluator.ts`)

El archivo [`scripts/eval/llm/core/evaluator.ts`](core/evaluator.ts) es el núcleo que procesa y califica las respuestas crudas del LLM en cada etapa. Implementa validación estricta y tolerancia controlada:

1. **Gestión de Formato y Truncamiento:**
   - Limpieza previa de bloques `<think>...</think>` mediante `stripThink`.
   - Detección de salidas truncadas por ventana de salida (`finish_reason === "length"`). Si una etapa estructurada es truncada, se falla inmediatamente como `not_truncated: false`.
   - Extracción de JSON con `parseJsonObject` y parsing de pasos con `parsePlanSteps`.
2. **Chequeos Duros vs. Blandos (`check` vs. `soft`):**
   - **`check` (afecta `passed`):** violaciones de esquema, rutas prohibidas, alucinaciones o datos obligatorios ausentes.
   - **`soft` (genera `warnings`, no desaprueba el caso):** desvíos leves que producción tolera con fallbacks (ej. omitir `objective` en el plan o no incluir `reason` en un `abort`).
3. **Criterios y Propiedades de `expect` por Etapa:**
   - **`plan` (`evaluatePlan`):**
     - `minSteps` / `maxSteps`: límites de cantidad de pasos.
     - `allowedRoutes`: rutas válidas (`files`, `terminal`, `locate`, `web`).
     - `firstRoute`: valida la ruta del primer paso.
     - `requiredRoutes`: rutas que deben aparecer al menos una vez.
     - `requiredKeywordsInGoal` / `forbiddenKeywordsInGoal`: presencia o ausencia de palabras clave.
     - `allowEmpty`: permite `steps: []` en consultas que no requieren herramientas.
   - **`replan` (`evaluateReplan`):**
     - `expectedAction`: valida si la acción debía ser `continue` o `abort`.
     - `mustNotRepeatEffects` (`effects`): prohíbe reintentar acciones ya aplicadas como efectos.
     - `mustNotRepeatCompleted` (`completedSteps`): prohíbe repetir pasos ya completados.
   - **`arguments` (`evaluateArguments`):**
     - Validación contra el schema de la tool vía `validateArgs` (producción).
     - `requiredFields`: campos requeridos presentes.
     - `noInventedFields`: prohíbe atributos adicionales fuera del esquema.
     - `exactFieldValues`: cotejo estricto de valores esperados.
     - `allowedRefTokens`: tokens `{{ref:rX}}` permitidos y válidos.
     - `forbiddenHardcodedValues`: prohíbe datos hardcodeados que debían ser referencias.
     - `jsonStringFields`: valida campos cuyo valor sea un JSON stringificado con forma `array2d` o `sheets` e inclusiones de texto.
   - **`final_response` (`evaluateFinalResponse`):**
     - `minChars`: longitud mínima de respuesta.
     - `mustContainFacts`: retención obligatoria de hechos presentes en `FACTS`.
     - `mustMentionEffects`: mención de efectos aplicados en el entorno.
     - `forbiddenHallucinations`: datos prohibidos o alucinaciones.

### Fidelidad con producción

- **Prompts vivos:** `promptBuilder.ts` utiliza los constructores reales de `src/core/reasoner/prompts.ts` por defecto (`--prompts=prod`), o carga variantes desde `scripts/eval/llm/prompts/<nombre>.ts` (`--prompts=Q1`).
- **Schemas y validación:** Reutiliza las funciones de producción (`PLAN_JSON_SCHEMA`, `REPLAN_JSON_SCHEMA`, `parseJsonObject`, `validateArgs`, etc.).
- **Thinking:** Activado en `plan` y `replan`, desactivado en `arguments`, y en `final_response` se evalúa comparativamente (con y sin thinking).
- **Límites y contexto:** Derivados de `src/core/config.ts` (`jarvis-config.json`), salvo override explícito por CLI.
- **Sin reintentos:** Se evalúa la primera respuesta; el pass rate representa el piso real de fiabilidad.

### Cómo usar el Prompt Base de Jarvis con un Dataset Personalizado (`X dataset`)

Por defecto, el runner evalúa con el **prompt base de producción de Jarvis** (`--prompts=prod`). Para que tus casos consuman los constructores vivos de Jarvis (`src/core/reasoner/prompts.ts`) en lugar de strings fijos ("raw"), cada caso debe estructurarse usando el objeto `input.prompt`.

#### 1. Crear el archivo del dataset (`scripts/eval/llm/datasets/mi_dataset.ts`)

El archivo debe exportar un array `testCases` (o `default`) de tipo `LlmTestCase[]`.

```typescript
import type { LlmTestCase } from "../core/types.ts";
import toolSchemas from "./tool_schemas.json" with { type: "json" };

const schemas = toolSchemas as Record<string, any>;
const ENV = {
  home: "C:\\Users\\usuario",
  desktop: "C:\\Users\\usuario\\Desktop",
  documents: "C:\\Users\\usuario\\Documents",
  downloads: "C:\\Users\\usuario\\Downloads",
};

export const testCases: LlmTestCase[] = [
  // ── Caso PLAN ─────────────────────────────────────────────────────────────
  {
    id: "mi-plan-01",
    stage: "plan",
    category: "general",
    description: "Crear un archivo de notas en el escritorio",
    input: {
      prompt: {
        stage: "plan",
        goal: "crea una nota con un resumen del mercado en mi escritorio",
        // opcionales: chatContext, compactCatalog, modificationFeedback, existingPlanSummary
      },
    },
    expect: {
      plan: {
        minSteps: 1,
        maxSteps: 3,
        allowedRoutes: ["files", "terminal", "web"],
        requiredRoutes: ["files"],
      },
    },
  },

  // ── Caso ARGUMENTS (MCP Tools) ────────────────────────────────────────────
  {
    id: "mi-args-01",
    stage: "arguments",
    category: "files",
    description: "Generar argumentos para write_file",
    input: {
      prompt: {
        stage: "arguments",
        data: {
          goal: "crea un archivo resumen.txt en el escritorio",
          taskInstruction: "Escribe el resumen en el escritorio",
          environment: ENV,
          tool: {
            name: "write_file",
            description: "Create or overwrite a file on disk.",
            inputSchema: { ...schemas.write_file, additionalProperties: false },
          },
          cleanedSchema: schemas.write_file,
          facts: {},
        },
      },
    },
    expect: {
      arguments: {
        tool: "write_file",
        requiredFields: ["path", "content"],
        noInventedFields: true,
      },
    },
  },

  // ── Caso REPLAN ───────────────────────────────────────────────────────────
  {
    id: "mi-replan-01",
    stage: "replan",
    category: "error_recovery",
    description: "Recuperarse de error al leer archivo inexistente",
    input: {
      prompt: {
        stage: "replan",
        data: {
          goal: "leer informe.txt y avisar si está listo",
          failedStepGoal: "leer informe.txt",
          failedStepResult: "Error: File does not exist",
          completedStepsSummary: [],
          facts: {},
          failLines: ["Paso 1 falló: informe.txt no existe"],
          remainingPlanGoals: ["avisar al usuario"],
          nextStepNumber: 2,
        },
      },
    },
    expect: {
      replan: {
        expectedAction: "continue", // o "abort"
        maxSteps: 2,
      },
    },
  },

  // ── Caso FINAL_RESPONSE ───────────────────────────────────────────────────
  {
    id: "mi-final-01",
    stage: "final_response",
    category: "synthesis",
    description: "Sintetizar respuesta final con facts y evidencia",
    input: {
      prompt: {
        stage: "final_response",
        data: {
          goal: "consultar precio de BTC",
          logLines: ["search BTC price", "fetch coinmarketcap"],
          facts: { BTC_PRICE: "65000 USD" },
          failLines: [],
          evidenceSummaries: ["Bitcoin cotiza en 65,000 USD según CoinMarketCap."],
        },
      },
    },
    expect: {
      final_response: {
        mustContainFacts: ["65000"],
        forbiddenHallucinations: ["100000"],
      },
    },
  },
];
```

> **¿Cómo sabe el runner que debe usar el prompt base de Jarvis?**
> Al pasar `input.prompt`, el constructor interno `promptBuilder.ts` invoca directamente `PROMPTS[STAGE].buildUserPrompt(...)` y `PROMPTS[STAGE].SYSTEM` de producción (`src/core/reasoner/prompts.ts`). Si en lugar de `input.prompt` defines `input.system` e `input.user`, el runner usará esos textos en bruto ("raw") sin pasar por Jarvis.

#### 2. Ejecutar el benchmark con el prompt base

No necesitas especificar `--prompts` porque su valor por defecto ya es `prod`:

```bash
# Ejecutar con el nombre del dataset directamente (resuelve scripts/eval/llm/datasets/mi_dataset.ts o cases_v3.ts)
npx tsx scripts/eval/llm/runner.ts --model=qwen2.5:7b --dataset=mi_dataset

# Filtrar solo una etapa particular (ej. plan)
npx tsx scripts/eval/llm/runner.ts --model=qwen2.5:7b --dataset=mi_dataset --stage=plan

# Usar un endpoint específico (ej. Ollama en otro puerto o vLLM)
npx tsx scripts/eval/llm/runner.ts --url=http://127.0.0.1:11434 --model=qwen3.5:4b --dataset=mi_dataset --tag=mi_corrida
```

### Parámetros del Runner

| Parámetro | Default | Descripción |
|---|---|---|
| `--model` | `qwen2.5:7b` | Modelo en el servidor (ej. `qwen3.5:4b`, `qwen3.5:9b`). |
| `--dataset` | `v2` | Nombre corto (`v1`, `v2`, `v3`, `mi_dataset`) o ruta `.ts`. Busca automáticamente en `scripts/eval/llm/datasets/`. |
| `--prompts` | `prod` | `prod` (usa `prompts.ts`), `Q1` (en `scripts/eval/llm/prompts/Q1.ts`) o ruta `.ts`. Si no se pasa `--tag`, usa el nombre del prompt. |
| `--url` | `http://127.0.0.1:11434` | Endpoint compatible con OpenAI / Ollama. |
| `--stage` | `all` | `plan`, `replan`, `arguments`, `final_response` o `all`. |
| `--tag` | vacío (o valor de `--prompts`) | Etiqueta / versión (sufijo en la carpeta de resultados). |
| `--finalThinking` | `both` | Modo para `final_response`: `both`, `on`, `off`, `config`. |
| `--timeout`, `--thinkingTimeout` | de config | Timeouts en milisegundos. |
| `--numCtx` | de config | Tamaño de ventana de contexto en tokens. |

### Salidas (`scripts/results/llm/<modelo>/<dataset>_<prompt>[_<tag>]/`)

- **`runs.jsonl`:** traza completa de cada ejecución con hashes de prompts y casos, latencias, recuento de tokens, finish reasons, respuestas crudas y métricas booleanas.
- **`scores.json`:** resumen consolidado con pass rates macro/micro por etapa, configuración efectiva y comparativa thinking on/off.

---

## 5. Comparador Estadístico (`compare.py`)

Compara dos o más versiones de prompts evaluadas sobre el mismo dataset:

```bash
python scripts/eval/llm/compare.py Q0=qwen3.5_4b/v2_Q0 Q1=qwen3.5_4b/v2_Q1 --out reporte.md
```

- Busca automáticamente en `scripts/results/llm_eval/` y mantiene compatibilidad con corridas previas en `scripts/results/qwen_eval/`.
- Aplica pruebas estadísticas (prueba de signos exacta) para determinar si la diferencia entre versiones es estadísticamente significativa frente a la variabilidad estocástica del modelo.