# Guía de Uso del Framework de Evaluación (`eval`)

Cómo correr el eval, escribir casos y variantes e interpretar los resultados. Presentación breve: [`README.md`](./README.md).

---

## 1. Ejecutar

Siempre desde la raíz del repo (las rutas por defecto son relativas al cwd):

```bash
npx tsx eval/cli.ts [flags]
```

Atajos de `package.json`:

| Comando | Qué hace |
|---|---|
| `npm run eval -- [flags]` | Igual que `npx tsx eval/cli.ts [flags]` |
| `npm run eval:smoke` | `smoke` con el mock en `--dry-run`, sin modelos |
| `npm run eval:menu` | Asistente interactivo |
| `npm run eval:cross` | Cruza el pre-chequeo con una corrida de `args_review` (sección 8) |
| `npm run eval:psvalid` | Mide cuántos `command` de `arguments` de una corrida son PowerShell válido; recibe la carpeta de la corrida |

**Sintaxis de flags:** `--flag=valor` para valores y `--flag` (o `--flag=false`) para booleanos. Es error de configuración (código 2): un flag desconocido, repetido, sin valor o con valor vacío (`--model=`), un número que no sea entero/decimal simple (`--limit=1e3`, `--min-pass-rate=.9`; usar `0.9`) o una lista CSV vacía (`--stages=,`).

### Etapas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión | `d0` | Primera consulta de la tarea: `chat`, `single` o `multi`, decidido por código con los umbrales de producción (`engine/firstQuery.ts`: `chat` ≥ 0,7, `multi` ≥ 0,5), y la probabilidad de `chat` |
| Decisión | `route` | Ruta elegida (`files`, `locate`, `terminal` o `web`) y su probabilidad |
| Decisión | `tool_choice` | Herramienta elegida y su probabilidad |
| Decisión | `args_review` | `approved`, `args_invalid` o `info_missing` |
| Decisión | `result_verification` | Veredictos `ok` y `cumple` |
| Decisión | `fragment_judge` | Por cada fragmento de `web_search`, si responde la pregunta (probabilidad `>= JUDGE_FOUND`, 0.6) |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, refs válidos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |
| Generativa | `pending` | Primer pendiente, palabras prohibidas, lista vacía cuando no queda nada por hacer |

Cada corrida ejecuta **variante × dataset × caso × repetición** (omitiendo datasets que queden con 0 casos tras `--stages`, `--tags` o `--ids`).

### Equivalencia de etapas (`eval` vs. traza en `src/core/types/stages.ts`)

| `eval` (`stage`) | Traza (`STAGES`) | Tipo (`STAGE_KIND`) | Notas |
|---|---|---|---|
| `d0` | `first_query` | `decision` | Primera consulta reactiva (charla / una / varias) |
| `route` | `route` | `decision` | Decisión 1 |
| `tool_choice` | `tool` | `decision` | Decisión 2 |
| `args_review` | `review` | `decision` | Decisión 3 |
| `result_verification` | `verify` | `decision` | Decisión 4 |
| `fragment_judge` | — | `decision` (juez interno `web_search`) | Sin etapa homónima en `STAGES`; evalúa el juez 2B de `web_search` |
| — | `continuation` | `decision` | Hilo con tarea anterior (sin etapa propia en `eval` aún) |
| — | `probe` | `decision` | Sondas por herramienta (`tools/probes.ts`, sin dataset `eval` aún; experimentos en `eval/exp/`) |
| — | `completion` | `decision` | Decisión 5 (`request_complete`; casos experimentales en `eval/exp/close_check.ts`) |
| `plan` | `plan` | `generative` | Plan inicial / replan |
| `arguments` | `args` | `generative` | Generación de argumentos |
| `final` | `final` | `generative` | Respuesta final |
| `question` | `question` | `generative` | Pregunta al usuario |
| `pending` | `pending` | `generative` | Lista de pendientes reactiva |

---

## 2. Flags

### Exploración
| Flag | Descripción |
|---|---|
| `--list` | Lista etapas, variantes y datasets, y termina. |
| `--menu` | Asistente interactivo: arma el comando, lo muestra y, tras confirmar, lo ejecuta. Necesita terminal interactiva. |
| `--help` | Resumen de uso. |
| `--dry-run` | No invoca modelos; imprime el request (prompt) de cada caso tal como se enviaría. Para copiar el prompt actual al escribir una variante: `--variant=prod --ids=<caso> --dry-run`. |

### Datasets y filtros
| Flag | Default | Descripción |
|---|---|---|
| `--dataset` | `eval/datasets/` | CSV de archivos `.jsonl`, carpetas o globs (`*`, `**`, `?`; no `{a,b}`). Basta el nombre: `--dataset=smoke` o `decision_*` se busca en `eval/datasets/`; una ruta que existe se respeta. |
| `--stages` | todas | CSV de etapas (las de la tabla de arriba). |
| `--tags` | — | Solo casos con esos tags. |
| `--ids` | — | Solo casos con esos IDs exactos. |
| `--limit` | sin límite | Máximo de casos por dataset (entero ≥ 1). |
| `--include-shortcut` | `false` | Los casos `prod_shortcut` (decisión con una sola opción) siempre se ejecutan, pero sin este flag se reportan en el bucket `raw`, fuera del `passRate` canónico. |

### Variantes y baseline
| Flag | Default | Descripción |
|---|---|---|
| `--variant` | `prod` | CSV de nombres de variantes de `eval/variants/` (ej. `prod,route_min`). `prod` se agrega como baseline salvo con `--no-baseline`. No se pueden componer con `+`. |
| `--baseline` | `prod` | Variante base de la comparación; debe estar entre las de `--variant`. |
| `--no-baseline` | — | No agrega `prod`: corre solo las de `--variant` (obligatorio); la baseline pasa a ser la primera o la de `--baseline`. |

### Modelos y conexión
Los defaults salen de `jarvis-config.json` (sin él, de los valores por defecto del código): `qwen3.5:4b` y `d3:2b` en Ollama local.

| Flag | Default | Descripción |
|---|---|---|
| `--model` | `qwen3.5:4b+d3:2b` | `<generativo>[+<decisión>]`; un lado vacío usa su default (`--model=+lfm3:1.7b`). Un solo modelo de cada tipo por corrida: para comparar modelos, correr dos veces. |
| `--url` | `http://127.0.0.1:11434` | Endpoint del modelo generativo. |
| `--decision-url` | `http://127.0.0.1:11434` | Endpoint del de decisión (se le agrega `/v1/systemone`). |
| `--client` | `real` | `mock`: respuestas genéricas sin red (prueba la maquinaria). `oracle`: responde lo que pide el `expect` de cada caso; debe dar 100 %, y si un caso falla el problema está en el caso, un grader o el parseo, no en el modelo. `oracle` solo vale con la variante `prod`. |

### Ejecución
| Flag | Default | Descripción |
|---|---|---|
| `--thinking` | `auto` | `auto`, `prod`, `on`, `off` o `both` (cada caso dos veces, con y sin thinking). |
| `--timeout` | 120000 (gen) / 180000 (thinking) / 30000 (dec) | Timeout por petición, en ms. |
| `--concurrency` | `3` | Peticiones simultáneas (entero ≥ 1). Con más de 1 las latencias no son comparables: usar `1` para medirlas. |
| `--repeat` | `1` | Repeticiones por caso. |

### Resultados
| Flag | Descripción |
|---|---|
| `--label` | Sufijo de la carpeta de resultados. |
| `--min-pass-rate` | Entre `0.0` y `1.0`. Se aplica a todas las celdas (variante × dataset) que no sean la baseline (o a esas si solo corrió la baseline); si alguna queda por debajo o sin runs, sale con código `1`. Solo cuenta el bucket canónico. |

### Códigos de salida
| Código | Significado |
|---|---|
| `0` | Corrida correcta (y umbral cumplido, si se pidió). |
| `1` | Alguna celda por debajo de `--min-pass-rate`. |
| `2` | Error de configuración o de carga (dataset, filtros sin casos, variante inaplicable a un caso, ninguna corrida canónica), o todas las llamadas fallaron por el cliente. También en `--dry-run`. |

---

## 3. Resultados

`eval/results/<modelo generativo>/<YYYY-MM-DD_HHmmss>[_<label>]/` (con `--client=oracle` o `mock`: `eval/results/_oracle/…` y `_mock/…`). Una colisión en el mismo segundo agrega `-2`, `-3`…

| Archivo | Contenido |
|---|---|
| `comparison.md` / `comparison.json` | Reporte de variantes contra la baseline: resumen por variante y por tipo de etapa, resumen por etapa, regresiones, mejoras, casos `raw` y matrices de confusión. Si una variante mejora un tipo de etapa y empeora el otro, avisa **Resultado mixto**. |
| `<variante>__<dataset>/runs.jsonl` | Cada ejecución: request exacto, salida, graders, latencia, tokens (`questions` trae una entrada por pregunta en las decisiones). |
| `<variante>__<dataset>/scores.json` | Métricas agregadas de la celda. |
| `<variante>__<dataset>/meta.json` | Configuración, commit, hashes de dataset y variante, `filters` y `cases`. |

Un run **pasa** solo si no registró ningún error (llamada al cliente, aplicación de la variante, parseo y todos los checks). Las llamadas fallidas (red, timeout, HTTP, prompt sin margen de contexto) cuentan como falla pero no entran en latencias ni aparecen como regresión o mejora. Las etapas **generativas** reintentan 1 vez ante salida inválida o truncada (`BUDGET.invalidResponseRetries`); las etapas de **decisión** usan `0` reintentos ante salidas inválidas, igual que producción (`DN-3.4`). *(Cambio de paridad aplicado en `eval/core/runner.ts`: requiere validación en laboratorio para medir impacto en `output_parse_ok`.)*

---

## 4. Datasets (`.jsonl`)

Una línea por caso; las vacías y las que empiezan con `#` se ignoran. Un caso describe la **situación** (escenario) y lo que se espera; **no trae el prompt**: lo arma la variante al cargar (`prod` usa el de Jarvis) con el mismo código de `src/`. Un typo, una clave desconocida o un valor inválido es error de carga (`archivo:línea: mensaje`).

```json
{"id":"smoke-route","stage":"route","tags":["smoke"],"description":"Con package.json leído falta el README: seguir en files.",
 "scenario":{"mode":"reactive","request":"Fijate qué versión tiene /home/user/app/package.json y dejá anotada esa versión al final del README.md",
   "steps":[{"state":"running"}],
   "calls":[{"route":"files","tool":"read_file","status":"ok","args":{"path":"/home/user/app/package.json"},"summary":"{\"version\":\"2.3.1\"}"}]},
 "expect":{"expectedRoute":"files"}}
```

| Campo | Descripción |
|---|---|
| `id` | Único dentro del dataset |
| `stage` | Una de las once etapas |
| `scenario` | La situación y el punto de decisión (abajo) |
| `expect` | Lo que debe cumplir la salida; claves cerradas por etapa |
| `tags`, `description` | Opcionales; los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del `passRate` canónico |

`scenario`: `mode` (`reactive` | `deliberative`), `request`, `steps`, `calls` (`status`, `args`, `summary`, `verdict`, `ref`), `facts`, `userInput`, `finish` (cierre, para `final`) y `at` (punto de decisión: `routes`, `route`, `tools`, `tool`, `inputSchema`, `args`, `call`, `feedback`, `previous`, `environment`). Los tipos están en `core/scenario.ts`.

- Un escenario deliberativo necesita `steps` con `instruction`, `route` y `expected`.
- `pending`: solo en `reactive`; `at.previous` es la lista de la vuelta anterior; `expect` admite `expectEmpty`, `maxItems`, `requiredKeywordsInFirst` y `forbiddenKeywords`.
- `arguments`: el cargador agrega `meta.toolSchema`; sin él el caso falla.
- Las herramientas se nombran como en `SYSTEM_TOOL_MANIFEST`; el schema de entrada (`at.inputSchema`) lo pone el caso.
- El escenario se valida con las reglas del contexto (`apply`): uno imposible (p. ej. cierre `completed` sin llamada aprobada) es error de carga.
- Rutas inválidas, probabilidades fuera de 0–1, `minSteps` > `maxSteps` o `exactFieldValues` vacío también son error de carga.
- Los textos (`mustContainFacts`, keywords…) se buscan por palabra o frase completa, sin distinguir mayúsculas ni acentos: `archivo` no coincide con `archivos` y `12` no está en `12.5` ni en `120`. Alternativas con `|` (`archivo|archivos`; `\|` es literal). En las listas de lo prohibido basta con que aparezca una. Excepción: `forbiddenHardcodedValues` busca por subcadena sobre el valor normalizado (minúsculas, `\` → `/`), sin límite de palabra ni `|`.
- Los prompts dependen de `src/`, de `jarvis-config.json` (tokens por etapa) y de la fecha; `requestHash` de cada run y el commit de `meta.json` permiten detectar cambios.
- `datasets/smoke.jsonl` tiene un caso por etapa.

### Decisiones con varias preguntas
Una variante puede enviar más de una pregunta por request. La principal (`route`, `selected_tool`, `review`; `ok` y `cumple`) se evalúa con el `expect` de la etapa; las adicionales, con `expect.answers`:

```json
"expect": {
  "expectedReview": "approved",
  "answers": {
    "tool":    { "choice": "ok" },
    "info":    { "choice": "missing", "minProbability": 0.6 },
    "hasdata": { "yes": false }
  }
}
```

`choice` para preguntas `choice`, `yes` para `noul` (`yes` si la probabilidad es `>= NOUL_APPROVE`, 0.6). Si el request no trae la pregunta no se evalúa (warning `q_<clave>_sent`); una pregunta sin expectativa se registra pero no se evalúa. Cada una genera `q_<clave>_match` y `q_<clave>_min_probability`, y cada pregunta se parsea por separado.

### Etapa `d0` (primera consulta de la tarea reactiva)

```json
{"id":"d0-001","stage":"d0","scenario":{"mode":"reactive","request":"Busca el ultimo modelo de GPT y guardalo en un md en el escritorio"},"expect":{"expectedKind":"multi"}}
```

`expect.expectedKind` es `chat`, `single` o `multi`. Opcionales: `minChatProbability` (casos de charla: el umbral de producción es 0,7) y `maxChatProbability` (casos que NO son charla pero se parecen, p. ej. una pregunta de hechos: no deben acercarse al umbral). Checks: `kind_match`, `min_chat_probability_met`, `max_chat_probability_met`. Solo modo `reactive`. El `kind` evaluado lo decide el código (`firstQueryKind`), no el `choice` del modelo. Dataset: `eval/datasets/D0/d0_casos_ejemplo.jsonl` (35 casos, 31 pasan; los 4 que fallan caen en el flujo de siempre y no son falsos «charla»). En esa carpeta también está `route_D1_hard.jsonl`, un dataset de la etapa `route`.

### Etapa `fragment_judge` (modelo para una etapa de decisión nueva)
El caso trae solo la necesidad y los fragmentos:

```json
{"id":"fj-005","stage":"fragment_judge","scenario":{"mode":"reactive","request":"…","at":{"need":"¿Cuál es la velocidad de la luz?","fragments":["…","…","…"]}},"expect":{"expectedRelevant":[true,false,true]}}
```

`at.fragments` lleva de 1 a 5 fragmentos (`JUDGE_BATCH`) y `expectedRelevant` un booleano por fragmento, en orden. Checks: `fragment_<i>_match`, `fragment_<i>_min_probability` (si el caso pide `minProbability`) y `fragment_count_match`. Ejemplos: `eval/variants/fragment_judge/fragment_judge_strict.ts` y `eval/datasets/fragment_judge/fragment_judge_gem1.jsonl`.

Para sumar otra etapa de decisión hay que tocar: `DecisionStage` y su `expect` (`types.ts`), `DECISION_STAGES` y el esquema de `expect` (`case.ts`), el parser (`variants/labels.ts`), el grader (`graders/label.ts`), el registro (`stages/decision.ts` e `index.ts`), el armado del request (`scenario.ts`), las preguntas principales (`questions.ts`) y el oráculo (`client/oracle.ts`).

---

## 5. Ejemplos

```bash
# Listar etapas, variantes y datasets
npx tsx eval/cli.ts --list

# Validar casos y graders sin servidor (esperado: 100 %)
npx tsx eval/cli.ts --client=oracle --dataset=smoke

# Probar la maquinaria con el mock (fallan los casos cuya respuesta no es la primera opción y los generativos)
npx tsx eval/cli.ts --client=mock --dataset=smoke

# Una etapa con modelo real
npx tsx eval/cli.ts --stages=plan --dataset=smoke --model=qwen3.5:4b

# Comparar una variante contra producción
npx tsx eval/cli.ts --variant=prod,route_min --stages=route --dataset=smoke

# Impacto del thinking
npx tsx eval/cli.ts --stages=final --thinking=both --limit=10

# Consistencia: repeticiones y paralelismo
npx tsx eval/cli.ts --concurrency=4 --repeat=3 --label=consistency_check

# Ver el prompt de un caso sin llamar al modelo
npx tsx eval/cli.ts --dataset=smoke --variant=prod --ids=smoke-route --dry-run

# Umbral para CI
npx tsx eval/cli.ts --dataset=smoke --min-pass-rate=0.90
```

---

## 6. Escribir una variante

Un archivo `<nombre>.ts` bajo `eval/variants/` (raíz o subcarpeta; el nombre es único en todo el árbol y debe coincidir con el `name`) con prompts **enteros**: no hay ediciones parciales del prompt de producción ni composición (`a+b`). `prod` no define nada: usa el prompt de `src/` tal cual. Lo que la variante no nombra usa producción.

| Etapa | Qué escribe la variante |
|---|---|
| `d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge` | El constructor entero en `prompts.DECISION_PROMPTS` (`buildFirstQuery`, `buildRouteChoice`, `buildToolChoice`, `buildArgsReview`, `buildResultVerification`, `buildFragmentJudge`). Recibe los datos del caso y devuelve `{ state, questions }`; cada pregunta lleva `type`, `instructions` y, según el tipo, `criteria` (`choice`: una opción por clave; `noul`: opcionalmente `{ true, false }`). |
| `plan`, `arguments`, `final`, `question`, `pending` | La vista entera en `prompts.PROMPTS` (`PLAN_VIEW`, `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION`, `PENDING_VIEW`), con todas sus piezas. |

```ts
// Archivo en una subcarpeta: eval/variants/<etapa>/mi_variante.ts
import type { RouteDecisionInput } from "../../../src/core/contracts.ts";
import { frameLines } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildRouteChoice(data: RouteDecisionInput): DecisionInput {
  // ... criteria por ruta, como en producción o como se quiera probar
  return {
    state: frameLines(data).filter(Boolean).join("\n"),
    questions: { route: { type: "choice", instructions: "Pick the route for the next action.", criteria: { /* ... */ } } },
  };
}

const mi_variante: Variant = {
  name: "mi_variante",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default mi_variante;
```

- **Parámetros** de una etapa generativa: `params: { pending: { temperature: 0.2, maxTokens: 512 } }` (`thinking`, `maxTokens`, `temperature`, `schema`, `reasoningEffort`). Si la variante fija `thinking`, no se expande con `--thinking`.
- **Preguntas propias:** si cambia el conjunto de preguntas de `args_review` o `result_verification`, `read.args_review` / `read.result_verification` dicen cómo salen la etiqueta o `ok`/`cumple`. Las claves de `route` (`route`) y `tool_choice` (`selected_tool`) son fijas.
- Los helpers de `prompts.ts` (`frameLines`, `listBlock`, `lastFailedBy`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`, `join`, `todayLine`…) están exportados para reutilizar lo que no cambia. Para partir del texto actual, usar `--dry-run`.
- Un error en el constructor o un request mal formado es error de carga.
- Plantilla de las cuatro etapas de decisión: `variants/decision_all_stages_example.ts`. Se corre con `--variant=prod,mi_variante`.

---

## 7. Interpretar los resultados

- **Latencia:** con `--concurrency` > 1, p50 y p95 incluyen espera del servidor. Con menos de 20 llamadas el p95 es el máximo (suele ser la carga en frío): se marca con `†`; comparar con p50.
- **Unidad de comparación:** Δ, regresiones, mejoras y prueba de signos son **por caso**; las repeticiones no son muestras independientes. Δ compara solo casos medidos en ambos lados.
- **Ruido:** un Δ no es un veredicto; mirar `p (signos)`. Las etapas generativas varían entre corridas: usar `--repeat` antes de decidir por pocos casos.
- **Reintentos:** el `pass` se mide después del reintento "como producción", que puede esconder cuánto falla el modelo crudo; la columna `Reintentos` cuenta los runs que lo necesitaron.
- **Tipos de etapa:** el total mezcla decisión y generativas (modelos distintos). Ante **Resultado mixto**, decidir con el desglose por tipo. `passRate` pesa cada etapa por su cantidad de casos; `Macro por etapa` las pesa por igual.
- **Sobreajuste:** reservar un dataset aparte (holdout) y correrlo solo para validar una variante antes de pasarla a `src`.
- **Comparar corridas:** dos celdas son comparables solo si tienen el mismo `datasetHash` y el mismo `cases.hash` en `meta.json`. Los modelos usados valen solo para ese modelo.
- **Los casos miden el prompt actual:** un cambio en `src/`, en `jarvis-config.json` o en la fecha cambia el request (ver `requestHash`).

---

## 8. Cruce con el pre-chequeo (`eval:cross`)

```bash
npm run eval:cross -- --dataset=<a,b> [--runs=<carpeta de la corrida>] [--label=x]
```

`--dataset` acepta nombres (`args_review_D3/args_review_16_cases`), con `.jsonl` o rutas a un `.jsonl` (no carpetas ni globs). Sin `--runs` mide solo el pre-chequeo de producción sobre los casos `args_review`; con `--runs` compone cuatro tuberías con las etiquetas de D3 y las compara contra `prod`/`d3`, y resume D4 con `NOUL_APPROVE`. Salida en `eval/results/_cross/<YYYY-MM-DD-HH-mm>[_<label>]/` (`cross.md`, `cross.json`).

### Puente de imports con `src/`
Las constantes y helpers compartidos con producción se centralizan en `eval/core/contract.ts` (incluyendo `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` derivados de `BUDGET`), además de los imports directos de tipos/motores que consumen el cargador de escenarios y los runners (`eval/core/scenario.ts`, `eval/core/runner.ts`, `eval/core/d4_checks.ts`, `eval/core/config.ts`, `eval/core/types.ts`, `eval/core/variants/labels.ts`, `eval/core/client/{decision,generative}.ts`, `eval/cross.ts`, `eval/psvalid.ts`).

