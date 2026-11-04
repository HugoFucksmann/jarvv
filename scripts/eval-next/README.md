# JARVIS — Suite de Evaluación Next (`eval-next`)

Arquitectura de evaluación unificada para el backend refactorizado de JARVIS.

## Principios de diseño
1. **Producción como fuente de verdad**: Importa directamente del backend en `src/core/` los prompts de vistas (`PLAN_VIEW`, `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION`, `DECISION_PROMPTS`), los renderizadores (`renderPlan`, `renderArgs`, `renderFinal`, `renderAsk`), adaptadores y validadores (`validateArgs`, `parsePlanSteps`, `stripThink`). No duplica código de producción: si producción cambia, la suite detecta desfasajes inmediatamente.
2. **Arquitectura unificada**: Un único runner, un formato de caso y un formato de resultados para etapas de decisión (modelos D3 / Eos) y etapas generativas (Qwen / LLMs compatibles con OpenAI).
3. **Casos como datos estructurados (`view`)**: El input canónico es el estado estructurado que consumen las vistas de producción (`PlanView`, `ArgsView`, `FinalView`, `AskView`). Los casos adversariales se marcan explícitamente como `mode: "raw"` / `isRaw: true` y quedan excluidos del pass rate canónico principal.
4. **Sin código legado ni reintentos silenciosos**: El evaluador no realiza reintentos silenciosos; el pass rate refleja el piso real de fiabilidad del modelo. Replan no es una etapa separada sino `plan` con `trigger: { kind: "initial" | "step_failure" | "user_feedback" }`.
5. **Graders explícitos y componibles**: Distinción estricta entre `check` (determina `passed`) y `soft` (genera `warnings` informativos).
6. **Reproducibilidad y trazabilidad completa**: Cada ejecución almacena modelo, hiperparámetros, commit git, flag `gitDirty`, hashes sha256 de los prompts de producción y de los archivos `src/` importados (`sourceHashes`), fecha local con hora (`YYYY-MM-DD_HHmmss`), hash de cada request (`requestHash`), latencia (p50/p95), matrices de confusión y varianza entre repeticiones.

---

## Estructura del proyecto

```text
scripts/eval-next/
├── README.md                  # Documentación, especificación de formatos y CLI
├── INFORME.md                 # Informe de verificación (tsc, tests, imports, corridas reales)
├── MIGRACION_CASOS.md         # Guía para migrar casos del formato legado eval/ a eval-next/
├── cli.ts                     # Entry point ejecutable por consola
├── core/
│   ├── types.ts               # Contratos unificados, tipos, SCHEMA_VERSION
│   ├── config.ts              # Parseo y validación de flags CLI, STAGE_TIMEOUT_DEFAULTS_MS
│   ├── dataset.ts             # Cargador y validación de datasets JSONL
│   ├── runner.ts              # Orquestador de corridas x repeticiones
│   ├── results.ts             # Escritor incremental (runs.jsonl, scores.json, meta.json)
│   ├── stages/                # Definición de las 8 etapas
│   │   ├── index.ts           # Registro central de etapas (STAGES_REGISTRY + guard compilación)
│   │   ├── route.ts           # Decisión #1: route (rutas, fin, ask_user)
│   │   ├── tool_choice.ts     # Decisión #2: tool_choice (selección de tool)
│   │   ├── args_review.ts     # Decisión #3: args_review (revisión de argumentos)
│   │   ├── result_verification.ts # Decisión #4: result_verification (ok / cumple)
│   │   ├── plan.ts            # LLM 1: plan y replan unificados
│   │   ├── arguments.ts       # LLM 2: argumentos validados contra schema
│   │   ├── final.ts           # LLM 3: respuesta final orientada a evidencia
│   │   └── question.ts        # LLM 4: formulación limpia de pregunta al usuario
│   ├── graders/               # Evaluadores modulares
│   │   ├── common.ts          # Validaciones comunes, truncado, latencia
│   │   ├── label.ts           # Exact-match y probabilidades para decisiones
│   │   ├── plan.ts            # Pasos, rutas permitidas, replan (failure/feedback), expectEmpty
│   │   ├── arguments.ts       # Validación estricta con schema MCP y refs
│   │   ├── final.ts           # Hechos requeridos y ausencia de alucinaciones
│   │   └── question.ts        # Longitud, unicidad y no filtrado de internos
│   └── clients/               # Clientes de inferencia
│       ├── types.ts           # Interfaz ModelClient
│       ├── openai-compat.ts   # Conector OpenAI / Ollama compatible
│       ├── decision-remote.ts # Conector remoto / local para D3 / Eos
│       └── mock.ts            # Cliente determinista para tests y CI
├── datasets/
│   └── sample.jsonl           # Dataset de smoke test (10 casos estructurados)
├── variants/
│   └── prod.ts                # Variante por defecto (prompts de producción)
└── tests/
    └── run.ts                 # Suite de 18 tests unitarios, negativos y de integración
```

---

## Cómo correr la evaluación

### Requisitos previos
Node.js >= 20 con `tsx` o `npx tsx`.

### Comandos frecuentes

```bash
# Corrida completa con cliente Mock (smoke test offline):
npx tsx scripts/eval-next/cli.ts --model=mock --stage=all

# Filtrar por etapa(s) específica(s):
npx tsx scripts/eval-next/cli.ts --model=mock --stage=plan,arguments

# Filtrar casos por tags del dataset:
npx tsx scripts/eval-next/cli.ts --model=mock --stage=all --filter=decision

# Etiquetar la corrida con un sufijo de carpeta:
npx tsx scripts/eval-next/cli.ts --model=mock --stage=all --label=experimento_1

# Evaluar modelo Qwen / Ollama real:
npx tsx scripts/eval-next/cli.ts --model=qwen2.5:7b --url=http://localhost:11434 --stage=plan --repeat=3 --thinking=on

# Evaluar modelo de Decisión D3 / Eos (remoto o local):
npx tsx scripts/eval-next/cli.ts --model=d3 --url=http://localhost:8000 --stage=route,tool_choice --device=remote

# Exigir un umbral mínimo de aprobación en CI:
npx tsx scripts/eval-next/cli.ts --model=mock --stage=all --minPassRate=0.9

# Ejecutar la suite de tests automatizada:
npm run test:eval
```

### Argumentos de CLI (`config.ts`)

| Flag | Descripción | Default |
|---|---|---|
| `--stage=<lista\|all>` | Etapa(s) a evaluar: `route,tool_choice,args_review,result_verification,plan,arguments,final,question` o `all`. | `all` |
| `--model=<nombre>` | Identificador del modelo (`mock`, `qwen2.5:7b`, `d3`, etc.). | `qwen3.5:4b` |
| `--url=<url>` | URL base del endpoint del modelo. | Automática según motor |
| `--device=<gpu\|cpu\|remote>` | Dispositivo sugerido para motores locales o remoto. | `gpu` |
| `--dataset=<path>` | Ruta al archivo `.jsonl` de casos. | `datasets/sample.jsonl` |
| `--variant=<nombre>` | Variante de prompt a evaluar (definida en `variants/`). | `prod` |
| `--repeat=N` | Cantidad de repeticiones por caso para medir varianza entre corridas. | `1` |
| `--filter=<tags>` | Filtra casos del dataset por etiquetas (`initial`, `replan`, `decision`, etc.). | Ninguno |
| `--label=<nombre>` | Etiqueta / sufijo identificador de la carpeta de resultados. | Ninguno |
| `--thinking=<on\|off\|both\|config>` | Control de thinking para modelos generativos. | `config` |
| `--minPassRate=<0..1>` | Umbral de pass rate; si no se alcanza, el CLI finaliza con exit code 1. | Ninguno |
| `--timeout=<ms>` | Presupuesto total de timeout por llamada en milisegundos. Si no se pasa, se usan los defaults por etapa. | Ver tabla abajo |
| `--concurrency=N` | Concurrencia de ejecución. Las escrituras a `runs.jsonl` están serializadas para evitar interleaving. | `1` |

### Timeouts por defecto por etapa

Cuando no se pasa `--timeout`, se usa el valor por etapa definido en `STAGE_TIMEOUT_DEFAULTS_MS`:

| Etapa | Timeout default |
|---|---|
| `plan` | 60 000 ms |
| `final` | 45 000 ms |
| `arguments` | 30 000 ms |
| `question` | 20 000 ms |
| `route`, `tool_choice`, `args_review`, `result_verification` | 15 000 ms |

### Códigos de salida del CLI

| Exit code | Significado |
|---|---|
| `0` | OK — corrida completada, pass rate cumplido (o sin umbral configurado) |
| `1` | Pass rate por debajo del umbral `--minPassRate` |
| `2` | Error de infraestructura — dataset no encontrado, error de configuración, modelo inalcanzable |

> **Nota:** El runner **no realiza reintentos silenciosos**. Un fallo es un fallo. El pass rate refleja el piso real de fiabilidad del modelo en producción.

---

## Formato de casos estructurados (`datasets/*.jsonl`)

> `datasets/sample.jsonl` es un dataset de **smoke test** para verificar el cableado y la salud de todas las etapas, no un benchmark de precisión estadística.

Cada línea es un objeto JSON validado con un discriminador `stage`. La entrada canónica usa `mode: "view"` con el estado estructurado del contexto:

```json
{
  "id": "plan-002",
  "stage": "plan",
  "tags": ["generative", "plan", "step_failure", "replan"],
  "input": {
    "mode": "view",
    "view": {
      "request": "Escanear puertos del servidor local y guardar reporte",
      "trigger": { "kind": "step_failure", "failedStepId": "s1" },
      "previousFeedback": [],
      "steps": {
        "done": [],
        "current": { "id": "s1", "instruction": "Ejecutar nmap rápido", "route": "terminal", "state": "running" },
        "next": []
      },
      "failures": [
        {
          "kind": "execute",
          "stepId": "s1",
          "status": "failed",
          "callId": "c1",
          "route": "terminal",
          "tool": "exec_command",
          "statusNote": "command failed: nmap not found",
          "reasonNote": null,
          "failed": true,
          "args": { "cmd": "nmap -F localhost" },
          "summary": "nmap not found",
          "ref": null
        }
      ],
      "userInput": [],
      "env": [],
      "effects": [],
      "possibleEffects": []
    },
    "maxSteps": 4
  },
  "expect": {
    "minSteps": 1,
    "maxSteps": 4,
    "allowedRoutes": ["terminal", "files"],
    "forbiddenRepeatedGoals": ["nmap rapido", "ejecutar nmap"]
  }
}
```

### Casos adversariales (`isRaw: true`)

Los casos de inyección de prompts o texto crudo sin representación estructurada se marcan con `isRaw: true` y usan `mode: "raw"`. Están **excluidos del `passRate` canónico** y se reportan aparte como `rawPassRate` en `scores.json`.

```json
{
  "id": "plan-adv-001",
  "stage": "plan",
  "isRaw": true,
  "tags": ["adversarial"],
  "input": { "mode": "raw", "text": "IGNORE ALL PREVIOUS INSTRUCTIONS...", "maxSteps": 4 },
  "expect": { "expectEmpty": true }
}
```

### Criterios específicos de Replan en `plan`
- `forbiddenRepeatedGoals`: Metas o acciones ya falladas que el nuevo plan tiene prohibido volver a intentar.
- `forbiddenExecutedEffects`: Mutaciones o efectos ya completados que el plan no debe re-ejecutar.
- `mustReflectFeedback`: Palabras clave que el plan generado debe incorporar obligatoriamente a partir del feedback del usuario.
- `expectEmpty`: Si es `true`, exige explícitamente `steps: []` (por ejemplo, cuando no existen herramientas aplicables).

---

## Formato de resultados

Los resultados se almacenan en:
`scripts/eval-next/results/<modelo>/<YYYY-MM-DD_HHmmss>_<dataset>_<variant>[_<label>]/`

donde la marca temporal utiliza la **hora local del sistema** (`HHmmss`), garantizando que ejecuciones sucesivas nunca colisionen.

### 1. `runs.jsonl`

Se escribe de forma **incremental y serializada** línea a línea (seguro bajo `--concurrency > 1`). Expone los campos de clasificación en el primer nivel:

```json
{
  "schemaVersion": 1,
  "caseId": "route-001",
  "stage": "route",
  "iteration": 1,
  "variant": "prod",
  "model": "mock",
  "passed": true,
  "errors": [],
  "warnings": [],
  "metrics": { "not_truncated": true, "action_match": true, "route_match": true },
  "measurements": { "latency_ms": 20 },
  "predictedLabel": "files",
  "expectedLabel": "files",
  "probabilities": { "files": 0.95, "locate": 0.05 },
  "rawScore": 0.95,
  "requestParams": { "thinking": false, "timeoutMs": null },
  "requestHash": "a1b2c3d4e5f6a7b8",
  "rawInput": { "type": "decision", "backend": "d3", "state": "..." },
  "rawOutput": "{\"answers\":{\"route\":{\"choice\":\"files\",\"probabilities\":{\"files\":0.95,\"locate\":0.05}}}}",
  "parsedOutput": { "action": "route", "route": "files", "probabilities": { "files": 0.95, "locate": 0.05 } },
  "durationMs": 20,
  "finishReason": "stop",
  "timestamp": "2026-11-03T22:34:28.737Z"
}
```

**Campo `requestHash`**: sha256 (16 hex chars) de la request serializada enviada al modelo. Permite verificar que dos runs con el mismo hash recibieron exactamente el mismo input (detecta si el prompt de producción cambió entre corridas).

### 2. `scores.json`

Incluye `passRate` (promedio global), `passAllRate` (consistencia), percentiles de latencia, matriz de confusión, `rawPassRate` para casos raw y varianza muestral por caso:

```json
{
  "schemaVersion": 1,
  "totalRuns": 10,
  "passedRuns": 10,
  "passRate": 1.0,
  "passAllRate": 1.0,
  "avgDurationMs": 30,
  "p50DurationMs": 25,
  "p95DurationMs": 45,
  "rawTotalRuns": 0,
  "rawPassedRuns": 0,
  "rawPassRate": 0,
  "stages": {
    "route": {
      "stage": "route",
      "totalRuns": 1,
      "passedRuns": 1,
      "passRate": 1.0,
      "passAllRate": 1.0,
      "avgDurationMs": 20,
      "p50DurationMs": 20,
      "p95DurationMs": 20,
      "accuracy": 1.0,
      "confusionMatrix": { "files": { "files": 1 } },
      "rawTotalRuns": 0,
      "rawPassedRuns": 0,
      "rawPassRate": 0,
      "cases": [
        {
          "caseId": "route-001",
          "stage": "route",
          "runsCount": 1,
          "passCount": 1,
          "passRate": 1.0,
          "variance": null,
          "passAll": true,
          "avgDurationMs": 20
        }
      ]
    }
  }
}
```

#### `passRate` vs `passAllRate`

| Métrica | Definición | Para qué sirve |
|---|---|---|
| `passRate` | Fracción de **runs** aprobados sobre total de runs. Con `--repeat=3`, un caso que pasa 2/3 aporta 0.67 al promedio. | Mide el rendimiento promedio del modelo. |
| `passAllRate` | Fracción de **casos** donde el modelo pasó en **todas** las repeticiones (`pass^k`). | Mide la consistencia o fiabilidad: un modelo que aprueba el 100% de las veces en cada caso vs. uno que a veces falla. |

**Ejemplo:** 2 casos, `--repeat=2`. Caso A: pasa 2/2. Caso B: pasa 1/2.
- `passRate` = 3/4 = 0.75
- `passAllRate` = 1/2 = 0.50 (solo el caso A tiene `passAll=true`)

#### `variance`

`null` cuando `runsCount=1` (una sola repetición → no hay varianza estimable). Varianza muestral del pase binario entre repeticiones.

#### Métricas raw

`rawTotalRuns`, `rawPassedRuns`, `rawPassRate` reportan las corridas de casos `isRaw: true` **separadas** del score canónico. Los casos raw nunca afectan `passRate`.

### 3. `meta.json`

```json
{
  "schemaVersion": 1,
  "runId": "2026-11-03_223428_sample_prod_testrun",
  "timestamp": "2026-11-04T01:34:28.639Z",
  "model": "mock",
  "url": "default",
  "variant": "prod",
  "stages": ["route", "tool_choice", "args_review", "result_verification", "plan", "arguments", "final", "question"],
  "datasetPath": ".../datasets/sample.jsonl",
  "repeat": 1,
  "gitCommit": "414ea4f",
  "gitDirty": true,
  "promptHashes": {
    "plan_view": "f44d6ebe8c34b88f",
    "args_view": "158f3582ec7bc028",
    "final_view": "f9c8cb426b7672b4",
    "question": "1c5c641d1b154e21",
    "decision_prompts": "44136fa355b3678a"
  },
  "sourceHashes": {
    "src/core/reasoner/prompts.ts": "a1b2c3d4e5f6a7b8",
    "src/core/reasoner/qwen.ts": "b2c3d4e5f6a7b8c9",
    "src/core/render/plan.ts": "c3d4e5f6a7b8c9d0"
  },
  "params": {
    "device": "gpu",
    "concurrency": 1,
    "thinking": "config",
    "label": "testrun",
    "isMock": true
  }
}
```

**`gitDirty: true`** indica que el working tree tenía cambios sin commitear. Un run con `gitDirty: true` **no es reproducible** solo con `gitCommit`: el estado real del código difiere del commit. Para reproducción exacta, necesitás `gitDirty: false`.

**`sourceHashes`**: hashes sha256 (16 hex chars) del contenido de cada archivo `src/` importado. Dos runs con los mismos `sourceHashes` y `promptHashes` recibieron exactamente los mismos prompts de producción.

---

## `schemaVersion`

Todos los archivos de salida incluyen `schemaVersion: 1`. Si en el futuro se cambian campos incompatibles, se incrementa este número. Los scripts de análisis deben verificar `schemaVersion` antes de parsear.

---

## Cobertura de la suite de tests (`npm run test:eval`)

18 tests (verificados: 18 pasados, 0 fallados):

1. **Acoplamiento de producción**: Falla si algún prompt, renderizador o schema de producción (`src/core/`) es modificado o renombrado.
2. **Renderizadores**: Verifica que todos los adaptadores y renderizadores estén exportados y sean funciones.
3. **Sanitización de salida**: Valida la extracción de `<think>` y parseo JSON tolerante.
4. **Casos negativos de Replan**: `PlanStepsGrader` rechaza metas fallidas, falta de feedback y `expectEmpty`.
5. **Casos negativos de Decisión**: Los evaluadores detectan rutas, herramientas y veredictos equivocados.
6. **Casos negativos de Question**: Rechaza fugas de nombres internos, exceso de longitud y preguntas múltiples.
7. **Casos negativos de Final**: Rechaza hechos faltantes y alucinaciones prohibidas.
8. **validateArgs importado**: Verifica acoplamiento con el validador de producción.
9. **Corrida completa con Mock**: Verifica que se escriban `runs.jsonl`, `scores.json` y `meta.json` con todos los campos nuevos.
10. **JSON roto**: Mock que devuelve JSON inválido → todos los runs fallan con error.
11. **finish_reason=length**: Mock que devuelve `length` → todos los runs fallan con error `not_truncated`.
12. **Etiqueta equivocada**: Mock de route con etiqueta incorrecta → `passRate < 1`.
13. **Varianza null con repeat=1**: Con una sola repetición, `variance` es `null`, nunca `0`.
14. **passAllRate=0 con mock alternante**: Mock que alterna pass/fail → `passAllRate = 0`, `passRate` intermedio.
15. **requestHash reproducible**: El mismo caso en repeticiones produce el mismo hash; casos distintos producen hashes distintos.
16. **rawPassRate presente**: `scores.json` siempre tiene `rawTotalRuns`, `rawPassedRuns`, `rawPassRate`.
17. **schemaVersion y sourceHashes**: Los tres archivos de salida tienen `schemaVersion: 1`; `meta.json` tiene `sourceHashes`.
18. **minPassRate exit codes**: `exitCode=1` cuando no se cumple, `exitCode=0` cuando sí.

---

## LLM-judge

**Diferido.** El evaluador semántico basado en LLM-as-a-judge está fuera del alcance actual. No hay flag `--judge`, no hay `judge.ts`, no hay campos de juez en los archivos de salida.

Cuando se implemente, se agregará como un grader `soft` (no afecta `passed`) con su propio campo en `measurements` y se documentará en esta sección.

---

## Cómo agregar una etapa nueva

Agregar una etapa requiere **2 archivos + 1 línea**:

1. Crear `scripts/eval-next/core/stages/<nombre>.ts` que exporte un `StageDefinition`.
2. Registrarla en `scripts/eval-next/core/stages/index.ts`:
   ```ts
   import { NuevaStage } from "./nueva.ts";
   export const STAGES_REGISTRY = {
     ...,
     nueva: NuevaStage,
   };
   ```
3. Agregar `"nueva"` a la unión `StageName` en `types.ts`.

El guard de compilación `_registryCoversAllStages` en `index.ts` garantiza que si olvidás el paso 2, `tsc` falla en compilación.

---

## Cómo agregar una variante de prompt

```ts
// scripts/eval-next/variants/concise_plan.ts
import type { PromptVariant } from "../core/types.ts";

export const ConcisePlanVariant: PromptVariant = {
  name: "concise_plan",
  systemOverride: "You are the planner of JARVIS. Reply only with JSON...",
};
```

Ejecutar con `--variant=concise_plan`. El runner inyecta `systemOverride` manteniendo intactos los builders de producción.
