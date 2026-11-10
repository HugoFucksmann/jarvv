# Pendientes y limitaciones conocidas

Lo que sigue abierto en JARVIS v0.6.0 (actualizado el 2026-11-10): limitaciones conocidas, mediciones que faltan y deudas técnicas. Lo resuelto se quitó: el detalle y la evidencia están en `eval/MEJORES_VARIANTES.md`, en `eval/CONCLUSIONES_HISTORICAS.md`, en `CHANGELOG.md` y en los documentos de cada tema. **[V]** = visto en el código o en una traza.

**Alcance de plataforma:** JARVIS es para Windows y PowerShell. No se va a ofrecer un shell Linux dentro de Windows (WSL, Git Bash): los prompts, el pre-chequeo (`precheck.ts`), `policy/readOnly.ts` y las rutas sensibles asumen PowerShell y rutas de Windows. Lo que haya de Linux o macOS en `commandRules.ts` es precaución, no un objetivo.

## Flujo y motor
- **Pre-chequeo determinista** (`engine/precheck.ts`): tiene tests (`tests/precheck.test.ts`, con el analizador simulado), pero falta probarlo en uso real (falsos rechazos) y con el parser real de PowerShell. Es lo único que valida los argumentos antes de pedir la aprobación al usuario.
- **D3 casi no corre en producción.** Todas las escrituras del catálogo piden aprobación y, si el usuario aprueba, D3 no entra; las lecturas, incluidos los comandos de solo lectura, tampoco pasan por D3. Solo corre en una escritura sin aprobación o con `autoMode` encendido. Medirlo sobre escrituras reales sin aprobación humana.
- **Umbrales de D3 y D4** (`REVIEW_APPROVE` y `NOUL_APPROVE` = 0,6, `engine/verify.ts`): valores iniciales sin medir; con ellos, una aprobación al 51 % ya se rechaza. Medir falsos rechazos con el eval (el eval comparte `NOUL_APPROVE`).
- **Reglas de comando** (`policy/commandRules.ts`): solo tienen tests de humo (`tests/policy.test.ts`); el resto se probó a mano con ~100 comandos (v0.6.0). No reconocen llamadas .NET que no sean las estáticas a `[IO.File]`/`[IO.Directory]` (por ejemplo `(Get-Item x).Delete()`), ni variables definidas por el propio comando, ni rutas que vienen de una tubería. Medir cuántas aprobaciones extra generan las reglas nuevas (`sensitive`) en uso real.
- **Comandos de solo lectura** (`policy/readOnly.ts`): la lista de cmdlets es cerrada y conservadora (sin paréntesis, bloques, variables ni métodos), así que consultas con `(Get-Date).AddDays(-1)` o `ForEach-Object` siguen pidiendo confirmación. Medir en uso real cuántas consultas legítimas quedan fuera y ampliar la lista solo con casos medidos. `interact_with_process` sigue siempre como escritura.
- **`autoMode`** (apagado por defecto, sin medir con el modelo real): con él encendido, lo `sensitive` lo decide D3 (modelo de 2B, umbral 0,65) y el resto de las escrituras, la revisión de argumentos. Las rutas sensibles piden confirmación igual. Se cambia desde la interfaz (Configuración) o por `POST /config`.
- **Anti-loop antes de los argumentos: no es posible.** La huella (`sig`) sale de los argumentos resueltos, así que el bloqueo solo puede ir después de generarlos. Una herramienta bloqueada por repetición sigue ofrecida: cuesta, como mucho, dos llamadas bloqueadas por paso (`maxRepeatsPerStep`; no gastan ejecuciones, sí intentos). Medir si `LAST ERROR` reduce esas repeticiones.
- **Candidato idéntico a uno ya rechazado (`args_invalid`).** El anti-bucle solo compara llamadas ejecutadas; el tope de dos rechazos por paso (`maxReviewRejectionsPerStep`) lo acota, pero no lo bloquea antes de generar los argumentos. [V]
- **Sin medir con el modelo real:** los límites (`maxSteps` 20, `maxReplans` 3, `maxCallsPerStep` 6 (ejecuciones), `maxAttemptsPerStep` 10, `maxRepeatsPerStep` 2, `maxUserRejectionsPerStep` 2), el cierre de un paso por repetir una llamada ya aprobada, el encabezado fijo de `renderStatusNote`, la salida parcial de `runReactive` (`maxItemFailures` 2), la ruta agotada tras dos `not_accomplished` (`availableRoutes`), la temperatura creciente por intento y el prompt de la respuesta final. Se midieron en el eval y en trazas; falta confirmarlos con varias tareas reales (por ejemplo "último modelo de GPT y Gemini → md").
- **Política de repetición** (`repeat` del catálogo, `isRepeat`): un rechazo de la verificación vale para su criterio (instrucción y esperado), así que un paso con otro criterio puede repetir una lectura que otro rechazó; si el criterio es el mismo se bloquea. Un modelo que insiste en una consulta idéntica la ejecuta, como mucho, una vez por criterio. Medir con tareas reales si el reintento por paso tras un fallo pasajero ayuda o solo gasta tiempo, y si `research`/`fetch` merecen `retry_failed`. Fuera de alcance por decisión: devolver el resultado ya guardado en vez de bloquear la repetición.
- **`sameItem`** (`pendingList.ts`) es la pieza más heurística del flujo (cifras, nombres propios, 60 % de raíces): no reconoció "10 tareas" y "10 procesos" como el mismo ítem. No ampliarla sin un caso medido.
- **Tareas largas:** con muchos pasos y reintentos el contexto crece y el modelo chico pierde calidad (hay compactación de EFFECTS y FAIL, pero sin medir en tareas de más de ~10 llamadas).

## Backend general
- **Retención** (`retention.ts`): solo por antigüedad (`retentionDays`, 30 por defecto). No hay tope por tamaño. Solo se borran carpetas con nombre de Jarvis, así que una carpeta de refs o de trazas con otro nombre se acumula. [V]
- **Cobertura de tests (`tests/`):** hay foto dorada de los prompts, Guard, reglas, rutas sensibles, comandos de solo lectura, pre-chequeo, resultados, refs, retención, recorder, rutas HTTP y `localOnly`, lógica pura y `runTask` con dobles. Hay tests del transporte MCP (contra un servidor de mentira) y del SSE. Sin tests: los adaptadores de `mcp/`, el análisis real con PowerShell del pre-chequeo y la interfaz. [V]
- **Logs:** unas 70 llamadas a `console.*` con prefijo `[Módulo]`. Los niveles ya son los de `console` (`error` para fallos, `warn` para degradaciones, `log` para el resto); un módulo de log propio no agregaría nada (no hay consumidor que filtre) y obligaría a tocar todos los sitios. Se descartó. [V]

## Seguridad
Modelo de amenaza: un solo usuario en su PC. Lo que sigue abierto:

**API y servidor**
- **La API no tiene autenticación.** `Host` y `Origin` locales (`src/server/localOnly.ts`) frenan a los sitios web (DNS rebinding, CSRF), no a otro proceso ni a otro usuario de la máquina. Un token por arranque solo sirve si se entrega fuera de banda (el HTML lo serviría a cualquiera); decidir si hace falta antes de abrir el servidor a otro uso. `HOST=0.0.0.0` anula incluso el filtro de `Host` (un cliente de red puede mandar `Host: localhost`).
- **Un cliente local puede apagar los controles.** `POST /config` acepta `autoMode`, `blacklist`, `allowedDirectories` y `retentionDays` sin otra confirmación (el comando de los servidores MCP y las carpetas de escritura ya son solo de archivo). Misma raíz que el punto anterior.
- **`GET /config` devuelve la configuración completa,** incluido `env` de los servidores MCP: si ahí se pusiera una clave, la vería cualquier cliente local. Lo mismo vale para el texto de las refs (`GET /tasks/:id/refs/:refId`) y las trazas. [V]
- **Sin límite de tasa:** hay tope de tareas en curso (`MAX_ACTIVE_TASKS`, 4) y de conexiones SSE (`MAX_SSE_CLIENTS`, 8), ambos con `429`, pero no de peticiones por segundo ni de tamaño de mensaje por tarea. [V]

**Política de rutas y comandos**
- **Rutas sensibles** (`policy/sensitivePaths.ts`): listas cerradas y sin medir en uso real (falsos positivos: confirmaciones de más; falsos negativos: rutas que no figuren). Miran el texto de las rutas y del comando, no lo que un comando arma por variables. Cubren claves, credenciales, historiales de shell, tokens de CLI (`gh`, `terraform`, `vault`) y datos de navegadores; las plantillas `.env.example` no se marcan. No resuelven enlaces simbólicos o uniones, nombres cortos 8.3 (`PROGRA~1`), prefijos `\\?\` ni rutas UNC. La regla B de las carpetas protegidas (`refsDir`) tampoco sigue enlaces simbólicos. [V]
- **`allowedDirectories`** viene vacío (sin restricción) y solo valida los argumentos de ruta de las herramientas de archivos: no restringe lo que haga un `start_process`. [V]
- **`autoMode` descansa en un modelo de 2B** para lo que las reglas no marcan: sin medir cuántas escrituras peligrosas aprobaría. Encendido, el único control humano son las rutas sensibles.

**Datos y modelos**
- **Inyección de instrucciones:** el contenido de `research`, `fetch` y los archivos leídos llega al modelo marcado entre `<obs>` y saneado, pero no hay detección. La mitigación real son las confirmaciones (rutas sensibles, escrituras y comandos que escriben) y el pre-chequeo de URL.
- **Canal de salida por `research`:** la consulta de búsqueda no se inspecciona y puede llevar datos. El resto de las salidas (`fetch`) lo cubre el pre-chequeo de URL (la URL completa debe figurar en el pedido o en resultados previos), y la lectura de secretos está detrás de la confirmación obligatoria. El pre-chequeo se omite si una ref ya no se puede leer (por ejemplo, borrada por la retención). [V]
- **Datos en reposo sin protección:** las refs y las trazas (`full.json.gz` con los prompts y resultados crudos) quedan en texto plano durante `retentionDays` y pueden incluir lo que el usuario aprobó leer (claves incluidas). No hay cifrado ni redacción de secretos. [V]

**Procesos y dependencias**
- **Procesos en segundo plano:** al terminar una tarea que no se completó se cierran (`engine/processes.ts`); si se cancela mientras `start_process` está en vuelo, el resultado tardío se descarta y su `pid` no se conoce. Una tarea completada los deja (puede ser lo pedido).
- **Dependencias de los servidores MCP:** Desktop Commander es una dependencia del proyecto, fijada en `0.3.2` con `package-lock.json` (versión y dependencias transitivas), y arranca con `node` directo en ~0,7 s. Free Search está fijado en `0.18.0` con `uvx` (arranca en ~1,8-2,5 s; con versiones exactas no consulta la red), y sus ~90 dependencias transitivas quedan fijadas en `mcp/free-search/constraints.txt` (`--constraints`: fija versiones, no verifica hashes). Los servidores MCP se lanzan sin shell (`node`, `uvx`); solo un `.cmd`/`.bat` como `npx` lo usa en Windows (`needsShell`), y ahí Node avisa con `DEP0190`: los argumentos no se escapan y solo vienen de `jarvis-config.json`. Subir cualquiera de los dos es una decisión que se prueba antes (`config.ts` y `jarvis-config.json`). [V]

## Catálogo de herramientas
- **Extractor de `research`** (`result/extractors/research.ts`): no resuelve la recencia (las fechas de las fuentes llegan, pero una tabla con los modelos más nuevos queda en la ref). Medir con un dataset de preguntas "último X" y decidir si hace falta una lectura posterior de la ref.
- **Tiempo de espera:** `mcpTimeoutMs` pasó a 60 s para toda llamada; medir si alcanza para `research` (busca y descarga hasta 3 páginas, más si el servidor recurre al navegador). No hay un tiempo por herramienta.
- **`inputSchemaManifest.md`** (raíz) está desactualizado: lo genera `scripts/dumpManifestInputSchemas.ts`, que necesita los servidores MCP.

## API (`src/server/`)
- `ALL /refresh-discovery` acepta también `GET` y tiene efecto (vuelve a descubrir). Heredado.
- La lista de pendientes completa (vive solo en `runReactive`) y las decisiones de D1 a D4 en vivo (solo las registra la traza al terminar) no se exponen: hacerlo exigiría guardarlas en el contexto o emitir un evento nuevo.
- Falta comprobar `GET /tasks/:id/refs/:refId` con una ref existente (necesita una tarea real).

## Prompts
- `PROMPTS.PENDING_VIEW` es la variante `pending_elite_labels` (eval del 2026-11-09, +2,6 puntos). Antes, en dos corridas reales, inventó el comando (`…usando el comando ps`); falta confirmar en uso real que ya no lo hace. [V]
- Para que una variante agregue o quite partes de un prompt de forma autónoma, `prompts.ts` debe organizarse en partes con nombre (hoy son literales dentro de `buildX` y `SYSTEM`).
- `ReviewView` es `ArgsView` sin `refs` ni `effects`; derivar con `Omit`. [V]

## d3 / decisiones
- `validateAnswer` (`models/decision.ts`): todo tipo distinto de `choice` se valida como `noul`. Hace falta un `switch` exhaustivo si se agrega `score`. [V]
- `score` está en el contrato pero no se implementa. [V]
- La traza queda con `input`/`output` en `null` cuando d3 responde algo inválido: `DecisionValidationError` no lleva el crudo (`models/transport.ts`). [V]
- Nombres: `Decision20Engine`, "Decision 2.0" en mensajes; los "D3/D4" de los comentarios son decisiones de diseño, no las decisiones d3. [V]
- `shortDesc` recorta a `MAX_TOOL_DESC_CHARS` pero el manifest ya rechaza descripciones más largas al arrancar: un solo mecanismo. [V]

## Eval
- **Formatos del eval unificados (2026-11-08):** un solo formato de caso (el escenario) y un solo formato de variante (prompts enteros; sin ediciones, sin `a+b`). Los datasets de cada etapa (`eval/datasets/<etapa>/`) y las variantes se cargan **a mano** (con ayuda de otros modelos y revisión humana): el eval no es autónomo.
- **Quitado del eval (2026-11-08):** `ask_user`, `fin` y `tool_rejected` como respuestas posibles de D1, D2 y D3 (`expectedAction` ya no existe: `route` pide `expectedRoute` y `tool_choice` pide `expectedTool`; `expectedReview` ya no admite `tool_rejected`), y las constantes `FIN` y `ASK_USER` de `src/core/types/routes.ts`. `tool_rejected` sigue en `src` como el estado del rechazo de la lista negra.
- Un caso reactivo sin `instruction` en su paso toma la solicitud como instrucción, que no es lo que produce la lista de pendientes: los datasets nuevos deben traer `steps[].instruction` realista.
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Falta la tabla de equivalencias con `STAGES` y `STAGE_KIND` (`src/core/types/stages.ts`). [V]
- El eval no corre el flujo: rearma los requests desde las vistas y los envía con clientes propios (`eval/core/client/*`). Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa. `tests/engine.test.ts` ya arma `runTask` con dobles: sirve de punto de partida.
- Los casos del eval se pueden construir a partir de la traza por tarea: `trace.json` trae el contexto completo, las opciones ofrecidas y las salidas de cada consulta, y `full.json.gz` las entradas crudas. Conviene un script que convierta una carpeta de traza en casos por escenario (el generador anterior, `eval/gen/reales.ts`, leía el formato antiguo y se eliminó).
- `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`: conviene igualarlos.
- `eval/core/contract.ts` define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET`: usar `BUDGET` directo en `runner.ts` y `stages/generative.ts` cuando se toque.
