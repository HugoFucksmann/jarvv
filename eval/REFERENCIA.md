# Referencia del eval

Cómo es cada parte del eval: etapas, formato de casos y escenarios, variantes, resultados, cómo leerlos y cómo funciona `--auto`. Los comandos y flags están en [`INSTRUCCIONES.md`](./INSTRUCCIONES.md); la presentación, en [`README.md`](./README.md).

---

## 1. Etapas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión | `d0` | Primera consulta de la tarea: `chat`, `single` o `multi`, decidido por código con los umbrales de producción (`engine/firstQuery.ts`: `chat` ≥ 0,7, `multi` ≥ 0,5), y la probabilidad de `chat` |
| Decisión | `route` | Ruta elegida (`terminal`, `files_read`, `files_write`, `system`, `multimedia` o `web`) y su probabilidad |
| Decisión | `tool_choice` | Herramienta elegida y su probabilidad |
| Decisión | `args_review` | `approved`, `args_invalid` o `info_missing` |
| Decisión | `result_verification` | Veredictos `ok` y `cumple` |
| Decisión | `fragment_judge` | Por cada fragmento de `web_search`, si responde la pregunta (probabilidad `>= JUDGE_FOUND`, 0.5) |
| Decisión | `d5` | Cierre del reactivo con lista vacía: si `DONE` cumple todo `REQUEST` (`COMPLETION_APPROVE` = 0.75) |
| Decisión | `recovery` | Qué hacer cuando falla el paso de un ítem de la lista reactiva: `close`, `rewrite_item` o `replan`. En Jarvis corre solo en modo sombra (registra en la traza, no actúa) |
| Decisión | `continuation` | Hilo de conversación: si el nuevo pedido depende de la tarea anterior o refiere a su resultado (`follow`, umbral `CONTINUATION_APPROVE` = 0.3) |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |
| Generativa | `pending` | Primer pendiente, palabras prohibidas, lista vacía cuando no queda nada por hacer |

Cada corrida ejecuta **variante × dataset × caso × repetición**.

---

## 2. Resultados

Estructura de `eval/results/`: `evals/<modelo evaluado>/<YYYY-MM-DD_HHmmss>[_<label>]/` para corridas manuales (en corridas solo de etapas de decisión, `<modelo evaluado>` es `decisionModel`; en generativas o mixtas, el modelo generativo); `auto/<etapa>/<YYYY-MM-DD_HHmmss>/` para cada sesión de `--auto` (con `session.json` y una carpeta por ronda: `r0`, `r1`, …, `holdout-prod`, `r<k>-holdout`); `sin-modelo/mock/` y `sin-modelo/oracle/` para `--client=mock|oracle`; `herramientas/cross/` para `eval:cross`. Una colisión en el mismo segundo agrega `-2`, `-3`… Las carpetas anteriores (`eval/results/<modelo>/…`) siguen siendo válidas.

| Archivo | Contenido |
|---|---|
| `run.json` | Qué se corrió: modelos, urls, variantes con su hash, datasets, commit, estado (`ok`, `network_failure`, `empty`) y el resultado de cada celda. |
| `comparison.md` / `comparison.json` | Reporte de variantes contra la baseline: resumen por variante y por tipo de etapa, resumen por etapa, regresiones, mejoras, casos `raw` y matrices de confusión. Si una variante mejora un tipo de etapa y empeora el otro, avisa **Resultado mixto**. |
| `<variante>__<dataset>/runs.jsonl` | Cada ejecución: request exacto, salida, graders, latencia, tokens (`questions` trae una entrada por pregunta en las decisiones). |
| `<variante>__<dataset>/scores.json` | Métricas agregadas de la celda. |
| `<variante>__<dataset>/meta.json` | Configuración, commit, hashes de dataset y variante, `filters` y `cases`. |

Un run **pasa** solo si no registró ningún error (llamada al cliente, aplicación de la variante, parseo y todos los checks). Las llamadas fallidas (red, timeout, HTTP, prompt sin margen de contexto) cuentan como falla pero no entran en latencias ni aparecen como regresión o mejora.

---

## 3. Datasets (`.jsonl`)

Una línea por caso; las vacías y las que empiezan con `#` se ignoran. Un caso describe la **situación** (escenario) y lo que se espera; **no trae el prompt**: lo arma la variante al cargar (`prod` usa el de Jarvis) con el mismo código de `src/`. Un typo, una clave desconocida o un valor inválido es error de carga (`archivo:línea: mensaje`).

```json
{"id":"smoke-route","stage":"route","tags":["smoke"],"description":"Con package.json leído falta el README: seguir en files.",
 "scenario":{"mode":"reactive","request":"Fijate qué versión tiene /home/user/app/package.json y dejá anotada esa versión al final del README.md",
   "steps":[{"state":"running"}],
   "calls":[{"route":"files_read","tool":"read_file","status":"ok","args":{"path":"/home/user/app/package.json"},"summary":"{\"version\":\"2.3.1\"}"}]},
 "expect":{"expectedRoute":"files_read"}}
```

| Campo | Descripción |
|---|---|
| `id` | Único dentro del dataset |
| `stage` | Una de las catorce etapas |
| `scenario` | La situación y el punto de decisión (abajo) |
| `expect` | Lo que debe cumplir la salida; claves cerradas por etapa |
| `tags`, `description` | Opcionales; los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del `passRate` canónico |

`scenario`: `mode` (`reactive` | `deliberative`), `request`, `steps`, `calls` (`status`, `args`, `summary`, `verdict`, `ref`), `facts` (clave `answer_<paso>_<n>` o libre), `recalled` (`{ user_memory?: [{ key, value, from? }], thread?: { previous_request?, previous_answer? } }` aplicados al contexto para `arguments`, `final` y `pending`), `userInput`, `finish` (cierre, para `final`) y `at` (punto de decisión: `routes`, `route`, `tools`, `tool`, `inputSchema`, `args`, `call`, `feedback`, `previous`, `environment`). Los tipos están en `core/scenario.ts`.

- Un escenario deliberativo necesita `steps` con `instruction`, `route` y `expected`.
- `pending`: solo en `reactive`; `at.previous` es la lista de la vuelta anterior; `expect` admite `expectEmpty`, `maxItems`, `requiredKeywordsInFirst` y `forbiddenKeywords`.
- `arguments`: el cargador agrega `meta.toolSchema`; sin él el caso falla.
- Las herramientas se nombran como en `SYSTEM_TOOL_MANIFEST`; el schema de entrada (`at.inputSchema`) lo pone el caso.
- El escenario se valida con las reglas del contexto (`apply`): uno imposible (p. ej. cierre `completed` sin llamada aprobada) es error de carga.
- Rutas inválidas, probabilidades fuera de 0–1, `minSteps` > `maxSteps` o `exactFieldValues` vacío también son error de carga.
- **Qué se mide siempre y qué declara el caso (etapas generativas).** Cada etapa aplica a toda salida las reglas de su prompt de producción, sin que el caso las repita: `question` exige una sola pregunta (salvo `singleQuestionOnly: false`) y que no nombre herramientas, estados internos ni ids (`c1`, `s2`); `final` exige lo mismo y que no empiece con saludo; `pending` exige que ningún ítem nombre una herramienta o un estado interno. Lo que decide si la respuesta es la correcta lo declara el caso, y la carga exige al menos: `question` → `mustContainKeywords`; `final` → `mustContainFacts` o `mustMentionEffects`; `arguments` → `requiredFields` o `exactFieldValues`; `pending` → `expectEmpty` o `requiredKeywordsInFirst`.
- **`arguments` y `args_review`: el schema del caso se pasa por producción.** Se recorta a los `params` del manifest y se le agregan las notas de formato (por ejemplo, «offset: 1-based first line»), igual que ve el modelo en Jarvis; un schema con parámetros que producción no ofrece es error de carga. `exactFieldValues` compara las rutas absolutas sin distinguir `/` de la barra invertida ni mayúsculas; los demás valores, tal cual.
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

Solo modo `reactive`, con el contexto en condiciones de cerrar (todos los pasos terminados). Compara la probabilidad de `request_complete` contra `COMPLETION_APPROVE` (0,75). `expect.expectedComplete` es booleano; opcionales `minProbability` (solo con `true`) y `maxProbability` (solo con `false`). Checks: `complete_match`, `min_probability_met`, `max_probability_met`.

### Etapa `recovery` (qué hacer tras un paso fallido)

```json
{"id":"rec-rp-01","stage":"recovery","scenario":{"mode":"reactive","request":"...","steps":[{"instruction":"...","state":"failed"}],"calls":[{"route":"files_write","tool":"write_file","kind":"write","status":"tool_error","summary":"Error: ENOENT...","verdict":"rejected","reason":"no_usable_data"}],"at":{"previous":["<ítem fallido>","<ítem de atrás>"],"cause":"tool_failed","attempts":1}},"expect":{"expectedAction":"replan"}}
```

Solo modo `reactive`, con el último paso `failed` (si `at.attempts` > 1, los últimos `attempts` pasos seguidos en estado `failed`, con cada llamada apuntando a su `step`). `at.previous` es la lista de la vuelta con el ítem fallido de primero; `at.cause`, la causa del motor (`tool_failed`, `verify_rejected`, `review_rejected`, `call_cap`, `repeat_blocked`, `user_rejected`, `denied`, `no_tools`); `at.attempts` (≥ 1) debe coincidir con los pasos fallidos seguidos. `expect.expectedAction` es `close`, `rewrite_item` o `replan`. Con temperatura 0, repetir (`--repeat`) no aporta nada.

### Etapa `fragment_judge`
El caso de `fragment_judge` trae solo la necesidad y los fragmentos (`at.fragments`, de 1 a 5 fragmentos `JUDGE_BATCH`, y `expectedRelevant` en orden):

```json
{"id":"fj-005","stage":"fragment_judge","scenario":{"mode":"reactive","request":"…","at":{"need":"¿Cuál es la velocidad de la luz?","fragments":["…","…","…"]}},"expect":{"expectedRelevant":[true,false,true]}}
```

Checks: `fragment_<i>_match`, `fragment_<i>_min_probability` (si pide `minProbability`) y `fragment_count_match`.

---

## 4. Escribir una variante

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

- Una variante solo define `name` y `prompts` (`DECISION_PROMPTS` o `PROMPTS`); no admite `params` ni `read`.
- Los helpers de `prompts.ts` (`frameLines`, `listBlock`, `lastFailedBy`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`, `join`, `todayLine`…) están exportados para reutilizar lo que no cambia. Para partir del texto actual, usar `--dry-run`.
- Un error en el constructor o un request mal formado es error de carga.
- Punto de partida: `variants/prod.ts`. Se corre con `--variant=prod,mi_variante`.

---

## 5. Interpretar los resultados

- **Latencia:** con `--concurrency` > 1, p50 y p95 incluyen espera del servidor. Con menos de 20 llamadas el p95 es el máximo (suele ser la carga en frío): se marca con `†`; comparar con p50.
- **Unidad de comparación:** Δ, regresiones, mejoras y prueba de signos son **por caso**; las repeticiones no son muestras independientes. Δ compara solo casos medidos en ambos lados.
- **Ruido:** un Δ no es un veredicto; mirar `p (signos)`. Las etapas generativas varían entre corridas: usar `--repeat` antes de decidir por pocos casos.
- **Reintentos:** en etapas **generativas**, `pass` se mide después del reintento por respuesta inválida (`LLM_INVALID_OUTPUT_RETRIES`), igual que producción, y la columna `Reintentos` cuenta los runs que lo necesitaron. Las etapas de **decisión** no reintentan respuestas inválidas (el modelo de decisión es determinista).
- **Tipos de etapa:** el total mezcla decisión y generativas (modelos distintos). Ante **Resultado mixto**, decidir con el desglose por tipo. `passRate` pesa cada etapa por su cantidad de casos; `Macro por etapa` las pesa por igual.
- **Sobreajuste:** reservar un dataset aparte (holdout) y correrlo solo para validar una variante antes de pasarla a `src`.
- **Comparar corridas:** dos celdas son comparables solo si tienen el mismo `datasetHash` y el mismo `cases.hash` en `meta.json`. Los modelos usados valen solo para ese modelo.
- **Los casos miden el prompt actual:** un cambio en `src/`, en `jarvis-config.json` o en la fecha cambia el request (ver `requestHash`).

---

## 6. Cruce con el pre-chequeo (`eval:cross`)

Usa parseo estricto de flags (falla con exit `2` ante flags desconocidos, vacíos o carpetas inexistentes). `--dataset` acepta nombres (`args_review_v1`), con `.jsonl` o rutas a un `.jsonl` (no carpetas ni globs). Sin `--runs` mide solo el pre-chequeo de producción sobre los casos `args_review`; con `--runs` compone cuatro tuberías con las etiquetas de D3 y las compara contra `--baseline`/`d3` (`prod` por defecto), y resume D4 con `NOUL_APPROVE`. Salida en `eval/results/_cross/<YYYY-MM-DD-HH-mm>[_<label>]/` (`cross.md`, `cross.json`).

---

## 7. Modo `--auto`: cómo funciona

Prueba variantes de prompt de **una etapa**: un modelo optimizador propone hasta 2 variantes por vuelta, el eval las mide contra `prod` y repite hasta alcanzar `--target` o `--max-loops`. Se usa desde `eval/cli.ts --auto` o directamente con `eval/auto.ts`.

### Varias etapas

Con `--stage=<a,b,...>`, `all`, `decision` o `generative` el modo corre cada etapa en serie, con el mismo `--max-loops` y `--target`. Las de decisión van primero, para que el servidor de modelos no cambie de modelo en cada etapa. Cada etapa tiene su propia sesión, historial y variantes, como si se hubiera corrido sola. Una etapa que termina sin alcanzar el objetivo no corta a las demás; un error de configuración o de transporte sí. Una etapa sin datasets con casos se omite. Al final se muestra una tabla con el resultado de `prod`, la mejor variante y si se alcanzó el objetivo. Con `--holdout=auto` cada etapa usa los `*_holdout*.jsonl` de su carpeta en `eval/datasets/`.

### Qué usa y qué escribe el optimizador

- **Modelos.** El modelo **evaluado** se elige con `--decision-model`, `--generative-model` o `--model=<gen>[+<dec>]` (por defecto, `jarvis-config.json`). `--optimizer-model` es solo el modelo que propone variantes; con `--optimizer-thinking=off` (default) se evitan respuestas vacías en modelos híbridos como Qwen 3.5.
- **Solo textos.** En las 14 etapas el optimizador escribe textos y el código arma el archivo de la variante, así que nada de lo que escribe se ejecuta.
  - Etapas de decisión: la instrucción de cada pregunta, la descripción de cada opción y una nota de estado, sobre la función de producción (`DECISION_PROMPTS.<función>`). Ve los textos vigentes, el historial de ideas probadas y un resumen de errores por etiqueta; no ve casos ni respuestas esperadas.
  - Etapas generativas (`plan`, `arguments`, `final`, `question`, `pending`): el texto `SYSTEM` completo de la vista (`PROMPTS.<vista>`); el armado del mensaje del usuario queda como en producción. Ve el formato que se exige a la respuesta, las reglas del evaluador, el historial y los tipos de fallo del Top-1 con su conteo; no ve casos ni respuestas esperadas. Se rechaza una propuesta igual al texto vigente o que pierda lo que el formato exige (por ejemplo `"steps"` en `plan`).
- **Modos (`--mode`).** `rewrite` (default) propone textos nuevos y ve el Top-1 y el Top-2 como referencia; lo que no escribe queda como en `prod`. `improve` parte de un texto base —el Top-1 vigente, o `--base=<variante>` en la primera vuelta— y lo mejora agregando y quitando; lo que no escribe queda como en el base.

### Cómo corre

- **Inicio.** Busca en `eval/results/` corridas previas 100 % compatibles (mismo dataset, casos, modelo evaluado, `thinking`, configuración de etapa, `repeat`, variante y sin filtros) para `prod` y las variantes activas de la etapa. Si faltan, hace una Vuelta 0 con `prod` y las variantes activas, o con `--seed-top=v1,v2`. Si existe `auto_state.json` con la misma huella, conserva el avance.
- **Datasets.** Sin `--dataset`, usa todos los `.jsonl` con casos de la etapa, excepto `smoke.jsonl` y los `*_holdout*.jsonl` (esos se piden con `--holdout`).
- **Validación de cada variante.** Antes de medirla se compila, se carga en un entorno aislado, se comprueba que tenga la forma de la etapa y que no repita una anterior, y que cada caso del dataset se pueda armar con ella. Solo si pasa todo se escribe en disco; si falla, se le pide al optimizador que la corrija (hasta 2 reintentos).
- **Cada vuelta.** Corre `prod`, el Top-2 y las dos variantes nuevas en un solo lote y las ordena por `passRate` o `macroPassRate` (`--metric`), con desempates fijos (llamadas fallidas, reintentos, ventaja neta y prueba de signos contra `prod`, latencia, tokens del prompt).
- **Historial.** Al cerrar cada vuelta se anota en `ledger.jsonl` una línea por variante: su resumen, el puntaje medido, el Δ contra `prod`, mejoras y regresiones, y su estado (Top-2, perdió, falló el holdout, inválida). Al optimizador solo se le muestran las últimas 10 entradas.

### Holdout

Con `--holdout`, al empezar se mide `prod` sobre el holdout y se informa. Una variante se confirma al llegar a `--target` en el holdout. Con `--holdout-margin=0.10`, se confirma si supera a `prod` en el holdout por 10 puntos o más, aunque no llegue a `--target` (útil cuando el holdout es difícil). Si `prod` más el margen supera el 100 %, se avisa que ninguna variante podrá confirmarse. Una variante que cae en el holdout no se vuelve a evaluar en él y queda anotada como «falló el holdout», sin cifras: el optimizador no ve los resultados del dataset oculto.

### Dónde queda cada cosa

| Qué | Dónde |
|---|---|
| Variantes en juego, `ledger.jsonl` y `auto_state.json` | `eval/variants/_auto/<etapa>/` |
| Variantes que superaron a `prod` en su ronda | `eval/variants/_ganadoras/<etapa>/` |
| Variantes que no entraron al Top-2 ni superaron a `prod` | `eval/variants/_auto/<etapa>/descartadas/` (con `--archive-losers=false` no se mueven) |
| Resultados de cada sesión | `eval/results/auto/<etapa>/<fecha_hora>/` |

Superar a `prod` en desarrollo no confirma la mejora: con pocos casos puede ser ruido, y la confirmación es el holdout. Las variantes ganadoras se mueven (no se copian: el nombre de una variante debe ser único) y ya no se archivan. Para adoptar una, copiala a `eval/variants/<etapa>/` y sacala de `_ganadoras/`. Borrar `eval/variants/_auto/`, `eval/variants/_ganadoras/` y `eval/results/auto/` deja el repositorio como antes de usar `--auto`.
