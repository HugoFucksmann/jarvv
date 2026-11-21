# Herramientas y Catálogo

JARVIS expone un catálogo cerrado (`src/core/tools/manifest.ts`) repartido en **6 rutas** (`EXECUTABLE_ROUTES`: `terminal`, `files_read`, `files_write`, `system`, `multimedia`, `web`), combinando el servidor MCP por stdio `free_search` y proveedores nativos en proceso (`jarvis_terminal`, `jarvis_files_read`, `jarvis_files_write`, `jarvis_system`, `jarvis_multimedia`, `jarvis_web` en `src/tools/`). Los grupos siguen `JARVIS_TOOLS_Y_GRUPOS_revisado.md`; el grupo `personal` (`email`, `calendar`) todavía no existe.

## 1. Catálogo vigente

| Ruta (D1) | Servidor | Herramientas visibles (D2) | Notas clave |
|---|---|---|---|
| `files_read` | `jarvis_files_read` (nativo) | `find_files`, `list_folder`, `search_content`, `read_file` | Solo lectura, sin confirmación. `path` acepta rutas absolutas y los alias `home`, `desktop`, `documents`, `downloads`. `read_file` lee texto por líneas (`offset`, `limit`); PDF, Office e imágenes requieren un driver que aún no está conectado |
| `files_write` | `jarvis_files_write` (nativo) | `write_file`, `edit_file`, `convert_file`, `create_folder`, `copy_file`, `move_file`, `delete_file`, `archive_files` | Cada una con su regla de nivel (`policy/tiers.ts`), su poscondición de disco (`engine/postcondition.ts`) y, si escribe en una ruta, su destino (`tools/toolTargets.ts`). `move_file` recibe `items: [{ source, destination }]` y `archive_files` recibe `sources`; el motor mira las rutas dentro de esos lotes (`policy/pathArgs.ts`) |
| `system` | `jarvis_system` (nativo) | `system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen`, `clipboard` | `system_info` absorbe los procesos (`section: processes`), los puertos, la red y la fecha. Niveles: leer es verde; cambiar un ajuste, bloquear, suspender, escribir el portapapeles y abrir una app son amarillos; reiniciar, apagar y cortar procesos son rojos. `open_on_screen` no devuelve contenido: para leer un archivo se usa `read_file` |
| `multimedia` | `jarvis_multimedia` (nativo) | `play_media`, `media_control` | Reproducir y controlar música y video (YouTube, Spotify). Son `PROCESS_CONTROL` con nivel verde: no piden confirmación con los niveles encendidos, y no dejan nada en el disco |
| `terminal` | `jarvis_terminal` (nativo) | `run_command` | Solo Windows/PowerShell; ver detalle operativo en [`../operacion/WINDOWS_TERMINAL.md`](../operacion/WINDOWS_TERMINAL.md) |
| `web` | `jarvis_web` (nativo) | `web_search`, `download_file` | Búsqueda y lectura web (usa internamente `free_search`: `search`, `fetch`, `read_doc`) y descarga de un archivo desde una URL `http(s)` con protección SSRF. `download_file` es `DOWNLOAD`: nunca verde, y su URL pasa por `policy/egress.ts` |

Además, `SYSTEM_TOOL_MANIFEST` declara entradas `internal: true`:
- `free_search` (`search`, `fetch`, `read_doc`): usadas internamente por `web_search`.

### Política de las tools que modifican

Toda tool que modifica el sistema pasa por las mismas capas, en este orden: Guard (DENY: patrones destructivos, regla B de las carpetas protegidas, `policy/toolRules.ts` en su nivel `guard`) → lista de reglas (blocked y sensitive: las reglas de comando de `commandRules.ts` para `run_command`, las de `toolRules.ts` para las nativas, y la lista de `jarvis-config.json`) → pre-chequeo → `allowedDirectories` → confirmación del usuario → Decisión 3 → ejecución → verificación (poscondición en el disco por código y, si no hay nada que mirar, Decisión 4).

`policy/toolRules.ts` da a las nativas la misma clasificación que su comando equivalente: `power` shutdown y restart son blocked (como `shutdown`); `delete_file` de una raíz de disco o de Windows es guard, y de una carpeta del sistema o personal entera es blocked; descargar, escribir, copiar, mover o convertir un script o un ejecutable es sensitive.

Efecto de cada nivel: blocked se rechaza con modo automático o con niveles (`tool_rejected`, sin cerrar la tarea) y se le pregunta al usuario sin ellos; sensitive lo decide Decisión 3 con el umbral estricto (0,65) en modo automático y, con niveles, además se le pregunta al usuario. Niveles de aprobación: verde sin confirmación ni Decisión 3, amarillo con Decisión 3 estricta (y confirmación sin modo automático), rojo siempre confirma el usuario. `tests/native_policy_matrix.test.ts` recorre estas combinaciones con proveedores reales.

## 2. Contrato e infraestructura (`src/core/tools/`)

- **`ToolProvider` (`provider.ts`)**: contrato único que implementa tanto cada servidor MCP como cada proveedor nativo (`callTool(name, args, { signal, timeoutMs, taskId, host })` y `onTaskEnd(taskId, outcome)`).
- **`ToolHost` (`host.ts`)**: pasarela inyectada a herramientas compuestas; solo permite invocar las `dependencies` declaradas y registra cada sub-llamada en la traza.
- **Resultado estructurado (`result.ts`, `extractors/structured.ts`)**: los proveedores nativos devuelven `structuredContent` y `_meta` con `schema: 1` (`text` para el modelo, `raw` para ref, `data` y `meta` para señales del motor y traza). `data.truncated` (booleano) indica si el proveedor recortó contenido: solo entonces se crea una ref; si falta, el extractor compara `raw` con `text` (`web_search`). Las refs son solo para depurar y para el pre-chequeo.
- **Orden y sondas**: `sortByCatalog` fija el orden de opciones en D2; `probesOf` asocia sondas de verificación (`tools/probes.ts`) a una herramienta; hoy ninguna las declara.
- **Política de repetición (`repeatPolicyOf`)**: `strict` por defecto, `retry_failed` (`web_search` y las búsquedas y listados de `files_read`), `allow` (continuación `{ pid }` en `run_command`) o `rerun` (comandos de comprobación/compilación en `policy/rerun.ts`).

## 3. Pipeline de `web_search` (`src/tools/web/`)

Busca en internet o lee hasta 5 URLs explícitas y devuelve fragmentos **literales** con fuentes y fechas (sin síntesis generativa dentro de la tool).

- **Argumentos**: `need` (pregunta directa, máx. 300 chars), `urls` (hasta 5 HTTP/HTTPS), `freshness` (`day`/`week`/`month`/`year`), `domains` (hasta 5). Plazo del catálogo: `150 s` (`145 s` efectivos internos).
- **Flujo**:
  1. Llama a `free_search:search` en JSON (8 resultados, `max_age_hours: 24`, filtros opcionales). Si recibió `urls`, pasa directo a `fetch`.
  2. Si `webSearchUseJudge` está activo (`config.ts`), `Decision20Engine` (`FragmentJudge`) puntúa los extractos viendo `TODAY`. Si alguno alcanza `0.5` (`found`, `JUDGE_FOUND`), devuelve hasta 3 sin bajar páginas.
  3. Si ninguno responde, lee **una página por vez** (`fetch`, máx. 3), limpia HTML/navegación, parte en fragmentos de 500–800 caracteres, BM25 elige 6 candidatos y el 2B los puntúa (corte al alcanzar `found`). Como último recurso ante páginas truncadas (~50 000 chars), lee tramos con `read_doc` (hasta 12).
  4. **Sin juez (`webSearchUseJudge: false` o fallo/timeout de 20 s)**: lee hasta 3 páginas y ordena por cobertura léxica (BM25); estado máximo `partial` (≥ 0.34), nunca `found`.
  5. Si con filtros no hubo material, reintenta una vez sin filtros y avisa en el texto.
- **Guardas**:
  - **Versión (`guardVersions`)**: si `need` menciona una versión `X.Y.Z` ausente en el fragmento, limita la probabilidad por debajo de `found`.
  - **Fechas**: lista `Sources: [n] título — url (dated AAAA-MM-DD)` indicando la fecha de página o snippet.
  - **Seguridad (`policy/egress.ts`)**: rechaza URLs locales/internas o con credenciales y exige confirmación humana obligatoria (aun con `autoMode`) si la consulta contiene rutas de usuario o posibles secretos/tokens.
- **Referencias MCP y pendientes**: detalle de `free-search-mcp` en [`../operacion/free_search_mcp.md`](../operacion/free_search_mcp.md); limitaciones abiertas (multiparte, recencia, calibración) en [`../pendientes/PENDIENTES_EVAL.md`](../pendientes/PENDIENTES_EVAL.md) y, para las herramientas nativas planeadas, en [`../pendientes/PENDIENTES_CODIGO.md`](../pendientes/PENDIENTES_CODIGO.md).
