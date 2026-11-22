# Auditoría técnica del backend (`src/` y `server.tsx`) — 2026-11-21

**Plataforma objetivo:** No definida formalmente en el repositorio *(la mayoría de las herramientas nativas y drivers de sistema/terminal exigen `win32`/`powershell.exe`, mientras que el desarrollo, los tests y el sandbox de ejecución también corren sobre Linux; queda registrado en **Puntos abiertos**)*.

Documento consolidado, verificado y reordenado por severidad tras seis pasadas de auditoría de solo lectura sobre el backend de JARVIS. Integra la exposición de red intencional en desarrollo, separa los hallazgos compuestos según su severidad, reclasifica los riesgos futuros de evolución de formatos como observación de diseño y resume los puntos abiertos de arquitectura y operación.

---

## Resumen cuantitativo

| Categoría | Cantidad | `[Confirmado]` | `[Hipótesis]` |
| :--- | :---: | :---: | :---: |
| **Crítica** | 2 | 0 | 2 |
| **Alta** | 18 | 3 | 15 |
| **Media** | 28 | 5 | 23 |
| **Baja** | 13 | 9 | 4 |
| **Subtotal de hallazgos** | **61** | **17** | **44** |
| **Observaciones de diseño** | 1 | 1 | 0 |
| **Descartados** | 2 | — | — |

> **Regla única de etiquetado:** **`[Confirmado]`** únicamente cuando el hecho es directamente observable leyendo el código (valor literal, ausencia de validación/parámetro/archivo/test, import muerto). Todo comportamiento o impacto que dependa de ejecución o de contexto se etiqueta como **`[Hipótesis]`**.

---

## 1. Hallazgos Críticos (2)

1. **`[Hipótesis]` `move_file` borra el directorio destino antes de `rename()` y del fallback `EXDEV`**
   * **Archivo y línea:** `src/tools/files_write/moveFile.ts:200-209` | **Impacto:** Con `overwrite: true` sobre una carpeta existente en destino, ejecuta `rm(..., { recursive: true })` antes de intentar `rename()` y de `copyPathControlled()`, provocando pérdida irreversible del destino si el movimiento falla luego (`EBUSY`, `EXDEV` o límites de copia). | **Solución propuesta:** Renombrar primero el destino existente a una ruta temporal de respaldo y eliminarlo solo después de confirmar éxito.

2. **`[Hipótesis]` Colisión de `tag` en botones de Telegram (aprobación cruzada) y ocultación de preguntas múltiples**
   * **Archivo y línea:** `src/telegram/bot.ts:70-72, 126-130, 163-167, 410-414` | **Impacto:** `tagOf()` recorta `slice(0, 8)` colisionando siempre en `"approval"`/`"plan_179"` (permite aprobar o rechazar una espera nueva con un botón obsoleto) y `waitKey()` usa `q${stepId}` ocultando preguntas adicionales dentro del mismo paso. | **Solución propuesta:** Usar `w.question.id` en `waitKey()` y generar identificadores únicos cortos (o un mapa efímero `tag -> waitId`) dentro del límite de 64 bytes de Telegram.

---

## 2. Hallazgos Altos (15)

3. **`[Confirmado]` Exposición de red sin autenticación y `HOST=0.0.0.0` con guardas comentadas *(intencional en desarrollo)***
   * **Archivo y línea:** `server.tsx:65-77, 87`; `src/server/localOnly.ts:32-34`; `src/server/jarvisRouter.ts`; `src/server/mcpRouter.ts` | **Impacto:** Expone todos los endpoints HTTP (`/api/jarvis/*`, `/api/mcp/*`, `/mcp/*`) en `0.0.0.0` sin autenticación ni filtro `Host`/`Origin` (`localOnly()` e `isLoopbackHost()` están comentados); **aviso crítico: debe resolverse antes de desplegar fuera de loopback**. | **Solución propuesta:** Restaurar `isLoopbackHost()` y `localOnly()` (parametrizados por entorno) e implementar autenticación por token/sesión antes de exponer fuera de loopback.

4. **`[Hipótesis]` Evasión de Regla B (`DENY`) en `Guard` y de `wrapped-powershell` mediante `powershell`/`pwsh` posicional**
   * **Archivo y línea:** `src/core/policy/guard.ts:213-224`; `src/core/engine/precheck.ts:264-274` (contraste `src/core/policy/commandRules.ts:340-341`) | **Impacto:** Requiere invocar explícitamente `powershell "Remove-Item ..."` sin `-Command`/`-EncodedCommand`; aunque `commandRules.ts` lo desempaqueta, `Guard` omite la detección de rutas protegidas (`DENY`) y `precheck` omite `wrapped-powershell`. | **Solución propuesta:** Compartir un helper único de desempaquetado entre `commandRules.ts`, `guard.ts` y `precheck.ts` que procese argumentos posicionales tras banderas de PowerShell.

5. **`[Confirmado]` Uso de `AbortSignal.timeout()` *unref'd* en `web_search`** *(reproducido en `tests/web_search.test.ts:760`)*
   * **Archivo y línea:** `src/tools/web/webSearchProvider.ts:259-261` | **Impacto:** `judgeSignal()` pasa `AbortSignal.timeout()` sin handle activo propio; al esperar únicamente esa señal, Node.js 22+ puede cerrar prematuramente el event loop como ocurrió en 24 subtests de `web_search.test.ts:760`. | **Solución propuesta:** Sustituir `AbortSignal.timeout()` por un `AbortController` + `setTimeout` con `clearTimeout` explícito en `finally`.

6. **`[Hipótesis]` Escrituras de archivos no atómicas en `edit_file` y `write_file` y recodificación forzada en `edit_file`**
   * **Archivo y línea:** `src/tools/files_write/editFile.ts:177-178`; `src/tools/files_write/writeFile.ts:135` | **Impacto:** Sobrescriben directamente sobre el destino con `fs.promises.writeFile`, exponiendo el archivo a truncamiento o corrupción ante cancelación/caída y forzando `"utf8"` al guardar en `edit_file`. | **Solución propuesta:** Escribir en archivo temporal en el mismo directorio y realizar `rename` atómico preservando codificación y BOM cuando corresponda.

7. **`[Hipótesis]` `copy_file` permite sobrescribirse sobre sí mismo a través de un symlink destino**
   * **Archivo y línea:** `src/tools/files_write/copyFile.ts:141-142, 235, 287-293` | **Impacto:** `same_path` compara `srcResolved.realTarget` contra `canonicalPath(dstResolved.targetPath)` sin resolver enlaces; con `overwrite: true` sobre un symlink que apunta al origen, puede truncar y destruir el archivo fuente. | **Solución propuesta:** Comparar también `srcResolved.realTarget` contra `dstInspection.realTarget` cuando `dstInspection.status === "exists"` (y validar `isCanonicalDescendant` en copias recursivas).

8. **`[Hipótesis]` `filePaths.ts` admite symlinks hacia FIFOs/sockets en modo `"file"`, exponiendo `read_file` a bloqueos**
   * **Archivo y línea:** `src/core/tools/filePaths.ts:376`; `src/tools/files_read/readFile.ts:147, 178` | **Impacto:** La guarda `if (expectedKind === "file" && !isFile && !isSymlink)` deja pasar symlinks resueltos hacia FIFOs o sockets, pudiendo colgar indefinidamente `fs.promises.open(..., "r")` en `read_file`. | **Solución propuesta:** Exigir `isFile` cuando `followSymlinkForAllowedCheck` es `true` en `filePaths.ts:376`.

9. **`[Hipótesis]` Cierre prematuro del contexto en `finalize()` vuelve incancelable a LLM 3 y emite `paused` tras cierre**
   * **Archivo y línea:** `src/core/engine/finalize.ts:38-40, 55, 67`; `src/core/tasks.ts:228, 252` | **Impacto:** Aplicar `finish task` antes de `answer()` deja `ctx.isClosed() === true`, haciendo que `cancel()`/`cancelAll()` ignoren la tarea y no aborten `runtime.signal` mientras LLM 3 ejecuta o entra en pausa con backoff. | **Solución propuesta:** Verificar `this.inFlight` en `TaskManager.cancel()`/`cancelAll()` o diferir `finish task` hasta finalizar/abortar `answer()` evitando emitir `paused` tras el cierre.

10. **`[Hipótesis]` `previousTaskOf()` y `recalled.ts` no acotan ni sanean entradas y disparan `ContextError` (`unrecoverable`)**
    * **Archivo y línea:** `src/core/engine/thread.ts:24-27`; `src/core/engine/recalled.ts:35-44, 51-64`; `src/core/ctx/validate.ts:230-236`; `src/core/budget.ts:20-24` | **Impacto:** Un `request` previo mayor a `threadValueMax` (`8000`) o valores vacíos/excedidos en memoria (`recalledKeyMax`/`recalledValueMax`) lanzan `ContextError` sin capturar y cierran la tarea como `unrecoverable`. | **Solución propuesta:** Recortar `request` en `previousTaskOf()` y aplicar `clipWithin` (descartando vacíos tras `.trim()`) en `recalled.ts` con los topes de `BUDGET`.

11. **`[Hipótesis]` Auto-aprobación RC-20 de `run_command` falla por off-by-one `>= BUDGET.factValueMax`**
    * **Archivo y línea:** `src/core/engine/ask.ts:64-68, 102-104`; `src/core/engine/retries.ts:68-78`; `src/core/budget.ts:14` | **Impacto:** `processAnswerText()` descarta hechos `answer_*` de exactamente 500 caracteres no truncados, rompiendo `inputAnswersProcess()` y obligando al usuario a reconfirmar una entrada ya respondida. | **Solución propuesta:** Detectar truncamiento real o leer el texto completo desde la `ref` vinculada cuando `value.length === BUDGET.factValueMax` o exista marcador de corte.

12. **`[Hipótesis]` `egress.ts` omite reglas `credential`, `long-blob` y `user-path` en `open_on_screen.target` y conserva regex muerto**
    * **Archivo y línea:** `src/core/policy/egress.ts:15, 31-33, 39, 56-63` | **Impacto:** `isUrlArg("target")` clasifica cualquier `target` como URL y la línea 56 omite las tres reglas cuando `inUrls === false`, permitiendo el paso de credenciales o rutas de usuario en `open_on_screen` además de mantener muerto el patrón de la línea 32. | **Solución propuesta:** Tratar `target` como URL en `isUrlArg` únicamente si empieza por `http://` o `https://`, evaluar `credential` en URLs según corresponda y eliminar el regex muerto de la línea 32.

13. **`[Hipótesis]` `TerminalProvider.killAll()` omite hijos en `spawn` y `HELPERS_UNAVAILABLE_EXIT` reintenta sin descontar `waitMs`**
    * **Archivo y línea:** `src/tools/terminal/terminalProvider.ts:353-362, 417-449, 689-694` | **Impacto:** Procesos aún esperando `"spawn"` (hasta 10 s) no figuran en `this.procs` y sobreviven al cierre de tarea o proveedor; ante `HELPERS_UNAVAILABLE_EXIT`, `start()` relanza con el `waitMs` completo y sin límite si `helpersFile` desaparece del disco. | **Solución propuesta:** Registrar procesos pendientes antes de `"spawn"` para abortarlos si cierra la tarea/proveedor y limitar `HELPERS_UNAVAILABLE_EXIT` a un reintento descontando el tiempo consumido.

14. **`[Hipótesis]` `WebSearchProvider.readWhole()` deja huecos silenciosos cuando `read_doc` devuelve menos de 50 000 caracteres**
    * **Archivo y línea:** `src/tools/web/webSearchProvider.ts:411-433, 535-548`; `src/tools/web/report.ts:149-161` | **Impacto:** Calcula ventanas paralelas con offset fijo múltiplo de `50_000`, perdiendo texto intermedio entre `returnedChars` y `50_000` mientras marca `complete: true`. | **Solución propuesta:** Encadenar lecturas con `nextStart = currentStart + returnedChars` cuando el tramo retorne menos que `FULL_READ_WINDOW` o validar continuidad antes de marcar `complete: true`.

15. **`[Hipótesis]` `download_file` omite el punto final DNS (`localhost.`) y queda expuesto a *DNS rebinding***
    * **Archivo y línea:** `src/tools/web/downloadFile.ts:184-192, 445-456` (contraste `src/tools/web/args.ts:31`) | **Impacto:** `validateRemoteUrl()` no normaliza `\.+$` ni bloquea sufijos internos como `isInternalHost` (permitiendo `http://localhost./`), y `fetchFn()` vuelve a resolver DNS por separado tras `lookupHost` exponiendo a *DNS rebinding*. | **Solución propuesta:** Reutilizar `isInternalHost` en `validateRemoteUrl()` y conectar directamente contra la IP previamente validada fijando el header `Host`.

16. **`[Hipótesis]` Telegram trunca y malforma etiquetas HTML en `Progress.render()`, `mdToHtml()` y `chunk()` (errores `400`)**
    * **Archivo y línea:** `src/telegram/progress.ts:133`; `src/telegram/format.ts:8-22, 25-41`; `src/telegram/bot.ts:92-104, 192-198` | **Impacto:** `render()` corta HTML en `STATUS_MAX` partiendo etiquetas/entidades (congelando el mensaje de estado con `400`), y `mdToHtml()`/`chunk()` cruzan etiquetas, marcadores `\u0000` o bloques abiertos provocando fallback a texto plano. | **Solución propuesta:** Truncar `render()` por líneas/pasos completos, aislar código inline junto a bloques fenced sin `\u0000` crudo y respetar bloques abiertos al trocear en `chunk()`.

17. **`[Hipótesis]` Validación de entradas incompleta en `/api/jarvis/*`, `/api/mcp/*` y `ConfigManager`**
    * **Archivo y línea:** `src/server/jarvisRouter.ts:24-26, 133, 141, 166, 169, 176, 182, 200, 224-225, 269, 333-340, 346-351`; `src/server/mcpRouter.ts:16-39, 52-65, 82-106`; `src/core/config.ts:288-341` | **Impacto:** `text()` trata no-strings/arrays como `undefined` pudiendo derivar en fallbacks silenciosos sin `400`; `approve` ignora `remember` no booleano; `POST /config` descarta claves/tipos inválidos con HTTP `200` sin `try/catch`; y `/api/mcp/:server/call` acepta `name` en blanco sin validar `isKnownTool`/`inputSchema`, devolviendo errores con HTTP `200`. | **Solución propuesta:** Sustituir `text()` por validadores estrictos con `400`, validar `inputSchema`/`isKnownTool` y `ConfigManager.updateConfig` dentro de `try/catch`, y responder `400`/`5xx` ante errores reales.

---

## 3. Hallazgos Medios (26)

18. **`[Confirmado]` `approvalTierOf` hace fail-open a `"green"` en `open_on_screen` cuando `absolute(target)` es `null`**
    * **Archivo y línea:** `src/core/policy/tiers.ts:29-35, 160-163, 174` | **Impacto:** La condición `resolved === null || ... ? "green" : "yellow"` devuelve literalmente `"green"` ante ruta relativa, `\0` o marcador `{{...}}` violando el archivo, aunque el impacto práctico queda acotado a abrir en pantalla y a la validación posterior en `openOnScreen`. | **Solución propuesta:** Invertir la condición en `tiers.ts:162` a `resolved !== null && underUserFolder(resolved, c.env, c.canon) ? "green" : "yellow"`.

19. **`[Hipótesis]` Fallback `EXDEV` para symlinks en `move_file` omite el argumento `type` en Windows**
    * **Archivo y línea:** `src/tools/files_write/moveFile.ts:219-225` | **Impacto:** Al mover un symlink entre volúmenes distintos (`EXDEV`), `fs.promises.symlink(linkTarget, dstResolved.targetPath)` omite el parámetro `type` (`"dir"`/`"file"`), pudiendo fallar o crear enlaces erróneos a carpetas en `win32`. | **Solución propuesta:** Determinar y pasar el tercer parámetro `type` a `fs.promises.symlink()` en Windows según el tipo de destino.

20. **`[Confirmado]` `Progress.apply()` exige `"state" in patch` e ignora actualizaciones `superseded` emitidas por `planner.ts`**
    * **Archivo y línea:** `src/telegram/progress.ts:102-106`; `src/core/engine/planner.ts:82` | **Impacto:** `planner.ts:82` emite `{ op: "update", target: s.id, value: { superseded: true } }` sin clave `"state"`, por lo que la rama `if (step && "state" in patch)` nunca se ejecuta para esos avisos y no tacha los pasos descartados en Telegram. | **Solución propuesta:** Evaluar `if (patch.superseded)` en `Progress.apply()` con independencia de que exista `"state"` en el parche.

21. **`[Hipótesis]` `streamSpeech()` y `sendVoice()` carecen de timeout y de propagación de `abort.signal`**
    * **Archivo y línea:** `src/telegram/bot.ts:106-113`; `src/voice/tts.ts:53-77` | **Impacto:** `sendVoice()` invoca `streamSpeech(spoken, voice)` sin pasar `abort.signal` y `tts.ts` realiza `fetch()` sin timeout propio, pudiendo dejar colgada una nota de voz si `phonon_server.py` no responde. | **Solución propuesta:** Pasar `abort.signal` desde `sendVoice()` y agregar timeout por conexión/fragmento en `streamSpeech()`.

22. **`[Hipótesis]` Métodos REST de `JarvisApi` (`post`, `get`, `resultText`) ejecutan `fetch()` sin timeout ni `AbortSignal`**
    * **Archivo y línea:** `src/telegram/api.ts:14-52` | **Impacto:** Si la API local se bloquea o tarda indefinidamente, los comandos y callbacks del bot quedan suspendidos sin límite de espera. | **Solución propuesta:** Añadir `AbortController` con timeout configurable y limpieza en `finally` para `post()`, `get()` y `resultText()`.

23. **`[Hipótesis]` `TerminalProvider.resume()` escribe en `stdin` sin verificar estado del stream**
    * **Archivo y línea:** `src/tools/terminal/terminalProvider.ts:410, 528-540` | **Impacto:** Solo verifica `!t.done` antes de `stdin.write()` con el listener de error silenciado en la línea 410, ocultando pérdidas de escritura si el stream cerró antes de `finish()`. | **Solución propuesta:** Comprobar `t.child.stdin.writable && !t.child.stdin.destroyed` y capturar errores en el callback de `write()` para reflejar `ignoredInput`.

24. **`[Hipótesis]` Estado `unavailableServers` pegajoso en `DiscoveryEngine` tras un fallo transitorio**
    * **Archivo y línea:** `src/core/mcp/discovery.ts:51-54, 72-77` | **Impacto:** Un fallo aislado en `listTools()` excluye al servidor para toda llamada con `forceRefresh = false` incluso al expirar `TOOLS_CACHE_TTL_MS`, obligando a un `/refresh-discovery` manual. | **Solución propuesta:** Reemplazar el bloqueo indefinido por un backoff/cooldown temporal con reintento automático tras una ventana corta.

25. **`[Hipótesis]` `QwenEngine`: falso `overflow` al adjuntar `retryNote` y escaneo de un único bloque fenced**
    * **Archivo y línea:** `src/core/models/qwen.ts:147-166, 373-389, 480-514` | **Impacto:** Añadir `retryNote` con margen cercano a `256` tokens dispara `overflow = true` (`unrecoverable`), y `parseJsonObject()` solo revisa el primer fence ```` ``` ```` fallando si hay un bloque de ejemplo previo al JSON. | **Solución propuesta:** Verificar presupuesto antes de agregar `retryNote` (o reintentar sin nota) e inspeccionar todos los bloques fenced del último al primero.

26. **`[Hipótesis]` Buffering completo en memoria RAM dentro de `archive_files`**
    * **Archivo y línea:** `src/tools/files_write/archiveFiles.ts:529, 611, 807` | **Impacto:** Acumula hasta 256 MB en `Buffer` al comprimir y lee hasta 512 MB completos con `readFile` al extraer, generando picos elevados de heap/RSS con archivos grandes o concurrencia. | **Solución propuesta:** Migrar compresión y extracción a lectura/escritura por streams o chunks por offset.

27. **`[Hipótesis]` E/S síncrona en `TaskManager.list()` / `summarizeClosedTaskLog()` y replay completo en `retention.ts`**
    * **Archivo y línea:** `src/core/tasks.ts:285-290`; `src/core/retention.ts:100, 223`; `src/core/taskLog.ts:349-350, 370-374` | **Impacto:** `list()` ejecuta `fs.existsSync()` por cada tarea histórica en `/state` y `/events`, `retention` reproduce logs `.jsonl` completos en lugar de usar la vía rápida y `summarizeClosedTaskLog()` lee todo el archivo para ver 3 líneas. | **Solución propuesta:** Comprobar primero `summarizeClosedTaskLog()` en retención, leer solo cabecera/cola sin `readFileSync` total y evitar `existsSync` por elemento en `list()`.

28. **`[Hipótesis]` Regex síncrona sin límite de backtracking (`ReDoS`) e ignorado de `filePattern` en `search_content`**
    * **Archivo y línea:** `src/tools/files_read/searchContent.ts:165-169, 330-331, 463` | **Impacto:** Compila `new RegExp(query, ...)` arbitrario línea a línea sobre archivos de hasta 2 MB con riesgo de bloquear el event loop, y nunca aplica `fileMatchers` cuando `path` apunta a un archivo único. | **Solución propuesta:** Limitar o validar expresiones con backtracking costoso y aplicar `fileMatchers` también en la rama `resolved.isFile`.

29. **`[Hipótesis]` Cota de `TaskManager.prune()` superada ante tareas sin `waiting` o cerradas sin `result`**
    * **Archivo y línea:** `src/core/tasks.ts:487-501` | **Impacto:** Si `this.tasks` excede `MAX_RETAINED_TASKS` con tareas activas sin `waiting` o terminales sin `result`, `prune()` cancela como mucho una espera asíncrona y el mapa supera el límite temporalmente. | **Solución propuesta:** Ejecutar limpieza adicional al cerrar cada tarea y considerar tareas cerradas sin resultado o expiradas en `evictFinished()`.

30. **`[Hipótesis]` `ReactiveList` usa comparación estricta `!this.done.includes(item)` tras reapertura D5**
    * **Archivo y línea:** `src/core/engine/reactiveList.ts:103-110` | **Impacto:** Sin lista previa, la rama de reapertura vuelve a encolar pasos ya completados si D5 varía mayúsculas, acentos o puntuación respecto al texto original. | **Solución propuesta:** Reemplazar `!this.done.includes(item)` en `reactiveList.ts:105` por una comparación normalizada equivalente a `reconcileList`.

31. **`[Hipótesis]` Recorte silencioso de `userInput` y prefijo `https://` sobre esquemas con puerto en `precheck.ts`**
    * **Archivo y línea:** `src/core/engine/precheck.ts:152-153, 465-470` | **Impacto:** Descartar respuestas antiguas al alcanzar `BUDGET.caps.userInput` (`6000`) sin marcar `complete = false` causa falsos rechazos de origen, y `url-syntax` antepone `https://` a esquemas no listados con sufijo numérico (p. ej. `foo:80/bar`). | **Solución propuesta:** Leer `answer_*` y rechazos completos desde hechos (o marcar `complete = false` al recortar) y detectar `^[a-zA-Z][a-zA-Z0-9+.-]*:` antes de anteponer `https://`.

32. **`[Hipótesis]` Posible inyección de `<obs>` en `render/thread.ts` y recuerdo `thread` sin acotar en `render/args.ts`**
    * **Archivo y línea:** `src/core/render/thread.ts:9-10`; `src/core/render/args.ts:99` | **Impacto:** Un literal `</obs>` en `previous.request`/`answer` rompe el delimitador del prompt, y los recuerdos `thread` (hasta 8000 chars) se renderizan sin `clipMarked` en los argumentos. | **Solución propuesta:** Aplicar `oneLine()` en `render/thread.ts:10` y acotar explícitamente `r.value` para `kind === "thread"` en `render/args.ts:99`.

33. **`[Hipótesis]` `isRepeat` compara anterioridad de `answer_*` mediante `Date.now()` con `>` estricto**
    * **Archivo y línea:** `src/core/ctx/derive.ts:252-258, 294` | **Impacto:** Cuando una llamada y una respuesta del usuario caen dentro del mismo milisegundo (`fact.at === c.at`), `isRepeat` evalúa a `false` y bloquea falsamente la llamada repetida posterior. | **Solución propuesta:** Comparar por orden lógico monotónico de aplicación en contexto (`seq`/versión de snapshot) o garantizar timestamps estrictamente crecientes.

34. **`[Hipótesis]` Condición de carrera y fuga de listeners de aborto durante el backoff de `postJson()`**
    * **Archivo y línea:** `src/core/models/transport.ts:148-151` | **Impacto:** No comprueba `signal.aborted` antes de esperar `LLM_TRANSPORT_BACKOFF_MS` (durmiendo todo el backoff si abortó entre el `catch` y la línea 148) ni desregistra el listener cuando el temporizador completa normalmente. | **Solución propuesta:** Verificar `if (signal.aborted)` antes de crear la promesa de espera y remover el listener de `"abort"` en un bloque `finally`.

35. **`[Hipótesis]` `warmUpModels()` ejecuta pings secuenciales y usa `AbortSignal.timeout()` sin limpieza**
    * **Archivo y línea:** `src/core/models/warmup.ts:27, 36-50` | **Impacto:** Espera secuencialmente el ping del modelo de decisión y el del generativo (duplicando la latencia de arranque si un servicio está lento o caído) y usa `AbortSignal.timeout()`. | **Solución propuesta:** Paralelizar ambos pings con `Promise.allSettled` y sustituir `AbortSignal.timeout()` por `AbortController` + `clearTimeout`.

36. **`[Hipótesis]` `list_folder` expone symlinks rotos/cíclicos como `[FILE]` de 0 B y no revisa `deadline` dentro del bucle interno**
    * **Archivo y línea:** `src/tools/files_read/listFolder.ts:228-230, 244-253, 275-285` | **Impacto:** El `catch` de `realpath` recurre a `lstat` listando enlaces no resolubles o fuera de raíz como `[FILE]` de 0 B, y en carpetas pobladas solo comprueba `deadline` al extraer cada directorio de la cola en lugar de por entrada. | **Solución propuesta:** Omitir symlinks no resolubles incrementando `skipped` y verificar `deps.now() >= deadline` en cada iteración de `dirEntries`.

37. **`[Hipótesis]` `OutputDecoder` retiene bytes CP850/CP1252 y `cleanTerminalText` limpia `\r\b` con bucle $O(N^2)$**
    * **Archivo y línea:** `src/tools/terminal/output.ts:29-36, 109-118, 144-161` | **Impacto:** Prompts Windows CP850/CP1252 terminados en `0x80..0xF4` sin salto de línea quedan trabados en `this.carry`, y `cleanTerminalText()` borra `\r` ante `\r\b` en un bucle cuadrático ante ráfagas de `\b`. | **Solución propuesta:** Limitar `incompleteTail()` a flujos UTF-8 válidos (o añadir flush diferido), excluir `\r` de la regex y resolver `\b` en una pasada lineal con pila.

38. **`[Hipótesis]` Descarte de `blacklist[].level` en `ConfigManager` frente a `policy/`, `engine/` y `ui/`**
    * **Archivo y línea:** `src/core/config.ts:244-253` (contraste `src/core/policy/blacklist.ts:29-38, 58, 123`; `src/core/engine/callAuthorize.ts:84-85`; `ui/types/api.ts:304-309`; `ui/components/SettingsModal/sections/SecuritySection.tsx:39-51`) | **Impacto:** `blacklistEntries()` omite `level` al normalizar y no hay selector en UI; si la configuración o un cliente incluye reglas `"sensitive"`, se degradan a `"blocked"` en tiempo de ejecución. | **Solución propuesta:** Conservar el campo `level` en `ConfigManager` al leer/persistir y exponer su selector en `SecuritySection.tsx`.

39. **`[Hipótesis]` Desfase de contrato en `toolTargets.ts` para `move_file`, `archive_files` y `write_file`**
    * **Archivo y línea:** `src/core/tools/toolTargets.ts:17, 21-22` (contraste `src/core/tools/manifest.ts:273-279`; `src/core/render/final.ts:107`; `src/tools/files_write/archiveFiles.ts:689-700`; `src/tools/files_write/writeFile.ts:98-104`) | **Impacto:** Declara `arg: "destination"` en `move_file` (cuando el esquema usa `items[].destination`), `needsParentFolder: false` en `archive_files` y fijo `true` en `write_file`, pudiendo impedir reportes `wrong_place` en `renderPlaceNote` o desalinear verificaciones según el flujo de ejecución. | **Solución propuesta:** Adaptar `toolTargets.ts` y `placedPathArg` para leer `items[].destination`, requerir carpeta padre en `archive_files` (`compress`) y considerar `createFolders` en `write_file`.

40. **`[Hipótesis]` Bloques `catch` vacíos o retornos neutros pueden ocultar fallos reales de disco, procesos o red**
    * **Archivo y línea:** `src/core/mcp/transport.ts:493-497`; `src/memory/index.ts:135-144`; `src/core/trace/files.ts:31-45`; `src/telegram/bot.ts:277, 404, 472, 485`; `src/tools/files_write/convertFile.ts:156-160, 166-170`; `src/core/taskLog.ts:374, 402, 417` | **Impacto:** En caso de ocurrir corrupción, errores de permisos o fallos en subprocesos/Telegram durante la ejecución, pueden quedar ocultos o confundirse con `ENOENT`/`404`. | **Solución propuesta:** Emitir `console.warn` ante excepciones inesperadas y diferenciar `ENOENT` de errores reales de E/S o JSON malformado.

41. **`[Confirmado]` Acoplamiento exclusivo a Windows (`win32`/`powershell.exe`) en herramientas montadas en todo SO y módulos base**
    * **Archivo y línea:** `server.tsx:99-113`; `src/tools/files_write/{deleteFile.ts:59-74, convertFile.ts:9-10}`; `src/tools/system/{clipboard,openOnScreen,pcSettings,power,stopProcess,systemInfo}.ts`; `src/tools/multimedia/*`; `src/core/environment.ts:46-59, 68-78`; `src/voice/opus.ts:13-25`; `src/telegram/bot.ts:480`; `src/core/mcp/transport.ts:486-504`; `src/core/policy/allowedDirs.ts:97` | **Impacto:** Registra proveedores `win32`-only sin filtro en otros SO, `getUserEnvironment()` omite carpetas de usuario fuera de Windows, `bot.ts` sugiere `winget` en cualquier plataforma y `transport.ts` usa `taskkill /T /F` en Windows frente a solo `SIGTERM` en POSIX. | **Solución propuesta:** Filtrar o proveer adaptadores POSIX (`XDG`, `gio trash`, grupos `PGID`) según `process.platform` y ajustar mensajes por SO.

42. **`[Confirmado]` Cuatro módulos de producción y rutas HTTP de `server.tsx`/`jarvisRouter.ts` sin tests**
    * **Archivo y línea:** `src/telegram/bot.ts`; `src/voice/opus.ts`; `src/core/mcp/{freeSearchMcp,stdioServer}.ts`; `server.tsx`; `src/server/jarvisRouter.ts` | **Impacto:** Ningún test importa o ejercita los 4 módulos ni cubre `GET /environment`, `GET /api/mcp/discover-all`, streaming binario `/tts`, `?format=full` o `POST /config` con cuerpo no-objeto. | **Solución propuesta:** Añadir suites unitarias y de integración HTTP dedicadas para los 4 módulos y las rutas y flujos pendientes.

43. **`[Confirmado]` Cobertura incompleta de fronteras entre capas en `tests/architecture.test.ts` y `tsconfig.json`**
    * **Archivo y línea:** `tests/architecture.test.ts`; `src/server/jarvisRouter.ts:9`; `tsconfig.json` | **Impacto:** `architecture.test.ts` no vigila `src/memory/` ni evita imports internos de `core/engine/` desde `server/`, y `tsconfig.json` omite `noUnusedLocals`/`noUnusedParameters` dejando pasar símbolos muertos. | **Solución propuesta:** Ampliar las reglas de `architecture.test.ts` hacia `memory/` y fachadas públicas, y habilitar `noUnusedLocals`/`noUnusedParameters` en `tsconfig.json`.

---

## 4. Hallazgos Bajos (13)

44. **`[Confirmado]` `POST /api/mcp/:server/call` invoca `Guard.evaluate` sin `scope` (`ProtectedPaths`)**
    * **Archivo y línea:** `src/server/mcpRouter.ts:69` | **Impacto:** Omite el argumento `scope` en la llamada a `Guard.evaluate(req.params.server, name, toolArgs)`, saltando la Regla B sobre rutas protegidas; actualmente resulta irrelevante frente a la API sin autenticación en desarrollo (#3), pero debe cubrirse antes de cerrar acceso externo. | **Solución propuesta:** Construir y pasar el `scope` con `ProtectedPaths` al invocar `Guard.evaluate` en `mcpRouter.ts:69`.

45. **`[Confirmado]` `download_file` acota `timeoutMs` a `300_000` en lugar de `defaultTimeoutMs` y llama dos veces a `getEnvironment()`**
    * **Archivo y línea:** `src/tools/web/downloadFile.ts:116-122, 397-402, 430-434` | **Impacto:** `parseArgs()` permite hasta `300_000` ms independientemente de `defaultTimeoutMs` (a diferencia de `maxBytes` con `defaultMaxBytes`), y la rama `args.folder` invoca `deps.getEnvironment()` dos veces seguidas de forma redundante. | **Solución propuesta:** Acotar `timeoutMs` contra `defaultTimeoutMs` en `parseArgs()` y retornar `{ targetPath, env }` desde `resolveFolderPath()`.

46. **`[Hipótesis]` Backoff SSE en `JarvisApi.listen()` ignora `signal` al cerrar y `RESULT_WAIT_MS` queda fuera de `stopTimers`**
    * **Archivo y línea:** `src/telegram/api.ts:87`; `src/telegram/bot.ts:181-186, 244, 504` | **Impacto:** Al detener Telegram durante un intento de reconexión SSE, `listen()` espera los 3000 ms completos de `RECONNECT_MS` antes de salir, y el timer final `RESULT_WAIT_MS` no se limpia en `stopTimers()`. | **Solución propuesta:** Cancelar la espera de `RECONNECT_MS` al dispararse `"abort"` en `signal` y registrar `RESULT_WAIT_MS` en `stopTimers`.

47. **`[Confirmado]` `Decision20Engine.score()` no verifica `signal.aborted` cuando `fragments.length === 0`**
    * **Archivo y línea:** `src/core/models/decision.ts:415-433` | **Impacto:** Al no existir comprobación de `signal?.aborted` al inicio del método, una llamada ya abortada con lista vacía retorna resultado normal en lugar de cancelación anticipada. | **Solución propuesta:** Comprobar `if (signal?.aborted)` antes de procesar o retornar en `Decision20Engine.score()`.

48. **`[Hipótesis]` Endpoints directos de `mcpRouter` sin `AbortSignal` ni caché TTL compartida**
    * **Archivo y línea:** `src/server/mcpRouter.ts:34, 82` | **Impacto:** `POST /:server/call` no cancela `callTool()` cuando el cliente HTTP aborta la petición y `GET /:server/tools` omite el caché TTL de `discoveryEngine`. | **Solución propuesta:** Pasar un `AbortSignal` vinculado a `req.on('close')` en `callTool()` y reutilizar el caché de `discoveryEngine` en `GET /:server/tools`.

49. **`[Hipótesis]` Ramas de borde en lectura de trazas comprimidas y sondas sin cobertura dedicada**
    * **Archivo y línea:** `src/core/trace/files.ts`; `src/core/engine/probes.ts`; `src/core/tools/probes.ts` | **Impacto:** Al carecer de pruebas unitarias directas o medición `c8`/`v8`, ramas como `gunzipSync` sobre archivos dañados y fallos del registro de sondas quedan sin verificación explícita. | **Solución propuesta:** Añadir casos unitarios específicos para descompresión de trazas y errores en el registro de sondas.

50. **`[Confirmado]` Ausencia de `package-lock.json` y de archivo de requisitos con pines para `phonon_server.py`**
    * **Archivo y línea:** `package.json:26-45`; `scripts/phonon_server.py:18-23` | **Impacto:** Las dependencias JS/TS (`typescript ^7.0.2`, `vite ^8.3.0`, `express ^4.21.2`) y Python (`numpy`, `ptts`, `uvicorn`, `fastapi`, `pydantic`) no quedan fijadas de forma reproducible entre entornos. | **Solución propuesta:** Versionar `package-lock.json` y crear un `requirements.txt` con versiones fijadas para `scripts/phonon_server.py`.

51. **`[Confirmado]` Logging no estructurado y `catch` de endpoints sin registro en servidor**
    * **Archivo y línea:** `server.tsx:241`; `src/server/jarvisRouter.ts:191-193, 203-205, 235-237, 337-339` | **Impacto:** Se mezclan idiomas y prefijos de etiqueta en `console.*` sin timestamps ni niveles configurables, y los errores `500` de `/state`, `/tasks/:taskId`, `/environment` y `/refresh-discovery` no se registran en consola. | **Solución propuesta:** Centralizar la bitácora en un logger estructurado y registrar los errores capturados en los handlers de `jarvisRouter.ts`.

52. **`[Confirmado]` Adaptaciones temporales `[AI-STUDIO-COMPAT]` / `DISABLE_HMR` y lectura síncrona de `index.html`**
    * **Archivo y línea:** `server.tsx:66-77, 82-87, 181-200`; `src/server/localOnly.ts:29-34`; `vite.config.ts:25-31` | **Impacto:** Dejan bloques comentados que desconectan `LOCAL_ORIGIN` en `localOnly.ts` y desincronizan `tests/http.test.ts:86`, además de ejecutar `fs.readFileSync('index.html')` en cada petición HTML en dev. | **Solución propuesta:** Controlar los modos sandbox y HMR mediante variables explícitas de entorno alineadas con `tests/http.test.ts` y leer `index.html` de forma asíncrona o cacheada.

53. **`[Confirmado]` Código e infraestructura muertos sin consumidores activos**
    * **Archivo y línea:** `server.tsx:27`; `src/core/tools/probes.ts`; `src/core/engine/probes.ts`; `src/core/result/extractors/index.ts:15-24` | **Impacto:** `isLoopbackHost`/`localOnly` no se usan en `server.tsx`, `probesOf()` siempre retorna `[]` al no existir sondas declaradas en `manifest.ts` y `ENTRIES = []` mantiene código sin extractores registrados. | **Solución propuesta:** Retirar los imports sin uso en `server.tsx` y depurar o mover a extensión opcional los circuitos sin consumidores (`probes`, `ENTRIES`).

54. **`[Hipótesis]` Símbolos, claves de configuración y banderas legacy de compatibilidad histórica**
    * **Archivo y línea:** `src/core/types/plan.ts:24-41`; `src/core/models/prompts.ts:10, 75, 221, 265-266`; `src/core/ctx/{types.ts:24, closure.ts:57, views/messages.ts:61}`; `src/core/render/messages.ts:19`; `ui/types/api.ts:13`; `ui/components/ProcessFlow/components/FailureAnalysis.tsx:26, 68`; `jarvis-config.json:45`; `src/core/config.ts:74, 203` | **Impacto:** Mantienen `ArgumentPromptData`, `PENDING_FACTS_LOOKUP = false`, `stopReason: "security_denied"` (ya no producido según `runTask.ts:23`) y `tracePath: "jarvis-traces.jsonl"`, aumentando el ruido de mantenimiento. | **Solución propuesta:** Verificar que ningún script externo dependa de `ArgumentPromptData`/`PENDING_FACTS_LOOKUP` antes de retirarlos, migrar `traceDir` y limitar `security_denied` a compatibilidad de lectura.

55. **`[Confirmado]` Documentación, `.env.example` y archivo Markdown en `src/` desalineados con el estado real**
    * **Archivo y línea:** `jarvis-config.json:51-52` (vs `docs/configuracion/CONFIGURACION.md:9-16`, `docs/arquitectura/ARCHITECTURE.md:69`, `docs/api/JARVIS_API.md:70`); `docs/pendientes/PENDIENTES_CODIGO.md:56-69`; `.env.example` (vs `server.tsx:64-65`); `src/tools/terminal/Revisión de la tool run_command (Jarvis).md` | **Impacto:** La documentación contradice los valores `false` de `autoMode`/`approvalTiers` y lista herramientas ya implementadas como pendientes; `.env.example` omite `HOST`/`PORT` y hay documentación suelta dentro de `src/`. | **Solución propuesta:** Sincronizar los docs y `PENDIENTES_CODIGO.md` con el código actual, añadir `HOST`/`PORT` a `.env.example` y reubicar el archivo `.md` dentro de `docs/`.

56. **`[Confirmado]` Comentarios internos, JSDoc y nombres históricos obsoletos en código, tests y eval**
    * **Archivo y línea:** `src/tools/multimedia/multimediaProvider.ts:4`; `src/tools/files_write/filesWriteProvider.ts:4`; `src/core/tools/manifest.ts:4-5, 15`; `docs/configuracion/CONFIGURACION.md:34`; `src/core/engine/outcomes.ts:18-19`; `tests/{files_tools.test.ts:2,137, readonly.test.ts:9, timeouts.test.ts:28-32}`; `eval/auto/fixtures/datasets/recovery_casos.jsonl:12` | **Impacto:** Conservan referencias falsas a herramientas sin integrar, cantidad previa de proveedores/MCPs, cierre por denegación del Guard (`outcomes.ts`) e identificadores retirados (`jarvis_files`, `create_directory`, `start_search`). | **Solución propuesta:** Actualizar comentarios, JSDoc y descripciones en tests/eval a los nombres y flujos vigentes.

---

## 5. Observaciones de diseño *(riesgo futuro, no un defecto actual)* (1)

57. **`[Confirmado]` Formatos persistidos sin esquema de versionado ni migración (`taskLog`, `trace`, `config`, `memory`)**
    * **Archivo y línea:** `src/core/taskLog.ts:33, 156-161, 191-217, 386-399`; `src/core/ctx/validate.ts:62-97`; `src/core/trace/recorder.ts:290-302`; `src/core/trace/files.ts:30-46`; `src/core/config.ts:288-341`; `src/memory/index.ts:68-99, 132-145` | **Impacto:** No falla hoy con los datos actuales, pero carece de adaptadores de migración (p. ej. si cambian `limits`, enums de `Op` o `TRACE_FORMAT_VERSION`) y `jarvis-config.json`/`memory.json` no incluyen campo de versión. | **Solución propuesta:** Planificar un campo de versión explícito y migradores tolerantes antes de introducir cambios incompatibles en esquemas persistidos.

---

## 6. Hallazgos Descartados (2)

1. **`[Descartado]` Keep-alive SSE en `jarvisRouter.ts:281` / bloqueo de apagado en `cleanShutdown` (`server.tsx:141-166`)**: `cleanShutdown` nunca cierra ni espera `http.Server` o los sockets SSE y termina llamando directamente a `process.exit(0)` (`server.tsx:165`), por lo que ni el `setInterval` ni los clientes SSE abiertos activan el timeout de 5 s.
2. **`[Descartado]` Cobertura de uso de paquetes JS/TS en `package.json` (sección 7.3 #3 previa)**: No representaba un defecto en el código sino ausencia de paquetes directos sin uso; la reproducibilidad por falta de lockfile ya queda cubierta en el hallazgo #50.

---

## 7. Puntos abiertos

1. **Definición formal de plataforma objetivo (Windows vs. multiplataforma POSIX)**: Definir explícitamente si producción soporta solo Windows (`win32`) o también Linux/macOS para filtrar en el registro o implementar adaptadores POSIX en herramientas del sistema, terminal, voz y procesos MCP.
2. **Endurecimiento de red y autenticación previa al despliegue fuera de loopback**: Definir el esquema de autenticación HTTP, parametrizar los bloques `[AI-STUDIO-COMPAT]` vía entorno y restaurar `localOnly()` (`Host`/`Origin`) junto a `isLoopbackHost()` y la cobertura de `scope` en `mcpRouter.ts:69`.
3. **Estrategia de evolución de esquemas persistidos (`taskLog`, `trace`, `config`, `memory`)**: Acordar si los archivos históricos requieren retrocompatibilidad automática (versionado + migración) antes de modificar `Op`, `limits`, trazas o `data/memory.json`.
4. **Plan de pruebas sobre módulos sin cobertura y validación de hipótesis en ejecución**: Incorporar suites para `telegram/bot.ts`, `voice/opus.ts`, `freeSearchMcp.ts`, `stdioServer.ts`, endpoints HTTP faltantes y cobertura `c8`, además de verificar en ejecución los escenarios `[Hipótesis]` críticos y altos.
5. **Retiro o finalización de circuitos sin uso y símbolos legacy**: Decidir si se implementan consumidores o se eliminan `probes`, `extractors/ENTRIES`, `ArgumentPromptData`, `PENDING_FACTS_LOOKUP`, `security_denied` y la clave legacy `tracePath`.

---

## Contexto de referencia (no contado como hallazgos)

### A. Estado de compilación, build y radiografía de `npm test`

* **`npm run lint` (`tsc --noEmit`)**: pasa sin errores.
* **`npm run build` (`vite build`)**: pasa sin errores.
* **`tests/architecture.test.ts`**: **15/15 pasan** (con las brechas estructurales descritas en el hallazgo #43).
* **`npm test`** *(751 tests en 12 suites)*: **690 pasan, 10 fallan, 24 cancelados, 27 omitidos** (`tests/web_search.test.ts:760` reproduce el hallazgo #5; el resto responde a entorno Linux, mocks desactualizados o `localOnly` desactivado en desarrollo):

| Suite / Línea | Resultado | Causa raíz |
| :--- | :--- | :--- |
| `tests/web_search.test.ts:760` | **24 cancelados** | Hallazgo #5: `AbortSignal.timeout()` *unref'd* en `src/tools/web/webSearchProvider.ts:260`. |
| `tests/approval_matrix.test.ts` (4 casos `run_modify`) | **4 fallos** | Test en Linux usa `os.tmpdir()` (`/tmp/...`) con `platform: "windows"`; `precheck.ts:580-585` (`linux-path-in-command`) lo rechaza antes de aprobar. |
| `tests/approval_matrix.test.ts:373` | **1 fallo** | Mock `FAKE_DISK.isDirectory` (`tests/fixtures.ts:127`) asume extensión en archivos; `.ssh/id_rsa` falla en `postcondition.ts:54` (`totalAsked === 3` vs `2`). |
| `tests/engine.test.ts:342` | **1 fallo** | Mock `pendingFor` repite el mismo ítem dos veces, mientras `ReactiveList.completeHead()` + `reconcileList()` (`reactiveList.ts:103-110, 140-145`) deduplica completados. |
| `tests/eval_arguments.test.ts:84` / `tests/run_command.test.ts:180` | **3 fallos** (2 + 1) | Esperados en Linux: analizador AST de PowerShell y `TerminalProvider.listTools()` exigen `process.platform === "win32"`. |
| `tests/http.test.ts:86` | **1 fallo** | Esperado en dev: `localOnly()` está comentado en `server.tsx:87` y `src/server/localOnly.ts:32-34`. |

### B. Mitigaciones verificadas frente a la exposición de desarrollo (#3)

* Aunque los endpoints HTTP están abiertos en desarrollo (#3), existen protecciones parciales activas: `POST /api/jarvis/config` filtra `FILE_ONLY_KEYS`/`LAUNCH_ONLY_KEYS` (`withoutLaunchFields`), `GET/POST /config` oculta `env` de MCP (`sanitizeConfigForHttp`) y `TerminalProvider` remueve secretos de `.env` y `SECRET_KEYS` (`server.tsx:49-61, 115`). Aun así, la cadena de autorización mantiene brechas pendientes documentadas en #2, #4, #12, #18 y #44.

### C. Áreas aún sin revisión exhaustiva línea por línea

* **`src/tools/files_write/`**: `archiveFiles.ts`, `convertFile.ts`, `deleteFile.ts`, `editFile.ts` y `writeFile.ts` ya fueron revisados en la pasada final (sección 8, solo análisis estático). Sigue sin revisión integral `filesWriteProvider.ts`.
* **`src/tools/system/` y `src/tools/multimedia/`**: ya revisados en la pasada final (sección 8, solo análisis estático). Pendiente únicamente la ejecución real en `win32`/PowerShell/`ffmpeg`.
* **Módulos periféricos de `src/core/`**: revisión integral de `config.ts`, `environment.ts`, `taskLog.ts`, `retention.ts`, `refs/refVault.ts`, `result/*`, `tools/{globPattern,host,manifest,provider,result,toolTargets}.ts`, `mcp/{discovery,transport,stdioServer,freeSearchMcp}.ts`, `trace/{files,recorder}.ts`, `timeouts.ts`, `text.ts` y `utils.ts`.
* **`src/voice/` (resto)**: revisión integral de `tts.ts` y `opus.ts`.
* **Frontend, evaluación y scripts**: toda la carpeta `ui/`, la carpeta `eval/` y los scripts auxiliares de `scripts/` (salvo las referencias puntuales ya revisadas).

---

## 8. Pasada final: `files_write` (parcial), `system` y `multimedia` (5)

### Hallazgos nuevos

58. **`[Confirmado]` `stop_process` permite comodines en `name` y omite validar `PROTECTED_PROCESS_NAMES` al detener por `pid`**
    * **Archivo y línea:** `src/tools/system/stopProcess.ts:66-90, 167-169, 192, 216-230` | **Severidad:** Alta | **Nota de etiquetado:** son hechos observables leyendo el código (no se compara `$p.ProcessName` con `PROTECTED_PROCESS_NAMES` en `PS_STOP_BY_PID` y `Get-Process -Name` admite comodines); el impacto descrito a continuación es `[Hipótesis]` y depende de si la cadena de aprobación lo cubre | | **Impacto:** `PS_STOP_BY_PID` no verifica `$p.ProcessName` contra `PROTECTED_PROCESS_NAMES`, y `runStopProcess`/`PS_STOP_BY_NAME` admiten comodines de PowerShell (`*`, `?`, `[...]`) en `Get-Process -Name`, permitiendo terminar procesos críticos del SO (`lsass`, `csrss`, `wininit`, `svchost`) o procesos ajenos en bloque. | **Solución propuesta:** Rechazar comodines (`*?[]`) en `name` y filtrar explícitamente `PROTECTED_PROCESS_NAMES` sobre el nombre real dentro de `PS_STOP_BY_PID` y `PS_STOP_BY_NAME` antes de `Stop-Process`.

59. **`[Hipótesis]` `open_on_screen` omite `allowedDirectories` y validación de esquemas con `type: "app"` o rutas relativas**
    * **Archivo y línea:** `src/tools/system/openOnScreen.ts:68-90, 141-144` | **Severidad:** Alta | **Impacto:** `inferKind()` respeta `type: "app"` sin validar rutas ni URLs y clasifica rutas relativas (`..\...`, `C:archivo`) como `"app"`, mientras `validateSafeAppTarget()` solo bloquea `/[\r\n\0;|&`<>]/`, permitiendo abrir rutas fuera de `allowedDirectories`, rutas UNC (`\\host\share`), scripts o esquemas arbitrarios vía `Start-Process` (agravado por `#18`). | **Solución propuesta:** Restringir `"app"` a nombres simples sin separadores de ruta, `:`, prefijos UNC ni esquemas (validando con `resolveExistingPath` todo objetivo con `/` o `\`), cualquiera sea `type`.

60. **`[Hipótesis]` `archive_files` (`extract`) y `write_file` (`createFolders: true`) ejecutan `mkdir(..., { recursive: true })` antes de validar `realpath` en ancestros**
    * **Archivo y línea:** `src/tools/files_write/archiveFiles.ts:387-391`; `src/tools/files_write/writeFile.ts:182-187, 203` | **Severidad:** Media | **Impacto:** Si un segmento padre dentro de `allowedDirectories` es un enlace simbólico saliente, `fs.promises.mkdir(..., { recursive: true })` crea directorios fuera de `allowedDirectories` en disco antes de ejecutar `realpath()` o `inspectDestinationTarget()`. | **Solución propuesta:** Resolver por `realpath` el ancestro existente más profundo y verificar `isCanonicalWithinAllowedDirs()` (como en `archiveFiles.ts:694-697`) antes de invocar `mkdir()`.

61. **`[Hipótesis]` `convert_file` valida `same_path` solo por ruta léxica, exponiendo el origen a truncamiento vía symlink o mayúsculas**
    * **Archivo y línea:** `src/tools/files_write/convertFile.ts:392-396, 406` | **Severidad:** Alta | **Impacto:** Compara únicamente `dstResolved.targetPath === srcResolved.targetPath` sin revisar `srcResolved.realTarget` ni ruta canónica; con `overwrite: true` sobre un symlink destino que apunta al origen (o distinta capitalización en Windows), `ffmpeg -y` o `System.Drawing` pueden truncar o bloquear el propio archivo fuente (análogo a `#7`). | **Solución propuesta:** Comparar `canonicalPath(srcResolved.realTarget)` contra `canonicalPath(dstResolved.targetPath)` y contra `dstInspection.realTarget` cuando el destino exista.

62. **`[Hipótesis]` `convert_file` escribe directamente sobre el destino sin archivo temporal, destruyendo datos ante error o cancelación**
    * **Archivo y línea:** `src/tools/files_write/convertFile.ts:95, 119, 221, 253, 428-442` | **Severidad:** Media | **Impacto:** Pasa `req.destinationPath` directo a `ffmpeg -y` y `Bitmap.Save()`; si la conversión falla, excede `timeoutMs` o se cancela con `overwrite: true`, el destino previo queda truncado o corrupto (patrón análogo a `#6`). | **Solución propuesta:** Convertir a un archivo temporal en el mismo directorio preservando la extensión (`.tmp.<ext>`) y reemplazar el destino con `rename` atómico al finalizar, limpiando el temporal en `finally`.

### Hallazgos previos aplicables a estas herramientas

* **`#6`**: Escritura no atómica en `editFile.ts:177-178` y `writeFile.ts:135`, más recodificación UTF-8 forzada en `editFile.ts`.
* **`#26`**: Buffering completo en RAM al comprimir y extraer en `archiveFiles.ts:529, 611, 807`.
* **`#39`**: Desfase de contrato en `toolTargets.ts` respecto a `archiveFiles.ts:689-700` (`compress`) y `writeFile.ts:98-104` (`createFolders`).
* **`#40`**: Bloques `catch` vacíos en `convertFile.ts:156-160, 166-170` (mismo patrón en `clipboard.ts:93-95, 103-105` al hacer `child.kill()`).
* **`#41`**: Acoplamiento exclusivo a `win32`/`powershell.exe` en `deleteFile.ts:59-74`, `convertFile.ts:9-10`, `src/tools/system/*` y `src/tools/multimedia/*`.
* **`#56`**: Comentario obsoleto sobre falta de integración a D1/D2 en `multimediaProvider.ts:4` (extensible a `systemProvider.ts:5`).

### Alcance revisado y partes no revisadas de esta pasada

* **Cobertura completa en estas rutas:** Se leyó el 100 % de los 15 archivos incluidos en el alcance (`deleteFile.ts`, `editFile.ts`, `writeFile.ts`, `archiveFiles.ts`, `convertFile.ts`, los 7 archivos de `src/tools/system/` y los 3 de `src/tools/multimedia/`).
* **No revisado dentro de este alcance:** Ejecución real en `win32`/PowerShell/`ffmpeg` (solo análisis estático) ni módulos importados fuera de estas rutas (p. ej. `src/core/tools/filePaths.ts` o los tests asociados).

### Conteo final consolidado

* **Por severidad:** **Crítica:** 2 (`0` Confirmado, `2` Hipótesis) · **Alta:** 18 (`3` Confirmado, `15` Hipótesis) · **Media:** 28 (`5` Confirmado, `23` Hipótesis) · **Baja:** 13 (`9` Confirmado, `4` Hipótesis).
* **Total de hallazgos:** **61** (`17 [Confirmado]`, `44 [Hipótesis]`), más **1** observación de diseño `[Confirmado]` y **2** descartados.