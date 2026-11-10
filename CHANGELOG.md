# Changelog

Todos los cambios relevantes de JARVIS. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/). Mientras la versión sea `0.x`, la API y la configuración pueden cambiar entre versiones.

## [Sin publicar]

### Cambios
- `contracts.ts` (interfaces) separado de `engine/services.ts` (composición); `reasoner/`, `decision.ts` y `llmTransport.ts` pasan a `models/`.
- La configuración se inyecta (`ConfigSource`) en modelos, servidores MCP, trazas y `TaskManager`; el núcleo ya no lee `ConfigManager` por su cuenta.
- `POST /config` ignora `command`, `args`, `env` y `cwd` de los servidores MCP: solo se editan en `jarvis-config.json` (en la interfaz son de solo lectura).
- Nuevo tope `maxUserRejectionsPerStep` (2): el segundo rechazo del usuario falla el paso en vez de pedirle confirmación otra vez. Se expone en `GET /limits`.
- Un comando de terminal que solo consulta (`Get-ChildItem`, `Get-Process | Sort-Object …`) se trata como lectura: sin confirmación, su salida va a DATA y no pasa por D3. Criterio cerrado y conservador en `policy/readOnly.ts`; lo que no reconoce sigue pidiendo confirmación.
- Retención por antigüedad de `data/refs` y de las trazas (`retentionDays`, 30 por defecto; `0` la desactiva).
- **Seguridad:** rutas sensibles (`policy/sensitivePaths.ts`) con confirmación obligatoria también con `autoMode` (claves y credenciales, datos de navegadores, variables de entorno con secretos y, al escribir, inicio automático, perfiles de shell, sistema y `jarvis-config.json`); `/approve`, `/deny` y las decisiones de plan exigen `taskId` y `waitId`; `POST /config` ya no cambia `refsDir` ni `tracePath`; el control de `Host` y `Origin` pasa a `src/server/localOnly.ts` con tests.
- **Fugas:** la retención solo borra carpetas con nombre de Jarvis y limpia `index.jsonl`; el recorder libera lo crudo al escribir la traza; tope a la línea de salida de un servidor MCP y desconexión del cliente SSE que no lee; los procesos en segundo plano se cierran al terminar una tarea que no se completó.
- La traza de cada tarea se escribe en segundo plano (captura al instante, escritura y compresión asíncronas sin bloquear el servidor) y el cierre del servidor espera un momento (`TaskManager.drain`) a que las tareas cancelen sus procesos y escriban su traza antes de apagar los servidores MCP.
- Topes en un solo lugar (`engine/limits.ts`): un único punto de control por paso, contadores derivados del contexto y `GET /limits` generado de la misma tabla. `maxCallsPerStep` pasa a contar **ejecuciones** (llamadas que llegaron a la herramienta) y aparece `maxAttemptsPerStep` (10) como techo de intentos; las repeticiones bloqueadas y los argumentos inválidos ya no gastan ejecuciones. `maxNotAccomplishedPerRoute` sale de `callRunner` a `BUDGET`.
- Política de repetición por herramienta (`repeat`: `strict`, `retry_failed`, `allow`, en lugar de `loopExempt`): un rechazo de la verificación vale para su criterio y no para toda la tarea, un fallo pasajero de una lectura permite un reintento idéntico por paso, y lo aprobado sigue bloqueado en toda la tarea.
- Los servidores MCP se arrancan en paralelo al encender Jarvis (antes, al primer uso: la primera carga de la interfaz o la primera tarea esperaba ~3 s) y las rutas de una tarea consultan su catálogo en paralelo. Desktop Commander se lanza con `--prefer-offline` (unos 0,4 s menos).
- Free Search actualizado a `0.18.0` (mismos nombres y parámetros de herramientas y mismo formato de salida que `0.13.1`; arranca más rápido). Se lanza con `SEARCH_MCP_AGENT_ENGINES=off`: sin él, una sesión de Codex firmada en la PC mandaría las búsquedas también a ChatGPT y gastaría su cuota.
- Desktop Commander pasa a ser una dependencia del proyecto (`package.json`, versión exacta `0.3.2`; se agrega `package-lock.json`) y se lanza con `node` directo en vez de `npx`: listo en ~0,7 s contra ~2,7 s, sin consultar el registro ni depender de la red. Se instaló con `--ignore-scripts` (su `postinstall` manda una estadística de instalación; el binario de `rg` viene en un paquete por plataforma y no lo necesita). Si falta el archivo (falta `npm install`), Jarvis lo avisa al arrancar. Requiere Node 22.12 o superior.
- Free Search: sus dependencias transitivas quedan fijadas (`mcp/free-search/constraints.txt`, generado con `uv pip compile` desde `requirements.in`) y se pasan con `--constraints`; mismo tiempo de arranque.
- Rutas sensibles: se agregan los historiales de shell, los tokens de `gh`, `terraform`, `vault` y `.htpasswd`; `.env.example`, `.env.sample`, `.env.template` y `.env.dist` ya no piden confirmación.
- **Seguridad:** los servidores MCP se lanzan sin shell (solo un `.cmd`/`.bat` como `npx` lo usa, en Windows): con `node` o `uvx` los argumentos ya no pasan por ningún shell. Tope de 4 tareas en curso (`POST /process` responde `429`) y de 8 conexiones SSE (`GET /events` responde `429`). Test que fija que una herramienta fuera del catálogo, o una del catálogo que modifica, pide aprobación.
- Tests del transporte MCP (servidor de mentira por stdio) y del SSE (entrega y baja del suscriptor).
- Pruebas del núcleo (`npm test`) y menos repetición en `render/` y en el ejecutor de llamadas, sin cambios en el texto de los prompts.

## [0.6.0] — 2026-11-09

Primera publicación. El flujo completo funciona de punta a punta y el laboratorio de evaluación está incluido, con limitaciones conocidas (ver [`docs/PENDIENTES_FUERA_DE_FLUJO.md`](docs/PENDIENTES_FUERA_DE_FLUJO.md)).

### Núcleo
- Flujo por tarea en dos modos, `reactive` y `deliberative`: lista de pendientes, ruta (Decisión 1), herramienta (Decisión 2), argumentos, resolución de referencias, anti-bucle, Guard, lista negra, pre-chequeo determinista, confirmación del usuario, revisión de argumentos (Decisión 3), despacho y verificación del resultado (Decisión 4).
- Dos modelos locales con Ollama: uno de decisión (`d3:2b`) y uno generativo (`qwen3.5:4b`), con contextos acotados de 16 384 tokens.
- Catálogo cerrado de 13 herramientas en cuatro destinos (`files`, `locate`, `terminal`, `web`) sobre servidores MCP (Desktop Commander y Free Search).
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

[0.6.0]: https://github.com/HugoFucksmann/jarvv/releases/tag/v0.6.0
