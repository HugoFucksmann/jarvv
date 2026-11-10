# Arquitectura del Sistema

## 1. Propósito
El backend es un sistema determinista de asistencia y automatización local. Orquesta la ejecución supervisada de herramientas sobre el entorno operativo y la web, y separa de forma estricta cuatro responsabilidades: **decidir** (modelo de decisión), **generar** (modelo generativo), **registrar** (contexto de la tarea) y **ejecutar con seguridad** (motor, Guard y servidores MCP).

## 2. Principios Invariantes
1. **Una sola fuente de verdad por tarea**: todo el estado de una tarea vive en un único contexto (`TaskContext`) y se modifica solo a través de `apply`, su única puerta de escritura. Cada lote de operaciones es atómico: o se aplica completo o el contexto queda intacto.
2. **El contexto no conoce a nadie**: no importa herramientas, modelos ni la traza. Quien lo usa le pasa los datos ya resueltos y los topes numéricos.
3. **Desacoplamiento estricto de modelos**: el modelo de decisión elige rutas y herramientas, revisa argumentos y verifica resultados; el modelo generativo planifica, genera argumentos, formula preguntas y redacta la respuesta final. Ningún modelo toca el sistema operativo ni escribe en el contexto: lo hace el motor, validando.
4. **Seguridad con cierre por defecto**: toda acción pasa por Guard antes de despacharse. Una herramienta ausente del catálogo no se ofrece a ningún modelo, y si llegara a Guard se trata como sensible.
5. **Salidas voluminosas fuera del contexto**: los resultados extensos se guardan en disco bajo referencias (`rN`). El contexto conserva un resumen acotado y la ruta del archivo.
6. **Estado volátil, auditoría de solo adición**: las tareas viven en memoria con un cupo retenido. Lo único que se escribe en disco es la configuración, los resultados crudos de las refs y una traza de solo adición que el backend nunca vuelve a leer (ver `CONTEXT_AND_MEMORY.md`).
7. **Lo accesorio se puede borrar**: la traza vive fuera del motor; si se elimina, el motor compila y funciona igual.

## 3. Componentes

| Componente | Responsabilidad | Qué NO hace | Implementación (en `src/core/`, salvo el host) |
|---|---|---|---|
| **Host del servidor** | Raíz de composición: construye los motores concretos, restringe el acceso a `localhost` (valida `Host` y `Origin`), expone la API HTTP y el flujo SSE, y cierra los servidores MCP y sus procesos hijos al apagar. | No decide el flujo de las tareas ni conoce su estado interno. | `server.ts`, `src/server/jarvisRouter.ts`, `src/server/mcpRouter.ts` |
| **Fachada de tareas** | Única puerta entre el exterior y el motor: crea el contexto de cada tarea, lanza su ejecución en segundo plano, resuelve las respuestas del usuario (plan, aprobación, pregunta), cancela, retiene un cupo de tareas y emite los eventos. | No decide el flujo ni ejecuta herramientas. | `tasks.ts` |
| **Contexto de tarea** | Guarda el estado completo de una tarea (plan, pasos, llamadas, errores, hechos, refs, respuesta), valida cada escritura, calcula las derivaciones (efectos, anti-bucle, contadores) y construye las vistas por consumidor. | No renderiza texto de prompts, no conoce herramientas ni modelos y no persiste. | `ctx/` (`context.ts`, `apply.ts`, `derive.ts`, `closure.ts`, `snapshot.ts`, `views/`) |
| **Motor de ejecución** | Recorre la tarea de principio a fin: bucle de pasos, ejecución de cada llamada, verificación, recuperación según el modo (escalación o replan), esperas del usuario y cierre. | No genera texto con modelos por su cuenta ni evalúa políticas de seguridad. | `engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `retries.ts`, `planner.ts`, `pending.ts`, `pendingList.ts`, `precheck.ts`, `verify.ts`, `ask.ts`, `finalize.ts`) |
| **Modelo de decisión** | Cuatro decisiones con preguntas `choice` y `noul`: ruta (Decisión 1), herramienta (2), revisión de argumentos (3) y verificación del resultado (4). | No genera texto libre, planes ni argumentos. | `models/decision.ts` |
| **Modelo generativo** | Plan y replan, lista de pendientes (reactivo), argumentos conforme al esquema de la herramienta, pregunta al usuario y respuesta final. | No despacha comandos ni accede al entorno local. | `models/qwen.ts`, `models/prompts.ts` |
| **Renderizadores** | Convierten las vistas estructuradas del contexto en el texto de los prompts, saneando todo texto externo. | No leen el contexto directamente ni aplican topes de negocio. | `render/` |
| **Compuerta de seguridad (Guard)** | Evalúa los argumentos resueltos: deniega patrones destructivos y escrituras sobre las carpetas protegidas, y exige aprobación humana para las operaciones sensibles (un comando de terminal que `policy/readOnly.ts` demuestra de solo lectura no la necesita, salvo que toque una ruta sensible: `policy/sensitivePaths.ts`, aprobación obligatoria también con `autoMode`). Si el usuario aprueba, la llamada no pasa por la revisión de Decisión 3. Con `autoMode` no se pide aprobación y la revisión de Decisión 3 valida las escrituras del catálogo. | No modifica argumentos ni negocia alternativas con los modelos. | `policy/guard.ts` |
| **Lista negra y reglas de comando** | Reglas deterministas sobre las herramientas que modifican el sistema, en dos niveles (`blocked`, `sensitive`): las reglas de comando integradas (`commandRules.ts`: Windows y Linux, comando y ruta juntos, siempre activas) y las entradas editables de `blacklist` en `jarvis-config.json`. Las lecturas pasan siempre. Sin `autoMode` toda coincidencia se pregunta al usuario; con `autoMode`, `blocked` se rechaza (recuperable, `tool_rejected`) y `sensitive` pasa a D3 con umbral estricto. | No cierra la tarea (eso es de Guard, con el nivel `guard` de las mismas reglas) ni consulta modelos. | `policy/blacklist.ts`, `policy/commandRules.ts` |
| **Catálogo de herramientas** | Lista cerrada de herramientas autorizadas, con su destino, capacidad, política (aprobación, anti-bucle) y notas de parámetros. Es la única fuente de políticas. | No ejecuta llamadas ni guarda estado dinámico. | `tools/manifest.ts` |
| **Procesador de resultados** | Convierte el resultado crudo de una herramienta en un estado (`ok`, `no_data`, `not_found`, `tool_error`, `denied`), un resumen acotado y el texto completo para la ref; incluye extractores por herramienta. | No guarda nada, no conoce tareas ni refs y no sanea. | `result/processResult.ts`, `result/extractors/` |
| **Almacén y resolutor de refs** | Guarda el resultado crudo en disco y sustituye los tokens `{{ref:rN}}` de los argumentos por su contenido antes de Guard y del despacho. | El almacén no conoce el contexto; el resolutor no toca el disco ni las herramientas. | `refs/refVault.ts`, `refs/refResolver.ts` |
| **Servidores MCP** | Transporte stdio JSON-RPC por servidor, descubrimiento y caché de herramientas, y adaptadores de cada servidor. | No deciden qué herramienta se usa. | `mcp/` |
| **Registro de trazabilidad** | Al terminar cada tarea escribe una carpeta (`summary.md`, `trace.json`, `full.json.gz`) y una línea en `index.jsonl`, para análisis y evaluación externa; los resultados grandes quedan en las refs. | No es base de datos, no restaura estado al reiniciar y el backend nunca la lee. | `trace/recorder.ts`, `trace/format.ts`, `trace/types.ts` |
| **Presupuesto** | Tabla única de límites y topes (pasos, replans, llamadas por paso, recortes de las vistas, extractores). | No contiene lógica. | `budget.ts` |

## 4. Dependencias entre Capas
- **Dirección permitida**: de afuera hacia adentro. El host compone los motores concretos; la fachada de tareas usa el motor; el motor usa el contexto, los modelos, Guard, el catálogo y los servidores MCP a través de contratos mínimos (`contracts.ts`), nunca de implementaciones.
- **Contexto aislado**: `ctx/` no importa nada fuera de `ctx/`. Los topes se pasan al crearlo desde `budget.ts`, y el texto de los prompts lo arma `render/`.
- **Traza desacoplada**: `trace/` depende del contexto (se suscribe a sus cambios) y de los puntos de captura del motor (`engine/capture.ts`), nunca a la inversa.
- **Entorno de la PC**: los datos de la máquina (sistema operativo y carpetas del usuario, `environment.ts`) no viven en el contexto, que solo guarda el estado de la tarea y no conoce el sistema. Se consultan una vez por proceso (el servidor las pide al arrancar) y llegan al motor por `EngineServices.environment` (`engine/services.ts`), de donde las toma la generación de argumentos. La fecha (con día de la semana y zona horaria) la escribe el constructor de cada prompt al armarlo.
- **Reglas deterministas en el motor**: lo que se puede decidir sin modelo vive en funciones puras o con entradas explícitas dentro de `engine/`: el pre-chequeo de argumentos (`precheck.ts`), la lista de pendientes (`pendingList.ts`) y los topes del paso (`retries.ts`, con los números en `budget.ts`). Los modelos solo deciden lo que el código no puede comprobar.
- **Configuración inyectada**: ningún motor lee `ConfigManager` por su cuenta. La raíz de composición (`server.ts`) pasa un `ConfigSource` (`() => JarvisConfig`, `config.ts`) a los modelos, los servidores MCP, `TaskManager` y la traza; se llama en cada uso, así los cambios en caliente se respetan. Solo `server/jarvisRouter.ts` usa `ConfigManager` directamente (es la API de la configuración).
- **Arranque de los servidores MCP**: `server.ts` los inicia en paralelo apenas escucha (`DiscoveryEngine.discoverAll`), porque tardan en estar listos (Desktop Commander ~0,7 s lanzado con `node` directo desde `node_modules`; Free Search ~1,8-2,5 s con `uvx`); si esperaran a la primera petición, la pagaría la primera carga de la interfaz o la primera tarea. Un servidor que falla queda como no disponible hasta un refresco.
- **Cierre ordenado**: el apagado del servidor cancela las tareas y espera un momento (`TaskManager.drain`) a que cierren sus procesos en segundo plano y escriban su traza, antes de apagar los servidores MCP; la traza se escribe de forma asíncrona, fuera del flujo de la tarea.
- **Topes en un solo lugar**: `engine/limits.ts` define qué cuenta cada tope (ejecuciones, intentos, bloqueos, rechazos), a qué alcance (tarea, ítem, paso) y qué pasa al llegar; `runStep` consulta un único punto de control y `GET /limits` sale de la misma tabla. El anti-bucle (`ctx/derive.ts`) aplica la política de repetición de cada herramienta.
- **Retención**: `retention.ts` borra por antigüedad (`retentionDays`) las carpetas de refs y de trazas que Jarvis creó (por nombre), nunca las de otras cosas, y protege las refs de las tareas retenidas en memoria.
- **Contratos**: `contracts.ts` define las interfaces que implementan los modelos (`models/qwen.ts`, `models/decision.ts`), por eso estos importan de él los tipos y las listas cerradas (`ARGS_REVIEWS`, `VERIFY_CHECKS`); no importan lógica del motor. No hay ciclos de imports: el receptor de la captura vive en `trace/sink.ts` (aparte de los envoltorios de `capture.ts`) y los registros de la traza en `trace/types.ts`.
- **Prohibido**: que modelos, Guard, el catálogo o el procesador de resultados dependan del host, de la fachada o del motor. El backend tampoco depende de la interfaz ni del laboratorio de evaluación.

## 5. Puntos de Extensión
- **Nuevas herramientas**: se agrega su línea al catálogo (`tools/manifest.ts`) con destino, capacidad y política. Solo si el formato de su salida lo justifica se registra un extractor en `result/extractors/`; sin él, usa el genérico.
- **Nuevos destinos funcionales**: se definen en el catálogo, asociados a un servidor y con la descripción que verá el modelo de decisión.
- **Nuevos servidores de herramientas**: se implementan según el contrato `IMCPServer`, se registran en el descubrimiento y se componen en `server.ts`.
- **Nuevas vistas o prompts**: una vista nueva se agrega en `ctx/views/` y su renderizador en `render/`, sin tocar el motor.

## 6. Modelos y Servicios

| Servicio | Rol | Conexión |
|---|---|---|
| Modelo de decisión | Cuatro decisiones del motor mediante preguntas `choice` y `noul` | `POST /v1/systemone` sobre `decisionUrl` con el campo `model` (`decisionModel`). Hoy es Ollama local; a futuro puede ser una URL remota con el mismo contrato |
| Modelo generativo | Plan, replan, argumentos, pregunta al usuario y respuesta final | Ollama en `qwenUrl` (modelo `qwenModel`) |
| `desktop_commander` | Herramientas de archivos, búsqueda local y terminal | MCP por stdio (`desktopCommanderMcp`) |
| `free_search` | Búsqueda y lectura web | MCP por stdio (`freeSearchMcp`) |

- La configuración vive en `jarvis-config.json`. Toda lectura y escritura pasa por una normalización que descarta claves desconocidas y valores inválidos.
- Define endpoints, timeouts, tope de tokens de salida por etapa, servidores MCP, la traza y la carpeta de refs. `qwenNumCtx` y `decisionMaxContext` deben coincidir con el contexto real de cada servicio.
- Si falta el archivo de configuración, rigen los valores por defecto del código, que coinciden con los del archivo incluido.

## 7. Interfaz Externa
Base `/api/jarvis`, solo local. El detalle de cada ruta y el formato de la tarea están en `JARVIS_API.md`.

| Ruta | Método | Función |
|---|---|---|
| `/process` | POST | Crea y lanza una tarea (`message`, `mode`: `reactive` o `deliberative`) |
| `/cancel` | POST | Cancela una tarea |
| `/confirm-plan`, `/modify-plan`, `/reject-plan` | POST | Responden a la confirmación del plan (modo deliberativo) |
| `/approve`, `/deny` | POST | Resuelven la aprobación de una operación sensible |
| `/user-answer` | POST | Responde la pregunta abierta de la tarea |
| `/state` | GET | Tarea pedida (o la última), listado de tareas y herramientas descubiertas |
| `/events` | GET | Flujo SSE de eventos de la tarea |
| `/refresh-discovery` | Cualquiera | Refresca el catálogo de herramientas de los servidores MCP |
| `/config` | GET, POST | Lee o actualiza la configuración |

Además, `/api/mcp` expone el descubrimiento y la invocación directa de los servidores MCP (`/discover-all`, `/:server/tools`, `/:server/call`, `/:server/reconnect`, `/:server/status`).

## 8. Archivos Base
- `server.ts`
- `src/server/jarvisRouter.ts`
- `src/core/tasks.ts`
- `src/core/ctx/` (`context.ts`, `apply.ts`, `derive.ts`, `closure.ts`, `views/`)
- `src/core/contracts.ts`
- `src/core/engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `services.ts`)
- `src/core/models/decision.ts`
- `src/core/models/qwen.ts`
- `src/core/models/prompts.ts`
- `src/core/render/`
- `src/core/policy/guard.ts`, `src/core/policy/readOnly.ts`, `src/core/policy/sensitivePaths.ts`
- `src/core/retention.ts`, `src/core/engine/limits.ts`, `src/core/engine/processes.ts`, `src/server/localOnly.ts`
- `src/core/tools/manifest.ts`
- `src/core/result/processResult.ts`
- `src/core/refs/refVault.ts`
- `src/core/refs/refResolver.ts`
- `src/core/mcp/discovery.ts`
- `src/core/trace/recorder.ts`, `src/core/trace/format.ts`, `src/core/trace/types.ts`
- `src/core/policy/blacklist.ts`, `src/core/policy/commandRules.ts`, `src/core/trace/sink.ts`, `src/core/text.ts` (saneado y comparación de textos por raíz, común al motor y a los extractores)
- `src/core/engine/pendingList.ts`, `src/core/engine/precheck.ts`, `src/core/engine/retries.ts`
- `src/core/budget.ts`
- `src/core/config.ts`
- `src/core/models/transport.ts`
