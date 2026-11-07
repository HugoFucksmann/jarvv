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
Fixtures mínimos (se pueden borrar o reemplazar; los prompts y datasets reales los escribe otro agente): `eval/datasets/verificacion_corrida.jsonl` (7 casos por escenario: `pending`, `route`, `args_review`, `arguments`, `result_verification`), `eval/variants/prompt_prueba.ts` (prompts enteros de `pending`, `arguments` y `args_review`) y `eval/variants/decision_opciones.ts` (quita `tool_rejected` de `args_review` y agrega las preguntas `os_fit` (choice) y `command_valid` (noul)).
- `--client=oracle` con las tres variantes: 100 %. Los hashes de request cambian solo en las etapas que cada variante toca.
- Corrida real (qwen3.5:4b + d3:2b): 21 runs sin errores de ejecución (cliente, parseo ni aplicación de variantes); los fallos son de calidad del modelo. Resultado: con el prompt de producción D3 etiqueta `tool_rejected` tanto el comando de Linux como el de PowerShell; con `tool_rejected` quitado etiqueta `args_invalid` el de Linux (bien) pero también el de PowerShell (mal); `os_fit` acierta 2/2 y `command_valid` falla en el de Linux. Con una sola repetición no hay conclusiones: usar `--repeat`.
