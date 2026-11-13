# free-search-mcp — Guía completa de uso

> Repo: https://github.com/sweetcornna/free-search-mcp (MIT, Python ≥ 3.11)
> Registro MCP: `io.github.sweetcornna/free-search-mcp`
> Fuentes de esta guía: README (HEAD), `docs/USAGE.md`, descripciones de cada tool en Glama y las notas de release v0.12.0 a v0.18.0. **Actualizada para v0.18.0** (ver §17 y §18; algunas afirmaciones de las secciones 1–16 vienen de v0.12 y se corrigen en §17).
> Nota: los docs `HOW_IT_WORKS.md`, `AGENT_USAGE.md`, `INSTALL.md`, `CONFIGURATION.md`, `PROXY_AND_GATES.md`, `DELEGATION.md` y `API_KEYS.md` no pude leerlos directamente; donde falta detalle se marca como **[no confirmado]**.

---

## 1. Qué es

Servidor MCP **local-first y sin API key** que le da a cualquier LLM (Claude, GPT, Ollama, etc.):

- Búsqueda web multi-motor (fusionada con RRF y deduplicada).
- Fetch de páginas en modo lector (Markdown limpio), con fallback automático a Chromium (Playwright) para páginas con JavaScript.
- Lectura de documentos (PDF, DOCX, XLSX, PPTX, EPUB, CSV, código, zip/tar, HTML, TXT, MD).
- Caché SQLite **FTS5** de todo lo descargado.
- Salida pensada para LLMs: Markdown primero, estimación de tokens, fechas y procedencia por resultado, errores que dicen cuál es el siguiente paso.
- Fuentes especializadas (papers, filings, CVEs, versiones de paquetes, clima, FX, etc.) que devuelven **el registro** en vez de un snippet.

**11 tools** (+ una 12ª, `ask`, solo si configuras un backend de respuesta), 5 prompts MCP y 2 resource templates (`cache://page/{url}`, `cache://search/{query_hash}`).

---

## 2. Instalación

Único requisito: [`uv`](https://docs.astral.sh/uv/).

| Dónde | Cómo |
|---|---|
| Claude Code (recomendado, plugin) | `/plugin marketplace add sweetcornna/free-search-mcp` y luego `/plugin install free-search@free-search-mcp` |
| Claude Code (sin plugin) | `claude mcp add search -s user -- uvx free-search-mcp` |
| Codex (plugin) | `codex plugin marketplace add sweetcornna/free-search-mcp` y `codex plugin add free-search@free-search-mcp` |
| Codex (sin plugin) | `codex mcp add search -- uvx free-search-mcp` |
| Claude Desktop | abrir el `.mcpb` del último release |
| Cualquier cliente MCP | comando stdio: `uvx free-search-mcp` |
| Docker | `docker compose build` y `docker compose run --rm search-mcp` |
| Hermes Agent | `hermes plugins install sweetcornna/free-search-mcp/plugins/free-search --enable` |
| Checkout local | `curl -LsSf https://raw.githubusercontent.com/sweetcornna/free-search-mcp/main/scripts/install.sh \| bash -s -- --client claude-code` |

**Trampa en Codex:** si quedó un `[mcp_servers.search]` en `~/.codex/config.toml` de un `codex mcp add` anterior, tapa silenciosamente al plugin. Ejecutá `codex mcp remove search`.

**Chromium (opcional)** para motores renderizados en navegador (`brave`, `startpage`, `zhihu`…) y páginas JS-heavy:

```bash
uvx --from free-search-mcp playwright install chromium
```

Sin Chromium, todo lo HTTP sigue funcionando y una llamada que lo necesite devuelve este comando como error.

**Transporte HTTP** (para integrarlo desde tu propia app):

```bash
uvx free-search-mcp --transport streamable-http --port 8000
# endpoint: http://127.0.0.1:8000/mcp
```

⚠️ Ese endpoint **no tiene autenticación** y hace fetch de cualquier URL para quien llegue a él. Mantenelo en loopback o poné un proxy con autenticación delante.

Config JSON típica (Claude Desktop, Cursor, Cline, Continue, Zed):

```json
{
  "mcpServers": {
    "search": {
      "command": "uvx",
      "args": ["free-search-mcp"]
    }
  }
}
```

---

## 3. Mapa rápido: qué tool usar

| Necesito… | Tool |
|---|---|
| Descubrir URLs / links / un dato puntual | `search` |
| Links **y** su texto completo en una sola llamada | `research` |
| Leer una URL que ya tengo | `fetch` |
| Leer 2–20 URLs en paralelo | `fetch_batch` |
| Material para comparar 2–5 fuentes sobre una pregunta | `compare` |
| Paginar un PDF/DOCX largo | `read_doc` |
| Campos estructurados (precio, autor, fecha, rating) | `extract_structured` |
| Recordar algo ya descargado | `cache_search` |
| Seguir citas de un paper / ver retractaciones | `paper_graph` |
| Ver qué motores/categorías existen | `engines` |
| Guardar un archivo en disco | `download` |

Regla de oro del propio servidor: **un snippet es una pista, no un hecho.** Flujo recomendado: `search` → `fetch`/`research` de la página primaria → comprobar fecha → corroborar lo importante.

---

## 4. Referencia de tools

Todas las tools aceptan `format="markdown"` (default) o `format="json"`. En JSON, la salida llega como contenido estructurado sin envolver, salvo que sea una lista, que mantiene el envoltorio `{"result": [...]}`. Markdown usa ~40 % menos tokens que JSON.

### 4.1 `search`

Búsqueda multi-motor en paralelo, fusionada con RRF y deduplicada (título difuso + host canónico). Devuelve lista de links con snippets.

**Parámetros**

| Param | Tipo | Notas |
|---|---|---|
| `query` | str (req.) | Lenguaje natural, como lo escribiría una persona. No pasar URLs acá. |
| `engines` | list[str] | **Recomendado: omitir.** Nombrar motores apaga el health-routing, el rescate y el ruteo por `category`. Usar solo para forzar un índice concreto. |
| `max_results` | int 1–50 | Cantidad tras dedup **y** presupuesto por motor (se multiplica por el fan-out). Rango útil: 5–20. Más es ruido duplicado con latencia real. |
| `freshness` | `day`\|`week`\|`month`\|`year` | Pista fuerte, no filtro duro: conserva resultados sin fecha. `day`/`week` suman `googlenews`. |
| `include_domains` / `exclude_domains` | list[str] | Restringe/excluye dominios. |
| `category` | enum | Grupo o subgrupo (ver §6). Ensancha o estrecha el ruteo y **reordena**. |
| `include_text` / `exclude_text` | str | Subcadena obligatoria/prohibida en título o snippet (case-insensitive). |
| `use_cache` | bool | Reusa resultado para esa combinación exacta (query + engines + max_results + todos los filtros). Cambiar un filtro = otra entrada de caché. |
| `max_age_hours` | num | Trata como *miss* lo cacheado más viejo que esto. `0` = refrescar forzando, pero igual se escribe en caché. `None` = TTL del servidor (7 días). |
| `format` | `markdown`\|`json` | |

**Salida JSON**: `results` (lista de `{title,url,snippet,engines,score}`), `engines` (los realmente consultados), `cached`, y opcionales: `errors`, `hint`, `benched_engines`, `rescued_via`, `auto_routed`, `timed_out_engines`, `gated_engines`, `gated_hint`, `filter_diagnostics`, `freshness_note`, `usage_note`, `retrieved_at`, `cache_age_seconds`, `dated_results`, y `agent` / `agent_lane` si hay agente de respuesta u motor `codex` configurado.

**Cada resultado trae**: `date_source` (`structured` → "dated 2026-09-02", `snippet` → "(from snippet text)", `none` → "undated") y `source_type` (`paper`/`code`/`forum`/`news`/`government`/`academic`, derivado del hostname; **nunca** entra al ranking).

**Errores comunes**
- Responder desde snippets (omiten calificadores y pueden tener años).
- Asumir que algo es reciente porque se puso `freshness` (mirar `dated: N/M` en el header).
- Subir `max_results` esperando mejor recall.
- Usar `category="news"` para noticias de último momento sin `freshness="day"` (el índice se retrasa días).
- Tratar el bloque `## Answer` (si hay agente configurado) como verificado: es la lectura de un modelo chico sobre pocas páginas.

### 4.2 `research`

Una sola llamada: busca → descarga los top N → devuelve un **brief en Markdown** con índice de fuentes `[n]` y el cuerpo completo de cada página, más estimación de tokens.

| Param | Notas |
|---|---|
| `question` (req.) | Pregunta en lenguaje natural. |
| `depth` | 1–8, cuántas páginas leer. **3 es el default razonable**; 2–3 casi siempre alcanza (8 = 8 fetches). |
| `fetch` | `False` devuelve solo la lista de fuentes (mucho más barato si el LLM solo elige cuál leer). |
| `engines`, `freshness`, `include_domains`, `exclude_domains`, `category`, `include_text`, `exclude_text`, `use_cache`, `max_age_hours`, `format` | Igual que `search`. Aquí `max_age_hours` aplica a **búsqueda y cuerpos de página**; `0` fuerza refresco de ambos. |

**JSON**: `{question, engines, sources:[{rank,title,url,snippet,...}], documents:[...], tokens_estimated, errors}`. Incluye `date_note` (cuántas fuentes se pudieron fechar y cuán separadas están).

Ejemplo de salida:

```
# Research brief: how does reciprocal rank fusion work
_engines: duckduckgo, bing, anysearch · sources: 3 · ~3,400 tokens_
## Sources
- [1] Reciprocal rank fusion | Elasticsearch Reference — <https://…>
## Documents
…cuerpos completos en Markdown…
```

**No usar para**: solo links (→ `search`), una URL conocida (→ `fetch`), consultar páginas ya descargadas (→ `cache_search`), citas de un paper (→ `paper_graph`).

### 4.3 `compare`

Descarga **2–5 URLs** concurrentemente y devuelve extractos lado a lado, truncados de forma inteligente y orientados a la pregunta.

| Param | Notas |
|---|---|
| `question` (req.) | La pregunta de comparación que responderá **tu LLM** con los extractos. |
| `urls` (req.) | 2–5 URLs http(s) absolutas. |
| `format` | `markdown`/`json`. |

- Markdown: brief con una sección por URL (título, sitename, fecha de publicación, extracto).
- JSON: `{question, urls, excerpts:[{url,title,excerpt,...}], tokens_estimated}`.
- **`compare` NO responde la pregunta**: devuelve material; la comparación la hace el LLM.
- >5 URLs → `fetch_batch`; 1 URL → `fetch`; sin URLs → `search`/`research` primero.

### 4.4 `fetch`

Trae **un** recurso http(s):

- HTML → Markdown modo lector (sin nav/footer/scripts).
- PDF/DOCX/XLSX/PPTX/EPUB/CSV/código/archivos → texto parseado (mismo motor que `read_doc`, que es mejor si necesitás paginar).
- Imágenes, video, audio, fuentes, binarios → **descripción** (tipo, bytes, dimensiones, sha256), no los bytes.

| Param | Notas |
|---|---|
| `url` (req.) | Absoluta http(s). |
| `render` | `auto` (default: HTTP y, si falla, Chromium stealth), `http` (rápido, falla en SPAs), `browser` (lento, robusto). |
| `force_refresh` | Ignora la caché de páginas. |
| `max_age_hours` | `0` ≡ `force_refresh`; `None` = TTL 7 días. |
| `inline` | Solo imágenes: devuelve la imagen para un modelo con visión. Una imagen de 1 MB cuesta >1000 tokens; primero hacé fetch normal y mirá la descripción. |
| `format` | `markdown`/`json`. |

**Salida**: header con URL, método de render, tokens, y `published <fecha>` o `no publication date found` (= **desconocido**, no "reciente"); `cached N days ago` cuando no es la página en vivo. JSON: `{url,title,content,method,truncated,tokens_estimated,author,published_date,sitename}` + `{media_type,bytes_size,sha256,width,height}` para no-texto. Si se trunca, incluye un link `cache://page/…` al texto completo.

**Errores comunes**: pasar una query en vez de URL; `render="http"` en SPA (contenido casi vacío); olvidar que hay caché de 7 días en precios/plazos (usar `force_refresh`).

### 4.5 `fetch_batch`

Variante concurrente de `fetch`. **Máx. 20 URLs por llamada.**

| Param | Notas |
|---|---|
| `urls` (req.) | Lista de URLs http(s) absolutas. |
| `render` | Igual que `fetch`. |
| `format` | `markdown`/`json`. |

- **Los fallos por URL no lanzan excepción**: en Markdown aparecen como notas inline; en JSON cada entrada tiene su campo `error`. Revisá cada ítem en vez de asumir que una excepción rompió todo el batch.
- No envuelvas una sola URL en una lista → usá `fetch`.
- Para PDFs/DOCX, `read_doc` por archivo.
- Nota: `fetch_batch` expone solo `urls`, `render` y `format` (no tiene `force_refresh`/`max_age_hours`/`inline`).

### 4.6 `read_doc`

Parsea documentos a Markdown **localmente** (sin API remota), con paginación.

| Param | Notas |
|---|---|
| `source` (req.) | URL http(s), o ruta local **solo si** el operador definió `SEARCH_MCP_DOCUMENT_ROOT`. |
| `start` | Offset en caracteres (default 0; negativo = 0; pasado el final se recorta a EOF). |
| `length` | Máx. caracteres; `None` = hasta el final (con tope por llamada); negativo → `ValueError`. |
| `format` | `markdown`/`json`. |

- JSON: `{content,title,format,total_chars,start,returned_chars,truncated}`.
- **Paginación**: siguiente llamada con `start = start_anterior + returned_chars`. Si `returned_chars == 0` y `truncated == False`, te pasaste del final.
- Seguridad: lecturas locales **desactivadas por defecto**; con root definido, la ruta debe resolverse dentro de él (relativas contra el root, `..` que escape se rechaza, `file://` siempre rechazado).
- No usar con artículos HTML normales (da ruido) → `fetch`.

### 4.7 `extract_structured`

Extrae JSON-LD, OpenGraph, Twitter cards (se listan dentro de `opengraph`), microdata y RDFa vía `extruct`.

- JSON: `{url, json_ld:[], microdata:[], opengraph:[], rdfa:[]}`. Campos de prosa larga (`articleBody`, etc.) se recortan y se indica en `trimmed`.
- Ideal para productos (precio, moneda, disponibilidad, rating), artículos (autor, fecha, imagen), recetas/eventos/videos.
- La mayoría de blogs no publica schema.org: obtendrás listas vacías → `fetch`.
- No llamarlo "por las dudas" en cada URL.

### 4.8 `cache_search`

Búsqueda full-text **solo** sobre lo ya descargado (SQLite FTS5).

| Param | Notas |
|---|---|
| `query` (req.) | Sintaxis FTS5: términos sueltos = AND; `OR`, `NOT`, prefijo `term*`, frase `"exacta"`. |
| `limit` | Máx. resultados. |
| `format` | JSON: lista de `{url,title,snippet,author,date,sitename}` (los últimos 3 vacíos en filas viejas). |

- Con caché vacía (instalación nueva) devuelve cero hits. Primero poblar con `search`/`research`/`fetch`.
- Sin comillas, una frase natural se parte en AND de palabras sueltas.

### 4.9 `paper_graph`

Sigue las aristas de **un** paper: referencias, trabajos que lo citan (ordenados por influencia) y avisos de retractación/corrección de Crossref.

| Param | Notas |
|---|---|
| `paper` (req.) | DOI (`10.1145/1571941.1572114` o URL doi.org), ID OpenAlex (`W2148972377`), título exacto, o referencia arXiv (`arXiv:1706.03762`, URL `arxiv.org/abs/…`, DOI `10.48550/arXiv.…`, o id suelto como `1706.03762`, `2401.12345v3`, `hep-th/9901001`). |
| `direction` | `both` (default), `references`, `citations`. |
| `limit` | 1–50 por dirección. |
| `format` | JSON: `{paper, references, citations, notes}`; `paper.crossref` trae `registered` y los `notices` posteriores a la publicación. |

- Un título se resuelve a su mejor match; una frase temática resuelve al paper equivocado.
- `citations` vacío **no** significa "sin citas" si `notes` dice que la búsqueda fue truncada.
- Para buscar por tema: `search(category="paper")`.

### 4.10 `engines`

Imprime el árbol `grupo → subgrupo → motor` con una línea de descripción por motor (se genera en vivo desde el registro).

- `group` (enum) filtra por grupo; JSON: `{"engines":[...], "taxonomy":{...}, "descriptions":{...}}`.
- Llamarlo una vez; la lista es estática.
- Grupos válidos: `web, news, paper, github, forum, image, dataset, finance, software, security, reference, weather, docs, gov, stats, calendar`.
- Preferir `category=` sobre `engines=`.

### 4.11 `download`

Guarda un archivo en `SEARCH_MCP_CACHE_DIR/downloads` (override: `SEARCH_MCP_DOWNLOAD_DIR`).

- Retorno JSON: `{url,saved_path,media_type,bytes_size,sha256,expires_in_hours}` (`0` = limpieza TTL desactivada).
- Se borra tras 24 h por defecto (`SEARCH_MCP_DOWNLOAD_TTL_HOURS`), al arrancar y antes de la siguiente descarga. Copialo si lo querés conservar.
- Desactivar: `SEARCH_MCP_DOWNLOAD_ENABLED=false`. Tope: `SEARCH_MCP_DOWNLOAD_MAX_MB` (100) y `SEARCH_MCP_MAX_RESPONSE_BYTES` (25 MB); rige el menor.
- Para leer contenido usar `read_doc`; para ver una imagen, `fetch(inline=True)`.

### 4.12 `ask` (opcional)

Aparece solo si `SEARCH_MCP_AGENT_BACKEND` ∈ {`api`, `claude-code`, `codex`}. Delega el lookup para que el texto de las páginas no entre en el contexto del llamador y devuelve una respuesta corta con fuentes fechadas. Detalle en `docs/DELEGATION.md` **[no leído]**.

---

## 5. Filtros (en `search` y `research`)

| Param | Valores | Efecto |
|---|---|---|
| `freshness` | `day`/`week`/`month`/`year` | Ventana temporal de motor + chequeo de fecha en cliente. Mantiene sin fecha. Si ≥50 % no tienen fecha, aparece `freshness_note`. |
| `include_domains` | `["python.org"]` | Restringe a esos dominios (para `anysearch`, que ignora `site:`, se filtra a posteriori). |
| `exclude_domains` | `["pinterest.com"]` | Excluye. |
| `category` | ver §6 | Ruteo + reranking. |
| `include_text` | `"async"` | Subcadena requerida. |
| `exclude_text` | `"beginner"` | Subcadena prohibida. |
| `max_age_hours` | `24` | Acepta caché solo si es más joven. |

Si los filtros dejan **≤3 resultados**, la respuesta incluye `filter_diagnostics` indicando cuál relajar.

**TTL efectivo de caché** = el más ajustado entre: `max_age_hours`, TTL de `freshness` (`day`→1 h, `week`→6 h, `month`→24 h), tope de `news` (6 h) y tope de la categoría (`weather` y `finance.fx` 1 h; `software` y `security` 6 h). Default general: 7 días.

Ejemplos:

```python
research("LLM eval frameworks", depth=3, freshness="month", category="paper")
search("kubernetes operators", include_domains=["github.com"], category="github")
search("CRISPR base editing", category="paper.preprint")
search("graph neural network datasets", category="dataset.ml")
search("Riemann hypothesis", category="paper.math")
search("NVDA 10-K risk factors", category="finance.filings")
paper_graph("arXiv:1706.03762")
```

---

## 6. Categorías (`category=`) y fuentes especializadas

Reglas:
- **Grupo** (`paper`) **ensancha**: suma un especialista por subgrupo al pool web, hasta `SEARCH_MCP_CATEGORY_ENGINE_LIMIT` (3).
- **Subgrupo** (`paper.biomed`) **estrecha**: solo esas fuentes.
- `image` y `dataset` **reemplazan** el pool web (un motor web no devuelve imágenes/datasets).
- `news`/`paper`/`forum`/`github`/`blog` además filtran resultados web por hostname.
- Los motores que indexan nativamente la categoría **cuentan doble** en el RRF; un registro consultado directamente (PyPI, CVE, tasa ECB, clima) cuenta **cinco veces** y pasa a ser la línea `Lead:`.
- Pasar `engines=` desactiva todo este ruteo.

| `category` | Motores | Para qué |
|---|---|---|
| `paper` | uno por subgrupo (p. ej. arxiv, openalex, europepmc) | literatura real con fechas estructuradas |
| `paper.index` | openalex, crossref, semanticscholar | índices DOI con conteo de citas |
| `paper.preprint` | arxiv, europepmc | preprints (marcados `PREPRINT`) |
| `paper.biomed` | europepmc, pubmed | biomedicina |
| `paper.cs` | dblp | bibliografía CS con venue/DOI |
| `paper.openaccess` | doaj, europepmc | texto completo gratis (→ `read_doc`) |
| `paper.trial` | clinicaltrials | ensayos registrados |
| `paper.math` | zbmath | matemática |
| `finance` | uno por subgrupo | filings, mercado, macro |
| `finance.filings` | sec_edgar, cninfo | filings de EE. UU.; anuncios A-share/HK |
| `finance.market` | yahoofinance | ticker + noticias |
| `finance.macro` | worldbank, imf | documentos WB; series IMF (WEO) |
| `finance.fx` | frankfurter, cfets | tasa ECB (31 monedas) y paridad PBOC |
| `finance.entity` | gleif | entidad legal por nombre (LEI) |
| `finance.crypto` | coingecko | precio spot USD/CNY, cap |
| `github` | github | repos + issues/PRs (`github_code` es opt-in con token) |
| `forum` | stackexchange, hackernews | señales de respuesta aceptada/score |
| `news`, `news.world` | googlenews, gdelt | GDELT: 100+ idiomas, rate-limit estricto |
| `image` | openverse, wikimedia | archivos CC con atribución |
| `dataset` | uno por subgrupo | datasets |
| `dataset.repository` | dryad, dataverse, zenodo, figshare | repositorios de investigación |
| `dataset.ml` | huggingface | datasets de ML |
| `dataset.gov` | dataeuropa | datos abiertos UE |
| `software` | uno por subgrupo | versiones y soporte |
| `software.lifecycle` | endoflife | ciclos de release / fin de soporte (~480 productos) |
| `software.github` | github_releases | último release (`owner/repo` directo) |
| `software.python` / `.node` / `.rust` | pypi / npm / crates | versión actual y fecha |
| `software.registry` | registries | Maven, RubyGems, Go proxy, Homebrew, Docker Hub, Packagist, NuGet |
| `software.app` | appstore | versión de una app iOS |
| `security` | nvd, osv | vulnerabilidades |
| `security.cve` | nvd | registro NIST con CVSS |
| `security.package` | osv | advisories por paquete con versión corregida |
| `security.exploited` | cisakev | si un CVE está en KEV de CISA |
| `reference` / `reference.domain` | wikidata, rdap | entidades; registro/expiración de dominios |
| `weather` | openmeteo | condiciones actuales + 3 días |
| `docs` / `docs.web` / `docs.rfc` | mdn, ietf | documentación de referencia, RFCs |
| `gov` / `gov.us` / `gov.uk` | federalregister, govuk | boletines y portales oficiales |
| `stats` / `stats.indicator` | wdi | indicador del Banco Mundial por país |
| `calendar.holidays` / `.clock` | holidays, worldclock | feriados; hora actual en una ciudad |

Con el límite por defecto: `category="dataset"` → dryad + huggingface + dataeuropa; `category="paper"` → arxiv + openalex + europepmc; `category="software"` → endoflife + github_releases + pypi.

### 6.1 "Direct facts": respuestas por registro, sin categoría

Las fuentes `software`, `security`, `reference`, `weather`, `docs`, `gov`, `stats`, `calendar`, `finance.fx/entity/crypto` **deciden solas** si pueden responder según las palabras de la consulta. Las primeras 3 que digan sí se suman al pool (`SEARCH_MCP_CLAIM_ENGINE_LIMIT`), responden en <1 s y aparecen en `auto_routed`. El registro llega como primer resultado con la fecha del publicador.

```python
search("latest fastapi version")          # pypi + endoflife
search("is python 3.9 still supported")   # endoflife
search("npm express latest version")      # npm
search("CVE-2024-3094")                   # nvd, osv, cisakev
search("requests vulnerabilities")        # osv
search("100 usd to cny")                  # frankfurter (ECB) + cfets (PBOC)
search("btc price")                       # coingecko
search("github.com domain expiry")        # rdap
search("上海明天天气")                      # openmeteo
search("现在东京几点")                      # worldclock (sin request)
search("Array.prototype.toSorted", category="docs.web")
search("RFC 9110", category="docs.rfc")
```

Se desactiva con `SEARCH_MCP_AUTO_ROUTE_ENABLED=false`. Nombrá la cosa de forma simple ("latest X version"); `frankfurter` necesita dos monedas; `openmeteo` geocodifica lo que queda tras quitar palabras de clima.

---

## 7. Motores, pool por defecto y fiabilidad

> ✅ **Resuelto en v0.18.0.** El pool por defecto es `duckduckgo, bing, yahoojp, anysearch` (`yahoojp` = Yahoo! JAPAN, la ruta sin key al índice de Google). `googlenews` se suma con `freshness` day/week, `so360` y `quark` con consultas en chino, `naver` con consultas en coreano. Los motores `mojeek`, `google`, `startpage`, `searx` y `sogou` **fueron eliminados** (solo servían CAPTCHA o páginas vacías). Las filas de más abajo que los mencionan y el párrafo «Estado medido» son históricos de v0.12.

- Hay **75 motores** en el registro. Todo lo que una búsqueda alcanza por sí sola es **sin key**.
- **Reservas** (v0.18.0): `yahoo` (índice de Bing vía Yahoo, con handshake de cookies), `seznam` (rastreador independiente), `so360` y `brave`, en ese orden; entran solo si hay <3 motores generales sanos (`SEARCH_MCP_MIN_HEALTHY_ENGINES`).
- **Circuit breaker**: aparta un motor de inmediato si sirve un muro/CAPTCHA/página off-topic; tras 2 errores seguidos o 3 respuestas vacías. Bench de 10 min, duplicando hasta 60; un éxito lo limpia. Aparece en `benched_engines`.
- **Rescate**: si el pool vuelve vacío, una pasada acotada (reservas → `searx` → `bing`) reportada como `rescued_via`.
- **Deadline**: la búsqueda deja de esperar al motor más lento 10 s después del fan-out, siempre que ≥1 haya respondido (`SEARCH_MCP_SEARCH_DEADLINE_SECONDS`; `0` = esperar a todos). Los cancelados salen en `timed_out_engines`.
- `gated_engines` / `gated_hint`: motor bloqueado o resultados descartados como `off_topic` (un `off_topic` **no** es un bloqueo y un proxy no lo arregla).

**Motores fuera del pool, por nombre**

| Motor | Notas |
|---|---|
| `startpage` | renderizado en navegador (~5–10 s) |
| `brave`, `baidu` | navegador; a veces desafían clientes headless |
| `searx` | SearXNG públicos; lentos |
| `google` / `serpsearch` | scrape de SERP; chocó con muro JS en pruebas (21-sep-2026) → no sirve de recuperación |
| `youcom` | índice propio, 100 búsquedas/día por IP, no se agrupa |
| `bilibili` | video, JSON API sin key |
| `zhihu` | requiere login una vez (`search-mcp-login zhihu`); suele devolver vacío por muro |
| `sogou` | devuelve URLs de redirección |
| `so360` | URLs directas; entra solo con consultas en chino |
| `wikipedia` | idioma según `SEARCH_MCP_REGION` |
| `openlibrary` | libros |
| `anysearch` | tier anónimo de AnySearch; limitado por IP; ignora `site:`/`filetype:` |

**Estado medido el 21-sep-2026** (documentado en USAGE): `duckduckgo`, `bing`, `anysearch`, `so360` devolvían resultados vivos; `mojeek` con CAPTCHA en cada request; `google`/`serpsearch` muro JS; `startpage` y `sogou` vacíos.

**Cuando los resultados son pocos**: (1) reformular; (2) pasar `category=`; (3) `engines=["so360","baidu"]` para chino o `["brave"]`/`["startpage"]` con Chromium; (4) configurar proxy (`SEARCH_MCP_PROXY`) si el diagnóstico muestra un muro real.

---

## 8. Señales de frescura y procedencia (para tu lógica de verificación)

| Señal | Significado |
|---|---|
| `retrieved_at` | cuándo se consultó; en cache hit, la hora original |
| `cache_age_seconds` | solo en cache hits |
| `dated_results` (`dated: N/M`) | cuántos resultados tienen fecha |
| `date_source` por resultado | `structured` / `snippet` / `none` |
| `source_type` por resultado | `paper`/`code`/`forum`/`news`/`government`/`academic` (nunca influye en ranking) |
| `freshness_note` | ≥50 % sin fecha con `freshness` activo |
| `usage_note` | recordatorio fijo: un snippet es una pista |
| `date_note` (`research`) | fuentes fechables y su dispersión |
| `published <fecha>` / `no publication date found` (`fetch`) | `no publication date found` = desconocido |

---

## 9. Motores con cuenta propia (opt-in): `codex` y `antigravity`

Nunca entran en un pool; solo se usan si la llamada los nombra.

| | `codex` | `antigravity` |
|---|---|---|
| Busca con | búsqueda web de OpenAI (la de Codex) | Google Search vía un modelo Gemini |
| Cuenta | plan ChatGPT que incluya Codex | cuenta Google con Antigravity |
| Cuenta contra | uso de Codex del plan | cuota de Antigravity |
| Permitido por el proveedor | sí | **no** (los términos de Google lo prohíben y hubo suspensiones) |
| Latencia medida (26-sep-2026) | ~3 s | 10–20 s |

```bash
uvx --from free-search-mcp search-mcp-login codex
uvx --from free-search-mcp search-mcp-login antigravity   # muestra advertencia primero
uvx --from free-search-mcp search-mcp-login status
```

```python
search("rust 2024 edition changes", engines=["codex"])
search("rust 2024 edition changes", engines=["codex", "duckduckgo", "bing"])
research("what changed in python 3.14 asyncio", engines=["antigravity"])
```

Tokens en `~/.config/search-mcp/oauth/` (0600). Variables: `SEARCH_MCP_CODEX_MODEL`/`_ANTIGRAVITY_MODEL` (`latest`), `…_TIMEOUT` (60), `SEARCH_MCP_CODEX_AUTO_SIGNIN` (true). En servidor/SSH/Docker usar `--no-browser`; en Docker montar `SEARCH_MCP_CONFIG_DIR`.

⚠️ Usá `antigravity` solo con una cuenta cuyo riesgo de suspensión aceptes.

## 10. Motores con API key propia (opt-in)

No hacen falta; **los agentes nunca deben pedirle una key al usuario**.

| Motor | Key |
|---|---|
| `brave_api` | `SEARCH_MCP_BRAVE_API_KEY` |
| `serper` | `SEARCH_MCP_SERPER_API_KEY` |
| `serpbase` | `SEARCH_MCP_SERPBASE_API_KEY` |
| `tavily` | `SEARCH_MCP_TAVILY_API_KEY` |
| `google_cse` | `SEARCH_MCP_GOOGLE_CSE_API_KEY` + `SEARCH_MCP_GOOGLE_CSE_CX` |
| `github_code` | `SEARCH_MCP_GITHUB_TOKEN` |

Se pasan por entorno, `.env` o la página local `uv run search-mcp-admin` (http://127.0.0.1:8765, bilingüe, solo loopback, aplica en vivo). Nombrar uno sin key devuelve un error accionable. `anysearch`, `stackexchange` y `semanticscholar` aceptan credencial opcional para subir límites.

---

## 11. Configuración (`SEARCH_MCP_*`)

Orden de lectura: entorno → `./.env` → `~/.config/search-mcp/.env` (`SEARCH_MCP_CONFIG_DIR` mueve el directorio). Nada es obligatorio.

| Variable | Default | Significado |
|---|---|---|
| `SEARCH_MCP_DEFAULT_ENGINES` | ver §7 | pool por defecto (lista JSON) |
| `SEARCH_MCP_RESERVE_ENGINES` | `yahoo, seznam, so360, brave` (v0.18.0) | reservas (la lista de v0.12 con `searx` quedó obsoleta) |
| `SEARCH_MCP_MIN_HEALTHY_ENGINES` | `3` | umbral para sentar reservas |
| `SEARCH_MCP_FRESH_ENGINES` | `["googlenews"]` | se suman con `freshness` day/week |
| `SEARCH_MCP_LOCALE_ENGINES` | `{"zh":["so360"]}` | motores por idioma de la consulta |
| `SEARCH_MCP_HEALTH_ENABLED` | `true` | circuit breaker |
| `SEARCH_MCP_ENGINE_COOLDOWN_SECONDS` / `_MAX_SECONDS` | `600` / `3600` | bench y techo |
| `SEARCH_MCP_COHERENCE_GUARD_ENABLED` | `true` | guarda de off-topic |
| `SEARCH_MCP_PROXY` / `SEARCH_MCP_PROXY_ENGINES` | vacío | proxy http/https/socks5 y ámbito por motor |
| `SEARCH_MCP_FETCH_STRATEGY` | `auto` | `auto`/`http`/`browser` |
| `SEARCH_MCP_BROWSER_HEADLESS` | `true` | Chromium headless |
| `SEARCH_MCP_SAFESEARCH` | `moderate` | `strict`/`moderate`/`off` |
| `SEARCH_MCP_REGION` | `us-en` | locale (token `cc-lang`) |
| `SEARCH_MCP_CACHE_DIR` | `~/.cache/search-mcp` | caché de búsquedas y páginas |
| `SEARCH_MCP_CACHE_TTL_SECONDS` | `604800` | 7 días |
| `SEARCH_MCP_CATEGORY_ENGINE_LIMIT` | `3` | motores que `category=` puede sumar |
| `SEARCH_MCP_AUTO_ROUTE_ENABLED` | `true` | motores de registro que "reclaman" la pregunta |
| `SEARCH_MCP_CLAIM_ENGINE_LIMIT` | `3` | cuántos pueden sumarse |
| `SEARCH_MCP_SEARCH_DEADLINE_SECONDS` | `10` | espera al motor más lento |
| `SEARCH_MCP_CONTACT_EMAIL` | vacío | OpenAlex/Crossref/NCBI te mandan al pool rápido |
| `SEARCH_MCP_DOCUMENT_ROOT` | sin definir | habilita lectura local en `read_doc` |
| `SEARCH_MCP_MAX_RESPONSE_BYTES` | 25 000 000 | tope remoto |
| `SEARCH_MCP_DOWNLOAD_ENABLED` / `_DIR` / `_TTL_HOURS` / `_MAX_MB` | `true` / cache/downloads / `24` / `100` | descargas |
| `SEARCH_MCP_TRANSPORT` | `stdio` | `stdio`/`streamable-http` |
| `SEARCH_MCP_HTTP_HOST` / `_PORT` / `_PATH` | `127.0.0.1` / `8000` / `/mcp` | bind HTTP |
| `SEARCH_MCP_TOOLS` | vacío | allow-list de tools (vacío = las 11) |
| `SEARCH_MCP_AGENT_BACKEND` | `off` | `api`/`claude-code`/`codex` registra `ask` |

---

## 12. Recetas para sacarle el máximo (patrones de uso)

1. **Pregunta abierta, 1 llamada**: `research(q, depth=3)`. Si solo querés elegir qué leer: `research(q, fetch=False)`.
2. **Hechos puntuales con fecha citable** (versión, CVE, FX, clima): `search("latest X version")` sin categoría; el primer resultado ya es el registro con fecha del publicador.
3. **Verificación de un dato crítico** (plazo, precio, regla): `search` → `fetch(url, force_refresh=True)` → revisar `published` y `cached N days ago`.
4. **Triangulación**: `search` → elegir 2–5 URLs → `compare(question, urls)` → tu LLM contrasta.
5. **Barrido amplio**: `search` → `fetch_batch(top 10–20)` → revisar `error` por ítem.
6. **Literatura científica**: `search(category="paper.cs")` o `paper.biomed` → `paper_graph(doi)` para chequear retractaciones y citas → `read_doc` del PDF (con `paper.openaccess`).
7. **Documento largo**: `read_doc(url, start=0, length=20000)` y avanzar con `start += returned_chars` hasta `returned_chars == 0`.
8. **Datos de producto/artículo**: `extract_structured(url)`; si vienen listas vacías → `fetch`.
9. **Ahorro de tokens**: Markdown en vez de JSON; `depth` 2–3; `max_results` 5–20; `fetch` sin `inline`; `cache_search` antes de re-descargar.
10. **Contenido en chino**: dejar que `so360` entre solo; sumar `engines=["so360","baidu"]` si hace falta; Bilibili con `engines=["bilibili"]`.
11. **Noticias**: `freshness="day"` + `category="news"`; revisá `dated: N/M`.
12. **Filtros finos**: `include_domains=["docs.python.org"]` para ir a la fuente primaria; `exclude_domains` para quitar ruido.

### Árbol de decisión

```
¿Tengo URL?
 ├─ sí, 1  → fetch   (doc largo → read_doc; campos → extract_structured; archivo → download)
 ├─ sí, 2–5 y quiero contrastar → compare
 ├─ sí, 2–20 → fetch_batch
 └─ no
     ├─ quiero solo links → search
     ├─ quiero links + texto → research
     ├─ ¿ya lo bajé antes? → cache_search
     └─ es un paper concreto → paper_graph
```

---

## 13. Integrarlo en tu propia herramienta

Hay dos rutas. Los ejemplos de código son **orientativos** (no están en la documentación del repo; usan el SDK oficial de Python de MCP).

### A) Como servidor stdio lanzado por tu app

```python
import asyncio, json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(command="uvx", args=["free-search-mcp"])

async def main():
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()          # las 11 tools + esquemas
            res = await session.call_tool(
                "research",
                {"question": "how does reciprocal rank fusion work",
                 "depth": 3, "format": "json"},
            )
            print(res.content)

asyncio.run(main())
```

### B) Como servicio HTTP

```bash
uvx free-search-mcp --transport streamable-http --port 8000
# tu cliente MCP apunta a http://127.0.0.1:8000/mcp
```

Poné autenticación delante si no es loopback (el endpoint hace fetch de cualquier URL).

### Consejos de diseño

- Pedí **`format="json"`** si vas a parsear; usá Markdown si el resultado va directo al contexto de un LLM.
- Registrá solo las tools que necesites con `SEARCH_MCP_TOOLS="search research fetch"` para reducir el costo de tokens de las definiciones.
- Tratá `errors`, `benched_engines`, `rescued_via`, `timed_out_engines`, `gated_engines` y `filter_diagnostics` como señales de calidad que tu lógica puede usar para reintentar (reformular, añadir `category`, cambiar `render`, etc.).
- Guardá `retrieved_at`, `date_source` y `published_date` junto con cada dato que cites, para poder mostrar la procedencia.
- Para datos que se mueven (precios, plazos): `max_age_hours` bajo o `force_refresh=True`.
- La caché y los resource templates (`cache://page/{url}`, `cache://search/{query_hash}`) permiten recuperar texto completo cuando un `fetch` se truncó.

---

## 14. Problemas frecuentes

| Síntoma | Causa / acción |
|---|---|
| Pocos o cero resultados | Ver `benched_engines`/`gated_engines`; reformular; `category=`; probar `engines=["so360","baidu"]` o `["brave"]`; proxy |
| Error pidiendo Chromium | `uvx --from free-search-mcp playwright install chromium` |
| Contenido casi vacío en una SPA | usar `render="auto"` o `"browser"`, no `"http"` |
| `fetch` devuelve algo viejo | caché de 7 días → `force_refresh=True` o `max_age_hours=0` |
| `read_doc` rechaza ruta local | definir `SEARCH_MCP_DOCUMENT_ROOT` (y mantener la ruta dentro) |
| `cache_search` sin hits | la caché está vacía o falta comillas para frase exacta |
| Plugin de Codex no usa el server correcto | `codex mcp remove search` |
| `codex not configured` | correr `search-mcp-login codex` |
| `antigravity`: `needs Antigravity's OAuth client` | instalar Antigravity o definir `SEARCH_MCP_ANTIGRAVITY_CLIENT_ID/_SECRET` |
| `google`/`serpsearch` no devuelven nada | muro JS; no usar como recuperación |
| `zhihu` vacío | requiere `search-mcp-login zhihu` y aun así suele estar gateado |

---

## 15. Checklist antes de citar un dato

- [ ] ¿Leí la página primaria (no solo el snippet)?
- [ ] ¿`published` / `dated` es reciente, o dice "undated / no publication date found"?
- [ ] ¿La respuesta vino de caché (`cached N days ago`) y el dato es volátil?
- [ ] ¿Hay al menos una segunda fuente que lo corrobore (`compare`)?
- [ ] Si es un paper: ¿`paper_graph` muestra retractación o corrección?
- [ ] Si usé el bloque `## Answer` del agente: ¿lo verifiqué en la fuente?

---

## 16. Enlaces

- Repo: https://github.com/sweetcornna/free-search-mcp
- Uso con ejemplos: https://github.com/sweetcornna/free-search-mcp/blob/main/docs/USAGE.md
- Docs referenciados en el README (no leídos): `docs/HOW_IT_WORKS.md`, `docs/AGENT_USAGE.md`, `docs/INSTALL.md`, `docs/CONFIGURATION.md`, `docs/PROXY_AND_GATES.md`, `docs/DELEGATION.md`, `docs/API_KEYS.md`, `docs/CODEX_SEARCH.md`, `docs/ANTIGRAVITY_SEARCH.md`
- Esquemas de cada tool (Glama): https://glama.ai/mcp/servers/sweetcornna/free-search-mcp


---

## 17. Novedades de v0.13 a v0.18 y correcciones a este documento

Fuentes: notas de release v0.13.0, v0.13.1, v0.14.0, v0.14.1, v0.16.0, v0.17.0 y PR #30/#31 (v0.18.0). **No pude leer** las notas de v0.15.0, el CHANGELOG completo, ni `HOW_IT_WORKS.md` / `AGENT_USAGE.md` de la versión 0.18; lo que depende de ellos está marcado **[no confirmado]**.

### Correcciones a las secciones 1–16
| Afirmación anterior | Estado en v0.18.0 |
|---|---|
| Pool por defecto con `mojeek` | Ahora `duckduckgo, bing, yahoojp, anysearch` |
| Motores `google`, `startpage`, `searx`, `sogou`, `mojeek` | **Eliminados** |
| `SEARCH_MCP_SEARX_INSTANCES` | Eliminada. Un nombre eliminado en `DEFAULT/RESERVE/RESCUE_ENGINES` no rompe la llamada: se informa como motor desconocido en esa búsqueda |
| Reservas `so360, brave, searx` | `yahoo, seznam, so360, brave` |
| `youcom` | Sigue fuera de todo pool; desde v0.14.1 usa el perfil gratuito del servidor MCP de You.com (100 búsquedas/día por IP) y mapea noticias, `freshness`, SafeSearch y región |
| «Sin API keys: 6 engines opt-in» | Siguen siendo 6 (`brave_api, serper, serpbase, tavily, google_cse, github_code`) |

### v0.13.0 / v0.13.1
- Motores opt-in `codex` y `antigravity` (cuenta en vez de API key). README acortado en 0.13.1 (solo documentación).

### v0.14.0 / v0.14.1
- Arregla un crash de arranque en instalaciones nuevas causado por `selectolax` 1.0 (0.13.1 no arrancaba sin `--with "selectolax<1"`).
- El arranque de Playwright y del navegador tiene tope: `SEARCH_MCP_BROWSER_LAUNCH_TIMEOUT` (30 s). Tras un fallo, durante `SEARCH_MCP_BROWSER_LAUNCH_COOLDOWN` (20 s) las llamadas que necesitan navegador fallan de inmediato con un mensaje que dice que el navegador no arrancó y que la búsqueda y el fetch por HTTP siguen funcionando. Un navegador que no arranca ya no penaliza al motor en el circuit breaker.
- `youcom` opt-in. Plugin también como paquete Agent Plugins v1 (Hermes).

### v0.16.0 (rendimiento)
- **El handshake MCP responde sin cargar dependencias pesadas**: en entorno nuevo pasó de 11–12 s a 1,7–2,1 s; en arranque en caliente de 1,9 s a 0,5 s. La ruta de búsqueda/fetch se precarga en un hilo (`SEARCH_MCP_PREWARM`; `false` lo desactiva). También precalienta la cookie de Bing y lanza el navegador si el pool lo necesitó en el último día.
- **Conexiones reutilizadas** por motor (0,7–0,9 s menos por request; requiere curl_cffi ≥ 0.12).
- **Navegador primero** durante 15 min para un motor cuyo HTTP está bloqueado pero cuyo render no (veredicto guardado en `<cache_dir>/http_walls.json`).
- **Extracción (trafilatura) y parseo de documentos en hilo aparte**: antes serializaban `fetch_batch` y `research`; diez páginas se extraen en aproximadamente la mitad del tiempo.
- Un cuerpo mayor que `SEARCH_MCP_MAX_RESPONSE_BYTES` sin `Content-Length` ahora corta la descarga en el tope.
- La detección de VPN en modo TUN con IP falsa reconoce también `2001:2::/48`.

### v0.17.0
- `search` **ejecuta el agente de respuesta junto a los motores** si hay backend configurado (`SEARCH_MCP_AGENT_BACKEND`). Se apaga con `SEARCH_MCP_AGENT_IN_SEARCH=false`; tope `SEARCH_MCP_AGENT_SEARCH_TIMEOUT_SECONDS` (45 s). Las búsquedas de imagen y dataset lo omiten; si falla o se agota, la búsqueda no falla.
- Se eliminan los motores muertos y `SEARCH_MCP_SEARX_INSTANCES`.

### v0.18.0 (PR #29, #30, #31; 2026-10-31; 2661 tests)
- **Agent lane**: un `codex` con sesión iniciada (y `antigravity` si `SEARCH_MCP_AGENT_ENGINES` lo nombra) se consulta **al mismo tiempo** que el pool sin key en cada búsqueda automática (sin `engines=`). Sus resultados pasan por la misma guarda anti-off-topic y se funden en el mismo ranking. La búsqueda espera al lane como máximo 6 s (`SEARCH_MCP_AGENT_LANE_WAIT_SECONDS`) y como máximo 2 s más que los motores sin key una vez que estos ya tienen resultados (`SEARCH_MCP_AGENT_LANE_GRACE_SECONDS`). Si el lane sigue buscando, termina en segundo plano y se fusiona en la caché (la misma búsqueda repetida poco después ya trae sus resultados). Nunca hace cola por rate limit, una ventana de uso agotada lo aparta de inmediato y sus problemas se reportan en `agent_lane` (claves: `engines, answered, pending, errors, rate_limited, benched, left_out`), no como búsqueda fallida. `SEARCH_MCP_AGENT_ENGINES=off|auto|codex,antigravity`.
- Un resultado del lane que parece off-topic y no puede confirmarse se descarta si quedan resultados sin key (`agent_lane.left_out`); si es lo único que hay, se sirve. Tres respuestas no confirmadas seguidas apartan al motor.
- **Rescate en carrera escalonada** (`SEARCH_MCP_RESCUE_STAGGER_SECONDS`): el siguiente candidato arranca tras un intervalo o en cuanto falla el anterior; gana el primero útil y cancela el resto (máx. 2 en vuelo). Si nada sin key respondió y el lane sigue buscando, el rescate arranca junto a la espera del lane.
- **Clave de caché versión 3**: los motores del lane entran como `agent:<nombre>`. La primera búsqueda tras actualizar está fría. Las filas con lane incompleto llevan `lane_missing` y se reproducen como máximo una hora.
- **Cinco índices web nuevos**: `yahoojp` (en el pool; 0,8–1,5 s medidos), `yahoo` (primera reserva), `seznam` (reserva), `quark` (con `so360` para chino) y `naver` (coreano). `quark` tiene límite de 10/min con ráfaga de 2; el limitador aprende ráfagas por motor.
- **Fechas de snippet**: se reconocen `2026/10/1`, `2026.05.24.`, `2026年10月1日`, `5日前`, `3天前`, `3일 전`. Ya no se leen como fecha «10月1日前» (plazo), «2024年前半», ni versiones CalVer.
- **Nuevas puertas (gates)**: `region` (el aviso EEE/Reino Unido de Yahoo! JAPAN aparta el motor al máximo cooldown: un servidor en el EEE o Reino Unido puede quedarse sin `yahoojp`) y `consent` (página de consentimiento de Yahoo).

### Cambios de v0.12 que siguen vigentes y conviene recordar
- **Los errores llegan al cliente**: toda excepción accionable (`ValueError`, `OSError`, `FetchError`, límites de tamaño, navegador ausente, `httpx`) llega como `ToolError` con su texto original; cualquier otra se informa como `internal error (<Tipo>)` sin mensaje (bug del servidor).
- **El Markdown ya no viaja duplicado dentro de JSON**; con `format="json"` el resultado estructurado llega sin envolver (salvo listas, que conservan `{"result": [...]}`).
- `mcp[cli]>=2.2.0,<2.3`.
- En 0.12 la salida cambió «en tres lugares que un programa que la parsee notaría»; **no pude leer cuáles** [no confirmado]. Vale la pena leer el CHANGELOG de 0.12.0 si tu parser nació antes.

### Seguridad de `fetch` (SSRF) — corrige una duda anterior
Desde v0.8.0 la guarda SSRF de Free Search: rechaza por nombre `localhost`, `*.internal`, `*.local`, `*.corp`, `*.lan`, `metadata.google.internal`, etc. sin DNS; bloquea la IP de metadatos de Alibaba (`100.100.100.200`); aplica la guarda **también al render con navegador** (antes era un bypass); y valida el caché antes de servir. La capa que resuelve todas las direcciones corre solo cuando el resolver de este proceso decide a qué se conecta: **se omite detrás de un proxy saliente o con VPN TUN de IP falsa** (`SEARCH_MCP_SSRF_RESOLVE_ADDRESSES = auto|always|never`; `always` fuerza la capa). Mantené `allow_private_hosts` en `false`.

---

## 18. Qué aprovechar de v0.18.0 en tu tool `web_search`

Contexto: tu tool llama a `free_search/research` y `free_search/fetch` por un `ToolHost` con lista blanca, trocea y ordena con BM25 y puntúa con un juez 2B; no hay modelo generativo sobre páginas no confiables.

### A. Ya lo tenés bien alineado
- `fetch` con `max_age_hours` (porque `fetch_batch` no lo admite).
- `max_age_hours` en `research` (aplica a la búsqueda y a los cuerpos de página).
- No nombrar `engines`: así se conservan breaker, reservas, rescate escalonado, ruteo por categoría y claims.
- La guarda SSRF de Free Search refuerza tu `isInternalHost` (ver §17), no lo reemplaza.

### B. Mejoras de bajo riesgo (propuestas)
1. **Fijar versión**: arrancá el servidor con `uvx free-search-mcp==0.18.0` (o el plugin, que fija la versión). El historial lo justifica: 0.4.2 no se podía instalar (SDK v2) y 0.13.1 dejó de arrancar por `selectolax` 1.0.
2. **`depth` explícito** en `research` (por ejemplo 3 a 4) y medir recall contra latencia. Con la extracción en hilo aparte de 0.16, páginas adicionales cuestan menos que antes.
3. **Pasar `category`** con un mapeo determinista desde `need` (`software.*`, `security.*`, `paper.*`, `finance.*`, `weather`, `docs.*`…). Los registros llegan con la fecha del publicador, y el ruteo por claims ya funciona sin categoría para versiones, CVE, FX, clima y hora.
4. **Probar cómo se ve un registro dentro de `research`** (`research("latest fastapi version")`). Tu `snippetChunks` descarta extractos de menos de 40 caracteres (`CHUNK_FLOOR`); un registro corto como «fastapi X.Y.Z en PyPI (fecha)» podría perderse. [no confirmado: no vi la salida real de `research` para un registro]
5. **Pasar a `format="json"`** si querés robustez de parseo: trae `sources`, `documents`, `errors`, `tokens_estimated` y, en `search`, `dated`, `date_source`, `benched_engines`, `rescued_via`, `auto_routed`, `timed_out_engines`, `gated_engines`, `filter_diagnostics`. La forma exacta de `documents` no está documentada: mirá una salida real antes.
6. **Distinguir mejor «no hay resultados» de «no se pudo buscar»** con las nuevas señales: `gated_engines`/`gated_hint`, `benched_engines`, `agent_lane.errors` y los mensajes de error reales (navegador no arrancó, `internal error (<Tipo>)` = fallo del servidor). Hoy tu clasificación depende de la regex `NO_RESULTS`.
7. **Fechas dudosas**: Free Search distingue `structured` de `snippet`. Si `research` marca `(from snippet text)` junto a `_published`, tu regex lo trata como fecha segura. [no confirmado] Revisalo en una muestra.
8. **Plazos**: tus 150 s son holgados. Ahora hay una espera de 10 s al motor más lento (`SEARCH_MCP_SEARCH_DEADLINE_SECONDS`), 6 s de lane, 30 s de lanzamiento de navegador y 20 s de enfriamiento. Podés ajustar `RETRY_NEEDS_MS` / `JUDGE_NEEDS_MS` con datos medidos.
9. **Frescura vs. caché**: para necesidades sensibles al tiempo bajá `max_age_hours` (por ejemplo 1 a 6 h). `weather` y `finance.fx` ya vencen a la hora, `software` y `security` a las 6 h.

### C. Decisiones de diseño que dependen de tu política
- **Agent lane / `codex`**: sumaría un motor más con índice de OpenAI y hasta 6 s de latencia, y cada búsqueda cuenta contra el uso de tu plan de Codex. Sus resultados se funden con el ranking. Tu BM25 + juez los evaluaría igual, pero decidí si querés que tu `need` salga hacia OpenAI.
- **Agente de respuesta en `search`**: es un modelo generativo leyendo páginas. Tu diseño lo evita; mientras llames solo a `research` y `fetch`, y no definas `SEARCH_MCP_AGENT_BACKEND`, no interviene. Si lo definís por otra razón, poné `SEARCH_MCP_AGENT_IN_SEARCH=false`, y la herramienta `ask` que aparece queda fuera de tu lista blanca.
- **Salida de datos del query (Guard de egress)**: sin lane, tu consulta puede llegar a DuckDuckGo, Bing, Yahoo! JAPAN y AnySearch (y a las reservas `yahoo`, `seznam`, `so360`, `brave` si hacen falta; con `codex`, también a OpenAI). Tu Guard debería asumir ese conjunto de destinos.
- **Región**: `SEARCH_MCP_REGION` toma un token `cc-lang` (por defecto `us-en`). Para español de Argentina probá `ar-es` [no confirmado el valor exacto]. Los motores por idioma automáticos solo existen para chino (`so360`, `quark`) y coreano (`naver`); el español usa el pool general.
- **EEE/Reino Unido**: si tu servidor corre allí, `yahoojp` puede quedar apartado por la puerta `region`.

### D. Herramientas del MCP que no usás y podrías sumar a `WEB_DEPENDENCIES`
| Tool | Para qué te serviría |
|---|---|
| `cache_search` | preguntas de seguimiento sobre páginas ya descargadas, sin red |
| `extract_structured` | precio, autor, fecha, rating desde JSON-LD/OpenGraph como campos |
| `paper_graph` | chequear DOI, retractaciones y citas antes de afirmar algo científico |
| `read_doc` | PDFs largos con paginación (`start`/`length`) |
| `engines` | listar el árbol de fuentes una vez, para armar tu mapeo `need → category` |

### E. Cosas que NO conviene hacer
- No nombrar `engines` por defecto (apaga el ruteo, el breaker y el rescate).
- No subir `max_results` más de ~20 esperando mejor recall.
- No tratar un snippet, un bloque `## Answer` ni `freshness` como prueba de que algo es reciente: mirá `dated: N/M` y `date_source`.
- No exponer el endpoint HTTP sin autenticación (`--transport streamable-http`): hace fetch de cualquier URL.
