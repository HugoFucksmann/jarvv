# Guía de Uso del Framework de Evaluación (`eval`)

Documentación y referencia completa del framework de evaluación de prompts y modelos (generativos y de decisión). Versión 1.0. Para una presentación breve, ver [`README.md`](./README.md).

---

## 1. Script Principal

El punto de entrada unificado es:

```bash
npx tsx eval/cli.ts [flags]
```

Atajos de `package.json`: `npm run eval -- [flags]` (equivale a lo anterior) y `npm run eval:smoke` (`smoke` con el mock en `--dry-run`, sin modelos).

Al iniciar, la CLI imprime un bloque **Configuración** con los modelos y URLs, la concurrencia, las repeticiones, el thinking, el timeout, las variantes, la baseline, los datasets (con cantidad de casos), las etapas y los filtros. No se imprime en `--dry-run`.

> **Sintaxis de flags:** `--flag=valor` para valores y `--flag` (o `--flag=false`) para booleanos. Es error de configuración (código 2): un flag no reconocido, repetido, sin valor o con valor vacío (`--model=`), o un número que no sea un entero/decimal simple (`--limit=1e3`, `--min-pass-rate=.9`; usar `0.9`). Una lista CSV que queda vacía (`--stages=,`) también es error. Ejecutar siempre desde la raíz del repo: las rutas por defecto son relativas al cwd.

### Etapas evaluadas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión | `route` | Ruta elegida (`files`, `web`, `fin`, `ask_user`…) y su probabilidad |
| Decisión | `tool_choice` | Herramienta elegida o `ask_user` |
| Decisión | `args_review` | `approved`, `args_invalid`, `tool_rejected` o `info_missing` |
| Decisión | `result_verification` | Veredictos `ok` y `cumple` |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, refs válidos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |

Cada corrida ejecuta **variante × dataset × caso × repetición**.

---

## 2. Flags Disponibles

### Exploración y Modo Rápido
| Flag | Tipo | Descripción |
|---|---|---|
| `--list` | Booleano | Muestra las etapas registradas, variantes disponibles en `eval/variants/` y datasets por defecto, finalizando inmediatamente. |
| `--menu` | Booleano | Asistente interactivo: elige modo (`--d-model`, `--llm-model` o `--model`), modelos, datasets, origen de los casos (`--source`), variantes (prod siempre se incluye), etapas y opciones avanzadas; muestra el comando equivalente y, tras confirmar, lo ejecuta. También `npm run eval:menu`. Necesita terminal interactiva. |
| `--help` | Booleano | Resumen breve de uso. |
| `--dry-run` | Booleano | Carga la configuración, datasets y variantes pero no invoca a los modelos ni evalúa. |

### Datasets y Filtros
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--dataset` | CSV de rutas / glob / carpetas | `eval/datasets/` | Archivos `.jsonl`, directorios o globs a evaluar. Basta el nombre: `--dataset=smoke` (o `smoke.jsonl`, o `decision_*`) se busca en `eval/datasets/`; una ruta que existe se respeta tal cual. |
| `--stages` | CSV de etapas | *(todas)* | Filtra por etapas específicas (válidas: `plan`, `arguments`, `final`, `question`, `route`, `tool_choice`, `args_review`, `result_verification`). |
| `--tags` | CSV de etiquetas | *(ninguno)* | Evalúa solo casos que contengan los tags especificados. |
| `--source` | `frozen` \| `scenario` | *(ambos)* | Distingue el origen del contexto de los casos: `frozen` = prompt escrito a mano en el dataset (contexto inventado); `scenario` = armado con el código de Jarvis desde un escenario (ver "Casos por escenario"). Sin el flag corren ambos. |
| `--ids` | CSV de IDs | *(ninguno)* | Evalúa solo casos con los IDs exactos indicados. |
| `--limit` | Entero $\ge 1$ | *(sin límite)* | Cantidad máxima de casos a cargar por dataset. |
| `--include-shortcut` | Booleano | `false` | Los casos con tag `prod_shortcut` (decisión con una sola opción) **se ejecutan siempre**, pero sin este flag se reportan en el bucket `raw`, fuera del `passRate` canónico. Con el flag cuentan como canónicos. |

### Variantes y Baseline (Pruebas A/B)
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--variant` | CSV de variantes | `prod` | Nombres de variantes en `eval/variants/`. Permite composición con `+` (ej: `--variant=prod,route_example` o `--variant=varA+varB`). `prod` siempre se incluye como baseline de comparación. Con composición (`prod+x`) se agrega igualmente `prod` como spec propia. |
| `--baseline` | String | `prod` | Variante tomada como base para la comparación de métricas (delta/diff). Debe coincidir exactamente con una de las specs de `--variant`; si no, error de configuración. |
| `--no-baseline` | Booleano | — | No agrega `prod` a las variantes: corre solo las que indiques en `--variant` (obligatorio). La baseline pasa a ser la primera variante, o la de `--baseline` si la pasas. No hay deltas contra `prod`; con dos o más variantes, se comparan contra la primera. Ejemplo: `--variant=jarvis_alt_v2 --no-baseline`. |

### Modelos y Conexión (Generativos y Decisión)

Los modelos y URLs por defecto salen de la configuración de producción (`jarvis-config.json`; sin ese archivo, sus valores por defecto: `qwen3.5:4b` y `d3:2b` en Ollama local). Así el eval mide por defecto lo que corre Jarvis. Los valores de la tabla son esos defaults.
| Flag | Tipo / Opciones | Default | Descripción |
|---|---|---|---|
| `--model` | `<llm>[+<decisión>]`, CSV | `qwen3.5:4b+d3:2b` | **Modo común: todas las etapas.** Cada elemento es una configuración: modelo generativo y, tras `+`, el de decisión. Un lado vacío usa su default (`--model=modA` = `modA` + `d3:2b`; `--model=+lfm3:1.7b` = `qwen3.5:4b` + `lfm3:1.7b`). Con varios (`--model=a+x,b+y`) se comparan las configuraciones completas. Excluyente con `--llm-model` y `--d-model`. |
| `--llm-model` | CSV de modelos | `qwen3.5:4b` | Modelo(s) generativo(s) (ej: Ollama / vLLM / OpenAI compatible). **Corre solo las etapas generativas** y apaga las de decisión. Con varios (`--llm-model=modA,modB`) se compara cada uno contra los demás: ver "Comparar modelos". Excluyente con `--model` y `--d-model`. |
| `--url` | URL | `http://127.0.0.1:11434` | Endpoint base del servidor para modelos generativos. |
| `--d-model` | CSV de modelos | `d3:2b` | Modelo(s) de decisión (ej: `--d-model=d3:2b,lfm3:1.7b`). **Corre solo las etapas de decisión** y apaga las generativas. Excluyente con `--model` y `--llm-model`. |
| `--decision-url` | URL | `http://127.0.0.1:11434` | Endpoint del servidor de decisión (se le agrega `/v1/systemone`). |
| `--client` | `real` \| `mock` \| `oracle` | `real` | `mock` devuelve respuestas genéricas sin red (prueba la maquinaria). `oracle` responde lo que pide el `expect` de cada caso: debe dar 100 %; si un caso falla, el bug está en el caso, un grader o el parseo, no en el modelo. Solo vale con la variante `prod` (no entiende `labelMap`/`answerMap`). |

### Comparar modelos
`--model`, `--llm-model` y `--d-model` son **excluyentes** (combinar dos o más es error de configuración). Cada uno define qué corre:

| Flags | Modelos | Etapas que corren |
|---|---|---|
| ninguno | `qwen3.5:4b` + `d3:2b` (defaults) | todas |
| `--model=<llm>[+<d>]` | esa configuración (generativo + decisión) | todas |
| `--llm-model=a[,b…]` | solo los generativos | `plan`, `arguments`, `final`, `question` |
| `--d-model=x[,y…]` | solo los de decisión | `route`, `tool_choice`, `args_review`, `result_verification` |

Con `--llm-model` o `--d-model`, un `--stages` explícito del otro tipo es error de configuración (ej. `--d-model=x --stages=plan`); sin `--stages` se corren todas las etapas del tipo elegido. Con `--model`, `--stages` filtra como siempre, y si deja solo etapas de un tipo el modelo del otro no se usa.

Con más de un elemento en la lista, la misma variante y el mismo dataset se corren contra cada uno en una sola ejecución y se comparan entre sí:

- Cada caso se ejecuta una vez por elemento y en cada celda hay un solo modelo (o una sola configuración con `--model`).
- El primer elemento de la lista es la **referencia**: los deltas (passRate, accuracy, p50, p95) son contra él.
- Si un modelo no responde, sus runs cuentan como falla de cliente; la corrida solo termina con código `2` si fallaron **todas** las llamadas de todos los modelos.
- La baseline de variantes se empareja por modelo: cada modelo se compara contra `prod` consigo mismo.
- `--min-pass-rate` se evalúa por celda, es decir, por modelo.
- Usar `--concurrency=1` para comparar latencias.
- La comparación incluye lo propio de cada tipo de modelo:
  - **Decisión:** accuracy, `P(correcta)` (probabilidad media que el modelo da a la opción correcta), `Brier` (error cuadrático medio de las probabilidades; 0 = perfecto, menor es mejor), `Errores seguros` (errores con probabilidad ≥ 80 % en la opción equivocada; solo en `route`, `tool_choice` y `args_review`), accuracy por pregunta y aciertos por clase esperada (solo las clases donde algún modelo se equivoca).
  - **Generativo:** reintentos por salida inválida y checks fallidos por etapa (por qué falla cada modelo).

### Parámetros de Ejecución
| Flag | Tipo / Opciones | Default | Descripción |
|---|---|---|---|
| `--thinking` | `auto` \| `prod` \| `on` \| `off` \| `both` | `auto` | Política de razonamiento/thinking. `both` corre cada caso dos veces (con y sin thinking) para comparar el impacto. |
| `--timeout` | Entero (ms) | `120000` (gen) / `180000` (thinking) / `30000` (dec) | Timeout por petición en milisegundos. |
| `--concurrency` | Entero $\ge 1$ | `1` | Cantidad de peticiones simultáneas. Con valores > 1 las **latencias no son comparables** (incluyen espera del servidor, p. ej. `OLLAMA_NUM_PARALLEL`); usar `1` para medir latencia. Pass/fail no se ve afectado. |
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

`<modelo>` es el modelo generativo, o el de decisión con `--d-model`; con varios los nombra a todos separados por `+` (`modA+modB`). Con varias configuraciones de `--model` cada una figura como `<llm>~<decisión>`.

Si ya existe una carpeta con ese nombre (dos corridas en el mismo segundo) se agrega `-2`, `-3`… En Windows, los caracteres inválidos del modelo, la etiqueta y las celdas se reemplazan por `_`. Un mismo `runId` identifica todas las celdas de una invocación y `meta.timestamp` es ISO 8601.

Dentro del directorio se genera:
- `<variante>__<dataset>/` (con varios modelos: `<variante>__<dataset>__gen-<modelo>` o `__dec-<modelo>`, una por modelo):
  - `runs.jsonl`: Registro detallado de cada ejecución individual (request exacto, salida, graders, latencia, tokens). En las decisiones, `questions` trae una entrada por cada pregunta del request (ver "Decisiones con varias preguntas").
  - `scores.json`: Métricas agregadas de la celda (pass rate, accuracy, latencias, `clientFailedRuns`). Los runs cuya llamada falló (red, timeout, HTTP) o cuya variante no se pudo aplicar cuentan como falla en el pass rate pero **no** entran en las latencias ni aparecen como regresión/mejora en `comparison.md`; los deltas comparan solo casos medidos en ambos lados y el reporte avisa si alguno quedó afuera. `latencySamples` indica cuántas llamadas hay detrás de las latencias: con 0, no hay dato aunque figure 0. La accuracy se calcula sobre las decisiones con respuesta y cuenta un parseo fallido como error (`(sin predicción)` en la matriz de confusión).
  - `meta.json`: Configuración de la corrida, commit de Git, hashes de dataset y variante. `gitDirty` ignora `eval/results/`. `scope` indica qué cubre la celda (`all`, `generative` o `decision`); el modelo que la celda no usa figura como `null`. `filters` (`tags`, `ids`, `source`, `limit`) y `cases` (cantidad y hash de los ids) dicen qué subconjunto del dataset corrió la celda: `datasetHash` es el del archivo completo, así que dos celdas solo son comparables si tienen el mismo `cases.hash`. `promptEnv` (fecha y hash de la configuración de etapas) explica por qué cambió el `requestHash` de un caso por escenario entre corridas aunque `src` sea el mismo.
- `comparison.md`: Reporte markdown comparando variantes contra la baseline (`prod`). Secciones: **Resumen por variante** (una fila por variante y tipo de etapas —generativo y decisión, y un total mezclado cuando hay ambos, con la columna Tipo—: passRate agregado, Δ vs baseline, passRate macro por etapa, regresiones, mejoras, prueba de signos, runs sin medir, reintentos si los hubo, p50; si una variante mejora un tipo y empeora el otro agrega el aviso **Resultado mixto**, porque el total no sirve para decidir), resumen por etapa con las variantes lado a lado (el delta contra la baseline va entre paréntesis), regresiones, mejoras, casos raw y matrices de confusión. Con varios modelos agrega la sección **Comparación entre Modelos** (tabla global y por etapa con deltas contra la referencia, accuracy por pregunta y casos donde los modelos discrepan) y la tabla por variante trae una fila por modelo. Con decisiones de varias preguntas agrega **Preguntas por Etapa**. La consola muestra el resumen por variante, el resumen por etapa (una línea por variante, con sus deltas), la comparación de modelos, las preguntas por etapa y las regresiones y mejoras (también las de casos raw); las matrices de confusión y las tablas completas quedan solo en `comparison.md`.
- `comparison.json`: Lo mismo en formato JSON (`variants`, `cells`, `deltas`, `regressions`, `improvements`, `rawRegressions`, `rawImprovements`, `modelComparisons`, `warnings`).

### Decisiones con varias preguntas
Un request de decisión puede llevar varias preguntas (las del caso más las que agrega una variante con `addQuestions`) para cruzarlas en una sola pasada, por ejemplo para detectar falsos positivos y falsos negativos.

- **Parseo por pregunta**: cada pregunta se parsea por separado. Una respuesta mal formada afecta solo a esa pregunta (`error` en su entrada), no a las demás.
- **Registro sin pisarse**: `runs.jsonl` trae `questions`, indexado por la clave de la pregunta. Cada entrada tiene `type`, `role` (`main` = alimenta la salida canónica de la etapa; `extra` = adicional), `answer`, `probabilities` o `noul`, `expected` y `correct`. En `noul`, `answer` es `yes` o `no` (> 0.5). La principal usa la etiqueta canónica (con `labelMap`); `rawAnswer` guarda la opción tal como respondió el modelo.
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
- **Oráculo**: responde las preguntas adicionales según `expect.answers`.

### Códigos de salida
| Código | Significado |
|---|---|
| `0` | Corrida correcta (y umbral cumplido, si se pidió). |
| `1` | Alguna celda quedó por debajo de `--min-pass-rate`. |
| `2` | Error de configuración, dataset inválido, filtros que no dejan casos, ninguna corrida canónica, todas las llamadas fallaron por el cliente (red, timeout o HTTP), o `--dry-run` con alguna variante que no se pudo aplicar. |

### Qué cuenta como "pasó"
Un run pasa solo si no registró ningún error: llamada al cliente, aplicación de variante, parseo de la salida y todos los checks de los graders. Si la variante no se puede aplicar, el run falla sin llamar al modelo. Un caso donde ningún grader ejecuta checks falla (`graders_ran_checks`). Si el caso pide `minProbability`, la salida debe traer la probabilidad; si no la trae, falla.

### Reintentos (iguales a producción)
- **Transporte** (todas las etapas): ante error de red o HTTP 503 se reintenta una vez tras 1 s. El timeout es un presupuesto total que incluye el reintento y nunca se reintenta.
- **Salida inválida o truncada** (solo `plan`, `arguments`, `final`, `question`): un reintento con `ERROR_PREVIO` agregado al `user`, 1.5× `maxTokens` y temperatura 0.3. En `final` el reintento va sin thinking. En `final` y `question` una salida truncada en el último intento se acepta, aunque `not_truncated` igual la marca. Las etapas de decisión no tienen este reintento.
- El run guarda `measurements.attempts` y un warning por cada reintento. `durationMs` y los tokens suman todos los intentos. Los mensajes de error del reintento son los del eval, que pueden diferir en el texto de los de producción.

---

## 4. Datasets (`.jsonl`)

- Una línea por caso; las líneas vacías y las que empiezan con `#` se ignoran.
- `expect` se valida con lista cerrada de claves por etapa: una clave desconocida, un `expect` sin ningún check o un valor inválido es error de carga (`archivo:línea: mensaje`). También se rechazan: rutas que no son ejecutables (`expectedRoute`, `firstRoute`, `allowedRoutes`, `requiredRoutes`), probabilidades fuera de 0–1, `minSteps` > `maxSteps`, `exactFieldValues` vacío y `minOkProb`/`minCumpleProb` con el veredicto esperado en `false`.
- Los textos (`mustContainFacts`, keywords, etc.) se buscan por palabra o frase completa, sin distinguir mayúsculas ni acentos; un número no coincide dentro de otro (`12` no está en `12.5`, `12.000` ni `120`). Un término admite alternativas con `|` (`archivo|archivos` coincide con cualquiera de las dos; `\|` es un `|` literal); en las listas de lo prohibido, basta con que aparezca una.
- Etapa `arguments`: el caso debe traer `meta.toolSchema`; sin él falla (producción siempre valida contra el schema).
- Los globs soportan `*`, `**` y `?` (no `{a,b}`).
- `datasets/decision_discriminating.jsonl` tiene casos de decisión donde la respuesta correcta **no** es la primera opción (`fin`, `ask_user`, `args_invalid`, `ok=false`…). Sirve para detectar sesgo de posición.


### Formato de un caso

Un caso es una línea de un `.jsonl` en `eval/datasets/`.

```json
{"id":"smoke-route","stage":"route","tags":["smoke"],
 "request":{"type":"decision","state":"Request: list the files in the project",
   "questions":{"route":{"type":"choice","instructions":"Pick the next route.",
     "criteria":{"files":"Read or write files","web":"Browse the web","fin":"Task is done","ask_user":"Need more info"}}}},
 "expect":{"expectedAction":"route","expectedRoute":"files"}}
```

| Campo | Descripción |
|---|---|
| `id` | Único dentro del dataset |
| `stage` | Una de las ocho etapas |
| `request` | Lo que se envía al modelo: `decision` (`state` + `questions`) o `generative` (`system` + `user` + parámetros). Alternativa: `scenario` (ver abajo) |
| `expect` | Lo que debe cumplir la salida. Claves cerradas por etapa; un typo falla al cargar con `archivo:línea` |
| `tags`, `description` | Opcionales. Los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del `passRate` canónico |
| `meta.toolSchema` | **Obligatorio en `arguments`**: schema real de la herramienta, para validar como producción |

Un request de decisión puede llevar varias preguntas y `expect.answers` fija la respuesta esperada de las adicionales (ver [Decisiones con varias preguntas](#decisiones-con-varias-preguntas)). Los casos de decisión con una sola opción se etiquetan solos como `prod_shortcut` (ver `--include-shortcut`).

Datasets de ejemplo en `eval/datasets/`: `smoke` (una pasada por todas las etapas), `decision_discriminating` (la respuesta correcta no es la primera opción), `scenarios_messages` (casos por escenario que prueban los mensajes fijos de `ctx/views/messages.ts`).

### Casos por escenario (`scenario`)

En vez de `request` (el prompt ya armado), un caso puede traer `scenario`: la situación de la tarea y el punto de decisión. El `request` se arma **al cargar** con el código de Jarvis (`ctx.view.*` → `engine/adapters.ts` → `reasoner/prompts.ts` y `reasoner/stageRequests.ts`), así que los mensajes fijos de `ctx/views/messages.ts`, los topes de `BUDGET`, los renderizadores y los parámetros de cada etapa (tokens, thinking, schema) son los de producción y se actualizan solos cuando cambian en `src/`.

- Un caso lleva `request` **o** `scenario`, nunca los dos. El resto (`id`, `stage`, `expect`, `tags`…) es igual.
- `scenario`: `mode` (`reactive` | `deliberative`), `request` (la solicitud del usuario), `steps`, `calls` (con su `status`, `args`, `summary`, `verdict`, `ref`), `facts`, `userInput` (respuestas previas del usuario), `finish` (cierre, para `final`) y `at` (parámetros del punto de decisión: `routes`, `route`, `tools`, `tool`, `inputSchema`, `args`, `call`, `feedback`, `environment`). Los tipos están en `core/scenario.ts`.
- Las herramientas se nombran como en el manifest de Jarvis (`SYSTEM_TOOL_MANIFEST`): la descripción sale de ahí; el schema de entrada (`at.inputSchema`) lo pone el caso, porque el del servidor MCP no es estático.
- El escenario se valida con las reglas reales del contexto (`apply`): un escenario imposible (p. ej. cierre `completed` sin llamada aprobada) es error de carga `archivo:línea: scenario: …`.
- Los prompts dependen del código de `src/` y de `jarvis-config.json` (tokens por etapa) y de la fecha (`TODAY`); `requestHash` de cada run permite detectar que cambió el prompt entre corridas, y `meta.json` guarda el commit.
- Todas las entradas se arman con las mismas funciones que el motor (`engine/adapters.ts`: `planInput`, `renderArgsView`, `argsInput`, `routeInput`, `toolInput`, `reviewInput`, `verifyInput`), así que no hay lógica duplicada que mantener.
- `datasets/scenarios_messages.jsonl` cubre los mensajes de `messages.ts` (status `info_missing`, `tool_rejected`, `user_rejected`, `args_invalid`, `not_found`, `no_data`, `denied`, y cierres `partial` / `failed`). Sus `expect` son una primera propuesta: conviene revisarlos.

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
> Nota: el mock devuelve respuestas genéricas (primera opción, `"Mock response."`), por lo que `smoke-args`, `smoke-final` y `smoke-question` fallan con él (5/9 runs en `smoke.jsonl`; 0/10 en `decision_discriminating.jsonl`, donde ninguna respuesta correcta es la primera opción). Sirve para probar la maquinaria, no para validar prompts.
```bash
npx tsx eval/cli.ts --client=mock --dataset=eval/datasets/smoke.jsonl
```

### Evaluar etapa específica (ej: solo `plan`) con modelo real
```bash
npx tsx eval/cli.ts --stages=plan --dataset=eval/datasets/smoke.jsonl --llm-model=qwen3.5:4b
```

### Comparar una variante contra producción (A/B testing)
```bash
npx tsx eval/cli.ts --variant=prod,route_example --stages=route --dataset=eval/datasets/smoke.jsonl
```

### Comparar impacto de Thinking (`both` = on y off)
```bash
npx tsx eval/cli.ts --stages=final --thinking=both --limit=10
```

### Corrida en paralelo con repeticiones para verificar consistencia
```bash
npx tsx eval/cli.ts --concurrency=4 --repeat=3 --label=consistency_check
```

### Separar casos con contexto inventado de los de contexto real
```bash
npx tsx eval/cli.ts --source=scenario
```
```bash
npx tsx eval/cli.ts --source=frozen
```
`scenario` corre solo los casos armados con el código de Jarvis desde un escenario (por ejemplo `scenarios_messages`); `frozen`, solo los que traen el prompt escrito a mano. `--list` indica cuántos casos de cada dataset son por escenario.

### Verificación de umbral para CI/CD
```bash
npx tsx eval/cli.ts --dataset=eval/datasets/smoke.jsonl --min-pass-rate=0.90
```

---

## 6. Escribir una variante

Una variante es un archivo en `eval/variants/<nombre>.ts` que edita el request en memoria, solo durante la corrida (no modifica `src` ni los casos). El `name` debe coincidir con el archivo y `prod` es la identidad.

```ts
import type { Variant } from "../core/variants/types.ts";

const concise_plan: Variant = {
  name: "concise_plan",
  generative: {
    plan: {
      user: { append: "\n\nUse the fewest steps possible." },
      params: { temperature: 0.2 },
    },
  },
  decision: {
    route: {
      questions: {
        route: { instructions: { append: "\n\nPrefer web when the user asks to look something up." } },
      },
    },
  },
};

export default concise_plan;
```

Para decisiones también se puede editar `state`, cambiar o quitar criterios (`criteria: { set, remove, append }`), reemplazar una pregunta y renombrar opciones con `labelMap`. Un ejemplo completo está en `variants/route_example.ts`. Se corren con `--variant=prod,concise_plan` y se pueden componer con `+` (`--variant=varA+varB`).

---

## 7. Interpretar los resultados

- **Latencia y concurrencia.** Con `--concurrency` mayor que 1, p50 y p95 incluyen espera del servidor y no son comparables. Usar `1` para medir latencia; el pass/fail no se ve afectado.
- **p95 con pocas muestras.** Con menos de 20 llamadas el p95 es el máximo, que suele ser la carga en frío del modelo. Se marca con `†` y no se publica su delta; comparar con p50. El total mezclado no muestra p50 porque combina etapas de milisegundos y de segundos. Las latencias generativas suman los reintentos.
- **Casos sin medir.** Una llamada fallida (red, timeout, HTTP) o una variante que no se pudo aplicar cuenta como falla en `passRate`, pero no entra en las latencias ni aparece como regresión o mejora. Δ compara solo casos medidos en ambos lados, y el reporte avisa si alguno quedó afuera.
- **Unidad de comparación.** Δ, regresiones, mejoras y la prueba de signos se calculan **por caso**: con `--repeat`, las repeticiones de un caso no cuentan como muestras independientes (un caso que pasa 2 de 3 es distinto de uno que siempre falla).
- **Reintentos.** El `pass` se mide después del reintento "como producción", que puede esconder cuánto falla el modelo crudo: la columna `Reintentos` cuenta los runs que lo necesitaron.
- **Costo.** Los tokens por etapa están en la tabla por etapa y en la comparación de modelos; con `--thinking=both`, `final[think=on]` y `final[think=off]` van en filas separadas para comparar su costo.
- **Sobreajuste al dataset.** Iterar variantes contra el mismo dataset con el que se miden acaba premiando el ruido. Conviene reservar un dataset aparte (holdout) que no se use al iterar y correrlo solo para validar una variante antes de pasarla a `src`.
- **Ruido.** Un Δ no es un veredicto: mirar `p (signos)`, calculado sobre los casos que cambiaron. Con menos de 6 cambios nunca baja de 0.05. Las etapas generativas varían entre corridas con el mismo request: usar `--repeat` antes de decidir por pocos casos.
- **Tipos de etapas.** El total mezcla etapas de decisión y generativas, que corren modelos distintos. Si una variante mejora un tipo y empeora el otro, el reporte avisa **Resultado mixto**: decidir con el desglose por tipo.
- **Peso de las etapas.** `passRate` pesa cada etapa según su cantidad de casos, y `final` corre dos veces con `--thinking=auto`. `Macro por etapa` pesa todas por igual y cuenta `final[think=on/off]` como una sola: si ambos difieren, el resultado depende de la composición del dataset.
- **Casos escritos a mano vs. por escenario.** Los casos con `request` guardan el prompt tal como se escribió: si cambian los prompts de producción, el eval compara contra esa foto, no contra `src` en vivo, y su contexto es inventado (`--source=frozen`). Los casos por escenario (`--source=scenario`) se arman con `src` en cada carga: miden el prompt actual, pero un cambio en `src`, en `jarvis-config.json` (tokens por etapa) o en la fecha (`TODAY`) cambia el request; `requestHash` de cada run permite detectarlo.
- **Comparar corridas.** Cada corrida compara solo las celdas que ejecutó. Dos celdas son comparables si tienen el mismo `datasetHash` y el mismo `cases.hash` en su `meta.json`.
- **Palabras clave.** Se buscan por palabra completa, sin distinguir mayúsculas ni acentos: "archivo" no coincide con "archivos". Usar alternativas (`archivo|archivos`) cuando haga falta.
- **Variantes con `labelMap`.** Dos opciones que se mapeen al mismo nombre canónico se pisan entre sí; evitarlo.
- **Modelos.** Los pass rates valen solo para el modelo con el que corren. Los defaults coinciden con los de producción.

---

## 8. Estructura del código

```
eval/
├── README.md                     presentación breve
├── INSTRUCCIONES.md              esta referencia
├── cli.ts                        punto de entrada
├── wizard.ts                     asistente interactivo (--menu)
├── datasets/                     casos (.jsonl): con request fijo o por escenario
├── variants/                     variantes de prompt (prod, route_example, …)
├── results/                      salidas de cada corrida
└── core/
    ├── runner.ts                 ejecuta casos, reintentos, concurrencia
    ├── stages/                   parseo y labels de cada etapa
    ├── graders/                  checks por etapa
    ├── client/                   real, mock y oracle
    ├── variants/                 carga y aplicación de variantes
    ├── scenario.ts               casos por escenario: arma el request con el código de Jarvis (importa `src/`)
    ├── targets.ts                reparto de modelos en pasadas (comparación entre modelos)
    ├── questions.ts              preguntas múltiples en decisiones: parseo y checks por pregunta
    ├── scoring.ts                métricas agregadas
    ├── report.ts                 comparison.md y resumen en consola
    └── contract.ts               helpers de producción copiados (parseo, validación, límites)
```

Solo `core/scenario.ts` importa `src/`; el resto del eval es independiente de él.
