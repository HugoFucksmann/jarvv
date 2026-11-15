# free-search-mcp 0.18.0 — Referencia resumida

- Publicada en PyPI el 31/10/2026 · Python ≥ 3.11 · MIT · Beta
- Servidor MCP local, búsqueda general sin API keys. Protocolo MCP 2026-07-28 (un `initialize` legacy negocia 2025-06-18). SDK fijado: `mcp[cli]>=2.2.0,<2.3`.
- Ejecución: `uvx free-search-mcp` · fijar versión: `uvx --from free-search-mcp==0.18.0 free-search-mcp`
- Transportes: `stdio` (default) · `uvx free-search-mcp --transport streamable-http --port 8000` → `http://127.0.0.1:8000/mcp` (sin auth; solo loopback o proxy con auth)
- Otras vías: plugin Claude Code/Codex, `.mcpb` (Claude Desktop), Docker, MCP Registry `io.github.sweetcornna/free-search-mcp`
- Chromium opcional: `uvx --from free-search-mcp playwright install chromium` (si falta, el error devuelve este comando)

---

## Tools (11 + `ask` opcional)

### Búsqueda e investigación

| Tool | Firma | Salida |
|---|---|---|
| `search` | `search(query, engines?, max_results?, freshness?, include_domains?, exclude_domains?, category?, include_text?, exclude_text?, max_age_hours?, format?)` | Ranking RRF deduplicado, `lead_snippet` extractivo opcional |
| `research` | `research(question, depth?, ...filtros de search)` | Informe Markdown: fuentes + cuerpos completos |
| `paper_graph` | `paper_graph(paper, direction?, limit?)` | Referencias, citas (por influencia), avisos Crossref de retractación/corrección. `paper` = DOI, ID OpenAlex, título exacto o arXiv (`arXiv:1706.03762`, URL abs, DOI `10.48550/arXiv.*`, id suelto) |
| `compare` | `compare(question, urls=[2..5])` | Extractos lado a lado según la pregunta |

### Recuperación y lectura

| Tool | Firma | Salida |
|---|---|---|
| `fetch` | `fetch(url, render?, inline?, ...)` | Markdown (página), texto (documento) o descripción tipo/tamaño/dimensiones/SHA-256 (imagen/binario). `inline=True` devuelve la imagen. Si trunca: recurso `cache://page/...` |
| `fetch_batch` | `fetch_batch(urls, ...)` (máx 20) | Igual que `fetch`, concurrente |
| `read_doc` | `read_doc(source, start?, length?, ...)` | PDF, DOCX, XLSX, PPTX, EPUB, CSV, código, ZIP/TAR (solo lista), HTML, TXT, MD, JSON/XML/YAML por content-type. Paginado |
| `extract_structured` | `extract_structured(url, ...)` | JSON-LD, OpenGraph, Twitter Cards, Microdata. Campos largos (`articleBody`…) se recortan; `trimmed` indica el largo original. No da texto completo |

### Caché, motores, archivos

| Tool | Firma | Función |
|---|---|---|
| `cache_search` | `cache_search(query, limit?, ...)` | FTS5 sobre páginas ya descargadas (no usa Internet) |
| `engines` | `engines(group?)` | Árbol de fuentes grupo → subgrupo → motor. `group` es enum: un typo falla en validación |
| `download` | `download(url, ...)` | Guarda en `${SEARCH_MCP_CACHE_DIR}/downloads`, borrado a 24 h, máx 100 MB. Escribe en disco |

### `ask` (solo con backend de IA)

`ask(question, freshness, include_domains, category)`. Corre `research`, el modelo puede llamar `search`/`fetch`/`read_doc`, devuelve respuesta breve + fuentes. En Python también `ask(question, answer_with=...)`.

### Prompts y recursos MCP

- 5 prompts MCP.
- Resource templates: `cache://page/{url}`, `cache://search/{query_hash}`.

---

## Parámetros de filtro (`search` / `research`)

| Param | Valores / efecto |
|---|---|
| `freshness` | `day` \| `week` \| `month` \| `year`. Resultados sin fecha se conservan; `freshness_note` avisa. `day`/`week` añaden `googlenews` |
| `include_domains` / `exclude_domains` | listas de dominios |
| `category` | grupo o subgrupo (el enum del schema lista todos). Enruta a fuentes que indexan ese tipo y duplica el peso de esas fuentes en RRF |
| `include_text` / `exclude_text` | substring requerido / prohibido en título o snippet |
| `max_age_hours` | acepta caché solo si es más joven. Gana el menor entre este valor, TTL de `freshness`, tope de news (6 h) y tope de categoría (`weather`, `finance.fx` 1 h; `software`, `security` 6 h). Default 7 días |
| `engines` | lista exacta de motores a usar |
| `format` | `markdown` (default) \| `json` |

Categorías: `paper` (`.index`, `.preprint`, `.biomed`, `.cs`, `.openaccess`, `.trial`, `.math`), `finance` (`.filings`, `.market`, `.macro`, `.fx`, `.entity`, `.crypto`), `news` (`.world`), `software` (`.python`…), `security`, `dataset` (`.repository`, `.ml`, `.gov`), `image`, `github`, `forum`, `weather`, `docs.web`, `docs.rfc`, `reference`, `gov`, `stats`, `calendar`.

Auto-routing: sin `category` ni `engines`, fuentes de registros (`pypi`, `nvd`, `openmeteo`…) se suman solas si pueden responder (máx `SEARCH_MCP_CLAIM_ENGINE_LIMIT`; apagar con `SEARCH_MCP_AUTO_ROUTE_ENABLED=false`). Se reportan en `auto_routed`.

---

## Formato de salida

- Markdown por defecto (cabecera con procedencia y estimación de tokens). JSON sin envolver en `result`, salvo listas.
- Errores accionables llegan al cliente como `ToolError`; cualquier otra excepción llega como `internal error (<Type>)`.

Campos de procedencia/diagnóstico:

| Campo | Significado |
|---|---|
| `retrieved_at` | Momento de consulta |
| `cache_age_seconds` | Antigüedad del cacheado |
| `dated_results` / `date_source` | Resultados con fecha / origen (estructurado, snippet, ninguno) |
| `source_type` | Tipo de fuente |
| `freshness_note` | Aviso de muchos resultados sin fecha |
| `usage_note` | Snippets = indicios, no pruebas |
| `timed_out_engines` | Motores que superaron el deadline |
| `auto_routed` | Fuentes de registros añadidas por auto-routing |
| `agent_lane` | Estado de motores agent lane: `answered`, `missing`, `left_out`, `benched`, `rate_limited` |
| `lane_missing` | Fila cacheada sin algún motor del lane (se repite máx 1 h) |
| `agent` (JSON) / `## Answer` (Markdown) | Respuesta del backend de IA, si está configurado |

Regla: usar snippets solo para hallar fuentes; confirmar con `fetch`/`research`.

---

## Motores

- **Pool default:** `duckduckgo`, `bing`, `yahoojp`, `anysearch`
  - `yahoojp` falla en servidores del EEA/UK (muro `region`): quitarlo del pool en esos casos.
- **Reserva (orden):** `yahoo`, `seznam`, `so360`, `brave` — entran con < 3 saludables.
- **Contextuales:** `googlenews` (recencia), `so360` + `quark` (chino), `naver` (coreano).
- **Rescue** (staggered race, máx 2 candidatos en vuelo): reserva → `youcom` → `baidu`. El primero útil gana y cancela el resto.
- **Extra por nombre:** `youcom`, `baidu`, `bilibili`, `zhihu`, `wikipedia`, `openlibrary`.
- **Fuentes de registros (keyless, por `category` o auto-route):** arXiv, OpenAlex, Crossref, PubMed, Europe PMC, DBLP, DOAJ, zbMATH, SEC EDGAR, Yahoo Finance, CNINFO, World Bank, IMF, Frankfurter, PyPI, npm, Crates, Endoflife, GitHub Releases, NVD, OSV, CISA KEV, Dryad, Dataverse, Figshare, Hugging Face, Zenodo, Data Europa, Openverse, Wikimedia, MDN, IETF, Open-Meteo, Wikidata, RDAP.
- **Eliminados en 0.17.0** (dan error "unknown engine" en esa búsqueda si están en config): `mojeek`, `google`, `serpsearch`, `startpage`, `searx`, `sogou`.

### Opt-in con cuenta o key (solo si la llamada los nombra)

| Motor | Requiere |
|---|---|
| `codex` | Sign-in ChatGPT con Codex (consume cuota del plan). Único que entra solo al pool vía agent lane |
| `antigravity` | Sign-in Google Antigravity. **Prohibido por Google, riesgo de suspensión; no usar.** Solo entra al lane si `SEARCH_MCP_AGENT_ENGINES` lo nombra |
| `brave_api` | `SEARCH_MCP_BRAVE_API_KEY` |
| `serper` | `SEARCH_MCP_SERPER_API_KEY` |
| `tavily` | `SEARCH_MCP_TAVILY_API_KEY` |
| `google_cse` | `SEARCH_MCP_GOOGLE_CSE_API_KEY` + `SEARCH_MCP_GOOGLE_CSE_CX` |
| `github_code` | `SEARCH_MCP_GITHUB_TOKEN` |
| `serpbase` | `SEARCH_MCP_SERPBASE_API_KEY` |
| `semanticscholar` | key opcional |

Sign-in codex: `uvx --from free-search-mcp search-mcp-login codex` (`status`, `logout codex`, `--no-browser`, `--use-codex-cli`). Tokens en `~/.config/search-mcp/oauth/`. El agent lane nunca abre la página de sign-in. Panel local: `search-mcp-admin` → `http://127.0.0.1:8765`.

---

## Agent lane (0.18.0)

- Con `codex` firmado y `SEARCH_MCP_AGENT_ENGINES=auto`, corre en paralelo con el pool en búsquedas sin `engines`.
- Pasa por el guard de coherencia y se fusiona en RRF. Espera máx 6 s (`AGENT_LANE_WAIT_SECONDS`); tras tener resultados keyless, máx 2 s más (`AGENT_LANE_GRACE_SECONDS`). Si termina tarde, se mezcla en la caché.
- Respuestas dudosas (sin confirmación) se descartan si hay resultados keyless; 3 seguidas lo bencan.
- Valores de `AGENT_ENGINES`: `auto` (default) · `off` · lista (`codex,antigravity`).

## Backend de IA (opcional)

- Con `SEARCH_MCP_AGENT_BACKEND` (`claude-code`\|`codex`\|`api`), `search` ejecuta el agente junto a los motores y antepone `## Answer` (JSON: `agent`). Desactivar: `SEARCH_MCP_AGENT_IN_SEARCH=false`.
- Búsquedas `image` y `dataset` no usan el agente. Si el agente falla, la búsqueda no falla.

---

## Configuración (prefijo `SEARCH_MCP_`)

Prioridad: entorno → `./.env` → `~/.config/search-mcp/.env` (`CONFIG_DIR` cambia el directorio).

| Variable | Default |
|---|---|
| `TOOLS` | vacío = todas |
| `TRANSPORT` / `HTTP_HOST` / `HTTP_PORT` / `HTTP_PATH` | `stdio` / `127.0.0.1` / `8000` / `/mcp` |
| `DEFAULT_ENGINES` | `["duckduckgo","bing","yahoojp","anysearch"]` |
| `RESERVE_ENGINES` | yahoo, seznam, so360, brave |
| `RESCUE_ENGINES` / `RESCUE_ENABLED` / `RESCUE_STAGGER_SECONDS` | youcom, baidu / `true` / — |
| `MIN_HEALTHY_ENGINES` | 3 |
| `SEARCH_DEADLINE_SECONDS` | 10 |
| `HEALTH_ENABLED` / `ENGINE_COOLDOWN_SECONDS` / `_MAX_SECONDS` | `true` / 600 / 3600 |
| `COHERENCE_GUARD_ENABLED` | `true` |
| `CACHE_DIR` / `CACHE_TTL_SECONDS` / `CACHE_MAX_MB` | `~/.cache/search-mcp` / 604800 / 512 |
| `FETCH_STRATEGY` | `auto` |
| `MAX_CONTENT_CHARS` | 50000 |
| `BROWSER_HEADLESS` / `BROWSER_POOL_SIZE` | `true` / 2 |
| `DOWNLOAD_ENABLED` / `_DIR` / `_TTL_HOURS` / `_MAX_MB` | `true` / cache/downloads / 24 / 100 |
| `PROXY` / `PROXY_ENGINES` | vacío / vacío |
| `REGION` | `us-en` |
| `AGENT_ENGINES` / `AGENT_LANE_WAIT_SECONDS` / `AGENT_LANE_GRACE_SECONDS` | `auto` / 6 / 2 |
| `CODEX_MODEL` / `CODEX_TIMEOUT` / `CODEX_AUTO_SIGNIN` | `latest` / 60 / `true` |
| `AGENT_BACKEND` | vacío |
| `AGENT_MODEL`, `AGENT_API_PROTOCOL`, `AGENT_API_BASE_URL`, `AGENT_API_KEY`, `AGENT_DEPTH`, `AGENT_MAX_STEPS`, `AGENT_TIMEOUT_SECONDS`, `AGENT_IN_SEARCH` | — |

Ollama como backend: `AGENT_API_BASE_URL=http://localhost:11434/v1`.

## Comportamiento relevante

- **Circuit breaker:** CAPTCHA/muro/off-topic → desactiva al instante; 2 errores seguidos → desactiva; 3 vacíos seguidos → 10 min (escala a 60); un éxito lo restablece.
- **Caché:** SQLite + FTS5, TTL 7 días. Sin `max_age_hours`/`freshness` puede devolver datos viejos.
- **Fetch:** HTTP primero, Playwright si hace falta; Trafilatura → Markdown.
- **SSRF guard:** `fetch` bloquea hosts privados, loopback, metadata cloud y nombres internos (`localhost`, `*.local`, `*.internal`…). Ajustes: `ALLOW_PRIVATE_HOSTS`, `SSRF_RESOLVE_ADDRESSES` (`auto`\|`always`\|`never`).

## Migración 0.13.1 → 0.18.0

1. Quitar motores eliminados de `DEFAULT/RESERVE/RESCUE_ENGINES`.
2. Quitar `SEARCH_MCP_SEARX_INSTANCES`.
3. Revisar parser de salida: nuevos `agent_lane`, `lane_missing`, `auto_routed`, `agent`/`## Answer`.
4. Tras actualizar: listar tools y llamar `engines()`.
5. 0.13.1 puede fallar al instalar por Selectolax 1.0 (corregido en 0.14.0).
6. Con `codex` firmado, el lane se activa solo (`AGENT_ENGINES=auto`): poner `off` si no se quiere gasto de cuota.

## Limitaciones

- Beta; disponibilidad de motores depende de región, IP, cuotas y salud.
- Resultados pueden venir sin fecha o incompletos.
- Algunas fuentes necesitan API key o Chromium.
- `download` escribe en disco; HTTP transport sin auth.