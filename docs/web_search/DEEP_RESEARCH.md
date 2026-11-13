# Modo «Deep Research» para `web_search` — idea y conclusiones (2026-11-13)

**Estado: idea documentada, sin implementar.** Este documento reúne la propuesta, los pilotos que se hicieron y lo que falta medir. Los datos están en `scripts/validate/web_eval/RESULTADOS.md` («Exploración para un modo Deep Research»).

## 1. La idea

`web_search` hoy es un modo **rápido**: responde en unos segundos preguntas sencillas (33 de 36 aciertos en 41 casos reales; ver `RESULTADOS.md`). Se queda corto en dos tipos de pedido:

- **Documentación muy extensa**, donde la respuesta está en una página larga que Free Search corta.
- **Investigación**: comparar fuentes, resumir, o preguntas que requieren reformular la búsqueda.

Subir la latencia del modo rápido para cubrir eso lo perjudicaría. La propuesta es un segundo modo, **Deep Research**, donde la latencia no sea la prioridad, con estas diferencias:

1. Puede involucrar un **modelo generativo** para reformular preguntas y mejorar la búsqueda.
2. **La propia tool procesa y sintetiza** los resultados en una respuesta final compacta. No se le puede pasar todo ese volumen de texto al modelo que responde al usuario.

## 2. Qué se hizo ya en el modo rápido (y por qué importa para esta idea)

Dos hallazgos de la exploración se resolvieron en el modo rápido porque no cuestan latencia donde hoy funciona:

- **Candidatos por página:** `pickCandidates` limitaba a 3 fragmentos por fuente, así que `PAGE_CANDIDATES = 6` no tenía efecto. Ahora una sola página (o una URL dada) aporta hasta 6 candidatos en la búsqueda, 12 en la lectura completa y hasta 15 con una URL.
- **Recurso de último paso para páginas cortadas:** Free Search corta `fetch` a ~50 000 caracteres, pero guarda la página entera y `read_doc(start, length)` la entrega por tramos. Si ya se iba a devolver `partial` o `not_found` con una página cortada, se leen los tramos restantes a la vez (hasta 12 tramos = 600 000 caracteres, con 45 s de plazo mínimo), se puntúan 12 fragmentos y, si alguno responde, se devuelve `found`. Si `read_doc` falla (`RecursionError` en `redis.io/…/expire`, un bug del servidor), se conserva el resultado anterior y la causa queda en `meta.judge.fullReadError`. Con ese recurso la prueba real de `fs.cp` pasó de fallar a acertar (15 s) y el total pasó de 33/36 a 34/36.

Esto reduce el espacio donde Deep Research aporta algo que el modo rápido no puede: ya no hace falta un modo aparte solo para «leer una página larga».

## 3. Evidencia de los pilotos

| Qué se probó | Resultado |
|---|---|
| `read_doc` por tramos en una página enorme (`fs.html`, 474 121 caracteres) | 10 llamadas en paralelo, 8,8 s; el texto completo contiene la respuesta |
| Recuperación sobre la página completa | El fragmento correcto es 5.º en BM25 de 363, pero se perdía por el tope de 3 por fuente (ya corregido) |
| `read_doc` en otras páginas | `RecursionError` del servidor en `redis.io`; hace falta un respaldo |
| Síntesis extractiva con un modelo generativo (6 fragmentos, ~4,7 mil caracteres, afirmaciones con cita literal) | `qwen3.5:4b` 6,7 s; `qwen3.5:9b` 13,6 s. Todas las citas aparecían literalmente en el fragmento citado (verificable por código). El 9b fue más completo |
| `cache_search` como localizador | Encuentra la zona de una página larga, pero devuelve solo ~12 palabras y no la posición; no sirve para reconstruir contexto |

**Sin medir:** el valor de reformular preguntas con el modelo; las preguntas de comparación entre fuentes; los resúmenes de documentación extensa. Los fallos que vimos en 41 casos no vinieron de la consulta sino de truncamiento, datos viejos o preguntas sin respuesta; por eso no hay evidencia de que reformular ayude.

## 4. Diseño propuesto (a validar)

1. **Etapas.** (a) Búsqueda con varias formulaciones; (b) lectura de más páginas, completas cuando hace falta; (c) puntuación con el 2B (`FragmentJudge`, sin generar texto) y BM25 como filtro previo; (d) **síntesis extractiva** con el modelo generativo; (e) verificación por código.
2. **Síntesis extractiva con citas verificadas.** El modelo recibe solo los fragmentos elegidos y devuelve JSON con afirmaciones, cada una con el número del fragmento y una **cita literal**. El código descarta toda afirmación cuya cita no esté textualmente en el fragmento y exige que cada número o versión de la afirmación aparezca en su cita. El texto que sale lo arma el código a partir de lo verificado.
3. **Interfaz.** Preferible una **tool separada** (por ejemplo `deep_research`), ofrecida solo cuando el pedido es investigar, comparar o resumir, antes que un parámetro `mode` sobre `web_search` (un parámetro más para un modelo chico). Agregar una tool obliga a re-evaluar la decisión D2 de elección de herramienta (`eval/datasets/tool_choice_D2`).
4. **Plazo y avance.** Una pasada ronda 25–40 s (lectura 9–15 s, juez ~4 s, síntesis 7–14 s). Hace falta un plazo mayor que los 150 s actuales si hay varias pasadas, y algún modo de mostrar avance al usuario.

## 5. Riesgos

- **Inyección en la síntesis.** Hoy lo único que sale de un fragmento hostil es una probabilidad; con un modelo generativo leyendo páginas, un texto hostil puede sesgar qué se cita. Las citas verificadas evitan que invente, no que elija mal. Mitigaciones: el modelo no tiene herramientas, la salida es JSON validado, el texto final lo arma el código y se marca como síntesis de la tool.
- **Modelos y VRAM.** El 9b es más completo pero tarda el doble y pesa más (6,6 GB); el 4b ya está cargado para el flujo principal. Decidir cuál usar con datos de calidad.
- **Latencia y presupuesto de llamadas:** las lecturas por tramos son varias llamadas a Free Search por página.
- **Dependencia de `read_doc`:** falla en algunas páginas; el modo necesita un respaldo (otra fuente, o avisar).

## 6. Qué falta para decidir

Armar un conjunto de **unas 15 preguntas de investigación con hechos esperados** (comparaciones entre versiones, cambios entre releases, resúmenes de documentación extensa) y medir:

- hechos esperados cubiertos;
- afirmaciones inventadas o sin cita verificable;
- latencia por pasada;
- con y sin reformulación de preguntas, y con el 4b frente al 9b.

Con eso se decide si el modo se justifica, qué modelo usar y si la reformulación aporta. Hasta entonces, el modo rápido (con el recurso de último paso para páginas cortadas) es la única ruta.
