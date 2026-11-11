# JARVIS 1.0 – Herramientas propias: diseño y estado

JARVIS 1.0 reemplaza dos herramientas que antes eran envoltorios de servidores MCP (la terminal y la búsqueda en internet) por herramientas propias, en proceso, con un contrato común. Este documento recoge lo decidido, cómo quedó construido y lo que sigue pendiente.

Última actualización: 2026-11-10.

## 1. Premisa del flujo (CORE_FLOW)

- Un **paso** es un bucle de llamadas que termina cuando D4 aprueba una. D4 solo evalúa `ok` y `cumple` contra la instrucción del paso. Una llamada intermedia útil pero que no cumple cuenta como rechazo (`not_accomplished`); dos en una ruta la sacan de D1 dentro del paso.
- **Un paso, una tool:** no hay mini-agente dentro del paso. El encadenado (leer, editar, verificar) ocurre entre pasos. Sin paralelismo: una llamada por vuelta. Cada tool resuelve el objetivo del paso en una sola llamada y devuelve un resultado que D4 puede verificar por sí mismo.
- **Contexto:** cada llamada a modelo recibe lo justo y necesario. `ctx/` es puro y aislado (puede ser un paquete independiente): no conoce herramientas, MCP ni modelos. Una tool recibe un brief (sus argumentos), nunca el contexto de la tarea.
- **Arquitectura:** responsabilidades separadas y dependencias en un solo sentido. El núcleo conoce la interfaz de proveedor y el contrato de resultados, nunca un proveedor concreto; lo ajeno se adapta en el borde, una vez.

## 2. Estado de la implementación

| Pieza | Estado | Dónde |
| --- | --- | --- |
| Contrato de proveedores, resultados y `ToolHost` (D-01, D-07, D-09 a D-11) | Implementado | `src/core/tools/` (`provider.ts`, `result.ts`, `host.ts`, `judge.ts`), `result/extractors/structured.ts` |
| Manifiesto: servidores nativos, marca `internal`, plazo por tool (D-12) | Implementado | `src/core/tools/manifest.ts`, `src/core/types/routes.ts` |
| `run_command` (D-03 a D-05, D-08, D-13, D-18 a D-20, D-30) | Implementado | `src/tools/terminal/`, `tests/run_command.test.ts` |
| `web_search` (D-21 a D-28) | Implementado; el modelo (2B) viene **apagado** | `src/tools/web/`, `src/core/policy/egress.ts`, `tests/web_search.test.ts` |
| Tools de archivos nativas y reagrupación en consultar y modificar (D-15 a D-17) | **Pendiente** | — |
| Salida de escape `wrong_group` (punto 23) | Para más adelante | — |
| Línea base de `web_search` y calibración de umbrales (D-24) | **Pendiente** | — |

## 3. Decisiones

| # | Tema | Decisión | Estado |
| --- | --- | --- | --- |
| D-01 | Cómo se agregan las tools propias | **Proveedores nativos en proceso** que implementan la interfaz que consume `DiscoveryEngine` (`ToolProvider`; `IMCPServer` es un alias). No hay motor nuevo ni servidor MCP propio por stdio: MCP por stdio queda como adaptador de terceros (Desktop Commander, Free Search). Si algún día se exponen por MCP, será un empaquetado fino. | Implementada |
| D-02 | Lecturas dentro de los grupos de modificación | **Un paso por tool:** leer y editar son pasos separados y las lecturas no se agregan al grupo de modificar. La lectura preparatoria dentro del paso pasa a 2.0 (sección 9): hoy una lectura en un paso de edición no puede funcionar sin cambios en el contexto y el motor. | Cerrada |
| D-03 | Interacción con procesos | Si un proceso pide entrada, `run_command` devuelve `waiting_input` con el prompt y **la completa el usuario**. Sin modelo generando la entrada. | Implementada |
| D-04 | Fin por tiempo | Al vencer el plazo el proceso **no se mata**: queda `running` y se continúa con `{ pid }`. Se corta solo si se cancela la tarea o esta falla. | Implementada |
| D-05 | Espera de la salida | Sin sondeo: se espera por eventos (el proceso terminó, hay un prompt, venció el plazo o se canceló). | Implementada |
| D-06 | Refs | Las refs siguen en disco **completas**, incluido el material crudo de internet (`raw`). | Implementada |
| D-07 | Contrato de resultados | Dos niveles: los servidores ajenos siguen con extractores (capa anticorrupción); los nativos devuelven un resultado estructurado y versionado en `structuredContent` y `_meta` con `text` (lo que ve el modelo), `raw` (completo, para la ref), `data` y `meta` (traza, nunca a los modelos). Un único `extractStructured` lo lee. | Implementada |
| D-08 | `run_command` | **Tool 100 % nativa** con `child_process`, sin Desktop Commander. Se probó Desktop Commander (2026-11-10): da el PID y la salida completa, pero no el código de salida en `start_process` (hay que releer y la lectura puede adelantarse al cierre) ni detecta prompts de forma fiable (`Read-Host` no muestra ni el texto). Lo nativo da código real, directorio de trabajo, corte del árbol y tope de memoria, con menos piezas. Desktop Commander se queda para los archivos. | Implementada |
| D-09 | Interfaz de proveedor | `ToolProvider`: `callTool(name, args, { signal, timeoutMs, taskId, host })`, `dependencies` opcionales y el gancho `onTaskEnd(taskId, outcome)`. El plazo por tool lo declara el manifiesto; el de 60 s del transporte queda para los adaptadores MCP. | Implementada (el envío de `notifications/cancelled` a servidores de terceros queda para después) |
| D-10 | `ToolHost` | Una tool compuesta recibe un `ToolHost` que solo deja llamar a lo que declara en `dependencies`; esas tools figuran como `internal` (con política y Guard, sin ofrecerse a D1 ni a D2); el Guard decide sobre la llamada externa y las sub-llamadas lo heredan; cada una queda en la traza. | Implementada |
| D-11 | Esquema del contrato | `schema: 1` en `structuredContent` y `_meta`. El tipo vive en el núcleo. `extractStructured` se elige por la presencia del esquema, también en un error (para dar de baja el `pid` de un proceso que no existe). | Implementada |
| D-12 | Manifiesto | Marca `internal`; cada tool sigue con **una sola ruta**; sin servidor por tool (cada ruta deriva un único servidor). Las varias rutas por tool quedan para 2.0 junto con D-02. | Implementada |
| D-13 | Cierre de procesos | `run_command` lleva el registro de sus PIDs. El motor avisa a los proveedores cómo terminó cada tarea (`DiscoveryEngine.notifyTaskEnd`) y con `failed` o `cancelled` cierran lo que dejó corriendo; `engine/processes.ts` desaparece. | Implementada |
| D-14 | Ubicación | Los proveedores nativos viven en `src/tools/<nombre>/`, fuera de `core/`; el núcleo no los importa y se registran en `server.ts`. | Implementada (`tests/architecture.test.ts` lo fija) |
| D-15 | Grupos de archivos | Sin lecturas en `modificar_archivos`; ninguna tool en dos rutas. Reagrupar las rutas actuales (`files`, `locate`) en consultar y modificar. | **Pendiente** |
| D-16 | Tools nativas de archivos | Solo las que Desktop Commander no tiene: `find_files`, `copy_file`, `delete_file`. | **Pendiente** |
| D-17 | Borrado y edición exacta | `delete_file` envía a la papelera y pide aprobación siempre; borrar una carpeta de forma recursiva exige aprobación `mandatory` también con `autoMode`. La lectura previa a `edit_block` es dirigida (`offset` y `length`). A verificar cómo enviar a la papelera desde Node en Windows. | **Pendiente** |
| D-18 | Prompts y plazo | Prompt = salida inactiva 1,5 s con la última línea sin salto de línea; PowerShell se lanza con `-NonInteractive` para que `Read-Host` falle en el acto. Sin PTY, los REPL quedan fuera de 1.0. Plazo: 30 s por defecto, `timeoutSec` hasta 300. | Implementada |
| D-19 | Pregunta al usuario | La llamada termina con `waiting_input` y el prompt; el paso pregunta con el mecanismo de `ask_user` y la respuesta vuelve en `run_command { pid, input }`. La tool no pregunta por dentro. | Implementada (D-30) |
| D-20 | Formato de salida | `text`: cabecera `status · exit code · duration · pid` y cuerpo con prioridad a la cola, dentro de `BUDGET.summaryMax`; `raw`: completo; `data`: `{ state, pid, exitCode, durationMs, prompt?, rawTruncated }`. | Implementada |
| D-21 | `download` | Fuera de 1.0 (escribe en disco y no encaja en una tool de lectura). `web_search` no lo declara. | Cerrada |
| D-22 | Pipeline de `web_search` | Una sola llamada de modelo, no generativa: el código arma el resultado con fragmentos **literales** y un estado calculado por umbrales. Sin revisor generativo: no hay texto que alucinar ni superficie de inyección sobre texto redactado. La síntesis la hace el LLM final de JARVIS. | Implementada |
| D-23 | Costo del clasificador | BM25 propio antes del 2B: 15 candidatos, máximo 3 por fuente. Sin modelo (o si el 2B falla o no responde en 20 s): orden de BM25 y estado **como mucho `partial`**, con la causa en `meta`: coincidir en palabras no es responder. `terms` cubre pregunta y fuentes en idiomas distintos. | Implementada |
| D-24 | Línea base | Medir primero la parte sin modelo contra unas 25 preguntas (y contra `compare`, `ask` y `research` truncado); sumar el 2B solo si la ganancia lo justifica. Una validación en vivo (2026-11-10, sección 8) ya muestra una ganancia clara del 2B; falta el conjunto formal. | **Pendiente** (hay evidencia a favor de encenderlo) |
| D-25 | Dividir `need` | No en 1.0. Con filtros y sin resultado, un único reintento determinista sin ellos. | Implementada |
| D-26 | Argumentos de `web_search` | `need` (obligatorio), `terms`, `urls` (hasta 5), `freshness`, `domains`. Sin `category`. `max_age_hours` de 24 h. | Implementada |
| D-27 | Nombre y modelos | `web_search`. Puerto `FragmentJudge.score(need, fragmentos)` → probabilidades, que implementa `Decision20Engine.score` (preguntas `noul` en lotes de 5); la traza va en `meta`. Se enciende con `webSearchUseJudge`. | Implementada |
| D-28 | Consulta como canal de salida | La herramienta rechaza lo inválido (esquema, credenciales en la URL, hosts de la PC o redes internas, límites de tamaño); el Guard (`policy/egress.ts`) exige confirmación obligatoria, también con `autoMode`, si hay claves, tokens, contraseñas o rutas del usuario. Que cada URL provenga del usuario o de un resultado previo ya lo hace el pre-chequeo para `url` y `urls`. | Implementada |
| D-29 | Saltear D2 | Con una sola tool en el grupo no se consulta a D2 (ya existía). | Implementada |
| D-30 | `waiting_input` con `ask_user` | Estado de llamada nuevo: ejecutado y no verificable (como `interrupted`). `stepLoop` llama a `askUser` con la pregunta armada por el código a partir del prompt, sin modelo. El hecho `process` se activa también con `waiting_input`. Límite: `maxQuestionsPerStep` es 1, así que un segundo prompt en el mismo paso lo acaba el tope de llamadas. | Implementada |

## 4. Grupos de herramientas

Las rutas del manifiesto son `files`, `locate`, `terminal` y `web` (`ExecutableRoute`). Los nombres de la tabla son el **objetivo** de la reagrupación de archivos (D-15); hoy solo `ejecutar` y `internet` están hechos (rutas `terminal` y `web`).

| Grupo (objetivo) | Criterio (D1) | Tool (D2) | Origen |
| --- | --- | --- | --- |
| `consultar_archivos` | Ver, leer o buscar archivos sin modificar | `list_directory`, `get_file_info`, `read_file`, `read_multiple_files` | Desktop Commander |
| | | `find_files` | Nativa (pendiente) |
| `modificar_archivos` | Crear, modificar, mover, copiar o borrar | `write_file`, `edit_block`, `create_directory`, `move_file` | Desktop Commander |
| | | `copy_file`, `delete_file` | Nativa (pendiente) |
| `ejecutar` (ruta `terminal`) | Comandos y programas | `run_command` | Nativa, `jarvis_terminal` |
| `internet` (ruta `web`) | Información online | `web_search` | Nativa, `jarvis_web`; por dentro usa `research` y `fetch` de Free Search (internas) |

## 5. `run_command`

Lanza un comando de PowerShell y devuelve su resultado, o continúa un proceso que sigue vivo. Solo Windows.

**Argumentos** (exactamente `command` o `pid`): `command` (texto, hasta 1000 caracteres: el mismo tope con el que se registra en el contexto), `pid` (proceso de la misma tarea), `input` (la respuesta a un proceso que esperaba entrada; solo con `pid`, hasta 1000 caracteres), `timeoutSec` (1 a 300, por defecto 30) y `cwd` (carpeta absoluta de un comando nuevo; por defecto, la carpeta personal).

| Estado (`data.state`) | Cuándo | Qué pasa con el proceso |
| --- | --- | --- |
| `finished` | El proceso terminó; `exitCode` es el real | Nada |
| `running` | Venció el plazo y sigue vivo | Sigue; se continúa con `{ pid }` |
| `waiting_input` | La última línea parece un prompt y el proceso se calló lo que pide su clase (`[S/N]` o `Nombre: `: 1,5 s; otro texto sin salto: 5 s; un avance como `45%`: nunca) (`data.prompt`) | Sigue; la respuesta llega por `{ pid, input }` |
| `cancelled` | Se canceló la tarea | Se corta el árbol |

**Cómo corre.** `powershell.exe -NoProfile -NonInteractive -Command <prólogo; ayudas; script en base64>` (`src/tools/terminal/powershell.ts`): el script lleva el comando tal cual, dentro de la función `script`, y una línea final que da el código de salida (0 si el último comando salió bien; si no, el del programa externo que falló, o 1). No se usa `-EncodedCommand` porque con él PowerShell escribe los errores en CLIXML. Las ayudas se leen de un archivo `.ps1` de la carpeta temporal (un bloque grande en base64 en la línea de comandos lo llegó a bloquear el antivirus): `Read-Host` y `pause` respondibles por `waiting_input`, y envoltorios de las herramientas del sistema (`ipconfig`, `ping`, `netsh`…) para que sus tildes no se pierdan cuando PowerShell recoge su salida; si no cargan, se relanza sin ellas. La salida se decodifica en UTF-8 (y, línea por línea, en la página OEM o ANSI lo que no sea UTF-8), sin escapes de terminal ni caracteres de control, con las barras de progreso en su última versión y stdout y stderr unidos por líneas enteras. Cada llamada devuelve **solo la salida nueva**. Lo no leído se guarda con un tope (500 000 caracteres del inicio y del final, con un marcador de lo omitido). Hasta 8 procesos vivos; un proceso terminado cuya salida nadie lee se olvida a los 10 minutos.

**Detalles que importan.**
- **Procesos huérfanos:** lo que deja una tarea completada no lo puede continuar nadie; si se llega al tope de 8 procesos vivos, se cierra el más antiguo de esos (nunca los de una tarea en curso) para hacer lugar.
- **Código de salida:** el real; si alguien cortó el proceso desde fuera, `-1` (no se lee como una salida limpia).
- **Entorno:** el de Jarvis sin las variables que cargó de `.env`; con `PYTHONIOENCODING=utf-8` y `PYTHONUNBUFFERED=1` si el usuario no los definió. La cabecera de un comando nuevo dice la carpeta en la que corrió (`cwd:`).
- **Plazos duros:** 15 s para que arranque PowerShell y 5 s para `taskkill`. Si un programa lanzado se queda con la salida y el comando termina, se avisa (`data.detached`) y no se recoge más.
- **Frases llanas en `text`:** `The command finished successfully.` o `The command failed (exit code N).`, y con `waiting_input` o `running`, cómo continuar (`run_command { "pid": N, "input": <la respuesta> }`). Los modelos chicos (el generador de argumentos y el verificador) no deducían qué hacer a partir del estado solo.
- **Mensajes de error en inglés** (los lee el modelo, como los de las demás tools); la pregunta al usuario por un prompt, en español.
- **Codificación:** PowerShell (salida y entrada) en UTF-8, que es lo que hablan git, node, npm y los cmdlets. Las herramientas del sistema de Windows escriben en la página OEM (850) o ANSI (1252): lo que no es UTF-8 se decodifica línea por línea con la que da letras (resuelto el 2026-11-11, `docs/REVISION_run_command.md` RC-10). Quedan fuera las invocadas con extensión (`ipconfig.exe`) cuando PowerShell recoge su salida y las páginas OEM sin tabla.
- **PowerShell sin interacción:** `-Confirm`, `Get-Credential` y los parámetros obligatorios fallan en el acto y el texto dice cómo seguir (`-Confirm:$false`, `-Force`, pasar el valor); `Read-Host -AsSecureString` se rechaza (no se piden contraseñas por el chat).

**Seguridad.** La tool valida tipos, largos, la carpeta, que el `pid` sea de la misma tarea y la plataforma. El Guard decide sobre la llamada: comandos catastróficos (DENY), rutas sensibles (confirmación obligatoria), y confirmación en toda escritura salvo un comando que `policy/readOnly.ts` demuestra de solo lectura y una continuación sin `input`. El pre-chequeo comprueba el comando como PowerShell. Repetición: un comando nuevo es `strict` (repetir una escritura idéntica pudo duplicar sus efectos) y una continuación por `pid` es `allow` (esperar más salida repite los mismos argumentos; acotan los topes del paso): `repeatByArgs` en el manifiesto.

**Manifiesto.** Ruta `terminal`, servidor `jarvis_terminal`, capacidad `PROCESS_CONTROL`, plazo 315 s. **Fuera de 1.0:** PTY (ConPTY: evaluado el 2026-11-11 y descartado; un REPL que escribe su prompt, como `python -i`, ya se responde, una línea por paso), procesos que sobreviven a la tarea para retomarlos luego.

## 6. `web_search`

Busca en internet (o lee las URL dadas) y devuelve solo los fragmentos que responden, literales y con su fuente.

**Argumentos:** `need` (obligatorio, hasta 300 caracteres), `terms` (hasta 10 palabras clave, en el idioma probable de las fuentes), `urls` (hasta 5, solo http o https, sin credenciales ni hosts de la PC o redes internas), `freshness` (`day`, `week`, `month`, `year`) y `domains` (hasta 5).

**Pipeline.**

1. Material: `research` de Free Search (con `max_age_hours` de 24, y `freshness` y `include_domains` si se pidieron) o, con `urls`, un `fetch` por URL. El informe completo va en `raw`.
2. Limpieza: fuera los enlaces sueltos, la navegación y los banners, las notas al pie y las líneas largas que ya aparecieron en otra fuente.
3. Fragmentos de 500 a 800 caracteres por títulos y párrafos (una tabla o lista se parte entre filas).
4. BM25 contra `need` y `terms`: 15 candidatos, máximo 3 por fuente.
5. Si `webSearchUseJudge` está encendido, el 2B puntúa los candidatos (con un plazo de 20 s). Estado: `found` desde 0,6, `partial` desde 0,3, `not_found` por debajo. Sin modelo (o si falla) se usa la cobertura de palabras de la pregunta: `partial` desde 0,34, `not_found` por debajo, y **nunca `found`** (el texto avisa que los fragmentos coinciden en palabras y hay que comprobar que respondan).
6. Resultado: hasta 4 fragmentos (unos 1700 caracteres) y las fuentes citadas. `no_results` si no hubo material. Con filtros y sin resultado, se repite **una vez** sin ellos (si queda tiempo).

**Fechas y extractos de las fuentes.** El informe de Free Search trae, por fuente, la fecha de publicación y el extracto que mostró el buscador. La lista `Sources:` los muestra (`[n] título — url (published AAAA-MM-DD)`) y cada extracto es un fragmento más (título, extracto y fecha). Suelen contener justo el dato corto que las páginas no repiten (en una prueba real, la fecha de publicación de una versión).

**Resultado.** `text` empieza con `status: <estado> · …`, trae los fragmentos como `[n] texto` y la lista `Sources:`; nunca pasa de `BUDGET.summaryMax`. `data`: `state`, `passages`, `sources`, `candidates`, `judge` (`off`, `used`, `failed`), `retried`. `meta`: tiempos, filtros, probabilidades y entrada y salida del modelo, errores. `not_found` y `no_results` llegan al motor como sin datos (`no_data`) y permiten un reintento con otros argumentos.

**Seguridad.** El Guard pide confirmación obligatoria, aun con `autoMode`, si la consulta lleva claves, tokens, contraseñas o rutas del usuario. Las páginas son datos no confiables: ningún modelo redacta a partir de ellas y lo único que sale de un fragmento hostil es una probabilidad.

**Manifiesto.** Ruta `web`, servidor `jarvis_web`, capacidad `READ`, plazo 150 s. Dependencias: `research` y `fetch` de Free Search, marcadas `internal`.

## 7. Infraestructura

- **Proveedor** (`core/tools/provider.ts`): `ToolProvider` con `callTool(name, args, options?)`, `options = { signal, timeoutMs, taskId, host }`; `onTaskEnd` es el gancho de cierre por tarea; `IMCPServer` es un alias.
- **Resultado** (`core/tools/result.ts`): `toolResult({ text, raw, data, meta, isError })` y `readToolResult`. `extractStructured` traduce `data` a las señales del procesador (código de salida, `pid` y vida del proceso, `waiting_input`, sin datos).
- **`ToolHost`** (`core/tools/host.ts`): `call(ref, args, { signal })`, solo para lo declarado, con cada sub-llamada en la traza.
- **Manifiesto** (`core/tools/manifest.ts`): `internal`, `timeoutMs` y `timeoutOf`; `internalDef` para las herramientas de otro servidor que una tool compuesta usa por dentro.
- **Guard:** `policy/egress.ts` para lo que sale a internet; `policy/readOnly.ts` reconoce `run_command` (cmdlets de consulta y, desde el 2026-11-11, programas con argumentos exactos de lectura: `node --version`, `npm ls`, `ipconfig /all`; no `git status`).
- **Modelos dentro de una tool:** solo el puerto `FragmentJudge` (`core/tools/judge.ts`); no hay métodos generativos.

## 8. Pendientes

**Flujo — salida de escape (`wrong_group`), para más adelante.**
- Ya existe el equivalente barato: D1 se consulta en cada vuelta con los intentos fallidos a la vista, y una ruta deja de ofrecerse tras `maxNotAccomplishedPerRoute` (2) rechazos `not_accomplished` en el paso.
- Una salida previa a la ejecución ya se probó y se quitó: `tool_rejected` en D3 tuvo 25 % de precisión (`eval/CONCLUSIONES_HISTORICAS.md`, 1.2). Un `wrong_group` emitido por un modelo chico tendría la misma debilidad.
- Propuesta: no agregar nada en 1.0; medir en la traza y en el laboratorio los pasos que cambian de ruta y las llamadas gastadas en una ruta equivocada, y reabrir si pasan de una llamada de costo por paso. Si se reabre, la salida debe ser determinista (una señal del resultado de la tool).

**Archivos (D-15 a D-17).** Tools nativas `find_files`, `copy_file` y `delete_file` (a la papelera, con aprobación; recursivo con aprobación obligatoria), lectura dirigida antes de `edit_block` y reagrupación de las rutas `files` y `locate` en consultar y modificar.

**`web_search`.** Armar el conjunto de unas 25 preguntas (actuales, de documentación, de comparación, sin respuesta y páginas con texto de inyección) y medir la parte sin modelo contra `compare`, `ask` y `research` truncado; con eso, calibrar los umbrales (0,6 y 0,3 con modelo; 0,34 sin él) y decidir `webSearchUseJudge`.

Evidencia de la validación en vivo (2026-11-10, Free Search real y `d3:2b` real). Con el 2B, en tres consultas: halla la fecha de Node 22 (p = 0,79), halla "Camberra" en una página dada (p = 0,99) y responde `not_found` cuando la respuesta no está en las fuentes (p máxima 0,04). Sin el 2B, las mismas tres dieron fragmentos ruidosos. El 2B tarda ~3 s la primera vez (carga del modelo) y 0,1 a 0,2 s después. **Recomendación: encender `webSearchUseJudge`.** Ningún modo es infalible: en una tarea real con un `need` mal formulado (una instrucción, no una pregunta), el 2B llegó a dar `found` con un fragmento sobre una fecha de fin de soporte; por eso la nota del argumento `need` pide una pregunta directa.

**Limpieza.** Actualizar los conjuntos de evaluación y los prompts del laboratorio que nombran `start_process`, `research` y `fetch` (`eval/`); regenerar `docs/inputSchemaManifest.md`; `notifications/cancelled` hacia los servidores MCP de terceros.

## 9. Para JARVIS 2.0

| Tema | Detalle |
| --- | --- |
| Lecturas preparatorias dentro del paso | Leer antes de editar en un mismo paso. Exige que el contexto distinga llamadas de apoyo (un veredicto `skipped`: se ejecutan, su resultado es dato visible para los argumentos, no pasan por D4 ni cuentan para `not_accomplished`), un rol `main` o `support` por ruta, varias rutas por tool, el cierre del paso solo con una llamada `main` aprobada y topes propios. Alternativa más simple: prelectura automática antes de generar los argumentos de `edit_block`. |
| REPL interactivos con PTY | `python -i` y similares, que `child_process` sin PTY no maneja bien. |
| Exponer las tools nativas por MCP | Empaquetado en stdio si aparece otro cliente que las quiera. |
| Paralelismo de procesos | Varios procesos corriendo a la vez como parte de un mismo trabajo. |
| Seguir trabajando con procesos corriendo | Dejar un proceso largo en marcha, seguir usando JARVIS, recibir el aviso al terminar y consultar los procesos de otras tareas. Requiere un registro persistente de procesos. |
| Entrada generada por LLM en procesos | Generar la entrada que pide un proceso. Exige pasar por el Guard (es ejecución) y tratar el prompt como dato no confiable. |
| Más de un prompt por paso | Hoy `maxQuestionsPerStep` es 1; un proceso con dos prompts en un mismo paso lo acaba el tope de llamadas. |
