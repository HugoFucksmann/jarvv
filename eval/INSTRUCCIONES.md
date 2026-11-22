# Eval: comandos y flags

Siempre desde la raíz del repo. Explicaciones en [`REFERENCIA.md`](./REFERENCIA.md).

## Para tener a mano

```bash
# Ver etapas, variantes y datasets disponibles
npx tsx eval/cli.ts --list

# Ver el prompt de un caso sin llamar al modelo
npx tsx eval/cli.ts --dataset=smoke --variant=prod --ids=smoke-route --dry-run

# Validar casos y graders sin modelo (debe dar 100 %)
npx tsx eval/cli.ts --client=oracle --dataset=route_v1 --stages=route

# Medir una etapa con los modelos de jarvis-config.json
npx tsx eval/cli.ts --dataset=route_v1 --stages=route --label=base

# Comparar variantes contra prod
npx tsx eval/cli.ts --dataset=route_v1 --stages=route --variant=prod,route_v2

# Medir con repeticiones (modelos generativos)
npx tsx eval/cli.ts --dataset=pending_v1 --stages=pending --repeat=3 --concurrency=1

# Cambiar de modelo
npx tsx eval/cli.ts --dataset=route_v1 --stages=route --decision-model=d3:4b-text

# Optimizar una etapa con --auto
npm run eval:auto -- --stage=route --max-loops=3 --target=0.95 --optimizer-model=qwen3.5:4b

# Optimizar con holdout, partiendo de prod y mejorándolo
npm run eval:auto -- --stage=route --max-loops=4 --target=0.95 --optimizer-model=qwen3.5:4b --holdout=route_v1_holdout --holdout-margin=0.05 --mode=improve --base=prod

# Optimizar varias etapas seguidas (decisión primero, mismos --max-loops y --target)
npm run eval:auto -- --stage=decision --max-loops=3 --target=0.95 --optimizer-model=qwen3.5:4b --holdout=auto

# Menú interactivo
npm run eval:menu
```

## Comandos

| Comando | Equivale a |
|---|---|
| `npm run eval -- [flags]` | `npx tsx eval/cli.ts [flags]` |
| `npm run eval:auto -- [flags]` | `npx tsx eval/auto.ts [flags]` (también `npm run eval -- --auto [flags]`) |
| `npm run eval:menu` | `npx tsx eval/cli.ts --menu` |
| `npm run eval:smoke` | `npx tsx eval/cli.ts --client=mock --dataset=eval/datasets/smoke.jsonl --dry-run` |
| `npm run eval:cross -- [flags]` | `npx tsx eval/cross.ts [flags]` |
| `npm run eval:psvalid -- <carpeta>` | `npx tsx eval/psvalid.ts <carpeta>` |
| `npm run eval:traces -- [flags]` | `npx tsx eval/traces.ts [flags]` |

Sintaxis: `--flag=valor`, o `--flag` para los booleanos. Un flag desconocido, repetido, sin valor o con valor vacío termina con código `2`.

## `eval` (`eval/cli.ts`)

### Exploración
| Flag | Descripción |
|---|---|
| `--list` | Lista etapas, variantes y datasets. |
| `--menu` | Asistente interactivo. |
| `--help` | Resumen de uso. |
| `--dry-run` | Imprime el prompt de cada caso sin llamar a modelos. |

### Datasets y filtros
| Flag | Default | Descripción |
|---|---|---|
| `--dataset` | `eval/datasets/` | CSV de archivos `.jsonl`, carpetas o globs (`*`, `**`, `?`). Alcanza con el nombre (`--dataset=route_v1`). |
| `--stages` | todas | CSV de etapas. |
| `--tags` | — | Solo casos con esos tags. |
| `--ids` | — | Solo casos con esos IDs. |
| `--limit` | sin límite | Máximo de casos por dataset (entero ≥ 1). |
| `--include-shortcut` | `false` | Cuenta los casos `prod_shortcut` en el `passRate` canónico. |

### Variantes
| Flag | Default | Descripción |
|---|---|---|
| `--variant` | `prod` | CSV de variantes de `eval/variants/`. Agrega `prod` como baseline. |
| `--baseline` | `prod` | Variante base de la comparación (debe estar en `--variant`). |
| `--no-baseline` | — | No agrega `prod`; la baseline pasa a ser la primera o la de `--baseline`. |

### Modelos
| Flag | Default | Descripción |
|---|---|---|
| `--model` | de `jarvis-config.json` | `<generativo>[+<decisión>]`; un lado vacío usa su default (`--model=+lfm3:1.7b`). |
| `--decision-model` | de `jarvis-config.json` | Modelo de decisión. |
| `--generative-model` | de `jarvis-config.json` | Modelo generativo. |
| `--url` | `http://127.0.0.1:11434` | Endpoint del generativo. |
| `--decision-url` | `http://127.0.0.1:11434` | Endpoint del de decisión. |
| `--client` | `real` | `mock`: respuestas genéricas sin red. `oracle`: responde lo que pide `expect` (solo con `prod`). |

### Ejecución
| Flag | Default | Descripción |
|---|---|---|
| `--thinking` | `off` | `off`, `prod` (como producción), `on` o `both` (cada caso dos veces). |
| `--timeout` | 120000 gen / 180000 con thinking / 30000 dec | Timeout por petición, en ms. |
| `--concurrency` | `3` | Peticiones simultáneas (entero ≥ 1). Usar `1` para medir latencias. |
| `--repeat` | `1` | Repeticiones por caso. |

### Resultados
| Flag | Descripción |
|---|---|
| `--label` | Sufijo de la carpeta de resultados. |
| `--min-pass-rate` | Entre `0.0` y `1.0`. Si alguna celda que no sea la baseline queda por debajo, sale con código `1`. |

### Códigos de salida
| Código | Significado |
|---|---|
| `0` | Corrida correcta (y umbral cumplido, si se pidió). `--dry-run` siempre termina con `0`. |
| `1` | Alguna celda por debajo de `--min-pass-rate`. |
| `2` | Error de configuración o de carga, o todas las llamadas fallaron. |

## `eval:auto` (`eval/auto.ts`)

Obligatorios: `--stage`, `--max-loops`, `--target`, `--optimizer-model`.

| Flag | Default | Descripción |
|---|---|---|
| `--stage` | — | Una etapa, varias separadas por coma, o `all`, `decision`, `generative`. Con varias corren en serie (decisión primero) y no admiten `--dataset`, `--seed-top`, `--base` ni `--ledger`. |
| `--max-loops` | — | Vueltas máximas (entero ≥ 1). |
| `--target` | — | Puntaje a alcanzar, en `(0, 1]`. |
| `--optimizer-model` | — | Modelo que propone variantes. |
| `--optimizer-url` | `http://127.0.0.1:11434` | Endpoint del optimizador. |
| `--optimizer-api-key-env` | — | Variable de entorno con el token del optimizador. |
| `--optimizer-timeout` | `120000` | Timeout del optimizador, en ms. |
| `--optimizer-thinking` | `off` | `off` u `on`. |
| `--mode` | `rewrite` | `rewrite`: textos nuevos. `improve`: mejora un texto base. |
| `--base` | mejor de la Vuelta 0 | Solo con `improve`: variante base inicial. |
| `--dataset` | todos los de la etapa, sin smoke ni holdout | CSV de datasets de trabajo. |
| `--holdout` | — | CSV de datasets ocultos para confirmar. Con varias etapas: `--holdout=auto` (los `*_holdout*.jsonl` de cada etapa). |
| `--holdout-margin` | — | Con `--holdout`: confirma si supera a `prod` por este margen (ej. `0.10`) en vez de llegar a `--target`. |
| `--metric` | `passRate` | `passRate` o `macroPassRate`. |
| `--seed-top` | — | Hasta 2 variantes iniciales (`v1,v2`). |
| `--ledger` | `eval/variants/_auto/<etapa>/ledger.jsonl` | Historial de ideas probadas. |
| `--archive-losers` | `true` | Mueve las perdedoras a `descartadas/`. |

Los flags de modelos evaluados y de ejecución son los de `eval`: `--decision-model`, `--generative-model`, `--model`, `--url`, `--decision-url`, `--repeat`, `--concurrency`, `--thinking`, `--timeout`, `--client` (`real` o `mock`) e `--include-shortcut`.

| Código | Significado |
|---|---|
| `0` | Una variante distinta de `prod` alcanzó `--target` (y confirmó el holdout, si se indicó). Con varias etapas: todas lo alcanzaron. |
| `1` | Se agotó `--max-loops` sin alcanzar `--target`. Con varias etapas: alguna no lo alcanzó (las demás siguen corriendo). |
| `2` | Error de configuración, de datasets o de transporte. Con varias etapas corta la corrida. |

## `eval:cross` (`eval/cross.ts`)

| Flag | Descripción |
|---|---|
| `--dataset` | Datasets `args_review` (nombres o rutas a `.jsonl`; no carpetas ni globs). |
| `--runs` | Carpeta de una corrida de `args_review` para cruzar con sus resultados. |
| `--baseline` | Variante base de la comparación (default `prod`). |
| `--label` | Sufijo de la carpeta de salida. |
| `--help` | Resumen de uso. |

## `eval:psvalid` (`eval/psvalid.ts`)

`npm run eval:psvalid -- <carpeta de la corrida>`: mide cuántos `command` de una corrida de `arguments` son PowerShell válido.

## `eval:traces` (`eval/traces.ts`)

| Flag | Default | Descripción |
|---|---|---|
| `--input` | `jarvis-traces` | Carpeta de trazas, carpeta de una tarea o `trace.json`. |
| `--out` | `eval/traces_export` | Archivo `.jsonl` o carpeta de salida. |
| `--stages` | todas | CSV de etapas. |
| `--task` | — | Solo tareas cuyo nombre o id contenga alguno de estos textos. |
| `--limit` | — | Máximo de `trace.json` a procesar. |
| `--dedupe` | `true` | Deduplica por escenario. |
| `--anonymize` | `false` | Reemplaza rutas de usuario por `usuario`. |
| `--use-full` | `true` | Usa `full.json.gz` si existe junto a `trace.json`. |
| `--dry-run` | — | Valida y resume sin escribir. |
| `--help` | — | Resumen de uso. |
