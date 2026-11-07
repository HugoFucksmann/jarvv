# Pendientes fuera del flujo

Detectados al analizar el flujo del agente. No se tocan hasta decidir. **[V]** = visto en el código.

## d3 / decisiones
- `parseResponse` (`decision.ts`): todo tipo distinto de `choice` se valida como `noul`. Hace falta un `switch` exhaustivo si se agrega `score`. [V]
- `score` está en el contrato pero no se implementa. Pendiente: formato y si se usará. [V]
- La traza queda con `input`/`output` en `null` cuando d3 responde algo inválido: `DecisionValidationError` no lleva el crudo (`llmTransport.ts`). [V]
- `buildDecisionRequest` (`decision.ts`) tipa `config` con `ReturnType<typeof import(...)>`; usar `JarvisConfig`. [V]
- Nombres: `Decision20Engine`, "Decision 2.0" en mensajes; los "D3/D4" de los comentarios son decisiones de diseño, no las decisiones d3. [V]
- `shortDesc` recorta a `MAX_TOOL_DESC_CHARS` pero el manifest ya rechaza descripciones más largas al arrancar: un solo mecanismo. [V]
- `conclusiones.md`: d3 elige `fin` de forma prematura y `args_review` aprueba casi todo. Es calibración de preguntas, lo resuelve el eval.

## Prompts
- `prompts.ts`: re-export de `Attempt` "para no romper a quien lo importa"; nadie lo importa de ahí. [V]
- `ReviewView` es `ArgsView` sin `refs` ni `effects`; derivar con `Omit`. [V]
- `adapters.ts`: el comentario de cabecera dice que solo se usan `renderArgs` y `renderAsk`, pero importa `renderPlan`. [V]

## Configuración
- `qwenMaxTokens.verify`: ninguna etapa lo lee. Está en `config.ts`, `jarvis-config.json` y `ui/types/api.ts`. [V]
- `MAX_TOOL_DESC_CHARS`: el comentario de `limits.ts` dice que Decision recorta; ya no es así. [V]

## Eval
- Plan de `plan_prompts_enteros.md` (variante con prompt entero, `PromptSet` ensanchado, rebuild al cargar el dataset): se adopta tal cual.
- Quitar la comparación de modelos (`buildTargets`, `compareModels`, `models`/`decisionModels`), también en `INSTRUCCIONES.md` y README. Hacerlo antes del plan anterior.
- `contract.ts` re-exporta `NOUL_APPROVE` desde `decision.ts`; al mover la regla a `engine/verify.ts` hay que actualizarlo (`questions.ts`, `labels.ts` también lo usan).
- `labels.ts` reimplementa la regla de `runVerification`; reutilizar `verdictOf(answers)` cuando exista.
- Comentarios obsoletos sobre `runVerification` en `labels.ts` (líneas ~8 y ~228).
- `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`. Ambos pasan `isAnswerKey`, pero conviene igualarlos.
- Quitar los flags `--llm-model` y `--d-model` (y su función de selector de etapas) al quitar la comparación de modelos; `--model` queda con un solo valor. Hay que actualizar `config.ts` (`modelScope`, `pairs`, `models`/`decisionModels`), `targets.ts` (se elimina entero), `cli.ts`, `results.ts:69-73` (nombre de carpeta), `--menu`, `INSTRUCCIONES.md` (líneas ~44, 71-94, 123, 128, 132, 243, 315) y `README.md` (líneas 5 y 17). [V]
- Plan de prompts enteros (`plan_prompts_enteros.md`): verificado contra el código, los números de línea y las firmas coinciden. Aplica a `scenario.ts`, `datasets.ts`, `types.ts` (`Variant`), `variants/load.ts`, `cli.ts` y `stageRequests.ts`. [V]
- Etapa `pending` del reactivo (cuando exista en `src`): agregarla al eval como etapa generativa (`GENERATIVE_STAGES` en `case.ts`, grader, claves `expect`, README "ocho etapas"). `scenario.ts:178-179` arma los pasos reactivos con `instruction: null`; deberá pasar `s.instruction`. [V]
- El eval no corre el flujo: rearma los requests desde las vistas (`scenario.ts`) y los envía con clientes propios (`eval/core/client/*`: `postJson`, llamada a `/v1/systemone` y a `chat/completions` reimplementados). `labels.ts` reimplementa `Decision20Engine.parseResponse`. Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Unificarlos cuando se toque el eval. [V]
- Para que una variante agregue o quite partes de un prompt de forma autónoma, `prompts.ts` debe organizarse en partes con nombre (hoy son literales dentro de `buildX` y `SYSTEM`). Decisión de estructura de prompts, no de flujo.
- Los casos del eval se pueden construir a partir de `jarvis-traces.jsonl` (cada etapa guarda `input` y `output`), en lugar de escribirlos a mano.
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa; se evalúa después.
- `ask_user` ya no es opción de D1 ni de D2 (paso 2 del plan). En el eval quedan obsoletos: `expectedAction` `ask_user` en `route` y `tool_choice` (`case.ts:140-141`, `types.ts`, `oracle.ts`, `graders/label.ts`, `stages/decision.ts`, `variants/labels.ts:167`), los casos de los datasets que lo esperan y las variantes `jarvis_alt_v4` a `v6` (agregan texto sobre `ask_user` a los prompts de ruta y herramienta). Se quitó `at.allowAsk` de `scenario.ts`. La constante `ASK_USER` quedó sin uso en `src` y solo la importa el eval (`routes.ts:18`): borrarla al refactorizar el eval. [V]
- Reactivo con lista de pendientes (paso 4 del plan). En el eval quedan obsoletos: `expectedAction` `fin` en `route` (`case.ts:140`, `types.ts:91`, `variants/labels.ts:166`, `variants/route_example.ts`) y los casos de los datasets que lo esperan; `FIN` queda sin uso en `src` y solo lo importa el eval. Se quitó `at.allowFin` de `scenario.ts`. Los escenarios reactivos ahora llevan `instruction` en el paso (`s.instruction`, por defecto la solicitud): D1, D2, argumentos, D3 y D4 ya no reciben la solicitud (`Request:`) sino la instrucción del paso (`Step:`/`TASK:`); los casos de `route`, `tool_choice`, `args_review`, `result_verification` y `arguments` en modo reactivo producen requests distintos a los de antes. Etapa nueva `pending` (`forPending`, `renderPending`, `generatePendingFromView`): falta agregarla al eval, con la lista anterior como parámetro del escenario. [V]
- Traza de "lista los 10 procesos que más RAM consuman" (reactivo): `pending` e `D1` bien (`terminal` 0.997), pero el LLM de argumentos generó `top -bn1 | sort -k4 -nr | head -n 10` con `shell: "cmd"` en Windows. `ENV` solo trae rutas (`environment.ts`) y el esquema de `start_process` no dice qué shell ni qué SO hay: el modelo adivina. Falta pasar el SO y los shells disponibles al prompt de argumentos. [V]
- Segunda prueba ("lista los 10 procesos… usa la terminal"): la lista de pendientes inventó el comando (`…usando el comando ps`) y el LLM de argumentos generó `ps aux --sort=-%mem | head -n 11` con `shell: "cmd"`; D3 rechazó cinco veces con `tool_rejected`, cada vez con más probabilidad (0.74 a 0.88). El prompt de `pending` no debe nombrar comandos ni herramientas; y en la sección "Failed attempts of this step" de D3 el estado `tool_rejected` de los intentos anteriores empuja a repetir la etiqueta (la traza lo muestra). Todo es de prompts y calibración: eval. [V]
- D3 etiquetó ese caso como `tool_rejected` (0.64 a 0.77, confianza 0.29 a 0.47) cuando el problema eran los argumentos (`args_invalid`): calibración de `args_review`, la mide el eval. [V]
- `eval/core/contract.ts` ahora define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET` (antes los reexportaba de `limits.ts`, que ya no los tiene). Cuando se refactorice el eval, usar `BUDGET` directo en `runner.ts` y `stages/generative.ts`.
