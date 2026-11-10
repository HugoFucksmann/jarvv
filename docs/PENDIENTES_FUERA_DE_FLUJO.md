# Pendientes y limitaciones conocidas

Lo que sigue abierto en JARVIS v0.6.0: limitaciones conocidas, mediciones que faltan y deudas técnicas. Lo resuelto se quitó: el detalle y la evidencia están en `eval/MEJORES_VARIANTES.md`, en `eval/CONCLUSIONES_HISTORICAS.md` y en los documentos de cada tema. **[V]** = visto en el código o en una traza.

## Flujo y motor
- **Pre-chequeo determinista** (`engine/precheck.ts`): falta probarlo en uso real (falsos rechazos). Es lo único que valida los argumentos antes de pedir la aprobación al usuario.
- **D3 casi no corre en producción.** Todas las escrituras del catálogo piden aprobación y, si el usuario aprueba, D3 no entra. Solo corre en una escritura sin aprobación o con `autoMode` encendido. Decidir si D3 se reserva para ese modo (la idea) y medirlo sobre escrituras reales sin aprobación humana.
- **Umbrales de D3 y D4** (`REVIEW_APPROVE` y `NOUL_APPROVE` = 0,6, `engine/verify.ts`): valores iniciales sin medir; con ellos, una aprobación al 51 % ya se rechaza. Medir falsos rechazos con el eval (el eval comparte `NOUL_APPROVE`).
- **Shell Linux en Windows (evaluado, sin hacer):** WSL no está instalado (`bash.exe` de System32 es el lanzador de WSL y no sirve); Git Bash existe (`bash.exe` en la carpeta `bin` de Git) y habría que pasarlo con ruta completa en `shell`. Su `ps -W` no da memoria, y el pre-chequeo (`precheck.ts`, parser de PowerShell y rechazo de rutas Linux) asume PowerShell. Si se quiere probar, hacerlo primero en el eval con tareas de archivos y texto, no de procesos del sistema.
- **Reglas de comando** (`policy/commandRules.ts`): sin tests automáticos (se probaron a mano con ~100 comandos, v0.6.0). No reconocen llamadas .NET que no sean las estáticas a `[IO.File]`/`[IO.Directory]` (por ejemplo `(Get-Item x).Delete()`), ni variables definidas por el propio comando, ni rutas que vienen de una tubería. Medir cuántas aprobaciones extra generan las reglas nuevas (`sensitive`) en uso real.
- **`autoMode`** (apagado por defecto, sin medir con el modelo real): con él encendido, lo `sensitive` lo decide D3 (modelo de 2B, umbral 0,65) y no hay control en la interfaz (hoy se cambia por `jarvis-config.json` o por `POST /config`).
- **Lista negra** (`blacklist` de la config): viene vacía (las reglas integradas de `commandRules.ts` actúan igual). No hay UI para editarla.
- **Anti-loop antes de los argumentos: no es posible.** La huella (`sig`) sale de los argumentos resueltos, así que el bloqueo solo puede ir después de generarlos. Desde 2026-11-08 una herramienta bloqueada por repetición sigue ofrecida (antes se excluía del paso y podía dejar sin herramientas a la ruta correcta): cuesta, como mucho, dos llamadas bloqueadas por paso (`maxRepeatsPerStep`). Medir si `LAST ERROR` reduce esas repeticiones.
- **Candidato idéntico a uno ya rechazado (`args_invalid`).** El anti-bucle solo compara llamadas ejecutadas; el tope de dos rechazos por paso (`maxReviewRejectionsPerStep`) lo acota, pero no lo bloquea antes de generar los argumentos. [V]
- **Sin medir con el modelo real:** los límites nuevos (`maxSteps` 20, `maxReplans` 3, `maxCallsPerStep` 6, `maxRepeatsPerStep` 2), el cierre de un paso por repetir una llamada ya aprobada, el encabezado fijo de `renderStatusNote` y la salida parcial de `runReactive` (`maxItemFailures` 2) en una corrida del pedido "último modelo de GPT y Gemini → md".
- **`sameItem`** (`pendingList.ts`) es la pieza más heurística del flujo (cifras, nombres propios, 60 % de raíces): no reconoció "10 tareas" y "10 procesos" como el mismo ítem. No ampliarla sin un caso medido.
- **`engine/deps.ts`** mezcla contratos con `createEngineServices` (que lee `ConfigManager`) y las listas `ARGS_REVIEWS`/`VERIFY_CHECKS`: separar contratos y fábrica si crece.

- **Validación real pendiente (2026-11-09):** la ruta agotada tras dos `not_accomplished` (`availableRoutes`), la temperatura creciente por intento y el prompt de la respuesta final se midieron en el eval y en trazas, pero falta confirmarlos con varias tareas reales.
- **Tareas largas:** con muchos pasos y reintentos el contexto crece y el modelo chico pierde calidad (hay compactación de EFFECTS y FAIL, pero sin medir en tareas de más de ~10 llamadas).
- **`start_process` es siempre `write`** (aunque el comando solo lea): su salida va a EFFECTS y no a DATA, y con `autoMode` todo comando pasa por D3.

## Catálogo de herramientas
- **Extractor de `research`** (`result/extractors/research.ts`): no resuelve la recencia (las fechas de las fuentes llegan, pero una tabla con los modelos más nuevos queda en la ref). Medir con un dataset de preguntas "último X" y decidir si hace falta una lectura posterior de la ref.
- **Tiempo de espera:** `mcpTimeoutMs` pasó a 60 s para toda llamada; medir si alcanza para `research` (busca y descarga hasta 3 páginas, más si el servidor recurre al navegador). No hay un tiempo por herramienta.
- **`inputSchemaManifest.md`** (raíz) está desactualizado: lo genera `scripts/dumpManifestInputSchemas.ts`, que necesita los servidores MCP.

## API (`src/server/`)
- **`POST /config` puede cambiar `command` y `args` de los servidores MCP:** quien llegue desde `localhost` puede hacer que el servidor lance otro programa. Hoy solo lo frena la validación de `Host` y `Origin`. Decidir si esas claves quedan solo en el archivo.
- `ALL /refresh-discovery` acepta también `GET` y tiene efecto (vuelve a descubrir). Heredado.
- La lista de pendientes completa (vive solo en `runReactive`) y las decisiones de D1 a D4 en vivo (solo las registra la traza al terminar) no se exponen: hacerlo exigiría guardarlas en el contexto o emitir un evento nuevo.
- Falta comprobar `GET /tasks/:id/refs/:refId` con una ref existente (necesita una tarea real).
- **Front (`ui/types/api.ts`):** todavía declara `qwenMaxTokens.verify`, que el backend ya no devuelve.

## Prompts
- `PROMPTS.PENDING_VIEW` es la variante `pending_elite_labels` (eval del 2026-11-09, +2,6 puntos). Antes, en dos corridas reales, inventó el comando (`…usando el comando ps`); falta confirmar en uso real que ya no lo hace. [V]
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
- **Formatos del eval unificados (2026-11-08):** un solo formato de caso (el escenario) y un solo formato de variante (prompts enteros; sin ediciones, sin `a+b`). Los datasets de cada etapa (`eval/datasets/<etapa>/`) y las variantes se cargan **a mano** (con ayuda de otros modelos y revisión humana): el eval no es autónomo.
- **Quitado del eval (2026-11-08):** `ask_user`, `fin` y `tool_rejected` como respuestas posibles de D1, D2 y D3 (`expectedAction` ya no existe: `route` pide `expectedRoute` y `tool_choice` pide `expectedTool`; `expectedReview` ya no admite `tool_rejected`), y las constantes `FIN` y `ASK_USER` de `src/core/types/routes.ts`. `tool_rejected` sigue en `src` como el estado del rechazo de la lista negra.
- Un caso reactivo sin `instruction` en su paso toma la solicitud como instrucción, que no es lo que produce la lista de pendientes: los datasets nuevos deben traer `steps[].instruction` realista.
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Falta la tabla de equivalencias con `STAGES` y `STAGE_KIND` (`src/core/types/stages.ts`). [V]
- El eval no corre el flujo: rearma los requests desde las vistas y los envía con clientes propios (`eval/core/client/*`). Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa.
- Los casos del eval se pueden construir a partir de la traza por tarea: `trace.json` trae el contexto completo, las opciones ofrecidas y las salidas de cada consulta, y `full.json.gz` las entradas crudas. Conviene un script que convierta una carpeta de traza en casos por escenario (el generador anterior, `eval/gen/reales.ts`, leía el formato antiguo y se eliminó).
- `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`: conviene igualarlos.
- `eval/core/contract.ts` define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET`: usar `BUDGET` directo en `runner.ts` y `stages/generative.ts` cuando se toque.
