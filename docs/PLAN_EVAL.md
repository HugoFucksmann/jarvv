# Plan del eval

Alcance: preparar el eval para probar prompts enteros y preguntas con opciones de decisión usando el flujo con prompts inyectables. Reglas: sin tests nuevos ni modificados; cada paso se aplica por separado; el flujo (`src`) solo cambia donde se indica.

## Modelo de variantes (único)

Una variante es datos con una sola regla de composición y un solo punto de aplicación:
- `prompts`: constructores y textos de `src` (se fusionan en la cadena `a+b`; gana el último por pieza).
- Ediciones: `state`, `questions`, `criteria`, `system`, `user` (se acumulan en orden y se aplican después de armar el request).
- Lectura: `labelMap` y `answerMap`, más `params` (se fusionan; gana el último).
- Aplicación al cargar, una vez por variante y caso. En un caso por escenario: constructor de `src` con los prompts fusionados y luego las ediciones. En un caso fijo: las mismas funciones de edición sobre el request guardado; los `prompts` se ignoran con aviso. El runner solo envía.
- Un error de edición queda en el caso (`variant_apply_error`), no aborta la carga.

## Pasos

1. **Quitar la comparación de modelos y los flags `--llm-model`/`--d-model` — HECHO.** Se eliminaron `targets.ts`, la comparación de modelos de `report.ts` (tablas, `compareModels`, `printModelComparison`), la dimensión `model`/`scope` de celdas y metadatos, y las opciones de modo del asistente. `--model=<generativo>+<decisión>` acepta una sola configuración. Docs actualizadas. `tsc --noEmit` sin errores; `--list` carga.
2. **Prompts enteros (modelo de variantes único) — HECHO.**
   - `src`: exportar `parseResponse` de `decision.ts` como función, `routeDecisionOf`, `verdictOf(answers, checks = VERIFY_CHECKS)`, la validación de `pending` como función en `qwen.ts`, y los helpers y tablas de `prompts.ts` que una variante necesite (`frameLines`, `listBlock`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`).
   - eval: `PromptOverrides`, `Variant.prompts`, `effectivePrompts` en `scenario.ts`, carga por variante en `datasets.ts` y `cli.ts`, fusión en `composeParseView`, aplicación de ediciones al cargar, `prod_explicit` para comprobar que el camino nuevo da el mismo `requestHash`.
   - `labels.ts` y `questions.ts` reutilizan la validación y el veredicto de `src`.
3. **Etapa `pending` en el eval — HECHO:** registro de la etapa, `case "pending"` en `scenario.ts` con la lista anterior como parámetro, grader, `oracle` y `mock`.
4. **Prompts y datasets nuevos: los escribe otro agente** (casos por escenario de `args_review`, `arguments`, `pending` y reactivos con instrucción realista, y los archivos de prompts). Este plan no los crea.
5. **Decisión con opciones:** variantes que cambian preguntas y opciones usando las tablas de `src`; reglas de combinación probadas sobre `runs.jsonl`.

Los nombres de etapa del eval se conservan; se agrega una tabla de equivalencias con los ids de `src` (`STAGES`, `STAGE_KIND`).

## Estado del paso 2
Hecho en `src`: `parseAnswersObject`, `validateAnswer` y `parseResponse` como funciones exportadas de `decision.ts`; `parsePendingList` en `qwen.ts`; helpers y tablas de `prompts.ts` exportados. Hecho en el eval: `PromptOverrides` y `Variant.prompts`, `effectivePrompts` en `scenario.ts`, carga por variante en `cli.ts`, fusión en `composeParseView`, ediciones aplicadas al cargar (`applyVariantToCases`; el runner ya no aplica variantes), `variantApplyError` por caso, `labels.ts` y `questions.ts` validan con el código de `src`, variante `prod_explicit`. No se agregó `verdictOf(answers, checks)` ni `routeDecisionOf` exportado: el eval ya usa `NOUL_APPROVE` de `src` y no los necesita todavía.
Verificación: `tsc --noEmit` sin errores; con prompts vacíos los 96 casos por escenario dan el mismo request que la carga normal; con prompts reales cambian solo las etapas tocadas.

## Estado del paso 3
Etapa `pending` registrada en el eval: tipos (`PendingOutput`, `PendingExpect`), `expect` validado en `case.ts` (`expectEmpty`, `maxItems`, `requiredKeywordsInFirst`, `forbiddenKeywords`), `case "pending"` en `scenario.ts` con `at.previous` (solo modo reactivo), entrada de registro con la validación de `src` (`parsePendingList`), grader `graders/pending.ts`, respuestas de `oracle` y `mock`, y el runner la trata como etapa JSON (no acepta salida truncada). Docs actualizadas. No se crearon prompts ni datasets (los escribe otro agente). Verificación: `tsc --noEmit` sin errores; con un escenario en memoria el oracle da 100 %, un comando prohibido falla el check, una salida inválida falla el parseo y un `expect` contradictorio se rechaza al cargar.

## Comprobación de punta a punta
Fixtures mínimos de comprobación (`verificacion_corrida.jsonl`, `prompt_prueba.ts`, `decision_opciones.ts`): **eliminados el 2026-11-07** (ver `conclusiones.md`, sección 8).
- `--client=oracle` con las tres variantes: 100 %. Los hashes de request cambian solo en las etapas que cada variante toca.
- Corrida real (qwen3.5:4b + d3:2b): 21 runs sin errores de ejecución (cliente, parseo ni aplicación de variantes); los fallos son de calidad del modelo. Resultado: con el prompt de producción D3 etiqueta `tool_rejected` tanto el comando de Linux como el de PowerShell; con `tool_rejected` quitado etiqueta `args_invalid` el de Linux (bien) pero también el de PowerShell (mal); `os_fit` acierta 2/2 y `command_valid` falla en el de Linux. Con una sola repetición no hay conclusiones: usar `--repeat`.

## Corrección de `buildContext` (escenarios reactivos con varios pasos)
En reactivo cada paso nace `running` y el contexto admite uno solo (invariante 2), así que `buildContext` fallaba con dos o más pasos. Ahora, en reactivo, cada paso se crea, recibe sus llamadas y llega a su estado final antes de crear el siguiente; el deliberativo no cambió. Con el arreglo cargan los datasets `scenarios_pending`, `scenarios_args_review`, `scenarios_arguments` y `scenarios_reactivo` (102 casos, 100 % con `--client=oracle`). Los pasos anteriores de un escenario reactivo deben declarar un estado final (`completed` o `failed`): sin estado quedan `running` y violan la invariante.

## Candidatas para probar en JARVIS
Dos variantes que reúnen lo medido el 2026-11-07: `cand_a` (conservadora: `pending` = `pending_corto2` más regla de reescritura tras fallo, y `arguments` = `args_so_basico`; no toca decisiones) y `cand_b` (A más: regla de "cumplido tras fallo" en `pending`, equivalencia de comandos de Linux en `arguments`, y ajustes de texto en D1, D3 y D4). Cada una cambia solo las etapas que dice su encabezado (`pending`, `arguments` y, en B, `route`, `args_review` y `result_verification`); `tool_choice`, `plan`, `final` y `question` quedan igual que `prod`. Como las etapas son independientes, se elige por etapa y se pueden mezclar.

Comando de comparación (raíz del repo):
```
npm run eval -- --variant=prod,cand_a,cand_b --dataset=scenarios_pending,scenarios_arguments,scenarios_args_review,scenarios_reactivo,dificil_pending,dificil_arguments,dificil_reactivo,scenarios_chains,scenarios_messages --stages=pending,arguments,args_review,route,result_verification --repeat=3 --label=candidatas
```
Los 8 casos de `route` que esperan `fin` o `ask_user` (6 en `scenarios_chains`, 2 en `scenarios_messages`) fallan igual en las tres variantes: no cuentan para decidir.

## Resultado de las candidatas (`2026-11-07_015324_candidatas`, qwen3.5:4b + d3:2b, `--repeat=3`)
| Etapa (dataset) | prod | cand_a | cand_b |
|---|---|---|---|
| pending (scenarios_pending) | 64,7 % | 94,1 % | 98,0 % |
| pending (dificil_pending) | 74,5 % | 80,4 % | 70,6 % |
| arguments (scenarios_arguments) | 76,5 % | 94,1 % | 100 % |
| arguments (dificil_arguments) | 100 % | 100 % | 100 % |
| route (scenarios_reactivo) | 87,5 % | 87,5 % | 100 % |
| route (dificil_reactivo) | 94,4 % | 94,4 % | 100 % |
| route (scenarios_chains) | 58,3 % | 58,3 % | 58,3 % |
| args_review (scenarios_args_review) | 35 % | 35 % | 25 % |
| result_verification (scenarios_chains) | 58,3 % | 58,3 % | 66,7 % |
| result_verification (scenarios_reactivo) | 75 % | 75 % | 75 % |

Decisión por etapa: `pending` de A (la regla extra de B vació la lista en `dpen-parcial-falta-guardar` y bajó `dificil_pending`); `arguments` de B (100 %, arregla `arg-terminal-tras-ps-cmd`); D1 de B (100 % en los dos datasets reactivos; riesgo: `seq-comparar-precios-03-route`); D3 y D4 de producción (el ajuste de D3 empeoró `args_review`; el de D4 mejoró 5 casos y empeoró 3, sin mover los que apuntaba). Esa combinación es `cand_c` y **ya está promovida a producción** (2026-11-07): `PENDING_VIEW`, aclaraciones de D1 (`ROUTE_HINTS`) y la línea del sistema operativo de argumentos (`ARGUMENTS_VIEW.osLine`, generada con `UserEnvironment.platform`; el eval usa `windows` por defecto). `eval/variants/cand_c.ts` quedó vacía y es el control: debe dar Δ 0 contra `prod`. Las nuevas variantes se miden contra este `prod`. Sin resolver con prompts: `pending` no reescribe el ítem tras un fallo (`dpen-archivo-no-encontrado`, 0/3 en A, B y C; prod 2/3).


> **Referencia vigente: `conclusiones.md` (raíz).** La sección siguiente es anterior y usa el D3 con `tool_rejected`. Las variantes que cita (`cand_a`/`b`/`c`, `d3_checks*`, `pending_*`, `args_so_*`) se eliminaron el 2026-11-07: ver la sección 8 de `conclusiones.md`.

## D3 como preguntas binarias con regla en código (2026-11-07, `qwen3.5:4b` + `d3:2b`, `--repeat=3`, `scenarios_args_review`)
Variantes `d3_checks` (promedio + veto), `d3_checks_any` (rechaza si cualquiera < 0,5), `d3_checks_sincrit` (sin `criteria`). Preguntas `tool_fit`, `args_grounded`, `needs_user`; regla en `eval/core/d3_checks.ts`. Resultados: `eval/results/qwen3.5_4b/2026-11-07_030814_d3_checks_real`.

| | prod | d3_checks | d3_checks_any | d3_checks_sincrit |
|---|---|---|---|---|
| pass | 35 % | 30 % | 45 % | 30 % |

Por pregunta (media del "sí"): `needs_user` separa bien (`info_missing` 0,83 a 0,95; el resto ≤ 0,2, un caso a 0,82). `args_grounded` separa a medias (aprobadas 0,75 a 0,85; `args_invalid` 0,64 a 0,73; no detecta comandos de Linux, placeholders ni URL inventada). `tool_fit` **no sirve** con d3:2b: da 0,06 a 0,07 a comandos de PowerShell correctos (son los mismos casos que `prod` rechaza como `tool_rejected`), porque juzga el contenido y no el tipo de herramienta.

Simulación sin `tool_fit` con las respuestas guardadas (umbral de `args_grounded` 0,4, `needs_user` 0,5): 0 de 18 aprobadas rechazadas y 9 de 27 `args_invalid` detectadas en `d3_checks`. Ojo: el umbral se eligió mirando los mismos 20 casos; hace falta un dataset aparte para confirmarlo. Los 3 casos `tool_rejected` no se pueden acertar sin `tool_fit`.
