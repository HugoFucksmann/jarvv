# Plan de Medición Operativo (`eval/`)

> Guía autocontenida para el agente/operador que ejecuta corridas contra modelos reales en Ollama, evalúa métricas contra `prod` y crea o descarta variantes sin pisar los archivos base del repositorio.
> Última actualización: 2026-11-16 · Referencia de diseño: [`PENDIENTES_EVAL.md`](../pendientes/PENDIENTES_EVAL.md), [`INSTRUCCIONES.md`](../../eval/INSTRUCCIONES.md) y [`INDEX.md`](../../eval/datasets/INDEX.md).

---

## 1. Requisitos previos y comprobación rápida

1. **Ollama corriendo en local:** puerto por defecto `127.0.0.1:11434`.
2. **Modelos configurados:** los lee `eval/core/config.ts` desde `jarvis-config.json` (o los defaults de `src/core/config.ts`):
   - Generativo por defecto: `qwen3.5:4b` (o `qwen3.5:4b-text` si configuraste las variantes sin proyector de visión descritas en [`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)).
   - Decisión por defecto: `d3:2b` (o `d3:2b-text`).
3. **Alineación de contexto (`num_ctx`):** Jarvis asume `16384` tokens (`qwenNumCtx` y `decisionMaxContext`). Comprobá que Ollama no arranque truncado a `4096`/`8192` (`OLLAMA_CONTEXT_LENGTH=16384` en el entorno del daemon o `PARAMETER num_ctx 16384` en el Modelfile) — pendiente §5.
4. **Comprobación previa (antes de gastar GPU):**

```bash
# 1) Verificar que Ollama responde y tiene cargados los dos modelos
curl -s http://127.0.0.1:11434/api/tags

# 2) Ver ventana real / Modelfile si hay dudas de contexto
ollama show --modelfile d3:2b

# 3) Checks offline obligatorios de salud del harness (deben pasar 100 % en segundos)
npm run lint
npm run eval:smoke
npx tsx eval/cli.ts --list
npx tsx eval/cli.ts --client=oracle
```

Si `--client=oracle` no da **100 %** en todas las celdas, **no corras modelos**: el problema es de datasets/graders y no del modelo.

> **Lo que el `oracle` no ve** (aprendido en la primera corrida, ver [`INFORME_MEDICION_2026-11-17.md`](INFORME_MEDICION_2026-11-17.md)): el `oracle` contesta con lo que dice la etiqueta, así que pasa aunque el prompt no lleve lo que el caso supone (por ejemplo, una clave de `scenario.recalled` mal escrita dejaba el caso sin memoria). Antes de medir un dataset nuevo, mirá el prompt real de un caso con `--client=mock --dry-run` y comprobá que contiene lo esperado (`MEMORY`, `PREVIOUS TASK`, etc.). Señal de alarma: **todas las variantes dan exactamente el mismo resultado**.
> - **Thinking:** el eval corre las etapas generativas **sin thinking por defecto** (`--thinking=off`: envía `reasoning_effort: "none"`), como Jarvis. Usá `--thinking=prod` o `both` solo si querés medirlo a propósito.
> - **Home ficticio:** los casos que necesitan archivos o carpetas que no existen deben usar un home ficticio (`C:\Users\Eval`). Con el home real de esta PC el pre-chequeo mira el disco y rechaza lo ficticio.
> - **Contexto real:** en esta PC Ollama corre con 8192 (variable de entorno) y `d3` con 4096 (Modelfile); ni Jarvis ni el eval envían `num_ctx`. Un prompt más largo se trunca en silencio (ver sección 4 del informe).

---

## 2. Lista ordenada de corridas

> **Convención:** ejecutá primero la Fase 0 (offline, 0 s de GPU) y luego las corridas con modelos en orden de prioridad. Todas las corridas A/B incluyen `prod` automáticamente como baseline salvo que pases `--no-baseline`. Usá `--label=<nombre>` siempre para identificar la carpeta en `eval/results/`.

### Fase 0 — Verificación offline (sin modelos)

| Orden | Qué mide y por qué | Comando exacto | Criterio de aceptación | Tiempo aprox. |
|---|---|---|---|---|
| **0.1** | Integridad de código, tipos, cargador y graders sobre los 64 datasets (1 317 casos, 12 etapas) | `npm run lint && npm run eval:smoke && npx tsx eval/cli.ts --client=oracle` | Salida `0`, `0` errores de TypeScript, **100 %** en las 64 celdas de oracle | ~8 s |
| **0.2** | Matching determinista de memoria (`selectFacts` en `src/memory/index.ts`): casos originales de `FRENTE_1_MEMORIA.md` (14 selección + 8 negativos de no-contaminación) + 10 nuevos de alias, plurales y prioridad por especificidad | `npx tsx eval/exp/memory_matching.ts` | **32/32** (`frente1_selection: 14/14`, `frente1_no_contamination: 8/8` sin contaminar —equivalente al `0/8` pedidos ajenos contaminados de `FRENTE_1_MEMORIA.md`, no una mejora—, `aliases_plurals_specificity: 10/10`) | < 2 s |
| **0.3** | Cobertura del pre-chequeo determinista de `src/core/engine/precheck.ts` sobre los datasets D3 antes de cruzar con el modelo | `npm run eval:cross -- --dataset=args_review_16_cases,args_review_gemai,args_review_gemaiL,args_review_current,args_review_jarvis_runtime,args_review_variedad --label=pre_only` | Imprime la tabla base por modo de falla y 0 falsos rechazos inesperados en aprobadas | ~3 s |

---

### Fase 1 — Calibración rápida de humo y latencia (`concurrency=1`)

| Orden | Qué mide y por qué | Comando exacto | Criterio de aceptación | Tiempo aprox. |
|---|---|---|---|---|
| **1.1** | Smoke real en vivo (10 etapas, 1 caso c/u) para verificar conexión, latencias base sin cola (`concurrency=1`) y formato real de salida | `npm run eval -- --dataset=smoke --concurrency=1 --label=calibracion_smoke` | `passRate >= 0.80` en smoke, 0 errores de transporte/timeout, p50 coherente con `OLLAMA_MODELOS_TEXTO.md` (~50 ms dec / ~250-500 ms gen en GPU) | ~15-30 s |

---

### Fase 2 — Frentes prioritarios de `PENDIENTES_EVAL.md` y Memoria (`recalled`)

> Orden sugerido por impacto directo en las decisiones pendientes de `src/`.

| Orden | Frente (`PENDIENTES_EVAL.md`) | Qué mide y por qué | Comando exacto | Datasets y variantes | Criterio de aceptación | Tiempo aprox. (modelos reales) |
|---|---|---|---|---|---|---|
| **2.1** | **Falsos cierres de D5 (§3)** | Mide la línea base `prod` vs `d5_strict_parts` (freno a falsos `sí` por copiar/parcial/objeto equivocado) y `d5_ultra_brief` (menos ruido en 2B) sobre la semilla de `close_check` y casos nuevos adversariales | `npm run eval -- --stages=d5 --dataset=d5_close_check,d5_variedad --variant=prod,d5_strict_parts,d5_ultra_brief --concurrency=1 --label=frente_d5` | `d5_close_check` (36) + `d5_variedad` (11 can + 4 raw) / `prod`, `d5_strict_parts`, `d5_ultra_brief` | `prod` >= ~85 % en `d5_close_check`; una variante candidata debe bajar FP (falsos cierres en `expectedComplete: false`) respecto a `prod` sin subir FN en condicionales ni perder en `p (signos) < 0.05` | ~15-25 s |
| **2.2** | **D3 con y sin `reviewFullView` (§1)** | Mide si agregar `Recent reads` + `Environment` (`args_review_fullview`, `args_review_fullview_clean`, `args_review_grounded_short`) mejora sobre `prod` en rutas inventadas y variedad sin subir latencia ni falsos rechazos | `npm run eval -- --stages=args_review --dataset=args_review_16_cases,args_review_gemai,args_review_gemaiL,args_review_current,args_review_jarvis_runtime,args_review_variedad --variant=prod,args_review_fullview,args_review_fullview_clean,args_review_grounded_short --concurrency=1 --label=frente_d3_fullview` | 6 datasets `args_review` (93 can + 4 raw) / `prod`, `args_review_fullview`, `args_review_fullview_clean`, `args_review_grounded_short` | Evaluar deltas y p50; solo justifica prender `reviewFullView` si supera a `prod` de forma significativa (`p < 0.05`) y reduce malas aprobadas tras cruzar con el pre-chequeo | ~40-70 s |
| **2.3** | **Cruce D3 + pre-chequeo (§1)** *(offline tras 2.2)* | Mide las tuberías reales (`d3`, `pre+d3`, `pre+d3w`, `pre`) usando los resultados de la corrida 2.2 | `npm run eval:cross -- --dataset=args_review_16_cases,args_review_gemai,args_review_gemaiL,args_review_current,args_review_jarvis_runtime,args_review_variedad --runs=<carpeta_de_2.2> --label=cruce_d3_fullview` | Los 6 datasets + `--runs` de 2.2 | Verificar cuántas malas aprueba `pre+d3` vs `d3`, tasa de falsos rechazos en aprobadas y si `pre+d3w` (solo escrituras en D3) empata o gana a `pre+d3` | < 3 s |
| **2.4** | **Memoria `recalled` en `arguments` (§6)** | Mide cómo usa el 4B `MEMORY` y `PREVIOUS TASK` inyectados por `apply` (alias, claves competidoras, seguimientos `"eso"`, rutas Windows reales) | `npm run eval -- --stages=arguments --dataset=arguments_recalled_variedad --variant=prod,args_mem_explicit,args_structured_brief --repeat=3 --concurrency=1 --label=mem_arguments` | `arguments_recalled_variedad` (12 can + 4 raw) / `prod`, `args_mem_explicit`, `args_structured_brief` | `passRate >= 0.85` en canónicos, 0 placeholders (`<user>`, `%USERPROFILE%`), 0 errores en `eval:psvalid` | ~45-90 s |
| **2.5** | **`arguments` post-refs y PowerShell (§6)** *(incluye `eval:psvalid`)* | Verifica que quitar `REFS` del prompt no haya regresado los datasets existentes y mide las variantes nuevas sobre toda la suite de argumentos | `npm run eval -- --stages=arguments --dataset=arguments_current_tools,arguments_jarvis_runtime,args_blocked_repeat,llm_arguments,llm_arguments_cmd,llm_arguments_hard,llm_arguments_extra_hard --variant=prod,args_mem_explicit,args_structured_brief --repeat=2 --concurrency=1 --label=frente_args_post_refs` | 7 datasets existentes (147 canónicos) / `prod`, `args_mem_explicit`, `args_structured_brief` | `prod` mantiene >= 90 % en `llm_arguments_cmd`; correr después `npm run eval:psvalid -- <carpeta_de_2.5>` exigiendo `>= 98 %` PS válido | ~4-8 min |
| **2.6** | **Memoria `recalled` + hilo en `final` (§6)** | Mide fidelidad exacta en `final` con `MEMORY` + `PREVIOUS TASK` sin mezclar valores viejos del hilo con `DATA` actual | `npm run eval -- --stages=final --dataset=final_recalled_variedad,final_16_cases,final_gemai,final_gemai2,final_jarvis_runtime,final_sizes --variant=prod,final_thread_grounded,final_structured_strict --repeat=3 --concurrency=1 --label=mem_final` | 6 datasets `final` (76 can + 4 raw) / `prod`, `final_thread_grounded`, `final_structured_strict` | Sin regresiones en `final_sizes` (1/1) ni `final_16_cases`; ganancia neta o empate con menor varianza en `final_recalled_variedad` | ~3-6 min |
| **2.7** | **`question/` post-`refs_unresolved` (§6)** | Mide si los 3 casos migrados de `refs_unresolved` a `info_missing` en `llm_question_gemai` y el resto de `question/` cambiaron de calidad | `npm run eval -- --stages=question --dataset=llm_question,llm_question_gemai,llm_question_hard,question_jarvis_runtime --variant=prod,question_prod_trailer2 --repeat=2 --concurrency=1 --label=frente_question` | 4 datasets `question` (90 canónicos) / `prod`, `question_prod_trailer2` | Mantener `>= 90 %` global en `prod` y verificar manualmente los 3 casos de `llm_question_gemai` que antes eran `refs_unresolved` | ~2-4 min |
| **2.8** | **`pending` variedad y `PENDING_FACTS_LOOKUP` (§2)** | Mide variedad nueva + `llm_pending_hard`/`llm_gemai` comparando `prod` contra variantes seguras de `pending` (sin encender `PENDING_FACTS_LOOKUP=true` hasta tener Opción C en `src/`) | `npm run eval -- --stages=pending --dataset=pending_variedad,pending_jarvis_runtime,llm_pending,llm_pending_hard,llm_gemai --variant=prod,pending_structured_rules,pending_facts_safe,pending_elite_labels --repeat=3 --concurrency=1 --label=frente_pending` | 5 datasets `pending` (105 can + 4 raw) / `prod`, `pending_structured_rules`, `pending_facts_safe`, `pending_elite_labels` | Sin regresiones en `pending-hard-008` (URL literal) ni `pending-hard-026`; mejorar casos con rutas con espacios/acentos y reemplazo tras `FAIL` | ~4-8 min |
| **2.9** | **`web_search`: juez de fragmentos y recencia D4 (§4)** | Mide `fragment_judge` en los 4 datasets con variantes de recencia/ranking/estrictez y el efecto de inyectar `TODAY` en D4 (`d4_web_recency`) sobre los datasets de verificación | `npm run eval -- --stages=fragment_judge --dataset=fragment_judge_gem1,fragment_judge_gem2,fragment_judge_gem_hard,fragment_judge_jarvis_runtime --variant=prod,fragment_judge_balanced,fragment_judge_strict_facts,fragment_judge_multipart_today --concurrency=1 --label=frente_web_fj` y luego `npm run eval -- --stages=result_verification --dataset=d4_current_tools,d4_verify_hard,d4_verify_variedad --variant=prod,d4_web_recency,d4_strict_scope --concurrency=1 --label=frente_web_d4` | `fragment_judge` (42) + subconjunto D4 (74 can + 4 raw) | En D4, `d4_web_recency` **no debe regresar** casos no-web respecto a `prod` antes de proponer `TODAY` para `src/` (PENDIENTES_EVAL §4 Opción A) | ~1-2 min |

---

### Fase 3 — Cobertura completa de etapas restantes (`d0`, `route`, `tool_choice`, `d4` completo, `plan`)

| Orden | Etapa | Qué mide y por qué | Comando exacto | Criterio de aceptación | Tiempo aprox. |
|---|---|---|---|---|---|
| **3.1** | `d0` | Calibración `chat` / `single` / `multi` en casos nuevos difíciles + runtime | `npm run eval -- --stages=d0 --dataset=d0_casos_ejemplo,d0_jarvis_runtime,d0_variedad --variant=prod,d0_concise_calibrated,d0_examples_balanced --concurrency=1 --label=suite_d0` | Reducir falsos `multi` sin bajar recall de `multi` real ni acercar hechos a `chat >= 0.7` | ~20-35 s |
| **3.2** | `route` | Enrutamiento en `route_variedad`, `route_context`, `route_D1_hard` y runtime (`terminal_explicit`/`goals`) | `npm run eval -- --stages=route --dataset=route_variedad,route_context,route_D1_hard,route_jarvis_runtime,route_16_cases,route_gemai --variant=prod,route_structured_hints,route_lean_direct --concurrency=1 --label=suite_route` | Mantener `route_context` (incluido `rt-ctx-10`) >= 90 % y mejorar casos ambiguos sin perder `files` vs `locate` vs `terminal` | ~30-50 s |
| **3.3** | `tool_choice` | Desempate de herramientas en `tool_choice_variedad` y datasets actuales | `npm run eval -- --stages=tool_choice --dataset=tool_choice_variedad,tool_choice_current,tool_choice_jarvis_runtime,tool_choice_16_cases --variant=prod,tool_choice_structured,tool_choice_direct_nofail --concurrency=1 --label=suite_tool_choice` | >= 90 % canónico; verificar desempates `move_file`/`copy_file`, `edit_file`/`write_file` | ~15-30 s |
| **3.4** | `result_verification` completo | Barrido completo D4 (10 datasets, 225 can + 4 raw) para confirmar que `d4_strict_scope` o `d4_web_recency` no regresan nada | `npm run eval -- --stages=result_verification --dataset=eval/datasets/d4/*.jsonl --variant=prod,d4_strict_scope,d4_web_recency --concurrency=1 --label=suite_d4_full` | 0 regresiones significativas vs `prod`, mejora neta en `verify_copy_move` y `d4_verify_variedad` | ~1.5-2.5 min |
| **3.5** | `plan` | Línea base + estabilidad de planes deliberativos | `npm run eval -- --stages=plan --dataset=plan_16_cases,plan_gemai,plan_jarvis_runtime --variant=prod,plan_adaptive,plan_effects_grounded --repeat=2 --concurrency=1 --label=suite_plan` | `passRate >= 0.85`, uso correcto de `EFFECTS` y `user_feedback` | ~2-4 min |
| **3.6** | **Aplazada, no correr sin decisión del equipo:** medición de `--thinking=both` (opcional §5) | Impacto real de `thinking=on` vs `thinking=off` en `final` y `plan` (calidad vs latencia) | `npm run eval -- --stages=final --dataset=final_recalled_variedad,final_16_cases --thinking=both --repeat=2 --concurrency=1 --label=thinking_final` | Solo justificar `thinking=on` si el delta en `passRate` compensa el costo en p50/p95 | ~2-4 min |

---

## 3. Cómo evaluar e interpretar los resultados

### Dónde se guardan
- Corridas reales: `eval/results/<modelo-generativo>/<YYYY-MM-DD_HHmmss>[_<label>]/`
  - `comparison.md`: reporte legible con resumen por variante, resumen por tipo (decisión vs generativa), regresiones, mejoras, casos `raw` (`isRaw` y `prod_shortcut`) y matrices de confusión.
  - `comparison.json`: los mismos datos estructurados.
  - `<variante>__<dataset>/`:
    - `runs.jsonl`: traza por ejecución (prompt enviado, respuesta cruda, `parsedOutput`, errores de cada check, latencia, tokens).
    - `scores.json`: métricas agregadas de la celda.
    - `meta.json`: commit git, `datasetHash`, `cases.hash`, `variantHash`, filtros y configuración usada.
- Corridas auxiliares: `eval/results/_oracle/`, `eval/results/_mock/`, `eval/results/_cross/`.

### Reglas para comparar una variante contra `prod`
1. **Comparabilidad:** dos celdas de corridas distintas **solo** son comparables si coinciden en modelos, `thinking`, `datasetHash` y `cases.hash` en `meta.json`. Para A/B limpio, corré `prod` y la variante **juntas** en el mismo comando.
2. **Ruido vs señal real:**
   - En etapas generativas (`plan`, `arguments`, `final`, `question`, `pending`), `prod` fluctúa **±3 puntos** entre corridas con `repeat=1`. Nunca decidas con `repeat=1` ni con < 15–30 casos. Usá `--repeat=3` en datasets chicos (`< 25` casos) o `>= 40` casos agregados.
   - Mirá siempre **`p (signos)`** (test exacto de signos sobre pares discordantes por caso): para alcanzar `p < 0.05` sin ninguna regresión hacen falta al menos **6 mejoras netas sin regresiones** (`6/0`, `p = 0.031`). Si hay regresiones, exigí aún más margen (`8/1`, `p = 0.039`, etc.).
   - Si el resumen muestra **Resultado mixto** (mejora decisión y empeora generativas, o viceversa), evaluá cada modelo por separado: nunca mezcles ambos para aprobar un prompt.
   - Mirá `Macro por etapa` además de `passRate`: `passRate` global pondera más las etapas con más casos (como `route` con 279 casos vs `d5` con 51).
3. **Qué métricas mirar por etapa:**
   - **Etapas de decisión** (`d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`):
     - `passRate` canónico (excluye `isRaw` y `prod_shortcut`), `accuracy`, matriz de confusión (`FP` vs `FN` — en D3 mirá cuántas *malas aprobadas* quedan y en D5 cuántas *incompletas* pasan `>= 0.75`), y probabilidad por pregunta (`min_probability_met`, `max_probability_met`).
     - En `args_review`, cruzá siempre con `npm run eval:cross -- --runs=...`.
   - **Etapas generativas** (`plan`, `arguments`, `final`, `question`, `pending`):
     - `passRate` canónico, `passAll` (porcentaje que pasa en todas las repeticiones cuando `--repeat > 1`), columna **`Reintentos`** (mide cuánto falló el primer intento antes del retry automático) y `eval:psvalid` en `arguments`.
   - **Adversariales (`isRaw: true`):** se reportan aparte del `passRate` canónico para que no distorsionen el promedio, pero debés inspeccionar sus fallos: sirven para detectar regresiones por inyección `<obs>`, placeholders, rutas con espacios/acentos o mezcla de datos del hilo.
   - **Latencias:** solo válidas con `--concurrency=1`. Si un grupo tiene `< 20` llamadas, el p95 equivale al máximo (marcado con `†`, suele incluir carga en frío): compará **p50**.

---

## 4. Cómo crear una variante nueva a partir de un resultado

### Dónde guardarla (sin pisar archivos del repositorio)
Para mantener limpias las variantes base del repo, creá todas las variantes experimentales generadas durante la campaña bajo una subcarpeta dedicada:
- **Ruta recomendada:** `eval/variants/runner/run_<etapa>_<hipotesis>.ts` (por ejemplo `eval/variants/runner/run_d5_no_copy_shortcut.ts`).
- **Regla estricta de `load.ts`:** el nombre base del archivo (sin `.ts`) **debe ser único en todo `eval/variants/`** y coincidir exactamente con `name` en el `export default`. Como usás el prefijo `run_`, nunca va a colisionar con las carpetas existentes.

### Paso a paso
1. **Inspeccionar el fallo real:** abrí `<variante>__<dataset>/runs.jsonl` del caso que falló, o ejecutá `npm run eval -- --dataset=<ds> --ids=<id> --variant=prod --dry-run` para ver el prompt exacto que recibió el modelo.
2. **Formular una hipótesis concreta:** identificá qué regla faltó, sobró o generó ambigüedad (un cambio medible por vez).
3. **Escribir la variante con prompts enteros:**
   - Para etapas generativas (`ARGUMENTS_VIEW`, `FINAL_VIEW`, `PENDING_VIEW`, `PLAN_VIEW`, `QUESTION`), extendé el objeto de `PROMPTS` conservando `buildUserPrompt` (y `buildSystemPrompt` / `osLine` en `ARGUMENTS_VIEW`) salvo que estés probando precisamente el layout del usuario.
   - Para etapas de decisión (`buildCompletionCheck`, `buildArgsReview`, `buildResultVerification`, `buildFirstQuery`, `buildRouteChoice`, `buildToolChoice`, `buildFragmentJudge`), reimplementá la función completa en `DECISION_PROMPTS`.
   - Documentá en la línea 1 del archivo la hipótesis en un comentario `// Hipótesis: ...`.
4. **Validar sintaxis y carga antes de correr modelos:**
   ```bash
   npm run lint
   npx tsx eval/cli.ts --list   # debe mostrar tu variante run_* sin errores
   ```
5. **Medir contra `prod`:** corré siempre `--variant=prod,<tu_variante>` sobre el dataset objetivo y, si mejora con `p < 0.05`, volvé a correr sobre los datasets completos de la etapa (y reservá al menos un dataset de la etapa que no miraste para ajustar el prompt como *holdout* antes de proponer el cambio a `src/`).

### Criterio de promoción vs descarte
- **Promover a `src/` (solo recomendándolo en reporte; este plan no edita `src/`):** mejora neta consistente (`p (signos) < 0.05`), sin regresiones en el holdout ni deterioro > ~15 % en p50 de latencia, y mejoras verificadas tras `--repeat=3` en generativas.
- **Iterar:** mejora en un subconjunto pero introduce regresiones claras o latencia alta → refinar en `eval/variants/runner/`.
- **Descartar:** `Δ <= 0` o diferencia dentro del ruido (`±3` puntos con `p > 0.2`) tras repetir.

---

## 5. Qué requiere cambios en `src/` antes de poder medirse

> Las pruebas siguientes **NO** se pueden medir de punta a punta solo con variantes o datasets en `eval/` porque hoy el código de `src/` no las cablea o las tiene detrás de flags globales sin exposición por variante:

1. **`recalled` en `pending` y `plan` (`user_memory`):** habilitar `user_memory` en `src/core/recalledPolicy.ts` por sí solo no hace que `pending` ni `plan` vean `recalled`, porque `PendingView` y `PlanView` no tienen esa sección ni sus renderizadores la muestran. Lo que falta en `src/` es: (a) agregar `recalled` a `PendingView`, `PlanView` y sus opciones (`PendingViewOptions` / `PlanViewOptions`), (b) mostrarlo en `src/core/render/pending.ts` y `src/core/render/plan.ts`, y (c) habilitar esas vistas en `src/core/recalledPolicy.ts` con un interruptor. *(Nota: el hilo `thread` en `pending` **sí** funciona ya en producción —`runTask.ts` + `engine/pending.ts` con `withThread` + `PROMPTS.PENDING_VIEW`— y el eval ya lo replica en `eval/core/stages/pending.ts` pasando `{ ...pendingInput(ctx, at.previous ?? []), ...(thread ? { thread } : {}) }` desde `scenario.recalled.thread` sin cambios en `src/`.)*
2. **Etapa formal de `continuation` (`DECISION_PROMPTS.buildContinuation`):** `CONTINUATION_APPROVE = 0.3` y el constructor existen en `src/core/engine/thread.ts` y `src/core/models/prompts.ts`, pero aún no tienen etapa formal ni datasets dedicados en `eval/` (hoy solo hay mediciones históricas en `FRENTE_1_MEMORIA.md`).
3. **Opción C de `PENDING_FACTS_LOOKUP` (`PENDIENTES_EVAL.md` §2):** la compuerta determinista (léxica + D0 `chat` en zona intermedia cuando `pending` devuelve `[]`) no está implementada en `src/core/engine/runTask.ts`. Medir `PENDING_FACTS_LOOKUP = true` en eval ya demostró regresiones en `llm_pending_hard`.
4. **Flags globales de `jarvis-config.json` (`completionCoverageGuard`, `reviewFullView`, `reviewReads`):**
   - `reviewFullView` ya tiene su réplica exacta en la variante `args_review_fullview`, pero **`completionCoverageGuard`** (cierre D5 con verificación determinista de nombres de archivo en `src/core/engine/completion.ts`) y **`reviewReads`** (pasar lecturas por D3 en `src/core/engine/callRunner.ts`) actúan en el motor y requieren correr tareas reales end-to-end / trazas con el flag encendido en `jarvis-config.json` (no se ejercen por el prompt aislado de `eval/`).
5. **`web_search` multiparte (Opción B) y recencia (Opciones B/C + `TODAY` en D4):** la degradación de `found` a `partial` por cobertura de términos (`stemsOf`), las guardas de fecha en `webSearchProvider.ts` y la inyección condicional de `TODAY` en `verify.ts` / `prompts.ts` todavía no existen en `src/`. En `eval/` hoy solo se puede medir D4 con el prototipo `d4_web_recency` (para probar cero regresiones si se suma `TODAY`).
6. **Conversor de trazas reales (`jarvis-traces/` → `.jsonl`):** pendiente en `PENDIENTES_EVAL.md` §6 para convertir sesiones reales capturadas en producción en escenarios reproducibles del eval.
