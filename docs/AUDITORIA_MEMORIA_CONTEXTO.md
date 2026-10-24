Auditoría de Contexto y Memoria — JARVIS (src) v0.2
Fecha: 2026-10-23 · Fuente de verdad: el código · v0.2 incorpora las decisiones D-1 a D-5. No se implementa nada en esta fase.
1. Alcance y reglas
Alcance. Estructuras que alimentan los prompts de Decision (Eos) y Qwen: task.memory.{log,facts,effects,fail}, context.dataObs, context.lastHandoff, context.lastCall*, task.scratchpad, RefStore, executedSignatures, nonReadCounter. Solo src/. No se toca ui/ ni lab/. La traza (jarvis-traces.jsonl, AUDITORIA_TRAZA.md) es otra tarea y queda fuera.
Reglas. Sin tests; solo npm run lint (tsc --noEmit). Sin funcionalidades nuevas. Sin suposiciones. Búsqueda global antes de modificar o borrar. Soluciones simples y definitivas.
Nota sobre tsconfig.json. No define include ni strict. tsc recorre todo el proyecto, incluidos ui/ y lab/: un cambio de firma o de tipo en src puede romper su compilación aunque no los editemos. Con strict apagado, el lint detecta menos errores de nulos.
2. Qué se verificó y qué no
Leídos: callExecutor.ts, modeEngines.ts, resultProcessor.ts, prompts.ts, core.ts, types.ts, context.ts, decision.ts, debugAccumulator.ts (src y ui), persistence.ts, taskTrace.ts, refResolver.ts, manifest.ts, qwen.ts, server.ts, package.json, tsconfig.json, CORE_FLOW.md, CONTEXT_AND_MEMORY.md, AUDITORIA_TRAZA.md y la auditoría derivada.
No leídos: config.ts, llmTransport.ts, policy/guard.ts, mcp/* y el resto de src/core que no figura arriba. Verificación global (aportada por el usuario): no hay coincidencias de RefStore, ResultProcessor, sanitizeForMemory, selected_result, persistence ni TaskStore en ui/, lab/ ni src/server/. Scratchpad no figuraba en esa lista (ver H-08). Entorno: Qwen corre en Ollama 0.32.14 (dato del usuario). Red de seguridad adicional: tsc compila todo el proyecto y falla ante un import inexistente, un tipo roto o una llamada con argumentos de menos.
3. Veredicto sobre la auditoría anterior
Afirmación de la auditoría
Resultado contra el código
Líneas citadas (callExecutor 458-460 y 485; context 100/110/118/248; resultProcessor 62 y 103-115; manifest 40; prompts 53 y 220-241; types 203)
Coinciden.
Fichas INC-001…014
Vacías en el documento; se rehacen en la sección 4. Las secciones 2.1/2.2 y las matrices 7.6 faltaban: se completan en las secciones 5 y 6.
INC-001 (RefStore)
Confirmado. El único llamador de put y process es callExecutor.ts:374, que pasa task.id; server.ts y, según el usuario, ui/, lab/ y src/server/ no lo usan.
INC-005 (orden de prompt)
Descripción inexacta (H-06). Cerrado por D-4: no se modifica.
INC-006 (saneamiento)
Reducible a una sola vía real y a una línea de código (H-03). No hace falta helper nuevo.
INC-007 (hechos sin veredicto)
Confirmado: el código (callExecutor.ts:485) y CORE_FLOW.md:24 coinciden. El desfase está en CONTEXT_AND_MEMORY.md:9, que omite el caso sin veredicto y las mutaciones (H-11).
INC-008 (persistence.ts)
Sin imports en src ni en server.ts, y sin coincidencias en ui/, lab/ y src/server/ (verificación del usuario). El comentario de persistence.ts sobre flushPersistence() está obsoleto.
INC-009 (campos huérfanos)
selected_result confirmado (1 ocurrencia, 0 en ui/, lab/, src/server/). text sin escritor ni lector en lo leído; falta la búsqueda de Scratchpad.text (C-01). rawInput/rawOutput deben conservarse.
INC-013 (constantes)
Confirmado, con matiz (H-09).
INC-014 (handoff)
Incompleto: omitía el caso sin veredicto. Decidido en D-1 (H-02).
Punto abierto 9.1 (efectos)
Divergencia real. Decidida en D-2 y D-6 (H-01).
9.3 «el handoff se concatena a step.instruction»
Falso. applyStepHandoff devuelve un string nuevo; no muta el paso.
9.4 «task.scratchpad alimenta a Decision #2»
Falso. Decision #2 recibe memoria, no scratchpad (H-05).
9.6 «¿basta sanitizeForMemory(url, 400)?»
Sí (H-03).
9.7 «ciclos al mover constantes a types.ts»
Sin riesgo: types.ts no importa nada.
Referencias cruzadas
Rotas: «sección 9.1» debía ser 8.1; «Bloque D → 8.3» debía ser 8.4.
4. Hallazgos verificados
Orden por impacto. Cada ficha: dónde, qué ocurre, por qué, alcance, propuesta, riesgo.
H-01 — Los efectos no llegan «intactos» al replan (nuevo, prioridad alta; D-2 decidida)
• Dónde. context.ts:106-112 (tope 25), context.ts:203-206 (buildEffectsContext, 5 por defecto); consumidores: callExecutor.ts:224 (argumentos, 5), :441 (verificación semántica, 5), modeEngines.ts:331 (replan, 10), modeEngines.ts:158 (respuesta final, todos). Presupuesto real: prompts.ts:38 (MAX_EFFECTS_CHARS = 1200) aplicado por linesBlock/tailLines (prompts.ts:93-113) en :233, :257, :315, :352.
• Qué ocurre. Cada efecto ocupa una línea paso|herramienta: hallazgo (callExecutor.ts:532, hallazgo ≤120 caracteres). Con 1200 caracteres caben entre 8 y 15 entradas (estimación según longitud). tailLines descarta en silencio las más antiguas. Los números 25 y 10 no son el límite efectivo; lo es el presupuesto en caracteres.
• Por qué importa. CORE_FLOW.md §3 dice que las mutaciones consolidadas se transmiten intactas al replan para no duplicar acciones destructivas, y el prompt de replan (prompts.ts:301) pide no repetirlas. Con más mutaciones que las que caben, el replan no ve las más antiguas.
• Decisiones D-2 y D-6 (confirmadas). Quitar el límite de 1200 caracteres en el replan y el tope de 25 entradas almacenadas: el replan recibe todos los efectos registrados. La cota máxima se decide después (D-8).
• Cambios (C-07 y C-08). (1) context.ts:106-112: addEffectEntry deja solo el push. (2) modeEngines.ts:331: effects: task.memory?.effects || [], igual que la respuesta final en :158; el import buildEffectsContext de modeEngines.ts:26 deja de usarse y se retira (callExecutor.ts y context.ts siguen usándolo). (3) prompts.ts:315: linesBlock("EFFECTS", data.effects, NO_LIMIT) con NO_LIMIT = Number.POSITIVE_INFINITY (ver C-08). Argumentos, verificación semántica y respuesta final conservan su presupuesto actual.
• Efecto. La lista crece una línea (unos 150 caracteres) por mutación; el costo en memoria es despreciable. debugAccumulator.ts la copia solo en el evento FINAL_RESPONSE.
• Riesgo. Sin cota, el prompt del replan puede no caber en el contexto de Qwen: ver H-13.
H-02 — lastHandoff: se invalida ante fallo o sin veredicto (INC-014; D-1 decidida)
• Dónde. Se escribe solo en callExecutor.ts:536-548 (si isStepSuccess). Se lee en context.ts:212-220 → callExecutor.ts:236 (taskInstruction) → línea TASK: de prompts.ts:239. Solo llega al prompt de argumentos de Qwen; Decision #2 y Eos usan step.instruction sin handoff.
• Qué ocurre hoy. Nunca se borra: tras un fallo sigue vigente el handoff del último paso exitoso; tras un paso sin veredicto los hechos se guardan (:485, decisión P5) pero el handoff queda desactualizado. Su finding es el mismo texto que la línea de LOG (:499).
• Decisión D-1 (confirmada). Descartar el handoff cuando el paso anterior falle o termine sin veredicto: el siguiente paso no lo recibe.
• Cambios (C-06). El fallo ocurre en dos tramos. Tras ejecutar la herramienta: en callExecutor.ts:536-548 añadir else { context.lastHandoff = undefined; } al if (isStepSuccess); cubre el fallo con veredicto negativo y noVerdict. Antes de ejecutarla: argumentos inválidos (:247), referencias sin resolver (:272), anti-loop (:292), Guard DENY (:306), rechazo del usuario (:335) y excepciones (recordStepCrash, modeEngines.ts:385) pasan por recordFailedCall (callExecutor.ts:103-129) y salen antes de :536. En recordFailedCall, context.lastHandoff = undefined; debe ser la primera instrucción: la línea 113 tiene un return temprano (if (!tool) return;) que lo saltaría. Así el handoff solo sobrevive si el último paso fue exitoso. step.handoff (dato del paso, para la UI) no se toca.
• Efecto. Tras un paso sin veredicto, los datos siguen en FACTS, LOG y LAST; solo se pierde el resumen de la línea TASK.
• Riesgo. Bajo: cambia solo la línea TASK: del prompt de argumentos. callExecutor.ts también lo toca A.8 de la traza; memoria y contexto va primero.
H-03 — Saneamiento: una sola vía sin proteger, una línea de código (INC-006 / A.3)
• Dónde. context.ts:218 (factNote): handoff.primaryFact.value se interpola sin sanear. prompts.ts:239 solo neutraliza <obs> con safe.
• Qué ocurre. primaryFact es la primera clave de factsDelta (callExecutor.ts:537): normalmente url (resultProcessor.ts:394, :415), path (:277) o pid (:301); cand (:400) solo si el primer resultado de búsqueda no tiene URL. Una URL externa puede contener saltos de línea (resultProcessor.ts:356: <([^>]+)> admite \n; en JSON, r.url es arbitrario) y quedaría dentro de la línea TASK:, que es la zona de instrucciones, fuera de <obs>.
• Lo que la auditoría anterior no vio. FACTS ya va dentro de <obs> y se recorta a 400 (prompts.ts:117). Sanear en origen (factsDelta) no aporta, y truncar a 400 es equivalente a lo que el prompt ya hace. El helper sanitizeExternalUrl no es necesario.
• Propuesta. En context.ts:218, sanitizeForMemory(handoff.primaryFact.value, 400) y añadir sanitizeForMemory al import ya existente de resultProcessor.ts (context.ts:17). Sin helper nuevo, sin tocar resultProcessor.ts.
• Riesgo. Mínimo. El regex de etiquetas (\b(GOAL|…|DATA):) solo afectaría a valores tipo data:; no a URL http ni a rutas.
• Cumple el criterio «solo si no suma complejidad».
H-04 — La respuesta del usuario se trunca a 250 caracteres (nuevo; D-3 decidida)
• Dónde. core.ts:312 (answer_<paso> a 400, incluyendo la pregunta) y core.ts:321 (instrucción del paso: pregunta a 100 y respuesta a 250).
• Qué ocurre hoy. sanitizeForMemory corta con «...» y reescribe etiquetas tipo TASK:. Es un saneador pensado para texto externo, aplicado a texto del propio usuario. step.instruction se muta (:321), así que la versión truncada llega a Decision #2, Eos y Qwen. La respuesta completa queda solo en task.userAnswers.
• Decisiones D-3 y D-7 (confirmadas). Conservar la respuesta completa: sin el truncamiento de 250 caracteres y sin el recorte de TASK a 1500. La cota máxima se decide después (D-8).
• Cambios (C-09 y C-10). (1) core.ts:312: sanitizeForMemory(..., Number.POSITIVE_INFINITY) en el fact. (2) core.ts:321: la respuesta pasa a Number.POSITIVE_INFINITY; la pregunta se mantiene en 100. sanitizeForMemory no se modifica: con maxLen infinito no corta y conserva el aplanado a una línea. (3) prompts.ts:239: TASK: ${safe(data.taskInstruction)}, sin clip.
• Consecuencias aceptadas (verificadas). En modo FAST la instrucción del paso es el mensaje completo y el bloque GOAL se omite si TASK empieza igual (prompts.ts:227): quitar el recorte de TASK también deja sin tope a un mensaje largo del usuario. Siguen vigentes estos recortes, que D-7 no pide levantar: la etapa ejecutada a 1500 en la verificación semántica (prompts.ts:345), la instrucción a 1000 en Decision #2 y en la verificación de Eos (:486, :509; recorta por el final, donde va la respuesta) y el valor de cada fact a 400 en FACTS (:117). Decision #2 recibe el fact sin recorte por valor, y su bloque Context (2000) se recorta por el final.
• Riesgo. Respuestas muy largas pueden acercar el prompt de argumentos al límite de contexto: ver H-13.
H-05 — Decision #2 recibe memoria; task.scratchpad solo lo lee la UI (nuevo)
• Dónde. context.ts:138-144 (buildScratchpadContextForDecision) arma FACTS | LOG (2) | FAIL (2) desde task.memory; callExecutor.ts:183 → decision.ts:152,176 → prompts.ts:484. task.scratchpad se escribe en callExecutor.ts:387 y solo se lee en debugAccumulator.ts:14-17,105.
• Qué ocurre. (a) El nombre de la función no corresponde a su contenido. (b) La auditoría de UI muestra variablesScratchpad como entrada de DECISION_TWO (debugAccumulator.ts:105) aunque Decision #2 no la recibe. (c) FACTS entra sin recorte por valor y el bloque se recorta por el final (clipTail, 2000): si es largo se pierde el comienzo (incluida la etiqueta FACTS). (c) es una observación a verificar con un caso real, no un fallo probado.
• Propuesta. Documentar la separación real: scratchpad = estado visible para la UI; lastCall*/dataObs/memory = contexto de prompts. El punto (b) comparte archivo con la tarea de la traza.
H-06 — Orden de bloques del prompt de argumentos (INC-005 / A.5; cerrado por D-4)
• Dónde. prompts.ts:220-241. Orden real: ENV, TOOL, SCHEMA, GOAL, CHAT, LOG, PLAN, FAIL, FACTS, EFFECTS, REFS, DATA, LAST, TASK.
• Corrección a la auditoría anterior. No es cierto que PLAN y DATA estén antes de FACTS/LOG/FAIL: DATA va después de FACTS y PLAN entre LOG y FAIL. Además LOG, FACTS y FAIL no son bloques estables: cambian casi cada paso. Solo el prefijo SYSTEM + ENV se comparte entre llamadas; TOOL y SCHEMA cambian con la herramienta y cortan el prefijo igual.
• Decisión D-4. No modificar el orden. Cerrado.
• Documentación. CONTEXT_AND_MEMORY.md §2 describe un orden «estricto» (directivas estables, histórico, dinámico) que no es el real y promete una optimización de caché que el código no garantiza. Se ajusta la descripción (H-11). El servidor de Qwen es Ollama 0.32.14; no se usó para decidir nada aquí.
H-07 — Aislamiento de RefStore (INC-001 / A.2)
• Dónde. resultProcessor.ts:42 (put, default "default"), :70-79 (get, bucle que recorre todas las tareas), :179-185 (process, taskId? opcional).
• Alcance. Todos los llamadores pasan task.id: resultProcessor.ts:254, callExecutor.ts:374, refResolver.ts:60, context.ts:249, core.ts:372. El bucle de get y el default son defensa en profundidad inactiva. Una tarea sin taskId dejaría refs en el almacén default, que nadie libera. Esto además contradice el invariante de aislamiento de CONTEXT_AND_MEMORY.md (§5 y §6.2).
• Propuesta (C-02). taskId: string obligatorio en put, get y process; eliminar el bucle de get. refResolver.ts no necesita cambios.
• Riesgo. Bajo y verificado: no hay coincidencias en ui/, lab/ ni src/server/ (confirmado por el usuario), server.ts no usa RefStore ni ResultProcessor, y tsc falla ante cualquier llamada sin taskId.
H-08 — Campos huérfanos en types.ts (INC-009)
• Dónde. types.ts:203 (Scratchpad.selected_result) y :207 (Scratchpad.text).
• Evidencia. selected_result: 1 ocurrencia y 0 en ui/, lab/ y src/server/ (confirmado por el usuario). text: sin escritor (el delta solo asigna path, process_id, url, search_results y search_results_total) y sin lector en lo leído. Scratchpad no estaba en la lista de búsquedas confirmadas: antes de borrar text, ejecutar grep -rniE 'scratchpad.{0,3}text' src ui lab server.ts (debe dar 0). tsc cubre los accesos tipados.
• No eliminar: Step.rawInput/rawOutput y StepCall.rawInput/rawOutput. Ningún archivo de src los escribe, pero la UI los lee y los reconstruye (ui/utils/debugAccumulator.ts:73-74,102-103,119-120,141-142,164-165,325-350).
• Observado, fuera de esta propuesta: Step.candidate_tools (types.ts:134) solo se lee en debugAccumulator.ts:104 y nadie lo escribe (pertenece a la tarea de la traza); Step.dependencies (:135) no tiene ningún uso en lo leído.
H-09 — Constantes (INC-013 / A.1)
• Duplicación real: el tope de 80 caracteres de la descripción de herramientas existe dos veces, manifest.ts:40 (MAX_DESCRIPTION_CHARS) y prompts.ts:53 (MAX_TOOL_DESC_CHARS), y expresa lo mismo (manifest lo declara como el recorte de Decision). Ambos archivos ya importan de types.ts, que no importa nada (sin riesgo de ciclo).
• No es duplicación: los topes 30/25/5 de context.ts:100,110,118 aparecen una vez cada uno. Moverlos a types.ts es ordenamiento, no corrección (el de 25 desaparece con D-6).
• describe: el único llamador (context.ts:249) pasa siempre el límite, así que el default 5 de resultProcessor.ts:62 nunca se usa; cambiarlo a 8 no altera comportamiento.
• Decisión D-5: solución mínima. Unificar solo la constante de 80 (definida en types.ts e importada por manifest.ts y prompts.ts) y dejar el resto como está.
H-10 — persistence.ts sin referencias (INC-008 / A.9)
• Evidencia. Sin imports de persistence, TaskStore ni flushPersistence en los archivos de src leídos ni en server.ts, cuyo cleanShutdown solo cierra los servidores MCP y sale con process.exit(0). Sin coincidencias de persistence ni TaskStore en ui/, lab/ y src/server/ (confirmado por el usuario). El comentario de installExitHooks en persistence.ts, que dice que server.ts llama a flushPersistence(), está obsoleto.
• Propuesta (C-05). Eliminar persistence.ts. Es limpieza, no corrección de contexto ni memoria. Precondición: una búsqueda global del repositorio (sin node_modules) de persistence y TaskStore solo debe devolver el propio archivo y documentación; tsc falla si queda algún import.
H-11 — Documentación (Bloque B)
• CORE_FLOW.md §3: ajustar «se transmiten intactas» según D-2 (H-01).
• CORE_FLOW.md: añadir que pruneTasks cancela la tarea en espera más antigua al superar MAX_RETAINED_TASKS (core.ts:347-365) y que evictTerminalTasks libera sus refs (core.ts:367-375). No está documentado.
• CORE_FLOW.md §1 (paso 3) y §2 (paso 1): en modo deliberativo, Decision #1 se invoca una vez al inicio y, si responde fin, la tarea se completa sin plan (modeEngines.ts:563).
• CONTEXT_AND_MEMORY.md §1, «Hechos Confirmados» (línea 9): dice que los datos hipotéticos se descartan si el paso no aprueba la verificación; el código también los conserva cuando no hubo veredicto o hubo mutación (callExecutor.ts:485). CORE_FLOW.md:24 ya es correcto.
• CONTEXT_AND_MEMORY.md §1, «Mutaciones Consolidadas»: «permanente» solo se cumple con D-2 y el tope de 25 eliminado (D-6).
• CONTEXT_AND_MEMORY.md §1, «Enlace Determinista» (línea 13): ajustar a D-1 (se actualiza tras un paso exitoso y se descarta tras uno fallido o sin veredicto).
• CONTEXT_AND_MEMORY.md §1, «Estado Transitorio»: aclarar que task.scratchpad es estado visible solo para la UI y que Decision #2 recibe memoria (H-05).
• CONTEXT_AND_MEMORY.md §2: el orden descrito no es el real (H-06). Además la «barrera de sanitización» descrita excede la realidad: hay dos mecanismos, sanitizeForMemory (una línea: hallazgos, etiquetas, respuestas) y dataBlock/safe (neutraliza solo <obs> en bloques multilínea); las observaciones compactas no se aplanan, y el handoff era la excepción (H-03).
• CONTEXT_AND_MEMORY.md §3, «Acotación de observaciones»: el procesador no limita en caracteres la observación de read_file (hasta 30 líneas) ni la de list_directory (resultProcessor.ts:263-286); el tope efectivo es el de los prompts (2500).
• CONTEXT_AND_MEMORY.md §5 y §6.2 (aislamiento en resolución): el código aún tiene el bucle de RefStore.get sin taskId (H-07); se cumple tras A.2.
• CONTEXT_AND_MEMORY.md §4: coherente con el código (no hay restauración de estado); falta mencionar la cancelación de tareas en espera.
H-12 — Bloque CHAT definido pero nunca alimentado (nuevo)
• Dónde. El bloque existe en prompts.ts (chatContext, líneas 162, 228, 282 y 289). Ningún llamador lo alimenta: callExecutor.ts:218-237 no pasa chatContext; core.ts:256-263 y modeEngines.ts:583 pasan undefined; qwen.ts:609-624 solo lo reenvía.
• Alcance. Código sin emisor en los archivos leídos (parámetros, MAX_CHAT_CHARS y la etiqueta CHAT del regex de sanitizeForMemory). No afecta al comportamiento actual.
• Propuesta. Sin acción en esta fase. Conservar o eliminar es una decisión de diseño que se toma cuando se defina si habrá contexto de chat.
H-13 — Guarda de contexto de Qwen (relevante para D-2 y D-3)
• Dónde. qwen.ts:428-439: estima los tokens del prompt contra config.qwenNumCtx y lanza LLMValidationError si no quedan 256 tokens de salida. La petición no envía el tamaño de contexto (qwen.ts:441-451).
• Qué ocurre. Con D-2 y D-3 sin cota, esta guarda pasa a ser la única protección. Si falla: en argumentos, el paso termina con error lógico; en la verificación semántica, el resultado es recoverable_deviation (qwen.ts:730-737); en el replan, modeEngines.ts:337-339 lo trata como error y cierra la tarea.
• A verificar. Que qwenNumCtx coincida con el contexto con que Ollama 0.32.14 carga el modelo, porque el código no lo envía ni lo consulta.
• Propuesta. Ninguna ahora: la cota máxima de contexto queda para tu decisión posterior.
5. Matriz de contexto por llamada (verificada en código)
Cotas en caracteres salvo indicación. Estado actual del código, antes de aplicar D-1 a D-3. qwen.ts solo reenvía los datos a prompts.ts y no añade bloques.
Llamada
Qué recibe
Fuente
Observaciones
Decision #1 (Eos)
Mensaje (1000); historial (4000, últimas 2/5/10 líneas de LOG y hasta 5 de FAIL); últimas 8 acciones; último resultado (400)
memory.log/fail, steps[].calls, lastCallDecisionSummary o lastCallCompactObs
En PLAN solo se llama al inicio (sin historial). El tramo 2→5→10 solo crece en escalaciones FAST (modeEngines.ts:236).
Decision #2 (Eos)
Instrucción del paso (1000, sin handoff); últimas 8 acciones del MCP; Context (2000): FACTS, 2 últimas líneas de LOG, 2 de FAIL
step.instruction, memory
Ver H-05. Con una sola herramienta no se llama al modelo.
Verificación Eos
Instrucción (1000), criterio esperado (1000), herramienta, resultado (400), evidencia (400), observación (500, saneada)
processed.*, step.expectedOutcome
No recibe facts, log ni efectos. Dos preguntas noul.
ARGUMENTS (Qwen)
ENV 800; TOOL; SCHEMA; GOAL 1500 (se omite si la instrucción empieza igual); LOG 2500; PLAN 1500 (solo PLAN); FAIL 1200; FACTS 2500 (400 por valor); EFFECTS 1200 (últimos 5); REFS 1200 (últimas 8); DATA 6000 (hasta 3 lecturas); LAST 2500; TASK 1500 (instrucción + handoff)
memory, dataObs, lastCall*, RefStore, lastHandoff
CHAT está definido pero ningún llamador lo alimenta (H-12).
STAGE_VERIFICATION (Qwen, solo PLAN)
Objetivo, etapa y criterio (1500 c/u); acción ejecutada (1200, se conserva el final); evidencia y observación (2500 c/u); FACTS, LOG, EFFECTS (últimos 5), FAIL
callExecutor.ts:432-443
Solo si Eos no aprueba con señales limpias.
PLAN (Qwen)
Catálogo, plan previo y modificación, objetivo (1500)
manifest.ts, core.ts:256
No usa memoria. chatContext siempre llega undefined (H-12).
REPLAN (Qwen)
Objetivo; completados (1500); FACTS; LOG; EFFECTS (últimos 10, 1200); FAIL; paso fallido y su error (800); plan restante (1500)
modeEngines.ts:324-336
Ver H-01 (D-2).
FINAL_RESPONSE (Qwen)
Objetivo; LOG; FACTS; EFFECTS (todos, 1200); FAIL; EVID (6000); motivo de detención
modeEngines.ts:153-161
EVID = hasta 3 lecturas + últimas 3 mutaciones, cada una a 2500; el bloque se recorta por el principio, así que si excede 6000 se pierden primero las lecturas.
6. Matriz de escritura de memoria (verificada en código)
Estructura
Quién escribe
Condición
Cota
Quién lee
memory.log
callExecutor.ts:499
Toda llamada que llega a procesarse
30 entradas
Argumentos, verificación semántica, replan, final, Decision #1 y #2
memory.facts
callExecutor.ts:485-486; core.ts:312
isStepSuccess, noVerdict o mutación; respuesta del usuario
Sin tope de claves; 400 por valor en prompts
Argumentos, verificación, replan, final, Decision #2
memory.effects
callExecutor.ts:531-533
Señales limpias y herramienta que muta
25 entradas (D-6: sin tope); 1200 caracteres en prompts salvo en el replan (D-2)
Ver H-01
memory.fail
addFailEntry (varios puntos de callExecutor.ts y modeEngines.ts)
Fallos de paso, anti-loop, Guard, rechazos
5 entradas
Argumentos, verificación, replan, final, Decision #1 y #2
context.dataObs
callExecutor.ts:382-384
Lectura exitosa, con datos, sin vacío ni not_found
3 lecturas
Argumentos (DATA), final (EVID)
context.lastHandoff
callExecutor.ts:547
isStepSuccess
1; nunca se borra (D-1: se descarta ante fallo o sin veredicto)
Línea TASK: de argumentos
context.lastCall*
callExecutor.ts:375-378; recordFailedCall (:112) solo el resumen
Tras procesar; tras fallo previo a la ejecución
1
LAST (argumentos), lastResult (Decision #1)
task.scratchpad
callExecutor.ts:387
Siempre (delta del procesador)
search_results ≤10
Solo UI (debugAccumulator.ts)
RefStore
resultProcessor.ts:254
Texto de resultado no vacío
Sin tope por contenido; se libera al expulsar la tarea (core.ts:372)
refResolver.ts:60, context.ts:249
executedSignatures
callExecutor.ts:350; se borra en :360
Justo antes del despacho
Sin tope; invalidado por nonReadCounter
Anti-loop (:286)
nonReadCounter
callExecutor.ts:504; core.ts:325
Acción no lectora exitosa o sin verificar; respuesta del usuario
—
Firma anti-loop (:284)
Observación sin acción propuesta: RefStore guarda cada salida completa durante la vida de la tarea y hasta 20 tareas. No hay evidencia de problema; no se propone cota.
7. Plan de implementación propuesto
No se implementa nada en esta fase (D-5). Este es el orden propuesto para cuando se apruebe; cada cambio se valida solo con npm run lint. Memoria y contexto va antes que la traza: A.6 y A.8 de AUDITORIA_TRAZA.md tocan callExecutor.ts, types.ts y debugAccumulator.ts.
1. Fase 0, solo documentación (sección 10): CORE_FLOW.md y CONTEXT_AND_MEMORY.md (H-11), incluida la separación scratchpad/contexto (H-05). Se actualiza junto con la Fase 2, porque algunos textos describen el comportamiento ya cambiado.
2. Fase 1, bajo riesgo, solo src/ (C-01 a C-05): H-08, H-07, H-03, H-09 mínima y H-10. Las verificaciones globales del usuario ya cubren ui/, lab/ y src/server/.
3. Fase 2, cambios de comportamiento decididos (C-06 a C-10): D-1 (C-06), D-6 y D-2 (C-07 y C-08, en ese orden) y D-3 y D-7 (C-09 y C-10).
Orden dentro de cada fase: un cambio por vez, con la búsqueda previa de la sección 9 y lint después. Sin acción: H-05 (solo documental), H-06 (D-4), H-12 y H-13.
8. Decisiones y estado
Id
Tema
Resultado
D-1
Handoff (H-02)
Decidido: descartarlo cuando el paso anterior falle o termine sin veredicto (C-06).
D-2
Efectos del replan (H-01)
Decidido: sin el límite de 1200 caracteres; se transmite todo lo disponible (C-08).
D-3
Respuesta del usuario (H-04)
Decidido: sin truncamiento de 250 caracteres (C-09).
D-4
Orden del prompt (H-06)
Decidido: sin cambios. Cerrado.
D-5
Alcance
Decidido: cerrar la auditoría y el plan sin implementar; solución mínima; ampliar el alcance solo con justificación técnica.
D-6
Tope de 25 efectos (H-01)
Decidido: eliminarlo; se conservan todos los efectos (C-07).
D-7
Recorte de TASK a 1500 (H-04)
Decidido: eliminarlo para conservar completa la respuesta del usuario (C-10).
D-8
Cota máxima de contexto (replan, TASK, efectos)
Pendiente, no bloquea. Se define después del refactor, con H-13 como punto de partida.
Estado: sin pendientes que bloqueen la implementación. Las verificaciones globales del usuario están recibidas. Quedan dos puntos no bloqueantes: D-8 y la búsqueda de Scratchpad.text, que forma parte de C-01.
9. Guía de implementación (especificación de cambios)
Uso. Un cambio por vez, en el orden indicado. Antes de cada uno, su búsqueda previa; después, npm run lint. No se ejecutan tests. Si una búsqueda previa da un resultado distinto del esperado, detenerse y consultar. Rutas relativas a src/core/ salvo indicación. C-07 y C-08 juntos cumplen D-6 y D-2; C-09 y C-10 juntos cumplen D-3 y D-7. C-06 va antes de A.8 de la traza (ambos tocan callExecutor.ts).
Fase 1
C-01 — Campos huérfanos de Scratchpad (H-08)
• Archivo: types.ts:203 y :207.
• Cambio: eliminar selected_result?: unknown; y text?: string; de Scratchpad.
• Búsqueda previa: grep -rniE 'selected_result' src ui lab server.ts solo debe dar types.ts:203; grep -rniE 'scratchpad.{0,3}text' src ui lab server.ts debe dar 0.
C-02 — RefStore aislado por tarea (H-07)
• Archivo: processor/resultProcessor.ts:42, :70-79 y :184.
• Cambio: put(content: string, taskId: string, label?: string); get(key: string, taskId: string) con el cuerpo return this.taskStores.get(taskId)?.get(key); (desaparecen el if y el bucle); process(..., taskId: string).
• Búsqueda previa: grep -rnE 'RefStore\.(put|get)|ResultProcessor\.process' src ui lab server.ts solo debe dar resultProcessor.ts:254, refResolver.ts:60 y callExecutor.ts:374.
• Verificación: lint compila sin tocar los llamadores.
C-03 — Handoff saneado (H-03)
• Archivo: context.ts:17 (import) y :218.
• Cambio: importar sanitizeForMemory junto a RefStore desde ./processor/resultProcessor.ts; en factNote, usar ${handoff.primaryFact.key}=${sanitizeForMemory(handoff.primaryFact.value, 400)}.
• Búsqueda previa: grep -rn 'primaryFact' src solo debe dar context.ts y callExecutor.ts.
C-04 — Constante de 80 caracteres (H-09)
• Archivos: types.ts (bloque «Límites globales»), tools/manifest.ts:39-40 y su uso en def(), reasoner/prompts.ts:53.
• Cambio: definir export const MAX_TOOL_DESC_CHARS = 80; en types.ts (con el comentario de manifest.ts); en manifest.ts eliminar MAX_DESCRIPTION_CHARS, importar MAX_TOOL_DESC_CHARS y usarlo en def(); en prompts.ts eliminar la constante local y añadirla al import de ../types.ts.
• Búsqueda previa: grep -rnE 'MAX_DESCRIPTION_CHARS|MAX_TOOL_DESC_CHARS' src ui lab server.ts solo debe dar manifest.ts y prompts.ts.
C-05 — Eliminar persistence.ts (H-10)
• Cambio: borrar el archivo (ubicarlo con git ls-files | grep persistence).
• Búsqueda previa: grep -rniE 'persistence|TaskStore' . --include=*.ts --include=*.tsx --include=*.json --exclude-dir=node_modules solo debe dar el propio archivo y, a lo sumo, comentarios o documentación.
• Verificación: lint falla si queda algún import.
Fase 2
C-06 — D-1: descartar el handoff (H-02)
• Archivo: callExecutor.ts:103-129 y :535-548.
• Cambio: (a) context.lastHandoff = undefined; como primera instrucción de recordFailedCall, antes del return de la línea 113; (b) añadir else { context.lastHandoff = undefined; } al if (isStepSuccess) y actualizar el comentario de la línea 535.
• Búsqueda previa: grep -rn 'lastHandoff' src solo debe dar context.ts (campo y applyStepHandoff) y callExecutor.ts:547.
• Nota: step.handoff no se toca.
C-07 — D-6: efectos sin tope (H-01)
• Archivo: context.ts:105-113.
• Cambio: addEffectEntry queda en ensureMemory, inicializar effects y push; se elimina el bloque if (memory.effects.length > 25) y el comentario deja de decir «hasta 25».
• Búsqueda previa: grep -rnE 'effects\.length|slice\(-25\)' src solo debe dar context.ts:110-111.
C-08 — D-2: replan sin límite de efectos (H-01)
• Archivos: modeEngines.ts:26 y :331; reasoner/prompts.ts (constantes y :315).
• Cambio: modeEngines.ts:331 pasa a effects: task.memory?.effects || [], y se retira buildEffectsContext del import de la línea 26. En prompts.ts, añadir const NO_LIMIT = Number.POSITIVE_INFINITY; junto a los presupuestos (comentario: sin tope, la cota máxima se define aparte, D-8) y usarlo en prompts.ts:315. Los usos de MAX_EFFECTS_CHARS en :233, :257 y :352 no cambian.
• Búsqueda previa: grep -rn 'buildEffectsContext' src solo debe dar callExecutor.ts:35,224,441, context.ts:203 y modeEngines.ts:26,331.
C-09 — D-3: respuesta del usuario completa (H-04)
• Archivo: core.ts:312 y :321.
• Cambio: en :312, sanitizeForMemory(${pending.question} -> ${clean}, Number.POSITIVE_INFINITY); en :321, la respuesta pasa a sanitizeForMemory(clean, Number.POSITIVE_INFINITY) y la pregunta se mantiene en sanitizeForMemory(pending.question, 100). sanitizeForMemory no se modifica.
• Búsqueda previa: grep -n 'sanitizeForMemory' core.ts solo debe dar las líneas 312 y 321.
C-10 — D-7: TASK sin recorte (H-04)
• Archivo: reasoner/prompts.ts:239.
• Cambio: TASK: ${safe(data.taskInstruction)}, sin clip. MAX_GOAL_CHARS se sigue usando en otros bloques: no se borra.
• Búsqueda previa: grep -n 'MAX_GOAL_CHARS' reasoner/prompts.ts debe seguir mostrando los demás usos.
Criterios de aceptación
• npm run lint sin errores tras cada cambio y al final.
• Todas las búsquedas previas dieron lo esperado.
• Solo se tocaron los archivos de esta guía; no se ejecutó ningún test.
• Los textos de la sección 10 se aplicaron en el mismo conjunto de cambios.
Qué no se cambia
• El orden de los bloques del prompt (D-4).
• Los recortes que D-7 no pide levantar: prompts.ts:117, :345, :486 y :509, y MAX_EFFECTS_CHARS en argumentos, verificación semántica y respuesta final.
• buildEffectsContext y su límite de 5 en callExecutor.ts:224 y :441.
• Step.rawInput/rawOutput, StepCall.rawInput/rawOutput, Step.candidate_tools y Step.dependencies.
• El valor por defecto de RefStore.describe y la constante limit = 8 de buildRefsContext.
• Todo lo de la traza (AUDITORIA_TRAZA.md): va después.
10. Documentación a actualizar (Fase 0): textos propuestos
CORE_FLOW.md
• §3, «Replanificación autónoma»: sustituir «las mutaciones físicas consolidadas en el entorno se transmiten intactas» por «el registro completo de mutaciones consolidadas se transmite sin recorte».
• §1 (paso 3) y §2 (paso 1): añadir «En modalidad deliberativa, antes de planificar, el clasificador evalúa una vez el objetivo; si lo declara conversación directa, la tarea se completa sin plan».
• §5: añadir «Cupo de tareas: al crear una tarea por encima del cupo se expulsan las terminales más antiguas y, si aún se supera, se cancela la tarea en espera más antigua».
CONTEXT_AND_MEMORY.md
• §1, «Hechos Confirmados» (línea 9): «Persiste durante toda la tarea. Se consolidan los hechos de un paso validado, de un paso sin veredicto o de una acción que mutó el entorno; los de un paso con veredicto negativo y sin mutación se descartan».
• §1, «Mutaciones Consolidadas»: «Permanente durante toda la tarea y sin tope de entradas; la replanificación las recibe todas».
• §1, «Enlace Determinista» (línea 13): «Se actualiza tras cada paso exitoso y se descarta tras un paso fallido o sin veredicto».
• §1, «Estado Transitorio»: añadir «Es estado visible para la interfaz; no se inyecta en los prompts, cuyo contexto sale de la memoria, las lecturas con datos y la última observación».
• §2, orden: «El prompt de argumentos se ensambla así: entorno, herramienta, esquema, objetivo (si difiere de la instrucción), contexto de chat (hoy sin uso), registro, ventana del plan, fallos, hechos, efectos, referencias, lecturas con datos, última observación e instrucción del paso». Retirar la promesa de optimización de caché.
• §2, sanitización: «Los hallazgos, etiquetas y valores de una línea pasan por sanitizeForMemory (aplanado, sin caracteres de control, con delimitadores y etiquetas neutralizados); los bloques multilínea de observaciones se envuelven en <obs> neutralizando solo esos delimitadores».
• §3, «Acotación de observaciones»: añadir «read_file (hasta 30 líneas) y list_directory no tienen tope de caracteres en el procesador; los prompts aplican el tope al insertarlas».
• §4: añadir «Si al crear una tarea se supera el cupo y no quedan terminales que expulsar, se cancela la tarea en espera más antigua».
• §5 y §6.2 (aislamiento en resolución): sin cambio de texto; pasan a cumplirse con C-02.