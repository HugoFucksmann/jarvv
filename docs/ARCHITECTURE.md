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
| **Motor de ejecución** | Recorre la tarea de principio a fin: bucle de pasos, ejecución de cada llamada, verificación, recuperación según el modo (escalación o replan), esperas del usuario y cierre. | No genera texto con modelos por su cuenta ni evalúa políticas de seguridad. | `engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `planner.ts`, `verify.ts`, `ask.ts`, `finalize.ts`) |
| **Modelo de decisión** | Cuatro decisiones con preguntas `choice` y `noul`: ruta (Decisión 1), herramienta (2), revisión de argumentos (3) y verificación del resultado (4). | No genera texto libre, planes ni argumentos. | `decision.ts` |
| **Modelo generativo** | Plan y replan, argumentos conforme al esquema de la herramienta, pregunta al usuario y respuesta final. | No despacha comandos ni accede al entorno local. | `reasoner/qwen.ts`, `reasoner/prompts.ts` |
| **Renderizadores** | Convierten las vistas estructuradas del contexto en el texto de los prompts, saneando todo texto externo. | No leen el contexto directamente ni aplican topes de negocio. | `render/` |
| **Compuerta de seguridad (Guard)** | Evalúa los argumentos resueltos: deniega patrones destructivos y escrituras sobre las carpetas protegidas, y exige aprobación humana para las operaciones sensibles. | No modifica argumentos ni negocia alternativas con los modelos. | `policy/guard.ts` |
| **Catálogo de herramientas** | Lista cerrada de herramientas autorizadas, con su destino, capacidad, política (aprobación, anti-bucle) y notas de parámetros. Es la única fuente de políticas. | No ejecuta llamadas ni guarda estado dinámico. | `tools/manifest.ts` |
| **Procesador de resultados** | Convierte el resultado crudo de una herramienta en un estado (`ok`, `no_data`, `not_found`, `tool_error`, `denied`), un resumen acotado y el texto completo para la ref; incluye extractores por herramienta. | No guarda nada, no conoce tareas ni refs y no sanea. | `result/processResult.ts`, `result/extractors/` |
| **Almacén y resolutor de refs** | Guarda el resultado crudo en disco y sustituye los tokens `{{ref:rN}}` de los argumentos por su contenido antes de Guard y del despacho. | El almacén no conoce el contexto; el resolutor no toca el disco ni las herramientas. | `refs/refVault.ts`, `refs/refResolver.ts` |
| **Servidores MCP** | Transporte stdio JSON-RPC por servidor, descubrimiento y caché de herramientas, y adaptadores de cada servidor. | No deciden qué herramienta se usa. | `mcp/` |
| **Registro de trazabilidad** | Escribe una línea JSON por tarea terminada para análisis y evaluación externa. | No es base de datos ni restaura estado al reiniciar. | `trace/recorder.ts` |
| **Presupuesto** | Tabla única de límites y topes (pasos, replans, llamadas por paso, recortes de las vistas, extractores). | No contiene lógica. | `budget.ts` |

## 4. Dependencias entre Capas
- **Dirección permitida**: de afuera hacia adentro. El host compone los motores concretos; la fachada de tareas usa el motor; el motor usa el contexto, los modelos, Guard, el catálogo y los servidores MCP a través de contratos mínimos (`engine/deps.ts`), nunca de implementaciones.
- **Contexto aislado**: `ctx/` no importa nada fuera de `ctx/`. Los topes se pasan al crearlo desde `budget.ts`, y el texto de los prompts lo arma `render/`.
- **Traza desacoplada**: `trace/` depende del contexto (se suscribe a sus cambios) y de los puntos de captura del motor (`engine/capture.ts`), nunca a la inversa.
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
- `src/core/engine/` (`runTask.ts`, `stepLoop.ts`, `callRunner.ts`, `deps.ts`)
- `src/core/decision.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/reasoner/prompts.ts`
- `src/core/render/`
- `src/core/policy/guard.ts`
- `src/core/tools/manifest.ts`
- `src/core/result/processResult.ts`
- `src/core/refs/refVault.ts`
- `src/core/refs/refResolver.ts`
- `src/core/mcp/discovery.ts`
- `src/core/trace/recorder.ts`
- `src/core/budget.ts`
- `src/core/config.ts`
- `src/core/llmTransport.ts`
