# Pendientes que dependen de eval

Todo lo que se cierra **midiendo**: correr `eval/`, revisar trazas reales o probar en otro entorno. El trabajo que se resuelve programando está en [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md). Actualizado el 2026-11-16; lo ya resuelto se quitó (el historial está en git).

**Alcance de plataforma:** JARVIS apunta solo a Windows y PowerShell.

## Resumen

| Frente | Estado | Qué falta |
|---|---|---|
| D3 (`reviewArgs`) | Implementado, apagado (`reviewFullView`, `reviewReads`) | Medir su efecto (§1) |
| `PENDING_FACTS_LOOKUP` | Apagado (`false`), sin mitigación | Decidir y medir la opción C (§2) |
| Falsos cierres de D5 | Guarda `completionCoverageGuard` implementada, apagada; etapa y datasets D5 listos en `eval/` | Medirla con modelos y trazas (§3) |
| `web_search` | Sin implementar | Medir multiparte y recencia, luego decidir (§4) |
| Umbrales, topes, tiempos, contexto de Ollama | Valores iniciales | Calibrar con uso real (§5) |
| Laboratorio `eval/` | Limpio de refs, con D0/D5 formales y `recalled` listos | Correr los evals con modelos y convertir `jarvis-traces/` (§6) |
| Pruebas en otro entorno | — | Hacerlas (§7) |

## Primera medición (2026-11-17)

Detalle en [`../evaluacion/INFORME_MEDICION_2026-11-17.md`](../evaluacion/INFORME_MEDICION_2026-11-17.md). Resumen:

- **Memoria en `arguments`** (`recalled`): con la memoria en el prompt, `prod` pasa de 41,7 % a 83,3 %; `args_structured_brief` llega a 100 % con 12 casos (sin significancia: hace falta un dataset mayor).
- **`final` con `recalled` e hilo:** ninguna variante supera a `prod`.
- **`pending`:** `pending_facts_safe` +3,2 % sin significancia, y baja `llm_pending_hard` (el riesgo conocido de §2). No encender nada.
- **D5:** `prod` 85,1 %; `d5_strict_parts` empata y `d5_ultra_brief` baja.
- **Pendiente de medir:** §1 (D3 con y sin `reviewFullView`), §4 (`web_search`), `question`, la fase 3 y la comparación de `plan` con `--thinking=prod` (aplazada: con thinking cada llamada tarda decenas de segundos; no correr nada con thinking hasta decidirlo).
- **El contexto real de Ollama no es 16384** (8192 de entorno, 4096 en el Modelfile de `d3`): ver §5 y la sección 4 del informe.

---

## 1. D3 (`reviewArgs`) con modelo 2B y sin lecturas

> **Investigación y flags (2026-11-15).**
>
> **Causa en el código.** `callConfirm.ts` (`reviewIfNeeded`) solo pasa por D3 las escrituras que el usuario no aprobó ni escribió y que no son verdes (`applies`); las lecturas nunca (D3 rechazaba lecturas correctas, medido). `prompts.ts#buildArgsReview` arma el estado solo con `Target`, `User Input`, `Previous Errors`, `Call` y `Args`, aunque `adapters.ts#reviewInput` y `ctx/views/review.ts` ya calculan `lastReads`, `env`, `done` y `stepsDone` (trabajo que se descarta). Medido en `eval/` (variante `args_review_compact_history`, 72,9 % frente a 62,5 %): agregar las lecturas no cambió el resultado y agregar el schema lo bajó a 70,8 %. Medido en `FRENTE_1_MEMORIA.md`: D3 aprobó 5 de 5 rutas inventadas con 0,93 a 0,95; la barrera real contra valores fabricados es `precheck.ts`, no D3.
>
> **Opciones.**
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Vista completa (lecturas recientes + entorno en el prompt de D3) | Permite contrastar rutas y nombres con lo leído | En el eval no mejoró; más tokens por consulta (D3 ronda 255 tokens y ~42 ms en el eval; la latencia sube con los tokens, estimación no medida); riesgo de falsos rechazos nuevos |
> | B. Que D3 valide lecturas | Frena lecturas con argumentos absurdos | Doble de consultas a D3 (una por lectura, hoy cero); ya rechazaba lecturas correctas; el pre-chequeo de código ya cubre las rutas inventadas |
> | C. Endurecer `precheck.ts` (determinista) | 0 ms, sin riesgo de modelo | Solo cubre lo comprobable (ruta, URL, marcadores) |
>
> **Recomendación.** Priorizar C (hecho en parte: el pre-chequeo es ahora un registro de reglas con validaciones nuevas de ruta, URL y tipo en disco; ver `CORE_FLOW.md` 6b) y no encender A ni B hasta medirlas: D3 2B no discrimina valores inventados ni con más contexto (el contexto no era el límite, lo era el clasificador). Si se prueba, A primero (menor costo) y solo en escrituras.
>
> **Implementado, apagado por defecto** (en `jarvis-config.json`, claves de primer nivel; se leen en cada llamada): `reviewFullView` (A: suma `Recent reads` y `Environment` al prompt de D3) y `reviewReads` (B: las lecturas también pasan por D3, con el umbral normal). Sin flags el prompt y el flujo son idénticos a antes (el eval no se modificó: `buildArgsReview` solo recibió un segundo parámetro opcional).
>
> **Qué medir tú.** Dataset `args_review_D3` con y sin `reviewFullView` (aciertos y falsos rechazos, sobre todo en rutas inventadas); latencia p50/p95 de D3; con `reviewReads`, la tasa de lecturas legítimas rechazadas (`args_invalid` en lecturas) en tareas reales y los `maxReviewRejectionsPerStep` que cortan pasos.

### Archivos y símbolos implicados
- `src/core/engine/callAuthorize.ts`, `src/core/engine/callConfirm.ts` y `src/core/engine/callRunner.ts`: flujo de autorización, aprobación y revisión (`tiered`, `tier`, `reviewIfNeeded`, llamada a `env.decision.reviewArgs`).
- `src/core/models/prompts.ts`: `buildArgsReview`.
- `src/core/models/decision.ts`: `Decision20Engine.reviewArgs`.
- `src/core/engine/adapters.ts`: `reviewInput` y `candidateOf`.
- `src/core/ctx/views/review.ts`: construcción de `ReviewView` (`lastReads`, `stepsDone`, `env`).
- `src/core/engine/precheck.ts`: barrera determinista previa a D3 (`writeDestinationHasSource`, `checkParentFolder`).
- `docs/evaluacion/limitaciones/d3-2b.md`, `docs/evaluacion/analisis/FRENTE_1_MEMORIA.md`.

---

## 2. `PENDING_FACTS_LOOKUP = false`

> **Investigación ampliada (2026-11-15, solo análisis: NO implementado).**
>
> **Qué hace cada camino hoy** (`runTask.ts:93-175`):
> - `first === "single"` y sin hilo: `pending = [request]` y `askModel = false`; **`pending` no se consulta** y D1 elige la ruta (una pregunta de hechos va a `web`). Es el camino que hoy salva a las preguntas sueltas.
> - `chat` (D0 ≥ 0,7): cierra sin herramientas.
> - `multi`, continuación de hilo y D0 caído (`classifyRequest` devuelve `null`): entran a `generatePending` con `PENDING_VIEW.SYSTEM`, cuya regla «charla o conocimiento general → lista vacía» no tiene la excepción de hechos cambiantes.
> - Tras cada ítem completado, `confirmCompletion` (D5) y, si no cierra, `generatePending` otra vez: la misma regla.
>
> **Dónde falla realmente.** Solo cuando `pending` devuelve `[]` o descarta el ítem de búsqueda. En `multi` el modelo puede omitir el subpaso de búsqueda; en continuaciones («¿y el precio actual del otro?») puede tomarlo por conocimiento general. La cláusula (`PENDING_FACTS_LOOKUP = true`) llevó los hechos que abren un paso de 0/12 a 11/12 (charla vacía 8/8) pero costó 2 casos ajenos en `llm_pending_hard` (−5,2): `pending-hard-008` (perdió una URL literal) y `pending-hard-026`. Es decir, el problema de la cláusula es que está en el prompt de **todos** los pedidos y mueve ítems que no tienen que ver.
>
> **Conteo estático (sin modelos) sobre los datasets de `pending` (77 casos).** Una compuerta léxica con palabras de recencia (`último`, `actual`, `hoy`, `ahora`, `precio`, `versión`, `latest`, `current`, `news`…) y sin URL coincide con 12 pedidos; **6 son búsquedas reales** (`pending-006`, `pending-020`, `pending-hard-006`, `pending-hard-029`, `pending-hard-034`, `pending-hard-042`) y **6 son locales** (`pending-014` «uso de CPU actual», `pending-027/028` «qué versión tiene package.json», `pending-hard-005`, `pending-hard-012` «ahora leé notas.txt», `pending-hard-018` «modifiqué hoy»). Precisión 50 %: una compuerta léxica sola reintroduciría la regresión.
>
> **Opciones.**
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Cláusula en el prompt (la original), con redacción afinada (URL literal intacta) | Unifica todos los caminos | Requiere re-medir `llm_pending_hard`; el 4B es sensible a cualquier cambio de redacción |
> | B. Cláusula solo si compuerta léxica **y** D0 con `chat` entre 0,5 y 0,7 (las preguntas de hechos rondan 0,51–0,65) | Limita el cambio de prompt a pedidos probables | No cubre continuaciones ni D0 caído; la compuerta léxica falla el 50 % |
> | C. Sin tocar el prompt: si `pending` devuelve `[]` y la compuerta (léxica + D0) dice «hecho cambiante», forzar `pending = [request]` | Solo actúa donde hoy se cerraría vacío (charla/conocimiento): **no mueve ítems de otros pedidos**; 0 ms de modelo | Una pregunta de conocimiento con «actual/hoy» gasta una búsqueda web (segundos); no cubre el subpaso omitido en `multi` |
> | D. Que D0 distinga `web_fact` (cuarta clase) | Separa el concepto del resto | Dataset nuevo en `eval/D0/` y recalibrar umbrales; más latencia solo si agrega preguntas |
>
> **Recomendación.** C primero (es la única que no puede mover los casos de `llm_pending_hard`, porque no toca ítems no vacíos), con la compuerta léxica restringida a pedidos sin ruta/URL y una lista corta de verbos de búsqueda; después, si hace falta cubrir `multi`, A medida en `eval/`. Descartar B como única medida (precisión 50 % y sin cobertura de hilos).
>
> **Qué medir tú.** (1) 12 preguntas de hechos + 8 de charla (`FRENTE_2_CONTEXTO.md`) → hechos que abren un paso y charla que sigue vacía; (2) `llm_pending_hard`, `llm_pending` y `llm_gemai` completos → regresiones (se espera 0 con C); (3) tasa de búsquedas innecesarias en pedidos de conocimiento con «actual/hoy»; (4) latencia añadida por tarea.

### Archivos y símbolos implicados
- `src/core/models/prompts.ts`: `PENDING_FACTS_LOOKUP`, `PENDING_VIEW.SYSTEM`.
- `src/core/engine/firstQuery.ts`: `FIRST_QUERY_CHAT_APPROVE = 0.7`, `firstQueryKind`.
- `src/core/engine/classify.ts`: `classifyRequest`, `detectContinuation`.
- `src/core/engine/runTask.ts`: enrutado por `first` y `follow.thread` .
- `eval/datasets/pending/pending_v1.jsonl` y `eval/variants/pending/pending_v1.ts`.

---

## 3. Falsos cierres de Decisión 5

### Estado actual
- `engine/completion.ts` (`confirmCompletion`): con el reactivo sin ítems pendientes, una pregunta `noul` a `d3:2b` («Using only what DONE shows, is every part of REQUEST already done?»). Si `request_complete >= COMPLETION_APPROVE (0,75)` la tarea cierra `completed` sin consultar al LLM de pendientes (~50 ms contra ~900 ms). Si no, `runTask.ts` vuelve a `generatePending`.
- Medido (`docs/evaluacion/limitaciones/d3-2b.md`): 31/36 a 0,75 (el LLM antiguo, 26/36). Falsos «sí» conocidos: copiar por mover (0,99 en todas las formulaciones) y, en pruebas sintéticas quitando el último paso, 2/6 falsos cierres a 0,75. Falsos «no» en pedidos condicionales (0,09–0,19), que solo cuestan el LLM.

### Causa raíz
D5 juzga solo con el texto de `DONE` y es un clasificador 2B: no distingue «hecho algo parecido» de «hecho todo». Un falso «sí» cierra en silencio una tarea incompleta; el único contrapeso es el umbral. No existe ninguna comprobación determinista de cobertura del pedido.

### Opciones
| Opción | Pros | Contras / latencia |
|---|---|---|
| A. Subir el umbral (0,9) | Menos falsos «sí» | Los falsos «no» se multiplican (medido); cada uno cuesta ~900 ms de LLM |
| B. Guarda determinista de cobertura: si el pedido nombra un archivo (lista cerrada de extensiones) que ninguna llamada menciona, no se cierra por D5 | 0 ms; solo hace el cierre más estricto; cubre el caso típico (se creó la carpeta pero no `gpt_info.md`) | Cobertura parcial: solo archivos nombrados; un falso bloqueo cuesta lo mismo que un falso «no» (cae al LLM de pendientes, que además es una segunda opinión) |
| C. Segunda pregunta a D5 con otra redacción (acuerdo de dos) | Reduce falsos «sí» no correlacionados | +50 ms; en el eval una pregunta más detallada subió los falsos «sí» |
| D. Dejar siempre la confirmación al LLM | Sin falsos cierres de D5 | +~850 ms en cada tarea que hoy cierra rápido |

### Recomendación
B (barata y determinista) detrás de flag, y validar con datos reales antes de tocar el umbral. A y C solo si B no alcanza.

### Implementado (apagado por defecto, sin medir)
`completionCoverageGuard` en `jarvis-config.json`: `completion.ts#uncoveredArtifacts` extrae los nombres de archivo del pedido (extensiones: txt, md, json, csv, ps1, py, js, ts, pdf, docx, xlsx, png, jpg, zip, html, css, log, xml, yml, ini, bat, cmd, exe, mp3, mp4…) y, si alguno no aparece (sin mayúsculas, sin separadores) en los argumentos ni en el resumen de ninguna llamada, `confirmCompletion` devuelve `false` sin consultar a D5. Tests: `uncoveredArtifacts` (`tests/hardening.test.ts`) y el flujo con el flag encendido y apagado (`tests/engine.test.ts`, «cierre: … guarda de cobertura …»).

### Qué medir tú
Con el flag apagado y encendido, sobre la etapa formal `d5` (`eval/datasets/d5/d5_v1.jsonl`) y trazas reales: falsos cierres (tarea `completed` con partes sin hacer), cierres que pasan al LLM por la guarda (falsos bloqueos) y latencia media por tarea.

---

## 4. `web_search`: consultas multiparte y recencia

> **Investigación ampliada (2026-11-15, solo análisis: NO implementado).** Todo lo siguiente está verificado en `src/tools/web/webSearchProvider.ts`, `args.ts` y `models/prompts.ts`.
>
> ### Multiparte
> **Mecanismo.** `lookup` (etapa 1) puntúa cada extracto contra el `need` **completo** (una probabilidad por fragmento, lotes de 5). Si **algún** extracto llega a `JUDGE_FOUND` (0,5) devuelve `found` con hasta `SNIPPET_RETURN_MAX = 3` extractos de fuentes distintas y corta; la etapa 2 (leer páginas de a una, hasta `DEFAULT_PAGES = 3`) solo corre si ningún extracto responde. No hay facetas: un extracto que responde bien a la parte A de «A y B» basta. Después, D4 (`buildResultVerification`) juzga el resultado contra la instrucción del paso, pero ve solo el texto devuelto (topado por `PASSAGES_BUDGET`) y no sabe qué faceta falta.
>
> **Causa raíz.** Se optimizó para «un pasaje que responde» (primer acierto corta), y el criterio de cobertura es por fragmento, no por pregunta. Además `RETURN_MAX = 4` y el presupuesto fijo reparten el espacio por puntuación global, no por faceta.
>
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Dividir `need` en facetas (conectores `y/and/vs/compar/diferencia`, `;`, comas) y exigir un extracto fuerte por faceta antes de `found` | Ataca la causa | +1 consulta al juez por faceta (≈ decenas de ms cada una, estimación); la división léxica falla («blanco y negro»); más código |
> | B. Chequeo determinista de cobertura de términos: los términos que distinguen del `need` (sin palabras vacías, con `stemsOf`) deben aparecer en el conjunto de pasajes devueltos; si faltan, `found` pasa a `partial` y se nota qué faltó | 0 ms de modelo; reutiliza el mecanismo de `COVERAGE_PARTIAL`; `partial` ya empuja a leer páginas y le dice al modelo qué falta | Cuando falta cobertura agrega lecturas de página (segundos, hasta 3); falsos «falta» con sinónimos |
> | C. Que el planificador (`pending`) parta el pedido en un paso por faceta | Sin cambios en el proveedor; cada `web_search` tiene una sola necesidad | Depende del 4B; no controla el caso «una frase, dos preguntas» dentro de un solo paso |
> | D. Subir `RETURN_MAX`/`PASSAGES_BUDGET` | Más espacio para varias facetas | Más tokens para D4 y el generador final; no cambia el corte temprano |
>
> **Recomendación.** B (determinista y barata; solo degrada `found` a `partial` cuando falta un término fuerte) combinada con C (ya existe: D0 `multi` + `pending`); A solo si B muestra muchos falsos «falta». Descartar D.
>
> ### Recencia
> **Mecanismo.** `freshness` (`day|week|month|year`) es un argumento opcional que elige el modelo generativo; sin él no se filtra por fecha. `DEFAULT_MAX_AGE_HOURS = 24` solo limita la caché de Free Search. El juez recibe `TODAY: AAAA-MM-DD` (`judgeNeed`) y cada fragmento con `[source date: X|unknown]` (`dated`); su criterio de `true` exige «el más reciente a la fecha de HOY» si la pregunta lo pide. `guardVersions` solo actúa con versiones exactas (`X.Y.Z`) en la pregunta. Si hay filtros y no hay resultados, reintenta sin filtros y lo avisa (`relaxed`).
>
> **Brechas.** (1) Muchas fuentes no traen fecha (`source.date === undefined` → `unknown`): el juez no puede distinguir. (2) Sin versión exacta, «¿cuál es la última…?» no tiene guarda: el 2B da `p ≥ 0,6` a resultados de meses o años atrás. (3) `buildResultVerification` (D4) **no recibe `TODAY`**: el único verificador que decide si el paso se cumplió no puede rechazar datos viejos (`FRENTE_2_CONTEXTO.md:88`). Ojo: se midió que dar `TODAY` a `pending` **empeoró** el resultado (79,2 %), así que no debe replicarse allí.
>
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Poner `TODAY` en el estado de D4 solo para pasos de `web_search` | ~15 tokens; permite rechazar lo viejo | Cambia lo que ve D4: hay que medir en `eval/` (no verificado que no regrese) |
> | B. Guarda determinista de fecha en el proveedor: si el `need` tiene palabras de recencia (`último/actual/latest/current/hoy/today`) y la fuente tiene fecha con más de N meses, limitar `p` por debajo de `JUDGE_FOUND` (como `guardVersions`) | 0 ms; no depende del modelo; parcial en vez de `found` empuja a leer más | Sin fecha no actúa; el umbral N es una decisión de producto |
> | C. Extraer fechas del texto del fragmento (años y meses con regex) cuando `source.date` falta | Cubre la brecha 1 | Heurística; falsos positivos con fechas históricas citadas |
> | D. `freshness: "year"` por defecto ante palabras de recencia | Filtra en origen | Ya hay reintento sin filtros, pero si Free Search desconoce la fecha de la fuente la descarta |
>
> **Recomendación.** B + C (deterministas, comparten la tabla de fechas) y A solo si la medición lo aprueba; D después de ver cuántas fuentes llegan con fecha.
>
> ### Qué medir tú
> - Multiparte: un conjunto de preguntas A+B (p. ej. «diferencias Node 22 y 24», «PostgreSQL 17 vs 16») → fracción con ambas facetas cubiertas en lo devuelto; tasa de `found` que pasa a `partial` con B; páginas leídas y latencia extra.
> - Recencia: preguntas «última/actual» con respuesta conocida y fuentes viejas → fracción de respuestas desactualizadas aceptadas (`found` con fuente vieja); proporción de fuentes con `source.date`; con A, regresiones de D4 en el eval.

### Archivos y símbolos implicados
- `src/tools/web/webSearchProvider.ts`: `JUDGE_FOUND`, `DEFAULT_MAX_AGE_HOURS`, `guardVersions`, `judgeNeed`, `dated`, bucles de corte temprano (`líneas 42, 48, 165, 469-554`).
- `src/tools/web/args.ts` y `src/tools/web/bm25.ts` y `src/tools/web/chunks.ts`.
- `src/core/models/prompts.ts`: `buildResultVerification` , `FINAL_VIEW`.
- `docs/arquitectura/TOOLS.md`, `docs/evaluacion/analisis/FRENTE_2_CONTEXTO.md`.

---

## 5. Calibración con uso real

- **Umbrales y topes del motor:** `REVIEW_APPROVE = 0.6`, `NOUL_APPROVE = 0.6` (`cumple`), `OK_APPROVE = 0.3` (`ok`), `BUDGET.sensitiveApprove = 0.65`, y los topes `maxSteps`, `maxCallsPerStep`, `maxItemFailures`, `availableRoutes`: son valores iniciales; requieren medición en tareas reales.
- **Contexto real de Ollama frente al configurado:** si el entorno fija `OLLAMA_CONTEXT_LENGTH=8192` o el Modelfile de `d3` fija `num_ctx 4096`, la guarda que calcula contra `16384` no protege. Ajustar en la PC o alinear en `jarvis-config.json` ([`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)).
- **Tiempos de espera** (aplazado por decisión del usuario): hay una primera versión hecha y sin validar (`src/core/timeouts.ts`, tabla en [`CONFIGURACION`](../configuracion/CONFIGURACION.md) §4, overrides `toolTimeoutsMs` y `modelTimeoutsMs`; los valores no cambiaron). Falta calibrar con uso real y decidir si se conserva. `mcpTimeoutMs` (60 s): confirmar si requiere ajuste por herramienta.
- **Anti-bucle:** en trazas reales, cuántos pasos terminan por `repeat_blocked`/`denied`/`review_rejected` con la misma `sig` repetida y cuántas preguntas repetidas se ahorran por tarea. Si es casi cero, no hace falta contar las rechazadas idénticas (`loop_blocked`). El mecanismo ya está implementado y probado.
- **Salida de escape `wrong_group`:** diferida; reabrir solo si las trazas muestran exceso de llamadas en una ruta equivocada.
- **Heurística `sameItem` (`pendingList.ts`):** sensible a pares parecidos con distinta entidad (p. ej. «10 tareas» frente a «10 procesos»); ampliar solo con casos medidos.
- **Refs:** revisar en trazas reales cuántas refs crea cada tarea y su tamaño en `data/refs`.

## 6. Laboratorio `eval/`

- **Restos fuera de `eval/`:** en `tests/eval_arguments.test.ts` quedan los casos `conRef` (no tocados; actualizar cuando se revise ese test).
- **Datasets de `question/`:** 3 casos usaban el estado `refs_unresolved` (eliminado) y pasaron a `info_missing`; medir si la pregunta del modelo cambia con la otra frase de estado.
- **Correr** los evals de `arguments` (el prompt ya no tiene `REFS`), `question/`, `d5`, memoria (`recalled`) y el resto del plan de medición (`docs/evaluacion/PLAN_DE_MEDICION.md`).
- **Trazas reales:** `npm run eval:traces` (`eval/traces.ts`) ya convierte `jarvis-traces/` en escenarios; quedan imprecisiones en la reconstrucción (EV-007 de `AUDITORIA_EVAL.md`).
- Desalineaciones detalladas entre `eval/` y `src/`: [`../evaluacion/desalineaciones-eval.md`](../evaluacion/desalineaciones-eval.md). Plan operativo: [`../evaluacion/PLAN_DE_MEDICION.md`](../evaluacion/PLAN_DE_MEDICION.md).

## 7. Pruebas en otro entorno

- Tablas de codepage 852 y 857: probarlas en una PC con esa página OEM (no hay una disponible).
- `notifications/cancelled` por stdio (ya se envía al abortar o vencer una llamada): probar contra un servidor MCP real.
- Adaptadores `mcp/` contra un servidor real.
- `DecisionValidationError` lleva `raw` (`engine/capture.ts`): confirmarlo en una traza real.
- `GET /tasks/:id/refs/:refId`: validarlo en Windows con una ref real generada en vivo.
- Symlinks con `allowedDirectories`: el test se salta si el sistema no permite crearlos sin permisos (los junctions sí se prueban).

---

## Modo `--auto` y etapas generativas: lo que queda abierto (2026-11-22)

El modo `--auto` corre de punta a punta en las 14 etapas (decisión: textos de instrucciones y opciones; generativas: texto `SYSTEM`). Lo que falta:

1. **Plurales en las palabras clave de las generativas.** `containsTerm` busca palabra completa: `test` no coincide con «tests» ni `disco` con «discos». Es deliberado, pero produce falsos fallos del modelo (dos casos de `pending_v1`). Propuesta: aceptar `s`/`es` final. Decisión pendiente.
2. **Pensamiento por defecto.** `--thinking=off` evalúa `plan` sin pensamiento aunque producción lo usa en esa etapa (y `final` según la configuración). Medir `plan` con `--thinking=prod` sigue aplazado por el tiempo por llamada.
3. **Criterio de la caché de `--auto`.** Qué compara `scanReusableInitialRanking` (url, timeout, fecha) para reutilizar resultados: sin discutir.
4. **Objetivo ya cumplido en la Vuelta 0.** Qué hace el bucle si una variante existente ya supera `--target` antes de generar nada: sin revisar.
5. **Comparar optimizadores.** `qwen3.5:4b` contra `qwen3.5:9b` sin pensamiento: nunca se completó.
6. **Repetibilidad.** Cada etapa se probó con una sola vuelta; una corrida buena no prueba que el método mejore de forma estable. Repetir `route` varias veces con holdout.
7. **Datasets.** Las etapas de decisión y las generativas las están preparando agentes aparte (`INSTRUCCIONES_AGENTE_DATASETS*.md`). `--auto` junta todos los datasets de desarrollo de la etapa (cualquier `<etapa>_v*.jsonl` sin `_holdout`): si se agregan versiones con distinta dificultad, los puntajes se mezclan.
8. **`args-v1-18`.** Exige `folder` pero la herramienta también admite `destination`; revisar con la contraprueba del encargo.
9. **Artefactos de pruebas.** Las corridas de verificación dejaron variantes y registros en `eval/variants/_auto/<etapa>/` y resultados en `eval/results/` (361 MB). Las variantes y los `ledger.jsonl` entran en las corridas siguientes de la etapa. Todo queda en `eval/variants/_auto/`, `eval/variants/_ganadoras/` y `eval/results/auto/`; las variantes que superan a `prod` se mueven solas a `_ganadoras/<etapa>/`.
10. **`export` innecesarios.** Unas 90 funciones y tipos de `eval/` están exportados pero solo se usan dentro de su archivo; es ruido, no un error.
