# Revisión de la tool `web_search` (basada en Free Search MCP)

> **Estado al 2026-11-13.** Esta revisión se hizo sobre la versión anterior de la tool (`research` + Markdown). La tool ahora usa `search` + `fetch` en JSON y se evaluó con datos reales: ver `scripts/validate/web_eval/RESULTADOS.md`. Estado de cada hallazgo:
>
> | Estado | Hallazgos |
> |---|---|
> | Resuelto | H-01 (el reintento sin filtros se avisa al modelo), H-02 (contrato JSON, formato desconocido = error visible), H-03 (`terms` eliminado, también del manifiesto), H-04 (`searchQuestion` solo actúa si el `need` empieza con un verbo de búsqueda; «en Google Maps» se conserva), H-05 (un título es contenido: solo se descartan `Menu`, `Back to top`, publicidad), H-06 (título colgado), H-08 (se cuentan páginas leídas), H-09 y H-20 (el esquema de la tool declara `maxLength`/`maxItems` y su descripción es la del manifiesto; un test lo comprueba), H-11 (un exponente u ordinal de `<sup>` se conserva: `10^9`; una nota al pie se quita), H-12 (código muerto quitado), H-13 (plazo y «Tool budget used up»), H-14 (un reintento fallido conserva el primer resultado), H-15 (la fecha de `fetch` sale de `published_date`), H-17 (juez encendido por defecto, `meta.judge.mode`), H-18 (la fecha se califica `structured`/`snippet`; el juez ve la de hoy y la de cada fuente), H-16 (la página cortada por Free Search se avisa y, si no hubo respuesta, se lee el resto con `read_doc`), H-19 (un extracto que la página de su misma fuente ya contiene se descarta y queda el texto de la página) |
> | Parcial | H-07 (el presupuesto y el máximo de fragmentos no se afinaron), H-10 (se quitaron `sea` y `era` de las palabras vacías; `las`, `del`, `son` siguen) |
> | Pendiente | H-21 (un lote fallido del juez descarta las puntuaciones de los otros; en 41 casos reales no hubo ni un fallo del juez, así que no se tocó) |
>
> Cifras de la revisión original (líneas, flujo) corresponden al código anterior.


*Documento vivo. Alcance: solo la tool `web_search` (provider `jarvis_web`). Revisión estática: no se ejecutó código ni tests y no se modificó nada.*

## 1. Estado de la revisión

**Archivos revisados:** `webSearchProvider.ts`, `args.ts`, `bm25.ts`, `chunks.ts`, `report.ts`, `provider.ts`, `judge.ts`, `result.ts`, `text.ts`, `decision.ts`, `server.ts`; esquema de entrada de `research` y `fetch` y formato de salida de `fetch` de Free Search; una traza de ejecución (`trace.json`, tarea "busca el ultimo modelo de GPT").

**Estado: revisión cerrada.** Quedan tres puntos que no se pudieron contrastar con el material recibido (manifiesto de la tool, valor de `webSearchUseJudge` en la ejecución de la traza y texto real del error de "sin resultados"); están en la sección 4.

Los hallazgos marcados **\[Confirmado\]** salen solo del código recibido. Los marcados **\[Por verificar\]** dependen de archivos que aún no tengo y se confirmarán o descartarán en la segunda fase.

## 2. Cómo funciona (resumen)

1. `parseArgs` valida (rechaza, no corrige) `need`, `terms`, `urls`, `freshness`, `domains`. `searchQuestion` quita la orden ("Buscá en internet…") de `need`.
2. `gather`: con `urls` llama a `free_search.fetch` en paralelo (una fuente por URL); si no, llama a `free_search.research` con `question`, `max_age_hours` y, si hay filtros, `freshness` / `include_domains`. `parseResearch` / `parseFetch` convierten el Markdown devuelto en fuentes y documentos.
3. `chunkDocs` limpia (navegación, banners, duplicados entre fuentes) y parte en fragmentos de 500–800 caracteres repitiendo el último título; `snippetChunks` añade el extracto del buscador como fragmento extra.
4. `rank` (BM25 + cobertura IDF) y `pickCandidates` (máx. 15, 3 por fuente, sin casi repetidos, cobertura ≥ 0,15).
5. Con juez inyectado: probabilidades (≥ 0,6 `found`, ≥ 0,3 `partial`). Sin juez o si falla: `byCoverage` (cobertura ≥ 0,34, nunca pasa de `partial`).
6. Si el resultado es `not_found` / `no_results` y había filtros, se repite una vez sin filtros. `compose` arma el texto (máx. 1700 caracteres de fragmentos) y los metadatos.

## 3. Hallazgos

Severidad: **Media** = puede dar al modelo información engañosa o degradar el resultado sin aviso; **Baja** = comportamiento incorrecto en casos acotados; **Info** = código muerto o inconsistencia sin efecto actual.

### H-01 · Media · \[Confirmado\] · El reintento sin filtros no se comunica al modelo y los metadatos quedan inconsistentes

**Dónde:** `webSearchProvider.ts`, `callTool` (líneas 164–191) y `compose`.

**Qué pasa:** cuando el intento con `freshness` / `domains` no da resultado, se repite sin filtros. El `text` que ve el modelo no menciona que los filtros se descartaron; solo `data.retried` lo registra. Si el usuario pidió un sitio concreto (`domains`) o datos recientes (`freshness`), el modelo recibe fuentes de otros sitios o antiguas como si cumplieran lo pedido.

**Confirmado con `result.ts`:** al modelo solo le llega `content[0].text`. `data` lo lee el núcleo y `_meta` es solo traza ("nunca va a los modelos"), de modo que `retried` y `filters` no son visibles para el modelo.

**Inconsistencias adicionales:**

- `retried = true` se fija antes de decidir si el reintento se usa; si la condición de la línea 187 no se cumple se conserva el resultado filtrado original y `data.retried` queda en `true` igualmente.
- `meta.filters` siempre refleja los filtros pedidos, aunque el material mostrado provenga del reintento sin filtros.

### H-02 · Baja · \[Confirmado en código; formato actual compatible\] · La detección de formato no reconocido es incompleta

**Dónde:** `report.ts`, `parseResearch`.

**Qué pasa:** el encabezado del archivo promete que un cambio de formato de Free Search se avisa (`format: "unrecognized"`) para no degradar en silencio. Pero esa marca solo se activa si falta el prefijo `# Research brief` o `## Sources`. Si esos marcadores existen y el resto no se puede leer, el resultado es `format: "brief"` sin advertencia:

- `DOC_HEAD` exige exactamente `<url> · ~<dígitos> tokens`; cualquier variación (p. ej. separador de miles, otra unidad) hace que ningún documento se segmente y todo el cuerpo de `## Documents` se descarta (`current` queda `undefined`).
- `SOURCE_HEAD` exige `- [n] **título** — <url>`; si no coincide, `sources` queda vacío.

**Consecuencia:** `analyze` ve `docs` vacío, y la tool responde `no_results` ("nothing was found") o `not_found` aunque Free Search sí devolvió material; el modelo concluye que no hay datos. Falta una advertencia cuando `## Documents` / `## Sources` existen pero no se extrajo ningún elemento.

**Misma carencia en `fetch`:** `parseFetch` nunca marca formato no reconocido. Según el formato documentado, el cuerpo va después de la línea `_fetched via …`; si ese marcador falta, todo el texto (título, URL y líneas de procedencia incluidos) se toma como cuerpo sin ninguna advertencia.

**Actualización con la traza:** el brief real (`# Research brief: …`, línea `_engines … · sources: N · ~T tokens_`, fuentes con `_published … · page cached … ago_` y extracto `> …`) es compatible con el parser: en la traza se leyeron fuentes, fechas, extractos y páginas completas. El riesgo queda limitado a cambios futuros de formato, por eso baja de Media a Baja.

### H-03 · Media · \[Confirmado\] · `terms` nunca se envía a Free Search

**Dónde:** `webSearchProvider.ts`, `gather` (líneas 237–240); esquema `TOOL`.

**Qué pasa:** la descripción de `terms` dice "keywords in the language the sources are likely written in", y `bm25.ts` asume que los `terms` son "la misma pregunta en el idioma de las fuentes". Pero la petición a `research` solo lleva `question: need`; los `terms` únicamente reordenan localmente lo que ya se recuperó. Si `need` está en español y las fuentes relevantes en inglés, la búsqueda en sí no se beneficia de los `terms`, que es para lo que el esquema dice que sirven.

**Verificado con el esquema de `research`:** no existe un parámetro de palabras clave. Los parámetros son `question`, `depth`, `engines`, `fetch`, `use_cache`, `max_age_hours`, `freshness`, `include_domains`, `exclude_domains`, `category`, `include_text`, `exclude_text` y `format`; la tool solo usa `question`, `max_age_hours`, `freshness` e `include_domains`. Los `terms` hoy no llegan al buscador, así que la promesa del esquema de la tool (palabras clave en el idioma de las fuentes) no se cumple en la búsqueda, solo en el reordenamiento local.

### H-04 · Baja · \[Confirmado\] · `searchQuestion` elimina palabras con significado y no es tan conservador como declara

**Dónde:** `args.ts`, `searchQuestion`.

- La limpieza final de "en internet / en la web / on the web / in Google / online" se aplica **sin exigir** un verbo de búsqueda al inicio. Ejemplos: "How do cookies work on the web?" → "How do cookies work?"; "free JSON formatter online" → "free JSON formatter".
- Al inicio, tras el verbo, "en Google" se quita aunque forme parte de un producto: "Busca en Google Maps cómo…" → "Maps cómo…" (la anticipación solo exige que no siga una letra, y sigue un espacio).

El comentario de la función afirma que solo quita la orden y la mención del medio; en estos casos cambia el sentido de la pregunta que llega al buscador, a BM25 y al juez.

### H-05 · Baja · \[Confirmado\] · Los filtros de navegación también eliminan títulos legítimos

**Dónde:** `chunks.ts`, `cleanLines`.

`label` es el texto sin los `#` iniciales, y sobre él se aplican `NAV_LABEL`, `NOTICE` y `ACTION`. Un título como `## Search`, `# Cookies`, `## Newsletter`, `## Sign in` o `## Privacy policy` se descarta como si fuera navegación. En documentación técnica (una API con sección "Search", una página sobre cookies) se pierde el título y los fragmentos siguientes repiten el título anterior, lo que va contra el objetivo declarado de que cada fragmento conserve su contexto.

### H-06 · Baja · \[Confirmado\] · Un título colgado se pierde al llegar otro título con el fragmento ya ≥ `CHUNK_MIN`

**Dónde:** `chunks.ts`, `chunkLines`, rama de títulos.

La documentación de la función dice que un título suelto al final de un fragmento pasa al siguiente. Pero si el título A se añade (`trailing = 1`) y eso lleva `length` a ≥ 500, el siguiente título B ejecuta `flush([])`, no `flush(carry())`: `flush` excluye los títulos colgantes del fragmento y, al no recibirlos como semilla, A desaparece de la salida.

### H-07 · Baja · \[Confirmado\] · Se descartan sin aviso fragmentos que superaron el umbral del juez y `RETURN_MAX = 4` es prácticamente inalcanzable

**Dónde:** `webSearchProvider.ts`, `compose`; constantes `RETURN_MAX`, `PASSAGES_BUDGET`; `chunks.ts` (`CHUNK_MIN`/`CHUNK_MAX`).

Con fragmentos de 500–800 caracteres y un presupuesto de 1700, normalmente caben 2 (a veces 3); cuatro solo serían posibles con fragmentos cortos o extractos. Los fragmentos válidos que no caben se omiten sin indicarlo en el texto (`status` cuenta solo los mostrados). Las dos constantes no están alineadas.

### H-08 · Baja · \[Confirmado\] · "N sources read" cuenta fuentes listadas, no leídas

**Dónde:** `webSearchProvider.ts`, `compose`, caso `not_found` (línea 344).

Usa `sources.length || docs.length`. En modo `research`, `sources` son las que el buscador listó; los documentos realmente leídos pueden ser menos (o ninguno, si solo hubo extractos). Según el esquema de `research`, `depth` por defecto es 3 (páginas que se leen) y la tool no lo envía, así que la lista de fuentes puede superar con facilidad las páginas leídas. El mensaje afirma que se leyeron.

### H-09 · Baja · \[Confirmado\] · El esquema de entrada no declara los límites que `parseArgs` impone

**Dónde:** `webSearchProvider.ts` (`TOOL.inputSchema`) vs `args.ts`.

`parseArgs` rechaza más de 10 `terms`, de más de 60 caracteres cada uno, más de 5 `domains`, URLs de más de 500 caracteres. El esquema solo menciona 300 caracteres para `need` y 5 para `urls`, y solo en las descripciones (sin `maxLength` / `maxItems`). Como la política es rechazar y no corregir, el modelo falla por reglas que no podía conocer.

### H-10 · Baja · \[Confirmado\] · La lista de palabras vacías mezcla español e inglés y elimina palabras con contenido

**Dónde:** `bm25.ts`, `STOP`.

Varias palabras vacías de un idioma son palabras con contenido en el otro: `sea` ("sea level"), `era` ("Victorian era"), `son`, y nombres propios como `las` ("Las Vegas") o `del`. Se descartan de la consulta y, por tanto, del cálculo de cobertura.

### H-11 · Baja · \[Confirmado\] · `visibleText` elimina por completo el contenido de `<sup>` y el texto deja de ser literal

**Dónde:** `chunks.ts`, `visibleText`.

Se borra todo `<sup>…</sup>` pensando en notas al pie, pero también se usa para exponentes y ordinales (`10<sup>9</sup>` → `10`). Esto contradice la afirmación del encabezado de que el texto del fragmento es literal de la página, y puede cambiar una cifra.

### H-12 · Info · \[Confirmado\] · Rama inalcanzable en `chunkLines`

**Dónde:** `chunks.ts`, rama de títulos: `if (content && length + 1 + heading.length > CHUNK_MAX) flush([])`.

Tras la primera condición (`content && length >= CHUNK_MIN` ya hizo `flush`), si `content` sigue siendo `true` entonces `length < 500`; con `heading.length ≤ 101` la suma nunca supera 800. Con las constantes actuales es código muerto.

### H-13 · Media · \[Confirmado\] · Las llamadas a Free Search no tienen plazo propio

**Dónde:** `webSearchProvider.ts`, `callTool` y `gather`; `provider.ts`, `ToolHost.call`.

`ToolHost.call` acepta solo `signal` como opción; `timeoutMs` ("el techo de cuánto puede esperar la llamada") llega únicamente al proveedor. `callTool` calcula `deadline`, pero solo lo usa para decidir si queda tiempo para el juez y para el reintento: ni `research` ni `fetch` reciben un plazo. Si Free Search tarda, la tool no puede degradar con gracia antes del techo del motor. La guarda `remaining() > RETRY_NEEDS_MS` solo asegura 30 s al iniciar el reintento y nada limita cuánto dura después. `host.call` sí acepta un `signal`, por lo que se podría derivar uno a partir del tiempo restante.

**Agravante (esquema de `fetch`):** `render` es `auto` por defecto: Free Search prueba HTTP y, si falla, recurre a un Chromium sigiloso, más lento. La tool no fija `render` ni plazo, de modo que una página que requiera navegador puede consumir buena parte del presupuesto sin que `callTool` pueda reaccionar.

### H-14 · Baja · \[Confirmado\] · Una excepción en el reintento descarta el resultado del primer intento

**Dónde:** `webSearchProvider.ts`, `callTool` (líneas 180–191) y `gather`.

El reintento corre dentro del mismo `try` que el intento principal, y en modo `research` `gather` no captura las excepciones de `host.call`. Si el reintento lanza (red, caída de Free Search), el `catch` devuelve `Web search failed: …` y se pierde el `analysis` del primer intento, que ya era un resultado válido (`not_found` o `no_results`). Un paso opcional termina convirtiendo la respuesta en error.

### H-15 · Baja · \[Confirmado\] · `parseFetch` busca la fecha también en la línea del título

**Dónde:** `report.ts`, `parseFetch`.

La regex `published\s+AAAA-MM-DD` se aplica a todas las líneas anteriores a `_fetched via`, que incluyen `# título` y `<url>`. Según el formato documentado, la fecha va solo en la línea del sitio (`_{sitename} · published {fecha}_`). Un título que contenga "published 2021-05-01" produciría una fecha de publicación falsa, justo el dato que `plausibleDate` quiere evitar dar mal.

### H-16 · Baja · \[Confirmado\] · Se ignora el indicador `truncated` de `fetch`

**Dónde:** `report.ts`, `parseFetch`; `webSearchProvider.ts`, `compose`.

La línea `_fetched via … · truncated` indica que Free Search cortó la página. `parseFetch` descarta esa línea completa y no existe advertencia en el resultado. Un `not_found` o `partial` sobre una página truncada no le dice al modelo que parte del contenido no se leyó. (`warnings` solo cubre formato no reconocido y, además, vive en `_meta`, que el modelo no ve.)

### H-17 · Media · \[Confirmado en traza; causa acotada a dos opciones\] · El juez no intervino en la búsqueda de la traza

**Evidencia (`trace.json`, llamada `c1`):**

- El texto devuelto dice "These passages match the keywords of the question…", que solo se emite cuando `analysis.judge` no es `used` (`compose`).
- `jarvis_web.web_search` tardó 3014 ms y su sub-llamada `free_search.research` 2998 ms: quedan unos 16 ms para parsear, partir, ordenar con BM25 y armar el resultado. Es incompatible con una consulta al modelo de 2B (la etapa `verify`, con el mismo modelo `d3:2b`, tardó 500 ms).
- La lista `queries` no muestra etapa de juez, pero este dato no es concluyente: `score` llama a `systemOne` directamente y su traza viaja en `_meta`, que la traza recibida no incluye.

**Qué implica:** `server.ts` solo inyecta el juez si la configuración lo enciende: `judge: () => (getConfig().webSearchUseJudge ? decisionEngine : undefined)`. Quedan dos explicaciones: (a) `webSearchUseJudge` estaba en `false`, la más simple, porque la etapa `verify` muestra que el servicio de decisión respondía; o (b) `score` falló de inmediato (por ejemplo, el guarda de `decisionMaxContext` en `systemOne` lanza antes de hacer la petición) y `byCoverage(…, "failed")` produjo el mismo texto. Con (a) la ruta del juez y el estado `found` están inactivos por configuración; con cualquiera de las dos, el modelo recibe el mismo aviso y no puede distinguirlas. El valor de `webSearchUseJudge` en esa ejecución (o su valor por defecto en `ConfigManager`) lo resuelve.

### H-18 · Media · \[Confirmado en traza\] · Las fechas `published` que entrega Free Search no son la fecha original y la tool las presenta como tal

**Dónde:** `report.ts` (`plausibleDate`, `parseResearch`), `chunks.ts` (`snippetChunks`), `compose`.

En la traza, la fuente \[1\] trae `_published 2026-09-09` y su extracto empieza con "2025/8/7"; la fuente \[2\] trae `_published 2026-10-23`, su extracto empieza con "2025/8/13" y el propio texto dice que GPT-5 salió el 7 de agosto de 2025. La tool escribe `(published 2026-10-23)` en la línea de la fuente y dentro del fragmento de extracto. `plausibleDate` solo descarta fechas imposibles (futuras o anteriores a 1991), no detecta fechas contradichas por el propio extracto. Resultado: contenido de 2025 llega al modelo etiquetado como publicado hace semanas, justo en consultas de tipo "último" o "¿cuándo salió…?", para las que el encabezado de `report.ts` dice que la fecha es la respuesta. El origen del desajuste puede estar en Free Search (parece una fecha de modificación o de rastreo), pero la tool lo rotula "published" sin cuestionarlo.

### H-19 · Baja · \[Confirmado en traza\] · El extracto del buscador y el fragmento de la misma página no se detectan como repetidos

**Dónde:** `bm25.ts`, `pickCandidates` (`jaccard`, `NEAR_DUPLICATE = 0.8`); `compose`.

Los pasajes 1 y 2 de la traza son de la fuente \[2\] y dicen lo mismo ("GPT-5 es el modelo de lenguaje de última generación… lanzado oficialmente el 7 de agosto de 2025"): uno es el extracto truncado y el otro el fragmento de la página. Jaccard mide solape sobre la unión; un extracto corto contenido en un fragmento largo da una similitud baja y no se descarta. Consecuencias visibles en la traza: "3 passages from 1 source", el extracto gasta presupuesto sin aportar nada, y las otras dos fuentes (incluida la página oficial `openai.com`, fuente \[1\]) no aparecen ni en los pasajes ni en `Sources:`, porque en `found` / `partial` solo se listan las fuentes citadas.

### H-20 · Baja · \[Confirmado en traza; origen por verificar\] · El esquema que ve el modelo difiere del `TOOL` del provider

**Dónde:** `webSearchProvider.ts` (`TOOL`) vs `meta.toolSchemas.web_search` de la traza.

La traza muestra descripciones distintas a las del código recibido: `need` aparece como "A direct question, e.g. 'When was Node.js 22 released?' (not an instruction like 'find…'; never a URL). Max 300 characters.", y no figura `additionalProperties: false`. Hay, por tanto, dos definiciones del esquema (probablemente el manifiesto y `TOOL`) que ya divergen, o el código subido no es la revisión que corrió (`gitSha` `cc55497d68`). Además, "never a URL" no se valida en `parseArgs` ni en `searchQuestion`. Sigue sin declararse ningún `maxItems` / `maxLength` (H-09).

### H-21 · Baja · \[Confirmado\] · Un lote fallido del juez descarta las puntuaciones de todos los demás

**Dónde:** `decision.ts`, `score`; `webSearchProvider.ts`, `analyze`.

`score` puntúa en lotes secuenciales de 5 (`JUDGE_BATCH`): tres consultas para 15 candidatos, sin `try` por lote. Si un lote falla (servicio caído, respuesta malformada, desbordamiento de `decisionMaxContext` o el plazo `judgeTimeoutMs`, que comparten los tres), `score` lanza y las probabilidades ya obtenidas se pierden: `analyze` cae a `byCoverage` con todos los candidatos. Además, `parseResponse` exige que las cinco preguntas del lote vengan bien formadas, de modo que una sola respuesta inválida invalida el lote completo.

## 4. Pendientes de verificación

| Tema | Estado | Detalle |
| --- | --- | --- |
| Parámetros de `research` (`question`, `max_age_hours`, `freshness`, `include_domains`) y enum de `freshness` | Verificado | Coinciden con el esquema de Free Search; la llamada real de la traza (`{question, max_age_hours: 24}`) coincide con el código. No hay parámetro de palabras clave (H-03). |
| Formato de salida de `research` | Verificado | Cabecera, fuentes, fechas, extractos y páginas se leen bien en la traza (H-02). Fechas poco fiables: H-18. |
| Parámetros de `fetch` (`url`, `max_age_hours`) y TTL por defecto de 7 días | Verificado | Coinciden con el esquema; el comentario "por defecto guarda 7 días" es correcto para `fetch` (`None = server default TTL (7 days)`). Para `research` el esquema no lo indica. |
| Formato de `fetch` | Verificado | `parseFetch` es compatible; ver H-15, H-16 y la extensión de H-02. |
| Plazo de las sub-llamadas | Verificado | `ToolHost.call` solo admite `signal` (H-13); `render: auto` puede caer a Chromium. |
| Qué ve el modelo | Verificado | Solo `content[0].text` (H-01, H-16); coincide con el campo `summary` de la traza. |
| `fold` y `clipAtWord` | Verificado | Consistentes con `bm25.ts`; sin hallazgo. |
| Contrato del juez e implementación | Verificado | `Decision20Engine.score` cumple `FragmentJudge`: una pregunta `noul` por fragmento, lotes de 5 y validación estricta de \[0, 1\]. Ver H-21. |
| Registro del provider en `server.ts` | Verificado | `free_search` coincide con `WEB_DEPENDENCIES`; el juez depende de `webSearchUseJudge` (H-17); `maxAgeHours` y `judgeTimeoutMs` quedan en sus valores por defecto. |
| Valor de `webSearchUseJudge` en la ejecución de la traza | No verificable | Resolvería H-17. |
| Manifiesto de la tool (esquema visible para el modelo, `timeoutMs`) | No recibido | H-20 queda abierto. |
| Texto del error de "sin resultados" | No recibido | `NO_RESULTS` sigue sin contrastarse con un mensaje real. |

## 5. Cierre de la revisión

Se registraron 21 hallazgos: 5 de severidad Media (H-01, H-03, H-13, H-17, H-18), 15 Bajos y 1 Info (H-12). Ninguno proviene de ejecutar código: salen del código recibido, de los esquemas de Free Search y de una traza.

**Verificado sin hallazgo:** nombres de parámetros de `research` y `fetch` usados por la tool; coincidencia del servidor `free_search` con `WEB_DEPENDENCIES`; contrato de resultados (`toolResult`, estados `found` / `partial` / `not_found` / `no_results`); contrato de `FragmentJudge` y su implementación; compatibilidad del parser con el brief real y con el formato de `fetch`; consistencia de `fold` / `clipAtWord` con la tokenización.

**Límites de esta revisión:** no se verificó el manifiesto de la tool (H-20), el valor de `webSearchUseJudge` (H-17) ni el texto real del error de "sin resultados" (`NO_RESULTS`). Los umbrales `JUDGE_FOUND` / `JUDGE_PARTIAL` requieren datos de evaluación del modelo de 2B; no se pueden validar leyendo código.

## 6. Decisiones y estado de pendientes

Registro de lo acordado después de cerrar la revisión. Los hallazgos que no aparecen en las dos primeras tablas siguen sin decisión.

### Cerrado por decisión

| Hallazgo | Decisión | Alcance |
| --- | --- | --- |
| H-03 · `terms` no se envía a Free Search | `terms` sale de la tool. | Quitarlo del esquema (`TOOL` y manifiesto), de `parseArgs` (`MAX_TERMS`, `MAX_TERM_CHARS`), de `rank` en `bm25.ts` (términos de consulta y segunda medida de cobertura), de `meta.terms` y de los comentarios. También desaparece la parte de `terms` de H-09. A vigilar en el eval: preguntas en español sobre contenido que solo existe en inglés. |

### Pendiente

| Hallazgo | Estado | Nota |
| --- | --- | --- |
| H-01 · reintento sin filtros no comunicado | Pendiente | Toca el flujo de `callTool`; el autor lo deja para más adelante. |
| H-17 · juez inactivo | Pendiente | El juez se mantiene apagado por defecto para probar la selección por cobertura, y debe poder activarse en caliente (`webSearchUseJudge`) para comparar. Falta confirmar el valor actual del flag y revisar `_meta.judge.mode` (`off`, `failed`, `used`) en una traza. |
| H-18 · fechas `published` poco fiables | Pendiente (no cerrado) | Propuesta: no mostrar al modelo el `published` de Free Search (dejarlo en `data` / `_meta`) e inyectar la fecha actual desde el contexto de Jarvis en la etapa de argumentos. Validar en el eval con consultas de tipo "último". Las dos fuentes de la traza son evidencia insuficiente para generalizar sobre Free Search. |
| H-20 · dos definiciones del esquema | Pendiente | A: `TOOL` en `webSearchProvider.ts` (descripciones cortas, `additionalProperties: false`). B: el esquema que ve el modelo en la traza (descripciones largas; origen sin confirmar, probablemente el manifiesto). Decidir cuál manda. Nota: la descripción de B es la que orienta al modelo a escribir `need` como pregunta, así que conviene conservarla y alinear A con B. |
| Tema nuevo · formulación de `need` | En discusión | En la traza, `need` lo genera el modelo de 4B en la etapa `args`, a partir del objetivo del paso (orden de etapas: `pending` → `route` → `tool` → `args`). La tool no recibe el contexto de la tarea, por lo que cualquier mejora que dependa de contexto (fecha actual, idioma, `freshness`) debe hacerse en esa etapa y no dentro de la tool. |

### Sin decisión todavía

H-02, H-04, H-05, H-06, H-07, H-08, H-09 (salvo `terms`), H-10, H-11, H-12, H-13, H-14, H-15, H-16, H-19 y H-21.
