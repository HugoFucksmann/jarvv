# Auditoría técnica integral del backend (`src/`)

**Fecha:** 2026-11-22  
**Alcance:** Exclusivamente los módulos del backend ubicados en `src/` (`server`, `core`, `memory`, `tools`, `telegram`, `voice`). Se excluyen frontend/UI, documentación, archivos externos a `src/` y evaluación de seguridad, permisos o políticas de acceso.  
**Verificación estática:** `npx tsc --noEmit` ejecutado sobre el estado actual finalizó con código de salida `0` (sin errores de tipos).

---

## 1. Problemas críticos

### CRIT-01 — Desajuste de contrato en reglas asíncronas del pre-chequeo
- **Severidad:** Crítica *(riesgo potencial latente por contrato inconsistente; error confirmado si se registra una regla asíncrona en `VALUE_RULES` o `SOURCE_RULES`)*
- **Archivo y ubicación:** `src/core/engine/precheck.ts:389-393, 527-544, 630-638`
- **Descripción del problema:** La interfaz `PrecheckRule<C>` declara `check` con retorno `PrecheckFinding | null | Promise<PrecheckFinding | null>`, pero el evaluador `firstValueFinding` invoca `rule.check(ctx)` de forma síncrona sin `await`.
- **Evidencia y explicación técnica:** En `precheckCall` (línea 634) se ejecuta `const found = await rule.check(ctx);` sobre `CALL_RULES`. Sin embargo, `firstValueFinding` (líneas 527-544) es síncrona y realiza `const found = rule.check(ctx) as PrecheckFinding | null; if (found !== null) return found;` (líneas 538-539). Las reglas actuales de `VALUE_RULES` y `SOURCE_RULES` devuelven valores síncronos, pero el contrato de tipos permite reglas que devuelvan una `Promise`.
- **Consecuencia posible:** Cualquier regla de valor u origen que devuelva una `Promise` (incluso resolviendo a `null`) retorna un objeto `Promise` distinto de `null`, haciendo que `firstValueFinding` aborte la evaluación y rechace llamadas válidas con un `PrecheckFinding` corrupto (`review` y `reason` `undefined`).
- **Solución recomendada:** Convertir `firstValueFinding` en `async` y hacer `await rule.check(ctx)` antes de comparar contra `null`, o restringir `VALUE_RULES` y `SOURCE_RULES` a un tipo síncrono dedicado (`SyncPrecheckRule`).

---

### CRIT-02 — Pérdida permanente del archivo de destino en movimientos `EXDEV` de enlaces simbólicos con `overwrite: true`
- **Severidad:** Crítica *(error confirmado en ruta de fallback entre volúmenes)*
- **Archivo y ubicación:** `src/tools/files_write/moveFile.ts:199-217, 270-279`
- **Descripción del problema:** Cuando se mueve un enlace simbólico a archivo entre distintos volúmenes (`EXDEV`) con `overwrite: true`, el archivo existente en destino se elimina antes de crear el nuevo enlace y sin respaldo de reversión.
- **Evidencia y explicación técnica:** El mecanismo de respaldo (`backupPath` en líneas 242-278) solo se ejecuta si `srcResolved.isDirectory` es verdadero (línea 271). Si `src` es un enlace simbólico a archivo (`srcResolved.isSymlink === true` y `srcResolved.isDirectory === false`) sobre un archivo existente, `rename()` (línea 201) falla con `EXDEV` y entra en las líneas 211-216: la línea 213 ejecuta `await fs.promises.rm(dstResolved.targetPath, { force: true })` **antes** de `symlink()` (línea 214) y `unlink()` (línea 215). Además, cuando `srcResolved.isDirectory` es verdadero, las líneas 273/276 ya eliminaron o movieron `dst` a respaldo, por lo que `dstExists` en la línea 213 queda desactualizado.
- **Consecuencia posible:** Si `fs.promises.symlink` falla tras borrar el destino (por límites del sistema, ruta inválida o error de E/S), el archivo original en destino se pierde de forma irreversible.
- **Solución recomendada:** Unificar la estrategia de respaldo temporal para archivos y enlaces cuando `dstExists && overwrite` en la rama `EXDEV` (renombrar `dst` a temporal, crear el symlink, borrar origen y luego borrar el respaldo; restaurar si falla).

---

### CRIT-03 — Recursión infinita sin cota en `TerminalProvider.start` si el archivo de helpers desaparece tras escribirse
- **Severidad:** Crítica *(riesgo potencial de bloqueo/cuelgue del proceso ante interferencia externa en temporales)*
- **Archivo y ubicación:** `src/tools/terminal/terminalProvider.ts:353-363`
- **Descripción del problema:** Al detectar `HELPERS_UNAVAILABLE_EXIT` (código 97), `start()` borra la caché `this.helpersFile` y vuelve a llamarse recursivamente sin límite de reintentos ni inhabilitación de helpers cuando el archivo no existe en disco.
- **Evidencia y explicación técnica:** En las líneas 354-362, si `tracked.helpersUnavailable` es verdadero y `!fs.existsSync(this.helpersFile)` se cumple (línea 356), solo hace `this.helpersFile = undefined;` y ejecuta `return this.start(command, cwd, waitMs, options);` (línea 362) sin decrementar `waitMs`, sin contar reintentos y sin activar `this.helpersDisabled = true`.
- **Consecuencia posible:** Si un agente externo (limpiador de temporales o antivirus en tiempo real) elimina `helpers-*.ps1` entre `ensureHelpersFile()` (línea 369) y la lectura por PowerShell, `start()` entra en recursión indefinida lanzando subprocesos `powershell.exe` en bucle hasta agotar pila/recursos o cancelarse externamente.
- **Solución recomendada:** Permitir como máximo un único reintento de reescritura por invocación de `start()` (p. ej. con un flag `retriedHelpers`); si vuelve a fallar con `HELPERS_UNAVAILABLE_EXIT`, fijar `this.helpersDisabled = true` y relanzar con helpers desactivados.

---

### CRIT-04 — Errores de entidad inexistente de herramientas nativas clasificados como `tool_error` en lugar de `not_found`
- **Severidad:** Crítica *(error confirmado en el flujo de extremo a extremo entre proveedores nativos y `processResult`)*
- **Archivo y ubicación:** `src/core/result/processResult.ts:127-147`, `src/core/result/extractors/structured.ts:17-40`, `src/core/tools/filePaths.ts:269, 328, 347`, `src/tools/system/stopProcess.ts:245`
- **Descripción del problema:** Las herramientas nativas reportan recursos inexistentes mediante `data.reason = "not_found"` con `isError: true`, pero `processResult` ignora ese campo y clasifica casi todos esos fallos como `tool_error`.
- **Evidencia y explicación técnica:** Proveedores nativos como `read_file`, `edit_file`, `delete_file`, `copy_file`, `convert_file`, `archive_files`, `open_on_screen` y `stop_process` emiten `isError: true` junto con `data: { reason: "not_found", ... }`. Sin embargo, sus textos usan mensajes como `"Path does not exist: '...'"`, `"Folder does not exist: '...'"` o `"No running process matched ..."` (`filePaths.ts:269, 328, 347`, `stopProcess.ts:245`). En `processResult.ts:127-129`, `notFound` solo busca las subcadenas literales `"[NOT_FOUND]"`, `"not found"`, `"enoent"` o `"no such file or directory"`, y ni `processResult` ni `extractStructured` inspeccionan `native.data.reason === "not_found"`.
- **Consecuencia posible:** Se pierde la distinción funcional entre un fallo de ejecución (`tool_error`) y un objetivo inexistente (`not_found`), invalidando las notas específicas de escritura en `src/core/ctx/views/messages.ts:31-33` (`WRITE_NOT_FOUND_NOTE`) y afectando las reglas de derivación y reintento (`src/core/ctx/derive.ts`).
- **Solución recomendada:** Considerar `notFound = true` en `processResult` (o propagar una señal desde `extractStructured`) cuando `isError === true && native?.data.reason === "not_found"`, manteniendo sin cambios el caso `isError === false && data.state === "not_found"` que `web_search` mapea intencionalmente a `no_data`.

---

## 2. Problemas importantes

### IMP-01 — E/S síncrona en rutas periódicas y asíncronas que bloquea el event loop
- **Severidad:** Importante *(deficiencia estructural confirmada)*
- **Archivo y ubicación:**
  - `src/core/retention.ts:100, 223` y `src/core/taskLog.ts:348-351, 370`
  - `src/core/engine/precheck.ts:121-182`
  - `src/core/trace/format.ts:154-202`
  - `src/voice/opus.ts:11-28`
- **Descripción del problema:** Múltiples funciones asíncronas del motor, mantenimiento en segundo plano y voz ejecutan lecturas completas de disco y recorridos de directorios mediante APIs `fs.*Sync`.
- **Evidencia y explicación técnica:**
  - `runRetention` (en arranque y cada 6 horas) llama a `isTaskLogTerminal(full)` en `pruneLogFiles` y nuevamente en `collectSizedLogs`; `isTaskLogTerminal` invoca `readTaskLog()`, que lee todo el `.jsonl` con `fs.readFileSync`, hace `JSON.parse` por línea y reproduce todo el `TaskContext`, pese a existir `summarizeClosedTaskLog` (`taskLog.ts:370`).
  - `collectSources` (`precheck.ts:146-182`) llama a `readRefText` (`openSync`/`readSync` hasta 400 KB por ref) de forma síncrona antes de preparar llamadas.
  - `refInfos` y `readGitSha` (`trace/format.ts:154-202`) leen refs y `.git/HEAD` (con ruta relativa al `cwd`) mediante `openSync`/`readSync`/`readFileSync` durante el guardado de trazas.
  - `ffmpegBin()` (`voice/opus.ts:11-28`) recorre `WinGet\Packages` con `readdirSync` y `existsSync` en cada comprobación o conversión sin caché.
- **Consecuencia posible:** Microcortes o bloqueos perceptibles del event loop en peticiones HTTP activas, streaming SSE/TTS y bot de Telegram al crecer el historial de logs/refs.
- **Solución recomendada:** Usar una lectura asíncrona ligera de cabecera/cola en `retention.ts` (evitando además inspeccionar los mismos logs dos veces entre `pruneLogFiles` y `collectSizedLogs`), migrar `readRefText` y `readHead` a `fs.promises` y cachear la resolución de `ffmpegBin()`.

---

### IMP-02 — Bufferización íntegra en RAM en `archive_files` y lectura sin límite en `clipboard`
- **Severidad:** Importante *(riesgo potencial de picos de memoria / OOM)*
- **Archivo y ubicación:** `src/tools/files_write/archiveFiles.ts:544-620, 807`; `src/tools/system/clipboard.ts:68, 117-128`
- **Descripción del problema:** Ambas herramientas retienen cargas completas de gran tamaño en buffers de memoria simultáneamente en lugar de procesar incrementalmente o acotar lecturas.
- **Evidencia y explicación técnica:**
  - En `archiveFiles.ts:807`, `extract` carga el ZIP completo en RAM con `await fs.promises.readFile(srcResolved.realTarget)` (hasta `512 MB` por defecto) antes de parsear el directorio central; en `compress` (`collectCompressEntries`, líneas 544-620), acumula todos los `Buffer` descomprimidos de todos los archivos en memoria antes de escribir el ZIP.
  - En `clipboard.ts:68, 117`, `runPowerShellIo` acumula todos los fragmentos de `stdout` en `stdoutChunks` sin tope de bytes (a diferencia de `stderr` en líneas 118-123, acotado a 64 KB, y de `write` en línea 186, acotado a `1_000_000` caracteres).
- **Consecuencia posible:** Presión severa de heap o caída del proceso Node ante archivos ZIP cercanos al límite configurado o ante un portapapeles con decenas/cientos de MB.
- **Solución recomendada:** En `archiveFiles.ts`, leer el EOCD y cada entrada de ZIP por offset usando `FileHandle.read` en extracción y comprimir entrada por entrada en flujo en `compress`; en `clipboard.ts`, imponer un tope de lectura en `stdoutChunks` acorde con `MAX_CLIPBOARD_WRITE_CHARS`.

---

### IMP-03 — Conteo inconsistente (`shown: 1` con `total: 0`) en `system_info` sin resultados
- **Severidad:** Importante *(error confirmado en contrato de salida estructurada)*
- **Archivo y ubicación:** `src/tools/system/systemInfo.ts:591-611, 629-648, 780-792`
- **Descripción del problema:** Cuando el filtro de `processes`, `ports` o `services` devuelve cero elementos, el campo numérico `shown` en `data.sections` reporta `1`.
- **Evidencia y explicación técnica:** Cuando `limited.length === 0`, se asigna a `lines` un mensaje placeholder de 1 línea (`["No matching processes."]`, `["No listening ports matched."]`, `["No matching services."]`). Luego `data.sections.<sección>.shown` toma `fitted.shown.length`, produciendo `{ total: 0, shown: 1, items: [] }`.
- **Consecuencia posible:** Consumidores programáticos o verificadores que lean `data.sections.*.shown` interpretan que se mostró 1 registro cuando `items` está vacío y `total` es 0.
- **Solución recomendada:** Asignar `shown: limited.length === 0 ? 0 : fitted.shown.length` en las tres secciones.

---

### IMP-04 — Subproceso `ffmpeg` en `voice/opus.ts` no consume `stderr` y oculta errores reales
- **Severidad:** Importante *(error confirmado de gestión de flujos de subproceso)*
- **Archivo y ubicación:** `src/voice/opus.ts:41-55`
- **Descripción del problema:** `pcmToOggOpus` lanza `ffmpeg` con `stderr` entubado (`pipe` por defecto) sin registrar lector de `data` ni capturar su salida de error.
- **Evidencia y explicación técnica:** Las líneas 43-51 solo leen `ff.stdout.on("data", ...)` y al fallar rechazan con ``new Error(`ffmpeg terminó con código ${code}`)``. No existe ningún listener sobre `ff.stderr`.
- **Consecuencia posible:** Si `ffmpeg` escribe más de ~64 KB en `stderr` (límite del pipe), puede quedar bloqueado sin cerrar; si falla con pocos bytes de error, se pierde el diagnóstico real del fallo.
- **Solución recomendada:** Consumir `ff.stderr` en un buffer acotado (p. ej. 16-64 KB) e incluir la última línea relevante en el mensaje de rechazo.

---

### IMP-05 — Duplicación del timeout efectivo ante fallo de `PS_RADIO_SCRIPT` en `pc_settings` (`wifi`)
- **Severidad:** Importante *(error confirmado en manejo de timeouts)*
- **Archivo y ubicación:** `src/tools/system/pcSettings.ts:175-184, 207-220`
- **Descripción del problema:** El bloque `try/catch` de fallback en `wifi` (`get` y `set`) captura cualquier error, incluido un vencimiento de timeout, y lanza un segundo subproceso PowerShell con el presupuesto completo nuevamente.
- **Evidencia y explicación técnica:** En `get("wifi")` (líneas 176-183) y `set("wifi")` (líneas 208-219), `runPs(PS_RADIO_SCRIPT, ..., timeoutMs, signal)` tiene un `catch {}` vacío que continúa ejecutando `runPs(PS_GET_WIFI, ..., timeoutMs, signal)` o `PS_SET_WIFI`. Aunque una cancelación por `signal` aborta de inmediato el segundo intento, un timeout por exceso de `timeoutMs` en el primer script vuelve a conceder otros `timeoutMs` completos al segundo.
- **Consecuencia posible:** La operación puede tardar hasta `2 * timeoutMs` superando el límite efectivo pactado con el motor (`options.timeoutMs` menos margen).
- **Solución recomendada:** Calcular un `deadline = Date.now() + timeoutMs`, no reintentar si el error fue timeout o cancelación (`signal?.aborted` o `killed`), y pasar al fallback únicamente el tiempo restante (`Math.max(deadline - Date.now(), 1)`).

---

### IMP-06 — Efecto secundario prematuro en `write_file` con `createFolders: true`
- **Severidad:** Importante *(error confirmado de orden de validaciones)*
- **Archivo y ubicación:** `src/tools/files_write/writeFile.ts:182-250`
- **Descripción del problema:** `runWriteFile` crea los directorios padre en disco antes de validar el destino final y antes de comprobar si la extensión está soportada.
- **Evidencia y explicación técnica:** `await fs.promises.mkdir(parentDir, { recursive: true })` se ejecuta en la línea 184, mientras que `inspectDestinationTarget` se evalúa en la línea 203 y la comprobación de formatos estructurados no soportados (`STRUCTURED_EXTS.has(ext)`) ocurre en la línea 245.
- **Consecuencia posible:** Una llamada fallida a `write_file` con `createFolders: true` (por ejemplo, sobre una extensión `.docx`/`.pdf` no soportada o un destino que posteriormente falla inspección) deja carpetas vacías creadas en disco como efecto secundario.
- **Solución recomendada:** Validar extensión/driver soportado e inspeccionar las condiciones previas del destino antes de crear carpetas padre.

---

### IMP-07 — Limpieza incompleta de estado y cierre no esperado en `StdioMcpTransport`
- **Severidad:** Importante *(error confirmado de ciclo de vida y manejo de errores)*
- **Archivo y ubicación:** `src/core/mcp/transport.ts:191-205, 470-507`
- **Descripción del problema:** `close()` lanza `taskkill` sin aguardar la terminación del proceso ni escuchar errores de `spawn`, y el manejador `child.on("error")` no limpia `this.childProcess`.
- **Evidencia y explicación técnica:**
  - En `close()` (líneas 484-506), en Windows ejecuta `spawn("taskkill", ...)` sin listener `"error"` y sin esperar la salida del subproceso; sin embargo `reconnect()` (líneas 473-474) llama inmediatamente a `await this.close()` seguido de `await this.listTools()`, solapando el cierre con el nuevo arranque.
  - En `child.on("error")` (líneas 191-205), a diferencia de `child.on("exit")` (línea 211), no se limpia `this.childProcess = null`, dejando la referencia viva para que un `close()` posterior intente matar un proceso que nunca arrancó.
- **Consecuencia posible:** Posibles errores no capturados si `taskkill` falla al crearse, procesos zombis/conflictos transitorios al reconectar y operaciones de cierre redundantes tras fallo de arranque.
- **Solución recomendada:** Esperar el evento `exit`/`close` del hijo con un timeout breve de gracia en `close()`, adjuntar `.once("error", ...)` al proceso de `taskkill` y asignar `this.childProcess = null` también dentro de `child.on("error")`.

---

### IMP-08 — Inconsistencia en enlaces simbólicos rotos y riesgo de bloqueo por regex en `files_read`
- **Severidad:** Importante *(inconsistencia confirmada y riesgo potencial de bloqueo de CPU)*
- **Archivo y ubicación:** `src/tools/files_read/listFolder.ts:275-285` vs `src/tools/files_read/findFiles.ts:238` / `src/tools/files_read/searchContent.ts:416`; `src/tools/files_read/searchContent.ts:164-166, 221-235`
- **Descripción del problema:** `listFolder` trata los enlaces simbólicos rotos como archivos regulares de 0 bytes mientras `findFiles` y `searchContent` los omiten; además `searchContent` ejecuta expresiones regulares arbitrarias de forma síncrona por línea sobre archivos de hasta 2 MB.
- **Evidencia y explicación técnica:**
  - En `listFolder.ts:275-285`, cuando `realpath` falla en un symlink roto, el bloque `catch` llama a `lstat` y marca `isFile = true` (con `size = 0`). En `findFiles.ts` y `searchContent.ts` ese mismo caso incrementa `skipped` y omite la entrada.
  - En `searchContent.ts:165-166`, `new RegExp(query, ...)` se ejecuta por cada línea dentro de un bucle `for await` que solo cede al event loop cada 64 archivos (`YIELD_EVERY_ENTRIES`), no por líneas o archivos grandes de una sola línea.
- **Consecuencia posible:** Resultados divergentes entre herramientas del mismo módulo `files_read` y posible congelamiento del event loop ante patrones con backtracking catastrófico sobre líneas largas (que ningún `timeoutMs` puede interrumpir mientras corre `re.test` en el hilo principal).
- **Solución recomendada:** Alinear `listFolder` con `findFiles`/`searchContent` respecto a symlinks rotos (omitirlos o distinguirlos explícitamente) y limitar la longitud de línea/complejidad en modo `regex` o ceder periódicamente dentro de archivos grandes.

---

### IMP-09 — `speechExcerpt` en `voice/tts.ts` puede superar el límite `max`
- **Severidad:** Importante *(error confirmado por off-by-one y caso límite sin corte)*
- **Archivo y ubicación:** `src/voice/tts.ts:43-50`
- **Descripción del problema:** La función `speechExcerpt` no contabiliza el espacio separador en la comprobación de límite y devuelve íntegra la primera frase si esta ya supera `max`.
- **Evidencia y explicación técnica:** En la línea 46 comprueba `if (spoken && spoken.length + sentence.length > max) break;` y en la línea 47 concatena `` `${spoken} ${sentence}` `` (+1 carácter del espacio, superando `max` por 1). Además, si `spoken` está vacío y la primera oración excede `max` (p. ej. >1500 caracteres sin puntuación terminal), la función retorna la oración completa sin recortar, a diferencia de `splitForSpeech` (líneas 29 y 37-39).
- **Consecuencia posible:** Envío de textos que exceden el límite esperado por el cliente TTS o las notas de voz de Telegram cuando la respuesta carece de signos de puntuación frecuentes.
- **Solución recomendada:** Sumar `+ 1` en la condición (`spoken.length + 1 + sentence.length > max`) y recortar en límite de palabra/carácter cuando la primera frase supere `max`.

---

### IMP-10 — Otros comportamientos asimétricos e inconsistencias técnicas en `core` y `files_write`
- **Severidad:** Importante *(inconsistencias confirmadas)*
- **Archivo y ubicación:**
  - `src/core/tasks.ts:487-494`: `TaskManager.prune()` solo cancela como máximo una tarea en espera (`find(...)`) de forma asíncrona, por lo que `this.tasks.size` puede crecer por encima de `MAX_RETAINED_TASKS` ante ráfagas de tareas en espera.
  - `src/core/environment.ts:46-59, 67-79`: `getUserEnvironment()` invoca `powershell.exe` incondicionalmente incluso cuando `process.platform !== "win32"`, provocando fallos `ENOENT` y warnings en el arranque en Linux/macOS.
  - `src/tools/files_write/moveFile.ts:229-230`: el fallback `EXDEV` de carpetas invoca `copyPathControlled` con constantes fijas `DEFAULT_COPY_MAX_ENTRIES` y `DEFAULT_COPY_MAX_BYTES` en lugar de aceptar los límites configurables desde `MoveFileDeps` / `FilesWriteProvider`.
  - `src/core/render/shared.ts:49-55` frente a `src/core/render/args.ts:121`, `src/core/render/plan.ts` y `src/core/render/final.ts`: `Rendered.overflow` funciona como bandera booleana únicamente en `renderArgs`, mientras que `renderPlan` y `renderFinal` lanzan `ContextOverflowError` dentro de `effectEntries()`, por lo que `overflow` es siempre `false` en su retorno.
- **Consecuencia posible:** Retención excedida en memoria, ruido innecesario en entornos no Windows, ignorancia de configuración de límites en `move_file` entre volúmenes y ambigüedad de contrato en los renderizadores.
- **Solución recomendada:** Evitar `queryKnownFolders()` fuera de Windows, propagar límites configurables a `MoveFileDeps`, unificar la convención de desbordamiento en `render/*` y convertir `prune()` en un bucle acotado cuando deba reducirse el excedente.

---

## 3. Problemas menores

### MIN-01 — Código muerto, propiedades sin uso y ramas redundantes
- **Severidad:** Menor *(código legacy / mantenimiento)*
- **Archivo y ubicación:**
  - `src/core/tools/toolTargets.ts:9-25`: La propiedad `WriteTarget.needsParentFolder` se define y rellena en los 8 elementos del mapa privado `WRITE_TARGETS`, pero nunca se lee ni se exporta en ningún módulo.
  - `src/core/ctx/views/types.ts:234`: `ReviewView = Omit<ArgsView, "request" | "refs" | "lastError" | "effects" | "recalled">` omite `"refs"`, propiedad inexistente actualmente en `ArgsView`.
  - `src/core/result/extractors/index.ts:15-24` y `src/core/result/extractors/types.ts:22`: `ENTRIES` está completamente vacío (`[]`), manteniendo código de registro sin extractores activos, y `mergedData: Record<string, any>` (`processResult.ts:118`, con `eslint-disable`) persiste como tipo `any` usado únicamente por `controlFieldsOf`.
  - `src/tools/system/systemInfo.ts:153-156` y `src/tools/system/systemProvider.ts:305`: `SystemInfoDeps.defaultTimeoutMs` se recibe por contrato y nunca se utiliza dentro de `runSystemInfo`.
  - `src/tools/multimedia/playMedia.ts:118`: `mediaType === "music" ? "youtube" : "youtube"` evalúa exactamente al mismo literal en ambas ramas.
- **Descripción del problema:** Permanecen símbolos, campos de tipos y expresiones heredadas que ya no cumplen función en la ejecución actual.
- **Consecuencia posible:** Confusión durante el mantenimiento y contratos engañosos sobre dependencias o propiedades realmente activas.
- **Solución recomendada:** Eliminar los campos y ramas muertas (`needsParentFolder`, `"refs"` en `Omit`, ternario idéntico en `playMedia`, `defaultTimeoutMs` en `SystemInfoDeps`, y `ENTRIES`/`mergedData` si no habrá extractores heredados).

---

### MIN-02 — Duplicación de utilidades con ligeras divergencias entre módulos
- **Severidad:** Menor *(duplicación confirmada)*
- **Archivo y ubicación:**
  - `src/tools/files_read/listFolder.ts:175-187` reimplementa `fitLines` localmente en lugar de reutilizar `fitLinesToBudget` de `src/core/tools/filePaths.ts:518` (como sí hacen `findFiles.ts`, `readFile.ts`, `searchContent.ts` y `systemInfo.ts`).
  - `src/tools/files_read/findFiles.ts:100-104`, `src/tools/files_read/listFolder.ts:209-211` y `src/tools/terminal/terminalProvider.ts:290` duplican el cálculo de margen de timeout en lugar de reutilizar `effectiveTimeoutMs` de `src/core/tools/filePaths.ts:483` (divergiendo en el mínimo permitido: `0` vs `1` vs `1000`).
  - Sonda de archivos binarios (`0x00` en los primeros 8192 bytes) duplicada en `src/tools/files_read/readFile.ts:127`, `src/tools/files_read/searchContent.ts:172` y `src/tools/files_write/editFile.ts:138`.
  - Canonicalización recursiva de JSON duplicada entre `canonical` (`src/core/engine/args.ts:84`) y `stable` (`src/core/policy/approvalKey.ts:22`).
  - `stemsOf` duplicado entre `src/memory/index.ts:56` y `src/core/text.ts:112` con ligera divergencia en `normalizePlural`.
- **Descripción del problema:** Misma lógica implementada de forma independiente en múltiples archivos con pequeñas diferencias de bordes.
- **Consecuencia posible:** Correcciones aplicadas en un módulo que no se replican en sus equivalentes.
- **Solución recomendada:** Reutilizar `fitLinesToBudget`, `effectiveTimeoutMs` y una utilidad común de detección binaria desde `core/tools/filePaths.ts`, y consolidar la serialización JSON canónica en `core/utils.ts`.

---

### MIN-03 — Patrones frágiles menores en nombres temporales, sentinels, rendimiento y SSE
- **Severidad:** Menor *(riesgos potenciales acotados y trabajo redundante)*
- **Archivo y ubicación:**
  - `src/tools/files_write/moveFile.ts:275`, `src/tools/files_write/archiveFiles.ts:736`, `src/tools/web/downloadFile.ts:524`: Generan rutas temporales/respaldo con `${process.pid}-${Date.now()}`; dos operaciones concurrentes en el mismo milisegundo sobre el mismo destino colisionan en nombre.
  - `src/telegram/format.ts:12, 21`: `mdToHtml` usa el marcador `\u0000${i}\u0000` para restaurar bloques de código sin escapar bytes NUL preexistentes en el texto de entrada.
  - `src/core/tools/manifest.ts:445-451`: `sortByCatalog` ejecuta `SYSTEM_TOOL_MANIFEST.findIndex(...)` (`O(M)`) por cada herramienta ordenada en lugar de consultar un `Map<string, number>` precalculado.
  - `src/tools/files_read/readFile.ts:147` y `src/tools/files_read/searchContent.ts:301`: Abren cada archivo dos veces seguidas (primero para leer 8 KB en `hasNullByte`/`isBinaryFile` y luego con `fs.createReadStream`).
  - `src/tools/web/downloadFile.ts:430-434`: Llama a `deps.getEnvironment()` dos veces seguidas cuando no se pasa `destination`.
  - `src/server/jarvisRouter.ts:248-287`: El stream SSE `/events` se suscribe a `req.on('close', ...)` (a diferencia de `/tts` en línea 298 que usa `res.on('close', ...)`), no protege el handler de limpieza contra ejecución múltiple ni verifica `res.writableEnded || res.destroyed` antes de `res.write(chunk)` en `send()`.
- **Descripción del problema:** Pequeñas fragilidades ante concurrencia exacta o entradas atípicas, además de lecturas/operaciones redundantes.
- **Consecuencia posible:** Fallos esporádicos bajo concurrencia exacta en el mismo milisegundo, E/S redundante y manejo menos robusto en desconexiones SSE.
- **Solución recomendada:** Usar `crypto.randomUUID()` para sufijos temporales, precalcular el índice de orden en `manifest.ts`, devolver `env` desde `resolveFolderPath`, sanear `\u0000` en `mdToHtml` y reforzar el cierre idempotente en `res.on('close')` para `/events`.

---

## 4. Oportunidades de simplificación

1. **Unificación de la pasada de retención de logs (`src/core/retention.ts:79-108, 205-236` + `src/core/taskLog.ts:348-370`)**
   - Actualmente `pruneLogFiles` y `collectSizedLogs` recorren `tasksDir` por separado haciendo `lstat` y `isTaskLogTerminal` (con replay completo de `TaskContext` por cada log). Unificar la inspección de `tasksDir` en una sola función usando `summarizeClosedTaskLog` como vía rápida reduce código duplicado y elimina trabajo redundante sin cambiar el comportamiento observable.
2. **Simplificación del subsistema de extractores heredados (`src/core/result/processResult.ts` + `src/core/result/extractors/`)**
   - Dado que `ENTRIES` en `extractors/index.ts` está vacío y todos los proveedores nativos pasan por `extractStructured`, eliminar el registro dinámico vacío, el mapa `mergedData` tipado como `any` y restringir `controlFieldsOf` a campos tipados del resultado MCP simplificaría significativamente la Fase 4 manteniendo intacta la clasificación actual.
3. **Extracción de invocación PowerShell compartida en `src/tools/system/`**
   - `clipboard.ts`, `openOnScreen.ts`, `pcSettings.ts`, `power.ts`, `stopProcess.ts` y `systemInfo.ts` repiten el patrón `requireWindows`, prefijo UTF-8 de consola, `execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ...])` y manejo de cancelación/errores. Centralizar un helper común en `tools/system` reduciría repetición manteniendo la inyectabilidad de cada driver/controller.
4. **Tabla única de utilidades de timeout y presupuesto (`src/core/tools/filePaths.ts`)**
   - Reemplazar las implementaciones locales de `fitLines` y `effectiveLimitMs` en `files_read/` y `terminalProvider.ts` por `fitLinesToBudget` y `effectiveTimeoutMs` de `core/tools/filePaths.ts` elimina lógica duplicada ya probada en los demás proveedores.

---

## 5. Aspectos correctos

1. **Separación de capas y raíz de composición limpia (`src/core/contracts.ts`, `src/core/engine/services.ts`, `src/core/ctx/`)**
   - `ctx/` está aislado de dependencias del motor y de transporte, `contracts.ts` desacopla interfaces del motor respecto a clientes de modelos, y `capture.ts` separa el registro de trazas del flujo de ejecución.
2. **Event sourcing determinista e inmutable en `TaskContext` (`src/core/ctx/`, `src/core/taskLog.ts`)**
   - El modelo basado en log JSONL con replay determinista, reparación de cola corrupta, transacciones atómicas (`prepareBatch` + `commit()`), `deepFreeze` en vistas/contexto y `guardedLogWriter` (que evita dejar tareas bloqueadas si falla el disco) está sólidamente construido.
3. **Propagación de cancelación (`AbortSignal`) y limpieza de recursos en herramientas de archivos y web (`src/core/tools/filePaths.ts`, `src/tools/web/hostCall.ts`, `src/tools/web/downloadFile.ts`)**
   - El uso sistemático de `raceAbort`, límites explícitos en descompresión (`maxOutputLength` en `archiveFiles.ts`), streaming acotado en disco en `downloadFile.ts` (sin bufferizar el cuerpo entero en RAM) y `callWithDeadline` con liberación de listeners y timers previene fugas ante timeouts y cancelaciones.
4. **Diseño del proveedor `jarvis_terminal` (`src/tools/terminal/`)**
   - La decodificación híbrida UTF-8 / OEM / ANSI por línea (`OutputDecoder`), la detección progresiva de prompts (`LineAssembler` + `prompts.ts`), la acotación de memoria en `OutputBuffer`, el cierre de árbol de procesos (`processTree.ts`) y la gestión de procesos huérfanos por tarea (`onTaskEnd`) abordan correctamente las particularidades reales de procesos sin PTY en Windows.
5. **Saneado explícito de prompts y salidas externas (`src/core/text.ts`, `src/core/render/shared.ts`, `src/tools/web/chunks.ts`)**
   - El encapsulado en bloques `<obs>` y la sanitización en capa de renderizado (`oneLine`, `multiLine`), junto con el pipeline determinista de limpieza/partición/BM25 en `web_search`, mantienen fronteras claras y predecibles entre datos externos y decisiones del motor.
