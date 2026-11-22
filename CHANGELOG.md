# Changelog

Todos los cambios relevantes de JARVIS. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Pulido del backend (sin cambio de comportamiento salvo lo indicado en «Corregido»)
- **Herramientas:** `.editorconfig`, `.gitattributes` (texto en LF) y Biome como linter (`npm run lint` = `tsc` + Biome; errores en 0, avisos de estilo como pendiente). `engines` de Node y `clean` multiplataforma.
- **Recorrido de carpetas compartido** (`core/tools/walkFolder.ts`): `find_files` y `search_content` dejan de duplicar el recorrido (plazo, tope de entradas, profundidad, enlaces que salen de la raíz, carpetas excluidas, cancelación). Ahora una carpeta enlazada desde dentro de la raíz se visita una sola vez también en `find_files`.
- **Funciones largas partidas por responsabilidad:** `parseSnapshot`, `runDownloadFile`, `moveSingleItem`, `runListFolder`, `runConvertFile`, `runArchiveFiles`, `runSearchContent`, `runSystemInfo` (una función por sección), `createJarvisRouter` (rutas por recurso), `main` de `server.tsx` y `startTelegram` (ahora `TelegramBridge`, una clase de métodos cortos; los prompts de espera, los interruptores y el mensaje de progreso pasan a módulos propios). `tests/telegram_bot.test.ts` prueba el puente de punta a punta sin red.
- **Duplicados:** `fitLines` de `list_folder`, el cálculo de plazo de `find_files`/`list_folder`, la sonda de binarios (3 copias), la serialización JSON canónica (`canonicalJson`) y el mapeo `denied`/`not_found` de 7 herramientas (`pathFailureData`) quedan en una sola definición. La verificación que el código ya responde (`knownVerifyAnswers`) la comparten el motor y el laboratorio de eval.
- **Código muerto:** `needsParentFolder`, `"refs"` en `ReviewView`, el ternario idéntico de `play_media` y `SystemInfoDeps.defaultTimeoutMs`.
- **Logs:** se quitan los que repetían la traza (envío y recepción de cada consulta y de cada llamada, tiempos por etapa). Quedan los de arranque, cierre, procesos de terminal, retención y los avisos de fallo.

### Arquitectura
- **Pruebas de aislamiento** (`tests/architecture.test.ts`): `core/ctx` no depende de nada fuera de sí; el motor no importa `core/models`; la traza y el cliente MCP no dependen del motor ni de los modelos; Telegram y la voz no importan el motor.
- **Acoplamientos cortados:** `RequestAbortedError` pasa a `core/utils.ts`; los errores de modelo, a `core/types/modelErrors.ts` (`models/transport.ts` los re-exporta); y lo que espera una tarea (`Waiting`, `ModelPause` y sus solicitudes), a `core/types/waiting.ts`.

### Corregido
- **`verify`:** una `web_search` con estado `found` ya no pasa por Decisión 4 (el juez del buscador ya respondió la consulta); antes un `cumple` bajo del 2B la rechazaba.
- **Argumentos:** una URL que no sale del pedido ni de resultados previos se rechaza diciendo cuáles se conocen. Tras `review_rejected`, repetir el ítem se acepta una vez (solo en el primer fallo del ítem).
- **Alias de carpetas con subruta** (`desktop\Archivos\Docs`): se expanden a la ruta real al preparar la llamada (antes el Guard los resolvía contra el proyecto y los negaba).
- **`write_file`:** un formato sin driver (`.xlsx`, `.docx`…) falla antes de crear carpetas y con un mensaje que no manda a «instalar» nada; `append` rechaza reenviar el documento entero. `system_info`: `npm` y `code` se detectan en Windows.
- **Auditoría de `src/` (`docs/auditorias/auditoria-src-2026-11-22.md`):** CRIT-01 (contrato de las reglas del pre-chequeo), CRIT-02 (el enlace nuevo de un `move_file` entre volúmenes reemplaza al destino con `rename`: si falla, el destino queda), CRIT-03 (el relanzamiento de la terminal sin ayudas ya no puede repetirse sin fin), IMP-03 (`shown` con `total: 0` en `system_info`), IMP-04 (`stderr` de `ffmpeg` se lee y explica el fallo), IMP-06 (`write_file` no deja carpetas de una llamada fallida), CRIT-04 (una escritura nativa que declara `reason: "not_found"` es `not_found`: lleva la nota de escritura, se rechaza sin consultar al modelo, cuenta como error de la herramienta en los topes y ya no figura como «posible cambio»; las lecturas siguen como `tool_error`), IMP-01 (la retención ya no reproduce cada log completo para saber si la tarea terminó), IMP-02 (la lectura del portapapeles tiene tope), IMP-05 (el respaldo de wifi no repite el plazo), IMP-07 (`close()` del transporte MCP espera la salida del hijo y atiende los errores de `taskkill` y de `spawn`), IMP-09 (el espacio entre frases cuenta en `speechExcerpt`), IMP-10 (`prune` cubre todo el excedente de tareas, sin PowerShell fuera de Windows, `move_file` usa los topes de `copy_file`) y MIN-03 (índice del catálogo, NUL en `mdToHtml`, cierre idempotente de SSE, sufijos temporales únicos). El estado del resto está en `docs/pendientes/PLAN_PULIDO_CODIGO.md`.

### Documentación
- `docs/arquitectura`, `docs/api`, `docs/configuracion`, `docs/operacion/TELEGRAM_Y_VOZ.md`, `docs/pendientes/PENDIENTES_CODIGO.md` y el `readme`: describen el guard de `Host` restaurado (`HOST` por defecto `127.0.0.1`, `ALLOW_PROXY_HOST=1`), el recorrido compartido, los módulos nuevos de Telegram y los tipos de `core/types/`.

### Seguridad
- **API local:** vuelve el chequeo de `Host` y la validación de loopback al arrancar (`HOST` por defecto `127.0.0.1`). Para un sandbox con proxy: `ALLOW_PROXY_HOST=1`.

### Agregado
- **Grupos nativos de archivos y multimedia:** las rutas de D1 pasan a `files_read`, `files_write`, `terminal`, `multimedia` y `web`. Se cablean `find_files`, `list_folder`, `search_content`, `read_file`, `write_file`, `edit_file`, `convert_file`, `create_folder`, `copy_file`, `move_file`, `delete_file`, `archive_files`, `play_media` y `media_control`, con regla de nivel, poscondición y destino por herramienta. El motor ahora revisa las rutas dentro de lotes (`items`, `sources`) en Guard, aprobaciones, pre-chequeo y `allowedDirectories`.

### Agregado (grupo `system` y descargas)
- **`system`:** `system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen` y `clipboard` (`jarvis_system`). `list_processes` pasa a ser la sección `processes` de `system_info`; la `stop_process` del terminal se reemplaza por la de `system`. El grupo `terminal` queda solo con `run_command`, y `TerminalProvider` ya no implementa `list_processes` ni `stop_process` (se retiró también el código que solo ellas usaban: la tabla de procesos del sistema, la lista de procesos protegidos y la lápida «stopped»).
- **`web`:** `download_file` (`jarvis_web`), con regla de nivel, poscondición y destino. Guard ahora escanea las rutas de una descarga (antes no escaneaba nada de `jarvis_web`).
- Se retira el proveedor `jarvis_files`: `find_files` y `list_folder` viven en `jarvis_files_read` y `system_info` en `jarvis_system`.

### Seguridad (tools nativas)
- **`policy/toolRules.ts`:** las tools nativas que modifican tienen la misma clasificación que su comando equivalente: apagar y reiniciar (blocked), borrar raíces de disco o de Windows (guard) y carpetas del sistema o personales enteras (blocked), y descargar o escribir scripts y ejecutables (sensitive). Se integra en Guard y en la lista de reglas integradas.
- **Egress:** `play_media` y `open_on_screen` también pasan por la revisión de datos sensibles hacia internet.

### Eliminado
- **Servidor MCP de archivos y búsqueda local:** se quitan el servidor, su dependencia y su configuración. La ruta `locate` y las herramientas `start_search` y `get_more_search_results` desaparecen; `workDir` y `allowedDirectories` pasan a ser claves de primer nivel de `jarvis-config.json`. Hasta que lleguen las herramientas nativas de archivos, la ruta `files` no ofrece herramientas.

### Seguridad
- **Aprobación por niveles con `autoMode`:** `approvalTiers` queda encendida por defecto. Con `autoMode`, verde no pide al usuario ni pasa por D3; amarillo no pide al usuario y pasa por D3 estricto; rojo siempre pide al usuario. Guard, la lista negra y el pre-chequeo siguen igual. Toggle en Ajustes.
- **`allowedDirectories` en todas las herramientas:** aplica también a `run_command` (`cwd` y rutas del análisis de PowerShell), se lee en vivo y usa `realpathSync`; lo no resoluble pide confirmación. Control en Ajustes.
- **API local:** validación de `HOST` loopback en el arranque *(luego comentada temporalmente en `server.tsx` por compatibilidad con el sandbox de AI Studio Build)*; `/refresh-discovery` pasa a solo `POST`; nuevo tope de tamaño en disco `retentionMaxMb` (250 MB) para refs, trazas y logs.
- **Políticas:** `egress.ts` ya no trata un SHA hex como clave; `sensitivePaths.ts` resuelve symlinks, nombres 8.3 y prefijos `\\?\`/UNC; `commandRules.ts` detecta llamadas `.Delete()`/`.MoveTo()`/`.CopyTo()`.
- **MCP:** al abortar o vencer una llamada por stdio se envía `notifications/cancelled`.

### Aprobaciones
- **Aprobar una vez / siempre en esta tarea** (UI y Telegram): «siempre» vive solo en la tarea (RAM), por herramienta + comando o ruta normalizada; lo obligatorio de Guard, la lista negra y lo no resoluble solo admiten «una vez». Tras un rechazo del usuario no se repite la misma pregunta en la tarea. Aviso de niveles en Telegram.

### Experimental (apagado por defecto)
- `reviewFullView`, `reviewReads` (D3) y `completionCoverageGuard` (D5): ver `docs/pendientes/PENDIENTES_EVAL.md`.

### Terminal
- Tablas de página de códigos 852 y 857; el conteo de letras acentuadas incluye Latin Extended-A.

### Cambios
- `list_directory` rechaza `depth` menor que 1 en el pre-chequeo; `validateAnswer` es exhaustivo y `DecisionValidationError` adjunta la salida cruda.

## [0.7.0] — 2026-11-15

### Destacado
- **Optimización de modelos para 8 GB VRAM:** Segmentación de los modelos (`qwen3.5:4b` y `d3:2b`) eliminando el proyector de visión innecesario (`-text`). Esto ahorra ~1.7 GB de VRAM, permitiendo que ambos modelos convivan residentes en GPUs de 8 GB sin swapping a CPU/disco ni pérdida de calidad o precisión. El tiempo por tarea simulada bajó de 4.6 s a 1.0 s.
- **Tools nativas:**
  - `run_command` (terminal): ejecución directa sobre PowerShell, captura limpia en UTF-8 (sin caracteres corruptos por OEM/ANSI), detección inteligente de prompts interactivos (`Read-Host`, confirmaciones) y control seguro de procesos en segundo plano.
  - `web_search` (buscador web): búsquedas en internet en tiempo real y lectura de páginas (respaldada por Free Search y BM25) con puntuación de relevancia opcional mediante el modelo de decisión.
- **Features de interacción:**
  - **Telegram:** Bot integrado para monitorear el progreso de las tareas, interactuar con botones de aprobación y recibir resultados directamente en el chat.
  - **Voz:** Integración de síntesis de voz (TTS local) para lectura en voz alta en la interfaz web y notas de voz automáticas en Telegram.

### Mejoras del núcleo y confiabilidad
- **Verificación determinista:** Verificación directa por código en operaciones de disco para evitar escrituras en rutas o carpetas inexistentes.
- **Sondas por herramienta (en pruebas):** Verificación experimental declarada junto a cada herramienta para validar ubicación, alcance y atributos de lo ejecutado antes de dar por buena una acción.
- **Flujo D0 y memoria:** Detección rápida de charlas o preguntas directas sin abrir pasos innecesarios y soporte de memoria persistente de hechos del usuario.
- **Keep-alive y precalentamiento:** Parámetro `modelKeepAlive` y precalentamiento de modelos al arrancar el servidor para eliminar demoras de carga en frío.

---

## [0.6.0] — 2026-11-09

Primera publicación. El flujo completo funciona de punta a punta y el laboratorio de evaluación está incluido, con limitaciones conocidas (ver [`docs/pendientes/PENDIENTES_EVAL.md`](docs/pendientes/PENDIENTES_EVAL.md) y [`docs/pendientes/PENDIENTES_CODIGO.md`](docs/pendientes/PENDIENTES_CODIGO.md)).

### Núcleo
- Flujo por tarea en dos modos, `reactive` y `deliberative`: lista de pendientes, ruta (Decisión 1), herramienta (Decisión 2), argumentos, resolución de referencias, anti-bucle, Guard, lista negra, pre-chequeo determinista, confirmación del usuario, revisión de argumentos (Decisión 3), despacho y verificación del resultado (Decisión 4).
- Dos modelos locales con Ollama: uno de decisión (`d3:2b`) y uno generativo (`qwen3.5:4b`), con contextos acotados de 16 384 tokens.
- Catálogo cerrado de 13 herramientas en cuatro destinos (`files`, `locate`, `terminal`, `web`) sobre servidores MCP.
- Contexto único por tarea con vistas por consumidor, resultados voluminosos fuera del contexto (refs) y traza por tarea terminada.
- Servidor local (`127.0.0.1`, validación de `Host` y `Origin`), API HTTP, eventos en vivo (SSE) e interfaz React.

### Seguridad
- **Guard** deniega siempre lo catastrófico y pide aprobación en cada operación sensible.
- **Reglas de comando integradas** (`policy/commandRules.ts`) para Windows y Linux, en tres niveles (`guard`, `blocked`, `sensitive`): borrados (incluidas las carpetas personales), apagado, discos, usuarios, registro, procesos y servicios, git, paquetes, escritura de archivos, Defender y firewall, descargas a disco, lanzadores indirectos, tareas programadas, ejecución remota, elevación, borrado de registros, WMI y llamadas .NET a archivos.
- **`blacklist`** editable en la configuración, que se suma a esas reglas.
- **`autoMode`** apagado por defecto: con él, `blocked` se rechaza y `sensitive` pasa por la revisión de argumentos con umbral estricto.

### Confiabilidad del flujo
- Pre-chequeo con el parser de PowerShell, que también analiza el interior de `powershell -Command "…"` y lo rechaza por innecesario.
- Temperatura creciente al reintentar los argumentos (0,1, 0,3 y 0,5).
- Una ruta deja de ofrecerse en un paso tras dos rechazos de la verificación por «no cumple lo pedido».
- Contexto de los argumentos compactado: efectos y fallos repetidos en una línea, solo los últimos intentos con resultado completo y salidas multilínea sin aplastar.
- Prompts promovidos desde el eval: argumentos (`args_ps_perfect`), revisión, pregunta, lista de pendientes y respuesta final.

### Evaluación (`eval/`)
- Laboratorio que arma los prompts con el mismo código de producción y evalúa las nueve etapas del flujo (cuatro de decisión y cinco generativas).
- Compara variantes de prompt contra `prod` caso por caso (regresiones, mejoras, prueba de signos) y valida los comandos de PowerShell generados con el pre-chequeo de producción.
- Clientes `real`, `mock` y `oracle`; `--dry-run`; resultados trazables; asistente interactivo (`--menu`).
- Datasets y variantes por etapa, con las conclusiones en [`eval/MEJORES_VARIANTES.md`](eval/MEJORES_VARIANTES.md) y en cada carpeta de `eval/variants/`.

### Limitaciones conocidas
- Tareas largas con muchos reintentos: el contexto crece y el modelo chico pierde precisión.
- Umbrales de la revisión y la verificación (0,6) sin calibrar con uso real.
- El eval no es autónomo (datasets y variantes se cargan a mano) y todavía no evalúa tareas completas.
- Pensado y probado en Windows con PowerShell.
- `POST /config` puede cambiar el comando de los servidores MCP: no exponer el servidor fuera de `localhost`.

## Historia previa (sin versiones publicadas)

Etapas del desarrollo antes de esta publicación, reconstruidas del historial de git (160 commits).

- **Octubre 2026 (7–13): base.** Migración del runtime MCP a un backend Node.js, separación del núcleo y del front, modularización, centralización de prompts, registro de herramientas y manifiesto, memoria progresiva y flujo de plan.
- **Octubre 2026 (14–21): estabilización y primer laboratorio.** Descubrimiento de MCP, contexto del modelo, fases de refactor del backend y primer laboratorio de evaluación de las ocho etapas; interfaz movida a `ui/`.
- **Octubre 2026 (22–31): auditoría y nuevo contexto.** Auditoría de memoria y trazas, evaluación del modelo generativo, configuración de modelos y planes del nuevo contexto.
- **Noviembre 2026 (1–7): rediseño del núcleo y eval actual.** Contexto único por tarea con vistas, motor de ejecución, Guard, lista negra y pre-chequeo; eval con escenarios, graders y comparación de variantes.
- **Noviembre 2026 (8–9): variantes y promoción.** Simplificación del eval, datasets y variantes por etapa, y promoción a producción de los prompts ganadores.

[0.7.0]: https://github.com/HugoFucksmann/jarvv/releases/tag/v0.7.0
[0.6.0]: https://github.com/HugoFucksmann/jarvv/releases/tag/v0.6.0
