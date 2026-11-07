# Pendientes

Lo que sigue abierto después del refactor del flujo (`PLAN_REFACTOR_FLUJO.md`), de la preparación del eval (`PLAN_EVAL.md`) y de los cambios del 2026-11-07. Lo resuelto se quitó: el detalle y la evidencia están en `conclusiones.md` y en los documentos de cada tema. **[V]** = visto en el código o en una traza.

## Flujo y motor
- **Pre-chequeo determinista** (`engine/precheck.ts`): falta probarlo en uso real (falsos rechazos). Es lo único que valida los argumentos antes de pedir la aprobación al usuario.
- **D3 casi no corre en producción.** Todas las escrituras del catálogo piden aprobación y, si el usuario aprueba, D3 no entra. Solo corre en una escritura sin aprobación o con `autoMode` encendido. Decidir si D3 se reserva para ese modo (la idea) y medirlo sobre escrituras reales sin aprobación humana.
- **`autoMode`** (apagado por defecto, sin medir con el modelo real): falta decidir qué entradas lleva la lista negra en ese modo y si hace falta un control en la interfaz (hoy se cambia por `jarvis-config.json` o por `POST /config`).
- **Lista negra** (`blacklist`): viene vacía; faltan las entradas por defecto. No hay UI para editarla.
- **Anti-loop antes de los argumentos: no es posible.** La huella (`sig`) sale de los argumentos resueltos, así que el bloqueo solo puede ir después de generarlos. Lo que sí ahorraría tiempo (57 % del modelo es el LLM de argumentos) es no volver a elegir en el paso una herramienta ya bloqueada. Sin decidir.
- **Candidato idéntico a uno ya rechazado (`args_invalid`).** El anti-bucle solo compara llamadas ejecutadas; el tope de dos rechazos por paso (`maxReviewRejectionsPerStep`) lo acota, pero no lo bloquea antes de generar los argumentos. [V]
- **Sin medir con el modelo real:** los límites nuevos (`maxSteps` 20, `maxReplans` 3, `maxCallsPerStep` 6, `maxRepeatsPerStep` 2), el cierre de un paso por repetir una llamada ya aprobada, el encabezado fijo de `renderStatusNote` y la salida parcial de `runReactive` (`maxItemFailures` 2) en una corrida del pedido "último modelo de GPT y Gemini → md".
- **`sameItem`** (`pendingList.ts`) es la pieza más heurística del flujo (cifras, nombres propios, 60 % de raíces): no reconoció "10 tareas" y "10 procesos" como el mismo ítem. No ampliarla sin un caso medido.
- **`engine/deps.ts`** mezcla contratos con `createEngineServices` (que lee `ConfigManager`) y las listas `ARGS_REVIEWS`/`VERIFY_CHECKS`: separar contratos y fábrica si crece.

## Catálogo de herramientas
- **Extractor de `research`** (`result/extractors/research.ts`): no resuelve la recencia (las fechas de las fuentes llegan, pero una tabla con los modelos más nuevos queda en la ref). Medir con un dataset de preguntas "último X" y decidir si hace falta una lectura posterior de la ref.
- **Tiempo de espera:** `mcpTimeoutMs` pasó a 60 s para toda llamada; medir si alcanza para `research` (busca y descarga hasta 3 páginas, más si el servidor recurre al navegador). No hay un tiempo por herramienta.
- **Datasets:** `reales_args_review` y los de contexto libre conservan las herramientas antiguas (son historia). `inputSchemaManifest.md` está desactualizado: lo genera `scripts/dumpManifestInputSchemas.ts`, que necesita los servidores MCP.

## API (`src/server/`)
- **`POST /config` puede cambiar `command` y `args` de los servidores MCP:** quien llegue desde `localhost` puede hacer que el servidor lance otro programa. Hoy solo lo frena la validación de `Host` y `Origin`. Decidir si esas claves quedan solo en el archivo.
- `ALL /refresh-discovery` acepta también `GET` y tiene efecto (vuelve a descubrir). Heredado.
- La lista de pendientes completa (vive solo en `runReactive`) y las decisiones de D1 a D4 en vivo (solo las registra la traza al terminar) no se exponen: hacerlo exigiría guardarlas en el contexto o emitir un evento nuevo.
- Falta comprobar `GET /tasks/:id/refs/:refId` con una ref existente (necesita una tarea real).
- **Front (`ui/types/api.ts`):** todavía declara `qwenMaxTokens.verify`, que el backend ya no devuelve.

## Prompts (los escribe otro agente; ver `PLAN_EVAL.md`)
- `PROMPTS.PENDING_VIEW` es un texto provisorio. En dos corridas reales inventó el comando (`…usando el comando ps`): no debe nombrar comandos ni herramientas. [V]
- Para que una variante agregue o quite partes de un prompt de forma autónoma, `prompts.ts` debe organizarse en partes con nombre (hoy son literales dentro de `buildX` y `SYSTEM`).
- `adapters.ts`: el comentario de cabecera dice que solo se usan `renderArgs`, `renderAsk` y `renderPending`, pero también importa `renderPlan`. [V]
- `ReviewView` es `ArgsView` sin `refs` ni `effects`; derivar con `Omit`. [V]

## d3 / decisiones
- `validateAnswer` (`decision.ts`): todo tipo distinto de `choice` se valida como `noul`. Hace falta un `switch` exhaustivo si se agrega `score`. [V]
- `score` está en el contrato pero no se implementa. [V]
- La traza queda con `input`/`output` en `null` cuando d3 responde algo inválido: `DecisionValidationError` no lleva el crudo (`llmTransport.ts`). [V]
- `buildDecisionRequest` (`decision.ts`) tipa `config` con `ReturnType<typeof import(...)>`; usar `JarvisConfig`. [V]
- Nombres: `Decision20Engine`, "Decision 2.0" en mensajes; los "D3/D4" de los comentarios son decisiones de diseño, no las decisiones d3. [V]
- `shortDesc` recorta a `MAX_TOOL_DESC_CHARS` pero el manifest ya rechaza descripciones más largas al arrancar: un solo mecanismo. [V]

## Eval
- Los **prompts y datasets nuevos** (casos por escenario de `args_review`, `arguments`, `pending` y reactivos con instrucción realista) los escriben otros agentes.
- **Obsoleto por el cambio de flujo (el oracle falla por esto; 2026-11-07: 9 casos de `args_review` y los de `ask_user`/`fin`):**
  - `tool_rejected` ya no es una opción de D3: los 9 casos de `args_review` de los datasets fijos (`agentic_30`, `agentic_hard_40`, `decision_combo_52`, `decision_discriminating`) que esperan `expectedReview: tool_rejected` fallan con el oracle. `tool_rejected` es ahora el rechazo de la lista negra.
  - `ask_user` y `fin` ya no son opciones de D1 ni de D2. Quedan `expectedAction` `ask_user` y `fin` (`case.ts`, `types.ts`, `oracle.ts`, `graders/label.ts`, `stages/decision.ts`, `variants/labels.ts`, `variants/route_example.ts`) y los casos que los esperan: en los datasets fijos y 8 por escenario (6 en `scenarios_chains`, 2 en `scenarios_messages`: `msg-route-done` y `msg-route-info-missing`). Con el flujo nuevo, `fin` equivale a una lista de pendientes vacía (etapa `pending`, `expectEmpty`) y `ask_user` lo dispara D3 con `info_missing`. Las constantes `FIN` y `ASK_USER` quedaron sin uso en `src` (`routes.ts`) y solo las importa el eval: borrarlas al limpiar el eval. [V]
- Los casos reactivos por escenario existentes (`scenarios_chains`, `scenarios_messages`) no traen `instruction`: toman la solicitud como instrucción, que no es lo que produce la lista de pendientes.
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Falta la tabla de equivalencias con `STAGES` y `STAGE_KIND` (`src/core/types/stages.ts`). [V]
- El eval no corre el flujo: rearma los requests desde las vistas y los envía con clientes propios (`eval/core/client/*`). Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa.
- Los casos del eval se pueden construir a partir de la traza por tarea: `trace.json` trae el contexto completo, las opciones ofrecidas y las salidas de cada consulta, y `full.json.gz` las entradas crudas. Conviene un script que convierta una carpeta de traza en casos por escenario (hoy `eval/gen/reales.ts` lee el formato antiguo y no sirve con las trazas nuevas).
- Comentarios obsoletos sobre `runVerification` en `labels.ts` (cabecera). `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`: conviene igualarlos.
- `eval/core/contract.ts` define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET`: usar `BUDGET` directo en `runner.ts` y `stages/generative.ts` cuando se toque.
