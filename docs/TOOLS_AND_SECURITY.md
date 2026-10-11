# Herramientas y seguridad

> Última revisión: **2026-10-11**

JARVIS Core se integra con tres servidores locales de herramientas a través del protocolo Model Context Protocol (MCP) sobre transporte stdio: `windows` (`windows-mcp`), `desktop_commander` (`@wonderwhy-er/desktop-commander`) y `free_search` (`free-search-mcp`). Las herramientas y capacidades se descubren dinámicamente en tiempo de ejecución. La seguridad se gestiona mediante una arquitectura determinista en capas inviolables: un registro inmutable de políticas (`PolicyRegistry`), una compuerta de seguridad (`Guard`) que aplica bloqueos incondicionales ante comandos destructivos (`DENY`), autoriza autónomamente lecturas seguras (`ALLOW`) y exige aprobación humana explícita (`APPROVAL`) para mutaciones o comandos de terminal, restricciones de directorios en el adaptador (`allowedDirectories`) y un mecanismo de anti-loop contra acciones idénticas consecutivas.

## Catálogo de herramientas

Herramientas registradas en `PolicyRegistry` (`src/core/policy/policyRegistry.ts`), clasificadas por servidor de origen, descripción y nivel de riesgo:

| Tool | Origen | Descripción | Riesgo |
|------|--------|-------------|--------|
| `windows:ui_get_window_tree` | Windows MCP | Obtiene el árbol estructurado de controles de la ventana activa | Bajo (READ, mutates: false) |
| `windows:ui_get_diff_tree` | Windows MCP | Obtiene únicamente los cambios respecto a la observación anterior | Bajo (READ, mutates: false) |
| `windows:ui_search_elements` | Windows MCP | Busca elementos interactivos por nombre, tipo o AutomationId | Bajo (READ, mutates: false) |
| `windows:ui_inspect_element` | Windows MCP | Inspecciona en profundidad las propiedades de un elemento | Bajo (READ, mutates: false) |
| `windows:ui_read` | Windows MCP | Lee el texto de un control o ventana mediante UIA u OCR | Bajo (READ, mutates: false) |
| `windows:ui_wait` | Windows MCP | Espera a que un control aparezca o alcance un estado determinado | Bajo (READ, mutates: false) |
| `windows:ui_click` | Windows MCP | Envía clic de ratón o acción de pulsación sobre un elemento | Medio (UI_ACTION, mutates: true) |
| `windows:ui_set_focus` | Windows MCP | Establece el foco del sistema en el elemento de destino | Medio (UI_ACTION, mutates: true) |
| `windows:ui_type_text` | Windows MCP | Introduce texto simulado en un control editable enfocado | Medio (UI_ACTION, mutates: true) |
| `windows:set_volume` | Windows MCP | Modifica el nivel de volumen general del sistema operativo | Medio (UI_ACTION, mutates: true) |
| `windows:launch_app` | Windows MCP | Inicia una aplicación ejecutable en el escritorio de Windows | Alto (PROCESS_CONTROL, APPROVAL) |
| `windows:close_window` | Windows MCP | Cierra la ventana activa o finaliza la aplicación asociada | Alto (PROCESS_CONTROL, APPROVAL) |
| `desktop_commander:list_directory` | Desktop Commander | Enumera archivos y subcarpetas dentro de un directorio | Bajo (FILE_READ, mutates: false) |
| `desktop_commander:read_file` | Desktop Commander | Lee el contenido de un archivo local (soporta offset y length) | Bajo (FILE_READ, mutates: false) |
| `desktop_commander:search_files` | Desktop Commander | Busca archivos por nombre o patrón en el sistema local | Bajo (FILE_READ, mutates: false) |
| `desktop_commander:read_process_output` | Desktop Commander | Lee la salida de terminal generada por un proceso en ejecución | Bajo (READ, mutates: false) |
| `desktop_commander:run_command` | Desktop Commander | Ejecuta un comando en la terminal del sistema (cmd/powershell/bash) | Dinámico (Inspección: Bajo; Mutación: Alto, APPROVAL) |
| `desktop_commander:write_file` | Desktop Commander | Crea o sobreescribe un archivo en disco con el contenido dado | Alto (FILE_WRITE, APPROVAL) |
| `desktop_commander:edit_file` | Desktop Commander | Modifica bloques o líneas específicas en un archivo existente | Alto (FILE_WRITE, APPROVAL) |
| `desktop_commander:delete_file` | Desktop Commander | Elimina de forma destructiva y permanente un archivo o carpeta | Crítico (FILE_DELETE, APPROVAL) |
| `desktop_commander:start_process` | Desktop Commander | Inicia un nuevo proceso de consola en segundo plano | Alto (PROCESS_CONTROL, APPROVAL) |
| `desktop_commander:kill_process` | Desktop Commander | Finaliza forzadamente un proceso del sistema por su PID | Alto (PROCESS_CONTROL, APPROVAL) |
| `desktop_commander:interact_process` | Desktop Commander | Envía entradas por stdin a un proceso de terminal interactivo | Alto (PROCESS_CONTROL, APPROVAL) |
| `desktop_commander:set_config` | Desktop Commander | Modifica opciones de configuración local del servidor MCP | Alto (CONFIGURATION, APPROVAL) |
| `free_search:search` | Free Search | Busca información en la web mediante los motores configurados | Bajo (READ, mutates: false) |
| `free_search:fetch` / `fetch_page` | Free Search | Descarga y extrae el texto legible de una página web | Bajo (READ, mutates: false) |
| `free_search:fetch_batch` | Free Search | Descarga el contenido de múltiples URLs web en lote | Bajo (READ, mutates: false) |
| `free_search:read_doc` | Free Search | Lee documentos y artículos extensos extraídos de la web | Bajo (READ, mutates: false) |
| `free_search:research` | Free Search | Ejecuta una investigación iterativa y estructurada en la web | Bajo (READ, mutates: false) |
| `free_search:paper_graph` | Free Search | Consulta grafos y relaciones de artículos académicos | Bajo (READ, mutates: false) |
| `free_search:cache_search` | Free Search | Busca dentro del contenido previamente almacenado en caché | Bajo (READ, mutates: false) |
| `free_search:read_cached_resource` | Free Search | Lee un recurso específico almacenado en la caché local | Bajo (READ, mutates: false) |
| `free_search:engines` | Free Search | Enumera los motores de búsqueda web actualmente disponibles | Bajo (READ, mutates: false) |
| `free_search:compare` | Free Search | Compara información y contenidos de distintas fuentes web | Bajo (READ, mutates: false) |
| `free_search:extract_structured` | Free Search | Extrae metadatos estructurados (JSON-LD, OpenGraph, microdatos) | Bajo (READ, mutates: false) |
| `free_search:download` / `download_document` | Free Search | Descarga archivos binarios o documentos externos a almacenamiento | Alto (DOWNLOAD, APPROVAL) |

## Selección de herramientas

- **Exposición:** Se determina en dos niveles:
  1. *Nivel de subsistema (Decision #1):* Decision 2.0 evalúa entre las rutas generales `windows`, `desktop_commander`, `free_search` y `fin`.
  2. *Nivel de herramientas (Discovery):* Se consultan dinámicamente las herramientas provistas por el servidor seleccionado invocando `DiscoveryEngine.getDiscoveredTools(serverName)`. Los esquemas JSON de las herramientas se depuran mediante `cleanInputSchema` para suprimir metadatos irrelevantes (`$schema`, `title`, `additionalProperties`, `examples`). Si hubo una herramienta fallida previa en el mismo MCP, se excluye temporalmente de la selección (`excludedToolForNextCall`).
- **Elección:** La realiza Decision 2.0 en `evaluateDecisionTwo`. El modelo recibe una pregunta de tipo `choice` con hasta 255 herramientas descubiertas, donde cada opción incluye la descripción corta anotada con advertencias anti-repetición (`[ya ejecutada - NO REPETIR]` o `[ya falló - EVITAR]`). Si el servidor cuenta con una sola herramienta, se selecciona automáticamente con confianza 1.0 sin invocar inferencia externa.

## Ejecución

Ciclo de vida completo de una llamada:

```
tool_call → validar existencia en Discovery → generar argumentos con Qwen (JSON schema) → verificar Anti-Loop → evaluar Guard (ALLOW / APPROVAL / DENY) → ejecutar en MCP por stdio → recuperación de stale element (Windows) → ResultProcessor (señales, sanitización, RefStore) → evaluación de éxito con Decision #5
```

- **Timeouts:**
  - Llamadas MCP por stdio: `30000 ms` (`mcpTimeoutMs` o `timeoutMs` en `jarvis-config.json`).
  - Decision 2.0 HTTP: `30000 ms` (`decisionTimeoutMs` en `jarvis-config.json`).
  - Qwen 3.5 9B HTTP: `60000 ms` (`qwenTimeoutMs` en `jarvis-config.json`).
- **Reintentos:**
  - Argumentos de Qwen: hasta 2 reintentos (`MAX_ARG_RETRIES = 2`) reportando el error de schema en el siguiente intento.
  - Windows stale element: 1 reintento automático tras refrescar el árbol de ventanas con `ui_get_window_tree` o similar.
  - Reconexión MCP: disponible por API vía `POST /api/mcp/:server/reconnect`.

## MCP

Servidores MCP configurados en `jarvis-config.json` y gestionados mediante procesos hijos por stdio:

| Servidor | Transporte | Tools expuestas | Config |
|----------|-----------|-----------------|--------|
| `windows` | Stdio (`uvx windows-mcp serve`) | 12 herramientas (automatización UI, ventanas, foco, clics, procesos) | `jarvis-config.json:windowsMcp` |
| `desktop_commander` | Stdio (`npx -y @wonderwhy-er/desktop-commander`) | 12 herramientas (archivos locales, comandos de consola, procesos) | `jarvis-config.json:desktopCommanderMcp` (soporta `allowedDirectories`) |
| `free_search` | Stdio (`uvx --from free-search-mcp==0.13.1 --with selectolax==0.3.34 free-search-mcp`) | 14 herramientas (búsqueda web, extracción estructurada, fetch, caché) | `jarvis-config.json:freeSearchMcp` |

## Procesamiento de resultados

Antes de devolver el resultado al orquestador y a los modelos, `ResultProcessor.process` aplica:

- **Aislamiento en `RefStore`:** El contenido bruto completo devuelto por la herramienta se almacena en memoria bajo una clave `rX` (ej. `r1`), aislada estrictamente por `taskId` para evitar fugas de memoria o colisiones entre tareas.
- **Detección de señales técnicas:** Identifica códigos de salida (`exit_code`), si el recurso no fue encontrado (`not_found`), si el acceso fue denegado (`denied`), si el elemento de UI quedó obsoleto (`stale_element`), si hubo timeout o si la salida fue vacía de forma anómala (`empty_output` evaluado solo en herramientas configuradas con `emptyIsError: true`: `desktop_commander:read_file`, `desktop_commander:search_files` y `free_search:search`).
- **Extractores deterministas por tool:**
  - *Árbol de ventanas:* extrae `window_handle` y `element_id` para scratchpad y facts; trunca la visualización a las primeras 30 líneas interactivas.
  - *Búsqueda de archivos:* extrae el conteo de coincidencias, la primera ruta para `facts.path` y hasta 5 candidatos; trunca a las 10 mejores coincidencias.
  - *Lectura de archivos:* extrae número de líneas y tamaño en KB; si supera 30 líneas, conserva solo las primeras 15 y últimas 15 con el indicador `[... N líneas omitidas, ref:rX]`.
  - *Procesos de consola:* extrae PID y status; trunca a las últimas 30 líneas de salida.
  - *Búsqueda web:* parsea resultados estructurados o secciones Markdown (Lead, títulos, URLs, snippets); extrae la primera URL y candidatos a facts; formatea los top 5 resultados.
- **Sanitización de memoria:** `sanitizeForMemory` elimina saltos de línea y caracteres de control ASCII (`[\x00-\x1F\x7F]`), sustituye etiquetas `<obs>` por `[obs]`, neutraliza prefijos reservados (`GOAL_`, `FACTS_`...) y recorta a 120 caracteres.
- **Formateo de Evidencia y Resumen estructurado:** Construye el objeto `Evidence` (con `summary`, `obs` recortado a 1.500 caracteres y `ref`) y sintetiza un prefijo para Decision #5 (`[ÉXITO]`, `[FALLO]`, `[VACÍO]`, `[SIN RESULTADOS]`, `[STALE]`).

## Permisos

Políticas de seguridad por categoría de herramienta definidas en `PolicyRegistry` y evaluadas en `Guard`:

| Categoría | Política | Ejemplo |
|-----------|----------|---------|
| `READ` / `FILE_READ` | Autorización automática (`ALLOW`) | `desktop_commander:read_file`, `list_directory`, `free_search:search`, `windows:ui_get_window_tree` |
| `UI_ACTION` | Autorización automática (`ALLOW`) sobre la interfaz gráfica de Windows | `windows:ui_click`, `windows:ui_type_text`, `windows:ui_set_focus`, `windows:set_volume` |
| `COMMAND_EXECUTION` | Inspección dinámica en `Guard.isSafeReadonlyCommand`: comandos de solo lectura en allowlist reciben `ALLOW`; comandos modificadores o desconocidos reciben `APPROVAL`; inyecciones reciben `DENY` | Comandos seguros: `dir`, `ls`, `cat`, `git status`, `node -v` (ALLOW) · Comandos con mutación: `npm install`, `rm`, `git commit` (APPROVAL) · Inyecciones: `; rm -rf /` (DENY) |
| `FILE_WRITE` | Requiere aprobación humana (`APPROVAL`) | `desktop_commander:write_file`, `desktop_commander:edit_file` |
| `FILE_DELETE` | Requiere aprobación humana (`APPROVAL`) | `desktop_commander:delete_file` |
| `PROCESS_CONTROL` | Requiere aprobación humana (`APPROVAL`) | `windows:launch_app`, `windows:close_window`, `desktop_commander:start_process`, `kill_process` |
| `DOWNLOAD` | Requiere aprobación humana (`APPROVAL`) | `free_search:download`, `free_search:download_document` |
| `CONFIGURATION` | Requiere aprobación humana (`APPROVAL`) | `desktop_commander:set_config` |
| Patrones destructivos raíz | Bloqueo incondicional (`DENY`) | Intentos contra el sistema raíz (`rm -rf /`, `format c:`, `del /f /s /q c:/windows`, etc.) |

> **Clasificación dinámica de herramientas no registradas:** Si un servidor MCP descubre una herramienta no mapeada estáticamente en `PolicyRegistry`, `getPolicy()` aplica una heurística determinista: si el nombre comienza con prefijos de lectura (`read`, `get`, `search`, `list`, `inspect`, `fetch`, etc.) y no contiene términos destructivos, se clasifica como `READ` con `ALLOW` automático (`mutates: false`). Si contiene palabras destructivas (`delete`, `remove`, `kill`, `exec`, `write`, `drop`, etc.), se clasifica como `COMMAND_EXECUTION` exigiendo `APPROVAL` humano (`mutates: true`).

## Aprobaciones

- **Flujo:** Cuando Guard dictamina `APPROVAL`, el paso actual se coloca en estado `WAITING_APPROVAL`, se genera un registro `PendingApproval` (con ID, tool, capacidad, argumentos y motivo descriptivo) y el orquestador emite el evento `APPROVAL_REQUESTED`. En la interfaz web, el componente persistente `GuardBanner` presenta los detalles de la acción junto a botones interactivos de "Autorizar" y "Rechazar" (con campo opcional de motivo). La interacción invoca `POST /api/jarvis/approve` o `POST /api/jarvis/deny`.
- **Alcance:** Por invocación única (una sola vez). No existe autorización permanente en sesión ni bypass global, garantizando que cada mutación o comando potencialmente peligroso sea evaluado individualmente.
- **Si se rechaza:** La llamada se bloquea, el paso pasa a estado `BLOCKED` con error "Operación rechazada por el usuario en Guard", se añade la entrada `${tool} -> RECHAZADO por usuario` a `task.memory.fail`, se asigna la señal `denied: true` y se activa el mecanismo de escalación (`handleEscalation` en FAST o replan en PLAN) para que el agente proponga una alternativa o aborte la tarea.

## Auditoría y logs

- **Consola del servidor Node.js:** Registro unificado de trazas con prefijos estructurados: `[Task] start`, `[Decision → SEND]`, `[Decision ← RECV]`, `[Qwen → SEND]`, `[Qwen ← RECV]`, `[MCP → SEND]`, `[MCP ← RECV]`, con duraciones en ms y detalles de tokens.
- **Memoria de tarea (`TaskMemory`):**
  - `log`: cada acción ejecutada se audita como `${stepSeq}|${tool}|${logStatus}|${finding}` (`logStatus` toma valores `ok`, `err`, `nf` o `unv`).
  - `fail`: registra motivos exactos de denegación o fallos lógicos (`${tool} -> motivo`).
- **Historial de llamadas (`task.steps[].calls[]`):** Cada ejecución se registra en un objeto `StepCall` con `id`, `mcp`, `tool`, `args`, `evidence` (`ok`, `summary`, `obs`, `ref`), `verification` (`VERIFIED`, `UNVERIFIED`), `outcome` (`success`, `isError`), `error` y `timestamp`.
- **Persistencia en disco:** Todas las tareas activas y las últimas 20 completadas se guardan en `jarvis-tasks.json`.
- **Stream de eventos en tiempo real:** Los eventos de auditoría (`MCP_DISPATCHED`, `MCP_RESULT`, `GUARD_EVALUATION`, `RESULT_PROCESSED`, `STEP_COMPLETED`) se transmiten por Server-Sent Events (`/api/jarvis/events`) y se visualizan en el componente `DecisionStream`.

## Archivos relacionados

| Ruta | Rol |
|------|-----|
| `src/core/policy/guard.ts` | Motor de compuerta de seguridad, verificación de reglas DENY e inspección dinámica de comandos seguros |
| `src/core/policy/policyRegistry.ts` | Mapeo determinista e inmutable de herramientas MCP a capacidades y tipos de acción (READ / no-READ) |
| `src/core/mcp/transport.ts` | Transporte stdio JSON-RPC 2.0, persistencia de procesos hijos, timeouts y terminación de árboles de procesos |
| `src/core/mcp/discovery.ts` | Motor de descubrimiento dinámico de herramientas y limpieza de esquemas de entrada (`cleanInputSchema`) |
| `src/core/processor/resultProcessor.ts` | Procesamiento determinista de salidas de herramientas, cálculo de señales de error y almacén `RefStore` |
| `src/core/callExecutor.ts` | Ejecución determinista de llamadas a herramientas, compuerta de aprobación y verificación anti-loop |
| `src/components/GuardBanner/GuardBanner.tsx` | Componente visual en el cliente web para la autorización y rechazo interactivo de operaciones sensibles |