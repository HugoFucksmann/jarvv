# Cómo correr las variantes (guía de ejecución)

Comandos de referencia para correr las etapas de decisión con las variantes activas en `eval/variants/` (los nombres archivados en `_archivo_legacy/` siguen cargando si se pasan por nombre explícito en `--variant`). Para validar sintaxis y tests antes de correr modelos reales: `npx tsc --noEmit` y `npx tsx --test eval/core/eval_core.test.ts eval/auto/eval_auto.test.ts`.

## Reglas del juego

1. **Primero `dev`, después `holdout`, una sola vez.** Se compara y se elige con `dev` y `dev2`. `holdout` y `holdout2` solo se corren para confirmar a las ganadoras, una vez; si se vuelve a mirar `holdout` para ajustar, deja de servir.
2. **Sin `--repeat`.** El modelo de decisión es determinista (temperatura 0): repetir da lo mismo. Con 40 a 60 casos por dataset, **una diferencia de 1 caso es ruido**; solo cuentan diferencias de 3 o más, o que se repitan en `dev` y `dev2`. Para comparar latencias (`p50`/`p95`), usar `--concurrency=1`.
3. **Se mira más que el porcentaje.** En D4 y en continuación importan las «malas aprobadas» (aprobar lo que no debía) por separado de las «buenas rechazadas». En D0 importan los falsos `chat`.
4. **`prod` se agrega solo** como línea base. Cada variante cambia una sola cosa respecto de `prod`.
5. Hace falta Ollama con el modelo de siempre. Si no está, `--dry-run` sirve para ver el prompt, pero no mide nada. Cerrar otras aplicaciones pesadas: el modelo local se degrada si falta memoria.

Cada comando deja una carpeta `eval/results/<modelo>/<fecha>_<label>/` con `comparison.md` (la tabla) y, por celda, `runs.jsonl`. *(En etapas puras de decisión, `<modelo>` es el `decisionModel`; en generativas o mixtas, el modelo generativo.)*

## Pasada 1: `dev` y `dev2` (una etapa por vez)

### D2: elección de herramienta (descripciones y pedido original)

```powershell
npx tsx eval/cli.ts --stages=tool_choice --dataset=tool_choice_terminal_locate_dev,tool_choice_terminal_locate_dev2 --variant=tool_choice_desc_a,tool_choice_desc_b,tool_choice_desc_a_request,tool_choice_precision_criteria --concurrency=1 --label=d2_dev
```

Qué mide: si descripciones más claras (`desc_a`, `desc_b`), mostrar el pedido original (`desc_a_request`) o criterios de precisión mejoran la elección entre `run_command`, `find_files`, `list_folder` y compañía.

### D0: primera consulta (criterio de `multi` y límites de chat)

```powershell
npx tsx eval/cli.ts --stages=d0 --dataset=d0_real_usuario_dev,d0_real_usuario_dev2 --variant=d0_multi_short,d0_r1_action_axes,d0_chat_balanced --concurrency=1 --label=d0_dev
```

Después, **sin llamar a ningún modelo**, se compara cómo combinar las dos preguntas de D0:

```powershell
npx tsx eval/exp/d0_rules.ts eval/results/<modelo>/<carpeta de la corrida d0_dev>
```

### D4: verificación (`cumple`)

```powershell
npx tsx eval/cli.ts --stages=result_verification --dataset=verify_pasos_reales_dev,verify_pasos_reales_dev2 --variant=d4_cumple_has_data,d4_concise_precision,d4_precision_calibrated --concurrency=1 --label=d4_dev
```

### D1: ruta

```powershell
npx tsx eval/cli.ts --stages=route --dataset=route_pasos_reales_dev,route_pasos_reales_dev2 --variant=route_concrete_signals,route_research_aware,route_clean_hints --concurrency=1 --label=route_dev
```

### Continuación del hilo (`follow`)

```powershell
npx tsx eval/cli.ts --stages=continuation --dataset=continuation_dev,continuation_dev2 --variant=follow_examples,follow_nocriteria,follow_short,continuation_explicit_reference --concurrency=1 --label=follow_dev
```

## Pasada 2: confirmar con `holdout` (solo las ganadoras)

Se repite el comando de la etapa cambiando los datasets por `*_holdout,*_holdout2` y dejando **solo** las variantes que ganaron en `dev`. Ejemplo para D2 si ganó `desc_a`:

```powershell
npx tsx eval/cli.ts --stages=tool_choice --dataset=tool_choice_terminal_locate_holdout,tool_choice_terminal_locate_holdout2 --variant=tool_choice_desc_a --concurrency=1 --label=d2_holdout
```

Una variante se aplica a producción solo si mejora o empata en `holdout` y no empeora las «malas aprobadas». Si gana en `dev` y pierde en `holdout`, era ruido.

## Cortes de las preguntas `noul` (sin modelo)

Con corridas de `prod` ya hechas (las de la pasada 1 las incluyen) se puede medir qué pasa con cada corte:

```powershell
npx tsx eval/exp/noul_cuts.ts eval/results/<modelo>/<carpeta de la corrida>
```

Imprime, por pregunta (`ok`, `cumple`, D5, `multi`, continuación, juez de fragmentos): el porcentaje de «sí» reales por tramo de probabilidad, los errores de cada corte entre 0,10 y 0,90, y una comparación de tres juegos de cortes (producción, mejor medido, mejor medido menos 5 puntos). Opciones: `--variant=`, `--dataset=texto`, `--bucket=canonical|raw|all`, `--best-range=0.25-0.75`. Sirve también la carpeta del modelo entera para juntar varias corridas.

Cortes de producción hoy: `ok` 0,3 · `cumple` 0,6 · D5 0,75 · juez de fragmentos 0,5 · `multi` 0,5 · continuación 0,3. Un corte más bajo aprueba más; el error caro es aprobar lo malo, no rechazar lo bueno.

## Si algo no anda

| Síntoma | Qué hacer |
|---|---|
| El modelo no responde | Verificar que Ollama corre y que el modelo está descargado (`ollama list`). |
| Un caso falla en `--client=oracle` | El problema es el caso, un grader o el parseo, no el modelo: `npx tsx eval/cli.ts --client=oracle --dataset=<nombre>`. |
| Ver el prompt exacto de una variante | `npx tsx eval/cli.ts --dataset=<nombre> --variant=<variante> --ids=<caso> --dry-run` |
| `noul_cuts.ts` dice que no hay respuestas | La carpeta no tiene celdas `prod__<dataset>`; correr con `--variant=` de una que sí tenga. |

Más sobre flags, formato de datasets y cómo escribir variantes: `eval/INSTRUCCIONES.md`. Cómo decidir con los números: `eval/GUIA_DECISION.md`. Plan y motivo de cada dataset y variante: `docs/evaluacion/PLAN_DATASETS_Y_VARIANTES_2026-11-19.md`.
