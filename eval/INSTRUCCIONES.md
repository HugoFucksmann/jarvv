# Guía de Uso del Framework de Evaluación (`eval`)

Documentación y referencia completa del framework de evaluación de prompts y modelos (generativos y de decisión). Para una presentación breve, ver [`README.md`](./README.md).

---

## 1. Script Principal

El punto de entrada unificado es:

```bash
npx tsx eval/cli.ts [flags]
```

Atajos de `package.json`: `npm run eval -- [flags]` (equivale a lo anterior) `npm run eval:smoke` (`smoke` con el mock en `--dry-run`, sin modelos), `npm run eval:menu` (asistente), `npm run eval:cross` (cruza el pre-chequeo con una corrida de `args_review`; ver sección 9) y `npm run eval:psvalid` (mide cuántos `command` de `arguments` de una corrida son PowerShell válido; recibe la carpeta de la corrida).

Al iniciar, la CLI imprime un bloque **Configuración** con los modelos y URLs, la concurrencia, las repeticiones, el thinking, el timeout, las variantes, la baseline, los datasets (con cantidad de casos), las etapas y los filtros. No se imprime en `--dry-run`.

> **Sintaxis de flags:** `--flag=valor` para valores y `--flag` (o `--flag=false`) para booleanos. Es error de configuración (código 2): un flag no reconocido, repetido, sin valor o con valor vacío (`--model=`), o un número que no sea un entero/decimal simple (`--limit=1e3`, `--min-pass-rate=.9`; usar `0.9`). Una lista CSV que queda vacía (`--stages=,`) también es error. Ejecutar siempre desde la raíz del repo: las rutas por defecto son relativas al cwd.

### Etapas evaluadas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión | `route` | Ruta elegida (`files`, `locate`, `terminal` o `web`) y su probabilidad |
| Decisión | `tool_choice` | Herramienta elegida y su probabilidad |
| Decisión | `args_review` | `approved`, `args_invalid` o `info_missing` (la herramienta la elige `tool_choice`; no hay `tool_rejected`) |
| Decisión | `result_verification` | Veredictos `ok` y `cumple` |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, refs válidos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |
| Generativa | `pending` | Lista de pendientes del reactivo: primer pendiente, palabras prohibidas, lista vacía cuando no queda nada por hacer |

Cada corrida ejecuta **variante × dataset × caso × repetición**.

---

## 2. Flags Disponibles

### Exploración y Modo Rápido
| Flag | Tipo | Descripción |
|---|---|---|
| `--list` | Booleano | Muestra las etapas registradas, variantes disponibles en `eval/variants/` y datasets por defecto, finalizando inmediatamente. |
| `--menu` | Booleano | Asistente interactivo: elige modelos, datasets, variantes (`prod` como baseline es opcional), etapas y opciones avanzadas; muestra el comando equivalente y, tras confirmar, lo ejecuta. También `npm run eval:menu`. Necesita terminal interactiva. |
| `--help` | Booleano | Resumen breve de uso. |
| `--dry-run` | Booleano | Carga la configuración, datasets y variantes pero no invoca a los modelos ni evalúa. **Imprime el request (el prompt) de cada caso tal como se enviaría**: sirve para ver el prompt actual de una etapa (`--variant=prod --ids=<caso> --dry-run`) y copiarlo al escribir una variante. |

### Datasets y Filtros
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--dataset` | CSV de rutas / glob / carpetas | `eval/datasets/` | Archivos `.jsonl`, directorios o globs a evaluar. Basta el nombre: `--dataset=smoke` (o `smoke.jsonl`, o `decision_*`) se busca en `eval/datasets/`; una ruta que existe se respeta tal cual. |
| `--stages` | CSV de etapas | *(todas)* | Filtra por etapas específicas (válidas: `plan`, `arguments`, `final`, `question`, `pending`, `route`, `tool_choice`, `args_review`, `result_verification`). |
| `--tags` | CSV de etiquetas | *(ninguno)* | Evalúa solo casos que contengan los tags especificados. |
| `--ids` | CSV de IDs | *(ninguno)* | Evalúa solo casos con los IDs exactos indicados. |
| `--limit` | Entero $\ge 1$ | *(sin límite)* | Cantidad máxima de casos a cargar por dataset. |
| `--include-shortcut` | Booleano | `false` | Los casos con tag `prod_shortcut` (decisión con una sola opción) **se ejecutan siempre**, pero sin este flag se reportan en el bucket `raw`, fuera del `passRate` canónico. Con el flag cuentan como canónicos. |

### Variantes y Baseline (Pruebas A/B)
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--variant` | CSV de variantes | `prod` | Nombres de variantes en `eval/variants/`. Una variante por nombre (ej: `--variant=prod,route_min`); la composición con `+` ya no existe y da error. `prod` se agrega como baseline de comparación salvo con `--no-baseline`. |
| `--baseline` | String | `prod` | Variante tomada como base para la comparación de métricas (delta/diff). Debe coincidir exactamente con una de las specs de `--variant`; si no, error de configuración. |
| `--no-baseline` | Booleano | — | No agrega `prod` a las variantes: corre solo las que indiques en `--variant` (obligatorio). La baseline pasa a ser la primera variante, o la de `--baseline` si la pasas. No hay deltas contra `prod`; con dos o más variantes, se comparan contra la primera. Ejemplo: `--variant=jarvis_alt_v2 --no-baseline`. |

### Modelos y Conexión (Generativos y Decisión)

Los modelos y URLs por defecto salen de la configuración de producción (`jarvis-config.json`; sin ese archivo, sus valores por defecto: `qwen3.5:4b` y `d3:2b` en Ollama local). Así el eval mide por defecto lo que corre Jarvis. Los valores de la tabla son esos defaults.
| Flag | Tipo / Opciones | Default | Descripción |
|---|---|---|---|
| `--model` | `<llm>[+<decisión>]` | `qwen3.5:4b+d3:2b` | Modelo generativo y, tras `+`, el de decisión. Un lado vacío usa su default (`--model=modA` = `modA` + `d3:2b`; `--model=+lfm3:1.7b` = `qwen3.5:4b` + `lfm3:1.7b`). El eval corre un solo modelo de cada tipo: para comparar modelos, correr dos veces. |
| `--url` | URL | `http://127.0.0.1:11434` | Endpoint base del servidor para el modelo generativo. |
| `--decision-url` | URL | `http://127.0.0.1:11434` | Endpoint del servidor de decisión (se le agrega `/v1/systemone`). |
| `--client` | `real` \| `mock` \| `oracle` | `real` | `mock` devuelve respuestas genéricas sin red (prueba la maquinaria). `oracle` responde lo que pide el `expect` de cada caso: debe dar 100 %; si un caso falla, el bug está en el caso, un grader o el parseo, no en el modelo. Solo vale con la variante `prod` (no entiende preguntas u opciones distintas de las de producción). |

### Parámetros de Ejecución
| Flag | Tipo / Opciones | Default | Descripción |
|---|---|---|---|
| `--thinking` | `auto` \| `prod` \| `on` \| `off` \| `both` | `auto` | Política de razonamiento/thinking. `both` corre cada caso dos veces (con y sin thinking) para comparar el impacto. |
| `--timeout` | Entero (ms) | `120000` (gen) / `180000` (thinking) / `30000` (dec) | Timeout por petición en milisegundos. |
| `--concurrency` | Entero $\ge 1$ | `3` | Cantidad de peticiones simultáneas. Con valores > 1 las **latencias no son comparables** (incluyen espera del servidor, p. ej. `OLLAMA_NUM_PARALLEL`); usar `1` para medir latencia. Pass/fail no se ve afectado. |
| `--repeat` | Entero $\ge 1$ | `1` | Repeticiones por caso para medir estabilidad y varianza. |

### Resultados y Umbrales
| Flag | Tipo | Default | Descripción |
|---|---|---|---|
| `--label` | String | *(vacío)* | Sufijo identificador para la carpeta de resultados (ej: `--label=test_prompt_v2`). |
| `--min-pass-rate` | Float ($0.0$ a $1.0$) | *(ninguno)* | Se aplica a **todas** las celdas (variante × dataset) que no sean la baseline; si solo corrió la baseline, a esas. Si cualquiera queda por debajo (o no tiene runs), el CLI sale con código `1` (útil para CI/CD). El `passRate` considera solo el bucket canónico. |

---

## 3. Estructura de Salida (`results`)

Las corridas se almacenan organizadas por modelo y timestamp en:
`eval/results/<modelo>/<YYYY-MM-DD_HHmmss>[_<label>]/` (las corridas con `--client=oracle` o `--client=mock` no miden ningún modelo y van aparte, en `eval/results/_oracle/…` y `eval/results/_mock/…`)

`<modelo>` es el modelo generativo.

Si ya existe una carpeta con ese nombre (dos corridas en el mismo segundo) se agrega `-2`, `-3`… En Windows, los caracteres inválidos del modelo, la etiqueta y las celdas se reemplazan por `_`. Un mismo `runId` identifica todas las celdas de una invocación y `meta.timestamp` es ISO 8601.

Dentro del directorio se genera:
- `<variante>__<dataset>/`:
  - `runs.jsonl`: Registro detallado de cada ejecución individual (request exacto, salida, graders, latencia, tokens). En las decisiones, `questions` trae una entrada por cada pregunta del request (ver "Decisiones con varias preguntas").
  - `scores.json`: Métricas agregadas de la celda (pass rate, accuracy, latencias, `clientFailedRuns`). Los runs cuya llamada falló (red, timeout, HTTP o prompt sin margen de contexto) cuentan como falla en el pass rate pero **no** entran en las latencias ni aparecen como regresión/mejora en `comparison.md`; los deltas comparan solo casos medidos en ambos lados y el reporte avisa si alguno quedó afuera. `latencySamples` indica cuántas llamadas hay detrás de las latencias: con 0, no hay dato aunque figure 0. La accuracy se calcula sobre las decisiones con respuesta y cuenta un parseo fallido como error (`(sin predicción)` en la matriz de confusión).
  - `meta.json`: Configuración de la corrida, commit de Git, hashes de dataset y variante. `gitDirty` ignora `eval/results/`. `model` y `decisionModel` son los modelos de la corrida. `filters` (`tags`, `ids`, `limit`) y `cases` (cantidad y hash de los ids) dicen qué subconjunto del dataset corrió la celda: `datasetHash` es el del archivo completo, así que dos celdas solo son comparables si tienen el mismo `cases.hash`. `promptEnv` (fecha y hash de la configuración de etapas) explica por qué cambió el `requestHash` de un caso por escenario entre corridas aunque `src` sea el mismo.
- `comparison.md`: Reporte markdown comparando variantes contra la baseline (`prod`). Secciones: **Resumen por variante** (una fila por variante y tipo de etapas —generativo y decisión, y un total mezclado cuando hay ambos, con la columna Tipo—: passRate agregado, Δ vs baseline, passRate macro por etapa, regresiones, mejoras, prueba de signos, runs sin medir, reintentos si los hubo, p50; si una variante mejora un tipo y empeora el otro agrega el aviso **Resultado mixto**, porque el total no sirve para decidir), resumen por etapa con las variantes lado a lado (el delta contra la baseline va entre paréntesis), regresiones, mejoras, casos raw y matrices de confusión. Con decisiones de varias preguntas agrega **Preguntas por Etapa**. La consola muestra el resumen por variante, el resumen por etapa (una línea por variante, con sus deltas), las preguntas por etapa y las regresiones y mejoras (también las de casos raw); las matrices de confusión y las tablas completas quedan solo en `comparison.md`.
- `comparison.json`: Lo mismo en formato JSON (`variants`, `cells`, `deltas`, `regressions`, `improvements`, `rawRegressions`, `rawImprovements`, `warnings`).

### Decisiones con varias preguntas
Un request de decisión puede llevar varias preguntas (las que arma la variante: producción trae dos en `result_verification`, `ok` y `cumple`; una variante puede traer más) para cruzarlas en una sola pasada, por ejemplo para detectar falsos positivos y falsos negativos.

- **Parseo por pregunta**: cada pregunta se parsea por separado. Una respuesta mal formada afecta solo a esa pregunta (`error` en su entrada), no a las demás.
- **Registro sin pisarse**: `runs.jsonl` trae `questions`, indexado por la clave de la pregunta. Cada entrada tiene `type`, `role` (`main` = alimenta la salida canónica de la etapa; `extra` = adicional), `answer`, `probabilities` o `noul`, `expected` y `correct`. En `noul`, `answer` es `yes` o `no` (`yes` si la probabilidad es `>= NOUL_APPROVE`, 0.6 en producción). La principal es la de producción (`route`, `selected_tool`, `review`; `ok` y `cumple`).
- **Esperado por pregunta**: la principal se evalúa con el `expect` de la etapa. Las adicionales, con `expect.answers`:
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
  `choice` para preguntas `choice`, `yes` para `noul`. Las claves pueden ser de preguntas que solo agrega una variante: si el request no las trae no se evalúan (warning `q_<clave>_sent`). Cada una genera sus propios checks (`q_<clave>_match`, `q_<clave>_min_probability`) y, si falla, cuenta como falla del run con un mensaje que nombra la pregunta. Una pregunta enviada sin expectativa se registra pero no se evalúa.
- **Scoring** (`scores.json` y `comparison.md`, solo en etapas con 2 o más preguntas evaluadas): por pregunta, accuracy, matriz de confusión y, por clase, TP/FP/FN, precisión y recall; y `questionCross`, que cruza cada par de preguntas (ambas bien, solo A, solo B, ambas mal). En `noul` la clase positiva es `yes`. En consola, las preguntas sí/no muestran FP, FN y sin respuesta (que suman los errores), y las demás muestran la cantidad de errores. Las tablas por clase de `comparison.md` usan la definición una-contra-resto: ahí un `yes` esperado sin respuesta también es FN.
- **Oráculo**: con `prod` solo hay preguntas principales; las responde según el `expect` del caso. `--client=oracle` con otra variante se rechaza al parsear la configuración.

### Códigos de salida
| Código | Significado |
|---|---|
| `0` | Corrida correcta (y umbral cumplido, si se pidió). |
| `1` | Alguna celda quedó por debajo de `--min-pass-rate`. |
| `2` | Error de configuración, dataset inválido, filtros que no dejan casos, ninguna corrida canónica, todas las llamadas fallaron por el cliente (red, timeout o HTTP), o una variante que no se pudo aplicar a algún caso (también en `--dry-run`). |

### Qué cuenta como "pasó"
Un run pasa solo si no registró ningún error: llamada al cliente, aplicación de variante, parseo de la salida y todos los checks de los graders. Una variante que no se puede aplicar a un caso no genera runs: es error de carga (con el caso y la línea) y la CLI termina con código 2 antes de correr, también en `--dry-run`. Una consulta de decisión que excede `decisionMaxContext` o un prompt generativo sin margen de salida en `qwenNumCtx` no se envía y falla (`decision_context_ok` / `client_call_ok`), como en producción. El pre-chequeo de producción sobre `arguments` (`precheck_ok`) solo corre con `--client=real`: `mock` y `oracle` fabrican valores sin origen en la tarea. Un caso donde ningún grader ejecuta checks falla (`graders_ran_checks`). Si el caso pide `minProbability`, la salida debe traer la probabilidad; si no la trae, falla.

### Reintentos (como producción)
- **Transporte** (todas las etapas): ante error de red o HTTP 503 se reintenta una vez tras 1 s. El timeout es un presupuesto total que incluye el reintento y nunca se reintenta.
- **Salida inválida o truncada** (solo `plan`, `arguments`, `final`, `question`, `pending`): un reintento con `ERROR_PREVIO` agregado al `user`, 1.5× `maxTokens` y temperatura `max(0.3, la del request)`. En `final` el reintento va sin thinking. En `final` y `question` una salida truncada en el último intento se acepta, aunque `not_truncated` igual la marca. Las etapas de decisión no reintentan por truncado, pero sí repiten la consulta (mismo request, sin nota) hasta `invalidResponseRetries` veces cuando la respuesta no pasa la validación, como `queryModel`; un desborde de contexto no se repite.
- El run guarda `measurements.attempts` y un warning por cada reintento. `durationMs` y los tokens suman todos los intentos. Los mensajes de error del reintento son los de producción (`NOT_JSON`, `salida vacía`, el error de `parsePlanSteps`, los problemas de `validateArgs`).

---

## 4. Datasets (`.jsonl`)

- Una línea por caso; las líneas vacías y las que empiezan con `#` se ignoran.
- `expect` se valida con lista cerrada de claves por etapa: una clave desconocida, un `expect` sin ningún check o un valor inválido es error de carga (`archivo:línea: mensaje`). También se rechazan: rutas que no son ejecutables (`expectedRoute`, `firstRoute`, `allowedRoutes`, `requiredRoutes`), probabilidades fuera de 0–1, `minSteps` > `maxSteps`, `exactFieldValues` vacío y `minOkProb`/`minCumpleProb` con el veredicto esperado en `false`.
- Los textos (`mustContainFacts`, keywords, etc.) se buscan por palabra o frase completa, sin distinguir mayúsculas ni acentos; un número no coincide dentro de otro (`12` no está en `12.5`, `12.000` ni `120`). Un término admite alternativas con `|` (`archivo|archivos` coincide con cualquiera de las dos; `\|` es un `|` literal); en las listas de lo prohibido, basta con que aparezca una. Excepción: `forbiddenHardcodedValues` de `arguments` busca por subcadena sobre el valor normalizado (minúsculas, `\` → `/`), sin límite de palabra, sin quitar acentos y sin `|` (`12` aparece prohibido dentro de `120`); son rutas, URLs o comandos.
- Etapa `arguments`: el caso debe traer `meta.toolSchema`; sin él falla (producción siempre valida contra el schema).
- Los globs soportan `*`, `**` y `?` (no `{a,b}`).


### Formato de un caso

Hay un solo formato de caso: el **escenario**. Un caso es una línea de un `.jsonl` en `eval/datasets/` que describe la situación de la tarea y lo que se espera; **no trae el prompt**. El prompt lo arma la variante al cargar (`prod` usa el de Jarvis; otra variante, el suyo), con el mismo código de Jarvis: `ctx.view.*` → `engine/adapters.ts` → constructores de `models/prompts.ts` y `models/stageRequests.ts`. Los mensajes fijos de `ctx/views/messages.ts`, los topes de `BUDGET`, los renderizadores y los parámetros de cada etapa (tokens, thinking, schema) son los de producción y se actualizan solos cuando cambian en `src/`.

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
| `stage` | Una de las nueve etapas |
| `scenario` | La situación y el punto de decisión (abajo). Un caso con `request` (prompt armado a mano) es error de carga |
| `expect` | Lo que debe cumplir la salida. Claves cerradas por etapa; un typo falla al cargar con `archivo:línea` |
| `tags`, `description` | Opcionales. Los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del `passRate` canónico |
| `meta.toolSchema` | En `arguments`: lo agrega el cargador (el schema real de la herramienta, para validar como producción) |

`scenario`: `mode` (`reactive` | `deliberative`), `request` (la solicitud del usuario), `steps`, `calls` (con su `status`, `args`, `summary`, `verdict`, `ref`), `facts`, `userInput` (respuestas previas del usuario), `finish` (cierre, para `final`) y `at` (parámetros del punto de decisión: `routes`, `route`, `tools`, `tool`, `inputSchema`, `args`, `call`, `feedback`, `previous`, `environment`). Los tipos están en `core/scenario.ts`. Un escenario deliberativo necesita `steps` con `instruction`, `route` y `expected`.

- Etapa `pending`: solo en modo `reactive`; `at.previous` es la lista de pendientes de la vuelta anterior (ausente o vacía en la primera) y su `expect` admite `expectEmpty`, `maxItems`, `requiredKeywordsInFirst` y `forbiddenKeywords`.
- Las herramientas se nombran como en el manifest de Jarvis (`SYSTEM_TOOL_MANIFEST`): la descripción sale de ahí; el schema de entrada (`at.inputSchema`) lo pone el caso, porque el del servidor MCP no es estático.
- El escenario se valida con las reglas reales del contexto (`apply`): un escenario imposible (p. ej. cierre `completed` sin llamada aprobada) es error de carga `archivo:línea: scenario: …`. También se valida el `request` que sale de la variante (una pregunta mal formada es error de carga).
- Un request de decisión puede llevar varias preguntas y `expect.answers` fija la respuesta esperada de las adicionales (ver [Decisiones con varias preguntas](#decisiones-con-varias-preguntas)). Los casos de decisión con una sola opción se etiquetan solos como `prod_shortcut` (ver `--include-shortcut`).
- Los prompts dependen del código de `src/`, de `jarvis-config.json` (tokens por etapa) y de la fecha (`TODAY`); `requestHash` de cada run permite detectar que cambió el prompt entre corridas, y `meta.json` guarda el commit.
- `datasets/smoke.jsonl` tiene un caso por etapa y sirve para comprobar que el eval corre.

---

## 5. Ejemplos de Uso

### Listar etapas y variantes disponibles
```bash
npx tsx eval/cli.ts --list
```

### Validar casos y graders con el oráculo (sin servidor/GPU)
```bash
npx tsx eval/cli.ts --client=oracle --dataset=eval/datasets/smoke.jsonl
```
Esperado: 100 %. Cualquier falla indica un caso o grader mal escrito.

### Ejecución de humo con mock (sin requerir servidor/GPU)
> Nota: el mock devuelve respuestas genéricas (primera opción, `"Mock response."`), por lo que fallan los casos cuya respuesta correcta no es la primera opción y los de `arguments`, `final` y `question`. Sirve para probar la maquinaria, no para validar prompts.
```bash
npx tsx eval/cli.ts --client=mock --dataset=eval/datasets/smoke.jsonl
```

### Evaluar etapa específica (ej: solo `plan`) con modelo real
```bash
npx tsx eval/cli.ts --stages=plan --dataset=eval/datasets/smoke.jsonl --model=qwen3.5:4b
```

### Comparar una variante contra producción (A/B testing)
```bash
npx tsx eval/cli.ts --variant=prod,route_min --stages=route --dataset=eval/datasets/smoke.jsonl
```

### Comparar impacto de Thinking (`both` = on y off)
```bash
npx tsx eval/cli.ts --stages=final --thinking=both --limit=10
```

### Corrida en paralelo con repeticiones para verificar consistencia
```bash
npx tsx eval/cli.ts --concurrency=4 --repeat=3 --label=consistency_check
```

### Ver el prompt que recibe el modelo (sin llamar al modelo)
```bash
npx tsx eval/cli.ts --dataset=smoke --variant=prod --ids=smoke-route --dry-run
```
Imprime el request tal como se envía (para una decisión, el `{ state, questions }`). Es el punto de partida para copiar al escribir una variante.

### Verificación de umbral para CI/CD
```bash
npx tsx eval/cli.ts --dataset=eval/datasets/smoke.jsonl --min-pass-rate=0.90
```

---

## 6. Escribir una variante

Hay un solo formato de variante: un archivo en `eval/variants/<nombre>.ts` con prompts **enteros**. No hay ediciones sobre el prompt de producción (`append`, `replace`, `criteria: { set, remove }`…) ni composición de variantes (`a+b`): el texto que se prueba es el que está escrito en el archivo. El `name` debe coincidir con el archivo. `prod` no define nada: cada etapa usa el prompt de `src/` tal cual.

Qué se reemplaza, siempre completo:

| Etapa | Qué escribe la variante |
|---|---|
| `route`, `tool_choice`, `args_review`, `result_verification` | El constructor entero en `prompts.DECISION_PROMPTS` (`buildRouteChoice`, `buildToolChoice`, `buildArgsReview`, `buildResultVerification`). Recibe los datos del caso y devuelve `{ state, questions }`; cada pregunta lleva `type`, `instructions` y, según el tipo, `criteria` (`choice`: una opción por clave; `noul`: opcionalmente `{ true, false }`) |
| `plan`, `arguments`, `final`, `question`, `pending` | La vista entera en `prompts.PROMPTS` (`PLAN_VIEW`, `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION`, `PENDING_VIEW`), con todas sus piezas (`SYSTEM`, `buildUserPrompt`…) |

Lo que la variante no nombra (otras etapas, otras vistas) usa producción, para poder comparar etapa por etapa. Una vista o un constructor que sí se nombra se escribe entero: el tipo no admite piezas sueltas y nada se fusiona con producción.

```ts
import type { RouteDecisionInput } from "../../src/core/contracts.ts";
import { frameLines } from "../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../src/core/models/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

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

- **Parámetros** de una etapa generativa (la única perilla que no es texto): `params: { pending: { temperature: 0.2, maxTokens: 512 } }` (`thinking`, `maxTokens`, `temperature`, `schema`, `reasoningEffort`). Si una variante fija `thinking`, no se expande con `--thinking`.
- **Leer las respuestas**: si la variante conserva las preguntas de producción (`review`; `ok` y `cumple`, ambas `noul`), no hace falta nada. Si cambia el conjunto de preguntas de `args_review` o `result_verification`, `read` dice cómo salen la etiqueta o `ok`/`cumple` de las respuestas (`read.args_review`, `read.result_verification`). Las claves de pregunta de `route` (`route`) y `tool_choice` (`selected_tool`) son fijas.
- Los helpers y tablas de `prompts.ts` (`frameLines`, `listBlock`, `lastFailedBy`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`, `join`, `todayLine`…) están exportados para reutilizar lo que no cambia. Para partir del texto actual de una etapa, usar `--dry-run` (sección 5).
- Un error en el constructor o un request mal formado es error de carga, con el caso y la línea.
- Una plantilla completa de las cuatro etapas de decisión está en `variants/decision_all_stages_example.ts`, y las variantes reales por etapa están en las subcarpetas de `variants/` (con un `conclusiones_*.md` cada una). Se corre con `--variant=prod,mi_variante`.

---

## 7. Interpretar los resultados

- **Latencia y concurrencia.** Con `--concurrency` mayor que 1, p50 y p95 incluyen espera del servidor y no son comparables. Usar `1` para medir latencia; el pass/fail no se ve afectado.
- **p95 con pocas muestras.** Con menos de 20 llamadas el p95 es el máximo, que suele ser la carga en frío del modelo. Se marca con `†` y no se publica su delta; comparar con p50. El total mezclado no muestra p50 porque combina etapas de milisegundos y de segundos. Las latencias generativas suman los reintentos.
- **Casos sin medir.** Una llamada fallida (red, timeout, HTTP) cuenta como falla en `passRate`, pero no entra en las latencias ni aparece como regresión o mejora. Δ compara solo casos medidos en ambos lados, y el reporte avisa si alguno quedó afuera.
- **Unidad de comparación.** Δ, regresiones, mejoras y la prueba de signos se calculan **por caso**: con `--repeat`, las repeticiones de un caso no cuentan como muestras independientes (un caso que pasa 2 de 3 es distinto de uno que siempre falla).
- **Reintentos.** El `pass` se mide después del reintento "como producción", que puede esconder cuánto falla el modelo crudo: la columna `Reintentos` cuenta los runs que lo necesitaron.
- **Costo.** Los tokens por etapa están en la tabla por etapa; con `--thinking=both`, `final[think=on]` y `final[think=off]` van en filas separadas para comparar su costo.
- **Sobreajuste al dataset.** Iterar variantes contra el mismo dataset con el que se miden acaba premiando el ruido. Conviene reservar un dataset aparte (holdout) que no se use al iterar y correrlo solo para validar una variante antes de pasarla a `src`.
- **Ruido.** Un Δ no es un veredicto: mirar `p (signos)`, calculado sobre los casos que cambiaron. Con menos de 6 cambios nunca baja de 0.05. Las etapas generativas varían entre corridas con el mismo request: usar `--repeat` antes de decidir por pocos casos.
- **Tipos de etapas.** El total mezcla etapas de decisión y generativas, que corren modelos distintos. Si una variante mejora un tipo y empeora el otro, el reporte avisa **Resultado mixto**: decidir con el desglose por tipo.
- **Peso de las etapas.** `passRate` pesa cada etapa según su cantidad de casos, y `final` corre dos veces con `--thinking=auto`. `Macro por etapa` pesa todas por igual y cuenta `final[think=on/off]` como una sola: si ambos difieren, el resultado depende de la composición del dataset.
- **Los casos miden el prompt actual.** Se arman con `src` en cada carga: un cambio en `src`, en `jarvis-config.json` (tokens por etapa) o en la fecha (`TODAY`) cambia el request; `requestHash` de cada run permite detectarlo.
- **Comparar corridas.** Cada corrida compara solo las celdas que ejecutó. Dos celdas son comparables si tienen el mismo `datasetHash` y el mismo `cases.hash` en su `meta.json`.
- **Palabras clave.** Se buscan por palabra completa, sin distinguir mayúsculas ni acentos: "archivo" no coincide con "archivos". Usar alternativas (`archivo|archivos`) cuando haga falta.
- **Modelos.** Los pass rates valen solo para el modelo con el que corren. Los defaults coinciden con los de producción.

---

## 8. Estructura del código

```
eval/
├── README.md                     presentación breve
├── INSTRUCCIONES.md              esta referencia
├── cli.ts                        punto de entrada
├── wizard.ts                     asistente interactivo (--menu)
├── cross.ts                      cruce del pre-chequeo con una corrida de args_review (`eval:cross`)
├── psvalid.ts                    validez PowerShell de los `command` de una corrida (`eval:psvalid`)
├── gen/                          scripts que generan casos sintéticos en datasets/
├── datasets/                     casos (.jsonl): escenarios
├── variants/                     variantes: prompts enteros (prod, una subcarpeta por etapa, plantilla)
├── results/                      salidas de cada corrida
└── core/
    ├── runner.ts                 ejecuta casos, reintentos, concurrencia
    ├── stages/                   parseo y labels de cada etapa
    ├── graders/                  checks por etapa
    ├── client/                   real, mock y oracle
    ├── variants/                 carga de variantes y lectura de las respuestas (labels.ts)
    ├── scenario.ts               arma el request de cada caso con el código de Jarvis y los prompts de la variante (importa `src/`)
    ├── questions.ts              preguntas múltiples en decisiones: parseo y checks por pregunta
    ├── scoring.ts                métricas agregadas
    ├── report.ts                 comparison.md y resumen en consola
    └── contract.ts               helpers y constantes de producción reexportados de `src/` (parseo, validación, límites)
```

`core/contract.ts` (reexportes) y `core/scenario.ts` son la vía declarada hacia `src/`, pero también importan `src/` directamente `core/config.ts` (configuración de producción), `core/runner.ts` y `core/types.ts` (pre-chequeo y tipos), `core/client/*` (configuración), `cross.ts` y `psvalid.ts`. Un archivo de prompts de una variante también puede importar `src/core/models/prompts.ts`.

## 9. Cruce con el pre-chequeo (`eval:cross`)

`npm run eval:cross -- --dataset=<a,b> [--runs=<carpeta de la corrida>] [--label=x]`. `--dataset` acepta nombres (`scenarios_args_review`), nombres con `.jsonl` o rutas a un `.jsonl` (no carpetas ni globs, a diferencia de la CLI; se busca en `eval/datasets/`). Sin `--runs` mide solo el pre-chequeo de producción sobre los casos `args_review`; con `--runs` compone cuatro tuberías con las etiquetas de D3 y compara contra `prod`/`d3` (si la corrida no tiene `prod`, avisa y la comparación queda en —). También resume D4 con el umbral de aprobación de producción (`NOUL_APPROVE`). Salida en `eval/results/_cross/<YYYY-MM-DD-HH-mm>[_<label>]/` (`cross.md`, `cross.json`).
