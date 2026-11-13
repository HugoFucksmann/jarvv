# `web_search` — Seguimiento de calidad y consistencia

Estado al 2026-11-12 · Free Search `0.18.0` · Archivos: `webSearchProvider.ts`, `report.ts`, `chunks.ts`, `bm25.ts`, `args.ts` + nuevos `hostCall.ts` y `select.ts`

---

## 0. Resumen

| | |
|---|---|
| **Etapa 1** (aprobada) | 9 correcciones con causa y solución claras (S1-1 a S1-9). Algunas quedaron **reemplazadas** por el cambio C1 (ver el índice). |
| **Tres cambios pedidos tras aprobar la Etapa 1** | **C1** lectura en JSON con fallo visible · **C2** `depth` configurable y la opción S detrás de un flag · **C3** presupuesto agotado y plazo del host. Los tres implementados, con tests. |
| **Etapa 2** | S2-1 (selección) queda **implementado detrás de un flag, apagado por defecto**; S2-2 (JSON) **resuelto**; el resto sigue para debatir. |
| **⚠️ Dos cosas que no son lo que se pidió** | (1) **No existe una captura real en JSON de la consulta fastapi** (solo la hay de Node 22): el fixture de fastapi es **derivado y está rotulado así**. (2) **No pude medir el tiempo ni los tokens reales para depth 5 y 8** (sin red hacia los buscadores): dejé el script y lo medido de verdad. |
| **Verificación** | **93 tests** (92 pasan, 1 pendiente a propósito) · `tsc --strict` limpio · 4 mutaciones del código, **las 4 detectadas** · prueba de punta a punta sobre capturas reales. |

---

## 1. Alcance, método y límites

**Método.** Se ejecuta el pipeline completo sobre salidas reales de Free Search `0.18.0` antes y después de cada cambio, y se comprueba que los tests detecten los defectos rompiendo el código a propósito (mutación).

**Límites del entorno de prueba:**

1. **El `core` es un stub** (carpeta `core/` de esta entrega, escrita por mí, **no es tu `core`**): `../../core/*` (`fold`, `clipAtWord`, `toolResult`, tipos del `ToolHost`, `BUDGET`) no se tenía. Supuesto declarado: `fold` pasa a minúsculas y quita acentos de letras latinas. Los tests importan `../core/…`: **en tu repositorio hay que apuntarlos a tu `core` real**.
2. **No se probó el juez (2B)**: el análisis de ranking es léxico.
3. **No hay captura real de `fetch`** ni **de la consulta fastapi en JSON**. Ver C1 y S2-4.
4. **Dos consultas no son un conjunto de evaluación** (S2-5).
5. Tests con Node 22 (`--experimental-strip-types`) y `tsc 5.9 --strict`. Sin red hacia los buscadores: nada de lo que dependa de la red (tiempos reales) se midió.

### Evidencia base (`fixtures/`)

| Archivo | Origen |
|---|---|
| `research.node22.json` | **Captura REAL** (`research("cuándo salió Node 22", depth=3, format="json")`) |
| `research.node22.shape.json` | Instantánea de la forma de la captura real (contrato) |
| `research.fastapi.derived.json` | **DERIVADO, no capturado**: reconstruido con el esquema real a partir de la captura Markdown de `latest fastapi version`. Detalle de lo inferido en `fixtures/README.md` |
| `legacy-markdown/*.md` | Capturas reales en Markdown (ya no las lee ningún código); la única captura real de fastapi |

**Lo que mostró el JSON real** (y que decidió el diseño de C1):

- Cada fuente trae `rank, title, url, snippet, engines, score, published_age, date_source` y, **a veces**, `source_type` (en la muestra, solo la de foro).
- Los extractos **siguen trayendo el prefijo de fecha** del buscador (`2026/4/13 -…`): limpiarlo sigue haciendo falta.
- La fecha **por fuente** (`published_age`, `date_source: "snippet"`) y la **por documento** (`documents[].published_date`) son campos distintos: la fuente de Reddit decía `2026-04-13`; su documento, que era un desafío anti-bot, decía `2026-01-01`.
- El JSON **no trae ningún indicador de página bloqueada**.
- `engines` por fuente incluye `youcom` en la fuente nº 1 (`["anysearch","youcom"]`): confirma que la consulta llegó a You.com por el mecanismo de rescate (S2-6).
- Campos de nivel superior: `question, engines, tokens_estimated, errors, retrieved_at, search_cache_age_seconds, date_note, gated_engines, gated_hint, benched_engines, benched_hint, rescued_via`.
- En el JSON, el texto de la respuesta y `structured_content` son el mismo JSON (verificado), por eso `JSON.parse(textOf(result))` no requiere cambios en el `ToolHost`.

---

## 2. Etapa 1 — Cambios aprobados

Convención: **Problema → Evidencia → Causa raíz → Decisión → Modificación → Justificación → Verificación → Riesgo residual.** El detalle original se conserva; la columna «Vigencia» indica qué cambió después.

| ID | Problema | Vigencia tras C1–C3 |
|---|---|---|
| S1-1 | El parser no coincidía con el formato real de Markdown | **Reemplazado por C1**: el parser Markdown se eliminó |
| S1-2 | El adorno de fecha del buscador contaminaba los extractos | **Vigente** (`cleanSnippet`); se eliminó solo la parte que extraía la fecha |
| S1-3 | Los desafíos anti-bot se trataban como páginas leídas | **Vigente** (`isBlockPage` sigue siendo heurística: el JSON no trae indicador) |
| S1-4 | La fecha de una fuente venía de una página que era un desafío | **Obsoleto por C1**: la fecha sale de `published_age`/`date_source`, no del documento |
| S1-5 | `not_found` contaba fuentes listadas, no páginas leídas | Vigente |
| S1-6 | El reintento sin filtros no se declaraba | Vigente |
| S1-7 | Los avisos de Free Search se descartaban | **Adaptado por C1**: ahora son campos del JSON → `meta.freeSearch` (antes `meta.freeSearchNotices`) |
| S1-8 | El juez omitido por falta de tiempo no dejaba rastro | Vigente |
| S1-9 | Higiene (variable muerta, estilo, CRLF) | Vigente |
| S1-10 | `chunks.ts` revisado | Vigente. **Cambió mínimamente** en C1 (rótulo de la fecha del extracto); las propiedades de partición siguen verificadas |
| S1-11 | `bm25.ts` y `args.ts` revisados | `args.ts` sin cambios. `bm25.ts` ganó una **opción aditiva** en C2 (`eachSource`) sin alterar el comportamiento por defecto (comprobado contra el algoritmo original) |

### S1-1 · El parser no coincidía con el formato real *(reemplazado por C1)*
`parseResearch` buscaba `_published AAAA-MM-DD` con una regex literal y perdía las fechas de `_dated …` y de `_forum · published …`. **Causa raíz**: se escribió contra un formato supuesto. Se corrigió leyendo la línea de metadatos por campos y luego se **eliminó por completo** al pasar a JSON (C1): la causa de fondo era depender de una presentación para humanos.

### S1-2 · El adorno de fecha del buscador contaminaba los extractos *(vigente)*
- **Evidencia.** `2024/5/7 -Node.js 22 has been released…` aparece **también en el JSON** (verificado). Sus números se tokenizan: `2024/5/22 -…` produciría el término `22` y coincidiría con una pregunta sobre «Node 22».
- **Decisión y modificación.** `cleanSnippet` quita solo la forma verificada (`AAAA/M/D -` con una fecha posible); cualquier otra se deja intacta. Ya **no devuelve la fecha** (antes `splitSnippetDate`): esa responsabilidad pasó a `published_age`.
- **Verificación.** `report.test.ts` (`cleanSnippet`; un `2024/5/22` no deja un `22`) y `chunks.test.ts`.
- **Riesgo residual.** Free Search interpreta más formatos de fecha (`2026年10月1日`, `5日前`, `3일 전`); esos no se limpian porque no se han visto en una salida real.

### S1-3 · Los desafíos anti-bot se trataban como páginas leídas *(vigente)*
Reddit («Prove your humanity», ~36 tokens) y PyPI («Client Challenge», ~52 tokens) entraban como documentos. **Causa raíz**: Free Search los devuelve como documentos sin marcarlos (el JSON no tiene indicador), y los estados `not_found`/`no_results` no distinguían «leído y sin respuesta» de «no se pudo leer». **Decisión**: heurística **acotada** (cuerpo ≤ 600 caracteres y frases propias de un desafío; no la palabra «captcha» a secas) y exclusión del material; `Analysis.read/blocked`; `no_results` explicado; en `fetch` por URL, un error explícito. La detección es reemplazable; el manejo posterior es correcto sea cual sea el detector. **Riesgo residual**: ver S2-3.

### S1-4 · La fecha venía de una página que era un desafío *(obsoleto por C1)*
Se resolvía con una regla de inferencia (`published` + página bloqueada → fecha del extracto). Con el JSON la regla **desaparece**: el `published_date` del documento ya no se usa y la fecha de la fuente viene de `published_age`.

### S1-5 · `not_found` contaba fuentes listadas, no páginas leídas
`status: not_found · … (1 page read, 1 blocked by an anti-bot challenge)`; `data.read`, `data.blocked`. Test: `provider.test.ts`.

### S1-6 · El reintento sin filtros no se declaraba
Se distingue «se reintentó» de «el resultado viene del reintento»: aviso en el texto (`UNFILTERED_NOTE`) y `meta.filters.relaxed`. Tests: con reintento (aviso) y sin él (sin aviso).

### S1-7 · Los avisos de Free Search se descartaban *(adaptado)*
Eran líneas `⚠️/ℹ️` del Markdown; en JSON son campos (`date_note`, `gated_engines`, `gated_hint`, `benched_engines`, `benched_hint`, `rescued_via`, `retrieved_at`, `search_cache_age_seconds`, `tokens_estimated`) y se conservan como diagnóstico en `Material.diagnostics` → `meta.freeSearch`. No se muestran al modelo. **Cambio de clave de `meta`**: `freeSearchNotices` → `freeSearch` (objeto).

### S1-8 · El juez omitido por falta de tiempo no dejaba rastro
`judge` sigue en `"off"` (no cambia el contrato) y `judgeMeta.skipped` explica el motivo.

### S1-9 · Higiene
Variable muerta `filtered` → `hasFilters`; estilo; **los archivos que usan CRLF lo conservan** (`webSearchProvider.ts`, `chunks.ts`), de modo que el diff muestra solo los cambios reales.

### S1-10 / S1-11 · `chunks.ts`, `bm25.ts`, `args.ts`
`chunks.ts`: 2505 fragmentos aleatorios y las páginas reales — ninguno supera `CHUNK_MAX` y no se pierde ninguna línea de contenido; propiedades fijadas como tests. **El problema de ranking de S2-1 no es un error de BM25**: BM25 hace lo que dice; el defecto es usarlo como único criterio para elegir *fuentes*.

---

## 3. Cambios solicitados tras aprobar la Etapa 1

### C1 · Lectura en JSON, con fallo visible

- **Problema.** El parser leía Markdown pensado para humanos: ya había fallado una vez contra el formato real (S1-1), la fecha se *inferían* del texto (`published` vs `dated`, S1-4) y un cambio de formato se degradaba en silencio: un texto desconocido se tomaba como una página.
- **Evidencia.** JSON real (§1): `published_age` + `date_source` por fuente separan la fecha de la fuente de la del documento; el texto del resultado ya es el JSON.
- **Causa raíz.** Se dependía de la **presentación** (Markdown), no de un **contrato**.
- **Decisión.**
  1. `research` y `fetch` se piden con `format: "json"` y se leen con `JSON.parse(textOf(result))`.
  2. El **contrato** (qué se lee y de qué tipo) es una tabla explícita (`RESEARCH_SOURCE_CONTRACT`, `RESEARCH_DOCUMENT_CONTRACT`, `FETCH_CONTRACT`) que sirve para validar **y** para el test de contrato.
  3. **Se rechaza**: lo que no es JSON; JSON que no es un objeto; falta de `sources`/`documents`; un campo del contrato que falte o cambie de tipo; un `date_source` fuera de `structured|snippet|none`; un `rank` repetido o no entero positivo; un `published_age` que no tenga la forma `AAAA-MM-DD`. **Se ignoran** las claves nuevas (Free Search puede agregarlas).
  4. **Fechas.** `date` = `published_age` si `date_source` ≠ `none`; se califica con `date_source` y llega así al modelo: `(published 2026-11-11)` si es `structured`, `(published 2026-04-13, from the search snippet)` si es `snippet`. Una fecha con la forma correcta pero **imposible** (futura, anterior a la web) se descarta (dato malo); una fecha con **otra forma** (p. ej. «3 days ago») es un cambio de formato y **se rechaza**.
  5. **Fallo visible.** Respuesta no reconocida → `data.state: "no_results"`, `data.reason: "formato no reconocido"`, `data.detail` con la ruta exacta (`sources[0].published_age: missing`), texto `status: no_results · motivo: formato no reconocido (…)`, `raw` con lo recibido, y **`isError: true`**.
  6. `source_type` es **opcional** (el JSON real lo trae solo en algunas fuentes).
- **Modificación.**
  - **Eliminado** (código huérfano): `parseResearch` Markdown, `SOURCE_HEAD`, `DOC_HEAD`, `DOC_TITLE`, `META_LINE`, `META_DATE`, el borrador `Draft` con `dateWord`, la regla de fecha para páginas bloqueadas, `splitSnippetDate` (la extracción de fecha; el recorte del prefijo queda en `cleanSnippet`), `Material.format`/`"unrecognized"`, `Material.notices`, `parseFetch` Markdown y el aviso de «formato no reconocido» de `compose`.
  - **Nuevo**: `parseResearch`/`parseFetch` JSON (devuelven `Parsed<T>`, nunca lanzan), `checkFields`, `dateLabel`, `FormatError` y `unrecognized()` en el proveedor.
  - Por fuente se usan `engines`, `score`, `published_age`, `date_source` y `source_type` (además de `rank` como número de la fuente): llegan a `data.sources`.
  - Los fixtures Markdown pasaron a `fixtures/legacy-markdown/`.
- **Justificación.** Una ruptura del contrato deja de poder confundirse con «no hay resultados» o con una página.
- **Verificación.**
  - `report.test.ts` (25): lectura de la captura real, reglas de fecha, estructura, rechazos con su ruta, `fetch`.
  - `contract.test.ts`: (a) la **forma** de cada captura real coincide con su instantánea; (b) todo campo que se lee existe con tipo compatible en la captura; (c) **9 rupturas del esquema** (renombrar `published_age`, cambiar el tipo de `score`, un valor nuevo en `date_source`, quitar `rank` o `sources`, `documents` como objeto, renombrar `content`, edad relativa) se **rechazan con la ruta del campo**; (d) agregar campos nuevos **no** rompe la lectura pero **sí** cambia la forma (se ve). Una captura nueva con otro esquema hace fallar (a). Aceptarla: `UPDATE_SHAPE=1`.
  - `provider.test.ts`: Markdown → fallo visible y **su texto no se lee como página**; JSON con otro esquema → fallo con la ruta; JSON válido vacío → `no_results` normal, sin error; `fetch` no JSON → fallo.
- **Riesgos residuales y decisiones a confirmar.**
  1. **Sin captura real en JSON de la consulta fastapi.** Existe solo la de Node 22. Lo que se guardó es un **derivado rotulado** (`research.fastapi.derived.json`), válido para pruebas de **comportamiento** del pipeline, **no** de esquema. Los campos inferidos (`engines: []`, `score: 0`, `date_source` de las fuentes 2 y 3) están listados en `fixtures/README.md`. Reemplazo: `scripts/capture_fixtures.py` (no ejecutado: requiere red). Al aparecer `research.fastapi.json`, las pruebas lo prefieren.
  2. **El contrato de `fetch` sale de la documentación, no de una captura.** Su test queda **pendiente** (`skip` con motivo visible).
  3. **Se descarta `documents[].published_date`.** Es la consecuencia de usar la fecha de la fuente: para una página **leída**, la fecha del propio documento podría ser más fiable que la del extracto (en el derivado de fastapi, la página decía 2025-10-31 y el extracto 2026-04-24). Ver S2-10.
  4. **`isError: true` con estado `no_results`.** El pedido era «no_results con motivo»; añadí `isError` para que no pase por una búsqueda vacía normal. Si prefieres `isError: false`, es una línea.
  5. Un `date_source` nuevo (p. ej. `"page"`) hace fallar la lectura. Es lo pedido (visibilidad), pero un cambio benigno de Free Search tumba la tool hasta que se actualice el contrato.

### C2 · `depth` configurable y la opción S detrás de un flag

- **Problema.** `depth` no se enviaba (se asumía el default del servidor) y no estaba documentado. S2-1 estaba solo analizado.
- **Dato corregido.** El default real es **3** (rango 1–8), y `research` lista y lee solo las `depth` primeras fuentes. *Mi afirmación anterior de que el default «no está documentado» queda corregida.* (Ese dato lo aportaste tú; en mis capturas yo había fijado `depth=3` explícitamente, así que no podían mostrarlo.)
- **Decisión.**
  - `depth`: opción del constructor (`WebSearchOptions.depth`, default **3**, entero de 1 a 8). **No se expone al modelo** (las herramientas de modelos chicos deben tener pocos parámetros). Un valor inválido (`0`, `9`, `2.5`, `NaN`, `"3"`) lanza `RangeError` **al construir**: una configuración mala no se corrige en silencio ni falla en cada búsqueda. Se envía siempre en `research`; con `urls` no hay búsqueda y `meta.depth` es `null`.
  - **Opción S** = `selection: "per_source"` (default `"global"` = comportamiento histórico, **sin cambios**). Free Search elige las fuentes (orden de `rank`); este código elige el mejor pasaje de cada una, con relleno global si sobran lugares; con más fuentes que lugares mandan las primeras de Free Search. Dos puntos de aplicación: (1) `select.ts` en la selección final (con y sin juez); (2) `pickCandidates(…, eachSource)` garantiza que el mejor fragmento de cada fuente esté entre los candidatos (si no, el corte global de 15 podría dejar fuera a la fuente nº 1 con más fuentes que `depth` 3).
- **Modificación.** `webSearchProvider.ts` (opciones, validación, `choose`), `select.ts` (nuevo), `bm25.ts` (opción aditiva).
- **Justificación.** Permite comparar con y sin la opción sin tocar el comportamiento por defecto.
- **Verificación.**
  - `select.test.ts` (7), `bm25.test.ts` (3: el comportamiento por defecto **es idéntico al algoritmo original** en las capturas; `eachSource` mete la fuente que el corte global dejaba fuera y respeta límite, máximo por fuente y cobertura).
  - `provider.test.ts`: `depth` 3/5/8 llega a Free Search y a `meta`; rangos inválidos lanzan; `global` pierde el registro y `per_source` lo recupera **y lo pone primero**; en Node 22 ambos modos devuelven el anuncio oficial.

**Comparación con y sin el flag** (proveedor real, sin juez; `experimentos/compare-selection.ts`):

| Consulta | `global` | `per_source` |
|---|---|---|
| Node 22 (es) *[real]* | [1] [3s] | [1] **[2s]** [3s] |
| Node 22 (en) *[real]* | [1] [3s] | [1] **[2s]** [3s] |
| fastapi (en) *[derivado]* | [3] [3] [2s] — **solo 0.136.1 (viejo)** | **[1s]** [2s] [3] — **incluye 0.162.5 (vigente), primero** |
| fastapi (es) *[derivado]* | [3] [3] [2s] — solo 0.136.1 | **[1s]** [2s] [3] — incluye 0.162.5 |

(`s` = extracto del buscador.) **Contrapartida visible**: en Node 22, `per_source` suma el extracto de Reddit sobre gestión de memoria, que no responde la pregunta; sin juez no hay cómo descartarlo. Con las capturas actuales, **no** se puede afirmar que `per_source` generalice: por eso queda apagado por defecto (S2-1, S2-5).

**Costo de `depth`** (lo medido, lo no medido y por qué):

| depth | Tokens que estima Free Search (**medido, depth 3**) | Proceso local de este código (**medido, sintético**) | Tiempo de red |
|---|---|---|---|
| **3** | Node 22: **3 292** (páginas de 1 304 y 1 952; la bloqueada, 36). fastapi: **6 491** (52 + 984 + 5 455) | **12 ms** | **No medido** |
| **5** | **No medido** (extrapolación lineal, *estimación*: ≈ ×1,7 → ~5,5–10,8 mil) | **24 ms** | **No medido** |
| **8** | **No medido** (extrapolación lineal, *estimación*: ≈ ×2,7 → ~8,8–17,3 mil) | **28 ms** | **No medido** |

- **Medido de verdad:** los tokens de depth 3 salen de las capturas; el proceso local, de `experimentos/costo-local-por-depth.ts` con páginas sintéticas de 21 820 caracteres (≈ 5 455 tokens: el tamaño de la página más larga observada), es decir, un caso cargado. Es CPU de este código, **no** red.
- **No medido:** el **tiempo de pared** de `research` y los **tokens reales** para depth 5 y 8. No tengo red hacia los buscadores, y no quise llenar la tabla con cifras inventadas. `scripts/bench_depth.py` mide ambos (con `max_age_hours: 0`, calentamiento y repeticiones) y escribe la tabla; **corrélo y pegá el resultado aquí**.
- **Lo que se puede decir sin medir** (de la estructura, no de una medición): (a) **el costo para el modelo de lenguaje no cambia con `depth`**: el modelo recibe como máximo ~1 700 caracteres (`PASSAGES_BUDGET`) y el juez, ≤ 15 candidatos de ≤ 800 caracteres; el material extra solo crece en la respuesta de Free Search y en `raw` (rastro); (b) el proceso local es pequeño frente a la red; (c) **el máximo absoluto está acotado** por el plazo de la herramienta (C3): 145 s efectivos; (d) según las notas de Free Search 0.16 las páginas se descargan y extraen concurrentemente, de modo que el tiempo debería crecer menos que linealmente, pero **eso es de sus notas, no medido aquí**; (e) más páginas aumentan la probabilidad de más desafíos anti-bot: con depth 3 hubo 1 de 3 páginas bloqueada en cada captura.

### C3 · Presupuesto agotado y plazo del host

- **Problema 1: «Tool budget used up».** El host contesta con ese texto como si fuera un resultado. Sin detectarlo se leería como un formato desconocido o como una página, y el motivo real se perdería.
- **Problema 2: el plazo no se cumplía.** `host.call` recibía solo la señal de la tarea; el plazo de 150 s solo se usaba para decidir si quedaba tiempo para el juez o el reintento. Un Free Search colgado dejaba la búsqueda esperando.
- **Causa raíz.** (1) No había ninguna comprobación del texto del host antes de interpretarlo. (2) Pasar una señal con plazo **no basta** (un `ToolHost` puede ignorarla): nada hacía cumplir el plazo.
- **Decisión y modificación** (`hostCall.ts`, nuevo):
  - `toolBudgetMessage`: el texto que **empieza** por «Tool budget used up» (sin distinguir mayúsculas, con o sin `isError`) → `ToolBudgetError` → `isError: true`, `data.reason: "tool_budget"`, texto `Web search failed: Tool budget used up while calling free_search/research: …`. La frase **en medio** de un resultado normal no cuenta. Se comprueba **antes** de interpretar el JSON y también en `fetch`.
  - `callWithDeadline`: cada llamada compite contra un temporizador **y** contra la cancelación de la tarea; la señal que recibe el host se cancela al vencer (para que abandone si coopera). Al vencer → `DeadlineError` → `isError: true`, `data.reason: "timeout"`, texto `Web search failed: timed out after 150 s waiting for Free Search (research)…`. Cancelar la tarea sigue siendo `status: cancelled` (no un plazo). El temporizador y el oyente se liberan siempre y una respuesta tardía del host no genera rechazos sin atender.
  - **Plazo: 150 s por defecto** (`DEFAULT_TIMEOUT_MS`, exportado). **Decisión a confirmar:** el plazo efectivo de cada llamada es el restante de ese presupuesto **menos el margen de seguridad de 5 s** que ya existía (`SAFETY_MARGIN_MS`), es decir **145 s**, para poder devolver un fallo claro *antes* de que el anfitrión corte a los 150 s. Si prefieres 150 s exactos en `host.call`, hay que quitar el margen.
  - En `fetch` por URL, plazo vencido, presupuesto agotado y formato desconocido **se propagan** (afectan a toda la búsqueda); un error de una página concreta sigue siendo un error de esa página.
- **Verificación.** `hostCall.test.ts` (10): respuesta a tiempo; host que **ignora** la señal y nunca responde; la señal del host se cancela; host que coopera; mensaje con herramienta y segundos; plazo ya vencido sin llamar al host; cancelación de la tarea; señal ya cancelada; **respuesta tardía sin rechazos sin atender**; `toolBudgetMessage`. `provider.test.ts`: presupuesto como resultado normal, con `isError` y desde `fetch`; frase en medio; plazo de 150 s; fallo de plazo en research y en URLs; cancelación inmediata; sin temporizadores colgados (si quedara uno, la suite tardaría 150 s).
- **Hallazgo colateral.** Las primeras clases de error usaban propiedades de parámetro (`constructor(readonly tool…)`), que el modo nativo de TypeScript de Node **no admite**; el resto de tu código usa solo sintaxis borrable. Lo detectó la suite y se reescribieron con campos explícitos.
- **Riesgos residuales.** (1) El **juez** no pasa por `callWithDeadline` (tiene su propio plazo vía `AbortSignal.timeout`): un juez que ignore su señal no se cubre. (2) Si el plazo vence **en el reintento sin filtros**, se informa el plazo y se pierde el primer resultado (`not_found`/`no_results`), que era válido.

---

## 4. Etapa 2 — Estado

### S2-1 · La selección ignora autoridad y recencia — **implementado detrás de un flag (apagado)**
La opción S existe (`selection: "per_source"`) y fue comparada (tabla de C2). **No se activa por defecto** hasta tener el conjunto de evaluación (S2-5): con las capturas actuales resuelve el caso fastapi pero añade ruido en Node 22.
**Preguntas abiertas** (sin cambios): ¿1 pasaje por fuente o hasta 2?; ¿umbral propio para fuentes solo-extracto poco relevantes?; con JSON, ¿`engines` por fuente identifica un registro sin inferirlo? (requiere la captura real de una consulta de registro).

### S2-2 · Markdown o JSON — **RESUELTO** (C1)
Adoptada la alternativa 2 (JSON único + fallo visible). Pendiente: capturas reales (fastapi en JSON, `fetch`).

### S2-3 · Desafíos anti-bot — sin cambios
Se confirmó que **el JSON no trae un indicador de bloqueo**, de modo que la heurística de `isBlockPage` sigue siendo necesaria. Recomendación vigente: instalar Chromium (`uvx --from free-search-mcp playwright install chromium`), mantener la heurística como defensa y abrir upstream un pedido de `blocked: true`.

### S2-4 · `fetch` sin captura real
`fetch` ahora se lee en JSON con un contrato **documentado, no capturado**. El test de contrato de `fetch` queda **pendiente** (`skip` visible). `scripts/capture_fixtures.py` lo captura. Incluir una URL con desafío anti-bot y una inexistente.

### S2-5 · Evaluación y tamaños
`depth` ya es configurable y tiene default verificado (3). Sigue faltando el conjunto de evaluación (casos con respuesta esperada y datos prohibidos, capturados con `capture_fixtures.py`), prerrequisito de activar `per_source`, de elegir `depth` y de calibrar `CANDIDATES`, `PER_SOURCE`, `RETURN_MAX`, `PASSAGES_BUDGET` y los umbrales del juez. Tabla de costo por `depth`: ver C2 (faltan tiempo y tokens de 5 y 8).

### S2-6 · Salida de datos de la consulta (Guard) — se refuerza la evidencia
Con el JSON se ve por fuente: `engines: ["anysearch","youcom"]` en la fuente nº 1 de Node 22, además de `rescued_via: "youcom"`. La consulta sale hacia más destinos que el pool anunciado. Decisión de política; no se tocó.

### S2-7 · Atribución de líneas repetidas — sin cambios (menor)
### S2-8 · Telemetría del juez — sin cambios
### S2-9 · Fijar la versión de Free Search — sin cambios (`==0.18.0`)

### S2-10 · (nuevo) Fecha por fuente o fecha por documento
Con C1 la fecha sale de `published_age`; el `published_date` del documento se ignora. Para páginas **leídas** el segundo puede ser más fiable (página: 2025-10-31; extracto: 2026-04-24, caso derivado de fastapi); para páginas **bloqueadas** es basura (Reddit: `2026-01-01`). Alternativas: (a) solo `published_age` (actual); (b) preferir `published_date` si la página se leyó y no es un desafío, y `published_age` si no; (c) mostrar ambas cuando difieren. **Recomendación**: decidir con el conjunto de S2-5; (c) es la más honesta pero ensucia el texto.

### S2-11 · (nuevo) Plazo efectivo de 145 s vs 150 s y reintento
Ver C3: confirmar el margen de seguridad y si un plazo vencido en el reintento debe conservar el primer resultado.

---

## 5. Registro de verificación

| Comprobación | Resultado |
|---|---|
| Suite (`node --experimental-strip-types --test test/*.test.ts`) | **93 tests: 92 pasan, 0 fallan, 1 pendiente** (`fetch`: sin captura real) |
| Por archivo | `report` 25 · `provider` 28 · `hostCall` 10 · `select` 7 · `chunks` 5 · `contract` 15 (1 pendiente) · `bm25` 3 |
| `tsc --strict` (con los stubs) | sin errores |
| **Mutación 1** — el plazo espera al host sin temporizador | **detectada**: 13 tests cancelados, salida con código 1 (la suite no «falla» limpio porque los tests quedan colgados: es el síntoma) |
| **Mutación 2** — no detectar «Tool budget used up» | detectada (2 tests fallan) |
| **Mutación 3** — aceptar cualquier `date_source` | detectada (2 fallan) |
| **Mutación 4** — leer lo desconocido como una página | detectada (2 fallan) |
| Comparación con/sin `per_source` | tabla de C2 |
| Costo local por `depth` | 12 / 24 / 28 ms (sintético) |
| Cambios vs. la Etapa 1 aprobada (líneas diff) | `report.ts` 403 (reescrito) · `webSearchProvider.ts` 139 (CRLF conservado) · `chunks.ts` 9 · `bm25.ts` 24 · nuevos `hostCall.ts` 113 y `select.ts` 28 · `args.ts` sin cambios |

**Cómo reproducir** (Node ≥ 22.6, dentro de este directorio):

```powershell
node --experimental-strip-types --test test/*.test.ts
npx tsc -p .
node --experimental-strip-types experimentos/compare-selection.ts
node --experimental-strip-types experimentos/costo-local-por-depth.ts
```

## 6. Archivos entregados

| Ruta | Qué es |
|---|---|
| `src/web/report.ts` | **Reescrito**: lectura JSON y contrato |
| `src/web/webSearchProvider.ts` | **Modificado** (JSON, `depth`, `selection`, presupuesto, plazo), CRLF |
| `src/web/hostCall.ts` | **Nuevo**: plazo, cancelación, presupuesto y errores tipados |
| `src/web/select.ts` | **Nuevo**: selección `global` / `per_source` |
| `src/web/chunks.ts`, `src/web/bm25.ts` | Cambios mínimos (rótulo de fecha; opción `eachSource`) |
| `test/` | 7 archivos de pruebas + `helpers.ts` + `shape.ts` |
| `fixtures/` | Capturas reales, derivado rotulado, instantánea de forma, `legacy-markdown/`, `README.md` |
| `scripts/capture_fixtures.py` | Captura real de `research` y `fetch` en JSON (**no ejecutado**) |
| `scripts/bench_depth.py` | Mide tiempo y tokens por `depth` 3/5/8 (**no ejecutado**) |
| `experimentos/` | `compare-selection.ts`, `costo-local-por-depth.ts` |
| `core/` | **Stubs** de tu `core` (`fold`, `clipAtWord`, `toolResult`, tipos…) solo para ejecutar las pruebas fuera de tu repo: reemplazalos por tu `core` real |

## 7. Siguiente paso propuesto

1. **Ejecutar `scripts/capture_fixtures.py`**: da el JSON real de fastapi y el de `fetch`; luego `UPDATE_SHAPE=1` para fijar sus formas.
2. **Ejecutar `scripts/bench_depth.py`** y pegar la tabla (tiempo y tokens de depth 5 y 8).
3. Instalar Chromium (S2-3) y **repetir** las capturas: los desafíos anti-bot podrían desaparecer.
4. Construir el conjunto de evaluación (S2-5) y decidir S2-1 y S2-10.

### Preguntas para confirmar

1. ¿Plazo efectivo de 145 s (150 s menos el margen de 5 s) o 150 s exactos en `host.call`?
2. ¿`isError: true` en el fallo «formato no reconocido», con estado `no_results`?
3. ¿Aceptás descartar `documents[].published_date` por ahora (S2-10)?
4. ¿Un `date_source` desconocido debe tumbar la lectura (actual) o degradarse a «sin fecha»?
