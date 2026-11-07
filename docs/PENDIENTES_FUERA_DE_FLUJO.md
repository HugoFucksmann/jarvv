# Pendientes

Lo que quedó abierto después del refactor del flujo (`PLAN_REFACTOR_FLUJO.md`) y de la preparación del eval (`PLAN_EVAL.md`). **[V]** = visto en el código o en una traza.

## Decisiones abiertas del flujo
- **Ofrecer al usuario las llamadas que D3 rechaza.** Hoy D3 corre antes de pedir la aprobación: una operación que requiere aprobación (por ejemplo `start_process`) y que D3 rechaza nunca llega al usuario. Propuesta pendiente de decisión: si la llamada requiere aprobación y D3 la rechaza, mostrarla igual con el aviso de D3; si el usuario acepta se ejecuta, si rechaza con instrucción queda como `user_rejected`. [V]
- **`tool_rejected` quitado de D3 y pre-chequeo determinista antes de D3 (2026-11-07; `engine/precheck.ts`).** Evidencia en `conclusiones.md`. `tool_rejected` sigue como valor de `CallStatus` en `ctx` (el modelo de datos no se tocó): limpiar cuando se confirme. Pendiente: probar el pre-chequeo en uso real (falsos rechazos), decidir si D3 sigue o se reduce a `needs_user`, y si corre solo para escrituras.
- **Anti-loop antes de los argumentos: no es posible.** La huella (`sig`) sale de los argumentos resueltos, así que el bloqueo solo puede ir después de generarlos. Lo que sí ahorra tiempo (57 % del modelo es el LLM de argumentos) es evitar que una herramienta ya bloqueada se vuelva a elegir en el paso. Sin decidir.
- **Candidato idéntico a uno ya rechazado por D3.** El anti-bucle solo compara llamadas ejecutadas; el tope de dos rechazos por paso (`maxReviewRejectionsPerStep`) lo acota, pero no lo bloquea antes de generar los argumentos. [V]
- **Reintento de la lista vacía.** Repite la misma consulta con temperatura 0.1: protege poco contra un vacío prematuro. Si hace falta, variar la entrada del reintento.
- **Sistema operativo en argumentos: hecho solo en parte.** `UserEnvironment.platform` (de `process.platform`) alimenta una línea del system prompt de argumentos (`osLine`). No se informan los shells disponibles (hoy se asume PowerShell en Windows y bash en el resto) ni la versión. Falta comprobarlo con una corrida real (`jarvis-traces.jsonl`).

## Catálogo de herramientas (2026-11-07)
- **Cambio aplicado en `tools/manifest.ts`:** web ofrece `research` (solo `question`; busca y lee las primeras páginas en una llamada) y `fetch` (solo `url` y `force_refresh`); ya no se ofrecen `search`, `fetch_batch`, `fetch.render`, `fetch.max_age_hours` ni `start_process.shell`. Motivos: el señuelo `render: "browser"` ante "abrir en el navegador", la segunda firma de `fetch_batch` que esquivaba el anti-loop, el `anyOf` de `max_age_hours` y que el servidor ya usa `powershell.exe`.
- **Extractor de `research`** (`result/extractors/research.ts`, 2026-11-07): resumen de hasta 2.500 caracteres con todas las fuentes (título, URL, fecha, snippet) y las líneas de las páginas que más se parecen a la pregunta (palabras compartidas por prefijo de 5 letras, sin acentos; las filas de tabla no compiten). Antes el genérico dejaba el principio y el final del conjunto. Probado con las dos salidas reales de `research` y el modelo final: sin nombres inventados y mejor anclado, pero **no resuelve la recencia** (las fechas de las fuentes llegan, pero una tabla con los modelos más nuevos queda en la ref). Pendiente: medir con un dataset de preguntas "último X" y decidir si hace falta una lectura posterior de la ref.
- **Tiempo de espera:** `mcpTimeoutMs` es 30 s para toda llamada. `research` busca y descarga hasta 3 páginas (más si el servidor recurre al navegador): puede no alcanzar. Medir antes de subirlo; no hay un tiempo por herramienta.
- **Pre-chequeo:** `collectSources` ahora lee el contenido de las refs (hasta 400 KB cada una); antes apagaba la comprobación de URL y rutas en toda la tarea en cuanto existía una ref, y `research` casi siempre deja una.
- **Datasets:** los casos por escenario se migraron (`search` a `research` con `question`, `fetch_batch` a `fetch`, sin `shell`, `render`, `max_age_hours` ni `max_results`; se quitaron `darg-fetch-render` y `darg-search-max-resultados`). `reales_args_review` y los de contexto libre conservan las herramientas antiguas (son historia). `inputSchemaManifest.md` está desactualizado: lo genera `scripts/dumpManifestInputSchemas.ts`, que necesita los servidores MCP.

## Prompts (los escribe otro agente; ver `PLAN_EVAL.md`)
- `PROMPTS.PENDING_VIEW` es un texto provisorio. En dos corridas reales inventó el comando (`…usando el comando ps`): no debe nombrar comandos ni herramientas. [V]
- D3: confunde `tool_rejected` con `args_invalid`, y en la sección "Failed attempts of this step" el estado `tool_rejected` de los intentos anteriores empuja a repetir la etiqueta (0.74 a 0.88 en cinco intentos). La pregunta `os_fit` (variante `decision_opciones`) acertó 2/2 en la comprobación. [V]
- `conclusiones.md`: d3 aprobaba casi todo en `args_review` y elegía `fin` de forma prematura (esto último ya no existe: `fin` salió de D1).
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

## Configuración
- `qwenMaxTokens.verify`: ninguna etapa lo lee. Está en `config.ts`, `jarvis-config.json` y `ui/types/api.ts`. [V]
- `MAX_TOOL_DESC_CHARS`: el comentario de `limits.ts` dice que Decision recorta; ya no es así. [V]

## Eval
- Los **prompts y datasets nuevos** (casos por escenario de `args_review`, `arguments`, `pending` y reactivos con instrucción realista) los escriben otros agentes. Los fixtures `verificacion_corrida.jsonl`, `prompt_prueba.ts` y `decision_opciones.ts` se borraron el 2026-11-07 (limpieza: ver `conclusiones.md`, sección 8).
- **Obsoleto por el cambio de flujo:** `ask_user` y `fin` ya no son opciones de D1 ni de D2. En el eval quedan `expectedAction` `ask_user` y `fin` (`case.ts`, `types.ts`, `oracle.ts`, `graders/label.ts`, `stages/decision.ts`, `variants/labels.ts`, `variants/route_example.ts`), los casos que los esperan: en los datasets fijos (`agentic_30`, `agentic_hard_40`, `decision_combo_52`) y 8 por escenario (6 en `scenarios_chains`: 3 `fin` y 3 `ask_user`; 2 en `scenarios_messages`: `msg-route-done` y `msg-route-info-missing`), que hoy fallan con el oracle por eso. Con el flujo nuevo, `fin` equivale a una lista de pendientes vacía (etapa `pending`, `expectEmpty`) y `ask_user` lo dispara D3 con `info_missing` y las variantes `jarvis_alt_v4` a `v6`. Las constantes `FIN` y `ASK_USER` quedaron sin uso en `src` (`routes.ts`) y solo las importa el eval: borrarlas al limpiar el eval. [V]
- Los casos reactivos por escenario existentes (`scenarios_chains`, `scenarios_messages`) no traen `instruction`: toman la solicitud como instrucción, que no es lo que produce la lista de pendientes.
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Falta la tabla de equivalencias con `STAGES` y `STAGE_KIND` (`src/core/types/stages.ts`). [V]
- El eval no corre el flujo: rearma los requests desde las vistas y los envía con clientes propios (`eval/core/client/*`). Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa.
- Los casos del eval se pueden construir a partir de la traza por tarea: `trace.json` trae el contexto completo, las opciones ofrecidas y las salidas de cada consulta, y `full.json.gz` las entradas crudas. Conviene un script que convierta una carpeta de traza en casos por escenario (hoy `eval/gen/reales.ts` lee el formato antiguo y no sirve con las trazas nuevas).
- Comentarios obsoletos sobre `runVerification` en `labels.ts` (cabecera). `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`: conviene igualarlos.
- `eval/core/contract.ts` define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET`: usar `BUDGET` directo en `runner.ts` y `stages/generative.ts` cuando se toque.
- Exponer el eval a un agente remoto (API con túnel): descartado, el agente corre en la nube de Anthropic y no llega a la máquina local. El agente trabaja con los resultados (`comparison.md`, `comparison.json`) que se le pasen.
- Verificar con el modelo real (no solo render) el encabezado fijo de `renderStatusNote` y la salida parcial de `runReactive` en una corrida del pedido "último modelo de GPT y Gemini → md"; medir `maxItemFailures` (2) y el filtro de segunda línea del extractor `research` (0,6).
- **Revisión de arquitectura de `src` (2026-11-07).** Sin hallazgos bloqueantes: `ctx/` no importa nada de fuera, ninguna capa de bajo nivel depende de `engine/` salvo por los contratos de `deps.ts`, y los dos ciclos de imports son solo de tipos. Mejoras menores sin hacer:
  - `fold`/`stems` están duplicados en `engine/pendingList.ts` y `result/extractors/research.ts` (con listas de palabras vacías distintas): pasar a un módulo común (`text.ts`) cuando se toque uno.
  - `engine/deps.ts` mezcla contratos con `createEngineServices` (que lee `ConfigManager`) y las listas `ARGS_REVIEWS`/`VERIFY_CHECKS`: separar contratos y fábrica si crece.
  - Mover los tipos de registro (`ModelRecord`, `ToolRecord`, `WaitRecord`) a un `trace/types.ts` y los de `CaptureSink` fuera de `deps.ts` eliminaría los dos ciclos de tipos.
  - `any` en `mcp/transport.ts` y `server/mcpRouter.ts` (capturas `catch (err: any)` y mensajes JSON-RPC): tipar con `unknown` y `errorMessage`.
  - El bloque `ANTI-BUCLE`: `failedRepeatTools` solo oculta la herramienta si la llamada previa falló; una repetida de una aprobada ahora cierra el paso (`repeatsApprovedCall`), pero una repetida de una lectura no aprobada sigue contando para `maxRepeatsPerStep`.
- **Sin medir con el modelo real:** límites nuevos (`maxSteps` 20, `maxReplans` 3, `maxCallsPerStep` 6, `maxRepeatsPerStep` 2) y el cierre por repetición de una llamada aprobada.
