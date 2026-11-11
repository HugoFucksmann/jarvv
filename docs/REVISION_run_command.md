# Revisión de `run_command`: hallazgos, inconsistencias y faltantes

Documento de referencia para un agente que vaya a revisar `run_command` en profundidad. Reúne lo que se encontró al construirla y validarla (2026-11-10), con el contexto necesario para entender cada punto sin haber visto cómo se construyó. No impone soluciones: cada hallazgo dice qué se observó, con qué evidencia y qué conviene investigar.

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

**RC-07 · Riesgo · Media · [Código] — `/api/mcp/<servidor>/call` lanza procesos sin tarea.**
`src/server/mcpRouter.ts` deja pasar lo que el Guard permite sin confirmación. Un `run_command` de solo lectura (`Get-Process`) se ejecuta ahí sin `taskId`: nadie lo cierra al terminar una tarea; solo se olvida a los 10 minutos si ya terminó, o `close()` al apagar Jarvis. Un `{ pid }` sin tarea solo ve procesos sin tarea. No se probó por HTTP.
*Investigar:* si `run_command` debe estar disponible por ese endpoint.

**RC-08 · Riesgo · Baja · [Código] — Cierre con un hijo que hereda las tuberías.**
Tras el evento `exit` se espera 300 ms a `close`; si un proceso hijo conserva stdout/stderr, `close` no llega y se da el proceso por terminado: lo que el hijo escriba después se pierde. No se probó.

**RC-09 · Riesgo · Baja · [Código] — Sin vigilante de plazo duro.**
`timeoutMs` (315 s en el manifiesto) acota la espera de la herramienta, pero no hay un temporizador que aborte la llamada entera: `spawnProcess` espera el evento `spawn` sin plazo y `killTree` espera a `taskkill` sin plazo. La cancelación de la tarea sí actúa (el motor abandona la llamada).

### Salida y codificación

**RC-10 · Limitación · Media · [Vivo] — Las herramientas del sistema de Windows salen con las tildes rotas.**
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
