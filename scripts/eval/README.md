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
            ├── <fecha>[_<tag>]/
            │   ├── runs.jsonl
            │   └── scores.json
            └── comparisons/           # comparaciones entre corridas (compare.py)
                └── <fecha>_<tags>_compare.md
```

---

## 2. Guía Rápida de Comandos

```bash
# ── Decisión (D3 / Eos) ──────────────────────────────────────────────
# Ejecutar benchmark sobre un dataset con una variante de prompts
npx tsx scripts/eval/decision/runner.ts --model=d3 --dataset=v2 --prompts=v5

# Analizar una corrida individual (guarda analysis.txt dentro de esa carpeta)
python scripts/eval/decision/analyze.py scripts/results/decision/d3/2026-10-26_dataset_v2_v3/scores.json

# Analizar dos datasets (validación cruzada) y guardar en comparisons/
python scripts/eval/decision/analyze.py \
  scripts/results/decision/d3/2026-10-26_dataset_v1_v3/scores.json \
  scripts/results/decision/d3/2026-10-26_dataset_v2_v3/scores.json

# Filtrar variantes específicas
python scripts/eval/decision/analyze.py scores.json --runs=M0_control,M3_cumple_evidence

# ── Lenguaje / LLM (Qwen, etc.) ──────────────────────────────────────
# Ejecutar todas las etapas con prompts de producción (dataset v2 por defecto)
npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:4b

# Ejecutar con una versión experimental de prompts (ej. Q1.ts en scripts/eval/llm/prompts/)
npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:4b --prompts=Q1

# Ejecutar una etapa particular con prompts Q1 y dataset específico
npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:4b --prompts=Q1 --stage=plan

# Comparar dos versiones de prompt (guarda automáticamente en llm/<modelo>/comparisons/)
python scripts/eval/llm/compare.py qwen3.5_4b/2026-10-27_prod qwen3.5_4b/2026-10-27_Q1

# Comparar con repeticiones (múltiples corridas agrupadas bajo el mismo LABEL)
python scripts/eval/llm/compare.py \
  v0=qwen3.5_4b/2026-10-27_v0 \
  Q1=qwen3.5_4b/2026-10-27_Q1
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

### Fidelidad con producción

- **Prompts vivos:** `promptBuilder.ts` utiliza los constructores reales de `src/core/reasoner/prompts.ts` por defecto (`--prompts=prod`), o carga variantes desde `scripts/eval/llm/prompts/<nombre>.ts` (`--prompts=Q1`).
- **Schemas y validación:** Reutiliza las funciones de producción (`PLAN_JSON_SCHEMA`, `REPLAN_JSON_SCHEMA`, `parseJsonObject`, `validateArgs`, etc.).
- **Thinking:** Activado en `plan` y `replan`, desactivado en `arguments`, y en `final_response` se evalúa comparativamente (con y sin thinking).
- **Límites y contexto:** Derivados de `src/core/config.ts` (`jarvis-config.json`), salvo override explícito por CLI.
- **Sin reintentos:** Se evalúa la primera respuesta; el pass rate representa el piso real de fiabilidad.

### Parámetros del Runner

| Parámetro | Default | Descripción |
|---|---|---|
| `--model` | `qwen2.5:7b` | Modelo en el servidor (ej. `qwen3.5:4b`, `qwen3.5:9b`). |
| `--dataset` | `v2` | `v2` o ruta a archivo `.ts` de casos. |
| `--prompts` | `prod` | `prod` (usa `prompts.ts`), `Q1` (en `scripts/eval/llm/prompts/Q1.ts`) o ruta `.ts`. Si no se pasa `--tag`, usa el nombre del prompt. |
| `--url` | `http://127.0.0.1:11434` | Endpoint compatible con OpenAI / Ollama. |
| `--stage` | `all` | `plan`, `replan`, `arguments`, `final_response` o `all`. |
| `--tag` | vacío (o valor de `--prompts`) | Etiqueta / versión (sufijo en la carpeta de resultados). |
| `--finalThinking` | `both` | Modo para `final_response`: `both`, `on`, `off`, `config`. |
| `--timeout`, `--thinkingTimeout` | de config | Timeouts en milisegundos. |
| `--numCtx` | de config | Tamaño de ventana de contexto en tokens. |

### Salidas (`scripts/results/llm/<modelo>/<fecha>[_<tag>]/`)

- **`runs.jsonl`:** traza completa de cada ejecución con hashes de prompts y casos, latencias, recuento de tokens, finish reasons, respuestas crudas y métricas booleanas.
- **`scores.json`:** resumen consolidado con pass rates macro/micro por etapa, configuración efectiva y comparativa thinking on/off.

---

## 5. Comparador Estadístico (`compare.py`)

Compara dos o más versiones de prompts evaluadas sobre el mismo dataset:

```bash
python scripts/eval/llm/compare.py v1=qwen3.5_4b/2026-10-27_v1 v2=qwen3.5_4b/2026-10-27_v2 --out reporte.md
```

- Busca automáticamente en `scripts/results/llm_eval/` y mantiene compatibilidad con corridas previas en `scripts/results/qwen_eval/`.
- Aplica pruebas estadísticas (prueba de signos exacta) para determinar si la diferencia entre versiones es estadísticamente significativa frente a la variabilidad estocástica del modelo.