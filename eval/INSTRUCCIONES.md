# Guía de Uso del Framework de Evaluación (`eval/prompts`)

Documentación y referencia de comandos para ejecutar el nuevo framework de evaluación de prompts y modelos (generativos y de decisión).

---

## 1. Script Principal

El punto de entrada unificado es:

```bash
npx tsx eval/prompts/cli.ts [flags]
```

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
| `--model` | String | `qwen3.5:4b` | Nombre del modelo generativo (ej: Ollama / vLLM / OpenAI compatible). |
| `--url` | URL | `http://127.0.0.1:11434` | Endpoint base del servidor para modelos generativos. |
| `--decision-backend`| `d3` | `d3` | Obsoleto, se mantiene solo por compatibilidad con scripts: acepta únicamente `d3` (Ollama). El backend `eos` fue eliminado; `--decision-backend=eos` da error. El campo `backend` de los casos solo admite `"d3"` y se ignora. |
| `--decision-model` | String | `d3:2b` | Nombre del modelo de decisión. |
| `--decision-url` | URL | `http://127.0.0.1:11434` | Endpoint del servidor de decisión (se le agrega `/v1/systemone`). |
| `--client` | `real` \| `mock` \| `oracle` | `real` | `mock` devuelve respuestas genéricas sin red (prueba la maquinaria). `oracle` responde lo que pide el `expect` de cada caso: debe dar 100 %; si un caso falla, el bug está en el caso, un grader o el parseo, no en el modelo. Solo vale con la variante `prod` (no entiende `labelMap`/`answerMap`). |

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

Si ya existe una carpeta con ese nombre (dos corridas en el mismo segundo) se agrega `-2`, `-3`… En Windows, los caracteres inválidos del modelo, la etiqueta y las celdas se reemplazan por `_`. Un mismo `runId` identifica todas las celdas de una invocación y `meta.timestamp` es ISO 8601.

Dentro del directorio se genera:
- `<variante>__<dataset>/`:
  - `runs.jsonl`: Registro detallado de cada ejecución individual (request exacto, salida, graders, latencia, tokens).
  - `scores.json`: Métricas agregadas de la celda (pass rate, accuracy, latencias, `clientFailedRuns`). Los runs cuya llamada falló (red, timeout, HTTP) cuentan como falla en el pass rate pero **no** entran en las latencias ni aparecen como regresión/mejora en `comparison.md`; la CLI avisa cuántos fueron. La accuracy cuenta un parseo fallido como error (`(sin predicción)` en la matriz de confusión).
  - `meta.json`: Configuración de la corrida, commit de Git, hashes de dataset y variante. `gitDirty` ignora `eval/prompts/results/`.
- `comparison.md`: Reporte markdown comparando variantes contra el `baseline` (`prod`).
- `comparison.json`: Resumen numérico comparativo en formato JSON.

### Códigos de salida
| Código | Significado |
|---|---|
| `0` | Corrida correcta (y umbral cumplido, si se pidió). |
| `1` | Alguna celda quedó por debajo de `--min-pass-rate`. |
| `2` | Error de configuración, dataset inválido, filtros que no dejan casos, ninguna corrida canónica, todas las llamadas fallaron por el cliente (red, timeout o HTTP), o `--dry-run` con alguna variante que no se pudo aplicar. |

### Datasets (`.jsonl`)
- Una línea por caso; las líneas vacías y las que empiezan con `#` se ignoran.
- `expect` se valida con lista cerrada de claves por etapa: una clave desconocida, un `expect` sin ningún check o un valor inválido es error de carga (`archivo:línea: mensaje`). También se rechazan: rutas que no son ejecutables (`expectedRoute`, `firstRoute`, `allowedRoutes`, `requiredRoutes`), probabilidades fuera de 0–1, `minSteps` > `maxSteps`, `exactFieldValues` vacío y `minOkProb`/`minCumpleProb` con el veredicto esperado en `false`.
- Los textos (`mustContainFacts`, keywords, etc.) se buscan por palabra o frase completa, sin distinguir mayúsculas ni acentos; un número no coincide dentro de otro (`12` no está en `12.5`, `12.000` ni `120`).
- Etapa `arguments`: el caso debe traer `meta.toolSchema`; sin él falla (producción siempre valida contra el schema).
- Los globs soportan `*`, `**` y `?` (no `{a,b}`).
- `datasets/decision_discriminating.jsonl` tiene casos de decisión donde la respuesta correcta **no** es la primera opción (`fin`, `ask_user`, `args_invalid`, `ok=false`…). Sirve para detectar sesgo de posición.

### Qué cuenta como "pasó"
Un run pasa solo si no registró ningún error: llamada al cliente, aplicación de variante, parseo de la salida y todos los checks de los graders. Si la variante no se puede aplicar, el run falla sin llamar al modelo. Un caso donde ningún grader ejecuta checks falla (`graders_ran_checks`). Si el caso pide `minProbability`, la salida debe traer la probabilidad; si no la trae, falla.

### Reintentos (iguales a producción)
- **Transporte** (todas las etapas): ante error de red o HTTP 503 se reintenta una vez tras 1 s. El timeout es un presupuesto total que incluye el reintento y nunca se reintenta.
- **Salida inválida o truncada** (solo `plan`, `arguments`, `final`, `question`): un reintento con `ERROR_PREVIO` agregado al `user`, 1.5× `maxTokens` y temperatura 0.3. En `final` el reintento va sin thinking. En `final` y `question` una salida truncada en el último intento se acepta, aunque `not_truncated` igual la marca. Las etapas de decisión no tienen este reintento.
- El run guarda `measurements.attempts` y un warning por cada reintento. `durationMs` y los tokens suman todos los intentos. Los mensajes de error del reintento son los del eval, que pueden diferir en el texto de los de producción.

---

## 4. Ejemplos de Uso

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
> Nota: el mock devuelve respuestas genéricas (primera opción, `"Mock response."`), por lo que `smoke-args`, `smoke-final` y `smoke-question` fallan con él (5/8 en `smoke.jsonl`; 0/10 en `decision_discriminating.jsonl`, donde ninguna respuesta correcta es la primera opción). Sirve para probar la maquinaria, no para validar prompts.
```bash
npx tsx eval/prompts/cli.ts --client=mock --dataset=eval/prompts/datasets/smoke.jsonl
```

### Evaluar etapa específica (ej: solo `plan`) con modelo real
```bash
npx tsx eval/prompts/cli.ts --stages=plan --dataset=eval/prompts/datasets/smoke.jsonl --model=qwen3.5:4b
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

