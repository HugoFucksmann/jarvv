# Evaluación de web_search sobre Free Search 0.18.0 (JSON real) — 2026-11-12

Reproducir (desde la raíz): `capture.ts` (necesita red; guarda en `captures/`), `run.ts [--judge] [--verbose] [--only=id]` (sin red salvo el 2B), `ceiling.ts`.
`run.ts` lee las capturas con el parser de producción (`src/tools/web/report.ts`), así que también valida ese parser contra respuestas reales.

36 casos: 31 con respuesta esperada y 5 sin respuesta (`dog`, `nocat`, `nofunc`, `notown`, `nofast`). Ronda 1: 20 casos (preguntas conocidas). Ronda 2: +16 (detalle de documentación, un dato que cambió —SQS—, y 4 sin respuesta). Acierto = la respuesta esperada aparece en el texto que vería el modelo (1700 caracteres).
`terms` = los que escribiría un buen modelo, escritos a mano en `cases.ts` (el **mejor caso** para `terms`).

| Variante (36 casos) | Aciertos /31 | Responde algo cuando no hay respuesta /5 | chars/caso |
|---|---|---|---|
| RAW: extractos del MCP recortados a 1700 | 26 | 0 | 837 |
| RAW: inicio de páginas | 16 | 0 | 1700 |
| Techo: todo lo que trae el MCP | 29 | 0 | 40 439 |
| BM25 `need` (pipeline sin juez) | 26 | **4** | 1266 |
| BM25 + `terms` (concatenados a la pregunta) | 26 | 4 | 1273 |
| BM25 `need`, `depth` 5 | 26 | 3 de 4 medibles | 1350 |
| `terms` enviados al MCP como pregunta (sin / con terms local) | 21 / 24 | 5 / 4 | – |
| **BM25 → juez 2B** | **27** | **1** | 1120 |
| BM25 → juez 2B + `terms` | 27 | 1 | 1134 |
| Solo juez 2B sobre los primeros 40 fragmentos (sin BM25) | 26 | 1 | 1151 |
| BM25 → juez 2B con `per_source` | = global (sin diferencia) | 1 | |

Dónde está la respuesta (`ceiling.ts`, depth 3): 25 casos en extracto y página, 1 solo en extracto, **3 solo en página** (nginx, hikari, s3obj), 2 en ninguno (`fscp`, `redisttl`). Los 2 «ninguno» y `sqs` (dato viejo y nuevo a la vez) fallan en todas las variantes.

> **Nota para reproducir:** las tablas de las rondas 1 y 2 se midieron con los primeros 36 casos (31 con respuesta). `cases.ts` ahora tiene 41 (se sumaron 5 de recencia en la ronda 3), así que `run.ts` da totales sobre 36 con respuesta. `run.ts` lee las capturas de `research` con `research.ts` (la tool ya no usa `research`).

## Lectura

- El extracto del MCP ya contiene la respuesta en 26 de 31; la página aporta 3 casos más y es lo que el pipeline recupera (RAW inicio de páginas solo da 16).
- **Sin juez, el pipeline responde algo en 4 de 5 preguntas sin respuesta** (la cobertura de palabras no distingue «habla del tema» de «responde»). Con el 2B baja a 1 de 5 (`nocat`) y sube a 27/31.
- `terms`: hechos a mano y concatenados no mejoran (26 = 26); enviarlos al MCP como pregunta empeora (21). Se quitan de la tool.
- `per_source` y `depth` 5: sin mejora medible → no se implementan / se deja `depth` 3 (configurable por constructor).
- El 2B no reemplaza a BM25: sin él puntúa solo los primeros 40 fragmentos y pierde casos (ts5, react19, s3obj).

## Límites (para no sobreinterpretar)

- 31 casos con diferencias de 1 caso entre variantes: ruido. Lo sólido: (a) el juez reduce de 4/5 a 1/5 las respuestas sin base; (b) `terms` al MCP empeora (−5); (c) BM25 solo, sin juez, no mejora al extracto crudo.
- Preguntas de documentación técnica y de hechos conocidos; no se midió «¿cuál es el último…?» a lo largo del tiempo, ni preguntas ambiguas.
- Los aciertos se miden con expresiones regulares (tres tuvieron que corregirse).
- Falta medir el costo real de latencia: el juez tardó entre 0,1 y 3 s por consulta con el 2B local.

# Ronda 3 (2026-11-13): recencia y `search` + leer una página por vez

`capture2.ts` (search + fetch de las 3 primeras URLs), `run3.ts` (variantes), `time.ts` (latencia en frío). 41 casos: los 36 anteriores + 5 de «lo más reciente» (`lastgpt`, `lastgemini` salieron de un uso real; las respuestas esperadas se fijaron leyendo las fuentes del 2026-11-13; el primer gold de GPT era viejo y se corrigió).

| Variante | Aciertos /36 | Recencia /5 | Falsos+ /5 | Páginas leídas/caso | chars/caso |
|---|---|---|---|---|---|
| A: research → BM25 → juez (producción) | 31 | 4 | 1 | 3,0 | 1160 |
| B1: A + fecha de la fuente delante de cada fragmento | 32 | 4 | 1 | 3,0 | 1088 |
| B3: B1 + «hoy es …» + el más reciente primero | 32 | 4 | 1 | 3,0 | 1052 |
| S0: solo extractos de `search` (sin juez ni lectura) | 32 | 4 | n/a | 0 | 1700 |
| **C: search → juez fechado sobre los extractos → leer 1 página por vez si ninguno responde** | **33** | 4 | 1 | **0,4** | **710** |

Latencia en frío (mediana de 6 consultas, una llamada por vez): `search` 4,8 s · `research` depth 3 6,5 s · `fetch` de 1 página 0,8 s · `compare` de 3 páginas devuelve 5–19 mil caracteres (más texto que lo que usamos).

- La fecha y el «hoy» en el juez **no resuelven** la recencia (B1 +1, B3 peor): el juez puntúa cada fragmento por separado y no puede comparar «cuál es más nuevo»; además la fecha del extracto es la de la página, no la de la entrada (la nota de versiones de Gemini lleva fecha 2026-10-13 y su entrada vieja dice «2.0 Flash, nuestro último modelo»).
- El extracto de una misma página cambia entre llamadas (`research` devolvió el de 2.0 Flash, `search` el de Gemini 4 Argon).
- `search` primero acierta igual o más (33 vs 31), lee 0,4 páginas por caso y devuelve la mitad de texto. El ahorro de latencia es pequeño (≈1–2 s), porque `research` ya descarga las páginas en paralelo y cada una cuesta ~0,8 s.
- `compare` no aporta: trae las páginas enteras (lo que ya hacemos con fragmentos).
- Límites: 5 casos de recencia; el camino «leer una página» se ejercitó poco (0,4 por caso); latencia con 6 muestras y mucha variación (`search` 2,9–12 s).

## Implementado (2026-11-13) y comprobación de punta a punta

`WebSearchProvider` ahora usa `search` y `fetch` (ya no `research`): el 2B puntúa los extractos viendo la fecha de hoy (`TODAY:`) y la de cada fuente; si alguno responde se devuelve sin leer nada; si no, lee una página a la vez (la del mejor extracto) hasta `pages` (3). Sin juez, o si falla, lee las primeras páginas a la vez y ordena por palabras.

`live.ts` (proveedor real + Free Search + 2B, 41 casos): **33/36 aciertos, 1 respuesta viejo (SQS), 1 de 5 falsos positivos, 0,41 páginas leídas por caso, 0 errores.** Los fallos son los mismos que fuera de línea (`fscp`, `redisttl`: la respuesta no está en lo que trae el MCP; `nocat`; `sqs`: dato viejo y nuevo a la vez) más `lastnodelts` (el juez aprobó un extracto sobre el ciclo LTS que no da la versión).
Los tiempos de `live.ts` no sirven como latencia (las búsquedas estaban en caché de las capturas); la latencia en frío está arriba (`time.ts`).

# Exploración para un modo «Deep Research» (2026-11-13, pilotos sin código en `src/`)

- **Páginas largas:** Free Search corta `fetch` a ~50 000 caracteres (13 de 123 páginas leídas estaban truncadas; 12 de 41 casos tocaron una). La página completa sigue en su caché y `read_doc(source, start, length)` la entrega por tramos de ~50 000 caracteres (`fs.html`: 474 121 caracteres = 10 llamadas, 8,8 s en paralelo). `read_doc` falló con `RecursionError` (bug del servidor) en `redis.io/docs/latest/commands/expire`.
- **Con la página completa de `fs.html`**, el fragmento con la respuesta («Added in: v16.7.0») queda 5.º en BM25 de 363 fragmentos, pero `pickCandidates` devuelve solo 3 por fuente (`PER_SOURCE`), así que no llega al juez. Esto también afecta a `PAGE_CANDIDATES = 6` en el flujo rápido (en la práctica son 3 por página); en los 41 casos 3, 6 y 10 candidatos por página dan el mismo resultado (33/36).
- **Síntesis extractiva con modelo generativo** (6 fragmentos de ~4,7 mil caracteres, respuesta con afirmaciones y cita literal por afirmación): `qwen3.5:4b` 6,7 s, `qwen3.5:9b` 13,6 s; todas las citas (2 y 3) aparecían literalmente en el fragmento citado (verificable por código). El 9b fue más completo.
- Sin medir todavía: valor de reformular preguntas con el modelo, preguntas de comparación entre fuentes, y resúmenes de documentación extensa.

**Resultado de aplicar al modo rápido (2026-11-13):** el tope de candidatos por página se corrigió (hasta `PAGE_CANDIDATES`) y se agregó el recurso de último paso para páginas cortadas (`read_doc` por tramos). `live.ts` (proveedor real, 41 casos): **34/36 aciertos** (antes 33/36), 1 de 5 falsos positivos, 0,41 páginas por caso; `fs.cp` acierta leyendo el resto de `fs.html` (15 s). `redisttl` sigue fallando: el juez aprueba un extracto sobre `TTL` (no sobre `EXPIRE`) y `read_doc` falla en `redis.io`. Idea y conclusiones del modo Deep Research: `docs/web_search/DEEP_RESEARCH.md`.
