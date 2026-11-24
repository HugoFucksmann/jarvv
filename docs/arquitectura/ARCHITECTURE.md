# Arquitectura del Sistema

## 1. Propósito
El backend es un sistema determinista de asistencia y automatización local. Orquesta la ejecución supervisada de herramientas sobre el entorno operativo y la web, y separa de forma estricta cuatro responsabilidades: **decidir** (modelo de decisión), **generar** (modelo generativo), **registrar** (contexto de la tarea) y **ejecutar con seguridad** (motor, Guard y servidores MCP).

## 2. Principios Invariantes
1. **Una sola fuente de verdad por tarea**: todo el estado de una tarea vive en un único contexto (`TaskContext`) y se modifica solo a través de `apply`, su única puerta de escritura. Cada lote de operaciones es atómico: o se aplica completo o el contexto queda intacto.
2. **El contexto no conoce a nadie**: no importa herramientas, modelos ni la traza. Quien lo usa le pasa los datos ya resueltos y los topes numéricos.
3. **Desacoplamiento estricto de modelos**: el modelo de decisión elige rutas y herramientas, revisa argumentos y verifica resultados; el modelo generativo planifica, genera argumentos, formula preguntas y redacta la respuesta final. Ningún modelo toca el sistema operativo ni escribe en el contexto: lo hace el motor, validando.
4. **Seguridad con cierre por defecto**: toda acción pasa por Guard antes de despacharse. Una herramienta ausente del catálogo no se ofrece a ningún modelo, y si llegara a Guard se trata como sensible.
5. **Salidas voluminosas fuera del contexto**: los resultados extensos se guardan en disco bajo referencias (`rN`). El contexto de los modelos conserva solo un resumen acotado; el texto completo queda en disco para depurar y para el pre-chequeo, y los modelos no ven la ref ni su ruta.
6. **Estado volátil, auditoría de solo adición**: las tareas viven en memoria con un cupo retenido. Lo único que se escribe en disco es la configuración, los resultados crudos de las refs y una traza de solo adición que el backend no usa para decidir nada (solo la sirve de vuelta por `GET /tasks/:taskId/trace`; ver [`CONTEXT_AND_MEMORY.md`](CONTEXT_AND_MEMORY.md)).
7. **Lo accesorio se puede borrar**: la traza vive fuera del motor, que solo conoce de ella el receptor (`trace/sink.ts`: tipos y receptor vacío). El registrador y el formato (`recorder.ts`, `format.ts`) los usa solo la fachada de tareas, así que se pueden quitar sin tocar el motor.

## 3. Componentes

| Componente | Responsabilidad | Qué NO hace | Implementación (en `src/core/`, salvo el host) |
|---|---|---|---|
| **Host del servidor** | Raíz de composición: construye los motores concretos, monta el middleware `localOnly` (valida `Host` y `Origin`; solo se escucha en loopback por defecto, `HOST=127.0.0.1`; `ALLOW_PROXY_HOST=1` apaga solo el chequeo de `Host` y la validación de loopback del arranque (para un sandbox con proxy, como AI Studio Build)), expone la API HTTP y el flujo SSE, y cierra los servidores MCP y sus procesos hijos al apagar. `server.tsx` se compone de funciones por tarea: `buildServers`, `installGracefulShutdown`, `mountFrontend` y `main`. | No decide el flujo de las tareas ni conoce su estado interno. | `server.tsx`, `src/server/jarvisRouter.ts` (rutas agrupadas por recurso: órdenes de tarea, lecturas, eventos SSE, voz, catálogo y configuración), `src/server/mcpRouter.ts` |
| **Vías de entrada y salida** | Telegram (segunda vía de entrada de tareas: progreso, planes, aprobaciones y preguntas en el chat, respuesta en texto y nota de voz) y voz (TTS local: `POST /api/jarvis/tts`, lectura en la interfaz y notas de voz). | No deciden el flujo ni tocan el motor: usan la API HTTP como cualquier cliente y solo importan tipos del núcleo. Un chat distinto del autorizado se ignora. | `src/telegram/`, `src/voice/`, `scripts/phonon_server.py` (detalle en [`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md)) |
| **Fachada de tareas** | Única puerta entre el exterior y el motor: crea el contexto de cada tarea, lanza su ejecución en segundo plano, resuelve las respuestas del usuario (plan, aprobación, pregunta), cancela, retiene un cupo de tareas (más la última completada en RAM 10 min para hilos) y emite los eventos. | No decide el flujo ni ejecuta herramientas. | `tasks.ts` |
| **Contexto de tarea** | Guarda el estado completo de una tarea (plan, pasos, llamadas, errores, hechos, refs, respuesta), valida cada escritura, calcula las derivaciones (efectos, anti-bucle, contadores) y construye las vistas por consumidor. | No renderiza texto de prompts, no conoce herramientas ni modelos y no persiste. | `ctx/` (`context.ts`, `apply.ts`, `derive.ts`, `closure.ts`, `snapshot.ts`, `views/`) |
| **Motor de ejecución** | Recorre la tarea de principio a fin: clasificación inicial (D0) y continuación de hilo, bucle de pasos, pre-chequeo, poscondiciones en disco y sondas de verificación, recuperación según el modo (escalación o replan), esperas del usuario y cierre (incluido D5). | No genera texto con modelos por su cuenta ni evalúa políticas de seguridad. | `engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `callPrepare.ts`, `callDiscovery.ts`, `callAuthorize.ts`, `callConfirm.ts`, `callExecute.ts`, `callRecord.ts`, `adapters.ts`, `args.ts`, `capture.ts`, `env.ts`, `failures.ts`, `state.ts`, `runtime.ts`, `services.ts`, `reactiveList.ts`, `recalled.ts`, `outcomes.ts`, `classify.ts`, `firstQuery.ts`, `thread.ts`, `completion.ts`, `postcondition.ts`, `probes.ts`, `precheck.ts`, `verify.ts`, `ask.ts`, `finalize.ts`, `finalClean.ts`, `limits.ts`, `retries.ts`, `planner.ts`, `pending.ts`, `pendingList.ts`) |
| **Recuperación en modo sombra** | Tras cada paso fallido del reactivo calcula qué haría `recovery` (reglas de `recoveryRules.ts` y, si no deciden, una consulta de Decisión) y lo registra en la traza (etapa `recovery`). Encendido por defecto (`recoveryShadow`) para medir con tareas reales. | **No actúa**: no cambia la lista, los contadores, el contexto ni el cierre. Agrega una consulta a Decisión por fallo cuando las reglas no deciden. | `engine/recoveryShadow.ts`, `engine/recoveryRules.ts` |
| **Modelo de decisión** | Consultas `choice` y `noul`: continuación de hilo, D0 (`first_query`), ruta (D1), herramienta (D2), revisión de argumentos (D3), verificación del resultado y sondas (D4), cierre (D5) y juez de `web_search`. | No genera texto libre, planes ni argumentos. | `models/decision.ts` |
| **Modelo generativo** | Plan y replan, lista de pendientes (reactivo), argumentos conforme al esquema de la herramienta, pregunta al usuario y respuesta final. | No despacha comandos ni accede al entorno local. | `models/qwen.ts`, `models/prompts.ts` |
| **Renderizadores** | Convierten las vistas estructuradas del contexto en el texto de los prompts, saneando todo texto externo. | No leen el contexto directamente ni aplican topes de negocio. | `render/` |
| **Compuerta de seguridad (Guard)** | Evalúa los argumentos resueltos: deniega patrones destructivos y escrituras sobre las carpetas protegidas, y exige aprobación humana en operaciones sensibles (`readOnly.ts` exime comandos de solo lectura; `sensitivePaths.ts` y `egress.ts` exigen aprobación obligatoria incluso con `autoMode`; `allowedDirs.ts` restringe rutas a `allowedDirectories`). `tiers.ts` clasifica siempre las escrituras en verde/amarillo/rojo y `autoMode` decide quién se encarga del amarillo. | No modifica argumentos ni negocia alternativas con los modelos. | `policy/guard.ts`, `policy/tiers.ts`, `policy/egress.ts`, `policy/allowedDirs.ts` |
| **Lista negra y reglas de comando** | Reglas deterministas sobre herramientas que modifican el sistema, en dos niveles (`blocked`, `sensitive`): reglas integradas (`commandRules.ts`: Windows y Linux, comando y ruta juntos, siempre activas) y entradas de `blacklist` en `jarvis-config.json`. Las lecturas pasan siempre. | No cierra la tarea (eso es de Guard con el nivel `guard`) ni consulta modelos. | `policy/blacklist.ts`, `policy/commandRules.ts` |
| **Catálogo de herramientas** | Lista cerrada de herramientas autorizadas, con su destino, capacidad, política (aprobación, anti-bucle / `rerun.ts`) y sondas (`tools/probes.ts`). Única fuente de políticas (ver [`TOOLS.md`](TOOLS.md)). | No ejecuta llamadas ni guarda estado dinámico. | `tools/manifest.ts`, `tools/probes.ts`, `policy/rerun.ts` |
| **Procesador de resultados** | Convierte el resultado crudo de una herramienta en un estado (`ok`, `no_data`, `not_found`, `tool_error`, `denied`, `waiting_input`), un resumen acotado y el texto completo para la ref; incluye extractores por herramienta. | No guarda nada, no conoce tareas ni refs y no sanea. | `result/processResult.ts`, `result/extractors/` |
| **Almacén de refs** | Guarda el resultado crudo en disco, solo para depuración y para el pre-chequeo (que lo lee como fuente). No se sustituye en los argumentos ni se muestra a los modelos. | No conoce el contexto. | `refs/refVault.ts` |
| **Servidores MCP y proveedores nativos** | Transporte stdio JSON-RPC por servidor (`mcp/`), descubrimiento y caché de herramientas, y proveedores nativos en proceso (`src/tools/files/`, `src/tools/terminal/`, `src/tools/web/`). | No deciden qué herramienta se usa. | `mcp/`, `src/tools/` |
| **Registro de trazabilidad** | Al terminar cada tarea escribe una carpeta (`summary.md`, `trace.json`, `full.json.gz`) y una línea en `index.jsonl`, para análisis y evaluación externa; los resultados grandes quedan en las refs. | No es base de datos, no restaura estado al reiniciar y el backend nunca la lee. | `trace/recorder.ts`, `trace/format.ts`, `trace/types.ts` |
| **Presupuesto** | Tabla única de límites y topes (pasos, replans, llamadas por paso, recortes de las vistas, extractores). | No contiene lógica. | `budget.ts` |

## 4. Dependencias entre Capas
- **Dirección permitida**: de afuera hacia adentro. El host compone los motores concretos; la fachada de tareas usa el motor; el motor usa el contexto, los modelos, Guard, el catálogo y los servidores MCP a través de contratos mínimos (`contracts.ts`), nunca de implementaciones.
- **Contexto aislado**: `ctx/` no importa nada fuera de `ctx/`. Los topes se pasan al crearlo desde `budget.ts`, y el texto de los prompts lo arma `render/`.
- **Traza desacoplada**: `trace/` depende del contexto (se suscribe a sus cambios) y de los puntos de captura del motor (`engine/capture.ts`). El motor solo conoce de `trace/` el receptor (`trace/sink.ts`); el registrador lo conecta la fachada de tareas.
- **Entorno de la PC**: los datos de la máquina (sistema operativo y carpetas del usuario, `environment.ts`) no viven en el contexto, que solo guarda el estado de la tarea y no conoce el sistema. Se consultan una vez por proceso (el servidor las pide al arrancar) y llegan al motor por `EngineServices.environment` (`engine/services.ts`), de donde las toma la generación de argumentos. La fecha (con día de la semana y zona horaria) la escribe el constructor de cada prompt al armarlo.
- **Reglas deterministas en el motor**: lo que se puede decidir sin modelo vive en funciones puras o con entradas explícitas dentro de `engine/`: el pre-chequeo de argumentos (`precheck.ts`, un registro de reglas con nombre), la lista de pendientes (`pendingList.ts`) y los topes del paso (`retries.ts`, con los números en `budget.ts`). Los modelos solo deciden lo que el código no puede comprobar.
- **Configuración inyectada**: ningún motor lee `ConfigManager` por su cuenta. La raíz de composición (`server.tsx`) pasa un `ConfigSource` (`() => JarvisConfig`, `config.ts`) a los modelos, los servidores MCP, `TaskManager` y la traza; se llama en cada uso, así los cambios en caliente se respetan. Solo `server/jarvisRouter.ts` usa `ConfigManager` directamente (es la API de la configuración).
- **Arranque de los servidores MCP**: `server.tsx` los inicia en paralelo apenas escucha (`DiscoveryEngine.discoverAll`), porque tardan en estar listos (Free Search ~1,8-2,5 s con `uvx`); si esperaran a la primera petición, la pagaría la primera carga de la interfaz o la primera tarea. Un servidor que falla queda como no disponible hasta un refresco.
- **Cierre ordenado**: el apagado del servidor cancela las tareas y espera un momento (`TaskManager.drain`) a que cierren sus procesos en segundo plano y escriban su traza, antes de apagar los servidores MCP; la traza se escribe de forma asíncrona, fuera del flujo de la tarea.
- **Topes en un solo lugar**: `engine/limits.ts` define qué cuenta cada tope (ejecuciones, intentos, bloqueos, rechazos), a qué alcance (tarea, ítem, paso) y qué pasa al llegar; `runStep` consulta un único punto de control y `GET /limits` sale de la misma tabla. El anti-bucle (`ctx/derive.ts`) aplica la política de repetición de cada herramienta.
- **Retención**: `retention.ts` borra por antigüedad (`retentionDays` para refs y trazas, `logRetentionDays` para el log de eventos) y por tamaño total en disco compartido (`retentionMaxMb`, las más viejas primero) las carpetas de refs y de trazas y los logs de tareas que Jarvis creó (por nombre), nunca las de otras cosas. Protege las refs y el log de las tareas retenidas en memoria, y nunca borra el log de una tarea sin cerrar.
- **Contratos**: `contracts.ts` define las interfaces que implementan los modelos (`models/qwen.ts`, `models/decision.ts`), por eso estos importan de él los tipos y las listas cerradas (`ARGS_REVIEWS`, `VERIFY_CHECKS`); no importan lógica del motor. Los tipos y constantes que los contratos y los modelos comparten con el motor (`FirstQueryKind` y los umbrales de D0, `StepFailureCause`, `DiskView`) viven en `types/` y el motor los reexporta; `tests/architecture.test.ts` falla si `models/`, `contracts.ts` o `render/` importan `engine/`, o si `ctx/` importa algo fuera de `ctx/`. Los errores de modelo (`types/modelErrors.ts`) y lo que espera una tarea (`types/waiting.ts`) viven también en `types/`. No hay ciclos de imports: el receptor de la captura vive en `trace/sink.ts` (aparte de los envoltorios de `capture.ts`) y los registros de la traza en `trace/types.ts`.
- **Vías externas**: `src/telegram/` y `src/voice/` dependen del núcleo solo por tipos y de la API HTTP en tiempo de ejecución; el núcleo, las herramientas y el resto no las importan (`tests/architecture.test.ts`). El token del bot vive en `.env` y los comandos de `run_command` no lo heredan.
- **Prohibido**: que modelos, Guard, el catálogo o el procesador de resultados dependan del host, de la fachada o del motor. El backend tampoco depende de la interfaz ni del laboratorio de evaluación. Además, todo verificado por `tests/architecture.test.ts`: el motor no importa los modelos (los recibe por `contracts.ts`); la traza y el cliente MCP no dependen del motor ni de los modelos; y Telegram y la voz no importan el motor ni los modelos.

## 5. Puntos de Extensión
- **Nuevas herramientas**: se agrega su línea al catálogo (`tools/manifest.ts`) con destino, capacidad y política. Solo si el formato de su salida lo justifica se registra un extractor en `result/extractors/`; sin él, usa el genérico.
- **Nuevos destinos funcionales**: se definen en el catálogo, asociados a un servidor y con la descripción que verá el modelo de decisión.
- **Nuevos servidores de herramientas**: se implementan según el contrato `IMCPServer`, se registran en el descubrimiento y se componen en `server.tsx`.
- **Nuevas vistas o prompts**: una vista nueva se agrega en `ctx/views/` y su renderizador en `render/`, sin tocar el motor.

## 6. Modelos y Servicios

| Servicio | Rol | Conexión |
|---|---|---|
| Modelo de decisión | Decisiones D0–D5, continuación de hilo y puntuación de `web_search` mediante `choice` y `noul` | `POST /v1/systemone` sobre `decisionUrl` con el campo `model` (`decisionModel`). Hoy es Ollama local; a futuro puede ser una URL remota con el mismo contrato |
| Modelo generativo | Plan, replan, pendientes, argumentos, pregunta al usuario y respuesta final | Ollama en `qwenUrl` (modelo `qwenModel`) |
| `free_search` | Búsqueda y lectura web usadas internamente por `web_search` (`search`, `fetch`, `read_doc`) | MCP por stdio (`freeSearchMcp`) |
| Herramientas propias | Archivos (`jarvis_files_read`, `jarvis_files_write`), sistema (`jarvis_system`), multimedia (`jarvis_multimedia`), `run_command` (`jarvis_terminal`) y `web_search` y `download_file` (`jarvis_web`); el detalle por grupo está en [`TOOLS.md`](TOOLS.md) | Proveedores nativos en `src/tools/files_read/`, `files_write/`, `system/`, `multimedia/`, `terminal/` y `web/` |

- La configuración vive en `jarvis-config.json` (detalle en [`../configuracion/CONFIGURACION.md`](../configuracion/CONFIGURACION.md)). Toda lectura y escritura pasa por una normalización que descarta claves desconocidas y valores inválidos.
- Define endpoints, timeouts, tope de tokens de salida por etapa, servidores MCP, políticas (`autoMode`, `blacklist`, `webSearchUseJudge`), voz, traza y carpeta de refs. `qwenNumCtx` y `decisionMaxContext` deben coincidir con el contexto real de cada servicio.
- Si falta `jarvis-config.json`, rigen los defaults de `src/core/config.ts` (`qwen3.5:4b`, `d3:2b`, `autoMode: false`); el `jarvis-config.json` incluido activa las variantes `-text` y `autoMode: true`.

## 7. Interfaz Externa
Base `/api/jarvis` (diseñada para uso local: `localOnly()` valida `Host` y `Origin`; ver `ALLOW_PROXY_HOST` en [`../configuracion/CONFIGURACION.md`](../configuracion/CONFIGURACION.md)). El detalle de cada ruta y el formato de la tarea están en [`../api/JARVIS_API.md`](../api/JARVIS_API.md).

| Ruta | Método | Función |
|---|---|---|
| `/process` | POST | Crea y lanza una tarea (`message`, `mode`: `reactive` o `deliberative`) |
| `/cancel` | POST | Cancela una tarea |
| `/confirm-plan`, `/modify-plan`, `/reject-plan` | POST | Responden a la confirmación del plan (modo deliberativo) |
| `/approve`, `/deny` | POST | Resuelven la aprobación de una operación sensible |
| `/user-answer` | POST | Responde la pregunta abierta de la tarea |
| `/state` | GET | Tarea pedida (o la última), listado de tareas y herramientas descubiertas |
| `/tasks/:taskId` | GET | Estado completo de una tarea (en RAM o reconstruida desde su log), sin el listado ni el catálogo |
| `/events` | GET | Flujo SSE de eventos de la tarea |
| `POST /refresh-discovery` | Solo `POST` | Refresca el catálogo de herramientas de los servidores MCP |
| `/config` | GET, POST | Lee o actualiza la configuración |
| `/tasks/:taskId/refs/:refId` | GET | Texto completo de una ref de la tarea |
| `/tasks/:taskId/trace` | GET | Traza de una tarea terminada (`format`: `summary`, `json` o `full`) |
| `/environment` | GET | Datos de la PC (sistema, carpetas del usuario, fecha y zona horaria) |
| `/limits` | GET | Topes del motor |
| `/tts` | POST | Voz: audio sintetizado por el servidor TTS |

Además, `/api/mcp` expone el descubrimiento y la invocación directa de los servidores MCP (`/discover-all`, `/:server/tools`, `/:server/call`, `/:server/reconnect`, `/:server/status`).

## 8. Archivos Base
- `server.tsx`
- `src/server/jarvisRouter.ts`
- `src/core/tasks.ts`
- `src/core/ctx/` (`context.ts`, `apply.ts`, `derive.ts`, `closure.ts`, `views/`)
- `src/core/contracts.ts`
- `src/core/engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `callPrepare.ts`, `callDiscovery.ts`, `callAuthorize.ts`, `callConfirm.ts`, `callExecute.ts`, `callRecord.ts`, `adapters.ts`, `args.ts`, `failures.ts`, `recalled.ts`, `runtime.ts`, `services.ts`, `classify.ts`, `firstQuery.ts`, `thread.ts`, `completion.ts`, `postcondition.ts`, `probes.ts`, `finalClean.ts`)
- `src/core/models/decision.ts`
- `src/core/models/qwen.ts`
- `src/core/models/prompts.ts`
- `src/core/render/`
- `src/core/policy/guard.ts`, `src/core/policy/tiers.ts`, `src/core/policy/egress.ts`, `src/core/policy/allowedDirs.ts`, `src/core/policy/rerun.ts`, `src/core/policy/readOnly.ts`, `src/core/policy/sensitivePaths.ts`
- `src/core/retention.ts`, `src/core/engine/limits.ts`, `src/memory/index.ts`, `src/server/localOnly.ts`
- `src/core/tools/manifest.ts`, `src/core/tools/probes.ts`
- `src/core/tools/filePaths.ts` (rutas, alias de carpetas con subruta, `allowedDirectories`, formato de las salidas), `src/core/tools/walkFolder.ts` (recorrido por anchura compartido por `find_files` y `search_content`: plazo, tope de entradas y de profundidad, enlaces que no salen de la raíz, cancelación)
- `src/core/result/processResult.ts`
- `src/core/refs/refVault.ts`
- `src/core/mcp/discovery.ts`
- `src/core/trace/recorder.ts`, `src/core/trace/format.ts`, `src/core/trace/types.ts`
- `src/core/policy/blacklist.ts`, `src/core/policy/commandRules.ts`, `src/core/trace/sink.ts`, `src/core/text.ts` (saneado y comparación de textos por raíz, común al motor y a los extractores)
- `src/core/engine/pendingList.ts`, `src/core/engine/precheck.ts`, `src/core/engine/retries.ts`
- `src/core/engine/reactiveList.ts`, `src/core/engine/state.ts`, `src/core/engine/outcomes.ts`, `src/core/engine/recoveryShadow.ts`, `src/core/engine/recoveryRules.ts`
- `src/core/types/` (tipos y constantes compartidos sin dependencias: etapas, rutas, `firstQuery.ts`, `stepFailure.ts`, `disk.ts`; `waiting.ts`: lo que una tarea espera del usuario y la pausa por un modelo caído; `modelErrors.ts`: los errores con que un modelo avisa que no pudo responder, que clasifica `engine/failures.ts`)
- `src/core/budget.ts`
- `src/core/config.ts`
- `src/core/models/transport.ts`
- `src/telegram/` (`bot.ts`: `TelegramBridge`, el estado de la tarea y los manejadores; `waitingPrompt.ts`: el texto y los botones de cada espera; `switches.ts`: `/auto` y `/voz`; `statusMessage.ts`: el mensaje de progreso que se edita; `api.ts`, `commands.ts`, `config.ts`, `format.ts`, `progress.ts`)
