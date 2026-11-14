# Pendientes de JARVIS

Todo lo que falta, está por medir o por decidir, en un solo lugar. **Solo lo abierto**: lo hecho está en `CHANGELOG.md`; la evidencia y los motivos de lo descartado, en `docs/analisis/` (`FRENTE_1_MEMORIA.md`, `FRENTE_2_CONTEXTO.md`, `FRENTE_3_DECISION.md`, `FUERA_DE_FRENTES.md`, `PREGUNTAS_DECISION.md`), `docs/JARVIS_EVALUACION.md`, `eval/MEJORES_VARIANTES.md` y `eval/CONCLUSIONES_HISTORICAS.md`.

Actualizado el 2026-11-14, tras las sondas por herramienta, el aviso «escrito en X» y la auditoría técnica. Cada ítem se verificó contra el código de ese día.

**Etiquetas:** **[D]** necesita tu decisión · **[V]** hay que medirlo con los modelos reales o en uso real · **[C]** depende de algo externo (servidor MCP vivo, hardware, Ollama) · **[B]** se puede construir ya, sin decisión.

**Plataforma:** JARVIS es para Windows y PowerShell. No se va a ofrecer un shell Linux dentro de Windows (WSL, Git Bash). Lo de Linux o macOS en `policy/commandRules.ts` es precaución, no soporte.

---

## 1. Por decidir

| # | Tema | Estado y qué cambia según la respuesta |
|---|---|---|
| 1 | **DN-2.5: `pending` busca ante preguntas de hechos** (`PENDING_FACTS_LOOKUP`, `models/prompts.ts`) | Implementada y **apagada**. Medido: de 0/12 a 11/12 preguntas de hechos abren un paso, charla vacía 8/8, pero dos casos ajenos regresan (−5,2 en `llm_pending_hard`). Con D0, esas preguntas ya van a búsqueda por la ruta de «una acción»; falta saber si hace falta además. |
| 2 | **Autenticación de la API local** | `Host`/`Origin` frenan a los sitios web, no a otro proceso o usuario de la PC. `POST /config` puede apagar controles (`autoMode`, `blacklist`, `allowedDirectories`, `retentionDays`) y `GET /config` devuelve `env` de los MCP. Un token por arranque solo sirve si se entrega fuera de banda. |
| 3 | **Memoria: recetas** (DN-1.7), **«recordá que…» y pantalla para ver y borrar hechos** (DN-1.4), **respuestas del usuario y rutas de `locate` como hechos** (DN-1.3) | Hoy los hechos se editan a mano en `data/memory.json`. Las recetas (`ok ≥ 2, fail = 0`) reutilizarían una llamada que ya funcionó (38 % de las tareas reales son repeticiones exactas); requieren decidir condición y aprobación por niveles. |
| 4 | **Idioma de la respuesta final por código** (DN-2.10, N8) | El relleno ya se quita por código. Falta fijar «Answer in Spanish» en vez de «in the language of REQUEST». No hay grader de idioma en el eval: lo probás vos. |
| 5 | **Encender `approvalTiers` y/o `autoMode` por defecto** | Ambos apagados y sin medir con el modelo real (ver §2). `approvalTiers` no tiene lista de permitidos ni «no volver a preguntar lo mismo» tras un rechazo. |
| 6 | **Deep Research para `web_search`** | En pausa. Diseño en `docs/web_search/DEEP_RESEARCH.md`. |
| 7 | **Campos que ya no usa producción en `core/`** | `DecisionFrame.lastResult` (`ctx/views/route.ts`, `engine/adapters.ts`, `BUDGET.caps.{lastResultSummary,refMark}`) y `VerifyView.done`/`previous` siguen calculándose; solo los leen variantes históricas de `eval/variants/`. Decidir si se retiran del contrato junto con esas variantes. |
| 8 | **Contrato HTTP de errores** | Varios endpoints de `server/mcpRouter.ts` responden `200` con `{ error }` (la UI lo espera); `jarvisRouter.ts` usa `4xx/5xx`. Unificar toca `ui/services/jarvisApi.ts`. |
| 9 | **Dos copias de la revisión de `run_command`** | `docs/REVISION_run_command.md` y `src/tools/terminal/Revisión de la tool run_command (Jarvis).md` divergen (unas 740 líneas de diferencia). Elegir cuál queda. |
| 10 | **Cómo corregir una ruta o herramienta fallida al reintentar** (DN-3.1, DN-3.2) | Revertidos: quitar la ruta o la herramienta corregía 14 de 18 errores de ruta, pero a veces quitaba la ruta correcta o forzaba una herramienta de escritura. Hoy rige el corte tras 2 rechazos de D4 (`verify_rejected` → vuelve a `pending` → D1). Falta un mecanismo que cambie las opciones o la evidencia del reintento sin quitar la correcta. |
| 11 | **Tamaño de los modelos (N1) y decisor más liviano** | En pausa por decisión tuya: la VRAM (8 GB) está al límite. Un decisor mayor para D3/D4 va en contra de lo medido; la dirección a probar es un `d3:2b` más liviano (E15). |
| 12 | **Qué hacer con una escritura ya ejecutada que quedó «en duda»** | Condición para el estado «dudar» general (§2): no ejecuta más, pregunta al usuario o cierra la tarea, pero queda el residuo en el disco (hoy solo se avisa por `renderPlaceNote`). |

## 2. Por medir (V)

**Verificación y sondas**
- **Umbrales** `NOUL_APPROVE` y `REVIEW_APPROVE` (0,6, `engine/verify.ts`): valores iniciales; una aprobación al 51 % ya se rechaza. Medir falsos rechazos en uso real (el eval comparte `NOUL_APPROVE`).
- **Sondas por herramienta** (`tools/probes.ts`, umbral 0,6): en 52 casos de producción, 0 buenas rechazadas y 30/34 malas rechazadas. **Se escapan 4** (ubicación 0,64; alcance `app*.log` 0,71; ítem «Hoja1» por «Costos» 0,99; atributo «modificados esta semana» no pasa la compuerta): piden una pregunta mejor, no otro umbral. Falta medir falsos rechazos en uso real. `verify-105` (posición, 0,60) es un artefacto de medición: se evaluó con el pedido de tres pasos y no con el paso.
- **Propuestas sin implementar de `PREGUNTAS_DECISION.md`:** D5 con dos preguntas (media ≥ 0,6: 31/36 → 33/36), D4 con vista doble (el acuerdo entre vistas indica confianza), estado «dudar» general ante discrepancia, polares en D3. Además, una segunda vista barata para D1, D0 y continuación (sin pistas o con la solicitud en vez del paso) con duda cuando discrepan: **sin medir**, hay que armar casos con la respuesta verdadera.
- **D3 casi no corre en producción** (solo en escrituras sin aprobación o con `autoMode`): medirlo sobre escrituras reales sin aprobación humana.
- **Pre-chequeo** (`engine/precheck.ts`): falta probarlo en uso real (falsos rechazos) y con el parser real de PowerShell.
- **`reconcileList`, límites del flujo** (`maxSteps` 20, `maxReplans` 3, `maxCallsPerStep` 6, `maxAttemptsPerStep` 10, `maxRepeatsPerStep` 2, `maxUserRejectionsPerStep` 2, `maxVerifyRejectionsPerStep` 2), encabezado fijo de `renderStatusNote` y tareas de más de ~10 llamadas: sin medir con el modelo real.
- **Política de repetición:** un modelo que insiste en una consulta idéntica la ejecuta cuando el criterio del paso cambió; medir si hace falta cortarlo antes.

**Memoria e hilo**
- Hilo y hechos de punta a punta con tareas reales encadenadas y los modelos vivos; en especial `CONTINUATION_APPROVE` (0,3) en sesiones largas.
- Sin probar: el hilo dentro de `pending`, la ejecución de recetas, la selección de hechos con cientos de ellos (se probó con 5; hay que medir falsas coincidencias) y la solicitud original en argumentos con un caso propio (DN-2.4: el eval no puede medirlo porque el prompt recibe la vista ya renderizada).
- DN-2.5 se midió con 12 preguntas de hechos escritas a mano y una sola corrida de charla: repetir con `--repeat=2` y más casos.
- Plan, replan y pregunta al usuario no se auditaron con datos reales.

**Políticas**
- `autoMode` y `approvalTiers`: cuántas escrituras peligrosas aprobaría el 2B; cuántas confirmaciones serían «verdes».
- `policy/commandRules.ts` (solo tests de humo), `policy/readOnly.ts` (lista cerrada: `(Get-Date).AddDays(-1)` o `ForEach-Object` aún piden confirmación) y `policy/sensitivePaths.ts`: falsos positivos y negativos en uso real.

**Prompts**
- `PROMPTS.PENDING_VIEW` (`pending_elite_labels`): confirmar en uso real que ya no inventa el comando («…usando el comando ps»).

**`web_search`**
- `found` no mide cobertura de la pregunta (con preguntas de varias partes basta una faceta) ni prefiere fuentes oficiales.
- Recencia en «último X»: ni el ranking ni D4 priorizan la fecha (visto otra vez con «Gemini 4 Carbon»). Medir con un dataset «último X» y calibrar `JUDGE_FOUND`/`JUDGE_PARTIAL`.
- Sin el 2B (`webSearchUseJudge` apagado) responde algo en 4 de 5 preguntas sin respuesta; el 2B va encendido por defecto.
- `timeoutMs: 150_000` de `web_search`: falta medir si alcanza de forma estable.

**`run_command` en Windows vivo**
- Verificar la copia embebida de `__jvDecode` en `powershell.exe` (tests unitarios y la suite pasan, pero no se probó en una consola real) y qué pasa con `ipconfig.exe | …` (sigue con `�`).
- Prompts: el falso negativo de un programa que lee entrada sin mostrar prompt (`node` con stdin, `findstr`).

**Experimentos del plan de evaluación** (`JARVIS_EVALUACION.md`, «Experimentos», E1 a E20): hechos E1, E2 (en parte) y E11 (arranque en frío); E10 descartado y E7 con menos prioridad (un decisor mayor agrava la VRAM). El resto no tiene estado registrado y se considera abierto; los más útiles ahora: E9 (calibración de umbrales), E12 (confirmaciones «verdes»), E13 (tipo de cada argumento), E17 y E19.

## 3. Por construir

**Decisión y contexto**
- **DN-2.7** estructura `signals` + `data` + `note` en el resultado (hoy `summary` mezcla datos, señales y avisos); **DN-2.8** secciones por herramienta en el catálogo; **DN-2.9 / N3** topes y configuración contra el contexto real de Ollama (`OLLAMA_CONTEXT_LENGTH=8192`, `d3` usa 4096): depende de cómo se arranca Ollama **[C]**.
- **DN-3.3** contar una entrada de decisión repetida como «sin avance» y fallar el paso; **DN-3.5 C** caché LRU entre tareas; **DN-3.6** quitar datos volátiles de las vistas de decisión (baja prioridad con los modelos sin visión: 20 a 130 ms); **DN-3.8** zona de duda general en umbrales (las sondas ya usan «dudar = rechazar»).
- **N4:** cortar «ítem reescrito idéntico» y «no volver a preguntar tras un rechazo del usuario».
- **N5:** verificación por código para comandos y búsquedas (hoy siguen con el modelo).
- **Pistas deterministas de recuperación** en `LAST ERROR`/`FAIL`: ruta inexistente → entradas más parecidas del directorio padre; comando inexistente → comandos parecidos; búsqueda sin resultados → ampliarla. Un 4B corrige mal a ciegas; el estado más frecuente es `loop_blocked` (72 contra 6 `tool_error` en 116 tareas) **[B]**.
- **Argumentos por código y decisión antes que generativo** (slot-filling, E4) y **relleno declarado de todos los argumentos** (solo texto nuevo por generativo): vale por fiabilidad (46 `args_invalid` en 116 tareas), no por velocidad; medir antes (E13). Probar también el esquema de la herramienta como `json_schema` en `args` (hoy `json_object`).
- **Recetas de terminal** para los comandos más frecuentes («los N procesos que más RAM consumen», «abrí la calculadora» → `Start-Process calc`, que hoy espera una confirmación de 12,7 s). Distintas de las recetas de memoria (§1.3).
- **Preguntas al usuario armadas por plantilla** (la decisión elige qué argumento falta; hoy lo redacta el generativo) y **acuerdo entre dos formulaciones en escrituras sensibles**.
- **D3 dividido en preguntas `noul` específicas** (E14): en D1/D2 una `noul` por opción fue peor (20/22 contra 22/22) y 3 veces más lenta; para D3 no está medido **[V]**.
- **Traza:** marcar si cada consulta vino tras un cambio de modelo (lo que más explica la latencia) y registrar los márgenes de decisión (DN-3.8 B: la zona de duda de ±0,03 afecta al ~2 %).
- **Vistas de contexto (Frente 2):** F3 la solicitud original no llega a D2, D3 y D4 (solo el ítem reescrito; D1 y argumentos ya la reciben); F5 el peor caso de D4 supera los 4 096 tokens reales y la guarda compara contra 16 384 (silencioso); F6 identificadores internos (`c1 s1`, `verdict=approved`, rutas con uuid) en texto para modelos; F8 rótulos de `pending` con expresiones regulares sobre texto ya renderizado; F4 el mismo resultado se reenvía completo a seis consultas.
- **Contexto de tareas largas:** la reserva de efectos (12 000 caracteres) ocupa la mitad del contexto real (8 192 de Qwen); compactar efectos viejos a una línea sin ocultarlos; tareas largas cierran `unrecoverable`.
- **Timeouts:** distinguir un timeout de una caída y no cerrar la tarea por un único timeout transitorio.
- **Lista tras un fallo:** pedir al generativo solo el ítem reescrito (salida más corta; `reconcileList` ya conserva el resto).
- **N7:** copiar el literal de la solicitud al argumento sin generativo.
- **N6** respuesta final en streaming y **N9** progreso visible durante esperas largas; **Idea 4** respuesta final sin generativo.
- **T2** tarea larga decidida por código según el largo de la lista; **T5** herramientas básicas propias para no depender de la terminal (elección probada; falta el proveedor y los argumentos con Qwen).
- **Lugar equivocado, antes de escribir:** el aviso «Quedó escrito en X» ya sale (`renderPlaceNote`), pero el archivo ya quedó. Falta detectar el lugar antes (carpeta que existe en dos sitios: preguntar o usar `locate`).

**Herramientas y flujo**
- **Repetición estricta de `run_command`** (RC-21): «correr las pruebas, corregir, volver a correrlas» bloquea el segundo `npm test` idéntico. Exige una política de repetición propia (`repeatByArgs`) **[D]**.
- **`list_directory` con `depth: 0`** devuelve «Directorio vacío.» desde Desktop Commander **[C]**.
- **D1 no obedece «usá la terminal»:** «creá una carpeta usando la terminal» fue a archivos y usó `create_directory`. Falta la salida de escape y medir cambios de ruta.
- **Candidato idéntico a uno rechazado (`args_invalid`):** el tope de 2 lo acota, pero no se bloquea antes de generar los argumentos; no es posible antes porque la huella (`sig`) sale de los argumentos resueltos.
- **Comandos:** heredan el entorno desde donde se lanzó Jarvis (no las variables de `.env`) (RC-16).
- **Confirmaciones repetidas de `web_search`:** tras rechazar una consulta con un dato sensible, el modelo la reformula y se vuelve a pedir confirmación en cada intento. Y una cadena de 40+ caracteres alfanuméricos (un SHA) exige confirmación aunque sea legítima (`policy/egress.ts`).

**API y prompts**
- Exponer la lista de pendientes (solo vive en `runReactive`) y las decisiones D1 a D4 en vivo (solo las registra la traza al terminar): exige guardarlas en el contexto o emitir un evento nuevo.
- Comprobar `GET /tasks/:id/refs/:refId` con una ref real (necesita una tarea real).
- Para que una variante del eval agregue o quite partes de un prompt, `prompts.ts` debe organizarse en partes con nombre (hoy son literales dentro de `buildX`).
- `ERROR_PREVIO: tu respuesta anterior fue inválida…` está en español dentro de prompts en inglés (`retryNote`, `prompts.ts:88`).

**Eval**
- **Corregir tres etiquetas desfasadas:** con el cliente `oracle` fallan `verify-152`, `verify-153` (`d4_verify_hard`) y `verify-hard-028` (`llm_verify_hard`) porque esperan `ok = false`, pero el código responde `ok = 1` en esas lecturas. El veredicto final no cambia (`cumple` coincide).
- **Etapa para D5 y dataset propio** (los casos de cierre viven en `eval/exp/close_check.ts`); ampliar los casos de cierre con lecturas.
- Laboratorio: corre con pensamiento `auto` si no se indica (`--thinking=off`), sus latencias no representan producción y no conviene correr dos corridas a la vez (comparten la GPU).
- **Eval de segundo nivel** (correr `runTask` entero con modelos reales y descubrimiento guionado) y un **script que convierta una carpeta de traza en casos por escenario** (el anterior, `eval/gen/reales.ts`, se eliminó).
- Los datasets nuevos deben traer `steps[].instruction` realista: un caso reactivo sin ella toma la solicitud entera, que no es lo que produce la lista de pendientes.
- El eval rearma los requests desde las vistas con clientes propios (`eval/core/client/*`): riesgo de desvío respecto de producción **[V]**.
- `eval/core/runner.ts` quedó con 0 reintentos ante salidas inválidas de Decisión (como `src/`, DN-3.4). En la corrida con modelos reales no apareció ninguna salida inválida; falta repetirla con más casos **[V]**.

**Backend**
- **Retención** (`retention.ts`): solo por antigüedad (`retentionDays`, 30), sin tope por tamaño; solo borra carpetas con nombre de Jarvis.
- **Tests que faltan:** MCP reales contra procesos reales (`desktop_commander`, `free_search`), parser real de PowerShell, `GET /tasks/:id/refs/...` con tarea real.
- `docs/inputSchemaManifest.md` (raíz) desactualizado: se regenera con `scripts/dumpManifestInputSchemas.ts`, que necesita los servidores MCP activos **[C]**.

## 4. Seguridad abierta

Modelo de amenaza: un solo usuario en su PC.

- Sin autenticación en la API (ver §1.2) y sin límite de tasa: hay tope de tareas (`MAX_ACTIVE_TASKS` 4) y de conexiones SSE (`MAX_SSE_CLIENTS` 8) con `429`, pero no de peticiones por segundo ni de tamaño de mensaje.
- `GET /config`, el texto de las refs y las trazas pueden exponer secretos a cualquier cliente local.
- **Datos en reposo sin protección:** las refs y las trazas (`full.json.gz`, con prompts y resultados crudos) quedan en texto plano durante `retentionDays`, incluidas las claves que el usuario aprobó leer. Sin cifrado ni redacción de secretos.
- **`allowedDirectories`** viene vacío y solo valida las herramientas de archivos: no restringe a `run_command`.
- **`sensitivePaths.ts`:** listas cerradas; miran el texto, no lo que un comando arma con variables; falta detección de symlinks, nombres 8.3 y rutas UNC.
- **`commandRules.ts`:** no reconoce llamadas .NET que no sean las estáticas a `[IO.File]`/`[IO.Directory]` (por ejemplo `(Get-Item x).Delete()`), ni variables definidas por el propio comando.
- **`autoMode` descansa en un modelo de 2B** para lo que las reglas no marcan; encendido, el único control humano son las rutas sensibles.
- **Inyección de instrucciones:** el contenido de `web_search` y de los archivos leídos llega marcado entre `<obs>` y saneado, pero no hay detección; la mitigación real son las confirmaciones.
- **Canal de salida:** la consulta de `web_search` pasa por `policy/egress.ts`, pero texto libre que no dispare esos patrones puede enviarse.
- **Procesos en segundo plano:** una tarea completada los deja vivos (puede ser lo pedido); se cierran al apagar Jarvis. Prompts silenciosos sin PTY: a resolver en Jarvis 2.0.

## 5. Deuda técnica menor

- `precheck.ts` (`collectSources`, línea 122) llama a `ctx.view.forReview(...)` solo para leer `userInput`: falta un selector dedicado en `ctx/views/`.
- `core/models/transport.ts:153`: el listener de `abort` del backoff no se quita si el `setTimeout` vence primero (retiene la referencia hasta que se descarte el `AbortSignal`).
- `core/engine/services.ts:33`: `coherenceWarned` es estado global de módulo, compartido entre instancias de `TaskManager` y tests.
- `DecisionQuestion.score` está en el contrato pero no se implementa en `validateAnswer`; los nombres `Decision20Engine` y «Decision 2.0» en mensajes son heredados; los «D3/D4» de los comentarios son decisiones de diseño, no las decisiones `d3`.
- **Limpieza de Ollama:** `d3:2b-text-cpu` y `d3:2b-cpu` solo sirvieron para una prueba de CPU (`ollama rm`).
- **Archivos del laboratorio sin uso en `src`:** `eval/variants/ctx/*` y los experimentos de `eval/exp/` (`place_wordings.ts`, `probes_d4.ts`, `probes_refine.ts`, `polar_wordings.ts`, etc.) se conservan como evidencia; se pueden archivar cuando ya no se necesiten.

## 6. Ideas futuras (capacidades nuevas, sin prioridad)

Detalle en `docs/JARVIS_EVALUACION.md`, «Mejoras futuras».

Delegación a agentes especializados · contexto vivo de la PC (ventana activa, portapapeles, archivos recientes) · aprobaciones y respuestas en lenguaje natural por Telegram y voz · generativo distinto por etapa · lecturas independientes en paralelo · deshacer (copia antes de sobrescribir, papelera) · herramientas nuevas (volumen, capturas, calendario…) · tareas programadas y avisos proactivos · reanudar tareas tras reiniciar (existe el snapshot `v1`, falta la restauración) y cola con prioridad entre Telegram, voz e interfaz · afinar el modelo de decisión con trazas etiquetadas.

## 7. Qué dejó de ser pendiente (para no reabrirlo)

Hechos y descartados, con su evidencia en los documentos de análisis y el `CHANGELOG.md`: D0, hilo y hechos, verificación por código de las escrituras, sondas por herramienta, aviso «escrito en X», relleno de la respuesta final, `not_found` de escrituras, corte tras 2 rechazos de D4, pre-chequeo de destinos, modelos sin visión, `keep_alive` y precalentamiento, memoización por tarea, orden de opciones de D2, alineación del eval con `src/`. **Descartados con medición:** quitar la ruta o la herramienta fallida al reintentar (DN-3.1, 3.2), formato de lo hecho por ítem (DN-2.6), fusionar D1 y D2 (T3), paralelismo en decisión (T4), embeddings y resumen escrito por el 4B para la memoria, pasar los argumentos bloqueados como prohibidos (R5).
