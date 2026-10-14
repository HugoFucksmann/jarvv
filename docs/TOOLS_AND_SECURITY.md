# Herramientas y Seguridad en JARVIS Core

> Última revisión: **2026-10-13** (v1.3 — Manifiesto Tipado de 61 Herramientas, Guard sobre Argumentos Resueltos y Argmax Eos)

JARVIS Core se integra con tres servidores de herramientas a través del protocolo **Model Context Protocol (MCP)** sobre transporte `stdio` persistente:
- **Windows MCP (`windows`)**: 21 herramientas de automatización de interfaz gráfica, controles UIA, procesos y registros.
- **Desktop Commander (`desktop_commander`)**: 26 herramientas de manipulación de archivos locales, procesos de consola y terminal interactivo.
- **Free Search MCP (`free_search`)**: 11 herramientas de búsqueda web, lectura de documentos remotos, análisis estructurado y descargas.
- **Herramientas Locales Internas (`local`)**: 3 herramientas deterministas (`recall`, `compose`, `ask_user`) integradas en el Core sin transporte externo.

La seguridad del sistema está completamente desacoplada de los modelos probabilísticos LLM: se rige mediante un registro tipado de políticas (`PolicyRegistry` poblado desde `SYSTEM_TOOL_MANIFEST`), un resolutor determinista de referencias (`RefResolver`) y una compuerta estricta de seguridad (`Guard`) que bloquea comandos destructivos (`DENY`), autoriza autónomamente inspecciones seguras (`ALLOW`) y suspende la ejecución sin temporizadores de expiración ante mutaciones sensibles (`APPROVAL`).

---

## 1. Catálogo Completo de Herramientas y Políticas de Seguridad

Fuente única de verdad: `SYSTEM_TOOL_MANIFEST` (`src/core/tools/manifest.ts`):

### 1.1 Windows MCP (`windows`) — 21 Herramientas en Runtime
| Herramienta | Capacidad | Riesgo / Tipo | Política Guard | Descripción Operativa |
|---|:---:|:---:|:---:|---|
| `ControlStatus` | `READ` | Bajo (READ) | `ALLOW` | Estado del dueño del control de escritorio e idle wait. |
| `DisplayInventory` | `READ` | Bajo (READ) | `ALLOW` | Layout de pantallas activas y metadatos de escala DPI. |
| `Snapshot` | `READ` | Bajo (READ) | `ALLOW` | Captura de accesibilidad del árbol visual de ventanas. |
| `Screenshot` | `READ` | Bajo (READ) | `ALLOW` | Captura rápida de pantalla en formato gráfico. |
| `Scrape` | `READ` | Bajo (READ) | `ALLOW` | Extracción estructurada de texto visible en pantalla. |
| `Clipboard` | `READ` | Bajo (READ) | `ALLOW` | Lectura del portapapeles del sistema operativo. |
| `Process` | `READ` | Bajo (READ) | `ALLOW` | Enumeración de procesos y ventanas activas de Windows. |
| `Registry` | `READ` | Bajo (READ) | `ALLOW` | Consulta e inspección de claves del registro de Windows. |
| `Click` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Clic de ratón sobre elemento de interfaz o coordenadas. |
| `Type` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Tipeo de texto simulado en el control con foco. |
| `Scroll` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Desplazamiento vertical u horizontal de rueda de ratón. |
| `Move` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Movimiento de cursor o acción de arrastrar y soltar. |
| `Shortcut` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Combinación de teclas de acceso rápido (ej. Ctrl+C). |
| `Wait` | `UI_ACTION` | Bajo (READ, exenta) | `ALLOW` | Pausa controlada o espera activa de sincronización. |
| `WaitFor` | `UI_ACTION` | Bajo (READ, exenta) | `ALLOW` | Espera reactiva a que un elemento visual aparezca. |
| `MultiSelect` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Selección múltiple de elementos interactivos. |
| `MultiEdit` | `UI_ACTION` | Medio (no-READ) | `ALLOW` | Edición múltiple de campos de formulario. |
| `App` | `PROCESS_CONTROL` | Alto (no-READ) | `APPROVAL` | Lanzar o cerrar aplicaciones ejecutables de Windows. |
| `PowerShell` | `COMMAND_EXECUTION` | Dinámico / Alto | `APPROVAL` / `DENY` | Ejecución de scripts PowerShell y comandos terminal. |
| `FileSystem` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Operaciones de sistema de archivos en Windows. |
| `Notification` | `UI_ACTION` | Medio (no-READ) | `APPROVAL` | Emisión o gestión de notificaciones nativas de Windows. |

### 1.2 Desktop Commander (`desktop_commander`) — 26 Herramientas en Runtime
| Herramienta | Capacidad | Riesgo / Tipo | Política Guard | Descripción Operativa |
|---|:---:|:---:|:---:|---|
| `list_directory` | `FILE_READ` | Bajo (READ) | `ALLOW` | Enumerar archivos y carpetas locales. |
| `read_file` | `FILE_READ` | Bajo (READ) | `ALLOW` | Leer contenido de un archivo (con offset y length). |
| `search_files` | `FILE_READ` | Bajo (READ) | `ALLOW` | Buscar archivos por patrón o nombre en el disco. |
| `read_process_output`| `READ` | Bajo (READ, exenta) | `ALLOW` | Leer salida generada por un proceso de terminal. |
| `get_file_info` | `FILE_READ` | Bajo (READ) | `ALLOW` | Metadatos y tamaño de archivo local. |
| `read_multiple_files`| `FILE_READ` | Bajo (READ) | `ALLOW` | Lectura en lote de múltiples archivos. |
| `start_search` | `FILE_READ` | Bajo (READ) | `ALLOW` | Iniciar búsqueda indexada en segundo plano. |
| `get_more_search_results`| `FILE_READ` | Bajo (READ) | `ALLOW` | Obtener más resultados de búsqueda activa. |
| `stop_search` | `FILE_READ` | Bajo (READ) | `ALLOW` | Detener búsqueda activa en segundo plano. |
| `list_searches` | `FILE_READ` | Bajo (READ) | `ALLOW` | Listar búsquedas en segundo plano activas. |
| `list_processes` | `READ` | Bajo (READ) | `ALLOW` | Listar procesos del sistema en ejecución. |
| `list_sessions` | `READ` | Bajo (READ) | `ALLOW` | Listar sesiones de terminal abiertas. |
| `run_command` | `COMMAND_EXECUTION` | Dinámico | Inspección Guard | Ejecución de comandos en consola (inspección de shell). |
| `write_file` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Crear o sobreescribir archivo local en disco. |
| `edit_file` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Modificar archivo local existente. |
| `edit_block` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Modificar bloque específico de texto en archivo. |
| `delete_file` | `FILE_DELETE` | Crítico (no-READ) | `APPROVAL` | Eliminar de forma destructiva y permanente un archivo. |
| `create_directory` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Crear un nuevo directorio en el disco. |
| `move_file` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Mover o renombrar archivo o directorio. |
| `write_pdf` | `FILE_WRITE` | Alto (no-READ) | `APPROVAL` | Generar y escribir documento PDF en disco. |
| `start_process` | `PROCESS_CONTROL` | Alto (no-READ) | `APPROVAL` | Iniciar proceso de consola en segundo plano. |
| `kill_process` | `PROCESS_CONTROL` | Alto (no-READ) | `APPROVAL` | Finalizar un proceso por su PID. |
| `force_terminate` | `PROCESS_CONTROL` | Alto (no-READ) | `APPROVAL` | Terminación forzada e inmediata de un proceso. |
| `interact_process` | `PROCESS_CONTROL` | Alto (no-READ) | `APPROVAL` | Enviar entradas interactivas por stdin a proceso. |
| `set_config` | `CONFIGURATION` | Alto (no-READ) | `APPROVAL` | Modificar configuración del servidor MCP. |
| `get_config` | `CONFIGURATION` | Bajo (READ) | `ALLOW` | Consultar configuración activa del servidor MCP. |

### 1.3 Free Search MCP (`free_search`) — 11 Herramientas en Runtime (v0.13.1)
| Herramienta | Capacidad | Riesgo / Tipo | Política Guard | Descripción Operativa |
|---|:---:|:---:|:---:|---|
| `search` | `READ` | Bajo (READ) | `ALLOW` | Búsqueda web multi-motor con snippets limpios. |
| `fetch` | `READ` | Bajo (READ) | `ALLOW` | Descargar y convertir página web a Markdown limpio. |
| `fetch_batch` | `READ` | Bajo (READ) | `ALLOW` | Descargar múltiples páginas web en paralelo. |
| `read_doc` | `READ` | Bajo (READ) | `ALLOW` | Leer y parsear documento remoto (PDF, DOCX) a Markdown. |
| `research` | `READ` | Bajo (READ) | `ALLOW` | Investigación web iterativa en profundidad. |
| `paper_graph` | `READ` | Bajo (READ) | `ALLOW` | Explorar grafos de citas y papers académicos. |
| `cache_search` | `READ` | Bajo (READ) | `ALLOW` | Búsqueda full-text en caché local SQLite FTS5. |
| `engines` | `READ` | Bajo (READ) | `ALLOW` | Listar motores de búsqueda disponibles y activos. |
| `compare` | `READ` | Bajo (READ) | `ALLOW` | Comparar contenido de 2 a 5 páginas web. |
| `extract_structured`| `READ` | Bajo (READ) | `ALLOW` | Extraer microdatos, OpenGraph y JSON-LD. |
| `download` | `DOWNLOAD` | Alto (no-READ) | `APPROVAL` | Descargar archivo binario o documento a directorio local. |

> **Certificación de Ausencia:** Las herramientas deprecadas `fetch_page` y `read_cached_resource` fueron retiradas formalmente del sistema al confirmar que no existen upstream en la versión 0.13.1.

### 1.4 Herramientas Locales Internas (`local`) — 3 Herramientas
| Herramienta | Capacidad | Riesgo / Tipo | Política Guard | Descripción Operativa |
|---|:---:|:---:|:---:|---|
| `recall` | `READ` | Bajo (READ) | `ALLOW` | Recuperar hechos factuales, referencias o contexto de memoria. |
| `compose` | `READ` | Bajo (READ) | `ALLOW` | Redactar texto estructurado o respuesta en lenguaje natural. |
| `ask_user` | `READ` | Bajo (READ) | `ALLOW` | Solicitar aclaración indispensable al usuario (`user_answer`). |

---

## 2. Compuerta de Seguridad Guard e Inspección Dinámica

`Guard` (`src/core/policy/guard.ts`) actúa como barrera determinista e inmutable antes del despacho físico a cualquier servidor:

```
[Qwen genera args] ──► [RefResolver sustituye {{ref:rX}}] ──► [Guard.evaluate(mcp, tool, args_resueltos)]
                                                                               │
                          ┌────────────────────────────────────────────────────┼────────────────────────────────────────────────────┐
                          ▼                                                    ▼                                                    ▼
                       [ALLOW]                                             [APPROVAL]                                             [DENY]
             Operación de lectura segura                         Mutación de disco/procesos                         Patrón destructivo raíz
             o comando en allowlist                              o comando terminal modificador                     o inyección maliciosa
                          │                                                    │                                                    │
                          ▼                                                    ▼                                                    ▼
                   [Despacho stdio]                               [Pausa: WAITING_INPUT approval]                    [Paso BLOCKED: signals.denied=true]
                                                                  (Sin temporizador de caducidad)                   [Parada inmediata sin reintentos]
```

### 2.1 Inspección Dinámica de Comandos de Terminal (`run_command`)
Para herramientas de consola como `desktop_commander:run_command` y `windows:PowerShell`, Guard analiza los argumentos ya desempaquetados por `RefResolver`:
1. **Detección de Patrones Destructivos (`DENY`):**
   - Bloqueo incondicional de comandos dirigidos contra el sistema raíz o directorios críticos: `rm -rf /`, `format c:`, `del /f /s /q c:\windows`, `drop database`, o secuencias de escape/inyección `; rm`, `&& rm`, `| rm`.
   - Transiciona el paso inmediatamente a `BLOCKED` con la señal `signals.denied = true`.
   - **Prohibición absoluta:** Ningún reintento ni replanificación puede eludir una denegación de seguridad.
2. **Inspección de Comandos Seguros (`ALLOW`):**
   - Comandos de solo lectura verificados en allowlist (`dir`, `ls`, `cat`, `type`, `git status`, `git log`, `node -v`, `npm list`, etc.) sin operadores de concatenación ni redirección destructiva (`>`, `>>`, `|`) se autorizan autónomamente sin interrumpir al usuario.
3. **Comandos Modificadores (`APPROVAL`):**
   - Comandos que alteran el entorno (`git commit`, `npm install`, `cp`, `mv`, compilaciones, scripts de PowerShell) suspenden la tarea en `WAITING_INPUT` (`waitingReason: "approval"`).

---

## 3. Estado `WAITING_INPUT` sin Temporizadores de Expiración

Conforme al Criterio de Aceptación 10 del Plan Maestro v1.3:
- Las esperas por autorización humana operan mediante una promesa suspendida en memoria de Node.js.
- **Sin Timers:** No existen cronómetros de cuenta regresiva, `setTimeout` ni expiraciones automáticas. La tarea aguarda indefinidamente la acción voluntaria del operador.
- **Acciones Disponibles:**
  - `POST /api/jarvis/approve`: reanuda inmediatamente la ejecución de la llamada aprobada.
  - `POST /api/jarvis/deny`: marca el paso como `BLOCKED`, fija `signals.denied = true` y detiene la tarea en `PARTIAL`/`FAILED`.
  - `POST /api/jarvis/cancel`: transiciona la tarea a `CANCELLED` y limpia la memoria.

---

## 4. Selección y Verificación de Herramientas con Eos

- **Selección de Herramienta en Runtime:**
  - Si un subsistema cuenta con un único candidato disponible (`discoveredTools.length === 1`), se adopta directamente con confianza 1.0 (0 ms de latencia sin llamada HTTP).
  - Si existen múltiples candidatos válidos, se consulta a Decision 2.0 (`evaluateDecisionTwo`), resolviendo la herramienta con mayor probabilidad (argmax) sin umbrales arbitrarios de corte.
- **Verificación Factual (`ok` / `cumple`):**
  - Decision #5 fue totalmente retirada.
  - Sobre señales físicas limpias (`isCleanSignals`), Eos evalúa binariamente la corrección técnica (`ok`) y el cumplimiento de la expectativa (`cumple`) con un criterio determinista de argmax ($p \ge 0.5$).
  - Si el servicio local de Eos no se encuentra disponible pero las señales físicas son limpias, se aplica un fallback determinista a éxito para garantizar la continuidad operativa.
