# Modo «Deep Research» para `web_search` — idea y conclusiones (2026-11-13)

**Estado: EN PAUSA (2026-11-13). Idea e investigación documentadas (secciones 7 a 10), sin implementar.** Para retomar: el orden propuesto está en la sección 10 y los hallazgos abiertos en `README.md`. Este documento reúne la propuesta, los pilotos que se hicieron y lo que falta medir. Los datos están en `scripts/validate/web_eval/RESULTADOS.md` («Exploración para un modo Deep Research»).

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

---

# Investigación (2026-11-13): debilidades frente a búsquedas intensas y qué hacen los grandes

## 7. Dónde se queda corto el modo rápido con preguntas intensas

Sonda cualitativa con 8 preguntas «intensas» contra el proveedor real (Free Search + 2B): `scripts/validate/web_eval/deep_probe.ts`. No tiene respuestas esperadas; se leyó a mano el texto que recibiría el modelo.

| Pregunta (tipo) | Qué devolvió | Qué falta |
|---|---|---|
| Node 22 vs 24 en rendimiento y compatibilidad (comparación) | `found`, 2 fragmentos de un solo blog de ciclo de vida | Una comparación real: rendimiento (V8, cambios de runtime) y compatibilidad de las notas oficiales |
| Cambios de seguridad **y** rendimiento de PostgreSQL 17 vs 16 (varias facetas) | `found`, 1 extracto, solo vacuum/rendimiento | Seguridad: la mitad de la pregunta sin cubrir, y aun así `found` |
| Quién creó Redis **y** la fecha de su primera versión (dos hechos) | `found`, un extracto que dice «2009, proyecto personal» | Fecha exacta de la primera versión pública |
| Opciones de `fs.cp` y su valor por defecto (documentación extensa) | `not_found` tras leer 3 páginas | La página oficial (`nodejs.org/api/fs.html`) no estaba entre las 3 primeras; todas eran blogs |
| Límites de un item **y** de una consulta en DynamoDB (facetas) | `found`, 1 extracto (400 KB, páginas de 1 MB) | Límites de `Query` más allá de la paginación |
| Novedades de Python 3.14 (lista) | `found`, 3 extractos de blogs | La lista completa de las notas de versión oficiales |
| Versión más reciente de Kubernetes **y** cuándo termina su soporte | `found`, un extracto: «la más reciente es la 1.37; 1.35 se queda sin parches el 28/02/2027» | El fin de soporte **de la 1.37**, no el de otra versión |
| Mejor base de datos vectorial en 2026 (subjetiva) | `found`, dos blogs de ranking | Contraste de varias fuentes; las dos de arriba son contenido de SEO |

### Debilidades identificadas

1. **`found` mide relevancia de un fragmento, no cobertura de la pregunta.** El 2B puntúa cada fragmento por separado («¿responde la pregunta, aun en parte?»); si un extracto trata una faceta, la tool declara `found` y deja de buscar. Es el fallo más serio con preguntas de varias partes (PostgreSQL, Redis, Kubernetes).
2. **Sin descomposición.** Una sola búsqueda con la frase del usuario. Las preguntas de comparación o de varias facetas necesitan una búsqueda por faceta.
3. **Sin elección de fuente autoritativa.** Los resultados mezclan blogs y SEO con documentación oficial; no hay un paso que apunte a `nodejs.org`, `docs.python.org` o `postgresql.org`. Es el mismo problema que Anthropic detectó en su sistema (los agentes preferían contenido optimizado para buscadores a fuentes autoritativas).
4. **Profundidad fija y corta.** Hasta 8 extractos y 3 páginas; la tool no sigue pistas (un nombre, una versión, un enlace) para una segunda ronda.
5. **Sin síntesis ni agregación.** Entrega hasta ~1700 caracteres de fragmentos; un resumen o una comparación necesitan decenas de fragmentos de varias páginas, que no caben en el contexto del modelo que responde.
6. **Recuperación solo léxica.** BM25 por prefijo de 5 letras no cruza idiomas ni sinónimos, y el juez 2B solo ve 6–12 candidatos por página.
7. **El juez puntúa sin calibrar.** Probabilidades que se saturan (0,95–0,99) y falsos positivos de entidad cercana (en la evaluación, un extracto sobre `TTL` aprobado para `EXPIRE`; aquí, el soporte de otra versión de Kubernetes).
8. **Sin memoria entre llamadas ni plan visible.** Cada `web_search` empieza de cero; el motor limita 6 llamadas por paso y la tool tiene 150 s.
9. **Cobertura de páginas.** Páginas cortadas (resuelto en parte), páginas con JavaScript que devuelven vacío (`aistudio.google.com`: 0 caracteres), bloqueos anti-bot y `read_doc` con errores del servidor.
10. **Sin evaluación para este tipo de pregunta.** Los 41 casos son preguntas de un hecho; no hay medida de cobertura, de afirmaciones sin sustento ni de latencia en investigación.

## 8. Qué hacen los grandes (y qué es nuestro)

Fuentes: ver al final. Lo que no tiene fuente primaria está marcado.

| Mecanismo | Quién | Detalle verificado |
|---|---|---|
| **Orquestador + subagentes en paralelo** | Anthropic | Un agente líder planifica y lanza subagentes con contexto propio; cada uno recibe objetivo, formato de salida, guía de herramientas y límites de tarea. Con instrucciones cortas los subagentes duplicaban búsquedas. Opus 4 líder + Sonnet 4 subagentes superó a Opus 4 solo en 90,2 % en su evaluación interna, sobre todo en tareas de amplitud. Es un esquema 15× más caro en tokens que un chat. |
| **Escala de esfuerzo explícita** | Anthropic | Un dato simple: 1 agente, 3–10 llamadas; una comparación: 2–4 subagentes, 10–15 llamadas cada uno; investigación compleja: más de 10 subagentes. Las primeras versiones lanzaban 50 subagentes para preguntas simples. Es el equivalente a nuestro modo rápido frente al profundo. |
| **Buscar de lo amplio a lo específico** | Anthropic | Consultas cortas y amplias primero, luego se afina; los agentes tendían a empezar con consultas largas y muy específicas que devuelven poco. Tras cada resultado, el subagente evalúa su calidad y ajusta la siguiente consulta. |
| **Memoria externa** | Anthropic | El líder guarda el plan porque su contexto se trunca; los subagentes escriben resultados a almacenamiento externo y devuelven una referencia liviana. Nosotros ya tenemos refs en disco. |
| **Agente de citas aparte** | Anthropic | Un agente posterior atribuye fuentes a las afirmaciones. |
| **Planificación visible y editable** | Google | `collaborative_planning`: el agente devuelve un plan de investigación que el usuario puede refinar antes de ejecutarlo. El plan separa subtareas paralelas y secuenciales. En cada paso el agente se apoya en lo reunido, identifica información faltante y discrepancias, y sigue. Corre en segundo plano durante varios minutos. |
| **Dos versiones: velocidad y exhaustividad** | Google | Deep Research (rápida, para interfaz) y Deep Research Max (máxima exhaustividad). Es un precedente directo de nuestros dos modos. |
| **Herramientas básicas: búsqueda y lectura profunda de una página** | Google, OpenAI | Google: búsqueda + lectura de URL + ejecución de código; OpenAI: búsqueda, navegador (abrir, desplazar, buscar en la página) y código. |
| **Modelo entrenado con aprendizaje por refuerzo en tareas de navegación** | OpenAI | La base es una versión temprana de o3, entrenada con RL en tareas de navegación; no se le permite construir URL arbitrarias (mitigación de inyección). El resto del detalle interno (planificación, límites) no es oficial. |
| **Búsqueda de calidad = más cómputo** | OpenAI (BrowseComp), Anthropic | En BrowseComp la precisión crece con el cómputo en tiempo de prueba; en el análisis de Anthropic, la cantidad de tokens explica el 80 % de la varianza. Los agentes que tienen éxito reformulan tras un fallo y persisten. Los modelos suelen expresar alta confianza en respuestas erróneas. |
| **Contexto aislado por subagente y limpieza** | LangChain (Open Deep Research) | El historial se condensa en un resumen de la investigación; cada subagente hace una llamada extra para limpiar sus hallazgos; un supervisor decide si cubren el pedido y lanza más. Redactar secciones en paralelo producía informes inconexos: la redacción final es una fase aparte. |
| **Perspectivas y árbol recursivo** | STORM, GPT-Researcher | STORM genera preguntas desde distintas perspectivas; GPT-Researcher ramifica recursivamente. |
| **Recuperación híbrida y reordenamiento** | Perplexity (descripciones de terceros) | BM25 + densa + reordenamiento con un cross-encoder; los detalles internos no están confirmados. |
| **Contexto por fragmento** | Anthropic (Contextual Retrieval) | Anteponer a cada fragmento una breve descripción de su lugar en el documento: BM25 + embeddings contextuales redujeron los fallos de recuperación (top 20) de 5,7 % a 2,9 %; con reordenamiento, a 1,9 % (−67 %). |
| **Evaluador de recuperación (CRAG), multi-consulta con fusión (RRF), HyDE** | Literatura RAG | Mejoras consistentes con reescritura de consultas; el evaluador solo sirve si está bien calibrado (uno que califica basura como correcta degrada a RAG ingenuo con más latencia). |
| **Modelos pequeños entrenados para investigar** | LiteResearcher-4B, DR-Venus-4B, AgentCPM-Explore | Agentes de 4B entrenados con RL que declaran igualar o acercarse a modelos mucho mayores en benchmarks de navegación; cifras autoinformadas, no verificadas de forma independiente. |

### Lo que fallan incluso ellos (importa para nuestro diseño)

- **Citas sin sustento.** Auditorías de sistemas comerciales reportan exactitud de citas entre 40 % y 80 % (DeepTRACE), URL inventadas o que no resuelven entre 3 % y 18 %, y afirmaciones sin respaldo en proporciones altas; la confianza en respuestas erróneas es otro problema. Esto respalda nuestra regla de **citas literales verificadas por código** y la de no devolver texto que no esté en una fuente.
- **Costo:** el esquema multiagente consume ~15× tokens; no es gratis.
- **Sincronía:** el líder de Anthropic no puede dirigir a los subagentes mientras corren.

## 9. Qué está a nuestro alcance y cómo aprovecharlo

Restricciones reales: modelos locales (Qwen 3.5 4B y 9B vía Ollama, 2B de decisión), una sola máquina (las llamadas al modelo se serializan: el paralelismo ayuda en la red, no en la generación), Free Search como fuente de datos, un `ToolHost` con plazo de 150 s y un motor con 6 llamadas por paso.

### A. Sin modelo generativo (barato, determinista)

1. **Elegir mejor la fuente.** Usar lo que Free Search ya ofrece: `category` (software, seguridad, papers, documentación), `include_domains` (si el pedido nombra un producto con documentación oficial conocida), `source_type` (`code`, `government`, `news`, `forum`…) y una lista corta de dominios autoritativos como prioridad al ordenar. Ataca la debilidad 3.
2. **Cobertura de facetas con el propio 2B.** El juez `noul` no genera texto: se le puede preguntar «¿el fragmento cubre la faceta X?» por cada faceta. Sirve de criterio de parada («¿ya cubrimos todas?») sin un modelo generativo. Ataca la debilidad 1; hay que medir su calibración antes de confiar (el riesgo del CRAG mal calibrado).
3. **Recuperación híbrida con embeddings locales** (por ejemplo, un modelo de embeddings de Ollama) fusionados con BM25 por RRF: cubre el cruce de idiomas y los sinónimos. Hace falta instalar un modelo de embeddings (hoy no hay ninguno en la máquina) y medir.
4. **Contexto por fragmento sin modelo:** anteponer a cada fragmento el título de la página y la ruta de títulos (ya repetimos el último título) para que BM25 y el juez vean el contexto.
5. **Reordenador cross-encoder:** el 2B ya cumple ese papel de forma puntual. Un reordenador dedicado (bge-reranker-v2-m3, Qwen3-Reranker-0.6B) aportó ~+0,045 de nDCG en una prueba en español, pero la latencia en CPU es de segundos para 20–30 candidatos y la evidencia es débil; prioridad baja.
6. **Paralelismo de red:** varias búsquedas y lecturas a la vez (`Promise.all`); cada `search` tarda unos 3–5 s y se solapan bien.
7. **Almacenamiento externo del material:** guardar los fragmentos en refs de disco y devolver al modelo solo la síntesis con referencias (equivalente a la memoria externa de Anthropic).
8. **Páginas difíciles:** lectura completa por `read_doc` (ya está), `fetch render=browser` para páginas con JavaScript, y respaldo cuando `read_doc` falla.

### B. Con modelo generativo (4B o 9B local)

9. **Planificador:** descompone la pregunta en 2–5 subpreguntas con una consulta cada una (JSON), con una **escala de esfuerzo** como la de Anthropic (pregunta simple → modo rápido; comparación → 2–4 subpreguntas; investigación → más). Ataca la debilidad 2.
10. **Reformulación tras un fallo:** de lo amplio a lo específico, con las entidades halladas en la primera ronda (consultas de varios saltos). Es lo que más distingue a los agentes exitosos en BrowseComp; **no hay evidencia propia todavía** de que el 4B/9B lo haga bien.
11. **Síntesis extractiva con citas verificadas** (ya probada): un resumen por subpregunta con cita literal por afirmación, verificada por código (cita presente en el fragmento y números de la afirmación presentes en la cita), y luego una fusión de las subrespuestas. La fase de redacción final va separada, como en Open Deep Research.
12. **Detección de discrepancias y fechas:** como Google («identificar discrepancias»), apoyada en la fecha de cada fuente.
13. **Plan visible:** mostrar el plan al usuario antes de ejecutarlo, como `collaborative_planning`; encaja con la interfaz de aprobaciones de Jarvis.

### C. Orquestación

- **Presupuesto con informe parcial:** si se agota el tiempo o las llamadas, devolver lo hallado indicando qué faltó (como hacen OpenAI y Anthropic).
- **Reintento y reanudación:** si falla un paso, no reiniciar toda la investigación.
- **Plazo y ejecución en segundo plano:** el modo profundo no cabe en 150 s con varias rondas; hace falta un plazo mayor y avisos de progreso.
- **Inyección:** el generador no tiene herramientas, produce JSON validado y el texto final lo arma el código; no construye URL arbitrarias (idea de OpenAI): solo lee URL que vinieron de `search` o del usuario.

## 10. Orden propuesto y cómo medirlo

Primero lo que corrige fallos ya vistos y no necesita modelo generativo; después lo que sí lo necesita, por etapas y midiendo cada una contra la anterior (la sugerencia de Anthropic: empezar con ~20 consultas reales, suficientes para ver diferencias grandes).

| Paso | Qué | Ataca | Costo | Riesgo |
|---|---|---|---|---|
| 1 | Cobertura de facetas con el 2B y que `found` exija cubrir las facetas (aun en el modo rápido) | 1, 7 | Bajo | Calibración del juez |
| 2 | Selección de fuente autoritativa (`category`, `include_domains`, `source_type`, dominios de prioridad) | 3 | Bajo | Lista de dominios que mantener |
| 3 | Planificador + una búsqueda por subpregunta, en paralelo, con escala de esfuerzo | 2, 4 | Medio | Calidad del 4B/9B para descomponer |
| 4 | Síntesis extractiva con citas verificadas y fusión final | 5 | Medio | Inyección, latencia (7–14 s por llamada) |
| 5 | Recuperación híbrida con embeddings locales | 6 | Medio | Instalar y medir un modelo de embeddings |
| 6 | Reformulación tras un fallo y segunda ronda | 4 | Medio-alto | Sin evidencia de que el modelo local la haga bien |
| 7 | Plan visible, plazo mayor y segundo plano | 8 | Medio (interfaz) | Cambios en el motor |

**Conjunto de evaluación para deep** (15–20 preguntas con una lista de hechos esperados): comparaciones entre versiones, preguntas de varias facetas, listas («novedades de…»), documentación extensa, dos hechos en una pregunta, una pregunta sin respuesta, una subjetiva. Métricas: **cobertura de hechos**, **afirmaciones sin cita verificable** (verificación por código), **fuentes autoritativas / de SEO**, **latencia** y **tokens**. La sonda `deep_probe.ts` ya es el punto de partida (las 8 preguntas de la sección 7).

## Fuentes

- Anthropic, «How we built our multi-agent research system»: https://www.anthropic.com/engineering/multi-agent-research-system
- Google, documentación del agente Gemini Deep Research (planificación colaborativa, herramientas, ejecución en segundo plano): https://aistudio.google.com/docs/deep-research
- Google, Deep Research y Deep Research Max (abril 2026): https://blog.google/innovation-and-ai/models-and-research/gemini-models/next-generation-gemini-deep-research/
- OpenAI, tarjeta de sistema de deep research: https://openai.com/index/deep-research-system-card/ (el detalle de planificación y de límites viene de descripciones de terceros: https://blog.promptlayer.com/how-deep-research-works/, no oficial).
- OpenAI, BrowseComp: https://arxiv.org/html/2504.12516
- Xu y Peng, «A Comprehensive Survey of Deep Research»: https://arxiv.org/abs/2506.12594
- LangChain, Open Deep Research: https://www.langchain.com/blog/open-deep-research
- Anthropic, Contextual Retrieval (cifras citadas de resúmenes de terceros, p. ej. https://www.maginative.com/article/anthropics-contextual-retrieval-technique-enhances-rag-accuracy-by-67)
- Auditorías de citas: DeepResearch Bench (https://iclr.cc/virtual/2026/poster/10008065), ReportBench (https://arxiv.org/pdf/2508.15804), alucinación de referencias en agentes (https://arxiv.org/pdf/2604.03173).
- Modelos pequeños de investigación (cifras autoinformadas): https://huggingface.co/huggermax/TinyResearcher, https://hyper.ai/de/papers/2604.19859
- Reordenadores locales (evidencia débil y de terceros): https://glukhov.org/rag/embeddings/qwen3-embedding-qwen3-reranker-on-ollama/
- RAG avanzado, CRAG, RRF, HyDE (resúmenes): https://arxiv.org/pdf/2510.10787
