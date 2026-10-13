# MCP Tools Snapshot

> Generado: **2026-10-12** · Servidor: `http://localhost:3000` · Método: `GET /api/mcp/:server/tools`
>
> Las tres consultas son salidas reales de `tools/list` por protocolo MCP/stdio.
> Los counts reales difieren de los documentados en `TOOLS_AND_SECURITY.md` (ver §Divergencias).

---

## 1. `windows` — Windows MCP (`uvx windows-mcp serve`)

**21 herramientas** (doc. dice 12 → **+9 no documentadas**)

| Tool | `readOnlyHint` | `destructiveHint` | Descripción breve |
|------|:-:|:-:|-------------------|
| `ControlStatus` | ✅ | ❌ | Estado del dueño del control de escritorio e idle wait |
| `App` | ❌ | ✅ | Abrir/iniciar/lanzar aplicaciones y gestionar ventanas |
| `DisplayInventory` | ✅ | ❌ | Leer layout de pantallas activas y metadata DPI |
| `PowerShell` | ❌ | ✅ | Ejecución de shell/comandos (cmd, terminal, scripts) |
| `FileSystem` | ❌ | ✅ | Operaciones de sistema de archivos (read/write/delete/copy/move/list/mkdir/info) |
| `Snapshot` | ✅ | ❌ | Screenshot + inspección de UI (árbol de accesibilidad) |
| `Screenshot` | ✅ | ❌ | Snapshot rápido de escritorio/ventana con posición de cursor |
| `Click` | ❌ | ✅ | Clic de ratón en coordenadas o elemento UI |
| `Type` | ❌ | ✅ | Tipeo de texto en coordenadas o elemento UI |
| `Scroll` | ❌ | ❌ | Scroll vertical/horizontal en coordenadas o elemento |
| `Move` | ❌ | ✅ | Mover cursor / drag-and-drop |
| `Shortcut` | ❌ | ✅ | Ejecutar combinaciones de teclado (ctrl+c, alt+tab…) |
| `Wait` | ✅ | ❌ | Pausa por duración específica |
| `WaitFor` | ✅ | ❌ | Espera hasta que una condición de UI se cumpla |
| `Scrape` | ✅ | ❌ | Fetch/scrape de página web por URL |
| `MultiSelect` | ❌ | ✅ | Selección múltiple de archivos/checkboxes (ctrl+clic) |
| `MultiEdit` | ❌ | ✅ | Entrada de texto en múltiples campos por coordenadas |
| `Clipboard` | ❌ | ❌ | Operaciones de portapapeles (get/set/cut) |
| `Process` | ❌ | ✅ | Listar y matar procesos (task manager) |
| `Notification` | ❌ | ✅ | Enviar notificación toast de Windows |
| `Registry` | ❌ | ✅ | Lectura/escritura del Registro de Windows (get/set/delete/list) |

> **Herramientas no mapeadas en PolicyRegistry** (heurística dinámica activa):
> `ControlStatus`, `DisplayInventory`, `PowerShell`, `FileSystem`, `Snapshot`, `Screenshot`, `Scroll`, `Move`, `Shortcut`, `Wait`, `WaitFor`, `Scrape`, `MultiSelect`, `MultiEdit`, `Clipboard`, `Process`, `Notification`, `Registry`
> — Las anotadas como `readOnlyHint=true` recibirán `ALLOW` automático; el resto recibirán `APPROVAL` por heurística.

---

## 2. `desktop_commander` — Desktop Commander (`npx -y @wonderwhy-er/desktop-commander`)

**26 herramientas** (doc. dice 12 → **+14 no documentadas**)

| Tool | `readOnlyHint` | `destructiveHint` | Descripción breve |
|------|:-:|:-:|-------------------|
| `get_config` | ✅ | — | Obtener configuración completa del servidor |
| `set_config_value` | ❌ | ✅ | Cambiar un valor específico de configuración |
| `read_file` | ✅ | — | Leer archivo o URL (soporta PDF, offset, length) |
| `read_multiple_files` | ✅ | — | Leer múltiples archivos en paralelo |
| `write_file` | ❌ | ✅ | Escribir/append a archivo |
| `write_pdf` | ❌ | ✅ | Crear o modificar un archivo PDF |
| `create_directory` | ❌ | ❌ | Crear directorio o asegurar su existencia |
| `list_directory` | ✅ | — | Listar archivos y subdirectorios |
| `move_file` | ❌ | ✅ | Mover o renombrar archivos/directorios |
| `start_search` | ✅ | — | Iniciar búsqueda en streaming (resultados progresivos) |
| `get_more_search_results` | ✅ | — | Paginación de búsqueda activa |
| `stop_search` | ❌ | ❌ | Detener búsqueda en curso |
| `list_searches` | ✅ | — | Listar búsquedas activas |
| `get_file_info` | ✅ | — | Metadata de archivo/directorio (tamaño, permisos, fechas) |
| `edit_block` | ❌ | ✅ | Edición quirúrgica de bloques en archivo existente |
| `start_process` | ❌ | ✅ | Iniciar proceso de terminal en segundo plano |
| `read_process_output` | ✅ | — | Leer salida de proceso en ejecución (paginación) |
| `interact_with_process` | ❌ | ✅ | Enviar stdin a proceso/REPL interactivo |
| `force_terminate` | ❌ | ✅ | Forzar terminación de sesión de terminal |
| `list_sessions` | ✅ | — | Listar sesiones de terminal activas |
| `list_processes` | ✅ | — | Listar procesos en ejecución |
| `kill_process` | ❌ | ✅ | Terminar proceso por PID |
| `get_usage_stats` | ✅ | — | Estadísticas de uso para debugging |
| `get_recent_tool_calls` | ✅ | — | Historial reciente de llamadas con args y salidas |
| `give_feedback_to_desktop_commander` | ❌ | — | Abrir formulario de feedback en navegador |
| `get_prompts` | ✅ | — | Recuperar prompt de onboarding por ID |

> **Herramientas no mapeadas en PolicyRegistry**: `read_multiple_files`, `write_pdf`, `create_directory`, `move_file`, `start_search`, `get_more_search_results`, `stop_search`, `list_searches`, `get_file_info`, `list_sessions`, `list_processes`, `get_usage_stats`, `get_recent_tool_calls`, `give_feedback_to_desktop_commander`, `get_prompts`
> — Heurística: `get_*`, `list_*`, `read_*`, `start_search` → `ALLOW`; `write_pdf`, `move_file`, `force_terminate`, `create_directory` → depende de nombre (ver §Permisos).

---

## 3. `free_search` — Free Search MCP (`uvx free-search-mcp==0.13.1`)

**11 herramientas** (doc. dice 14 → **−3 ausentes en runtime**: `fetch_page`, `read_cached_resource`, herramienta extra eliminada)

| Tool | `readOnlyHint` | `destructiveHint` | Descripción breve |
|------|:-:|:-:|-------------------|
| `search` | ✅ | — | Búsqueda web multi-motor, lista deduplicada |
| `fetch` | ✅ | — | Fetch de una URL (HTML→Markdown, PDFs, imágenes) |
| `fetch_batch` | ✅ | — | Fetch paralelo de múltiples URLs |
| `read_doc` | ✅ | — | Leer doc remoto (PDF, DOCX) en Markdown |
| `research` | ✅ | — | Investigación iterativa: buscar + fetch resultados |
| `paper_graph` | ✅ | — | Seguir citaciones de paper académico |
| `cache_search` | ✅ | — | Búsqueda full-text sobre índice SQLite local (FTS5) |
| `engines` | ✅ | — | Listar motores de búsqueda disponibles |
| `compare` | ✅ | — | Fetch 2-5 URLs en paralelo y comparar contra pregunta |
| `extract_structured` | ✅ | — | Extraer JSON-LD, OpenGraph, microdata de página web |
| `download` | ❌ | — | Descargar archivo binario/documento a directorio local |

> `download` mantiene `readOnlyHint=false` → política `DOWNLOAD` → `APPROVAL`.
> `fetch_page` (alias) y `read_cached_resource` documentadas en PolicyRegistry ya no existen en esta versión.

---

## 4. Tabla de permisos vigente (PolicyRegistry + Guard)

> Fuente: `docs/TOOLS_AND_SECURITY.md` §Permisos — revisión 2026-10-11
> Archivo: `src/core/policy/policyRegistry.ts` + `src/core/policy/guard.ts`

| Categoría | Política Guard | Ejemplos canónicos |
|-----------|:--------------:|--------------------|
| `READ` / `FILE_READ` | **ALLOW** | `desktop_commander:read_file`, `list_directory`, `free_search:search`, `windows:ui_get_window_tree` |
| `UI_ACTION` | **ALLOW** | `windows:ui_click`, `windows:ui_type_text`, `windows:ui_set_focus`, `windows:set_volume` |
| `COMMAND_EXECUTION` — allowlist read-only | **ALLOW** | `dir`, `ls`, `cat`, `git status`, `node -v` |
| `COMMAND_EXECUTION` — mutación / desconocido | **APPROVAL** | `npm install`, `rm`, `git commit` |
| `COMMAND_EXECUTION` — inyección detectada | **DENY** | `; rm -rf /`, `\| del /f` |
| `FILE_WRITE` | **APPROVAL** | `desktop_commander:write_file`, `desktop_commander:edit_file` |
| `FILE_DELETE` | **APPROVAL** | `desktop_commander:delete_file` |
| `PROCESS_CONTROL` | **APPROVAL** | `windows:launch_app`, `windows:close_window`, `desktop_commander:start_process`, `kill_process` |
| `DOWNLOAD` | **APPROVAL** | `free_search:download` |
| `CONFIGURATION` | **APPROVAL** | `desktop_commander:set_config` |
| Patrones destructivos raíz | **DENY** incondicional | `rm -rf /`, `format c:`, `del /f /s /q c:/windows` |

### Heurística para herramientas no registradas

Si un MCP expone una tool no mapeada en `PolicyRegistry`, `getPolicy()` aplica automáticamente:

- **→ `READ` / `ALLOW`**: nombre empieza con `read`, `get`, `search`, `list`, `inspect`, `fetch`, `scrape`, `cache` y **no** contiene términos destructivos.
- **→ `COMMAND_EXECUTION` / `APPROVAL`**: nombre contiene `delete`, `remove`, `kill`, `exec`, `write`, `drop`, `terminate`, `force`, `move` o es desconocido con `mutates: true`.

---

## 5. Divergencias vs. `docs/TOOLS_AND_SECURITY.md`

| Servidor | Conteo doc. | Conteo real | Δ | Observación |
|----------|:-----------:|:-----------:|:-:|-------------|
| `windows` | 12 | **21** | +9 | El set `ui_*` documentado no existe; reemplazado por `Snapshot`, `Click`, `Type`, `WaitFor`, `PowerShell`, `FileSystem`, `Clipboard`, `Process`, `Notification`, `Registry`, etc. |
| `desktop_commander` | 12 | **26** | +14 | `search_files` → `start_search` + paginación; `delete_file` ausente; `write_pdf`, `move_file`, `create_directory`, `edit_block` (reemplaza `edit_file`) agregadas |
| `free_search` | 14 | **11** | −3 | `fetch_page` y `read_cached_resource` eliminadas; conteo neto menor |

> **Impacto de seguridad:** Las herramientas nuevas de `windows` (`PowerShell`, `FileSystem`, `Registry`, `Process`) son de alto riesgo y actualmente caen bajo heurística, no bajo política estática. `PolicyRegistry` debería actualizarse para mapearlas explícitamente con categoría `COMMAND_EXECUTION` / `FILE_WRITE` / `PROCESS_CONTROL` y requerir `APPROVAL`.
