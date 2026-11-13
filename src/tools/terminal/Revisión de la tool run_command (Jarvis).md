# Revisión de la tool `run_command` (Jarvis)

**Estado:** cerrada salvo un pendiente menor (séptima pasada: Guard, lista negra, rutas sensibles y manifest leídos; comparación con Desktop Commander hecha en lo que la documentación pública permite) · **Archivos revisados:** `codepages.ts`, `output.ts`, `powershell.ts`, `processTree.ts`, `prompts.ts`, `terminalProvider.ts`, `manifest.ts`, `text.ts`, `result.ts`, `provider.ts`, `readOnly.ts`, `rerun.ts`, `processResult.ts`, `structured.ts`, `budget.ts`, `commandRules.ts`, `callRunner.ts`, `guard.ts`, `blacklist.ts`, `sensitivePaths.ts`, `extractors/types.ts`, `extractors/index.ts`, `extractors/shared.ts`, `extractors/generic.ts`, `extractors/files.ts` (solo como contraste: es de `desktop_commander`, no de la tool) · **Pendiente:** solo quién aplica `timeoutMs` en el proveedor nativo (ver al final)

## Alcance y método

Revisión estática del código fuente de la tool (`run_command`, `list_processes`, `stop_process`). No se ejecutó ningún test ni se modificó código. Solo se documentan problemas respaldados por el código; lo que depende de archivos que aún no vi queda en la sección «Pendiente de confirmar».

**Límite declarado:** la comparación con Desktop Commander usa solo documentación pública (README y catálogos de terceros). Esas fuentes dan nombres, papel de cada tool y unos pocos parámetros (`timeout_ms`, `offset`/`length`, `pid`), pero no los esquemas completos ni los valores por defecto. Lo que no consta ahí no se compara (ver «Comparación con Desktop Commander»).

## Cómo funciona (resumen)

- **`powershell.ts`** arma la línea de `powershell.exe -Command`: prólogo (UTF-8, sin barra de progreso), carga de ayudas desde un `.ps1` temporal (`Read-Host` propio y envoltorios de herramientas del sistema) y el comando del modelo en base64 dentro de la función `script`, con un epílogo que calcula el código de salida.
- **`output.ts`** convierte bytes en texto (UTF-8, o por línea la página OEM/ANSI con más letras acentuadas), limpia escapes ANSI, arma líneas por flujo (`LineAssembler`) y guarda lo no leído con tope de inicio y final (`OutputBuffer`).
- **`prompts.ts`** decide si la última línea de un proceso callado es un prompt (`strong`, `likely`, `weak`, `none`) y cuánto silencio hace falta.
- **`codepages.ts`** lee OEM y ANSI del registro, una sola vez.
- **`processTree.ts`** corta árboles con `taskkill /T /F`, lista procesos por CIM y decide qué procesos están protegidos.

## Hallazgos

### H-01 · Media · `output.ts` (`accentScore`) y `powershell.ts` (`__jvDecode`)

**El criterio «más letras acentuadas» elige mal la página cuando hay caracteres de caja (`tree`).**

`ACCENTED` cuenta À–Ö y Ø–ÿ. En la página 850 (y 437) los caracteres de caja `├ └ ┬ ┴ ┼ ─` son los bytes 0xC3, 0xC0, 0xC2, 0xC1, 0xC5 y 0xC4. En 1252 esos mismos bytes son letras: Ã, À, Â, Á, Å, Ä. Una línea como `├───carpeta` suma 0 con OEM y 4 con ANSI, así que gana ANSI y sale `Ã„„„carpeta`. `tree` está en `LEGACY_TOOLS`, y su salida (si no usa `/A`) lleva justamente esos caracteres. El mismo regex está duplicado en el `__jvDecode` de PowerShell, así que el envoltorio y el decodificador TS fallan igual.

*Impacto:* salida de `tree` corrupta o mezclada línea a línea (las líneas que solo tienen `│`, 0xB3, empatan en 0 y resuelven a OEM).

*Dirección:* no puntuar como «acentuada» una decodificación donde el resultado ANSI aparece junto a símbolos de caja, o preferir OEM si la decodificación OEM produce caracteres U+2500–U+257F.

### H-02 · Media · `output.ts` (`LineAssembler.push`)

**`\r\r\n` borra la línea.**

Con `abc\r\r\n`: el primer `\r` deja `pendingCr`; el segundo entra por la rama «`\r` suelto», que hace `this.line = ""` (descarta `abc`), y el `\n` posterior entrega solo `"\n"`. Esa secuencia aparece con herramientas que duplican la traducción de saltos en Windows. El resultado es una línea vacía en lugar de `abc`.

*Dirección:* tratar `\r+\n` como un solo salto.

### H-03 · Media · `powershell.ts` (`__jvRun`)

**Los envoltorios retienen la línea abierta de la herramienta hasta su salto de línea, y eso oculta sus prompts.**

El bucle de lectura solo entrega al encontrar `0x0A`; lo que queda en `$acc` se entrega al terminar el proceso. Un prompt sin salto de línea de una herramienta envuelta (por ejemplo `xcopy` cuando el destino no existe: `(F = file, D = directory)?`) no llega al detector de `prompts.ts`: el modelo ve silencio hasta el tiempo máximo. La cabecera del archivo solo exceptúa `netsh` y `nslookup` sin argumentos (`INTERACTIVE_TOOLS`), lo que contradice el objetivo de que los prompts lleguen a `waiting_input`. Sin envoltorio, el prompt sí se vería.

*Dirección:* entregar también el tramo parcial cuando pasa un breve tiempo sin datos, o no envolver las herramientas que preguntan.

### H-04 · Baja · `prompts.ts` (`PROGRESS_END`)

**El prompt de continuación ` ...  ` de un REPL se clasifica como avance (`none`).**

`PROGRESS_END` incluye `\.\s*\.\s*\.` y se evalúa antes que `PROMPT_END`; `...` (continuación de Python y de Node) nunca llega a `likely`. El resto del módulo trata los REPL como caso soportado (`>>>` en `LineAssembler.closeAnswered`).

### H-05 · Baja · `prompts.ts` (`CHOICE_OR_KEY`)

**`[n/a]` y `(n/a)` se detectan como elección.**

`CHOICE` incluye `n` y `a`, y el primer patrón acepta cualquier par entre corchetes o paréntesis. Como `strong` vale también con salto de línea, un proceso que termine con `(n/a)` y quede 3 s callado (`TERMINATED_PROMPT_IDLE_MS`) se reporta como esperando entrada.

### H-06 · Baja · `processTree.ts` (`systemProcesses`)

**El flujo `stderr` se abre como `pipe` y nunca se lee.**

`stdio: ["ignore", "pipe", "pipe"]` con solo `child.stdout.on("data")`. Si PowerShell escribe más de lo que cabe en la tubería, se bloquea hasta el tiempo máximo de 15 s. Además, el error por código de salida distinto de 0 no incluye el texto de `stderr`, así que el fallo no se puede diagnosticar.

### H-07 · Baja · `output.ts` (`OutputDecoder.legacyChunks`)

**El comentario dice «líneas» pero cuenta fragmentos.**

Se incrementa una vez por llamada a `decode` cuyo bloque completo no es UTF-8, no por línea. Como es un contador de diagnóstico, su lectura es engañosa.

### H-08 · Media · `terminalProvider.ts` (`promptCandidate`) y `output.ts` (`LineAssembler`)

**Un prompt ya respondido puede volver a tomarse como prompt nuevo.**

`promptCandidate` descarta lo respondido con `completedSeq > answeredSeq`, pero el texto que evalúa (`lastCompleted`) no lleva número de orden: `complete()` y `closeAnswered()` solo lo actualizan con líneas no vacías. Si tras la respuesta el proceso escribe solo una línea en blanco, `completedSeq` avanza y `lastCompleted` sigue siendo la línea ya respondida. Ejemplo: `Continue? (y/n)` se responde con `input`; el proceso escribe un salto de línea vacío y trabaja 3 s en silencio (`TERMINATED_PROMPT_IDLE_MS`). `classifyPrompt` vuelve a darla por `strong` y la llamada devuelve `waiting_input` con el mismo prompt.

*Impacto:* se vuelve a pedir al usuario una respuesta que ya dio, y la siguiente respuesta se escribe en la entrada de un proceso que no preguntó nada.

*Dirección:* guardar junto a `lastCompleted` el `seq` en que se completó, o vaciarlo al responder.

### H-09 · Baja · `terminalProvider.ts`, `processTree.ts` (mensajes que ve el modelo)

**Mensajes de error con idiomas mezclados.**

Los errores y notas de `terminalProvider.ts` están en inglés (`fail(...)`, y `settle` los describe como frases llanas para modelos chicos), pero la causa se concatena con `errorMessage(error)` y viene en español desde `spawnProcess` (`el sistema no arrancó PowerShell en 15 s`, `el sistema no devolvió el id del proceso`) y desde `systemProcesses` (`la lista de procesos no llegó en N s`, `no se pudo leer la lista de procesos (código N)`). El modelo recibe, por ejemplo, `Could not read the list of processes: la lista de procesos no llegó en 15 s.`

Ocurre también cuando Guard deniega: `guard.ts` escribe sus razones en español (`Operación rechazada (DENY): comando catastrófico prohibido (…)`) y `policyDenialNote` (`callRunner.ts`) las pega dentro de una frase en inglés (`Denied by the security policy; it was not performed. … Do not try this operation again…`). El motivo en inglés que sí trae `RuleFinding.reason` («Texto en inglés que ve el modelo») no llega al modelo en ese camino: Guard solo usa el `id` de la regla.

Lo mismo ocurre con el marcador de omisión de `text.ts` (`omissionMarker`: `[… omitidos: N caracteres]`), que insertan `OutputBuffer`, `settle`, `stopProcess` y `listProcesses` en un resultado escrito en inglés; el propio archivo lo declara texto provisorio.

### H-10 · Baja · `terminalProvider.ts` (`resume`, `describe`) y `manifest.ts` (nota de `pid`)

**`list_processes` ofrece procesos huérfanos que `run_command` no deja continuar.**

`visibleTo` incluye los que dejó una tarea ya completada y `describe` los muestra como `left running by an earlier task`, pero `resume` exige `t.taskId === taskId` y responde `Process N does not exist or was not started by this task`, aunque el proceso existe. La nota de `pid` en el manifest (`Process id from an earlier run_command that is still running…`) tampoco aclara el límite. Para el modelo, la lista y el error se contradicen; con esos procesos solo funciona `stop_process`.

*Dirección:* indicar en la fila que solo se pueden detener, o distinguir en el error «de otra tarea» de «no existe».

### H-11 · Baja · `manifest.ts` (cabecera y `DESTINATIONS.terminal`)

**El catálogo describe el destino `terminal` como una sola tool y sin procesos.**

La cabecera dice «una tool propia por ruta (`run_command`, `web_search`)», pero `terminal` tiene tres (`run_command`, `list_processes`, `stop_process`). Además `DESTINATIONS.terminal.description`, que es el criterio de Decision #1, solo habla de ejecutar comandos y de leer o enviar entrada: no menciona listar ni detener procesos, que el propio manifest añadió a ese destino (RC-25).

*Impacto:* comentario desactualizado y un criterio de ruteo que puede no cubrir peticiones como «qué está corriendo» o «detén el proceso X».

### H-12 · Baja · `terminalProvider.ts` y `manifest.ts`

**Descripciones y topes duplicados en dos fuentes.**

El manifest se declara «fuente única de herramientas, políticas y descripciones», pero `TerminalProvider` define sus propias descripciones de herramienta y de parámetro (`RUN_COMMAND_TOOL`, `LIST_PROCESSES_TOOL`, `STOP_PROCESS_TOOL`) y el manifest repite en texto los valores de `DEFAULT_WAIT_SEC` y `MAX_WAIT_SEC` (`default 30, max 300`). `applyDestination` sustituye las del proveedor, así que solo cuenta una, y ya difieren (por ejemplo la de `list_processes`). Cambiar una constante no actualiza la nota.

### H-13 · Media · `structured.ts` (`extractStructured`) con `terminalProvider.ts` (`settle`, `stopProcess`)

**`truncated` es `true` en casi todo resultado de `run_command`, aunque no se haya omitido nada.**

`extractStructured` calcula `truncated` como `raw.trim() !== text.trim()` (con `raw` no vacío). En `run_command` el `text` siempre lleva cabecera y notas delante del cuerpo (`[header, ...notes, body]`), mientras que `raw` es solo la salida: nunca coinciden cuando hay salida. Ejemplo: `echo hola` da `raw = "hola"` y `text = "status: finished · … The command finished successfully.\nhola"`, y `truncated = true`. Según `processResult.ts`, `truncated` es lo que el ejecutor usa para decidir si la llamada lleva ref, y `result.ts` dice que solo hay ref cuando `raw` y `text` difieren. Pasa igual con `stop_process` sobre un proceso de `run_command` con salida pendiente. `list_processes` no se ve afectado: su `text` y su `raw` coinciden si no se recorta.

*Impacto:* una ref en disco por cada comando con salida y la marca de resumen incompleto donde el resumen está completo. Si las vistas listan refs con el tope `caps.refs` (8), esas refs triviales pueden ocupar el sitio de otras útiles (por confirmar en el ejecutor).

*Contrato que se incumple:* `extractors/types.ts` define `truncated` como «el extractor omitió texto de contenido; un recorte de metadatos no cuenta», y `extractReadFile` (`files.ts`) lo respeta a propósito: sus notas de cabecera no cuentan para `truncated`. `extractStructured` hace lo contrario: la cabecera y las notas de `run_command` son metadatos y aun así hacen que `text` difiera de `raw`. Además su comentario de cabecera dice «cuando el texto completo es más largo que lo que ve el modelo», pero el código compara con `!==`, no por largo, y con cabecera delante el `text` suele ser el más largo.

*Confirmado en el ejecutor (`callRunner.ts`, paso 11):* `if (processed.truncated && processed.fullText.length > 0)` hace `vault.put` y `add ref`. Es decir, se escribe una ref en disco por cada comando con salida. Además, si `vault.put` lanza `RefVaultError`, `runCall` devuelve `close` con `unrecoverable`: por H-13, un fallo del almacén que debería afectar solo a salidas recortadas de verdad cierra la tarea tras cualquier comando que imprima algo.

*Dirección:* que el proveedor indique en `data` si recortó (el `rawTruncated` actual solo cubre `OutputBuffer`, no el `headTailNeutral` de `settle`) y que el extractor use esa señal en lugar de comparar textos.

### H-14 · Alta · `readOnly.ts` (`segmentsOf`) con `commandRules.ts` y `guard.ts`

**El analizador solo reconoce comillas ASCII; PowerShell también acepta las tipográficas.**

`segmentsOf` abre y cierra comillas únicamente con `"` y `'`. PowerShell trata además `‘ ’ ‚ ‛` como comilla simple y `“ ” „` como comilla doble. Cuando las dos lecturas difieren, lo que `segmentsOf` da por «dentro de comillas» y no analiza puede ser código para PowerShell. Ejemplo construido a partir del código (no lo ejecuté): `Get-Content 'a’; Remove-Item x; Write-Output ‘b'`. Para `segmentsOf` es un solo segmento (las comillas ASCII están balanceadas) que empieza por `Get-Content`; PowerShell cierra la cadena en `’`, ejecuta `Remove-Item x` y abre otra cadena con `‘`. La cabecera del archivo promete que es lectura «lo que se puede demostrar leyendo el texto», y aquí la lectura del texto no coincide con la del intérprete.

*Impacto:* una escritura puede pasar por lectura y ejecutarse sin confirmación. `commandRules.ts` no lo frena: `splitSegments` y `tokenize` abren y cierran comillas solo con `"` y `'`, igual que `segmentsOf`. Con el ejemplo, `classify` ve un único segmento con el token `Get-Content` y un argumento largo «entre comillas»; ninguna regla de texto completo coincide y devuelve `null`, así que `noCommandRule` da `true`. Guard y la lista negra llaman a `classify` tal cual (`guard.ts` línea del nivel `guard`; `blacklistMatch`), así que el mismo punto ciego alcanza a los niveles `guard` y `blocked`: un `Remove-Item C:\ -Recurse -Force` colocado en esa posición no se clasificaría como crítico. Y Guard devuelve `ALLOW` sin confirmación a todo comando que `isReadOnlyCall` da por lectura (`policy.requiresApproval && !isReadOnlyCall`), de modo que el comando se ejecuta sin preguntar. Solo lo detendrían los cinco patrones de `DENY_PATTERNS` (leen el texto sin interpretar comillas) y la lista `SECRET_PATTERNS` de `sensitivePaths.ts`. La lista `WRITE_PATTERNS` (`C:\Windows`, carpetas de inicio, perfiles de shell, `.git/hooks`, `jarvis-config.json`, con confirmación obligatoria incluso en `autoMode`) no se aplica: Guard calcula `write = policy.mutates && !isReadOnlyCall(...)`, y ese veredicto es justo el equivocado. El mismo error desactiva así la capa que debía proteger esas rutas. En D3 tampoco entra: `kind` queda en `read`. La cabecera de `readOnly.ts` aclara que no es una barrera contra atacantes, pero la de `sensitivePaths.ts` dice que la red de Guard es contra «el error o la inyección de instrucciones»: un texto con comillas mezcladas que llegue de una página web o de un archivo puede construir este caso a propósito. Por eso la subo a Alta: es el único hallazgo en que una escritura destructiva atraviesa todas las capas a la vez (reglas de comando, lista negra, rutas sensibles de escritura, confirmación y D3).

*Dirección:* tratar las comillas tipográficas como comillas, o descartar el comando si contiene alguna.

### H-15 · Baja · `readOnly.ts` (`WAIT_PARAM`)

**`-Wait` se detecta por su nombre completo; la abreviación `-Wai` pasa.**

`WAIT_PARAM = /(^|\s)-wait\b/i` busca el nombre entero. PowerShell acepta prefijos únicos de parámetro y en `Get-Content` `-Wai` es único (`-Wa` choca con `-WarningAction`). `Get-Content app.log -Tail 5 -Wai` no se detecta, se trata como lectura sin confirmación y deja un proceso corriendo, justo lo que la cabecera dice evitar.

*Impacto:* tras el plazo `run_command` no lo mata y ocupa uno de los 8 puestos de procesos vivos.

### H-16 · Baja · `rerun.ts` (`RUNNERS`)

**Los ejecutores aceptan cualquier argumento, incluido el modo vigilancia, aunque la cabecera justifica la política en que «no acumulan nada».**

`tsc`, `eslint`, `jest`, `vitest`, `mocha` y `pytest` se registran con `() => true`, y `npx` solo comprueba el nombre de la herramienta (`NODE_TOOLS`), no sus argumentos. Por tanto `tsc --watch`, `jest --watch`, `mocha --watch` o `npx vitest --watch` son «repetibles». Esos comandos no terminan: cada relanzamiento tras un cambio deja otro proceso vivo (hasta el tope `maxLive` de 8). La cabecera de `rerun.ts` fundamenta la política en que repetir «reescribe sus salidas (no las acumula)», lo que no vale para un proceso que se queda corriendo. En los demás registros del archivo sí se filtran los argumentos (`node` exige `--test`, `python` exige `-m pytest|unittest|mypy`, `cargo`/`go`/`dotnet` listan subcomandos).

*Impacto:* limitado: `rerun` solo levanta el bloqueo anti-bucle y no concede aprobación. El efecto es permitir relanzar procesos de larga vida sin pasar por el bloqueo.

*Dirección:* rechazar `--watch`/`-w`/`--watchAll` en esos ejecutores, o aceptar solo la forma sin argumentos.

### H-17 · Baja · `structured.ts` (`process.active`) con `callRunner.ts` (`processFactOps`)

**Un `stop_process` que falla da de baja el hecho `process` aunque el proceso siga vivo.**

`extractStructured` pone `active: true` solo con `running` o `waiting_input`; cualquier otro estado, `error` incluido, da `active: false`. Según la lectura de `terminalProvider.ts` de la primera pasada, `Could not stop process N` lleva `pid` y estado `error`. En `processFactOps`, `active: false` con el pid presente en el hecho lo quita (y deja `value = null` si era el último). Tras un `kill` fallido de un proceso que lanzó la propia tarea, el hecho `process` deja de listarlo, y de ahí saca el generador de argumentos el pid para continuarlo o detenerlo (RC-14). El comentario de `extractors/index.ts` justifica la baja con «el pid de un proceso que no existe», que no es el caso de `error`.

*Impacto:* el modelo tiene que volver a llamar a `list_processes` para recuperar el pid antes de reintentar. Si lo adivina, recibe `unknown_pid`. El rechazo `protected` no tiene este efecto: el pid no suele estar en el hecho y `!current.includes(pid)` devuelve sin operaciones.

*Dirección:* que `data` indique si el proceso sigue vivo (o no dar de baja con `error`).

### H-18 · Baja · `commandRules.ts` (`analyzeDelete`, `pathClass`)

**Dos formas de escribir una ruta crítica se clasifican como borrado común.**

- `isFlag` descarta todo token que empieza por `-`, y PowerShell acepta `-Path:valor` y `-LiteralPath:valor` en un solo token. `Remove-Item -Path:C:\ -Recurse -Force` deja `targets` vacío y cae en `sensitive/delete`, no en `guard/delete-root`.
- `pathClass` quita un `/*` final pero no `/*.*`, mientras que `isUserFolder` sí acepta `*.*` (`USER_FOLDERS`). `Remove-Item $HOME\Documents\*.*` es `blocked`; `Remove-Item C:\*.*` queda en `sensitive`.

*Impacto:* un borrado que debería denegar Guard o bloquear el nivel 1 pasa al nivel 2 (en automático lo decide D3 con umbral estricto).

### H-19 · Baja · `commandRules.ts` (`POWER_NAMES`)

**La excepción `-c` pensada para el `shutdown -c` de Linux deja pasar reinicios en Windows.**

La regla `power` se salta si algún token es `/a` o `-c`. En Linux `shutdown -c` cancela un apagado programado; en `shutdown.exe` de Windows (conocimiento externo: acepta `-` en lugar de `/`), `-c "texto"` es el comentario. `shutdown -r -t 0 -c "mantenimiento"` no dispara `power` (nivel `blocked`). La tool solo se ofrece en Windows (`callRunner.ts`: `jarvis_terminal` sin catálogo fuera de Windows no se ofrece), así que la excepción solo puede producir el falso negativo.

### H-20 · Baja · `commandRules.ts` (`KILL_NAMES`) frente a `stop_process`

**Matar un proceso crítico con `run_command` es solo `sensitive`; con `stop_process` se rechaza.**

La regla `kill` no mira el objetivo (a diferencia del borrado, que clasifica la ruta). `processTree.ts` mantiene `CRITICAL_PROCESSES` y `stop_process` responde `protected`. `Stop-Process -Name csrss -Force` o `taskkill /F /IM wininit.exe` por `run_command` reciben el mismo trato que matar `notepad`: en manual se pregunta; en automático decide D3 con umbral estricto. Dos caminos de la misma tool aplican criterios distintos. Matiz: `lsass` sí exige confirmación obligatoria, por la regla `credential-dumping` de `sensitivePaths.ts`; ningún otro nombre crítico (`csrss`, `wininit`, `winlogon`) aparece en esa lista.

*Dirección:* reutilizar la lista de procesos protegidos en la regla `kill` y subir a `blocked` si el objetivo está en ella.

### H-21 · Media · `guard.ts` (`DENY_PATTERNS`)

**Guard deniega cualquier mención de `System32\drivers`, incluida una lectura.**

`/system32\/drivers/` está en `DENY_PATTERNS` y se prueba sobre el JSON de todos los argumentos, con `\\` convertido en `/`. `Get-Content C:\Windows\System32\drivers\etc\hosts` (leer el archivo `hosts`, una consulta habitual) produce `c:/windows/system32/drivers/etc/hosts`, coincide y devuelve `DENY` («patrón destructivo prohibido»). El DENY se evalúa antes que el modo de solo lectura, y `callRunner.ts` lo traduce en `tool_rejected` con la nota «Do not try this operation again». El propio `guard.ts` documenta que ya quitó por falsos positivos un patrón de texto equivalente (`rm -rf /tmp/x`), y la carpeta `drivers` solo es peligrosa para escribir o borrar, cosa que `classify` ya distingue (`pathClass` trata `system32` como `root` en los borrados, y `WRITE_NAMES` marca las escrituras).

*Impacto:* el modelo no puede leer `hosts`, ni listar `drivers`, ni usar esa ruta como `cwd`, y recibe la instrucción de no reintentar.

*Dirección:* quitar el patrón de texto y dejar la ruta a `classify`, que distingue borrar de leer.

### H-22 · Baja · `guard.ts` (regla B) con `callRunner.ts` (`askUser`)

**La regla B no cubre `run_command` y su justificación no vale con `autoMode`.**

La cabecera de `guard.ts` dice que la regla B (proteger `refsDir`) no cubre un comando de terminal porque «ya pide aprobación». En `callRunner.ts`, `askUser` es `false` cuando hay `autoMode` y la herramienta está catalogada (salvo ruta obligatoria o coincidencia de la lista negra); entonces solo revisa D3. Un `Remove-Item` o un `Set-Content` sobre `refsDir` lanzado por `run_command` en automático no lo bloquea ninguna regla determinista: `commandRules.ts` no conoce `refsDir` y `sensitivePaths.ts` tampoco lo incluye (su `WRITE_PATTERNS` cubre inicio, perfiles, sistema, `.git/hooks` y `jarvis-config.json`). Con ello puede romperse `{{ref:rN}}`.

*Dirección:* aplicar la regla B también al texto de `command`, o reformular el comentario para que diga que en automático solo lo cubre D3.

### H-23 · Baja · comentarios que describen un comportamiento que el código ya no tiene

- `commandRules.ts` (cabecera): el nivel `guard` «cierra la tarea en cualquier modo». `guard.ts` devuelve `DENY` y `callRunner.ts` registra `tool_rejected` sin cerrar («La tarea NO cierra»); `blacklist.ts` también dice «sin cerrar la tarea».
- `guard.ts` y `callRunner.ts` (paso 4) hablan de `start_process` de Desktop Commander como si fuera la tool que cubre `readOnly.ts`; en esta tool es `run_command`.
- `callRunner.ts` (`usableTools`, `discoverTools`): habla de herramientas que «exigen un proceso o una búsqueda activos», pero `requirementOf` devuelve `"search" | undefined` y `usableTools` solo evalúa `searchActive`. No hay ningún requisito de proceso.

### H-24 · Baja · `sensitivePaths.ts` (`system-folders`, `unix-system`) frente a `commandRules.ts`

**Las carpetas del sistema escritas con variables de entorno no cuentan como rutas sensibles de escritura.**

`system-folders` exige una letra de unidad (`[a-z]:/windows`) y `unix-system` una `/` inicial, así que `$env:windir\foo`, `$env:SystemRoot\…` o `$env:ProgramFiles\…` no coinciden. `commandRules.ts` sí expande esas variables (`VARIABLES`), pero solo para clasificar borrados. `Set-Content $env:windir\foo.txt x` o `Copy-Item x $env:ProgramFiles\app` quedan, como mucho, en la regla genérica de escritura (`sensitive`), sin la confirmación obligatoria que sí provoca `C:\Windows\foo.txt`.

*Impacto:* en `autoMode`, la escritura en carpetas del sistema la decide D3 en vez del usuario, según cómo escriba la ruta el modelo.

## Comparación con Desktop Commander (parte de procesos)

Alcance: solo lo que documentan las fuentes públicas. No consta ahí ningún esquema completo ni valor por defecto, así que no se comparan.

| Desktop Commander | Jarvis | Observación |
|---|---|---|
| `start_process` (comando y `timeout_ms`), `interact_with_process` (`pid` + entrada) y `read_process_output` (`pid`, `offset`/`length`, offset negativo = desde el final) | `run_command` con tres usos: `command` (nuevo), `pid` (continuar) y `pid` + `input` (responder) | Fusión deliberada de tres tools en una (visible en el manifest). Espera en segundos (`timeoutSec`, 30 por defecto, 300 máx.; el proceso no se mata al vencer) en vez de `timeout_ms`; además admite `cwd`. Jarvis no tiene lectura paginada: entrega lo no leído, con tope de inicio y final; lo omitido solo queda en la ref (ver H-13). |
| `list_sessions` (sesiones de `start_process`; el flag `Blocked` indica que espera entrada) y `list_processes` (procesos del SO) | `list_processes` única, con procesos del sistema y los de `run_command` | Desktop Commander separa sesiones de procesos del SO; Jarvis los mezcla y de ahí sale H-10 (lista procesos huérfanos que `run_command` no deja continuar). No registré si la fila de un proceso gestionado indica que espera entrada, el equivalente de `Blocked` (ver pendientes). |
| `force_terminate` (cierra una sesión de `start_process`) y `kill_process` (cualquier PID) | `stop_process` única, por `pid` | Unificación, más una lista de procesos protegidos (`CRITICAL_PROCESSES`, estado `protected`) que Desktop Commander no documenta. Esa protección no existe en el camino equivalente de `run_command` (H-20). |

Las diferencias de forma (tres tools en una, cuatro en dos, `timeoutSec` en segundos) son decisiones de diseño y no se registran como defectos. Las únicas desalineaciones con consecuencias son H-10 y H-20.

Fuentes: [py-commander-mcp (PyPI)](https://pypi.org/project/py-commander-mcp/), [Desktop Commander en FlowHunt](https://www.flowhunt.io/integrations/desktopcommander/), [catálogo de Archestra](https://archestra.ai/mcp-catalog/wonderwhy-er__desktopcommandermcp), [skill de resumen de Desktop Commander](https://skillsmp.com/skills/wonderwhy-er-desktopcommandermcp-plugins-cursor-skills-desktop-commander-overview-skill-md), [herramientas en Docker Hub](https://hub.docker.com/mcp/server/desktop-commander/tools).

## Verificado sin hallazgos

- `manifest.ts`: `repeatByArgs` de `run_command` devuelve `allow` para cualquier llamada con `pid` numérico, así que sondear un proceso con los mismos argumentos no cae en el anti-bucle; un comando nuevo es `rerun` o `strict` según `isRerunnableCommand`. `requirementOf` solo admite `"search"`. `timeoutOf` devuelve `undefined` para `list_processes` y `stop_process` (rige el del transporte), y ambos están acotados además por sus plazos internos (15 s y 5 s).
- `sensitivePaths.ts`: los secretos se aplican también a lecturas y las escrituras añaden `WRITE_PATTERNS`, como dice la cabecera; las plantillas `.env.example`, `.env.sample` y similares quedan fuera a propósito; `env-secret` cubre las lecturas de `$env:` con nombre de secreto, que `readOnly.ts` deja pasar como lectura; los argumentos que se miran (`path`, `cwd`, `command`, `input`…) coinciden con los de `run_command`.
- `guard.ts` y `blacklist.ts`: el orden (DENY de patrones y de reglas `guard` → ruta sensible obligatoria → no catalogada → aprobación salvo lectura) coincide con la cabecera; la ruta sensible se mira antes que el modo de solo lectura; un hallazgo `guard` que llegara a la lista negra se trata como `blocked`; `{ pid, input }` pide aprobación cada vez salvo `userAuthored`.
- `callRunner.ts`: el orden de fases coincide con su cabecera; `kind = read` evita D3 y no la confirmación (esa sale de Guard y la lista negra); `userAuthored` excluye rutas obligatorias y coincidencias de la lista negra; una cancelación en vuelo registra `interrupted` y descarta el resultado tardío; el alta de pids en `processFactOps` exige `ok` o `waiting_input` y `policy.mutates`.
- `commandRules.ts`: la descodificación de `-EncodedCommand` (UTF-16LE) es la correcta para PowerShell; el límite de profundidad (`MAX_DEPTH`) termina siempre; `analyzeShellWrapper` marca como `sensitive` lo que no puede analizar.

- `extractors/index.ts`: `selectExtractor` envía todo resultado nativo a `extractStructured`, incluso los de error, y los errores no nativos al genérico; el registro valida contra el manifest al arrancar. Coherente con lo que declara su comentario.
- `extractors/shared.ts` (`compactText`) y `generic.ts`: sin texto devuelven `null` (nunca `""`), como exige `types.ts`.
- `processResult.ts`: la precedencia `denied` → `not_found` → `tool_error` → `waiting_input` → `no_data` → `ok` coincide con su comentario. Los marcadores de error solo se buscan con `isError`, así que una salida de comando que contenga «not found» no cambia el estado.
- `readOnly.ts`: `isReadOnlyCall` es fail-closed con `input: null` o `pid` no numérico; el patrón `args.input === undefined` solo trata como lectura la continuación pura.

- Las tablas OEM 437 y 850 de `output.ts` coinciden con el mapeo estándar de ambas páginas.
- `incompleteTail` y la retención de secuencias UTF-8 partidas entre fragmentos.
- La limpieza ANSI sí funciona entre fragmentos: `openEscapeAt` y `escapeCarry` retienen la secuencia partida (hasta 64 caracteres).
- `promptIdleMs` y `classifyPrompt` coinciden con la tabla de la cabecera de `prompts.ts`; la prueba de `strong` antes que `PROGRESS_END` deja bien clasificado `Press any key . . .`.
- El tope de procesos vivos: `starting` reserva el lugar antes del primer `await`, así que dos lanzamientos simultáneos no superan `maxLive`.
- El reintento sin ayudas (`HELPERS_UNAVAILABLE_EXIT`) termina siempre: la segunda falla con el archivo presente apaga las ayudas.
- La validación de `command` y `pid` (uno solo de los dos) y el entrecomillado de argumentos en `__jvQuote`.

* `timeoutMs: 315_000` del manifest cubre `MAX_WAIT_SEC` (300 s) más el margen de 5 s de `SAFETY_MARGIN_MS`.
* `argCaps.command` (1000) es la fuente de `MAX_COMMAND_CHARS` y coincide con el recorte de la traza.
* `params` y notas de `run_command` coinciden con el esquema y con la validación del proveedor (`input` solo con `pid`, un solo `command` o `pid`).
* `onTaskEnd` y `close` cumplen el contrato de `provider.ts`: `completed` conserva, `failed` y `cancelled` cierran, nunca lanza.
* `headTailNeutral` con `tail = 0` (`listProcesses`) no falla (usa `text.length - tail`, no `slice(-0)`), y `cap - head - 50` deja margen sobre `MARKER_RESERVE` (40).
* Los estados de `run_command` (`finished`, `running`, `waiting_input`, `cancelled`) están todos en `RESULT_STATES`; los fallos de la herramienta usan `isError`, como pide `result.ts`.

- `summaryMax` (2500) y `HEADER_RESERVE` (320): con varias notas el texto puede pasar de 2500, y `processResult` lo recorta con `fitToCap` (red de seguridad) conservando el inicio y el final, donde están la cabecera y el prompt.
- Los estados `stopped`, `listed`, `not_running`, `unknown_pid`, `protected` y `error`, ausentes de `RESULT_STATES`, no causan problemas: `extractStructured` solo distingue `running` y `waiting_input` como vivos y trata el resto como terminado.
- Un código de salida distinto de 0 en `run_command` se clasifica como `tool_error` por `exitCode`, sin `isError`, como pide `result.ts`.
- `isReadOnlyCall` coincide con la validación del proveedor: `pid` sin `input` es una continuación y `input` exige `pid`.
- `repeatByArgs`, `rerun.ts` y `readOnly.ts` comparten `analyzableSegments` y el criterio fail-closed. Que `git status` sea repetible en `rerun.ts` y no de lectura en `readOnly.ts` es coherente: la repetición no concede aprobación.
- Las listas cerradas de `READ_INVOCATIONS` (`git` solo con `--version`, `npm` solo con subcomandos de consulta, `netstat` sin intervalo) son consistentes con lo que declara la cabecera.

## Pendiente de confirmar

- Quién aplica `timeoutMs` en el proveedor nativo: `callRunner.ts` solo lo pasa en `ToolCallOptions` y compite el despacho contra la cancelación. Los resultados de `Select-String src\core\**\*.ts` solo muestran el uso en `mcp/transport.ts` (clientes MCP) y la declaración en `tools/provider.ts`; esa búsqueda no es recursiva, así que no descarta un consumidor en subcarpetas. Riesgo bajo: `list_processes` y `stop_process` (sin `timeoutMs`) están acotadas por sus plazos internos (15 s y 5 s) y `run_command` por `timeoutSec` (300 s máx.). Comando para cerrarlo: `Get-ChildItem src\core -Recurse -Filter *.ts | Select-String "timeoutMs" | Select-Object Path,LineNumber,Line`.
- `describe` en `terminalProvider.ts`: si la fila de un proceso gestionado indica que espera entrada (el equivalente del `Blocked` de Desktop Commander).
- Depende de conocimiento externo, no solo del código: `CRITICAL_PROCESSES` no incluye `svchost`, y cortar la instancia que aloja RPC o DCOM reinicia Windows (solo `killProcess` fallando sin permisos de administrador lo evitaría). Además, `USER_FOLDERS` (`commandRules.ts`) solo reconoce nombres en inglés bajo el perfil; con la redirección de carpetas de OneDrive pueden llevar el nombre localizado (`Documentos`, `Escritorio`) y quedar fuera de la protección.
