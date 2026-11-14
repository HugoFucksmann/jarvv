# Auditoría Técnica — Jarvis ROOT

**Fecha:** 2026-11-14
**Alcance:** Auditoría integral en modo solo lectura (Fase 1) previo a cualquier edición de código o documentación.
**Restricción:** No hay acceso a Ollama (`qwen3.5:4b`, `d3:2b`) ni a `powershell.exe` / Windows (`win32`) en este entorno (Linux x64, Node v22.23.2). No existe directorio `.git` ni carpeta `jarvis-traces/`.

---

## 1. Estado Base (Verificación Inicial)

| Comprobación | Comando | Resultado | Detalle |
|---|---|---|---|
| Control de versiones | `git status` | Sin repo `.git` | Se documentarán cambios agrupados por pendiente lógico. |
| Typecheck / Lint | `npm run lint` (`tsc --noEmit`) | ✅ Pasa (exit 0) | Sin errores de tipos. |
| Build frontend/prod | `npm run build` (`vite build`) | ✅ Pasa (exit 0) | `dist/index.html` y assets generados sin errores. |
| Dependencias circulares | `npx madge --circular --extensions ts src/` | ✅ Pasa (0 ciclos) | 142 archivos analizados en `src/`. |
| Eval smoke (dry-run mock) | `npm run eval:smoke` | ✅ Pasa (exit 0) | Carga los casos de `smoke.jsonl` y arma requests. |
| Suite de tests | `npm test` (`tsx --test --test-timeout=30000 tests/*.test.ts`) | ❌ Falla | 386 tests totales: **329 pass**, **5 fail**, **24 cancelled**, **28 skipped** (`win32`). |

### Fallos y cancelaciones observados en `npm test`
1. **`tests/tiers.test.ts` (2 fallos — líneas 10 y 17):** `approvalTierOf` usa `node:path` del SO anfitrión (POSIX en Linux). Con `env.platform = "windows"` y rutas `C:\Users\Ana\...`, `path.isAbsolute` e `isPathInside` (`policy/guard.ts:56-59`) no reconocen rutas Windows y devuelven `"yellow"` en vez de `"green"` / `"red"`.
2. **`tests/run_command.test.ts` (1 fallo — línea 180):** El test de paridad entre el manifiesto y `TerminalProvider` crea `new TerminalProvider({ defaultCwd: os.tmpdir() })` sin `platform: "win32"`. En Linux, `TerminalProvider.listTools()` devuelve `[]` y falla la aserción sobre `["run_command", "list_processes", "stop_process"]`.
3. **`tests/eval_arguments.test.ts` (2 fallos — líneas 106 y 107):** `correr()` ejecuta `precheckCall` completo (`analyzePowerShell`). En Linux sin `powershell.exe` (`ENOENT` → `null`, fail-open), los dos subtests de sintaxis PowerShell inválida y cmdlet inexistente aprueban por error en lugar de fallar.
4. **`tests/web_search.test.ts` (1 fallo en línea 746 + 24 subtests cancelados desde línea 768):** `WebSearchProvider.judgeSignal` (`src/tools/web/webSearchProvider.ts:224`) usa `AbortSignal.timeout(...)`, cuyo temporizador interno en Node v22 es `unref`. Cuando un juez simulado (`slow.score`) solo se resuelve escuchando `abort` sin ningún timer activo en el event loop, Node da por vacío el event loop antes del timeout y aborta con `ERR_TEST_FAILURE: Promise resolution is still pending but the event loop has already resolved`, cancelando los 24 tests restantes del archivo.

---

## 2. Verificación de Invariantes Arquitectónicas

| Invariante | Estado | Evidencia en código |
|---|---|---|
| **1. Toda herramienta ejecuta vía `runCall` detrás de `Guard`** | ✅ Cumplido | `callRunner.ts:359` evalúa `Guard.evaluate` antes de lista negra/precheck/despacho. `/api/mcp/:server/call` (`mcpRouter.ts`) bloquea herramientas mutantes por catálogo. Único desvío documentado: el proveedor interno `web_search` invoca `host.call` hacia `free_search` con `capability: READ` a través del `ToolHost` que entrega `callRunner`. |
| **2. Solo el motor escribe el contexto y solo mediante `apply`** | ✅ Cumplido | `ctx/` exporta `apply` como única mutación (`ctx/context.ts`, `ctx/apply.ts`). Los clientes de modelos (`models/qwen.ts`, `models/decision.ts`) solo devuelven objetos tipados y nunca reciben `ctx`. |
| **3. Sin prosa de modelos en el contexto; motivos cerrados** | ✅ Cumplido | `VerdictReason`, `CallStatus`, `StopReason` y `REASON_NOTES`/`STATUS_NOTES` son uniones cerradas con texto fijo (`src/core/ctx/types.ts`, `messages.ts`). En `pendingList.ts` los ítems son instrucciones operativas sanitizadas/deduplicadas por código, y las respuestas de `finalClean.ts` nunca reentran al contexto. |
| **4. Solo `runTask` decide el cierre; efectos visibles; terminal cerrado** | ✅ Cumplido | `ctx/apply.ts` valida la clausura terminal (`finish`). Las escrituras aprobadas quedan en `calls` (`kind: "write"`) y `forArgs`/`forPlan`/`forFinal` las derivan en `effects`/`possibleEffects` con reserva `effectsReserve` que falla en voz alta (`ContextOverflowError`) antes que ocultarlas. |
| **5. Topes de tamaño validados en `ctx`, nunca recortados allí** | ✅ Cumplido | `ctx/apply.ts` rechaza valores que exceden `BUDGET` (`summaryMax`, `factValueMax`, `feedbackMax`, `ARGS_MAX`, `jsonMaxDepth`). El recorte previo ocurre fuera de `ctx/` (`clipArgs`, `summaryText`, renderizadores en `src/core/render/`). |

Además, `tests/architecture.test.ts` y `madge --circular` confirman 0 dependencias circulares y separación estricta entre `core/`, `tools/`, `telegram/`, `voice/` y `server/`.

---

## 3. Discrepancias Código vs. Documentación

1. **`eval/core/runner.ts` (líneas 281-309) vs. `src/` (`DN-3.4`) e `eval/INSTRUCCIONES.md` §3:**
   - `src/` pasó todas las llamadas a Decisión (D0–D5, sondas, continuación) a `queryModel(..., 0)` (`FRENTE_3_DECISION.md` DN-3.4; verificado en `callRunner.ts`, `verify.ts`, `completion.ts`, `stepLoop.ts`, `classify.ts`, `probes.ts`).
   - Sin embargo, `eval/core/runner.ts` todavía reintenta respuestas inválidas de Decisión hasta `LLM_INVALID_OUTPUT_RETRIES` (1 vez), mientras `eval/INSTRUCCIONES.md` §3 afirma correctamente que las etapas de decisión no reintentan. Además, `src/core/budget.ts:78` todavía menciona `Decision (D4)` en el comentario de `invalidResponseRetries`.
2. **`desalineaciones-eval.md` desactualizado en ~20 de 30 puntos:**
   - Siguen figurando como abiertos aunque **ya fueron implementados/corregidos** en `eval/`: `D1`, `D2`, `D3`, `D4`, `D5`, `D7`, `D8`, `D9`, `D10`, `D11`, `D12`, `D13`, `D14`, `D15`, `D17`, `D18`, `D19`, `D20`, `D21`, `D22`, `D23`, `D24`, `D26`, `D27`, `D29`, `D30`.
   - Siguen **abiertos o invertidos**: `D6` (comentarios en `scenario.ts` e `INSTRUCCIONES.md` §8 sobre quién importa `src/`), `D16` (ahora invertido: `eval` reintenta y `src` no), `D25` (faltan detalles de `psvalid`, `gen/` y comandos de `eval:cross` en `INSTRUCCIONES.md` §8), y verificar `D28` en el resto de `eval/core/config.ts`.
3. **Enlaces rotos en documentación de web search:**
   - `docs/web_search/README.md` enlaza archivos inexistentes (`REVISION_hallazgos.md`, `free-search-mcp-guia.md`, `../REVISION_web_search.md`).
   - `scripts/validate/README.md:3` enlaza el archivo inexistente `docs/REVISION_web_search.md`.
4. **Conteo de etapas inconsistente en docs del eval:**
   - `eval/README.md:5,14` habla de «diez etapas» («cinco de decisión y cinco generativas»), pero `eval/core/types.ts:17-18` y la tabla de `eval/INSTRUCCIONES.md:31-41` tienen **11 etapas** (6 de decisión con `d0` + `fragment_judge`, y 5 generativas). `eval/INSTRUCCIONES.md:137` también dice «diez etapas».
5. **`docs/ARCHITECTURE.md` (líneas 24 y 61) y flujo de decisiones:**
   - Sigue describiendo al modelo de decisión como «Cuatro decisiones», cuando hoy ejecuta D0 (`firstQuery`), continuación (`continuation`), D1 (`chooseRoute`), D2 (`chooseTool`), D3 (`reviewArgs`), D4 (`verifyResult`), D5 (`checkCompletion`), sondas (`probe`) y el juez de fragmentos (`score`).
6. **`docs/JARVIS_API.md` (líneas 31 y 62):**
   - Falta `maxProcessPromptsPerStep` en la lista de `/limits` (sí lo expone `engine/limits.ts` y `GET /limits`).
   - En `facts`, solo documenta `answer_<stepId>_<n>` y omite `answer_<stepId>_<n>_p<pid>` emitido al responder a procesos de `run_command`.
   - No documenta la sección opcional `memory` / `approvalTiers` en `/config` si aplica.
7. **`docs/PENDIENTES_FUERA_DE_FLUJO.md` desactualizado (fecha `2026-11-10`):**
   - Aún dice que falta `approvalTiers` por niveles, que `precheck.ts` no revisa destino de escrituras, que `research.ts` es un extractor activo cuando `research.ts` ya no existe y `web_search` tiene `timeoutMs: 150_000` propio en `manifest.ts:238` (y dice que no hay timeout por herramienta).
8. **`readme.md` y comentarios en `src/` con nombres heredados:**
   - Referencias a `start_process` (reemplazada por `run_command`) en `guard.ts:8,18`, `callRunner.ts:346` y `readme.md:64,178,190,235`.
   - `readme.md` lista la estructura previa a varios módulos recientes (`D0`, `probes.ts`, `memory.ts`, `tiers.ts`, `webSearchProvider.ts`).
9. **`docs/REVISION_run_command.md` vs `src/tools/terminal/Revisión de la tool run_command (Jarvis).md`:**
   - Existen dos copias distintas del documento de revisión de `run_command` que divergen entre sí.
10. **`docs/inputSchemaManifest.md` y `src/core/tools/manifest.ts:243`:**
   - `manifest.ts:243` conserva `internalDef("free_search", "web", "research", ...)` aunque `WebSearchProvider` (`WEB_DEPENDENCIES`) ya solo declara `search`, `fetch` y `read_doc` (y `tests/web_search.test.ts:516` verifica explícitamente que `free_search:research` sea rechazado). Sin embargo, `eval/datasets/*`, `tests/repeat.test.ts` y `scripts/validate/web_eval/*` aún referencian la herramienta `"research"` como fixture de dataset/test. `inputSchemaManifest.md` está desactualizado respecto a `SYSTEM_TOOL_MANIFEST` y requiere los servidores MCP vivos para regenerarse (`scripts/dumpManifestInputSchemas.ts`).

---

## 4. Deuda Técnica, Código Muerto y Brechas de Tests

1. **`DecisionValidationError` sin crudo de entrada/salida (`src/core/models/transport.ts:74-81`, `decision.ts`, `capture.ts:48`):**
   - A diferencia de `LLMValidationError`, `DecisionValidationError` no acepta ni adjunta `raw: { rawInput, rawOutput, timing }`. Cuando Decisión devuelve JSON malformado o una opción inválida, `capture.ts:48` registra `input: null, output: null` en la traza (`PENDIENTES_FUERA_DE_FLUJO.md:77`).
2. **`validateAnswer` sin `switch` exhaustivo (`src/core/models/decision.ts:392-413`):**
   - Todo `question.type` distinto de `"choice"` cae directamente a validar `ans.noul`, en lugar de hacer `switch (question.type)` explícito (`PENDIENTES_FUERA_DE_FLUJO.md:75`).
3. **Código muerto en `ReviewView` / `ReviewDecisionInput` (`FRENTE_2_CONTEXTO.md` F9, `PENDIENTES_FUERA_DE_FLUJO.md:72`, `prompts.ts:521-526`):**
   - `buildReviewView`, `reviewInput` y `ReviewDecisionInput` siguen calculando y transportando `stepsDone`, `done`, `lastReads`, `env`, `candidate.description` y `candidate.schema`, pero `buildArgsReview` en producción solo usa `step.instruction`, `userInput`, `stepFailures`, `candidate.route`, `candidate.tool`, `candidate.args`. *(Nota: variantes experimentales históricas como `eval/variants/args_review_D3/args_review_compact_{reads,desc,schema}.ts` y `tests/render.golden.test.ts` aún consumen o prueban esos campos.)*
4. **`scenario.ts` vs producción en claves de `userInput` (`PENDIENTES_FUERA_DE_FLUJO.md:89`):**
   - `eval/core/scenario.ts:251` escribe `facts.answer_${i + 1}`, mientras producción emite `answer_<stepId>_<n>` (`runStep` / `ask.ts`).
5. **Comparación de rutas Windows en Linux (`tiers.ts`, `guard.ts:56-59,142`, `postcondition.ts:29-56`):**
   - `isPathInside`, `absolute` (`tiers.ts`) y `absolutePath` (`postcondition.ts`) dependen del `node:path` del SO anfitrión en lugar de seleccionar `path.win32` cuando la ruta o el entorno son Windows.
6. **Temporizadores con `AbortSignal.timeout` en Node 22:**
   - `src/tools/web/webSearchProvider.ts:224` (rompe `tests/web_search.test.ts`), `src/core/models/transport.ts:115`, `src/core/models/warmup.ts:26` y `eval/core/client/generative.ts:55`. En `transport.ts` y `warmup.ts` no ha fallado ningún test actual solo porque sus mocks actuales no cuelgan sin timers, pero comparten el mismo riesgo con Node 22 si una promesa solo depende del evento `abort`.
7. **Brecha de tests:**
   - Sin tests automatizados que verifiquen `DecisionValidationError` con `raw` capturado en `captureDecision`, ni `validateAnswer` con tipos desconocidos, ni `tiers.ts`/`postcondition.ts` ejecutando rutas Windows bajo Linux.
   - Sin tests de adaptadores MCP reales contra procesos reales (`desktop_commander`, `free_search`) ni parser real de PowerShell en Linux (limitación de plataforma).

---

## 5. Catálogo Completo de Pendientes Clasificados

Criterio de clasificación:
- **A**: Lógica determinista, local y verificable con tests/lectura de código.
- **B**: Varias soluciones razonables; se elige la más conservadora y coherente con la arquitectura (justificación en 1 línea).
- **V**: Su efecto real depende del comportamiento de un modelo; se implementa solo si su parte determinista es sólida y verificable, quedando marcada para validación en el laboratorio del usuario. No se modifican umbrales ni prompts «a ojo».
- **C**: Bloqueado por decisión de producto, credenciales, hardware, acceso externo, falta de servicio vivo o contradicción con un invariante.

### 5.1 Bugs de suite / ejecución determinista (prioridad máxima)

| ID | Origen | Descripción | Clase | Plan / Justificación |
|---|---|---|---|---|
| P-01 | `npm test` (`web_search.test.ts:746`) | `WebSearchProvider.judgeSignal` usa `AbortSignal.timeout` (`unref` en Node 22) y cancela 25 tests cuando un mock espera `abort`. | **A** | Reemplazar por `setTimeout` ref + `AbortController` + limpieza `clearTimeout` en `finally` alrededor de `judge.score`. |
| P-02 | `npm test` (`tiers.test.ts:10,17`) | `tiers.ts` / `guard.ts` (`isPathInside`) / `postcondition.ts` usan `node:path` POSIX sobre rutas Windows. | **A** | Usar `path.win32` cuando la ruta es Windows (`C:\...` o `\\...`) o `env.platform === "windows"`. |
| P-03 | `npm test` (`run_command.test.ts:180`) | Test de paridad manifest vs `TerminalProvider` falla en Linux al no pasar `platform: "win32"`. | **A** | Instanciar un `TerminalProvider({ defaultCwd: os.tmpdir(), platform: "win32" })` para la prueba de esquema sin spawn. |
| P-04 | `npm test` (`eval_arguments.test.ts:106-107`) | Dos subtests de `precheck` dependen de `powershell.exe` real (inexistente en Linux). | **A** | Saltar en no-Windows con `{ skip: process.platform !== "win32" }` (igual que `run_command.test.ts`), manteniendo pruebas unitarias con analizador simulado en `precheck.test.ts`. |

### 5.2 Deuda técnica, errores de código y desalineaciones verificables

| ID | Origen | Descripción | Clase | Plan / Justificación |
|---|---|---|---|---|
| P-05 | `PENDIENTES_FUERA_DE_FLUJO.md:77` | `DecisionValidationError` no adjunta `{ rawInput, rawOutput, timing }`; las trazas guardan `null` al fallar Decisión. | **A** | Añadir campo `raw` opcional a `DecisionValidationError` en `transport.ts` y adjuntarlo en `systemOne`, `chooseRoute`, `chooseTool` y `reviewArgs` (`decision.ts`), con tests en `capture.ts`. |
| P-06 | `PENDIENTES_FUERA_DE_FLUJO.md:75` | `validateAnswer` (`decision.ts:392`) cae a `noul` para cualquier tipo distinto de `choice`. | **A** | Convertir a `switch (question.type)` explícito (`"choice"` / `"noul"`) con error de validación si entra un tipo no soportado, más tests unitarios. |
| P-07 | `transport.ts:115`, `warmup.ts:26`, `eval/core/client/generative.ts:55` | Mismo riesgo potencial de `AbortSignal.timeout` (`unref`) ante mocks colgados en Node 22. | **B** | Se unifica `postJson`/`ping` con `setTimeout` ref + `clearTimeout` en `finally` para evitar cuelgues falsos en Node 22 sin afectar latencia real. |
| P-08 | `desalineaciones-eval.md` D16 + `FRENTE_3_DECISION.md` DN-3.4 | `eval/core/runner.ts` reintenta decisiones inválidas 1 vez mientras `src/` usa `0` (`DN-3.4`). | **V** | Alinear `runner.ts` a 0 reintentos en decisiones (coincidiendo con `src/` e `INSTRUCCIONES.md` §3) y actualizar el comentario de `budget.ts:78`; requiere validación en el lab para comparar tasas de `output_parse_ok`. |
| P-09 | `PENDIENTES_FUERA_DE_FLUJO.md:89` | `eval/core/scenario.ts:251` usa `facts.answer_${i+1}` en lugar de `answer_<paso>_<n>`. | **B** | Alinear a `answer_${lastStepId}_${i + 1}` solo tras verificar que `render.golden.test.ts` y datasets no dependan de la clave vieja; si `forArgs`/`forPending`/`forReview` solo leen valores de `facts` con prefijo `answer_`, es seguro y reversible. |
| P-10 | `PENDIENTES_FUERA_DE_FLUJO.md:90` | `eval/core/contract.ts` reexporta `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES`; `runner.ts` y `stages/generative.ts` pueden leer `BUDGET` vía contrato limpio. | **A** | Revisar si simplificar la reexportación o mantener aislamiento vía `contract.ts` sin romper el diseño de `eval/core/`. (Si `eval/core/contract.ts` actúa como frontera declarada de imports de `BUDGET`, documentarlo en D6 y mantener `BUDGET` ahí es más limpio que esparcir imports directos a `src/`.) |
| P-11 | `PENDIENTES_FUERA_DE_FLUJO.md:79` | `shortDesc` recorta a `MAX_TOOL_DESC_CHARS` aunque `manifest.ts` ya rechaza descripciones más largas al arrancar. | **B** | Mantener `shortDesc` como guarda defensiva para herramientas descubiertas de servidores MCP externos (que no están en `manifest.ts`), aclarando en comentario que solo aplica a tools externas. |
| P-12 | `src/tools/terminal/Revisión...md` + `docs/REVISION_run_command.md` H-01 a H-12 | Hallazgos estáticos en `run_command`: H-01 (`accentScore` con caracteres de caja `tree` U+2500–U+257F), H-02 (`\r+\n` en `LineAssembler`), H-04 (`...` REPL en `prompts.ts`), H-05 (`[n/a]`/`(n/a)` en `CHOICE_OR_KEY`), H-06 (`stderr` en `systemProcesses`), H-07 (comentario `legacyChunks`), H-08 (`lastCompleted` con `seq` en líneas en blanco), H-09 (idiomas mezclados en errores). | **A / B / V** | Varios ya fueron revisados/parchados o están abiertos en `output.ts`/`prompts.ts`/`processTree.ts`: auditar línea a línea antes de tocar en Fase 2; los puramente deterministas (H-02 `\r+\n`, H-05 `(n/a)`, H-06 `stderr` en `systemProcesses`, H-08 `seq` en `lastCompleted`, H-01 caracteres de caja) son **A/B** verificables sin `powershell.exe`. H-09/H-10/H-12 tocan textos que ven los modelos → **V** si cambian texto visto por modelos, **A** si son solo comentarios. |
| P-13 | `docs/PENDIENTES_FUERA_DE_FLUJO.md:65` | `ALL /refresh-discovery` acepta `GET` además de `POST` aunque tiene efecto de mutación de caché MCP. | **B** | Mantener `POST` y decidir si restringir `GET`: en `tests/http.test.ts` o UI puede estar siendo llamado con `POST`; verificar consumidores antes de cambiar para no romper la UI (`src/` frontend). Si la UI usa `GET` o `POST`, documentar o restringir a `POST`. |
| P-14 | `docs/PENDIENTES_FUERA_DE_FLUJO.md:72`, `FRENTE_2_CONTEXTO.md` F9, `prompts.ts:525` | `ReviewView` / `forReview` / `reviewInput` calculan `stepsDone`, `done`, `lastReads`, `env`, `schema` sin usarlos en prod. | **C / B** | `eval/variants/args_review_D3/args_review_compact_{reads,desc,schema}.ts` y `tests/render.golden.test.ts` todavía usan esos campos, y `prompts.ts:525` dice explícitamente «si se confirma en Jarvis real». Conservador: no eliminar campos de `ReviewDecisionInput` hasta confirmar en uso real (**C** / **V**). |
| P-15 | `docs/PENDIENTES_FUERA_DE_FLUJO.md:85` | Falta tabla de equivalencia de nombres de etapa entre `eval` (`tool_choice`, `args_review`, `result_verification`, `arguments`) y traza (`tool`, `review`, `verify`, `args`). | **A** | Agregar la tabla en `eval/INSTRUCCIONES.md` (documentación). |
| P-16 | `docs/PENDIENTES_FUERA_DE_FLUJO.md:88` | Script para generar casos de eval por escenario desde `jarvis-traces/`. | **C** | Sin trazas reales de muestra disponibles y diseño de dataset curado manualmente según doc; documentar como mejora futura. |
| P-17 | `src/core/tools/manifest.ts:243` | `internalDef("free_search", "web", "research", ...)` ya no se usa en `WebSearchProvider`. | **B** | No eliminar todavía porque `tests/repeat.test.ts` y `eval/datasets/*` todavía referencian `"research"`; documentar como legado interno en el catálogo. |

### 5.3 Pendientes de Frentes 1–3, Fuera de Frentes, Web Search y Evaluación (principalmente V y C)

| ID | Origen | Descripción | Clase | Motivo |
|---|---|---|---|---|
| P-18 | `FRENTE_1_MEMORIA.md` DN-1.1, 1.3, 1.4, 1.7 | Respuestas de usuario como hechos, rutas encontradas por `locate`, comando/frase «recordá que…», UI para ver/borrar hechos, y **recetas** (`ok >= 2, fail = 0`). | **V / C** | Requiere decisiones de producto/UX y validación con modelos reales en tareas de extremo a extremo. |
| P-19 | `FRENTE_2_CONTEXTO.md` DN-2.5 | `PENDING_FACTS_LOOKUP = false` en `prompts.ts` (excepción de búsqueda ante preguntas de hechos). | **C** | Requiere autorización explícita de producto del usuario (documentado en `FRENTE_2_CONTEXTO.md`: «esperando autorización»). |
| P-20 | `FRENTE_2_CONTEXTO.md` DN-2.7, DN-2.8, DN-2.9 | Rediseño `signals + data + note` (snapshot `v: 2`), secciones por herramienta en catálogo, y bajar configuración al contexto real (`8192` / `4096` en Ollama). | **V / C** | Cambia el contrato de prompts y vistas de todos los modelos + depende del arranque real de Ollama. |
| P-21 | `FRENTE_2_CONTEXTO.md` DN-2.10 | Forzar idioma por código en respuesta final. | **V** | No existe grader de idioma en el eval; requiere evaluación con modelo real. |
| P-22 | `FRENTE_3_DECISION.md` DN-3.1, 3.2, 3.3, 3.5 C, 3.6, 3.8 | Quitar ruta/tool fallida al reintentar (revertido), fallar paso ante entrada repetida («sin avance»), LRU entre tareas tras limpiar datos volátiles, zona de duda (±0,03) general. | **V / C** | Revertidos por regresiones o dependientes de calibración empírica con `d3:2b` real. |
| P-23 | `PREGUNTAS_DECISION.md` | D5 con dos preguntas (media ≥ 0,6), D4 `cumple` multi-vista, estado intermedio «dudar» ante discrepancia de vistas, polares en D3, mejorar 4 sondas residuales. | **V** | Todos modifican prompts/umbrales/consultas a modelos y requieren validación en el laboratorio. |
| P-24 | `FUERA_DE_FRENTES.md` §1, §3, §4, §6 | `list_directory` con `depth: 0` devuelve «Directorio vacío.» desde `desktop_commander`; fechas en «último X» (visto «Gemini 4 Carbon»); dataset propio para D5; 50 carpetas vacías por filtro de etapa en `eval/results/`. | **V / B** | `eval` creando carpetas vacías cuando filtro de etapa deja 0 casos en un dataset sí es **A/B** determinista revisable en `eval/cli.ts`; el extractor `list_directory` / fecha en respuesta final involucra salidas vistas por modelos (**V**) o comportamiento externo de Desktop Commander (**C**). |
| P-25 | `docs/web_search/DEEP_RESEARCH.md` y `RESULTADOS.md` | Cobertura multi-faceta en `found`, priorización de fuentes oficiales, calibrar umbrales `JUDGE_FOUND`/`JUDGE_PARTIAL` con casos "lo más reciente". | **V / C** | Deep Research en pausa por decisión; umbrales requieren evaluación con `d3:2b` y web real. |
| P-26 | `docs/PENDIENTES_FUERA_DE_FLUJO.md` | Autenticación API local, redacción/cifrado de refs y trazas en reposo, límite de tasa HTTP y tamaño de mensaje, `allowedDirectories` en `run_command`, detección de symlink/8.3/UNC en `sensitivePaths.ts`, prompts silenciosos sin PTY (Jarvis 2.0), probar `autoMode`/`approvalTiers`/`REVIEW_APPROVE`/`NOUL_APPROVE` en uso real. | **C / V** | Decisiones de producto, arquitectura v2.0 o medición con modelos reales y Windows vivo. |
| P-27 | `docs/PENDIENTES_FUERA_DE_FLUJO.md:62` | Regenerar `inputSchemaManifest.md` con `scripts/dumpManifestInputSchemas.ts`. | **C** | Requiere servidores MCP activos (`desktop_commander`, `free_search` via `uvx`). |
| P-28 | `eval/INSTRUCCIONES.md` / `desalineaciones-eval.md` D6, D25, D28 y docs de proyecto | Actualizar docs desactualizados (`desalineaciones-eval.md`, `eval/README.md`, `eval/INSTRUCCIONES.md`, `docs/ARCHITECTURE.md`, `docs/JARVIS_API.md`, `docs/PENDIENTES_FUERA_DE_FLUJO.md`, `docs/web_search/README.md`, `scripts/validate/README.md`, `readme.md`, `CHANGELOG.md`, enlaces rotos). | **A** | Se ejecutará en la Fase 3 sin alterar métricas históricas medidas. |

---

## 6. Orden de Ejecución Planificado (Fase 2)

1. **Corregir fallos de `npm test`** (`P-01`, `P-02`, `P-03`, `P-04`) y verificar que los timers `AbortSignal.timeout` (`P-07`) queden limpios.
2. **Corregir bugs deterministas en modelos/captura** (`P-05`: `DecisionValidationError.raw` + trazas; `P-06`: `switch` exhaustivo en `validateAnswer`) con sus tests unitarios.
3. **Auditar e implementar correcciones deterministas seguras en `terminal/`, `eval/` y `server/`** (`P-12` hallazgos estáticos verificados en `output.ts`/`prompts.ts`/`processTree.ts`/`terminalProvider.ts`, `P-09` si es seguro, `P-24` evitar carpetas vacías en `eval/cli.ts` cuando `stageFilter` deja 0 casos en un dataset, `P-08` alinear `runner.ts` a `DN-3.4` marcado como **V**).
4. **Re-ejecutar `npm run lint`, `npm test`, `npm run eval:smoke`, `npm run build` y `madge`** antes de pasar a la Fase 3 de documentación.

---

## 7. Resumen de Cierre (Fases 2 y 3)

### Resueltos y verificados de forma determinista (**A / B**)
- **`P-01`, `P-07`:** reemplazo de `AbortSignal.timeout` (`unref`) por `AbortController` + `setTimeout` ref + `clearTimeout` en `finally` (`webSearchProvider.ts`, `transport.ts`, `warmup.ts`, `eval/core/client/generative.ts`). Desbloquea toda la suite `tests/web_search.test.ts`.
- **`P-02`:** selección de `path.win32` / `path.posix` (`pathApiFor`) en `guard.ts`, `tiers.ts` y `postcondition.ts` para rutas o entornos Windows incluso corriendo sobre Linux.
- **`P-03`, `P-04`:** paridad de esquema `TerminalProvider` con `platform: "win32"` explícito en `tests/run_command.test.ts` y salto condicional `win32` en los 2 subtests con `powershell.exe` real de `tests/eval_arguments.test.ts`.
- **`P-05`, `P-06`:** `DecisionValidationError` adjunta `raw` (`transport.ts`, `decision.ts`) preservado en `captureDecision`; `validateAnswer` refactorizado a `switch (question.type)` exhaustivo. Tests agregados en `tests/decision.test.ts`.
- **`P-09`:** `eval/core/scenario.ts` emite `answer_${lastStepId}_${i + 1}` igual que producción (verificado en `tests/decision.test.ts`).
- **`P-11`:** JSDoc de `shortDesc` aclarado como guarda defensiva para tools MCP externas (`prompts.ts`) y limpieza de comentarios heredados `start_process` (`guard.ts`, `callRunner.ts`).
- **`P-12` (`run_command`):** parches estáticos `H-01` (caracteres de caja U+2500–U+257F en `output.ts` y `powershell.ts`), `H-02` (`\r\r\n` en `LineAssembler`), `H-05` (`[n/a]`/`(n/a)` excluidos en `CHOICE_OR_KEY`), `H-06` (verificado `stdio` en `processTree.ts`), `H-07` (comentario `legacyChunks`), `H-08` (`lastCompleted` limpiado en `closeAnswered`), con tests en `tests/run_command.test.ts`.
- **`P-13`:** `/refresh-discovery` restringido a `POST` (`jarvisRouter.ts`), con test en `tests/http.test.ts`.
- **`P-24` (`eval/cli.ts`):** datasets con 0 casos tras filtrar se omiten en `dryRun` y corrida real para evitar carpetas vacías en `eval/results/`.
- **`P-10`, `P-15`, `P-28` (Documentación):** sincronizados `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md`, `docs/JARVIS_API.md`, `docs/PENDIENTES_FUERA_DE_FLUJO.md`, `docs/REVISION_run_command.md` (§12), `src/tools/terminal/Revisión de la tool run_command (Jarvis).md`, `docs/web_search/README.md`, `scripts/validate/README.md`, `eval/README.md`, `eval/INSTRUCCIONES.md`, `desalineaciones-eval.md`, `readme.md`, `CHANGELOG.md` y secciones de cierre V/C en `docs/JARVIS_EVALUACION.md` y `docs/analisis/*.md` (sin alterar métricas históricas medidas).

### Implementados determinísticamente pendientes de validación con modelo / Windows (**V**)
- **`P-08` (`DN-3.4`):** `eval/core/runner.ts` pasó de 1 a `0` reintentos ante salidas inválidas de Decisión y `src/core/budget.ts:78` actualizó su comentario. Requiere corrida en laboratorio contra `d3:2b` para medir `output_parse_ok`.
- **`P-12` (`H-01` en `powershell.ts` / `H-08` vivo):** `__jvDecode` se actualizó por paridad estática con `output.ts`; requiere verificación en vivo bajo `win32` / `powershell.exe`.

### Bloqueados (**C**) o fuera de esta misión
- `P-16` (generador desde trazas), `P-18` a `P-27` (decisiones de producto como `DN-2.5` o `repeatByArgs`, cambios en prompts/umbrales, servidores MCP vivos para `dumpManifestInputSchemas.ts`, entorno Ollama/GPU y Windows vivo).

---

## 8. Cierre de Retiros (`P-14`, `P-17`) y Revisión General de Calidad

### Retiros ejecutados
- **`P-14` (`ReviewView` / `ReviewDecisionInput`):** `buildReviewView`, `reviewInput`, `ReviewDecisionInput`, `ReviewCandidate`, `ReviewViewOptions`, `candidateOf` y `BUDGET.caps.candidateSchema` eliminan los campos no usados en producción (`stepsDone`, `done`, `lastReads`, `env`, `candidate.description`, `candidate.schema`). Los prompts generados en producción no cambian; se retiraron las 4 variantes D3 experimentales que leían esos campos (`eval/variants/args_review_D3/args_review_{compact_desc,compact_schema,compact_reads,permissive}.ts`), dejando constancia en `conclusiones_D3.md` sin alterar métricas históricas, y se alinearon `eval/variants/decision_all_stages_example.ts`, `tests/decision.test.ts` y `tests/__golden__/render.json`.
- **`P-17` (`free_search:research`):** retirada del catálogo de producción (`src/core/tools/manifest.ts`) la definición interna `research` y la referencia obsoleta en `stemsOf` (`text.ts`). Actualizados `tests/repeat.test.ts` y `tests/sensitive.test.ts` hacia `free_search:search`. En `eval/core/scenario.ts` (`toolOf`) se agregó `LEGACY_EVAL_TOOLS["web:research"]` exclusivamente para compatibilidad de datasets históricos (`tool_choice_16_cases`, `llm_arguments*`) sin modificarlos ni reintroducirla en producción.

### Correcciones seguras de fugas, duplicidad y código muerto
- **Código muerto eliminado:** archivo vacío `tests/render.test.ts` (0 bytes).
- **Bot y cliente Telegram (`src/telegram/bot.ts`, `src/telegram/api.ts`):** `settleTimer` guardado en `TaskState` y cancelado en `stopTimers`/`settle`/recepción temprana de resultado; `tasks.clear()` y limpieza de `early` en `stop()`; tope `MAX_EARLY_EVENTS = 200` durante `/process`; comprobaciones `abort.signal.aborted` en `sendVoice`/`settle`/`handle`; espera de reconexión `RECONNECT_MS` en `JarvisApi.listen` cancelable al instante mediante `AbortSignal` (con test en `tests/telegram.test.ts`).
- **Servidor HTTP y SSE (`server.ts`, `src/server/jarvisRouter.ts`):** `cleanShutdown` ahora cierra el servidor HTTP y sus conexiones activas (`httpServer.close()` + `closeAllConnections?.()`); el endpoint `/events` protege `req.on('close')` con bandera idempotente `closed` para evitar doble decremento de `sseClients` o escrituras sobre respuestas cerradas.
- **Procesos hijos y transporte (`src/core/mcp/transport.ts`, `src/tools/terminal/terminalProvider.ts`):** manejador `killer.once("error", ...)` en `spawn("taskkill")` de Windows para evitar excepciones no capturadas; limpieza explícita de `graceTimer` al completar `finish()` en `attach()` y limpieza de `this.ended.clear()` en `TerminalProvider.close()`.
- **Cliente eval (`eval/core/client/generative.ts`):** limpieza del listener `abort` cuando el backoff de reintento concluye normalmente.
- **UI React (`ui/`):** cierre de `AudioContext` al desmontar `useSpeech` y guarda `cancelled` en `useSpeakNewResults` durante `claimSpeech`; limpieza de `focusTimerRef` en `App.tsx`; reutilización de `useClipboardCopy` en `RefViewerModal.tsx` y `EnvironmentModal.tsx` eliminando lógica y temporizadores duplicados sin limpiar.

### Inconsistencias y mejoras de núcleo / flujo / contexto anotadas para decidir (sin modificar)
Quedaron registradas en `docs/PENDIENTES_FUERA_DE_FLUJO.md` para decisión explícita:
1. **`VerifyView` / `VerifyDecisionInput` (`done`, `recent`, `request`) y `DecisionFrame.lastResult`:** campos sin uso en los prompts de producción (`DN-2.1` / `DN-2.2`) que siguen calculándose para compatibilidad con variantes legadas en `eval/variants/{d4,route_D1,tool_choice_D2}/`.
2. **`precheck.ts` (`collectSources`):** consulta `ctx.view.forReview(...).userInput` en lugar de contar con una lectura directa en `ctx/views/`.
3. **Higiene en `core/models/transport.ts` y `core/engine/services.ts`:** listener `abort` de backoff no desregistrado en `transport.ts:153` y bandera global de módulo `coherenceWarned` compartida entre instancias/tests en `services.ts:33`.
4. **Semántica de estado HTTP:** `mcpRouter.ts` y `POST /api/jarvis/refresh-discovery` devuelven HTTP `200` con `{ error }` en fallos (acoplado a `ui/services/jarvisApi.ts`).
5. **Ya rastreados:** `DecisionQuestion.score` no implementado en `validateAnswer` y nombres heredados `Decision20Engine` / `"Decision 2.0"`.

