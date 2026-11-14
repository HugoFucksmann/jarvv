# Revisión de `run_command`: hallazgos, inconsistencias y faltantes

Documento de referencia para un agente que vaya a revisar `run_command` en profundidad. Reúne lo que se encontró al construirla y validarla (2026-11-10), con el contexto necesario para entender cada punto sin haber visto cómo se construyó. No impone soluciones: cada hallazgo dice qué se observó, con qué evidencia y qué conviene investigar.

> **Revisión del 2026-11-11.** Los hallazgos se verificaron contra el código y con PowerShell real, y se resolvió lo que se podía sin tocar prompts ni el núcleo grande. El **estado de cada hallazgo**, los hallazgos nuevos (`RC-31` en adelante), la evaluación de ConPTY, las decisiones a confirmar y los cambios en lo que leen los modelos están en la **§9**. Una segunda tanda el mismo día (con las propuestas de la §9 aceptadas) resolvió más pendientes, incluido el núcleo: su estado, **que reemplaza al de la §9.2 donde lo nombra**, y todo lo que se corrió con su resultado están en la **§10**. Las secciones 1 a 8 describen el estado del 2026-11-10 y se dejan como estaban, salvo correcciones marcadas con *(corregido 2026-11-11)*.

**Cómo leerlo.** Cada hallazgo lleva una etiqueta de **tipo** (Bug, Limitación, Riesgo, Falta, Inconsistencia), una **gravedad** (Alta, Media, Baja) y un **estado de verificación**:
- **[Vivo]**: comprobado ejecutando PowerShell o el flujo real.
- **[Test]**: cubierto por una prueba automática.
- **[Código]**: deducido leyendo el código, sin ejecutarlo.
- **[Sin probar]**: sospecha o funcionalidad que nadie ejecutó.

## 1. Qué es y dónde está

`run_command` es la herramienta con la que JARVIS ejecuta comandos de PowerShell en la PC del usuario (Windows). Es un **proveedor nativo**: un módulo en proceso, no un servidor MCP. Reemplazó a `start_process`, `read_process_output` e `interact_with_process` de Desktop Commander, que se quedó solo para los archivos.

| Archivo | Qué contiene |
| --- | --- |
| `src/tools/terminal/terminalProvider.ts` (~430 líneas) | El proveedor: validación, lanzamiento, espera por eventos, detección de prompts, continuación por `pid`, cierre |
| `src/tools/terminal/output.ts` | `stripAnsi`, `LineNormalizer`, `OutputBuffer` (tope de memoria) |
| `src/tools/terminal/processTree.ts` | `killTree`: `taskkill /PID n /T /F` |
| *(2026-11-11)* `src/tools/terminal/powershell.ts`, `prompts.ts`, `codepages.ts` | Cómo se lanza PowerShell y sus ayudas; detección de prompts por clases; páginas de códigos del sistema (ver §9) |
| `tests/run_command.test.ts` | 17 pruebas con procesos reales de PowerShell (solo Windows) |

**Archivos del núcleo que la integran** (leerlos para entender el resto):
- `src/core/tools/provider.ts`: la interfaz `ToolProvider` y `ToolCallOptions` (`signal`, `timeoutMs`, `taskId`, `host`) y el gancho `onTaskEnd`.
- `src/core/tools/result.ts` y `src/core/result/extractors/structured.ts`: el contrato de resultados (`text`, `raw`, `data`, `meta`) y cómo el motor lo traduce a estados.
- `src/core/tools/manifest.ts`: la entrada `run_command` (ruta `terminal`, servidor `jarvis_terminal`, capacidad `PROCESS_CONTROL`, plazo 315 s, `repeatByArgs`).
- `src/core/policy/readOnly.ts` (`isReadOnlyCall`), `src/core/policy/guard.ts`, `src/core/engine/precheck.ts` (analiza el comando como PowerShell).
- `src/core/engine/callRunner.ts` (despacho, hecho `process`), `src/core/engine/stepLoop.ts` y `src/core/engine/ask.ts` (pregunta al usuario con `waiting_input`), `src/core/mcp/discovery.ts` (`notifyTaskEnd`).
- `server.ts`: el registro (`new TerminalProvider()`, sin opciones).

## 2. Restricciones de diseño (no deshacer sin discutirlo)

- **Un paso, una tool:** el flujo no tiene mini-agente dentro del paso; cada tool resuelve el objetivo del paso en una llamada y devuelve algo que el verificador (D4) pueda juzgar.
- **El contexto (`ctx/`) es puro:** no conoce herramientas, MCP ni modelos. Una tool recibe sus argumentos, nunca el contexto de la tarea.
- **Dependencias en un solo sentido:** `src/core/` no importa `src/tools/` (lo fija `tests/architecture.test.ts`).
- **Solo Windows y PowerShell.** No usar comandos de Linux.
- **Sin modelos dentro de la tool.** Detectar un prompt es código; la pregunta al usuario la arma el código con el texto del prompt, sin modelo.
- **Los procesos no se matan al vencer el plazo** (`running`); solo se cortan si la tarea se cancela o falla.
- **Un proceso solo se continúa dentro de la misma tarea** que lo lanzó.
- Los mensajes que lee el modelo van en inglés; la pregunta que lee el usuario, en español.
- No commitear el `autoMode: true` local de `jarvis-config.json`. El usuario hace los commits.

## 3. Comportamiento actual (resumen)

**Argumentos** (exactamente `command` o `pid`): `command` (hasta 4000 caracteres), `pid`, `input` (solo con `pid`, hasta 1000), `timeoutSec` (1 a 300, por defecto 30, recortado en silencio) y `cwd` (por defecto la carpeta personal del usuario).

**Cómo corre.** `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "<prólogo>; & ([scriptblock]::Create(<script en base64>))"`. El script es el comando más una línea final que da el código de salida (0 si el último comando salió bien; si no, el del programa externo que falló, o 1). No se usa `-EncodedCommand` porque con él PowerShell escribe los errores en CLIXML. El prólogo fuerza la salida a UTF-8 y apaga la barra de progreso.

**Estados** (`data.state`): `finished` (con `exitCode`), `running` (venció el plazo, sigue vivo), `waiting_input` (con `prompt`), `cancelled`. Cada llamada devuelve solo la salida **nueva**. `text` lleva una cabecera `status · exit code · duration · pid`, frases llanas (`The command finished successfully.` / `failed (exit code N)` / cómo continuar) y el cuerpo con prioridad a la cola, dentro de `BUDGET.summaryMax` (2500). `raw` lleva todo lo no leído con un tope de 500 000 caracteres del inicio y del final.

**Prompt = inactividad.** Si la salida lleva 1,5 s quieta, el proceso sigue vivo y la última línea (hasta 300 caracteres) quedó sin salto de línea, se devuelve `waiting_input`. El motor llama a `askUser` con ese texto literal; la respuesta vuelve en `run_command { pid, input }`.

**Cierre.** `onTaskEnd(taskId, "failed" | "cancelled")` corta el árbol de los procesos de la tarea; con `"completed"` los deja y los marca huérfanos. `close()` corta todos. Con 8 procesos vivos, un comando nuevo cierra el huérfano más antiguo; si no hay, falla.

**Seguridad.** El Guard decide sobre la llamada (comandos catastróficos: DENY; rutas sensibles, incluido `cwd`: confirmación obligatoria; escritura: confirmación salvo un comando que `isReadOnlyCommand` demuestra de solo lectura o una continuación `{ pid }` sin `input`). Repetición: un comando nuevo es `strict`, una continuación por `pid` es `allow` (`repeatByArgs`).

## 4. Qué se validó y cómo

- **Pruebas automáticas** (`tests/run_command.test.ts`, 17, ~16 s): código de salida real (`exit 7`, `cmd /c exit 3`, cmdlet que falla), UTF-8, salida de 20 000 líneas, plazo y continuación, prompt (`[Console]::In.ReadLine()`) con respuesta, `Read-Host` que falla en el acto, cancelación, cierre del árbol de procesos (incluido un hijo con `Start-Process -NoNewWindow`), `cwd`, validaciones, plazo del manifiesto, proceso cortado desde fuera (código distinto de 0), tope de procesos con huérfanos. Toda la suite: 196 de 196.
- **Pruebas manuales con PowerShell real** [Vivo]: `cwd` con tildes y espacios, comando de 3990 caracteres, emoji fuera del plano básico (`😀`), línea de 400 000 caracteres sin salto, 300 000 líneas (12 s, el cuello es PowerShell), `node -e` leyendo stdin, `cmd /c pause`, servidor HTTP de `node` en segundo plano, colores ANSI, programa inexistente. Todo correcto salvo lo listado abajo.
- **Tareas reales de punta a punta** [Vivo] (modelos reales `qwen3.5:4b` y `d3:2b` por Ollama, composición igual a `server.ts` con `autoMode` apagado):
  1. "¿Qué versión de Node.js tengo instalada? Usá la terminal." → `run_command {command:"node --version"}`, pidió confirmación (el comando no está en la lista de solo lectura), respuesta correcta (v24.12.0).
  2. "Ejecutá en PowerShell el comando: cmd /c pause. Avisame cuando termine." → ver RC-12 y RC-13.
  3. Una escritura pedida "usando la terminal" fue a la ruta de archivos (`create_directory`): ver RC-24.

## 5. Hallazgos

### Detección de prompts y entrada

**RC-01 · Limitación · Media · [Vivo] — La detección por inactividad da falsos positivos y falsos negativos.**
- *Falso positivo:* `Write-Host -NoNewline 'progreso...'; Start-Sleep 3; Write-Host ' listo'` con `timeoutSec: 10` devolvió `waiting_input` a los 1,7 s con `prompt: "progreso..."`. Una barra de progreso que se detiene, o un programa lento que escribe sin salto de línea, pregunta al usuario sin motivo.
- *Falso negativo:* `findstr x` (lee la entrada hasta el final) y `node -e "process.stdin.on('data',…)"` no muestran ningún prompt: quedan `running` hasta el plazo. Responderles con `{ pid, input }` funciona (se probó con `node`).
- *Contexto:* Node no puede saber si un proceso está bloqueado leyendo su entrada. No hay PTY. Desktop Commander (que se probó antes de decidir) tampoco detectaba bien: `Read-Host` no mostraba ni el texto y `set /p` no pasaba a "esperando entrada".
- *Investigar:* heurísticas complementarias (patrones como `[S/N]`, `?`, `:`, `>` al final), un umbral de inactividad distinto, qué pasa si el proceso sigue escribiendo después de que se preguntó, y si compensa una consola pseudo-terminal (ConPTY) a costa de una dependencia nativa.

**RC-02 · Limitación · Media · [Test] — Una sola pregunta por paso.**
`maxQuestionsPerStep` vale 1 y lo comparten las preguntas del modelo y las de procesos. Un instalador que pregunta dos veces deja el segundo `waiting_input` sin preguntar: las llamadas siguientes repiten el estado hasta el tope de llamadas (`call_cap`) y el paso falla. Es un límite aceptado para 1.0, no un error.
*Investigar:* un tope propio para los prompts de procesos (separado del de preguntas del modelo) y qué cota razonable ponerle.

**RC-03 · Limitación · Media · [Vivo] — Los prompts propios de PowerShell no se pueden responder.**
Con `-NonInteractive`, `Read-Host`, `pause` y `-Confirm` fallan en el acto (`New-Item … -Confirm` devolvió `exit 1` con "Windows PowerShell se encuentra en modo no interactivo…", mensaje en español). Se eligió así para que nada se cuelgue (con Desktop Commander `Read-Host` ni siquiera mostraba el texto del prompt). Solo los programas externos que leen su entrada (`cmd /c pause`, `set /p`, un `node` o `python` que pregunta) llegan a `waiting_input`.
*Consecuencia:* un comando que pide confirmación falla y el modelo debe reescribirlo (`-Force`, `-Confirm:$false`); el mensaje de error le explica el motivo.
*Investigar:* si conviene reconocer ese error y devolver una indicación más útil al modelo, o si hay una forma de soportar la confirmación sin colgarse.

**RC-04 · Inconsistencia · Media · [Código] y [Vivo parcial] — `waiting_input` encarece la generación de argumentos.**
`callRunner` calcula `priorAttempts` como las llamadas de esa herramienta en el paso con `verdict !== "approved"`. Una llamada `waiting_input` queda sin veredicto, así que cuenta, y `priorAttempts` sube la temperatura (`argsTemperature`) del modelo que genera `{ pid, input }`, justo cuando necesita precisión. También cuenta como ejecución (`maxCallsPerStep`, 6) y como intento (`maxAttemptsPerStep`, 10). No se midió el efecto sobre la calidad.
*Investigar:* si `waiting_input` debe contar como intento fallido, y el efecto real de la temperatura.

### Comportamiento del modelo alrededor de la tool

**RC-12 · Riesgo · Media · [Vivo] — El modelo chico no continúa por el `pid` de forma fiable.**
En la tarea real `cmd /c pause`:
- *Primera corrida (antes de agregar frases llanas):* tras la pregunta al usuario, el modelo lanzó un comando **nuevo** (`pause`), que falló; luego sí continuó con `{pid, input:"ok"}`, pero el verificador rechazó (`not_accomplished`) un `finished` sin salida y el modelo intentó `write_file` dentro de la carpeta de refs: el Guard lo denegó (regla B) y la tarea cerró con `security_denied`.
- *Segunda corrida (con texto que dice "continue THIS process with run_command { pid, input }" y "The command finished successfully."):* completó, pero igual lanzó antes un comando de más (`echo ok | cmd /c pause`) antes de continuar por el `pid`.
*Contexto:* la herramienta se describe en 80 caracteres ("Run a PowerShell command, or continue a running one by its pid.") más notas por parámetro; el generador de argumentos ve el hecho `process` (el pid) y la respuesta del usuario como `answer_<paso>_<n>`.
*Investigar:* la descripción y las notas del manifiesto, qué ve exactamente el generador en la vista de argumentos, y por qué el verificador no entiende un `finished` sin salida.

**RC-13 · Riesgo · Media · [Vivo] — Un desvío del modelo puede cerrar la tarea entera.**
Es el segundo tramo de RC-12: un `write_file` hacia la carpeta de refs es DENY del Guard y cierra la tarea con `security_denied` (comportamiento existente del motor, no de la tool). No es un defecto de `run_command`, pero se manifestó a través de ella.

**RC-14 · Inconsistencia · Baja · [Código] — El hecho `process` guarda un solo pid.**
Con dos procesos en segundo plano (dos servidores) el hecho apunta al último; el otro solo se conoce por el resumen de su llamada.

### Ciclo de vida de los procesos

**RC-05 · Limitación · Media · [Código] y [Test] — Procesos huérfanos.**
Lo que deja una tarea completada sigue vivo, y nadie lo puede continuar (otra tarea tiene otro `taskId`). Solo se cierra si se llega al tope de 8 (el más antiguo), al apagar Jarvis (`close`) o nunca. No hay forma de listarlos ni de pararlos salvo un comando nuevo `Stop-Process -Id <pid>` (con confirmación) que el modelo tiene que saber escribir. El usuario no los ve en la interfaz.
*Investigar:* si conviene un mecanismo visible (aviso al terminar la tarea, listado, parada), y si 8 es el tope correcto.

**RC-06 · Riesgo · Media · [Código] — Procesos lanzados fuera del árbol.**
`taskkill /T` corta por relación padre-hijo. `Start-Process app` (sin `-NoNewWindow`) deja un proceso cuyo padre puede desaparecer: si PowerShell ya salió, ese proceso no está en el árbol ni en el registro y nunca se cierra. Es deseable para "lanzar una aplicación", pero deja procesos que ninguna parte controla. Las pruebas del árbol usaron `-NoNewWindow` con `Wait-Process` para mantener al padre vivo.
*Investigar:* qué debe pasar con las aplicaciones lanzadas a propósito (¿se rastrean por el pid que devuelve `-PassThru`?) y qué debe pasar al cancelar.

**RC-07 · Riesgo · Media · [Código] — `/api/mcp/<servidor>/call` lanza procesos sin tarea.** *(corregido 2026-11-11: no ocurre. El endpoint rechaza toda herramienta con `policy.mutates`, y `run_command` lo es por catálogo, así que responde 403 aunque el Guard diga ALLOW. Lo fija una prueba en `tests/http.test.ts`.)*
`src/server/mcpRouter.ts` deja pasar lo que el Guard permite sin confirmación. Un `run_command` de solo lectura (`Get-Process`) se ejecuta ahí sin `taskId`: nadie lo cierra al terminar una tarea; solo se olvida a los 10 minutos si ya terminó, o `close()` al apagar Jarvis. Un `{ pid }` sin tarea solo ve procesos sin tarea. No se probó por HTTP.
*Investigar:* si `run_command` debe estar disponible por ese endpoint.

**RC-08 · Riesgo · Baja · [Código] — Cierre con un hijo que hereda las tuberías.**
Tras el evento `exit` se espera 300 ms a `close`; si un proceso hijo conserva stdout/stderr, `close` no llega y se da el proceso por terminado: lo que el hijo escriba después se pierde. No se probó.

**RC-09 · Riesgo · Baja · [Código] — Sin vigilante de plazo duro.**
`timeoutMs` (315 s en el manifiesto) acota la espera de la herramienta, pero no hay un temporizador que aborte la llamada entera: `spawnProcess` espera el evento `spawn` sin plazo y `killTree` espera a `taskkill` sin plazo. La cancelación de la tarea sí actúa (el motor abandona la llamada).

### Salida y codificación

**RC-10 · Limitación · Media · [Vivo] — Las herramientas del sistema de Windows salen con las tildes rotas.** *(corregido 2026-11-11: no todas usan la OEM; `chcp` escribe en la ANSI 1252. Y hay dos caminos: si la salida va directo, los bytes OEM llegan a Node; si la recoge PowerShell (`| Select-Object`, `$x = …`), PowerShell los decodifica como UTF-8 y la `�` ya viene hecha. Resuelto: ver §9.)*
`ipconfig | Select-Object -First 4` devolvió `Configuraci�n IP de Windows`; `chcp` devolvió `P�gina de c�digos activa: 850`. Esas herramientas escriben sus mensajes en la página OEM (850). El prólogo fija `[Console]::OutputEncoding = UTF8` (correcto para cmdlets, git, node, npm). Se probaron tres variantes: UTF-8 (actual), `chcp 65001` previo (no ayuda: `chcp` mismo sigue escribiendo bytes OEM aunque informe 65001) y dejar OEM (arregla las herramientas del sistema, pero rompe todo lo que es UTF-8 y pierde en los cmdlets los caracteres fuera de 850: `€`, comillas tipográficas, CJK). Los datos (nombres, números, direcciones) no se pierden.
*Investigar:* si hay una forma de decodificar por comando o por herramienta, o de detectar `�` y avisar al modelo.

**RC-11 · Inconsistencia · Baja · [Vivo] — Mezcla de errores.**
stdout y stderr se reciben por tuberías separadas y se unen en el orden de llegada: no es el orden de emisión exacto. Además `Write-Error` imprime el texto completo del script (incluida la línea final que calcula el código de salida) como "contexto", lo que añade ruido al final de la salida, justo donde se prioriza.
**RC-15 · Bug menor · Baja · [Código] — Un solo `LineNormalizer` para dos flujos.**
`collect` crea un normalizador compartido por stdout y stderr: el `\r` pendiente de un flujo puede afectar al primer carácter del otro. El efecto es un salto de línea de más, nunca pérdida de texto. No hay prueba que lo cubra.

### Entorno y seguridad

**RC-16 · Riesgo · Media · [Vivo] — El proceso hijo hereda el entorno de Jarvis.**
Se confirmó que el comando ve `PATH` y el usuario. `server.ts` importa `dotenv/config`, así que lo que haya en `.env` también queda en el entorno de cada comando (lo mismo que ocurría con Desktop Commander). La regla de rutas sensibles revisa el *texto* de un comando que nombre variables que parecen secretos, no lo que un programa lanzado herede.
*Investigar:* entorno filtrado o con lista de permitidos.

**RC-17 · Falta · Baja · [Código] — Sin `-NoProfile` configurable.**
Se lanza con `-NoProfile`: no hay alias, funciones ni módulos del perfil del usuario (por ejemplo, `conda` si se inicializa desde el perfil). Es intencional (previsibilidad), pero puede sorprender.

**RC-18 · Inconsistencia · Baja · [Código] — Directorio de trabajo por defecto.**
`server.ts` registra `new TerminalProvider()` sin opciones: la carpeta personal del usuario. El modelo no sabe cuál es (la nota de `cwd` dice solo "Absolute working directory for a new command"). No se verificó cuál era el valor por defecto de Desktop Commander ni si el cambio altera tareas existentes.

**RC-19 · Inconsistencia · Baja · [Código] — Argumento recortado en el contexto, completo en la ejecución.**
El manifiesto recorta `command` a 1000 caracteres al registrar la llamada (`argCaps`), pero la tool acepta 4000. El verificador y la revisión de argumentos (D3) ven el comando recortado; la huella para el anti-bucle se calcula sobre el completo. No se probó una cola peligrosa fuera de las primeras 1000 letras.

### Confirmaciones y repetición

**RC-20 · Inconsistencia · Media · [Vivo] — Dos confirmaciones al responder un prompt (modo manual).**
`{ pid, input }` es una escritura: pide confirmación aunque el usuario acaba de responder la pregunta del proceso. En la tarea real aparecieron las dos. Tratar el `input` como preaprobado si coincide con la respuesta del usuario tiene un costo de seguridad (el generador podría inventar el texto o una salida hostil sugerirlo): no se decidió.
**RC-21 · Riesgo · Media · [Código] — La repetición estricta puede bloquear un flujo legítimo.**
Un comando nuevo es `strict`: un comando de escritura idéntico a uno ya ejecutado se bloquea (`loop_blocked`) salvo que haya habido una *lectura* entre medio. En "correr las pruebas, corregir, volver a correr las pruebas" el segundo `npm test` queda bloqueado si en el medio solo hubo escrituras. Es el comportamiento que tenía `start_process`; no se verificó en un flujo real.
*Investigar:* si debe relajarse tras un efecto intermedio.
**RC-22 · Falta · Baja — Poco comando de lectura reconocido.**
`isReadOnlyCommand` es una lista cerrada y conservadora: `node --version`, `git status`, `npm ls` piden confirmación cada vez (se vio en la tarea real 1). Es deliberado (fail-closed), pero fricciona.

### Faltantes y cosas sin probar

**RC-23 · Falta · Media · [Sin probar] — Lanzar aplicaciones gráficas.**
La descripción de la ruta promete "launching apps". `windowsHide: true` oculta la consola de PowerShell; no se verificó si una aplicación gráfica lanzada con `Start-Process` o directamente se ve o queda oculta, ni qué pasa con su pid. Probarlo abre una ventana en la PC del usuario.
**RC-24 · Observación · Baja · [Vivo] — D1 puede ignorar "usando la terminal".**
"Creá una carpeta … usando la terminal" fue a la ruta `files` y usó `create_directory`. El resultado fue correcto; no es un defecto de la tool. Pertenece al pendiente de la salida de escape (cambios de ruta de D1).
**RC-25 · Falta · Baja — Sin listar ni parar procesos como herramienta.**
Decisión de diseño (no hay `kill_process` ni `list_processes` para el modelo). Ver RC-05.
**RC-26 · Falta · Baja — Constantes no configurables.**
30 s, 300 s, 8 procesos, 4000/1000 caracteres, 1,5 s de inactividad y los topes de memoria están en el código, no en `jarvis-config.json`.
**RC-27 · Falta · Baja — Poca observabilidad.**
`meta` solo lleva `waitLimitMs`; la traza no tiene el comando efectivo, la carpeta ni los tiempos de cada etapa.
**RC-28 · Riesgo · Baja · [Código] — Pruebas sensibles al tiempo.**
Las pruebas con procesos reales dependen de relojes (1,5 s de inactividad, plazos de 1 s) y de PowerShell: pueden ser inestables en una máquina cargada.
**RC-29 · Falta · Baja — Solo Windows PowerShell 5.1.**
No usa `pwsh`. En otras plataformas devuelve un error y `isConnected()` es falso, pero `listTools()` sigue listando la herramienta.
**RC-30 · Sin probar — Concurrencia.**
Hasta 4 tareas simultáneas con procesos propios y un tope global de 8: no se probó con tareas reales en paralelo.

## 6. Cómo reproducir

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=60000 tests/run_command.test.ts   # ~16 s, Windows
npm test                                                         # toda la suite
```

**Scripts de validación** (en `scripts/validate/`, con un README; no son pruebas, ejecutan casos reales y muestran lo que ocurre):

| Script | Para qué sirve en esta revisión |
| --- | --- |
| `run_command_probe.ts` (`--big` suma 300 000 líneas) | Casi todo lo marcado [Vivo] arriba: codificación (RC-10), errores (RC-03, RC-11), prompts y entrada (RC-01), procesos en segundo plano (RC-05), límites y entorno (RC-16). Cada caso cita su hallazgo |
| `tasks_e2e.ts` (`--only=N`, `--judge`) | Las tareas reales de punta a punta (pedidos 1, 3, 5 y 6 son de esta tool): modelos reales, `autoMode` apagado, esperas contestadas por el propio script. Necesita Ollama (`qwen3.5:4b` y `d3:2b`) |
| `powershell_launch_probe.mjs` | Por qué se lanza PowerShell como se lanza: `-EncodedCommand` frente a `-Command` (CLIXML), dónde calcular el código de salida, la página de códigos (RC-10) |

```bash
npx tsx scripts/validate/run_command_probe.ts
npx tsx scripts/validate/tasks_e2e.ts --only=3
node scripts/validate/powershell_launch_probe.mjs
```

## 7. Qué ya está decidido como fuera de 1.0 (no reabrir sin motivo)

REPL interactivos que necesiten un PTY (`python -i`); procesos que sobrevivan a la tarea para retomarlos desde otra; paralelismo de procesos de un mismo trabajo; entrada generada por un modelo; más de un prompt por paso.

## 8. Qué tipo de mejora pide cada hallazgo

Para repartir el trabajo: **código** es lo que se resuelve cambiando la lógica; **prompt y texto** es lo que se resuelve cambiando lo que lee un modelo (descripciones y notas del manifiesto en `src/core/tools/manifest.ts`, descripciones de las rutas `DESTINATIONS` del mismo archivo —las lee D1—, los textos que devuelve la tool y los prompts de `src/core/models/prompts.ts`); **decisión** es algo que hay que resolver antes de tocar nada (de diseño, de seguridad o de producto); **medición** es investigar o probar antes de saber si hay algo que cambiar.

| Naturaleza | Hallazgos |
| --- | --- |
| **Prompt y texto** (sin tocar la lógica) | **RC-12** (descripción y notas de `run_command`, y los textos del resultado: es la mejora de prompt más clara), **RC-24** (cómo D1 elige entre archivos y terminal: descripciones de ruta y prompt de D1) |
| **Código y también texto** | RC-03 (reconocer el error de modo no interactivo y devolver una indicación útil), RC-18 (decirle al modelo cuál es la carpeta por defecto y, quizá, cambiarla) |
| **Código** | RC-01, RC-02, RC-04, RC-08, RC-09, RC-11, RC-14, RC-15, RC-19, RC-21, RC-22, RC-26, RC-27, RC-28 |
| **Código y decisión** | RC-05 y RC-06 (qué hacer con lo que deja corriendo una tarea), RC-07 (si debe existir por `/api/mcp`), RC-16 (entorno filtrado), RC-20 (preaprobar la respuesta a un prompt) |
| **Decisión** | RC-13 (que un desvío del modelo cierre la tarea: es del motor), RC-17, RC-25, RC-29 |
| **Medición o prueba** | RC-10 (no tiene arreglo conocido; medir alternativas), RC-23 (aplicaciones gráficas), RC-30 (concurrencia) |

En síntesis: de 30 hallazgos, **dos son de prompt y texto** (RC-12, RC-24), **dos mezclan código y texto** (RC-03, RC-18) y el resto es código, decisiones o pruebas. Lo que más pesa en la experiencia real (RC-12: que el modelo chico continúe por el `pid`) es una mejora de texto.

## 9. Estado tras la revisión del 2026-11-11

Verificado contra el código y con PowerShell real en la PC de desarrollo (Windows 11 en español, OEM 850, ANSI 1252, Windows PowerShell 5.1, Defender activo). Los prompts y textos del manifiesto, `DESTINATIONS`, `models/prompts.ts` y `eval/` no se tocaron.

### 9.1 Qué cambió en el código

- **`src/tools/terminal/output.ts`.** `OutputDecoder`: UTF-8 tal cual (también partido entre fragmentos); una línea que no es UTF-8 válido se decodifica con la página OEM o la ANSI del sistema, la que dé más letras acentuadas. `cleanTerminalText`: escapes ANSI (también partidos entre fragmentos), retrocesos aplicados y sin caracteres de control sueltos. `LineAssembler`, uno por flujo: `\r\n` es un salto, un `\r` suelto reescribe la línea (una barra de progreso queda en su última versión), la línea abierta se retiene hasta su salto y stdout y stderr se unen por líneas enteras.
- **`src/tools/terminal/prompts.ts`.** La última línea se clasifica (`strong`: `[S/N]`, `Press any key`, `Contraseña`; `likely`: termina en `:`, `?`, `>`, `]`…; `weak`: otro texto; `none`: un avance como `progreso...`, `45%`, `[####  ]`) y cada clase pide su silencio: 1,5 s, 1,5 s, 5 s o nunca. Una elección o una tecla en una línea ya terminada cuenta tras 3 s.
- **`src/tools/terminal/powershell.ts`.** La línea de `-Command`. Ayudas que se leen de un archivo `.ps1` (`%TEMP%\jarvis-terminal\helpers-<hash>.ps1`, como texto, sin directiva de ejecución): `Read-Host` respondible (escribe el prompt y lee la entrada estándar: `Read-Host` y `pause` llegan a `waiting_input`), y envoltorios de 31 herramientas del sistema (`ipconfig`, `ping`, `netsh`, `systeminfo`, `tasklist`, `chcp`…) que decodifican su salida línea por línea cuando la recoge PowerShell y conservan su código de salida. El comando corre como la función `script` (un `Write-Error` dice `script : boom` y no arrastra el texto del comando ni el epílogo). El prólogo pone también la entrada en UTF-8. Si las ayudas no cargan, el proceso sale sin correr el comando y el proveedor lo relanza sin ellas.
- **`src/tools/terminal/terminalProvider.ts`.** Reserva de lugar antes del primer `await` (dos lanzamientos simultáneos no pasan el tope), plazo de 15 s para que arranque PowerShell, entorno filtrado (`envRemove`) con `PYTHONIOENCODING=utf-8` y `PYTHONUNBUFFERED=1` si el usuario no los definió, huérfanos sin búfer de salida, aviso cuando un programa lanzado se queda con la salida (`detached`), la respuesta a un prompt cierra la línea abierta, `meta` con el comando, la carpeta, los tiempos, la clase de prompt y los caracteres por flujo. `MAX_COMMAND_CHARS` sale del `argCaps` del manifiesto (1000).
- **`src/tools/terminal/processTree.ts`.** `killTree` nunca espera más de 5 s; si `taskkill` no termina, corta al menos el proceso principal.
- **`src/tools/terminal/codepages.ts`.** Páginas OEM y ANSI del registro, una vez (850 y 1252 si no se pueden leer).
- **Núcleo (cambios chicos).** `engine/callRunner.ts`: un `waiting_input` no cuenta en `priorAttempts` (RC-04). `policy/readOnly.ts`: invocaciones de lectura con argumentos exactos (RC-22). `server.ts` (raíz de composición): `envRemove` con las variables cargadas de `.env` (RC-16).
- **Pruebas.** `tests/run_command.test.ts` (de 17 a 29 pruebas: decodificación, líneas, clases de prompt, `Read-Host`, `python -i`, tildes de `ipconfig`/`chcp`/`ping`, códigos de salida de los envoltorios, entorno, concurrencia, salida heredada, ayudas que no cargan), `tests/readonly.test.ts` (RC-22, positivos y negativos), `tests/engine.test.ts` (RC-04), `tests/http.test.ts` (RC-07). Toda la suite: 211 de 211.
- **Sondas.** `run_command_probe.ts` suma los casos nuevos; `powershell_launch_probe.mjs` suma la parte 4 (antivirus).

### 9.2 Estado por hallazgo

| Hallazgo | Estado (2026-11-11) | Cómo, y qué queda |
| --- | --- | --- |
| RC-01 Detección por inactividad | **Parcial** | Clases de prompt (`prompts.ts`). El falso positivo del documento (`progreso...` + 3 s) da `finished` [Vivo, prueba]. Un texto sin forma de prompt necesita 5 s en vez de 1,5. Queda: el falso negativo (`findstr`, `node` leyendo stdin sin prompt) sigue `running`; Node no puede saber si un proceso está bloqueado leyendo. ConPTY: ver 9.4 |
| RC-02 Una pregunta por paso | **Pendiente** | Fuera de 1.0 (§7). Pesa más ahora que los REPL funcionan: en `python -i` cada línea nueva es otro prompt y en el mismo paso no se puede volver a preguntar (cae en `call_cap`). Necesita un tope propio en `limits.ts` y `canAskUser`; es una decisión del flujo |
| RC-03 Prompts propios de PowerShell | **Parcial** | `Read-Host` y `pause` se responden por `waiting_input` [Vivo, prueba, con tildes]. `-Confirm`, `Get-Credential` y los parámetros obligatorios siguen fallando en el acto, y el texto ahora lo explica (`Pass the values as parameters, or add -Confirm:$false or -Force`). `Read-Host -AsSecureString` falla con un mensaje claro: no se piden contraseñas por el chat |
| RC-04 `waiting_input` encarece los argumentos | **Resuelto** | `callRunner`: no cuenta en `priorAttempts` (la temperatura no sube al responder). Sigue contando como ejecución e intento (2 de 6 en el caso normal); no se midió efecto en calidad |
| RC-05 Huérfanos | **Parcial** (decisión a confirmar) | Siguen vivos (pudo ser lo pedido: un servidor). Nuevo: se registra en consola qué dejó cada tarea, no se guarda su salida (antes acumulaban hasta ~1 M de caracteres cada uno) y, al terminar, se olvidan en el acto. Listarlos o pararlos desde la interfaz es RC-25 |
| RC-06 Procesos fuera del árbol | **Pendiente** | Verificado: `Start-Process app` y una app gráfica lanzada directo quedan fuera del árbol y no se cortan al cancelar. Rastrearlos exigiría un Job Object (código nativo) o seguir el pid de `-PassThru`. Se deja así: lanzar una app es justamente que sobreviva |
| RC-07 `/api/mcp` sin tarea | **Descartado** | No ocurre (ver la corrección en RC-07): 403 por `policy.mutates`. Prueba en `tests/http.test.ts` |
| RC-08 Hijo que hereda las tuberías | **Resuelto** | A los 300 ms del `exit` se sueltan los flujos (no quedan escuchas ni memoria creciendo), `data.detached = true` y el texto lo dice [Vivo, prueba con `Start-Process -NoNewWindow`] |
| RC-09 Sin plazo duro | **Resuelto** | 15 s para arrancar PowerShell; `killTree` con tope de 5 s y corte del principal; `dispose` ya tenía 2 s (y ahora no se queda esperando si llega salida antes del fin) |
| RC-10 Tildes de las herramientas del sistema | **Resuelto** (con riesgo residual) | Directo: Node decodifica línea por línea en OEM o ANSI lo que no es UTF-8. Recogido por PowerShell: los envoltorios. `ipconfig`, `ipconfig \| Select-String`, `$x = ipconfig`, `chcp`, `ping \| Out-String`, `systeminfo \| Select-String` salen sin `�` [Vivo, prueba]. Queda: invocadas con extensión (`ipconfig.exe`, `tree.com`) no se envuelven; páginas OEM sin tabla (852, 857…) usan solo la ANSI; los dibujos de caja de `tree` sin `/A` pueden salir mal; elegir la página es una heurística (más letras acentuadas) |
| RC-11 Mezcla de errores | **Parcial** | `Write-Error` ya no repite el comando ni el epílogo (`script : boom` y `+ script`). stdout y stderr se unen por líneas enteras (nunca a mitad de línea), pero entre tuberías el orden sigue siendo el de llegada |
| RC-12 El modelo chico y el `pid` | **Fuera de alcance** (prompts) | No se tocaron descripción ni notas. Lo de la tool que puede ayudar: `(no output)` cuando un comando terminó sin escribir nada (antes `(no new output)`), que era lo que el verificador no entendía |
| RC-13 Un desvío cierra la tarea | **Pendiente** (decisión, del motor) | Sin cambios |
| RC-14 Un solo pid en el hecho `process` | **Pendiente** | Necesita cambiar el hecho en el contexto (`ctx/`, fuera de alcance). Cada resultado sigue diciendo su `pid` |
| RC-15 Un normalizador para dos flujos | **Resuelto** | Un `LineAssembler` por flujo |
| RC-16 Entorno heredado | **Resuelto** (decisión a confirmar) | `server.ts` pasa las variables de `.env` que siguen con el valor del archivo y el comando no las ve [prueba]. Queda: lo que traiga el entorno desde donde se lanzó Jarvis (otra terminal con tokens) se sigue heredando; un filtro por nombre rompería herramientas legítimas (`GITHUB_TOKEN` para `gh`) |
| RC-17 `-NoProfile` | **Pendiente** (decisión) | Sin cambios |
| RC-18 Carpeta por defecto | **Parcial** | La cabecera de un comando nuevo dice `cwd: <carpeta>`: el modelo la ve desde el primer resultado. La nota de `cwd` del manifiesto no dice cuál es la de por defecto (es prompt: queda para el usuario). El valor por defecto no cambió (la carpeta personal) |
| RC-19 Recortado en el contexto, completo al ejecutar | **Resuelto** (decisión a confirmar) | El tope de `command` baja de 4000 a 1000, el mismo `argCaps` del manifiesto (lo fija una prueba). Antes, el usuario aprobaba y D3 revisaba un comando del que solo veían los primeros 1000 caracteres |
| RC-20 Dos confirmaciones al responder | **Pendiente** (decisión de seguridad) | Opción conservadora: sin cambios. Propuesta lista para decidir: tratar como aprobado un `{ pid, input }` cuyo `input` es **exactamente** la última respuesta del usuario a la pregunta de ese proceso en el mismo paso (el usuario ya escribió ese texto para ese proceso; un texto inventado o sugerido por una salida no coincidiría). Se implementa en `callRunner` (o una función de `policy/`) leyendo el hecho `answer_<paso>_<n>` |
| RC-21 Repetición estricta | **Pendiente** | La regla está en `ctx/derive.ts` (`isRepeat`: una escritura idéntica solo se repite tras una lectura). Relajarla tras una escritura distinta intermedia es un cambio en `ctx/`, fuera de alcance |
| RC-22 Poco comando de lectura | **Parcial** | `READ_INVOCATIONS`: `node --version`, `npm ls/outdated/view/config get`, `git --version`, `python --version`, `dotnet --list-sdks`, `java -version`, `go version`, `where.exe`, `ipconfig [/all]`, `netstat -ano` y más `Get-*`; con argumentos exactos y fail-closed (pruebas de positivos y negativos). Fuera a propósito: `git status`/`git diff` (la configuración de un repositorio ajeno puede ejecutar programas: `core.fsmonitor`, `diff.external`), `npx`, `yarn`, `pnpm`, `pip` |
| RC-23 Aplicaciones gráficas | **Resuelto** (verificado) | `charmap` lanzado directo y con `Start-Process` abre su ventana visible (`MainWindowHandle` distinto de 0 y título) aunque PowerShell va oculto [Vivo]. Lanzada directo, la llamada termina enseguida con el pid de PowerShell (el de la app no se conoce); con `Start-Process -PassThru` sí. No se probó una app de la Tienda (el Bloc de notas de Windows 11). Procedimiento para el usuario en 9.6 |
| RC-24 D1 ignora "usando la terminal" | **Fuera de alcance** (prompts) | Sin cambios |
| RC-25 Sin listar ni parar procesos | **Pendiente** (decisión) | Sin cambios |
| RC-26 Constantes no configurables | **Parcial** | `TerminalOptions` acepta los silencios de prompt, el tope de procesos, el entorno excluido, las ayudas y las páginas de códigos. No pasan a `jarvis-config.json` (sería configuración visible para el usuario: decisión) |
| RC-27 Poca observabilidad | **Resuelto** | `meta`: comando (300 caracteres), carpeta, `spawnMs`, `waitedMs`, clase de prompt, caracteres por flujo, líneas decodificadas con la página heredada. `meta` va a la traza, nunca a los modelos |
| RC-28 Pruebas sensibles al tiempo | **Parcial** | Los silencios son opciones; las pruebas nuevas usan márgenes amplios (ninguna exige menos de 1,5 s de precisión). Las de procesos reales siguen dependiendo del reloj |
| RC-29 Solo PowerShell 5.1 | **Pendiente** (decisión) | Sin cambios |
| RC-30 Concurrencia | **Parcial** | Encontrado y arreglado RC-33. Sin prueba con tareas reales en paralelo |

### 9.3 Hallazgos nuevos

| Hallazgo | Tipo · gravedad · verificación | Qué se vio | Estado |
| --- | --- | --- | --- |
| **RC-31** | Bug · Media · [Vivo] | Una respuesta con tildes por `{ pid, input }` llegaba rota (`ñandú €` → `├▒and├║ Ôé¼`): PowerShell leía la entrada en la página OEM | **Resuelto**: el prólogo pone `[Console]::InputEncoding` en UTF-8 (prueba) |
| **RC-32** | Bug · Media · [Vivo] | `python -c "print('añ €')"` salía `a� �`: Python escribe en la ANSI cuando la salida es una tubería. Además guarda la salida en un búfer hasta terminar | **Resuelto**: `PYTHONIOENCODING=utf-8` y `PYTHONUNBUFFERED=1` en el entorno del comando, si el usuario no los definió |
| **RC-33** | Riesgo · Media · [Código] | El tope de procesos vivos se comprobaba y después se esperaba (`await`) el lanzamiento: varias llamadas simultáneas podían pasar juntas | **Resuelto**: reserva antes del primer `await` (prueba con dos lanzamientos simultáneos y tope 1) |
| **RC-34** | Limitación · Media · [Vivo] | Una barra de progreso con `\r` (npm, pip, curl) se convertía en una línea por actualización: llenaba la salida y el resumen | **Resuelto**: un `\r` suelto reescribe la línea |
| **RC-35** | Riesgo · Media · [Vivo] | Con las ayudas de PowerShell metidas en base64 en `-Command`, Defender (AMSI) bloqueó el comando entero ("Este script contiene elementos malintencionados"). El veredicto depende del contenido y de las firmas del día | **Resuelto**: las ayudas van en un archivo leído como texto; si no cargan, el proceso sale con un código propio sin correr el comando y se relanza sin ayudas (prueba). Restricción de diseño: no volver a meter bloques grandes en base64 en la línea de comandos |
| **RC-36** | Bug · Baja · [Código] | Una secuencia de escape partida entre dos fragmentos no se quitaba; retrocesos y caracteres de control llegaban al modelo | **Resuelto** (`cleanTerminalText`, retención de escapes abiertos) |
| **RC-37** | Bug · Baja · [Vivo] | En un REPL, tras responder, el prompt siguiente salía como `>>> >>>` (la línea abierta respondida seguía abierta) | **Resuelto** (`closeAnswered`; prueba con `python -i`) |
| **RC-38** | Riesgo · Baja · [Código] | `dispose` esperaba el fin con un `once`: si llegaba salida antes del fin, esperaba los 2 s completos | **Resuelto** |
| **RC-39** | Limitación · Baja · [Vivo] | `python -i` funciona sin PTY: escribe `>>> ` en stderr, se detecta como prompt y se responde línea por línea. Lo limita RC-02, no la falta de PTY | Informativo (ver 9.4) |
| **RC-40** | Limitación · Baja · [Código] | Los envoltorios solo cubren el nombre corto (`ipconfig`); `ipconfig.exe` o `tree.com` recogidos por PowerShell siguen con `�` | **Pendiente** (menor; se podría envolver también `nombre.exe`/`.com`) |

### 9.4 ConPTY (RC-01, reabierto): no se implementa

- **No hace falta para lo que se buscaba.** `python -i` ya llega a `waiting_input` y se responde (RC-39); `Read-Host` y `pause` también (RC-03). Lo que sigue sin funcionar con un PTY tampoco se arreglaría: el falso negativo de RC-01 (un PTY no dice si el proceso está leyendo) y RC-02 (una pregunta por paso).
- **Dependencia nativa.** Node no tiene ConPTY: hace falta `node-pty` (o un fork con binarios precompilados), que se compila o se baja por versión de Node; el proyecto evita justo eso (Desktop Commander se instaló con `--ignore-scripts` y sin red).
- **Cambia la salida.** Un PTY entrega una pantalla: secuencias de cursor, líneas partidas al ancho de la terminal y redibujos. Para obtener texto fiel haría falta un emulador (`xterm-headless`), y las salidas grandes (400 000 caracteres en una línea, 300 000 líneas) se vuelven lentas. La entrada aparece con eco en la salida.
- **`-NonInteractive`.** Con un PTY se podría quitar y `-Confirm` preguntaría, pero `PromptForChoice` dibuja menús que habría que detectar y responder, y vuelve el riesgo de procesos colgados que motivó `-NonInteractive`.
- **Lo que sí ganaría:** programas que exigen una terminal (`isatty`) o leen la consola directamente (`choice.exe`, contraseñas de `ssh`/`getpass`; estas últimas no deberían pasar por el chat). Si alguna vez hace falta: una opción `TerminalOptions.pty` con una dependencia opcional y vuelta a tuberías si no carga, solo para comandos que la pidan.

### 9.5 Cambios en lo que leen los modelos (para tener en cuenta al evaluar)

Todo en `text` y en `raw` de `run_command`; el manifiesto no cambió.
- Cabecera de un comando nuevo: `status · exit code · duration · pid · cwd: <carpeta>` (antes sin `cwd`).
- `(no output)` cuando el comando terminó sin escribir nada; `(no new output)` sigue para una continuación sin novedades.
- Notas nuevas: `PowerShell runs without interaction: …` cuando PowerShell quiso preguntar; `A program started by this command is still running in the background; its output is not captured.` con `detached`.
- Error de largo: `The command is longer than 1000 characters. Use a shorter command, or split the work into several commands.` (antes 4000, sin la sugerencia).
- `Read-Host` y `pause` dan `waiting_input` (antes fallaban con exit 1); `Read-Host -AsSecureString` falla con su propio mensaje.
- Un `Write-Error` sale como `script : <mensaje>` con `+ script` de contexto (antes repetía el comando y el epílogo).
- Las tildes de las herramientas del sistema y de Python llegan bien; las barras de progreso, en su última versión; sin caracteres de control.
- Detección de prompts: menos `waiting_input` falsos (avances), y un texto sin forma de prompt tarda 5 s en contar.
- Comandos de lectura nuevos (RC-22): no piden confirmación, su salida va a DATA y no pasan por D3.
- Generación de `{ pid, input }` tras un `waiting_input`: `priorAttempts` ya no sube (temperatura más baja).

### 9.6 Decisiones a confirmar (aceptadas por el usuario el 2026-11-11)

1. **Tope de `command` en 1000 caracteres** (antes 4000), igual al recorte con que se registra (RC-19). Alternativa: subir `argCaps.command` a 4000 (más contexto por llamada).
2. **Huérfanos vivos** al completarse la tarea, sin salida guardada (RC-05). Alternativa: cerrarlos tras un tiempo, con el riesgo de matar un servidor pedido.
3. **Entorno sin las variables de `.env`** y con `PYTHONIOENCODING`/`PYTHONUNBUFFERED` (RC-16, RC-32).
4. **`Read-Host` se responde por el chat** (lo que el usuario escribe queda en el hecho `answer_*` y en la traza); `-AsSecureString` se rechaza.
5. **Lista de lectura ampliada** (RC-22), sin `git status`.
6. **Archivo de ayudas en `%TEMP%\jarvis-terminal`**, que la misma cuenta puede modificar (quien puede, ya ejecuta lo que quiera con esa cuenta).
7. **Código de salida de un envoltorio:** una herramienta del sistema que falla como último comando da su código, aun dentro de una tubería (`ipconfig /x | Out-String` sale con 1).
8. **RC-20 sin cambios** (dos confirmaciones), con la propuesta de 9.2 lista.

### 9.7 Qué queda por validar (usuario)

1. **Tareas reales de punta a punta.** `npx tsx scripts/validate/tasks_e2e.ts --only=2` (y `--only=1`). Mirar: tras `cmd /c pause`, que el modelo continúe por el `pid` y que la cabecera nueva (`cwd:`) y `(no output)` no lo confundan. Funciona: la tarea cierra `completed`. Falló: un comando nuevo en vez de `{ pid, input }`, o el verificador rechaza el `finished`.
2. **Efecto en `eval`.** Correr la evaluación habitual de `run_command`. Mirar los casos con comandos largos (>1000), con `Read-Host`/`pause` y con herramientas del sistema.
3. **Aplicación de la Tienda.** En una tarea: "abrí el Bloc de notas". Mirar que la ventana aparezca y que la llamada termine `finished`. Funciona: ventana visible. Falló: la llamada queda `running` o no aparece nada.
4. **Antivirus.** `node scripts/validate/powershell_launch_probe.mjs` (parte 4) después de usar la tool. Funciona: la línea "ayudas leídas del archivo" dice `corre`. Si dijera BLOQUEADO, la tool sigue funcionando sin ayudas (la consola de Jarvis avisa "no se pudieron cargar las ayudas") y hay que revisar `PS_HELPERS`.
5. **Sonda completa.** `npx tsx scripts/validate/run_command_probe.ts`. Mirar: ningún `�` en `ipconfig`, `chcp`, `ping`; `Read-Host` y `python -i` en `waiting_input`; `progreso... listo` en `finished`.
6. **Otra página de códigos.** En una PC con otro idioma de Windows (OEM 437, 852, 866): `ipconfig | Select-String IP`. Funciona: sin `�`. Con 852/857 se espera que falle (no hay tabla; queda como antes).

## 10. Segunda tanda (2026-11-11): pendientes y parciales

Con las propuestas de la §9 aceptadas, se revisó cada hallazgo que quedaba Pendiente o Parcial (y RC-40) para resolverlo de fondo, incluido lo que pide tocar el núcleo o `ctx/`. Regla: solo soluciones completas; lo que no se puede resolver bien queda con su motivo. **Esta tabla reemplaza el estado de la §9.2 para los hallazgos que nombra.**

### 10.1 Estado vigente

| Hallazgo | Estado | Cómo, o por qué no |
| --- | --- | --- |
| RC-01 Falso negativo de prompts | **Para Jarvis 2.0** | El falso positivo está resuelto (§9). Saber si un proceso está bloqueado leyendo su entrada (`findstr`, `node` leyendo stdin sin prompt) exige consultar la tubería con código nativo (`NtQueryInformationFile`) o un PTY; Node no lo expone. Mientras tanto queda `running` y se le puede responder con `{ pid, input }` |
| RC-02 Una pregunta por paso | **Resuelto** | Tope propio para las preguntas de procesos: `BUDGET.maxProcessPromptsPerStep` (3), en `engine/limits.ts` y `GET /limits`. `retries.ts`: `canAskProcessPrompt` y `canAskUser` (que ya no cuenta las de procesos); se distinguen por la clave del hecho de la respuesta (`answer_<paso>_<n>_p<pid>`, ver RC-20) y una lectura nueva del contexto, `ctx.answers(paso)` (clave, valor y momento de cada respuesta del paso; sin campos ni reglas nuevas en `ctx/`). `stepLoop` usa el tope propio. Pruebas: un proceso que pregunta dos veces (las dos se preguntan), uno que pregunta sin fin (3 por paso y la pregunta del modelo sigue disponible) |
| RC-03 Prompts propios de PowerShell | **Resuelto en lo que se puede; el resto para Jarvis 2.0** | `Read-Host` y `pause` se responden (§9). `-Confirm`, `ShouldProcess` y `Get-Credential` pasan por el host de PowerShell (`PromptForChoice`), que sin interacción falla: responderlos exige un host propio o un PTY. El texto le dice al modelo cómo seguir |
| RC-05 Huérfanos | **Resuelto** (decisión confirmada) | Siguen vivos, se registran en consola, no guardan salida y se olvidan al terminar. Verlos o pararlos desde la interfaz es RC-25 (decisión de producto) |
| RC-06 Procesos fuera del árbol | **Cerrado por diseño; rastrearlos, para Jarvis 2.0** | Lanzar una app es que sobreviva a la tarea: no se cortan al cancelar. Rastrearlas exige un Job Object (código nativo) |
| RC-11 Mezcla de errores | **Resuelto en lo que se puede; el orden exacto, para Jarvis 2.0** | Sin ruido de `Write-Error` y con líneas enteras (§9). El orden exacto entre stdout y stderr exige que los dos sean el mismo handle del sistema (un PTY, o un `SetStdHandle` con código nativo): dos tuberías no lo dan |
| RC-14 Un solo pid en el hecho `process` | **Resuelto** | `callRunner.processFactOps`: el hecho lista los procesos vivos de la tarea en el orden en que se lanzaron (`1111, 2222`) y quita los que terminan. Sin cambio en `ctx/`. Prueba con dos servidores |
| RC-16 Entorno heredado | **Resuelto** | Sin las variables de `.env` (§9). Lo que trae el entorno desde donde se lanzó Jarvis es el entorno del usuario: un comando en su propia terminal lo vería igual |
| RC-18 Carpeta por defecto | **Resuelto en el código; la nota la decide el usuario** | La cabecera dice `cwd:`. Que la nota de `cwd` del manifiesto diga cuál es la de por defecto es un cambio de texto del manifiesto |
| RC-20 Dos confirmaciones al responder | **Resuelto** | `retries.inputAnswersProcess` + `callRunner`: un `{ pid, input }` cuyo `input` es exactamente la respuesta del usuario a la pregunta de ESE proceso en este paso no pide confirmación ni pasa por D3. El `pid` va en la **clave** del hecho de la respuesta (`askUser(…, keySuffix)` → `answer_<paso>_<n>_p<pid>`; `processOfAnswerKey`), no en el texto: los modelos ven el texto, nunca la clave. Una primera versión lo ponía en el texto de la pregunta y el A/B con el verificador real lo descartó (10.4). La respuesta es lo que sigue a la última aparición del cierre de la pregunta (`processAnswerText`: un prompt hostil no la cambia). Cada respuesta autoriza un envío; un hecho que pudo recortarse no autoriza nada; no vale con una ruta sensible ni con la lista negra. Pruebas: envío autorizado, segundo envío, otro texto, modo automático, `processAnswerText` con un prompt que imita el cierre, la clave con el `pid` y la pregunta sin cambios |
| RC-21 Repetición estricta | **Decide el usuario** | Una regla global en `ctx/derive.ts` ("una escritura idéntica se repite tras un cambio intermedio") volvería a ejecutar escrituras ya aprobadas de cualquier herramienta (un `Add-Content` duplicado), y limitarla a las no aprobadas deja fuera el caso real (volver a correr pruebas que pasaron, después de un cambio). Lo correcto es una política propia: `RepeatPolicy` nueva en `ctx/derive.ts` ("repetir tras un efecto intermedio") que `run_command` declare para comandos nuevos en `repeatByArgs` del **manifiesto** |
| RC-22 Poco comando de lectura | **Resuelto** | Lista ampliada (§9). `git status` queda fuera a propósito |
| RC-26 Constantes no configurables | **Resuelto en el código; pasar a `jarvis-config.json` lo decide el usuario** | Todo es `TerminalOptions`. Llevarlo a la configuración es cambiar `jarvis-config.json` |
| RC-28 Pruebas sensibles al tiempo | **Aceptado** | Las pruebas de procesos reales dependen del reloj por naturaleza; ninguna exige menos de 1,5 s de precisión. Las de la lógica (líneas, decodificación, clases de prompt, motor) no usan relojes |
| RC-30 Concurrencia | **Resuelto** | Reserva de lugar (RC-33) y una prueba con cuatro tareas a la vez: cada una ve su salida, un prompt, una cancelación y un `running` no se cruzan, y una tarea no puede responder el proceso de otra |
| RC-40 Envoltorios solo por nombre corto | **Resuelto** | También `nombre.exe` y `nombre.com` (`ipconfig.exe`, `chcp.com`). Por ruta completa, no (prueba) |
| RC-12, RC-24 | **Deciden el usuario** (prompts) | Sin cambios |
| RC-13, RC-17, RC-25, RC-29 | **Deciden el usuario** (producto) | Sin cambios |

### 10.2 Hallazgo nuevo

**RC-41 · Bug · Media · [Vivo] — Continuar un proceso que ya terminó daba "no existe".** En la tarea real de `cmd /c pause` (línea base, 10.4), después de que el proceso terminó y su salida se entregó, el modelo volvió a mandar `{ pid, input: "ok" }`: la tool respondía `Process N does not exist or was not started by this task.` (error), el verificador rechazaba, y el modelo terminó lanzando otro `pause`. **Resuelto:** la tool guarda una lápida por proceso terminado (tarea, código, duración; hasta 64 y 10 minutos) y una continuación tardía de la misma tarea responde `finished` con su código, sin salida nueva, `data.alreadyReported: true` y la frase `This process had already finished; its output was returned by an earlier call.` (prueba).

### 10.3 Cambios en lo que leen los modelos (además de la §9.5)

- La pregunta de un proceso **no cambió** (se probó ponerle el `pid` y empeoró la verificación: 10.4).
- El hecho `process` puede listar varios `pid` (`1111, 2222`).
- Continuar un proceso ya terminado responde `finished` con la frase de 10.2 (antes, un error).
- Hasta 3 preguntas de procesos por paso (antes 1, compartida con el modelo), y la respuesta tal cual no pide confirmación.

### 10.4 Qué se corrió y qué dio

Todo en la PC de desarrollo (Windows 11 en español, Ollama con `qwen3.5:4b` y `d3:2b`), el 2026-11-11.

**Pruebas y tipos.**
- `npx tsc --noEmit`: limpio.
- `npm test`: **220 de 220** (antes de la revisión, 196). `tests/run_command.test.ts` 32 (de 17), `tests/engine.test.ts` 23, `tests/readonly.test.ts` 9, `tests/http.test.ts` 11, `tests/limits.test.ts` con el tope nuevo.

**Sondas.**
- `npx tsx scripts/validate/run_command_probe.ts`: 32 casos, ninguno con `�`. `ipconfig` directo, por la tubería y asignado; `chcp`, Python y `ping -t | Select-Object -First 3` correctos, sin `ping` vivo al final. `Read-Host` y `python -i` en `waiting_input` y respondidos; `progreso...` + 3 s da `finished`. La sonda tenía mal contado el caso de largo: el de "1001 caracteres" medía 986. Corregida, da error a los 1001 y corre a los 990.
- `node scripts/validate/powershell_launch_probe.mjs` (primera tanda): partes 1 a 3 como antes; parte 4, las ayudas actuales "corren" en base64 y desde el archivo. La versión que AMSI bloqueó era la que pasaba `-AsSecureString` al `Read-Host` original (RC-35).

**A/B con el verificador real (D4, `d3:2b`).** Mismo contexto, solo cambia el texto; `cumple` aprueba desde 0,6.

| Caso | Antes | Ahora | Lectura |
| --- | --- | --- | --- |
| Tarea `cmd /c pause`, `finished` tras responder: pregunta **con** el `pid` en el texto | cumple 0,63–0,65 (sin `pid`) | **0,35** | El `pid` en la pregunta hacía rechazar un resultado correcto: se descartó y el `pid` pasó a la clave del hecho |
| Carpeta creada con un comando mudo: cabecera con `cwd:` y `(no output)` | 0,92 | 0,93 | Neutro |
| `node --version` con `cwd:` | 0,99 | 0,99 | Neutro |
| `cmd /c exit 3` con `cwd:` y `(no output)` | ok 0,72 | ok 0,82 | Neutro (un `tool_error` se rechaza sin modelo igual) |

**Tareas de punta a punta** (`npx tsx scripts/validate/tasks_e2e.ts --only=N`; se agregó el pedido 7, un proceso que pregunta dos veces).

| Corrida | 1 `node --version` | 3 `cmd /c pause` | 5 y 6 carpetas | 7 dos preguntas |
| --- | --- | --- | --- | --- |
| Línea base (código de la primera tanda) | `completed`, **sin confirmación** (RC-22) | `completed`, con 3 confirmaciones de más del mismo `{ pid, input: "ok" }` y un `pause` de más tras errores "no existe" (RC-20, RC-41) | `completed` (las dos por `create_directory`: RC-24) | — |
| Segunda tanda con el `pid` en la pregunta (descartada) | `completed` | 3 de 3 `failed (security_denied)`: el verificador rechaza el `finished` (A/B de arriba) y el modelo termina en un `write_file` a refs (RC-13) | `completed` | 3 de 3 `partial` |
| Segunda tanda final | — | 6 corridas: 3 `completed`, 2 `failed (security_denied)`, 1 `partial`. La respuesta del usuario se envía sin confirmación la primera vez; un segundo envío, otro proceso u otro paso piden confirmación | — | `partial` |

**Qué muestran las tareas, más allá de la tool** (todo es del lado de los modelos; queda para el usuario):
- El verificador está en el límite con un `finished` sin salida tras responder (`cumple` ≈ 0,63 contra el umbral de 0,6): la tarea 3 sale bien o mal según la corrida.
- El generador de argumentos **inventa la entrada** en vez de usar la respuesta del usuario (`"hugof"`, `"Madrid"` cuando el usuario respondió `ok`). La tool y el motor lo tratan bien: un texto que el usuario no escribió pide confirmación. Pero el modelo no usa la respuesta (prompt del generador, RC-12).
- El generador manda `{ "command": "", "pid": N, "input": … }` (`info_missing`) antes de acertar con `{ pid, input }`, y reescribe el script pedido (pedido 7: en vez del comando con dos `Read-Host`, lanza uno solo varias veces). Por eso el pedido 7 nunca llega a la segunda pregunta en la tarea real; RC-02 lo cubren las pruebas del motor.
- Tras completar el paso, la lista de pendientes agrega pasos de más ("confirmar que terminó") y el modelo insiste con el `pid` ya terminado. Ahora la tool responde `finished` en vez de un error (RC-41), pero el verificador lo rechaza igual como "no cumple".
- Un desvío termina en `write_file` dentro de la carpeta de refs y cierra la tarea con `security_denied` (RC-13, decisión del motor).

**Solo razonado, sin correr:** otras páginas de códigos (437, 852, 866); apps de la Tienda; el efecto en `eval/` (no se corrió, por regla); el hecho `process` con varios `pid` frente al generador de argumentos (no hubo dos procesos vivos en las tareas reales).

### 10.5 Qué queda para el usuario

1. **Prompts (RC-12):** que el generador use la respuesta del usuario como `input` y no mande `command: ""` junto con `pid`; que el verificador acepte un `finished` sin salida tras responder un prompt (`cumple` ≈ 0,63 en el límite). El A/B de 10.4 deja armado cómo medirlo.
2. **RC-21:** decidir la política de repetición de `run_command` (ver 10.1).
3. **Manifiesto:** la nota de `cwd` (RC-18) y, si se quiere, que `command` admita más de 1000 caracteres subiendo también `argCaps` (RC-19).
4. **`jarvis-config.json`:** si las constantes de `TerminalOptions` deben ser configurables (RC-26).
5. **Producto:** RC-13, RC-17, RC-25, RC-29.
6. **`eval`:** correrlo con la tanda completa. Lo que más puede moverlo: `Read-Host`/`pause` respondibles, hasta 3 preguntas de procesos por paso, la respuesta sin confirmación, `finished` en vez de error para un `pid` ya terminado, `cwd:` y `(no output)` (§9.5 y 10.3).
7. Lo de la §9.7 que sigue en pie: app de la Tienda, otra página de códigos, antivirus tras actualizar firmas.

### 10.6 Cambios en el núcleo y en `ctx/` (segunda tanda)

- `ctx/derive.ts` y `ctx/context.ts`: lectura nueva `ctx.answers(paso)` (clave, valor y momento de cada respuesta del paso). Sin campos, reglas ni validaciones nuevas; los contratos de `Call` y `Fact` no cambian.
- `engine/ask.ts`: `askUser(…, keySuffix)` y, para procesos, la clave `answer_<paso>_<n>_p<pid>`; `processOfAnswerKey` y `processAnswerText`. El texto de la pregunta no cambió.
- `engine/retries.ts`: `processPromptsAsked`, `canAskProcessPrompt`, `canAskUser` sin las preguntas de procesos, `inputAnswersProcess`.
- `engine/stepLoop.ts`: el tope propio para la pregunta de un proceso, con el `pid` en la clave.
- `engine/callRunner.ts`: la respuesta del usuario sin confirmación ni D3 (RC-20); el hecho `process` como lista (RC-14); `CallOutcome` lleva el `pid` del proceso que espera.
- `engine/outcomes.ts`: `pid` opcional en el resultado `registered`.
- `budget.ts` y `engine/limits.ts`: `maxProcessPromptsPerStep` (3), también en `GET /limits`.

## 11. Tercera tanda (2026-11-11): pendientes de producto

**Reemplaza el estado de RC-13, RC-17, RC-18, RC-21, RC-25 y RC-29.** `npx tsc --noEmit` limpio; `npm test` 233 de 233.

| Hallazgo | Estado | Cómo |
| --- | --- | --- |
| RC-13 | **Resuelto** | Un DENY del Guard ya no cierra la tarea: queda `tool_rejected` (no ejecutada) con el motivo en inglés (`policyDenialNote`) y el modelo prueba otro camino. Las denegaciones (Guard, lista negra o servidor) tienen su tope: `maxDeniedPerStep` (2) falla el paso, no la tarea. Un `denied` del servidor tampoco falla el paso en el acto. `security_denied` queda en `StopReason` solo para leer trazas anteriores. Archivos: `callRunner.ts`, `stepLoop.ts`, `limits.ts`, `budget.ts`, `outcomes.ts` (causa `denied`). Pruebas en `engine.test.ts` y `limits.test.ts` |
| RC-17 | **Decisión: se mantiene `-NoProfile`** | Motivos: el perfil es código del usuario que correría en cada comando (seguridad); puede imprimir textos, cambiar alias o funciones (`ls`, `cd`) y alterar el resultado; puede tardar segundos (por ejemplo, `conda init`) o pedir interacción, que con `-NonInteractive` falla; y lo hace imprevisible entre PCs. Para lo que inicializa el perfil, usar la ruta completa o `conda run -n <entorno> <comando>` |
| RC-18 | **Resuelto** | La nota de `cwd` del manifiesto dice que por defecto es la carpeta personal del usuario |
| RC-21 | **Resuelto** | Reproducido en una tarea real (pedido 8 de `tasks_e2e.ts`), con **dos fallas**: (1) la lista de pendientes descartaba el segundo "npm test" por duplicado (`reconcileList`), y la tarea cerraba `completed` sin correrlo; (2) aunque llegara, `strict` lo bloqueaba y daba el paso por cumplido. Arreglos: (1) `pendingList.ts` solo descarta duplicados seguidos, y un pendiente que el código ya tenía no se pierde por parecerse a uno cumplido; (2) política nueva `rerun` (`ctx/derive.ts`): una escritura idéntica se repite si hubo un efecto en el medio. **Cómo distingue lo legítimo de lo dañino:** `policy/rerun.ts` lee el texto (fail-closed, el mismo análisis que `readOnly.ts`) y solo acepta comandos cuyos segmentos son pruebas, linters, chequeos o compilaciones de una lista cerrada (`npm test`, `npm run build|lint|test`, `tsc`, `pytest`, `dotnet build|test`, `cargo`, `go`, `git status|diff`…), más cambios de carpeta y lecturas: repetirlos reescribe sus salidas, no acumula. `Add-Content`, `>>`, `git commit`, `npm install`, `npm run deploy` o cualquier redirección quedan `strict`. Y aun así, sin un cambio en el medio sigue bloqueado. El manifiesto lo declara en `repeatByArgs`. Pruebas: `logic.test.ts`, `repeat.test.ts`, `readonly.test.ts` |
| RC-25 | **Resuelto** | Relevamiento de Desktop Commander 0.3.2: `start_process`, `read_process_output` e `interact_with_process` ya los cubría `run_command`. Faltaban `list_sessions` y `list_processes` (ahora `list_processes`: los procesos de `run_command` que ve la tarea, con su estado, o con `all` todos los de la PC con pid, nombre y memoria, sin línea de comandos), `force_terminate` y `kill_process` (ahora `stop_process`: uno de `run_command` se corta con su árbol y devuelve la salida sin leer; otro proceso de la PC, solo ese). Nunca se cortan los críticos de Windows, Jarvis, lo que cuelga de Jarvis (sus servidores) ni lo de otra tarea en curso (`processTree.ts`, `protectedReason`). Manifiesto: `list_processes` (READ) y `stop_process` (PROCESS_CONTROL, con confirmación). Pruebas en `run_command.test.ts` |
| RC-29 | **Solo Windows (Linux: para Jarvis 2.0)** | `listTools()` devuelve `[]` fuera de Windows, y el motor ya no ofrece un destino cuyo servidor respondió sin herramientas (`routesWithTools`). Un servidor caído se sigue ofreciendo, como antes. Motivo de no hacer Linux: el pre-chequeo, `readOnly.ts`, las ayudas, `killTree` y la detección de la plataforma están hechos para PowerShell y Windows (con `pwsh` en Linux podría reusarse casi todo), y no hay un Linux donde probarlo. No se declara soporte |

**Cambios que leen los modelos (para `eval`):** en el destino `terminal` D2 ahora elige entre tres herramientas (antes no había elección), con sus descripciones y notas nuevas; los motivos de denegación del Guard llegan al modelo; hay hasta 2 denegaciones por paso en vez de cerrar la tarea; la lista de pendientes conserva ítems repetidos no seguidos; y `npm test` y similares se repiten tras un cambio.

**Tareas reales (`tasks_e2e.ts`), después de los cambios:**
- Pedido 8 (RC-21), 2 de 2 `completed`: `npm test` corrió dos veces de verdad (antes, una: el segundo se perdía). El modelo escribió `notas.txt` en otra carpeta (`Documents`): es un error del generador, no de la política.
- Pedido 3 (RC-13), 3 de 3 `completed`. En dos corridas, el `write_file` a la carpeta de refs que antes cerraba la tarea con `security_denied` quedó `tool_rejected` y la tarea siguió hasta completarse.
- Pedido 9 (RC-25): 1 `completed` (usó `list_processes`; luego lo repitió y lo frenó el anti-bucle); 1 `partial (unrecoverable)`, que cerró por un servicio caído justo después de lanzar el proceso. No se vio `stop_process` usado en el pedido 9; sí apareció en una corrida del pedido 3 (sobre un proceso ya terminado: respondió `not_running`).
- Para revisar: la corrida `unrecoverable` del pedido 9 ("Falló un servicio necesario") no se investigó.

## 12. Revisión estática y parches deterministas (2026-11-14)

La auditoría estática detallada de los hallazgos `H-01` a `H-24` sobre la implementación de `src/tools/terminal/` se mantiene en `src/tools/terminal/Revisión de la tool run_command (Jarvis).md` (documento separado del histórico `RC-xx` de arriba). De esos hallazgos, se resolvieron y cubrieron con pruebas unitarias los siguientes puntos deterministas:

| Hallazgo | Estado | Dónde y qué falta |
|---|---|---|
| `H-01` (`tree` y caracteres de caja) | **Resuelto en código y test TS** | `output.ts` (`accentScore`) y `powershell.ts` (`__jvDecode`) suman puntuación por caracteres de dibujo de caja consecutivos (`U+2500–U+257F`), evitando que `tree` en OEM 850 se decodifique como CP1252. Test en `tests/run_command.test.ts` (`OutputDecoder`). Falta probar `__jvDecode` con `powershell.exe` vivo en Windows. |
| `H-02` (`\r\r\n` en `LineAssembler`) | **Resuelto [Test]** | `output.ts` (`LineAssembler.push`) conserva la línea abierta ante secuencias `\r+\n`. |
| `H-05` (`[n/a]` y `(n/a)` en `CHOICE_OR_KEY`) | **Resuelto [Test]** | `prompts.ts` (`CHOICE_OR_KEY`) excluye `[n/a]` y `(n/a)` para que una línea ya terminada no dispare `TERMINATED_PROMPT_IDLE_MS` como `strong`. |
| `H-06` (`stderr` en `systemProcesses`) | **Ya estaba resuelto** | `processTree.ts:66` abre `stdio: ["ignore", "pipe", "ignore"]` para no llenar un pipe sin lector. |
| `H-07` (comentario `legacyChunks`) | **Resuelto** | `output.ts` documenta correctamente que cuenta fragmentos recibidos, no líneas. |
| `H-08` (re-disparo de prompt ya respondido) | **Resuelto en código y test TS** | `output.ts` (`LineAssembler.closeAnswered`) limpia `lastCompleted` para que líneas en blanco posteriores no reevalúen el prompt anterior. Falta validar el proveedor completo en Windows con un proceso vivo. |

Quedan abiertos (para decisión o validación en Windows/modelos): `H-03` (prompts parciales en herramientas envueltas), `H-04` (`...` en REPL frente a `PROGRESS_END`), `H-09`..`H-12` (mensajes/descripciones vistas por modelos), `H-13`..`H-24` (extractor `truncated`, comillas tipográficas en `readOnly`, `-Wai`, `--watch` en `rerun`, etc.).

