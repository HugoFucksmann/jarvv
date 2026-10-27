# Guía del Framework de Evaluación (`scripts/eval`)

Este directorio contiene la arquitectura modular para evaluar modelos de decisión (**D3** y **Eos**) contra diferentes datasets y variantes de prompts, con exportación automática de métricas y análisis de señales.

---

## 1. Estructura de Directorios

```text
scripts/
├── eval/
│   ├── datasets/               # Datasets estandarizados (JSONL)
│   │   ├── dataset_v1.jsonl    # Primer dataset base (54 casos)
│   │   └── dataset_v2.jsonl    # Dataset complejo con trampas sutiles (44 casos)
│   │
│   ├── prompts/                # Variantes de prompts versionadas
│   │   ├── v1.ts               # Prompts originales (V0, V0b, V1, V1-3, V3)
│   │   ├── v2.ts               # Prompts v2 (R1 a R11)
│   │   └── V3.ts               # Prompts v3 (M0 a M6) — ronda actual
│   │
│   ├── core/                   # Infraestructura compartida
│   │   ├── client.ts           # Cliente HTTP unificado (D3 en GPU/CPU o Eos)
│   │   ├── types.ts            # Tipos TypeScript compartidos
│   │   └── utils.ts            # Carga de datasets, permutaciones y exportación de scores
│   │
│   ├── runner.ts               # Runner CLI único y parametrizable
│   └── analyze.py              # Análisis estadístico (AUC, umbrales, validación cruzada)
│
└── results/                    # Resultados organizados automáticamente
    └── d3_gpu/
        ├── dataset_v1/<version>/
        │   ├── runs.jsonl      # Trazas completas con request/response/latencia
        │   └── scores.json     # Scores compactos por caso con IDs
        ├── dataset_v2/<version>/
        │   ├── runs.jsonl
        │   └── scores.json
        └── <version>_analysis.txt  # Output del analyze.py
```

---

## 2. Cómo Ejecutar Pruebas (`runner.ts`)

```bash
npx tsx scripts/eval/runner.ts --model=d3 --device=gpu --dataset=v1 --prompts=v3
npx tsx scripts/eval/runner.ts --model=d3 --device=gpu --dataset=v2 --prompts=v3
```

### Parámetros CLI disponibles:
- `--model`: `d3` (default) o `eos`
- `--device`: `gpu` (default) o `cpu`
- `--dataset`: `v1`, `v2` o ruta a cualquier `.jsonl`
- `--prompts`: `v1`, `v2`, `v3` o ruta a cualquier `.ts`
- `--tag`: etiqueta opcional para diferenciar corridas (ej: `--tag=exp1`)

---

## 3. Cómo Analizar Resultados (`analyze.py`)

```bash
# Una sola corrida:
python scripts/eval/analyze.py scripts/results/d3_gpu/dataset_v2/v3/scores.json

# Comparar dos datasets con validación cruzada:
python scripts/eval/analyze.py scripts/results/d3_gpu/dataset_v1/v3/scores.json scripts/results/d3_gpu/dataset_v2/v3/scores.json

# Guardar el output:
python scripts/eval/analyze.py scripts/results/d3_gpu/dataset_v1/v3/scores.json scripts/results/d3_gpu/dataset_v2/v3/scores.json > scripts/results/d3_gpu/v3_analysis.txt

# Filtrar variantes:
python scripts/eval/analyze.py scores.json --runs=M0_control,M3_cumple_evidence
```

---

## 4. Cómo Agregar una Nueva Versión de Prompts

Crear `scripts/eval/prompts/v4.ts` exportando `runEvaluation`:

```typescript
import type { TestCase } from "../core/types.ts";

export async function runEvaluation({ runNoul, runChoice, cases }: {
  runNoul: (name: string, stateFn: (c: TestCase) => string, questions: Record<string, any>, preamble?: string) => Promise<void>;
  runChoice: (name: string, stateFn: (c: TestCase) => string, questionName: string, instructions: string, criteria: Record<string, string>, acceptedChoices: string[], modes?: ("standard" | "reverse")[]) => Promise<void>;
  cases: TestCase[];
}) {
  await runNoul("nombre_variante", buildStateFn, QUESTIONS);
}
```

Ejecutar:
```bash
npx tsx scripts/eval/runner.ts --model=d3 --dataset=v1 --prompts=v4
npx tsx scripts/eval/runner.ts --model=d3 --dataset=v2 --prompts=v4
python scripts/eval/analyze.py scripts/results/d3_gpu/dataset_v1/v4/scores.json scripts/results/d3_gpu/dataset_v2/v4/scores.json > scripts/results/d3_gpu/v4_analysis.txt
```
