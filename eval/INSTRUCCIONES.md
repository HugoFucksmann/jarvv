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
| `npm run eval:auto -- [flags]` | Igual que `npx tsx eval/auto.ts [flags]` (optimización autónoma) |
| `npm run eval:smoke` | `smoke` con el mock en `--dry-run`, sin modelos |
| `npm run eval:menu` | Asistente interactivo |
| `npm run eval:cross` | Cruza el pre-chequeo con una corrida de `args_review` (sección 8) |
| `npm run eval:psvalid` | Mide cuántos `command` de `arguments` de una corrida son PowerShell válido; recibe la carpeta de la corrida |
| `npm run eval:traces -- [flags]` | Convierte carpetas reales de `jarvis-traces/` (`trace.json` + `full.json.gz`) a casos `.jsonl` validados (expect borrador) |

**Sintaxis de flags:** `--flag=valor` para valores y `--flag` (o `--flag=false`) para booleanos. Es error de configuración (código 2): un flag desconocido, repetido, sin valor o con valor vacío (`--model=`), un número que no sea entero/decimal simple (`--limit=1e3`, `--min-pass-rate=.9`; usar `0.9`) o una lista CSV vacía (`--stages=,`).

### Etapas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión | `d0` | Primera consulta de la tarea: `chat`, `single` o `multi`, decidido por código con los umbrales de producción (`engine/firstQuery.ts`: `chat` ≥ 0,7, `multi` ≥ 0,5), y la probabilidad de `chat` |
| Decisión | `route` | Ruta elegida (`files`, `locate`, `terminal` o `web`) y su probabilidad |
| Decisión | `tool_choice` | Herramienta elegida y su probabilidad |
| Decisión | `args_review` | `approved`, `args_invalid` o `info_missing` |
| Decisión | `result_verification` | Veredictos `ok` y `cumple` |
| Decisión | `fragment_judge` | Por cada fragmento de `web_search`, si responde la pregunta (probabilidad `>= JUDGE_FOUND`, 0.5) |
| Decisión | `d5` | Cierre del reactivo con lista vacía: si `DONE` cumple todo `REQUEST` (`COMPLETION_APPROVE` = 0.75) |
| Decisión | `recovery` | Qué hacer cuando falla el paso de un ítem de la lista reactiva: `close`, `rewrite_item` o `replan` (sin `skip_continue`). En el motor corre solo en **modo sombra** (`recoveryShadow`: registra en la traza, no actúa); `prod` es `DECISION_PROMPTS.buildRecovery` |
| Decisión | `continuation` | Hilo de conversación: si el nuevo pedido depende de la tarea anterior o refiere a su resultado (`follow`, umbral `CONTINUATION_APPROVE` = 0.3) |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |
| Generativa | `pending` | Primer pendiente, palabras prohibidas, lista vacía cuando no queda nada por hacer |

Cada corrida ejecuta **variante × dataset × caso × repetición**.

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
| `--decision-model` | *(según `jarvis-config.json`)* | Modelo de decisión explícito (equivalente a `--model=+<id>`). No puede contradecir a `--model`. |
| `--generative-model` | *(según `jarvis-config.json`)* | Modelo generativo explícito (equivalente a `--model=<id>`). No puede contradecir a `--model`. |
| `--url` | `http://127.0.0.1:11434` | Endpoint del modelo generativo. |
| `--decision-url` | `http://127.0.0.1:11434` | Endpoint del de decisión (se le agrega `/v1/systemone`). |
| `--client` | `real` | `mock`: respuestas genéricas sin red (prueba la maquinaria). `oracle`: responde lo que pide el `expect` de cada caso; debe dar 100 %, y si un caso falla el problema está en el caso, un grader o el parseo, no en el modelo. `oracle` solo vale con la variante `prod`. |

### Ejecución
| Flag | Default | Descripción |
|---|---|---|
| `--thinking` | `off` | `off` (ninguna etapa generativa piensa; es lo que usa Jarvis), `prod` (el `thinking` de cada caso, como producción: `plan` piensa), `on` o `both` (cada caso dos veces, con y sin thinking). |
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

`eval/results/<modelo evaluado>/<YYYY-MM-DD_HHmmss>[_<label>]/` (en corridas solo de etapas de decisión, `<modelo evaluado>` es `decisionModel`; en generativas o mixtas, el modelo generativo; con `--client=oracle` o `mock`: `eval/results/_oracle/…` y `_mock/…`). Una colisión en el mismo segundo agrega `-2`, `-3`…

| Archivo | Contenido |
|---|---|
| `comparison.md` / `comparison.json` | Reporte de variantes contra la baseline: resumen por variante y por tipo de etapa, resumen por etapa, regresiones, mejoras, casos `raw` y matrices de confusión. Si una variante mejora un tipo de etapa y empeora el otro, avisa **Resultado mixto**. |
| `<variante>__<dataset>/runs.jsonl` | Cada ejecución: request exacto, salida, graders, latencia, tokens (`questions` trae una entrada por pregunta en las decisiones). |
| `<variante>__<dataset>/scores.json` | Métricas agregadas de la celda. |
| `<variante>__<dataset>/meta.json` | Configuración, commit, hashes de dataset y variante, `filters` y `cases`. |

Un run **pasa** solo si no registró ningún error (llamada al cliente, aplicación de la variante, parseo y todos los checks). Las llamadas fallidas (red, timeout, HTTP, prompt sin margen de contexto) cuentan como falla pero no entran en latencias ni aparecen como regresión o mejora.

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
| `stage` | Una de las catorce etapas |
| `scenario` | La situación y el punto de decisión (abajo) |
| `expect` | Lo que debe cumplir la salida; claves cerradas por etapa |
| `tags`, `description` | Opcionales; los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del `passRate` canónico |

`scenario`: `mode` (`reactive` | `deliberative`), `request`, `steps`, `calls` (`status`, `args`, `summary`, `verdict`, `ref`), `facts` (clave `answer_<paso>_<n>` o libre), `recalled` (`{ user_memory?: [{ key, value, from? }], thread?: { previous_request?, previous_answer? } }` aplicados al contexto para `arguments` y `final`), `userInput`, `finish` (cierre, para `final`) y `at` (punto de decisión: `routes`, `route`, `tools`, `tool`, `inputSchema`, `args`, `call`, `feedback`, `previous`, `environment`). Los tipos están en `core/scenario.ts`.

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
Una variante puede enviar más de una pregunta por request. La principal (`kind`, `route`, `selected_tool`, `review`, `request_complete`; `ok` y `cumple`; `f0`..`f4`) se evalúa con el `expect` de la etapa; las adicionales, con `expect.answers`:

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

`choice` para preguntas `choice`, `yes` para `noul` (`yes` si la probabilidad es `>= NOUL_APPROVE`, 0.6; `ok` de la verificación usa `OK_APPROVE`, 0.3; en la etapa `d5` el umbral canónico es `COMPLETION_APPROVE`, 0.75). Si el request no trae la pregunta no se evalúa (warning `q_<clave>_sent`); una pregunta sin expectativa se registra pero no se evalúa. Cada una genera `q_<clave>_match` y `q_<clave>_min_probability`, y cada pregunta se parsea por separado.

### Etapa `d0` (primera consulta de la tarea reactiva)

```json
{"id":"d0-001","stage":"d0","scenario":{"mode":"reactive","request":"Busca el ultimo modelo de GPT y guardalo en un md en el escritorio"},"expect":{"expectedKind":"multi"}}
```

`expect.expectedKind` es `chat`, `single` o `multi`. Opcionales: `minChatProbability` (casos de charla: el umbral de producción es 0,7) y `maxChatProbability` (casos que NO son charla pero se parecen, p. ej. una pregunta de hechos: no deben acercarse al umbral). Checks: `kind_match`, `min_chat_probability_met`, `max_chat_probability_met`. Solo modo `reactive`. El `kind` evaluado lo decide el código (`firstQueryKind`), no el `choice` del modelo.

### Etapa `d5` (cierre de tarea reactiva)

```json
{"id":"d5-cc-y01","stage":"d5","scenario":{"mode":"reactive","request":"...","steps":[{"instruction":"...","state":"completed"}],"calls":[{"step":0,"route":"terminal","tool":"run_command","kind":"read","status":"ok","args":{...},"summary":"...","verdict":"approved"}]},"expect":{"expectedComplete":true}}
```

Solo modo `reactive`, con el contexto en condiciones de cerrar (`ctx.canFinish() === "completed"`). Construye el request con `completionInput(ctx)` y `buildCompletionCheck`, y compara la probabilidad de `request_complete` contra `COMPLETION_APPROVE` (0,75). `expect.expectedComplete` es booleano; opcionales `minProbability` (solo con `true`) y `maxProbability` (solo con `false`). Checks: `complete_match`, `min_probability_met`, `max_probability_met`.

### Etapa `recovery` (qué hacer tras un paso fallido)

```json
{"id":"rec-rp-01","stage":"recovery","scenario":{"mode":"reactive","request":"...","steps":[{"instruction":"...","state":"failed"}],"calls":[{"route":"files","tool":"write_file","kind":"write","status":"tool_error","summary":"Error: ENOENT...","verdict":"rejected","reason":"no_usable_data"}],"at":{"previous":["<ítem fallido>","<ítem de atrás>"],"cause":"tool_failed","attempts":1}},"expect":{"expectedAction":"replan"}}
```

Solo modo `reactive`, con el último paso `failed` (si `at.attempts` > 1, los últimos `attempts` pasos seguidos en estado `failed`, con cada llamada apuntando a su `step`). `at.previous` es la lista de la vuelta con el ítem fallido de primero; `at.cause`, la causa del motor (`tool_failed`, `verify_rejected`, `review_rejected`, `call_cap`, `repeat_blocked`, `user_rejected`, `denied`, `no_tools`); `at.attempts` (≥ 1) debe coincidir con los pasos fallidos seguidos (`ctx.consecutiveFailures()`), igual que en `src/core/engine/recoveryShadow.ts` (ver `eval/datasets/recovery/README.md`). `expect.expectedAction` es `close`, `rewrite_item` o `replan`. Construye el request con `recoveryInput(ctx, previous, cause, attempts)` y `DECISION_PROMPTS.buildRecovery`. Con temperatura 0, repetir (`--repeat`) no aporta nada. La regla de etiquetado y los ids están en `eval/datasets/recovery/README.md`.

### Etapa `fragment_judge` y cómo sumar una etapa nueva
El caso de `fragment_judge` trae solo la necesidad y los fragmentos (`at.fragments`, de 1 a 5 fragmentos `JUDGE_BATCH`, y `expectedRelevant` en orden):

```json
{"id":"fj-005","stage":"fragment_judge","scenario":{"mode":"reactive","request":"…","at":{"need":"¿Cuál es la velocidad de la luz?","fragments":["…","…","…"]}},"expect":{"expectedRelevant":[true,false,true]}}
```

Checks: `fragment_<i>_match`, `fragment_<i>_min_probability` (si pide `minProbability`) y `fragment_count_match`.

Las etapas son enchufables y viven en `eval/core/stages/`. Para sumar una etapa nueva:
1. **Módulo de etapa (`eval/core/stages/<etapa>.ts`):** implementar `DecisionStageEntry` o `GenerativeStageEntry` con su `expectSpec` (claves, requeridas, enums y validación semántica), `buildRequest`, `parseOutput`, `label`, `graders`, `oracleAnswer` o `oracleOutput` y (en decisiones) `mainQuestionBindings`.
2. **Registro (`eval/core/stages/index.ts`):** importar la entrada y agregarla a `REGISTRY`.
3. **Tipos (`eval/core/types.ts`):** sumar el nombre a `DecisionStage` o `GenerativeStage` y definir `*Expect` y `*Output` (agregando `*Expect` a `StageExpect`).
4. **Contrato y graders (`eval/core/contract.ts`, `eval/core/graders/`):** reexportar constantes de `src/` si hacen falta y sumar un grader propio (p. ej. en `graders/label.ts`) si los existentes no cubren el `expect`.
5. **Caso de humo, dataset y variantes:** agregar un caso en `eval/datasets/smoke.jsonl`, datasets en `eval/datasets/<etapa>/` y variantes en `eval/variants/<etapa>/`.

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
| `d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery`, `continuation` | El constructor entero en `prompts.DECISION_PROMPTS` (`buildFirstQuery`, `buildRouteChoice`, `buildToolChoice`, `buildArgsReview`, `buildResultVerification`, `buildFragmentJudge`, `buildCompletionCheck`, `buildRecovery`, `buildContinuation`). Recibe los datos del caso y devuelve `{ state, questions }`; cada pregunta lleva `type`, `instructions` y, según el tipo, `criteria` (`choice`: una opción por clave; `noul`: opcionalmente `{ true, false }`). |
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

- **Sin `params` ni `read`:** las variantes solo redefinen constructores de prompts enteros (`DECISION_PROMPTS` o `PROMPTS`); las overrides heredadas (`params` y `read`) fueron retiradas del framework.
- Los helpers de `prompts.ts` (`frameLines`, `listBlock`, `lastFailedBy`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`, `join`, `todayLine`…) están exportados para reutilizar lo que no cambia. Para partir del texto actual, usar `--dry-run`.
- Un error en el constructor o un request mal formado es error de carga.
- Plantilla de las cuatro etapas de decisión: `variants/decision_all_stages_example.ts`. Se corre con `--variant=prod,mi_variante`.

---

## 7. Interpretar los resultados

- **Latencia:** con `--concurrency` > 1, p50 y p95 incluyen espera del servidor. Con menos de 20 llamadas el p95 es el máximo (suele ser la carga en frío): se marca con `†`; comparar con p50.
- **Unidad de comparación:** Δ, regresiones, mejoras y prueba de signos son **por caso**; las repeticiones no son muestras independientes. Δ compara solo casos medidos en ambos lados.
- **Ruido:** un Δ no es un veredicto; mirar `p (signos)`. Las etapas generativas varían entre corridas: usar `--repeat` antes de decidir por pocos casos.
- **Reintentos:** en etapas **generativas**, `pass` se mide después del reintento por respuesta inválida (`LLM_INVALID_OUTPUT_RETRIES`), igual que producción, y la columna `Reintentos` cuenta los runs que lo necesitaron. Las etapas de **decisión** no reintentan respuestas inválidas (el modelo de decisión es determinista, alineado con `src/core/engine/failures.ts`).
- **Tipos de etapa:** el total mezcla decisión y generativas (modelos distintos). Ante **Resultado mixto**, decidir con el desglose por tipo. `passRate` pesa cada etapa por su cantidad de casos; `Macro por etapa` las pesa por igual.
- **Sobreajuste:** reservar un dataset aparte (holdout) y correrlo solo para validar una variante antes de pasarla a `src`.
- **Comparar corridas:** dos celdas son comparables solo si tienen el mismo `datasetHash` y el mismo `cases.hash` en `meta.json`. Los modelos usados valen solo para ese modelo.
- **Los casos miden el prompt actual:** un cambio en `src/`, en `jarvis-config.json` o en la fecha cambia el request (ver `requestHash`).

---

## 8. Cruce con el pre-chequeo (`eval:cross`)

```bash
npm run eval:cross -- [--dataset=<a,b>] [--runs=<carpeta de la corrida>] [--baseline=<variante>] [--label=x] [--help]
```

Usa parseo estricto de flags (falla con exit `2` ante flags desconocidos, vacíos o carpetas inexistentes). `--dataset` acepta nombres (`args_review_D3/args_review_16_cases`), con `.jsonl` o rutas a un `.jsonl` (no carpetas ni globs). Sin `--runs` mide solo el pre-chequeo de producción sobre los casos `args_review`; con `--runs` compone cuatro tuberías con las etiquetas de D3 y las compara contra `--baseline`/`d3` (`prod` por defecto), y resume D4 con `NOUL_APPROVE`. Salida en `eval/results/_cross/<YYYY-MM-DD-HH-mm>[_<label>]/` (`cross.md`, `cross.json`).

---

## 9. Optimización autónoma de prompts (`--auto`)

Bucle iterativo integrado en `eval/cli.ts` (`--auto`, o directamente vía `eval/auto.ts`) que reutiliza `eval/core/batch.ts` (`loadDatasets`, `runDataset`, `comparison.json`) mientras un LLM optimizador externo genera hasta 2 variantes por vuelta en `eval/variants/_auto/<stage>/` hasta alcanzar `--target` o `--max-loops`.

```bash
npm run eval -- --auto \
  --stage=args_review \
  --max-loops=8 \
  --target=0.80 \
  --decision-model=d3:2b-text \
  --optimizer-model=qwen3:32b \
  [--optimizer-url=http://127.0.0.1:11434] \
  [--optimizer-api-key-env=OPENAI_API_KEY] \
  [--optimizer-timeout=120000] \
  [--optimizer-thinking=off|on] \
  [--conclusions=eval/variants/_auto/args_review/conclusiones.md] \
  [--dataset=args_review_16_cases,args_review_gemai] \
  [--holdout=args_review_gemaiL] \
  [--generative-model=qwen3.5:4b-text | --model=qwen3.5:4b+d3:2b] \
  [--url=...] [--decision-url=...] \
  [--repeat=1] [--concurrency=3] [--thinking=off] [--timeout=...] \
  [--metric=passRate|macroPassRate] \
  [--seed-top=v1,v2] [--archive-losers=true|false] \
  [--client=real|mock] [--include-shortcut]
```

*(Equivalente directo: `npx tsx eval/auto.ts ...`.)*

- **Modelos:** el modelo **evaluado** se elige con `--decision-model=<id>`, `--generative-model=<id>` o `--model=<gen>[+<dec>]` (compatibles en modo normal y `--auto`; por defecto lee `jarvis-config.json`). `--optimizer-model=<id>` define únicamente el LLM coordinador que propone variantes y evalúa `conclusiones.md` (por defecto con `--optimizer-thinking=off` para evitar respuestas vacías en modelos híbridos tipo Qwen 3.5 con `json_schema`).
- **Inicialización:** busca en `eval/results/` corridas previas 100 % compatibles en huella (`datasetHash`, `cases.hash`, modelo evaluado según tipo de etapa, `thinking`, `stageConfigHash`, `repeat`, `variantHash`, `includeShortcut`, sin filtros) para `prod` y las variantes activas de la etapa; si faltan, corre Vuelta 0 automática (o usa `--seed-top=v1,v2`). Si existe `auto_state.json` con la misma huella, conserva el historial de la mejor variante.
- **Datasets por defecto:** al omitir `--dataset`, descubre los `.jsonl` con casos de `--stage` excluyendo `smoke.jsonl` y archivos `*_holdout*.jsonl` (que deben pedirse explícitamente en `--dataset` o `--holdout`).
- **Seguridad y validación:** antes de evaluar o escribir a disco, compila cada variante con `esbuild`, analiza tokens TypeScript con el scanner de `typescript`, verifica la allowlist de imports (`src/core/**` y `eval/core/variants/types.ts`, además de resolver symlinks), valida dinámicamente las exportaciones de `prompts.ts`, bloquea `params`/`read`/reexports/código dinámico, normaliza `name`, deduplica por hash y la ejecuta en un sandbox aislado (`node:vm`) corriendo `loadDatasets` y verificando presupuesto de contexto (`DECISION_MAX_CONTEXT` / `reserveCompletionTokens`). Solo si pasa todo se escribe en `eval/variants/_auto/<stage>/`; si falla, pide reparación al optimizador (hasta 2 reintentos).
- **Ranking, archivado y `conclusiones.md`:** corre `[prod, ...top2, nueva_a, nueva_b]` en un solo lote; ordena en código por `passRate`/`macroPassRate` y desempates deterministas (`clientFailedRuns`, `retriedRuns`, ventaja neta y `signTestP` vs `prod`, `p50DurationMs`, `avgPromptTokens`). Las variantes generadas fuera del Top-2 que no superan a `prod` se mueven a `eval/variants/_auto/<stage>/descartadas/` (excluidas de `listVariantNames()`). Al cerrar cada vuelta, contrasta cifras y consulta al optimizador si corresponde actualizar `conclusiones.md` (`update: boolean`) y persiste `eval/variants/_auto/<stage>/auto_state.json`.
- **Códigos de salida:** `0` si alguna variante `!= prod` alcanza `--target` (confirmando `--holdout` si se indicó; una variante que cae en holdout no vuelve a re-evaluarse contra holdout en vueltas siguientes, registra alerta de sobreajuste y continúa); `1` si se agota `--max-loops` sin alcanzar `--target`; `2` ante error de configuración, datasets o transporte/infraestructura (sin tocar `conclusiones.md` ni `auto_state.json`).

Ver ayuda completa con `npm run eval -- --auto --help` y diseño completo en [`DISENO_EVAL_AUTONOMO.md`](../docs/evaluacion/DISENO_EVAL_AUTONOMO.md).


