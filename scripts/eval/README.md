# Framework de Evaluación (`scripts/eval`)

Dos suites independientes. Patrón común: **dataset → prompt → runner → resultados → análisis**.

- **`decision/`**: evalúa modelos de decisión (**D3**, **Eos**) con datasets etiquetados. Mide AUC, umbrales óptimos, política de 3 bandas y validación cruzada.
- **`llm/`**: evalúa modelos de lenguaje (Qwen, etc.) en las 4 etapas del agente (`plan`, `replan`, `arguments`, `final_response`) y compara versiones de prompts.

Cada corrida guarda `runs.jsonl` (trazas completas) y `scores.json` (resumen).

---

## Estructura

```text
scripts/
├── eval/
│   ├── decision/
│   │   ├── datasets/      # dataset_v1..v3.jsonl
│   │   ├── prompts/       # v0.ts … v5.ts
│   │   ├── core/          # client, types, utils
│   │   ├── runner.ts
│   │   ├── analyze.py
│   │   ├── CONCLUSIONES.md
│   │   └── connect_d3.md  # credenciales y endpoints
│   └── llm/
│       ├── datasets/      # cases_v1.ts, cases_v2.ts, tool_schemas.json
│       ├── prompts/       # Q1.ts, ...
│       ├── core/          # client, evaluator, types, promptBuilder
│       ├── runner.ts
│       └── compare.py
└── results/
    ├── decision/<modelo>/<fecha>_<dataset>_<prompts>[_<tag>]/   # runs.jsonl, scores.json, analysis.txt
    └── llm/<modelo>/<dataset>_<prompt>[_<tag>]/                 # runs.jsonl, scores.json, summary.md
        (ambos con comparisons/ para análisis cruzados)
```

---

## Comandos

```bash
# LLM
npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:4b --dataset=v2 --prompts=prod --stage=all

# Comparar prompts
python scripts/eval/llm/compare.py Q0=qwen3.5_4b/v2_Q0 Q1=qwen3.5_4b/v2_Q1 --out=reporte.md

# Decisión
npx tsx scripts/eval/decision/runner.ts --model=d3 --dataset=v2 --prompts=v5

# Analizar (1 archivo = métricas; 2 archivos = validación cruzada)
python scripts/eval/decision/analyze.py <scores_a.json> [<scores_b.json>]
```

---

## Decisión (D3 / Eos)

| Flag | Valores | Default |
|---|---|---|
| `--model` | `d3`, `eos` | `d3` |
| `--device` | `gpu`, `cpu`, `remote` | `gpu` |
| `--dataset` | `v1`, `v2`, `v3` o ruta `.jsonl` | `v2` |
| `--prompts` | `v0`…`v5` o ruta `.ts` | `v2` |
| `--tag` | texto libre | vacío |

Las credenciales remotas se leen de `decision/connect_d3.md` o `D3_API_KEY`.

**Nueva versión de prompts:** crear `prompts/vN.ts` exportando `runEvaluation`, registrar variantes con `runNoul` (scoring continuo) o `runChoice` (clasificación), correr con `--prompts=vN` y analizar con `analyze.py`.

---

## LLM

### Etapas

| Etapa | Verifica |
|---|---|
| `plan` | Pasos válidos, rutas permitidas, casos sin tools (`steps: []`). |
| `replan` | `continue`/`abort` correcto, sin repetir pasos ni efectos. |
| `arguments` | Cumplimiento de `tool_schemas.json`, campos obligatorios, tokens `{{ref:rX}}`. |
| `final_response` | Apego a `FACTS`/`LOG`/`EVID`, sin alucinaciones. |

### Evaluador (`core/evaluator.ts`)

- Limpia `<think>…</think>` y falla si la salida se trunca (`finish_reason === "length"`).
- **`check`** (afecta `passed`): errores de esquema, rutas prohibidas, alucinaciones, datos faltantes.
- **`soft`** (solo `warnings`): desvíos que producción tolera.
- Cada caso define sus criterios en `expect.<etapa>` (ej. `minSteps`, `allowedRoutes`, `expectedAction`, `requiredFields`, `mustContainFacts`, `forbiddenHallucinations`).

### Fidelidad con producción

- Usa los prompts, schemas y validadores reales (`src/core/reasoner/prompts.ts`).
- Thinking: activo en `plan`/`replan`, apagado en `arguments`, comparado on/off en `final_response`.
- Sin reintentos: el pass rate es el piso real de fiabilidad.

### Dataset propio

Crear `datasets/mi_dataset.ts` exportando `testCases: LlmTestCase[]`. Con `input.prompt` se usan los constructores de producción; con `input.system` + `input.user` se usan textos crudos.

```typescript
export const testCases: LlmTestCase[] = [
  {
    id: "mi-plan-01",
    stage: "plan",
    category: "general",
    description: "Crear una nota en el escritorio",
    input: { prompt: { stage: "plan", goal: "crea una nota con un resumen del mercado" } },
    expect: { plan: { minSteps: 1, maxSteps: 3, requiredRoutes: ["files"] } },
  },
];
```

Los casos de `arguments`, `replan` y `final_response` siguen la misma forma; solo cambia `input.prompt.data` y `expect.<etapa>`.

```bash
npx tsx scripts/eval/llm/runner.ts --model=qwen3.5:9b --dataset=mi_dataset --stage=plan
```

### Flags del runner

| Flag | Default | Descripción |
|---|---|---|
| `--model` | `qwen2.5:7b` | Modelo en el servidor. |
| `--dataset` | `v2` | Nombre corto o ruta `.ts`. |
| `--prompts` | `prod` | `prod`, `Q1` o ruta `.ts`. |
| `--url` | `http://127.0.0.1:11434` | Endpoint OpenAI-compatible. |
| `--stage` | `all` | `plan`, `replan`, `arguments`, `final_response`, `all`. |
| `--tag` | valor de `--prompts` | Sufijo de la carpeta de resultados. |
| `--finalThinking` | `both` | `both`, `on`, `off`, `config`. |
| `--timeout`, `--thinkingTimeout`, `--numCtx` | de config | Overrides en ms / tokens. |

### Comparador (`compare.py`)

Compara dos o más corridas sobre el mismo dataset con prueba de signos exacta, para distinguir diferencias reales de la variabilidad del modelo.