# Herramientas y Catálogo

JARVIS expone un catálogo cerrado (`src/core/tools/manifest.ts`) de **12 herramientas** repartidas en **4 rutas** (`EXECUTABLE_ROUTES`), combinando servidores MCP por stdio (`desktop_commander`, `free_search`) y proveedores nativos en proceso (`jarvis_terminal`, `jarvis_web` en `src/tools/`).

## 1. Catálogo vigente

| Ruta (D1) | Servidor | Herramientas visibles (D2) | Notas clave |
|---|---|---|---|
| `files` | `desktop_commander` | `read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file` | Archivos y carpetas locales con ruta conocida. `list_directory` solo devuelve nombres (sin tamaños ni fechas) |
| `locate` | `desktop_commander` | `start_search`, `get_more_search_results` | Búsqueda por nombre o contenido. `get_more_search_results` requiere búsqueda activa (`requires: "search"`) |
| `terminal` | `jarvis_terminal` (nativo) | `run_command`, `list_processes`, `stop_process` | Solo Windows/PowerShell; ver detalle operativo en [`../operacion/WINDOWS_TERMINAL.md`](../operacion/WINDOWS_TERMINAL.md) |
| `web` | `jarvis_web` (nativo) | `web_search` | Búsqueda y lectura web; usa internamente `free_search` (`search`, `fetch`, `read_doc`) |

Además, `SYSTEM_TOOL_MANIFEST` declara entradas `internal: true` para `free_search` (`search`, `fetch`, `read_doc`): tienen política en Guard, pero no se ofrecen a D1, D2 ni al planificador.

## 2. Contrato e infraestructura (`src/core/tools/`)

- **`ToolProvider` (`provider.ts`)**: contrato único que implementa tanto cada servidor MCP como cada proveedor nativo (`callTool(name, args, { signal, timeoutMs, taskId, host })` y `onTaskEnd(taskId, outcome)`).
- **`ToolHost` (`host.ts`)**: pasarela inyectada a herramientas compuestas; solo permite invocar las `dependencies` declaradas y registra cada sub-llamada en la traza.
- **Resultado estructurado (`result.ts`, `extractors/structured.ts`)**: los proveedores nativos devuelven `structuredContent` y `_meta` con `schema: 1` (`text` para el modelo, `raw` para ref, `data` y `meta` para señales del motor y traza). `data.truncated` (booleano) indica si el proveedor recortó contenido: solo entonces se crea una ref; si falta, el extractor compara `raw` con `text` (`web_search`). Las refs son solo para depurar y para el pre-chequeo.
- **Orden y sondas**: `sortByCatalog` fija el orden de opciones en D2; `probesOf` asocia sondas de verificación (`tools/probes.ts`) a `write_file`, `create_directory`, `move_file`, `read_file` (Excel), `start_search` y `list_directory`.
- **Política de repetición (`repeatPolicyOf`)**: `strict` por defecto, `retry_failed` (`web_search`), `allow` (`get_more_search_results` y continuación `{ pid }` en `run_command`) o `rerun` (comandos de comprobación/compilación en `policy/rerun.ts`).

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
