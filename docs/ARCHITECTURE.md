# Arquitectura del Sistema

## 1. Propósito
El backend es un sistema determinista de asistencia y automatización local. Orquesta la ejecución supervisada de herramientas en el entorno operativo y la web mediante la separación estricta entre planificación, clasificación de decisiones y ejecución segura.

## 2. Principios Invariantes
1. **Núcleo único de ejecución**: Todo comando o acceso a herramientas se procesa a través de un único canal determinista. La planificación no ejecuta herramientas; solo secuencia etapas sobre el núcleo.
2. **Desacoplamiento estricto de modelos**: El modelo de razonamiento descompone objetivos, formula parámetros estructurados y valida etapas; el clasificador factual selecciona rutas, herramientas y evalúa el cumplimiento técnico inmediato. Ningún modelo tiene acceso directo al sistema operativo.
3. **Seguridad con cierre por defecto**: Toda acción potencialmente mutante requiere autorización explícita previa. Cualquier herramienta no registrada en el catálogo oficial queda excluida de la ejecución.
4. **Aislamiento ontológico de datos**: Las salidas voluminosas de herramientas se segregan bajo referencias deterministas. Los modelos razonan sobre observaciones acotadas y direccionan contenidos mediante identificadores indirectos.
5. **Volatilidad controlada del estado**: El estado operativo reside exclusivamente en memoria volátil, con un cupo de tareas retenidas; la trazabilidad externa opera en modo de solo adición para auditoría (ver detalle en `CONTEXT_AND_MEMORY.md`).

## 3. Componentes

| Componente | Responsabilidad | Qué NO hace | Implementación (en `src/core/`, salvo el host) |
|---|---|---|---|
| **Host del Servidor** | Inicializa el entorno, gestiona señales del sistema operativo para el apagado ordenado de subprocesos y expone los canales de comunicación y eventos. | No toma decisiones de ejecución ni gestiona el estado interno de las tareas. | `server.ts`, `src/server/jarvisRouter.ts` |
| **Núcleo Orquestador** | Centraliza el ciclo de vida de las tareas en memoria, emite eventos de observabilidad y coordina las solicitudes de intervención del usuario. | No dialoga directamente con los servidores de herramientas ni contiene la lógica de los bucles de ejecución. | `core.ts` |
| **Motores de Modo** | Implementan las estrategias reactiva y deliberativa, regulan cotas operativas, gestionan la escalación ante desvíos y ejecutan la replanificación autónoma. | No generan argumentos estructurados ni evalúan políticas de seguridad. | `modeEngines.ts` |
| **Ejecutor Atómico de Pasos** | Conduce el pipeline secuencial de cada acción: validación de ruta, selección de herramienta, formulación de argumentos, resolución de referencias, control anti-bucle, compuerta de seguridad, despacho, procesamiento y verificación. | No decide la estrategia global de la tarea ni define secuencias de pasos. | `callExecutor.ts` |
| **Clasificador Factual** | Discrimina entre rutas operativas o fin de tarea, selecciona la herramienta correspondiente al destino y emite el dictamen técnico inmediato sobre los resultados observables. | No genera texto libre, planes complejos ni argumentos estructurados. | `decision.ts` |
| **Razonador** | Descompone objetivos en etapas estructuradas, genera argumentos validados contra esquema, evalúa semánticamente el progreso de las etapas y sintetiza la respuesta final. | No despacha comandos ni accede al entorno local. | `reasoner/qwen.ts` |
| **Compuerta de Seguridad** | Evalúa argumentos normalizados contra patrones destructivos prohibidos y políticas de mutación para autorizar, solicitar intervención humana o denegar la acción. | No modifica argumentos ni negocia alternativas con los modelos. | `policy/guard.ts` |
| **Catálogo de Herramientas** | Define formalmente las herramientas autorizadas, sus rutas funcionales, capacidades asociadas, requisitos de autorización y precondiciones de uso. | No ejecuta llamadas ni mantiene estado dinámico. | `tools/manifest.ts` |
| **Procesador de Resultados** | Parsea salidas de herramientas, sintetiza observaciones acotadas, calcula señales de fallo y aísla cargas pesadas en el almacén de referencias. | No evalúa la veracidad semántica de los datos ni interactúa con disco. | `processor/resultProcessor.ts` |
| **Resolutor de Referencias** | Sustituye tokens de referencia por sus contenidos reales en los argumentos antes de la evaluación de seguridad y el despacho. | No genera nuevas referencias ni invoca herramientas. | `processor/refResolver.ts` |
| **Gestor de Contexto y Memoria** | Recupera la memoria de la tarea para cada llamada a un modelo y la expone en bloques acotados y delimitados que previenen inyecciones. | No persiste información ni realiza llamadas a servicios. | `context.ts`, `reasoner/prompts.ts` |
| **Registro de Trazabilidad** | Emite un registro secuencial en disco al término de cada tarea para análisis y evaluación externa. | No actúa como base de datos ni restaura estado al reiniciar el servidor. | `taskTrace.ts` |

## 4. Dependencias entre Capas
- **Dirección permitida**: Jerárquica y descendente. Las capas superiores de orquestación dependen de los componentes subordinados de ejecución, seguridad e inferencia, nunca a la inversa.
- **Dirección prohibida**: Ningún componente de inferencia, seguridad o procesamiento de herramientas conoce ni depende de las capas de orquestación o del host. El backend no posee dependencias hacia capas de presentación ni de laboratorio.

## 5. Puntos de Extensión
- **Nuevas herramientas**: Se registran exclusivamente en el catálogo de herramientas asociando su identificador, destino, capacidad, esquema de parámetros y política de mutación.
- **Nuevos destinos funcionales**: Se definen en las rutas del catálogo asociándolos al servidor correspondiente e incorporando sus descripciones operativas.
- **Nuevos servidores de herramientas**: Se conectan implementando el protocolo estándar de comunicación y registrándose en el gestor de descubrimiento del servidor.

## 6. Modelos y Servicios

| Servicio | Rol | Conexión |
|---|---|---|
| Decision 2.0 (Eos 0.8B) | Clasificador factual: rutas, herramienta y verificación de paso mediante preguntas `choice` y `noul` | HTTP `POST /v1/decide` sobre `decisionUrl` |
| Qwen 3.5 9B | Razonador: plan, replan, argumentos, verificación semántica y respuesta final | Ollama en `qwenUrl` (modelo `qwenModel`) |
| desktop_commander | Herramientas de archivos, búsqueda local y terminal | MCP por stdio (`desktopCommanderMcp`) |
| free_search | Búsqueda y lectura web | MCP por stdio (`freeSearchMcp`) |

- La configuración se guarda en `jarvis-config.json` con escritura atómica y toda lectura pasa por una normalización que descarta claves desconocidas y valores inválidos.
- Define endpoints, tiempos de espera, tope de tokens de salida por etapa, servidores MCP y el registro de trazas. `qwenNumCtx` y `decisionMaxContext` deben coincidir con el contexto real de cada servicio.

## 7. Interfaz Externa
Rutas relativas al punto de montaje del router (`server.ts`):

| Ruta | Método | Función |
|---|---|---|
| `/process`, `/task` | POST | Inicia una tarea (`message`, `mode`: `NORMAL` o `PLAN`) |
| `/cancel` | POST | Cancela una tarea |
| `/confirm-plan` | POST | Confirma el plan, o lo rechaza o modifica según `action`; `/reject-plan` y `/modify-plan` son equivalentes |
| `/user-answer` | POST | Responde la pregunta abierta de una tarea deliberativa; devuelve 409 si no se aplicó |
| `/approve`, `/deny` | POST | Resuelve la aprobación de seguridad pendiente |
| `/state` | GET | Tarea actual, aprobación pendiente, tareas retenidas y herramientas descubiertas |
| `/events` | GET | Flujo SSE: cada evento del núcleo con la tarea y la aprobación pendiente |
| `/refresh-discovery`, `/discovery` | Cualquiera | Refresca el catálogo de herramientas de los servidores MCP |
| `/config` | GET, POST | Lee o actualiza la configuración |

## 8. Archivos Base
- `server.ts`
- `src/server/jarvisRouter.ts`
- `src/core/core.ts`
- `src/core/modeEngines.ts`
- `src/core/callExecutor.ts`
- `src/core/decision.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/policy/guard.ts`
- `src/core/tools/manifest.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/processor/refResolver.ts`
- `src/core/context.ts`
- `src/core/config.ts`
- `src/core/llmTransport.ts`
- `src/core/modelIterations.ts`
- `src/core/taskWire.ts`
- `src/core/reasoner/prompts.ts`
- `src/core/mcp/discovery.ts`
- `src/core/taskTrace.ts`
- `src/core/types.ts`