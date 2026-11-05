# Guía de Uso del Framework de Evaluación (`eval/prompts`)

Documentación y referencia de comandos para ejecutar el nuevo framework de evaluación de prompts y modelos (generativos y de decisión).

---

## 1. Script Principal

El punto de entrada unificado es:

```bash
npx tsx eval/prompts/cli.ts [flags]
```

Atajos de `package.json`: `npm run eval -- [flags]` (equivale a lo anterior) y `npm run eval:smoke` (`smoke` con el mock en `--dry-run`, sin modelos).

Al iniciar, la CLI imprime un bloque **Configuración** con los modelos y URLs, la concurrencia, las repeticiones, el thinking, el timeout, las variantes, la baseline, los datasets (con cantidad de casos), las etapas y los filtros. No se imprime en `--dry-run`.

> **Sintaxis de flags:** `--flag=valor` para valores y `--flag` (o `--flag=false`) para booleanos. Es error de configuración (código 2): un flag no reconocido, repetido, sin valor o con valor vacío (`--model=`), o un número que no sea un entero/decimal simple (`--limit=1e3`, `--min-pass-rate=.9`; usar `0.9`). Una lista CSV que queda vacía (`--stages=,`) también es error. Ejecutar siempre desde la raíz del repo: las rutas por defecto son relativas al cwd.

---

## 2. Flags Disponibles

### Exploración y Modo Rápido
| Flag | Tipo | Descripción |
|---|---|---|
| `--list` | Booleano | Muestra las etapas registradas, variantes disponibles en `eval/prompts/variants/` y datasets por defecto, finalizando inmediatamente. |
| `--dry-run` | Booleano | Carga la configuración, datasets y variantes pero no invoca a los modelos ni evalúa. |

### Datasets y Filtros
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--dataset` | CSV de rutas / glob / carpetas | `eval/prompts/datasets/` | Archivos `.jsonl`, directorios o globs a evaluar (ej: `--dataset=eval/prompts/datasets/smoke.jsonl`). |
| `--stages` | CSV de etapas | *(todas)* | Filtra por etapas específicas (válidas: `plan`, `arguments`, `final`, `question`, `route`, `tool_choice`, `args_review`, `result_verification`). |
| `--tags` | CSV de etiquetas | *(ninguno)* | Evalúa solo casos que contengan los tags especificados. |
| `--ids` | CSV de IDs | *(ninguno)* | Evalúa solo casos con los IDs exactos indicados. |
| `--limit` | Entero $\ge 1$ | *(sin límite)* | Cantidad máxima de casos a cargar por dataset. |
| `--include-shortcut` | Booleano | `false` | Los casos con tag `prod_shortcut` (decisión con una sola opción) **se ejecutan siempre**, pero sin este flag se reportan en el bucket `raw`, fuera del `passRate` canónico. Con el flag cuentan como canónicos. |

### Variantes y Baseline (Pruebas A/B)
| Flag | Tipo / Formato | Default | Descripción |
|---|---|---|---|
| `--variant` | CSV de variantes | `prod` | Nombres de variantes en `eval/prompts/variants/`. Permite composición con `+` (ej: `--variant=prod,route_example` o `--variant=varA+varB`). `prod` siempre se incluye como baseline de comparación. Con composición (`prod+x`) se agrega igualmente `prod` como spec propia. |
| `--baseline` | String | `prod` | Variante tomada como base para la comparación de métricas (delta/diff). Debe coincidir exactamente con una de las specs de `--variant`; si no, error de configuración. |

### Modelos y Conexión (Generativos y Decisión)
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
`eval/prompts/results/<modelo>/<YYYY-MM-DD_HHmmss>[_<label>]/`

`<modelo>` es el modelo generativo, o el de decisión con `--d-model`; con varios los nombra a todos separados por `+` (`modA+modB`). Con varias configuraciones de `--model` cada una figura como `<llm>~<decisión>`.

Si ya existe una carpeta con ese nombre (dos corridas en el mismo segundo) se agrega `-2`, `-3`… En Windows, los caracteres inválidos del modelo, la etiqueta y las celdas se reemplazan por `_`. Un mismo `runId` identifica todas las celdas de una invocación y `meta.timestamp` es ISO 8601.

Dentro del directorio se genera:
- `<variante>__<dataset>/` (con varios modelos: `<variante>__<dataset>__gen-<modelo>` o `__dec-<modelo>`, una por modelo):
  - `runs.jsonl`: Registro detallado de cada ejecución individual (request exacto, salida, graders, latencia, tokens). En las decisiones, `questions` trae una entrada por cada pregunta del request (ver "Decisiones con varias preguntas").
  - `scores.json`: Métricas agregadas de la celda (pass rate, accuracy, latencias, `clientFailedRuns`). Los runs cuya llamada falló (red, timeout, HTTP) cuentan como falla en el pass rate pero **no** entran en las latencias ni aparecen como regresión/mejora en `comparison.md`; la CLI avisa cuántos fueron. La accuracy cuenta un parseo fallido como error (`(sin predicción)` en la matriz de confusión).
  - `meta.json`: Configuración de la corrida, commit de Git, hashes de dataset y variante. `gitDirty` ignora `eval/prompts/results/`. `scope` indica qué cubre la celda (`all`, `generative` o `decision`); el modelo que la celda no usa figura como `null`.
- `comparison.md`: Reporte markdown comparando variantes contra la baseline (`prod`). Secciones: **Resumen por variante** (una fila por variante: passRate agregado, Δ vs baseline, regresiones, mejoras, fallas de cliente, p50), resumen por etapa, deltas, regresiones, mejoras y matrices de confusión. Con varios modelos agrega la sección **Comparación entre Modelos** (tabla global y por etapa con deltas contra la referencia, accuracy por pregunta y casos donde los modelos discrepan) y la tabla por variante trae una fila por modelo. Con decisiones de varias preguntas agrega **Preguntas por Etapa**. Todo se imprime también en consola.
- `comparison.json`: Lo mismo en formato JSON (`variants`, `cells`, `deltas`, `regressions`, `improvements`, `modelComparisons`, `warnings`).

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
- **Scoring** (`scores.json` y `comparison.md`, solo en etapas con 2 o más preguntas evaluadas): por pregunta, accuracy, matriz de confusión y, por clase, TP/FP/FN, precisión y recall; y `questionCross`, que cruza cada par de preguntas (ambas bien, solo A, solo B, ambas mal). En `noul` la clase positiva es `yes`. En consola, las preguntas sí/no muestran FP/FN y las demás muestran la cantidad de errores.
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
- Los textos (`mustContainFacts`, keywords, etc.) se buscan por palabra o frase completa, sin distinguir mayúsculas ni acentos; un número no coincide dentro de otro (`12` no está en `12.5`, `12.000` ni `120`).
- Etapa `arguments`: el caso debe traer `meta.toolSchema`; sin él falla (producción siempre valida contra el schema).
- Los globs soportan `*`, `**` y `?` (no `{a,b}`).
- `datasets/decision_discriminating.jsonl` tiene casos de decisión donde la respuesta correcta **no** es la primera opción (`fin`, `ask_user`, `args_invalid`, `ok=false`…). Sirve para detectar sesgo de posición.

---

## 5. Ejemplos de Uso

### Listar etapas y variantes disponibles
```bash
npx tsx eval/prompts/cli.ts --list
```

### Validar casos y graders con el oráculo (sin servidor/GPU)
```bash
npx tsx eval/prompts/cli.ts --client=oracle --dataset=eval/prompts/datasets/smoke.jsonl
```
Esperado: 100 %. Cualquier falla indica un caso o grader mal escrito.

### Ejecución de humo con mock (sin requerir servidor/GPU)
> Nota: el mock devuelve respuestas genéricas (primera opción, `"Mock response."`), por lo que `smoke-args`, `smoke-final` y `smoke-question` fallan con él (5/9 runs en `smoke.jsonl`; 0/10 en `decision_discriminating.jsonl`, donde ninguna respuesta correcta es la primera opción). Sirve para probar la maquinaria, no para validar prompts.
```bash
npx tsx eval/prompts/cli.ts --client=mock --dataset=eval/prompts/datasets/smoke.jsonl
```

### Evaluar etapa específica (ej: solo `plan`) con modelo real
```bash
npx tsx eval/prompts/cli.ts --stages=plan --dataset=eval/prompts/datasets/smoke.jsonl --llm-model=qwen3.5:4b
```

### Comparar una variante contra producción (A/B testing)
```bash
npx tsx eval/prompts/cli.ts --variant=prod,route_example --stages=route --dataset=eval/prompts/datasets/smoke.jsonl
```

### Comparar impacto de Thinking (`both` = on y off)
```bash
npx tsx eval/prompts/cli.ts --stages=final --thinking=both --limit=10
```

### Corrida en paralelo con repeticiones para verificar consistencia
```bash
npx tsx eval/prompts/cli.ts --concurrency=4 --repeat=3 --label=consistency_check
```

### Verificación de umbral para CI/CD
```bash
npx tsx eval/prompts/cli.ts --dataset=eval/prompts/datasets/smoke.jsonl --min-pass-rate=0.90
```

