# Ficha: herramientas nativas de archivos y sistema (etapa 1)

Para quien implemente las herramientas. Complementa [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md) §3 (P1 y P6) y la idea de «recetas» de §8. Es la **etapa 1** de dos: agregar las nativas, probarlas y dejarlas **sin exponer a D1 ni D2**. La etapa 2 (redistribuir rutas, descripciones de D2, datasets de `eval/`, apagar la búsqueda de Desktop Commander) se decide después, con estas tools ya probadas.

## 1. Alcance de la etapa 1

| Sí | No |
|---|---|
| 3 herramientas **de solo lectura**: `find_files`, `list_folder`, `system_info` | Escrituras (copiar, borrar, editar): van después, piden filas en `tiers`, poscondiciones y sondas |
| Proveedor nuevo `jarvis_files` en `src/tools/files/` | Tocar D1, D2, prompts, umbrales o el flujo del motor |
| Registradas como **internas** (el motor no las ofrece a ningún modelo) | Apagar o cambiar Desktop Commander: sigue sirviendo `files` y `locate` |
| Pruebas automáticas y una prueba manual por `/api/mcp/jarvis_files/call` | Leer PDF o Excel (sigue siendo `read_file` de Desktop Commander) |

Nombres: **no pueden coincidir con los de ninguna otra herramienta del catálogo** (lo exige `tests/tool_specs.test.ts`). Por eso no se llama `list_directory`, que ya existe en Desktop Commander.

## 2. Por qué: lo que se midió de `start_search` (Desktop Commander)

Probado directamente contra el servidor (`start_search` + `get_more_search_results`), con archivos y carpetas que existen:

| Qué se busca | Resultado |
|---|---|
| Archivo por nombre (`package.json`, `REFACTOR_CORE`) | lo encuentra |
| Comodín `*.md` | 30 resultados |
| **Una carpeta por nombre** (`jarvv` en `E:\colo`; `arquitectura` dentro de `docs`) | **0 resultados**, aunque existe. Solo compara nombres de archivo |
| Varias extensiones con regex (`\.md\|\.json`) o con comodín (`*.md\|*.json`) | **0 resultados**. Dice aceptar regex y no es cierto |
| `.md` o `\.md` | 0 resultados (solo funciona `*.md`) |
| Buscar en todo el home | tarda segundos; la primera respuesta es `RUNNING 0 matches` y la segunda `COMPLETED No matches ⏱️ Stopped after 1500 ms: results may be incomplete`, que el modelo lee como «no está» |
| Descripción que ve el modelo | solo «Start a streaming file search.» y un schema sin descripciones de parámetros |

Consecuencias que las nativas deben evitar: no hallar carpetas, no entender patrones, dos llamadas para obtener un resultado, y **confundir «no encontré» con «no terminé de buscar»**. Un 2B repite las mismas llamadas, así que la herramienta tiene que ser difícil de usar mal.

## 3. Lo que hay que saber del repo

**Contrato del proveedor** ([`src/core/tools/provider.ts`](../../src/core/tools/provider.ts)): `ToolProvider` con `name`, `version`, `listTools()`, `callTool(name, args, options)`, `isConnected()`, `reconnect()`. `options` trae `signal` (cancelación: dejar de trabajar), `timeoutMs` (plazo del manifiesto) y `taskId`. Ejemplos a copiar: [`src/tools/web/webSearchProvider.ts`](../../src/tools/web/webSearchProvider.ts) (solo lectura, un archivo) y [`src/tools/terminal/`](../../src/tools/terminal/).

**Dependencias permitidas** (las verifica `tests/architecture.test.ts`): `src/tools/files/` solo importa del núcleo tipos, utilidades, contratos y `core/policy/`. **Nunca** `core/engine`, `core/models`, `core/ctx`, `core/trace`, ni otra carpeta de `src/tools/`.

**Resultado** ([`src/core/tools/result.ts`](../../src/core/tools/result.ts)): `toolResult({ text, raw, data, meta?, isError? })`.
- `text`: lo que ve el modelo. Corto: el motor lo recorta a 2500 caracteres.
- `raw`: el resultado completo. Si es distinto de `text`, el motor lo guarda en una ref en disco. Poner `data.truncated` (booleano) para decirlo explícitamente.
- `data`: señales que lee el motor. La que importa: `data.state = "no_results"` o `"not_found"` marca «buscó y no halló» y la verificación lo trata como sin datos. **Usar `no_results` solo si el recorrido fue completo** (ver §4.1).
- `meta`: diagnóstico para la traza; nunca llega a los modelos.
- `isError: true` solo si la herramienta no pudo hacer lo pedido (argumento inválido, fallo propio). Una carpeta sin resultados no es un error.

**Catálogo** ([`src/core/tools/manifest.ts`](../../src/core/tools/manifest.ts)):
- Agregar `"jarvis_files"` a `MCP_SERVERS` en [`src/core/types/routes.ts`](../../src/core/types/routes.ts).
- Declarar cada tool con `internalDef("jarvis_files", "<ruta>", nombre, "FILE_READ", descripción, opts)`. Para la etapa 1 la ruta es solo una etiqueta (`"files"` o `"locate"`); no cambia `DESTINATIONS`.
- La descripción tiene **tope de 80 caracteres**; cada nota de parámetro (`notes`), 240. Las notas son lo que el modelo lee sobre cada parámetro: usarlas.
- `params` lista los parámetros; `timeoutMs` el plazo (15 000 para `find_files`, 10 000 para el resto); `repeat: "retry_failed"` en las que pueden cambiar entre dos llamadas iguales.
- Registrar la instancia en [`server.tsx`](../../server.tsx), junto a `TerminalProvider` y `WebSearchProvider`.

**Seguridad en solo lectura:**
- Rutas permitidas: [`checkAllowedDirectory`](../../src/core/policy/allowedDirs.ts) (el proveedor de terminal lo recibe con la opción `allowedDirectories: () => string[]`). Aplicarlo al inicio y no salir de esa carpeta al recorrer.
- No seguir enlaces simbólicos ni uniones (junctions) que salgan de la carpeta pedida; contarlos como omitidos.
- Carpetas ilegibles: omitirlas sin error y sumarlas a `data.skipped`.
- Rutas sensibles: [`sensitivePathFinding`](../../src/core/policy/sensitivePaths.ts). El Guard ya las frena antes de llegar a la tool; no hace falta repetirlo.

**Carpetas conocidas:** [`getUserEnvironment()`](../../src/core/environment.ts) devuelve `{ platform, home, desktop?, documents?, downloads? }` (las del usuario real; pueden estar redirigidas a OneDrive). El proveedor lo recibe por opción (`environment: () => Promise<UserEnvironment>`), como los otros reciben sus dependencias, para que las pruebas lo reemplacen.

**Windows:** las rutas pueden tener `\`, `/`, prefijo `\\?\`, UNC o 8.3; la comparación de nombres no distingue mayúsculas; los nombres llevan tildes (UTF-8); respetar el plazo y la cancelación con operaciones asíncronas (no bloquear el bucle de eventos recorriendo un disco).

## 4. Las tres herramientas

### 4.1 `find_files`
**Descripción (80):** `Find files or folders by name (wildcards like *.csv). Not for text inside files.`

| Parámetro | Detalle |
|---|---|
| `pattern` (requerido) | Texto del nombre. Sin `*` ni `?`: el nombre **contiene** el texto (sin distinguir mayúsculas). Con comodines: el nombre completo coincide. Se aceptan varias alternativas separadas por `\|` (`*.csv\|*.json`). **Sin regex.** Una barra invertida o un paréntesis se toma literal |
| `path` | Dónde buscar. Por omisión, el home. Acepta `desktop`, `documents`, `downloads`, `home` y rutas |
| `type` | `file`, `folder` o `any` (por omisión `any`): **las carpetas se encuentran** |
| `maxResults` | Por omisión 50, tope 200 |

Comportamiento:
- **Una sola llamada**: devuelve todo lo hallado dentro del plazo. Nada de sesiones ni de «seguí pidiendo».
- Plazo propio de unos 8 s (menor que el del manifiesto), más topes de profundidad (por omisión 10) y de entradas recorridas. Lista de exclusión fija y documentada (`node_modules`, `.git`, la papelera, `System Volume Information`, `Windows\WinSxS`); si el usuario nombró una carpeta excluida como `path`, se busca igual.
- Orden: coincidencia exacta del nombre, después por prefijo, después por contiene; dentro de cada grupo, lo menos profundo primero.
- **Honestidad sobre lo recorrido** (es el punto más importante):

| `data.state` | Cuándo | Texto de la primera línea |
|---|---|---|
| `found` | hubo coincidencias y el recorrido fue completo | `status: found · 3 matches · complete` |
| `partial` | hubo coincidencias pero se cortó por plazo, profundidad o entradas | `status: partial · 3 matches · stopped by time (incomplete): narrow the path` |
| `no_results` | **cero coincidencias y recorrido completo** | `status: no_results · searched 48213 entries in C:\Users\hugof · complete` |
| `incomplete` | cero coincidencias y el recorrido se cortó | `status: incomplete · 0 matches · stopped by time: not a "not found"; narrow the path` |

  Campos de `data`: `state`, `count`, `complete` (booleano), `scanned` (entradas), `skipped`, `stoppedBy` (`time` \| `entries` \| `depth` \| ausente), `truncated`.
- Líneas de resultado: `[DIR]  C:\ruta\carpeta` y `[FILE] C:\ruta\archivo.ext (12 KB)`.

### 4.2 `list_folder`
**Descripción (73):** `List a folder with type, size and date; can sort and filter by extension.`

| Parámetro | Detalle |
|---|---|
| `path` (requerido) | Acepta los mismos alias que `find_files` |
| `sortBy` | `name` (por omisión), `size` o `modified` |
| `order` | `asc` o `desc`. Por omisión `asc` para `name`, `desc` para `size` y `modified` |
| `type` | `file`, `folder` o `any` |
| `extensions` | Lista, por ejemplo `["csv","json"]` |
| `depth` | 1 por omisión, tope 3 |
| `limit` | 100 por omisión, tope 500 |
| `includeHidden` | `false` por omisión |

- Línea por entrada: `[DIR]  nombre  —  2026-11-18 14:02` y `[FILE] nombre  12.4 KB  —  2026-11-18 14:02` (con `depth > 1`, la ruta relativa). Tamaño exacto en bytes en `raw`.
- Primera línea: `status: ok · 42 entries (showing 42)` o `· showing 100 of 312 (sorted by size desc)`.
- Carpeta vacía: `data.state = "ok"`, `count: 0`, texto `Folder is empty.` (no es `no_results`). Ruta que no existe o es un archivo: `isError: true` con un mensaje que diga qué falta.
- Campos de `data`: `state`, `count`, `shown`, `truncated`, `total`.

### 4.3 `system_info`
**Descripción (71):** `Report hardware, OS, disks, services or installed dev tools of this PC.`

| Parámetro | Detalle |
|---|---|
| `section` (requerido) | `overview`, `hardware`, `os`, `disks`, `services`, `dev_tools` |
| `status` | Solo con `services`: `running` (por omisión), `stopped` o `all` |
| `limit` | Solo con `services`: 100 por omisión |

- `hardware`: modelo de CPU, núcleos, RAM total, nombres de GPU. `os`: nombre, versión, compilación, tiempo encendido, usuario. `disks`: letra, etiqueta, sistema de archivos, tamaño, libre y porcentaje usado. `services`: nombre, nombre para mostrar y estado. `dev_tools`: de una lista fija (`git`, `node`, `npm`, `python`, `pip`, `java`, `dotnet`, `docker`, `code`, `go`, `rustc`, `cargo`) dice si está y su versión. `overview`: un resumen corto de hardware, SO y discos.
- **Los scripts los escribe el proveedor, no el modelo.** Módulo `os` de Node para CPU, memoria y SO; para discos, servicios y GPU, PowerShell con consultas fijas que devuelven JSON (`ConvertTo-Json`) y `execFile` con plazo. Leer **propiedades**, nunca parsear mensajes: el sistema responde en español.
- Un valor que no se pudo leer sale como `unknown` con el motivo, sin tirar la llamada entera.
- Siempre `data.state = "ok"`, con las secciones en `data.sections` (objeto). `isError` solo si falla todo.

## 5. Ficha para la etapa 2 (referencia, no implementar ahora)

| Herramienta | Ruta que se propone | Lo que debe distinguir de las vecinas |
|---|---|---|
| `find_files` | una ruta propia de búsqueda | busca **nombres** de archivos y carpetas; el texto dentro de archivos sigue siendo de `start_search` con `searchType: "content"` |
| `list_folder` | `files` | listar una carpeta conocida, con tamaño y fecha: reemplaza el rodeo por `run_command` y la sonda de atributos |
| `system_info` | una ruta propia de sistema | información fija de la PC; `run_command` queda para «ejecutar un comando o lanzar una app» |

Principio de diseño para D1 y D2: dentro de una ruta, las herramientas tienen que diferir en **una señal observable** del pedido, y evitar poner una herramienta genérica (`run_command`) al lado de las específicas. Hay que re-medir con `eval/` antes de cambiar rutas.

## 6. Criterios de aceptación

- `npx tsc --noEmit` limpio y `npm test` sin fallos nuevos.
- Pruebas propias en `tests/files_tools.test.ts` con árboles de carpetas temporales (`os.tmpdir()`), que cubran como mínimo:
  - `find_files` encuentra una **carpeta** por nombre y por prefijo, y archivos por `*.csv` y por `*.csv|*.json`.
  - Distingue `no_results` (recorrido completo) de `incomplete` (cortado por plazo, probado con un plazo mínimo).
  - Respeta `maxResults`, la lista de exclusión y `allowedDirectories`.
  - Se corta al instante con la señal de cancelación.
  - `list_folder` ordena por tamaño y por fecha, filtra por extensión y resuelve `desktop` con un entorno falso.
  - `system_info` devuelve cada sección con un lector falso, y una sección ilegible sale como `unknown` sin romper el resto.
- Los resultados cumplen `readToolResult` y el extractor estructurado: `no_results` → sin datos; el resto → datos.
- Prueba manual: con el servidor en marcha, `POST /api/mcp/jarvis_files/call` con `{ "name": "find_files", "args": { "pattern": "jarvv", "path": "E:\\colo" } }` devuelve la carpeta `E:\colo\jarvv`. (El endpoint solo deja pasar herramientas de lectura.)
- Actualizar [`docs/arquitectura/TOOLS.md`](../arquitectura/TOOLS.md) (tabla y proveedor nuevo) y [`ARCHITECTURE.md`](../arquitectura/ARCHITECTURE.md) (§3 y §6) y marcar P1 y P6 de `PENDIENTES_CODIGO.md` §3 como hechos en etapa 1.

## 7. Qué no tocar

D1, D2, `prompts.ts`, `engine/`, `policy/` (salvo usar sus funciones), `DESTINATIONS`, `EXECUTABLE_ROUTES`, los umbrales ni Desktop Commander. Si algo de esto parece necesario, anotarlo como pendiente de la etapa 2 en lugar de resolverlo.
