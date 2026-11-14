# Investigación: extensión del eval al «modo Jarvis real» (SOLO INVESTIGACIÓN)

> **Alcance y restricciones de este documento:** análisis puramente descriptivo sobre el código actual de `src/`, `eval/` y `tests/`. No modifica código fuente, tests ni documentación previa.
>
> **Declaración de no verificados en este entorno (contenedor Linux):**
> 1. **`desalineaciones-eval.md`:** no existe en el repositorio (`find . -name "*desalineaciones*"` devolvió vacío). Las duplicaciones y desalineaciones documentadas en la §5 se verificaron directamente leyendo `src/` y `eval/`.
> 2. **Modelos reales y `powershell.exe`:** este entorno Linux no dispone de los endpoints reales de Qwen/Ollama ni Decision 2.0, ni del binario `powershell.exe` de Windows (`analyzePowerShell` en `src/core/engine/precheck.ts:325-345` devuelve `null` al fallar `execFile`). Todo el comportamiento del motor y sus vistas se verificó leyendo el código, ejecutando la suite existente y corriendo una sonda en `/tmp` con implementaciones simuladas de `EngineLLM`, `IActionDecision` e `IMCPServer` (§6).

---

## 1. Resumen ejecutivo

1. **`eval/` ya reutiliza casi todo `src/` para construir prompts por etapa, pero hoy duplica el transporte, el bucle de reintento y los lectores de salida.** `eval/core/scenario.ts` importa `ctx.view.*`, `engine/adapters.ts`, `models/stageRequests.ts` y `models/prompts.ts`, mientras `eval/core/contract.ts` reexporta `parseJsonObject`, `validateArgs`, `parsePlanSteps` y umbrales (`NOUL_APPROVE`, `reviewOutcome`). Sin embargo, `eval/core/runner.ts` y `eval/core/client/*` reimplementan `dispatchValidated`, `reserveCompletionTokens` y `buildDecisionRequest`.
2. **Cobertura asimétrica de etapas:** `src/core/types/stages.ts:6` define **13** etapas (`STAGES`), pero `eval/core/stages/index.ts:69-81` registra **11** (10 de `STAGES` + `fragment_judge`, que en `src/` vive fuera de `STAGES`). Faltan como etapas formales de `eval/` **`probe`**, **`continuation`** y **`completion` (D5)**.
3. **`runTask` encadenado ya es inyectable por `EngineDeps` (`src/core/contracts.ts:308-330`) —probado en ejecución real en §6—, pero tiene 8 fricciones/bloqueos concretos** para fixtures y variantes: ausencia de inyección de `DiskView`/`TierDisk` hacia `verify.ts` y `callRunner.ts`, `fs.existsSync`/`fs.openSync` directos en `precheck.ts`, `CommandAnalyzer` no propagado en `callRunner.ts`, nombres fijos de servidores MCP en `DESTINATIONS`, fecha `TODAY` no inyectable, umbrales/presupuesto fijos, `FragmentJudge` acoplado a `WebSearchProvider` y motores reales (`QwenEngine`/`Decision20Engine`) que ignoran `ParamsOverride` y `DecisionReaders` de 7 variantes.
4. **En modo aislado por etapa sobre flujos reales**, casi todas las etapas pueden invocarse ya con `TaskContext` (o `parseSnapshot`), salvo que `verifyInput` en producción (`src/core/engine/verify.ts:92`) omite `request` y `expected` en reactivo —que `scenario.ts:411-422` inyecta manualmente solo en dataset— y `fragment_judge` carece de constructor en `engine/adapters.ts`.
5. **Recomendación:** adoptar una **arquitectura híbrida sobre una capa compartida (Opción B de §8)**: mantener intacto el CLI/runner de datasets, reutilizar `QwenEngine`/`Decision20Engine` (o extraer `transport/dispatch` puro en `src/core/models/`) con soporte genérico opcional de `StageParams`/lectores, exponer `disk`/`analyze`/`clock` en `EngineDeps`, y alimentar el «modo Jarvis real» con snapshots `TaskContext` capturados de trazas reales o escenarios ejecutables + fixtures de `IMCPServer` y `DiskView`.

---

## 2. Tabla de etapas (`src/` vs `eval/`)

Inventario completo de las **13** etapas en `STAGES` (`src/core/types/stages.ts:6`) más `fragment_judge` (`eval/core/stages/index.ts:75`).

| Etapa (`src` / `eval`) | Definición en `src/` (`archivo:línea`) | Qué usa hoy `eval/` | Invocabilidad aislada desde `src/` | Brecha o condición concreta |
|---|---|---|---|---|
| `first_query` / `d0` | `src/core/types/stages.ts:6`, `src/core/engine/firstQuery.ts:18-22`, `src/core/engine/classify.ts:16-28`, `src/core/models/decision.ts:321-331`, `src/core/models/prompts.ts:408-427` | `scenario.ts:368-372` usa `DECISION_PROMPTS.buildFirstQuery`; `labels.ts:21,118-123` usa `firstQueryKind`; `stages/decision.ts:46-62`. | ✅ | Solo requiere `{ request }` (`FirstQueryInput`); en producción solo aplica en `mode === "reactive"` antes del primer paso (`classify.ts:20`). |
| `continuation` / *(sin etapa)* | `src/core/types/stages.ts:6`, `src/core/engine/thread.ts:12-34`, `src/core/engine/classify.ts:34-46`, `src/core/models/decision.ts:349-357`, `src/core/models/prompts.ts:392-402` | ❌ No registrada en `eval/core/stages/index.ts:69-81` ni en `eval/core/types.ts:17`. | ✅ | `DECISION_PROMPTS.buildContinuation({ previous, request })` es pura, pero falta registrarla como etapa de `eval/` (hoy solo hay referencias documentales en `FRENTE_1_MEMORIA.md`). |
| `pending` / `pending` | `src/core/types/stages.ts:6`, `src/core/engine/pending.ts:50-67`, `src/core/engine/adapters.ts:79-81`, `src/core/models/stageRequests.ts:124-139`, `src/core/models/qwen.ts:544-558` | `scenario.ts:443-445` usa `pendingStageRequest(pendingInput(ctx, previous), P)`; `stages/generative.ts:138-159` usa `parsePendingList`. | ⚠️ | Funciona directo con `ctx`, **excepto** para las 3 variantes `Pending/pending2*.ts` cuyo `schema` devuelve objetos `{kind,goal,done_when}[]`: `QwenEngine.generatePendingFromView` (`qwen.ts:552`) llama a `parsePendingList` (`qwen.ts:254-263`) que los rechaza, mientras `stages/generative.ts:146-152` tiene un parche ad-hoc solo en `eval/`. |
| `route` / `route` | `src/core/types/stages.ts:6`, `src/core/engine/stepLoop.ts:95-100`, `src/core/engine/adapters.ts:171-174`, `src/core/models/decision.ts:210-230`, `src/core/models/prompts.ts:479-494` | `scenario.ts:387-392` usa `routeInput(ctx.view.forRoute(routeViewOptions()), flags)` y `D.buildRouteChoice`. | ✅ | Requiere pasar `flags.routes` (`availableRoutes` en `callRunner.ts:144-150` depende de `discovery` + `blacklist`). Para captura/replay real hay que preservar las `routes` disponibles en ese turno (si `routes.length === 1`, `Decision20Engine` hace shortcut y no llama al modelo en `decision.ts:216-220`). |
| `tool` / `tool_choice` | `src/core/types/stages.ts:6`, `src/core/engine/callRunner.ts:279-286`, `src/core/engine/adapters.ts:177-179`, `src/core/models/decision.ts:236-264`, `src/core/models/prompts.ts:497-514` | `scenario.ts:393-398` usa `toolInput(ctx.view.forRoute(routeViewOptions(route)), route, tools)` y `D.buildToolChoice`. | ⚠️ | En producción `tools` pasa por `applyDestination` + `usableTools` + `sortByCatalog` (`callRunner.ts:189,200,282`) con el `inputSchema` vivo del servidor MCP. En `scenario.ts:275,395-396` usa `{ type: "object", properties: {} }` del manifest (o `LEGACY_EVAL_TOOLS`), y en modo real debe conservarse la lista exacta de herramientas descubiertas (sin shortcut si `tools.length === 1`, `decision.ts:240-251`). |
| `args` / `arguments` | `src/core/types/stages.ts:6`, `src/core/engine/callRunner.ts:301-329`, `src/core/engine/adapters.ts:106-113`, `src/core/models/stageRequests.ts:99-109`, `src/core/models/qwen.ts:516-520,600-621` | `scenario.ts:428-442` usa `renderArgsView` + `argsInput` + `argumentsStageRequest` + `precheckBase`. | ⚠️ | `renderArgsView` + `argsInput` + `argumentsStageRequest` aceptan `ctx`, `tool`, `environment`, `priorAttempts` y `memory` (del `memory.json` + `threadMemoryLines`). Falta pasar `priorAttempts` y `memory` en `scenario.ts:433-434` (hardcodea `0` y sin `memory`) y en modo real el `tool.inputSchema` completo debe provenir del servidor o snapshot. |
| `review` / `args_review` | `src/core/types/stages.ts:6`, `src/core/engine/callRunner.ts:406-420`, `src/core/engine/adapters.ts:194-201`, `src/core/models/decision.ts:270-282`, `src/core/models/prompts.ts:527-548` | `scenario.ts:399-403` usa `reviewInput(ctx.view.forReview(reviewViewOptions()), route, tool, args)` + `D.buildArgsReview`. | ⚠️ | Requiere el candidato `{ route, tool, args }` antes de registrarse como llamada aprobada (y sin haber corrido `precheck` con resultado bloqueante). En modo encadenado o aislado con `QwenEngine`/`Decision20Engine`, una variante con `read.args_review` (`DecisionReaders`) no existe en `Decision20Engine` (`decision.ts:275` busca `"review"`). |
| `verify` / `result_verification` | `src/core/types/stages.ts:6`, `src/core/engine/verify.ts:59-106`, `src/core/engine/adapters.ts:208-216`, `src/core/models/decision.ts:288-301`, `src/core/models/prompts.ts:555-589` | `scenario.ts:404-424` usa `verifyInput(ctx.view.forVerify(id))` + `codeAnswersOk`, pero **sobrescribe** `criterion.expected` y `request`. | ⚠️ | **Desalineación detectada:** `verify.ts:92` llama a `verifyInput(ctx.view.forVerify(callId))` sin `request` (`VerifyDecisionInput.request` es siempre `undefined` en producción) y `validate.ts:156` prohíbe `expected` en pasos reactivos. `scenario.ts:411-422` inyecta ambos manualmente. Además, en modo real `postconditionOf` (`verify.ts:86-90`) cortocircuita antes de `verifyResult`. |
| `probe` / *(sin etapa)* | `src/core/types/stages.ts:6`, `src/core/tools/probes.ts:18-217`, `src/core/engine/probes.ts:24-70`, `src/core/models/decision.ts:337-343` | ❌ No registrada en `eval/core/stages/index.ts`. Solo existe experimento ad-hoc en `eval/exp/probe_eval.ts` (`PROBE` directo contra Ollama). | ✅ | `probeCallOf` (`engine/probes.ts:24-35`) y `Probe.stages()` son puros sobre `ctx` + `call`; `Decision20Engine.probe` recibe `ProbeQuery`. Fácil de registrar si se agrega como etapa en `eval/`. |
| `completion` / *(sin etapa)* | `src/core/types/stages.ts:6`, `src/core/engine/completion.ts:28-41`, `src/core/engine/adapters.ts:87-89`, `src/core/models/decision.ts:307-315`, `src/core/models/prompts.ts:459-473` | ❌ No registrada en `eval/core/stages/index.ts`. Solo experimento en `eval/exp/close_check.ts` (`completionInput` via `pendingInput(ctx, [])`). | ✅ | `DECISION_PROMPTS.buildCompletionCheck(completionInput(ctx))` es puro sobre `TaskContext` (en modo reactivo con lista vacía y `ctx.canFinish() === "completed"`). Fácil de registrar en `eval/`. |
| `question` / `question` | `src/core/types/stages.ts:6`, `src/core/engine/ask.ts`, `src/core/engine/adapters.ts:57-59`, `src/core/models/stageRequests.ts:112-121`, `src/core/models/qwen.ts:523-538` | `scenario.ts:446-447` usa `questionStageRequest({ view: renderAsk(ctx.view.forAsk(), askRenderOptions()) }, P)`. | ✅ | Totalmente alineado con `src/` (`askRenderOptions`, `renderAsk`, `questionStageRequest`). |
| `plan` / `plan` | `src/core/types/stages.ts:6`, `src/core/engine/planner.ts:44-90`, `src/core/engine/adapters.ts:98-103`, `src/core/models/stageRequests.ts:85-96`, `src/core/models/qwen.ts:564-580` | `scenario.ts:425-427` usa `planStageRequest(planInput(ctx, at.feedback ?? null), config, P)`. | ✅ | Totalmente alineado con `src/` (incluye `buildCompactCatalog()` en `stageRequests.ts:90`). |
| `final` / `final` | `src/core/types/stages.ts:6`, `src/core/engine/finalize.ts:43-79`, `src/core/engine/adapters.ts:70-76`, `src/core/models/stageRequests.ts:142-152`, `src/core/models/qwen.ts:583-597` | `scenario.ts:448-451` usa `finalStageRequest({ view: renderFinal(ctx.view.forFinal(finalViewOptions()), finalRenderOptions()).text }, config, P)`. | ⚠️ | El armado del request es idéntico cuando no hay hilo (`thread`), pero: (a) `scenario.ts:450` omite `thread` (`PreviousTask`); (b) en producción `finalize.ts:72-78` añade `renderStatusNote` + `stripNoChangesFiller` + `renderPlaceNote` *después* de `generateFinalFromView`. |
| *(fuera de `STAGES`)* / `fragment_judge` | `src/tools/web/webSearchProvider.ts:178,218-220,453,553`, `src/core/models/decision.ts:129,363-377`, `src/core/models/prompts.ts:433-451` | `scenario.ts:373-379` usa `D.buildFragmentJudge({ need, fragments })`; `labels.ts:195-217`. | ⚠️ | Funciona aislado con `{ need, fragments }`, pero: (a) `webSearchProvider.ts:219,166` antepone `\nTODAY: YYYY-MM-DD` a `need` y `[source date: ...]` a cada fragmento antes de llamar a `judge.score`; (b) no está en `STAGES` (`src/core/types/stages.ts:6`) ni pasa por `EngineDeps.sink` (`capture.ts`). |

---

## 3. Tabla de costuras para el modo real encadenado (`runTask`)

`runTask(ctx, runtime, deps)` (`src/core/engine/runTask.ts:58`) ya desacopla los 3 motores (`decision`, `discovery`, `llm`), el `vault` y el `sink`, pero varias dependencias del sistema de archivos, procesos y configuración siguen cableadas por defecto en funciones internas.

| Dependencia / Global | ¿Inyectable hoy? | Ubicación exacta (`archivo:línea`) | Impacto en modo real encadenado | Cambio mínimo genérico propuesto (solo diseño) |
|---|---|---|---|---|
| Motores y políticas principales (`EngineDeps`) | ✅ | `src/core/contracts.ts:308-330`, `src/core/engine/runTask.ts:58-59` | Ya inyectables: `decision`, `discovery`, `llm`, `vault`, `guardScope`, `blacklist`, `environment`, `autoMode`, `approvalTiers`, `memory`, `previousTask`, `sink`. | Conservar intacto `EngineDeps` como puerta única de inyección. |
| Nombres de servidores MCP + `availableRoutes` | ⚠️ | `src/core/tools/manifest.ts:76-96`, `src/core/engine/callRunner.ts:152-173,184-198` | Si un harness solo registra `"files"` o deja sin registrar `"jarvis_terminal"`/`"jarvis_web"`, `callRunner.ts:168` calcula `answeredEmpty=false` (porque `getServer(mcp) === undefined`) y **sigue ofreciendo la ruta**, fallando luego en `selectTool`/`discoverTools` (`Servidor MCP '...' no disponible`, ver §6 Escenario 0). | Documentar/validar en harness registrar los 3 servidores de `DESTINATIONS` (vacíos si no se usan en la prueba) o permitir un `DiscoveryEngine` en memoria que responda `[]` para servidores inactivos. |
| `DiskView` en `verifyCall` (`postconditionOf`) | ❌ | `src/core/engine/postcondition.ts:16-26,36`, `src/core/engine/verify.ts:87` | `postconditionOf` ya acepta `disk: DiskView = REAL_DISK`, pero `verify.ts:87` la llama sin `disk`. Cualquier herramienta `write_file`/`create_directory`/`move_file` simulada en memoria **falla siempre `postconditionOf`** (`unmet` → `rejected / not_accomplished`) sin consultar D4 ni probes (probado empíricamente en §6 Escenario 1). | Añadir `readonly disk?: DiskView` (o `fs`) opcional en `EngineDeps` (default `REAL_DISK`) y pasarlo desde `verify.ts:87`. |
| `TierDisk` en `callRunner` (`approvalTierOf`) | ❌ | `src/core/policy/tiers.ts:22-25,40`, `src/core/engine/callRunner.ts:368` | `approvalTierOf` ya acepta `disk: TierDisk = REAL`, pero `callRunner.ts:368` no lo pasa. Con `approvalTiers: true`, un archivo virtual no existe en disco real → `write_file` sobre él siempre clasifica distinto al FS simulado. | Reutilizar `deps.disk` (`DiskView` satisface `TierDisk` porque expone `exists(p)`) y pasarlo en `callRunner.ts:368`. |
| `checkParentFolder` y `readRefText` en `precheckCall` | ❌ | `src/core/engine/precheck.ts:99-111,358-373`, `src/core/engine/callRunner.ts:373` | `checkParentFolder` llama directo a `fs.existsSync(input.environment.home)` y `fs.existsSync(parent)` (probado en §6 Escenario 3: `c2` rechazado por carpeta padre). `readRefText` usa `fs.openSync(ref.where)` directo en lugar de una interfaz de lectura/vault. | Pasar `disk` (`exists`) a `precheckCall` para `checkParentFolder` y aceptar un lector de ref opcional (o `vault.get`/stream en `collectSources`) cuando la ref viva en memoria/otro directorio. |
| `CommandAnalyzer` en `callRunner` | ⚠️ | `src/core/engine/precheck.ts:57,325,375`, `src/core/engine/callRunner.ts:373` | `precheckCall` acepta `analyze: CommandAnalyzer = analyzePowerShell`, pero `callRunner.ts:373` lo omite. En Linux falla; en Windows con fixture/replay dispara subprocesos `powershell.exe` reales de hasta 8 s por llamada. | Añadir `readonly analyzeCommand?: CommandAnalyzer` opcional en `EngineDeps` (default `analyzePowerShell`) y pasarlo en `callRunner.ts:373`. |
| Fecha `TODAY` y reloj del contexto / `TaskManager` | ❌ | `src/core/models/prompts.ts:32,151,205,271`, `src/core/tasks.ts:85,135` | `todayLine(now = new Date())` ya tiene parámetro `now`, pero `PROMPTS` lo invoca sin argumentos (`151,205,271`). `TaskManager` fija `now: Date.now` y compara `THREAD_TTL_MS` contra `Date.now()`. Impide snapshots deterministas entre días distintos. | Pasar `now?: () => Date` (o `today?: string`) opcional a `QwenEngine`/prompt builders o `ConfigSource`/render options, manteniendo `new Date()` por defecto. |
| Umbrales de decisión y `BUDGET` | ❌ | `src/core/budget.ts:18-158`, `src/core/engine/verify.ts:32,35`, `completion.ts:19,25`, `firstQuery.ts:13,15`, `probes.ts:54`, `runTask.ts:72`, `thread.ts:20` | Todos son constantes de módulo exportadas (`NOUL_APPROVE = 0.6`, `REVIEW_APPROVE = 0.6`, `COMPLETION_APPROVE = 0.75`, `FIRST_QUERY_CHAT_APPROVE = 0.7`, `MAX_REOPENS = 2`, `GATE_MIN = 0.6`, `BUDGET.*`). No hay punto único para experimentar umbrales en corrida encadenada sin editar `src/`. | Si el eval V2 va a variar umbrales, agrupar un objeto `PolicyThresholds` opcional inyectable en `EngineDeps` / `Decision20Engine` con estos defaults. |
| `FragmentJudge` / `web_search` en `runTask` | ❌ | `src/tools/web/webSearchProvider.ts:176-215,453,553`, `src/core/engine/capture.ts:57-85` | `WebSearchProvider` vive en `src/tools/` (fuera de `EngineDeps`); las llamadas del juez (`judge.score`) no pasan por `CaptureSink.llm` (`src/core/engine/capture.ts`), sino que devuelven `rawInput`/`rawOutput` recortados dentro de `judgeMeta` (`webSearchProvider.ts:466,570-571`). | Para modo encadenado con `web_search` real o variante de `buildFragmentJudge`, exponer el factory del `Decision20Engine` de la variante al construir `WebSearchProvider` (respetando `tests/architecture.test.ts:36-44` donde `tools/` no importa `engine/` ni `models/`). |
| `QwenEngine` / `Decision20Engine` y `ParamsOverride` / `DecisionReaders` | ❌ | `src/core/models/qwen.ts:327-332,544-558`, `src/core/models/decision.ts:131-136,275,294,372`, `src/core/models/stageRequests.ts:85-152` | Ambos motores aceptan `PromptSet` / `typeof DECISION_PROMPTS` completos en el constructor (`qwen.ts:331`, `decision.ts:135`), pero **no aceptan** `ParamsOverride` por etapa (`temperature`, `maxTokens`, `thinking`, `reasoningEffort`, `schema`) ni `DecisionReaders` para preguntas renombradas o esquemas de `pending2`. | Añadir soporte genérico opcional de `StageParams` en `stageRequests.ts`/`QwenEngine` y hooks de lectura opcionales (solo cuando existan) o adaptador para el eval. |
| Consola y singletons de estado en módulo | ⚠️ | `src/core/engine/failures.ts:66`, `services.ts:33`, `tools/manifest.ts:344`, `callRunner.ts:424,463`, `qwen.ts:337,424,464`, `decision.ts:166,189` | `llmDown` (`WeakSet<TaskContext>`) está bien aislado por instancia de `ctx`, pero `coherenceWarned` (`services.ts:33`) y `warnedNotes` (`manifest.ts:344`) son singletons por proceso, y todos los motores escriben abundante ruido en `console.log`/`warn`/`error` durante corridas batch. | Aceptar logger opcional o silenciar en harness; `parseSnapshot` (`src/core/ctx/snapshot.ts:61`) debería reexportarse desde `src/core/ctx/index.ts` si se usa externamente. |

---

## 4. Variantes: inventario y compatibilidad en los modos reales

### 4.1 Inventario exacto (`eval/variants/`)
Conteo verificado en el repositorio (`find eval/variants -name "*.ts"` y `grep`): **97 archivos `.ts`** (más 9 archivos `.md` de conclusiones):
- **90 archivos solo con `prompts` (`PROMPTS` y/o `DECISION_PROMPTS`):** incluye `prod.ts`, `decision_all_stages_example.ts`, las **5** variantes `ctx/*` (`ctx_args_by_tool`, `ctx_d4_norecent`, `ctx_final_clean`, `ctx_final_nofiller`, `ctx_pending_facts`), y las variantes de `args_review_D3` (7), `arguments` (5), `d4` (19 salvo `d4_keys_a`), `final` (6), `fragment_judge` (4 salvo `ranking`/`ternary`/`classifier`), `Pending` (15 salvo `pending2*`), `plan` (2), `question` (11), `route_D1` (8) y `tool_choice_D2` (6).
- **4 archivos con `read:` (`DecisionReaders` en `eval/core/types.ts:289-296`):**
  1. `eval/variants/d4/d4_keys_a.ts:22-24` (renombra `ok`→`usable_data` y `cumple`→`step_accomplished`).
  2. `eval/variants/fragment_judge/fragment_judge_ranking.ts:65` (lectura personalizada de `fragment_judge`).
  3. `eval/variants/fragment_judge/fragment_judge_ternary.ts:62` (lectura ternaria de `fragment_judge`).
  4. `eval/variants/fragment_judge/fragment_judge_classifier.ts:58` (lectura tipo clasificador).
- **3 archivos con `params:` (`ParamsOverride` en `eval/core/types.ts:274-280,308`):**
  1. `eval/variants/Pending/pending2.ts:24-47` (sobrescribe `params.pending.schema` a objetos `{kind, goal, done_when}`).
  2. `eval/variants/Pending/pending2_obj.ts:24` (sobrescribe `params.pending.schema`).
  3. `eval/variants/Pending/pending2_exp.ts:27` (sobrescribe `params.pending.schema`).

### 4.2 Comportamiento y brechas en modo real aislado vs encadenado

1. **Spread obligatorio de `PROMPTS` / `DECISION_PROMPTS`:** `QwenEngine` (`src/core/models/qwen.ts:331`) y `Decision20Engine` (`src/core/models/decision.ts:135`) reciben el objeto entero de prompts (sin merge interno). En `eval/core/scenario.ts:319-321`, `effectivePrompts` hace `{ ...PROMPTS, ...ov?.PROMPTS }` y `{ ...DECISION_PROMPTS, ...ov?.DECISION_PROMPTS }`. Cualquier runner que instancie motores reales con una `Variant` **debe aplicar exactamente ese merge de primer nivel** (nunca pasar `variant.prompts.PROMPTS` parcial directo a `new QwenEngine`, o fallarán las demás etapas en ejecución).
2. **Brecha de `DecisionReaders` (`4` variantes):** `Decision20Engine.verifyResult` (`decision.ts:294`) espera claves literales de `VERIFY_CHECKS` (`ok`, `cumple`), `reviewArgs` (`decision.ts:275`) espera `"review"`, y `score` (`decision.ts:372`) lee `noulAnswer(response, "f" + i)`. Sin adaptar `Decision20Engine` (o pasarle `read`), las 4 variantes con `read:` lanzan `DecisionValidationError` en modo real encadenado. *(Nota: preguntas **adicionales** manteniendo intactas las claves principales —como `d4_request_done.ts:59-71`— sí pasan `parseResponse` y funcionan si el campo de entrada existe).*
3. **Brecha de `ParamsOverride` (`3` variantes `pending2*` y parámetros de tuning):** `stageRequests.ts:85-152` construye el request desde `StageConfig` (`qwenMaxTokens`, `thinking`) y `BUDGET`. Ignora `params.<etapa>.{temperature, maxTokens, thinking, reasoningEffort, schema}`. Peor aún: aunque se enviara el `schema` de `pending2`, `QwenEngine.generatePendingFromView` (`qwen.ts:552`) exige `string[]` vía `parsePendingList` (`qwen.ts:254-263`) y fallaría con `LLMValidationError`.
4. **Brecha por campo ausente `VerifyDecisionInput.request` (`d4_request_done` / `close_check.ts`):** `eval/variants/d4/d4_request_done.ts:14,59` activa su pregunta `request_done` solo si `data.request` no es nulo. En producción `verifyInput(ctx.view.forVerify(callId))` (`src/core/engine/verify.ts:92`, `adapters.ts:208-216`) **no incluye `request`**, por lo que en modo encadenado o aislado fiel a `src/`, `d4_request_done` se degrada silenciosamente a `d4_recent_hints` sin activar `request_done`.
5. **Variantes `ctx/*` desactualizadas o sensibles a idioma en flujos reales (§6 Escenario 4):**
   - `eval/variants/ctx/ctx_args_by_tool.ts:17-29` ya fue absorbida en parte por `PROMPTS.ARGUMENTS_VIEW.buildSystemPrompt` (`src/core/models/prompts.ts:137-146`): para `read_file` produce exactamente **966 caracteres** en ambos (`prod` y variante); hoy solo difiere en que su `buildUserPrompt` omite `ENV` para `web_search` y `MEMORY`/`thread`.
   - `eval/variants/ctx/ctx_final_clean.ts:11,18-21` usa una regex case-insensitive pero sensible a tildes/palabras concretas (`leé` con tilde) que falló ante `"Lee ventas.txt"` sin tilde, emitiendo `"Write the answer now, in the language of REQUEST."` en lugar de `"in Spanish"`, además de omitir `threadBlock(data.thread)` (`PROMPTS.FINAL_VIEW.buildUserPrompt` en `prompts.ts:269-272`).

---

## 5. Duplicaciones `eval/` ↔ `src/` y riesgo de desalineación

> **Nota explícita:** `desalineaciones-eval.md` **no existe** en el repositorio. A continuación se listan las duplicaciones y divergencias comprobadas línea por línea entre `eval/` y `src/`.

### 5.1 Duplicaciones activas en `eval/`

| Área duplicada | En `eval/` (`archivo:línea`) | En `src/` (`archivo:línea`) | Riesgo / Divergencia real observada |
|---|---|---|---|
| Bucle de reintento generativo y manejo de `final` truncado | `eval/core/runner.ts:426-462`, `eval/core/stages/generative.ts:128-132` | `src/core/models/qwen.ts:479-513,523-538,583-597` | **Divergencia en `final` y `question`:** `stages/generative.ts:129` hace `stripThink(rawOutput).trim()`, y `runner.ts:447` no añade aviso al aceptar una salida truncada en el último intento; `qwen.ts:589-592` no hace `.trim()` antes de chequear vacío en `final` y añade `\n\n[Respuesta truncada por el límite de tokens]`. En `plan` con feedback/replan o `pending2`, `runner.ts` usa `sentReq.schema.maxItems` / objeto `rich`, mientras `qwen.ts` es rígido. |
| Reserva de tokens y construcción del body LLM | `eval/core/client/generative.ts:10-23,104-115,151-174` | `src/core/models/qwen.ts:279,354-413` | `client/generative.ts:10` duplica `MIN_COMPLETION_TOKENS = 256` (no exportado en `src/`) y **omite `keep_alive`** (`buildGenerativeBody` en `151-162` vs `buildRequestBody` en `qwen.ts:402`). Además, `reasoning_effort` en `qwen.ts:400` depende solo de `o.thinking`, mientras `client/generative.ts:161` permite `req.reasoningEffort`. |
| Preparación y chequeo de contexto en Decision | `eval/core/client/decision.ts:14,46-68`, `eval/core/runner.ts:254-260` | `src/core/models/decision.ts:61-68,148-167` | `client/decision.ts:54-57` **omite `keep_alive`** (`decision.ts:67` sí lo envía) y su `call()` no valida el límite `DECISION_MAX_CONTEXT` antes de enviar (lo delega a `runner.ts:254-260`). Si se llama a `DecisionClient` fuera de `runner.ts` (p. ej. `eval/exp/`), no protege el contexto. |
| Transporte `postJson` | `eval/core/client/generative.ts:48-101` | `src/core/models/transport.ts` | Duplica retry único en red/503, backoff y manejo de `AbortController`. `eval` no pasa `Accept`/`Authorization` ni usa `TransportError`/`LLMServiceUnavailableError`. |
| Pre-chequeo de argumentos con refs | `eval/core/runner.ts:141-145,500-516` | `src/core/engine/callRunner.ts:331-345,373-375` | `runner.ts:141-145` **elimina cualquier argumento** que contenga `{{ref:rN}}` antes de llamar a `precheckCall` (`argsWithoutRefs`), porque el eval no resuelve refs reales contra un `RefVault`. En producción `callRunner.ts:332,373` primero resuelve `resolveRefs` y luego ejecuta `precheckCall` sobre los textos reales (puede detectar valores inválidos/carpetas inexistentes tras resolver una ref). |
| Limpieza de `null` en parámetros opcionales de `args` | `eval/core/stages/generative.ts:102-108` | `src/core/models/qwen.ts:611-614` | Código idéntico copiado entre ambos archivos. |
| Extracción de etiquetas de Decision | `eval/core/variants/labels.ts:107-217` | `src/core/models/decision.ts:210-377`, `src/core/engine/verify.ts:42-57` | `labels.ts` re-implementa el mapeo de respuestas `choice`/`noul` para soportar `DecisionReaders`; ya importa `parseAnswersObject`, `validateAnswer`, `firstQueryKind`, `reviewOutcome`, `NOUL_APPROVE` desde `src/`, pero la lectura por clave está duplicada. |
| Inyecciones exclusivas de `scenario.ts` para `result_verification` | `eval/core/scenario.ts:411-422` | `src/core/engine/verify.ts:92`, `src/core/ctx/validate.ts:156` | `scenario.ts:420-421` inyecta `criterion.expected` en reactivo (rechazado por `validate.ts:156` en contexto real) y `request: at.lastItem ? sc.request : null` (que `verify.ts:92` nunca rellena). También mantiene `LEGACY_EVAL_TOOLS` (`"web:research"` en `scenario.ts:266-268`). |

### 5.2 Explicaciones verificadas en código sobre comportamientos del flujo real relevantes para el eval V2

1. **Poscondición en disco virtual (`verify.ts:86-90`, `postcondition.ts:36-73`):** si `call.status === "ok" && call.kind === "write"`, `verifyCall` evalúa `postconditionOf(call.tool, call.args)`. Para `write_file`, `create_directory` y `move_file` con rutas absolutas y sin `disk` inyectado, lee `REAL_DISK` (`fs.existsSync` / `fs.statSync`):
   - `create_directory` verifica `disk.exists(dir) && disk.isDirectory(dir)` (`postcondition.ts:40-44`).
   - `write_file` verifica que el archivo exista, no sea directorio y (si `mode !== "append"` y `content !== ""`) `disk.size(file) > 0` (`postcondition.ts:58-66`).
   - `move_file` verifica que `source` ya no exista y `destination` sí (o `path.join(destination, basename(source))` si es directorio) (`postcondition.ts:45-57`).
   Si el fixture MCP es puramente en memoria y no escribe en el disco real (o si `verifyCall` no recibe `DiskView`), devuelve `"unmet"` → `rejected (not_accomplished)` sin llamar nunca a `decision.verifyResult`.
2. **Tier verde salta D3 (`callRunner.ts:367-368,384-386,406`, `tiers.ts:40-69`):** con `approvalTiers() === true`, una escritura catalogada dentro de `home/desktop/documents/downloads` que crea un archivo/carpeta nueva sin sobrescribir ni caer en `guard.mandatory` ni `blacklist` recibe `tier = "green"`. Eso pone `askUser = false` (`385`) y salta D3 por `tier !== "green"` (`406`). En verde, la única barrera antes de aprobar es `guard` + `blacklist` + `precheckCall`, y después `postconditionOf` + `probes`.
3. **Colisión de ítems en `pendingList.ts` descubierta al probar el Escenario 2 (`src/core/engine/pendingList.ts:43-55,61-72`):** cuando dos ítems pendientes comparten un prefijo de ruta largo con palabras en mayúscula/números en carpetas comunes (p. ej. `/tmp/eval_v2_probe/workspace/Documents/ventas.txt` y `.../resumen.txt`), `stemsOf` + `proper` (`pendingList.ts:31-38,44-54`) producen un solapamiento de stems `>= 0.6` y al menos un `proper` compartido (`workspace`/`Documents`), por lo que `sameItem(a, b)` devuelve `true`. Al terminar el paso 1 (`settled.push(head)`), `reconcileList` puede descartar un ítem pendiente posterior distinto si los ítems contienen la ruta larga completa. Usando descripciones concisas (`"Leer ventas.txt de Documentos"`, `"Escribir total calculado en resumen.txt"`) `sameItem` da `false` y el flujo multi-paso funciona correctamente.
4. **Cierre y respuesta final (`finalize.ts:30-79`):** la respuesta final no depende solo de `FINAL_VIEW`: en fallos/cancelación/overflow de efectos/LLM caído (`55-71`) cae a `renderFallback`; cuando el modelo responde (`73-78`), `finalize` antepone `renderStatusNote` (si incompleta), limpia filler con `stripNoChangesFiller`, y añade `renderPlaceNote` si hubo escrituras rechazadas por `wrong_place`.

---

## 6. Prueba ejecutada: `runTask` real con clientes simulados y trazas

Para comprobar empíricamente la invocabilidad actual de `runTask` y los constructores de `src/` en este contenedor Linux, se creó un script fuera del repositorio en **`/tmp/eval_v2_probe/run_task_probe.ts`** y se ejecutó:

```bash
npx tsx /tmp/eval_v2_probe/run_task_probe.ts
```

**Resultado de ejecución:** exit code `0`, los **4 escenarios** pasaron y generaron artefactos completos de traza (`summary.md`, `trace.json`, `full.json.gz`, `index.jsonl`) en `/tmp/eval_v2_probe/traces/jarvis-traces/`.

### 6.1 Fricciones reales descubiertas al construir la sonda (antes de que pasara)
1. **Servidores MCP obligatorios en `DESTINATIONS` (`manifest.ts:76-96`, `callRunner.ts:157-170`):** registrar solo un servidor llamado `"files"` provocó que `availableRoutes` siguiera ofreciendo `"terminal"`/`"web"` o fallara con `Servidor MCP 'desktop_commander' no disponible`. Hubo que registrar explícitamente `"desktop_commander"`, `"jarvis_terminal"` y `"jarvis_web"` (los dos últimos devolviendo `[]`).
2. **Forma de `ProtectedPaths` (`guard.ts:45-50`):** `EngineDeps.guardScope` exige `{ protectedDirs, relativeBases }` completos (el compilador lo detectó).
3. **`parseSnapshot` no reexportado (`ctx/index.ts` vs `ctx/snapshot.ts:61`):** para validar/rehidratar snapshots hubo que importar `parseSnapshot` directo desde `src/core/ctx/snapshot.ts` y pasar `ContextLimits`.
4. **Nombre real de export en `stageRequests.ts:99`:** es `argumentsStageRequest` (no `argsStageRequest`).
5. **Colisión en `pendingList.ts` (§5.2 punto 3):** con rutas largas repetidas en ambos pendientes del Escenario 2, `reconcileList` descartaba el segundo pendiente.

### 6.2 Salida real observada por escenario

- **Escenario 1 — Reactivo `write_file` virtual sin disco real + `approvalTiers: true`:**
  - *Salida observada:* `task.state: partial stopReason: no_alternatives`, `calls: c1..c6` todas con `status=ok verdict=rejected reason=not_accomplished`, `counts: { verifyCalls: 0, reviewCalls: 0 }`.
  - *Qué demostró:* confirma empíricamente que sin inyectar `DiskView` en `verify.ts:87`, una escritura puramente en memoria falla `postconditionOf` 6 veces (3 pasos × 2 intentos hasta agotar `maxVerifyRejectionsPerStep` y `maxEscalations`) sin tocar D4 ni D3.

- **Escenario 2 — Reactivo multi-paso con disco en `/tmp`, `RefVault` real, D5 (`checkCompletion`), `TaskTraceRecorder` y rehidratación:**
  - *Salida observada:* `task.state: completed stopReason: null`, `refs: 1`, `calls: c1:read_file=approved, c2:write_file=approved`, `counts: { verifyCalls: 1, reviewCalls: 0 }`, `rehydrated.task.state: completed`.
  - *Trazas reales invocadas por `runTask`:* `firstQuery("multi")` → `pending(#1)` → `chooseRoute([files])` → `chooseTool(read_file)` → `generateArgumentsFromView(priorAttempts=0)` → `verifyResult(#1, known={"ok":1}, hasRequest=false)` → `chooseRoute` → `chooseTool(write_file)` → `generateArgumentsFromView` → **3 consultas `decision.probe`** (`PLACE_PROBE` × 2 + `POSITION_PROBE` × 1 tras `postconditionOf === "met"`) → `checkCompletion` → `generateFinalFromView(viewChars=3122)`.
  - *Qué demostró:* `runTask` + `RefVault` + `TaskTraceRecorder` + `parseSnapshot`/`create.fromSnapshot` funcionan de extremo a extremo sin tocar `src/`, y confirma en vivo que `verifyResult` llega con `known: { ok: 1 }` y **sin** `request` (`hasRequest=false`).

- **Escenario 3 — Deliberativo con rechazo del usuario al plan + fallo de pre-chequeo por carpeta inexistente + aprobación manual:**
  - *Salida observada:* `task.state: completed stopReason: null`, `plans: 2`, `steps: 4`, `calls: c1:read_file:ok:approved, c2:write_file:args_invalid:-, c3:write_file:ok:approved`.
  - *Eventos observados:* `generatePlanFromView(initial)` → `runtime.wait(plan)` (rechazado con feedback) → `generatePlanFromView(user_feedback)` → `runtime.wait(plan)` (aprobado) → `read_file` → `write_file` a subcarpeta inexistente bloqueado por `checkParentFolder` (`args_invalid`, `c2`) → reintento con `priorAttempts=1` → `runtime.wait(approval)` (`autoMode=false`) → `3 × decision.probe` → `generateFinalFromView(viewChars=3368)`.
  - *Qué demostró:* valida `TaskRuntime` (`resolvePlanApproval`, `resolveApproval`), Feedback de plan (`trigger=user_feedback`), `checkParentFolder` determinista y `priorAttempts=1` en el flujo real.

- **Escenario 4 — Invocación aislada de `renderArgsView` / `argsInput` / `argumentsStageRequest`, `renderFinal` / `finalStageRequest` y `verifyInput` con variantes reales:**
  - *Salida observada:*
    - `args(read_file) system chars prod vs ctx_args_by_tool: 966 vs 966`
    - `args(web_search) user has ENV prod vs ctx_args_by_tool: true vs false`
    - `final user chars prod vs ctx_final_clean: 205 vs 241 | clean adds Spanish instruction: false`
    - `verifyInput keys: criterion,call,done,userInput,recent | request field present: false`

---

## 7. Cambios propuestos a `src/` (SOLO DESCRITOS — NO implementados)

Todos los cambios preservan los invariantes (`Guard` obligatorio antes de ejecutar, `ctx.apply` única puerta de escritura, un solo `finalize` en `runTask`, y cero imports desde `eval/` en `src/`) y dejan el comportamiento por defecto idéntico si no se pasan opciones. Ordenados de **mayor valor / menor riesgo** a mayor impacto:

1. **Propagar `disk?: DiskView` y `analyzeCommand?: CommandAnalyzer` en `EngineDeps` (`src/core/contracts.ts`, `verify.ts`, `callRunner.ts`, `precheck.ts`)** — *Valor: Alto | Riesgo: Mínimo.*
   - `postconditionOf` (`postcondition.ts:36`) y `approvalTierOf` (`tiers.ts:40`) ya reciben `DiskView`/`TierDisk`, y `precheckCall` (`precheck.ts:375`) ya recibe `CommandAnalyzer`. Solo falta que `EngineDeps` exponga opcionalmente `disk?: DiskView` y `analyzeCommand?: CommandAnalyzer` (y opcionalmente un `readRef` en `precheck.ts:99` si la ref no vive en archivo plano) y que `verify.ts:87` y `callRunner.ts:368,373` los pasen con fallback a `REAL_DISK`/`analyzePowerShell`. Beneficia directamente a los tests unitarios de `src/` además de desbloquear MCPs virtuales en eval encadenado.

2. **Exportar `parseSnapshot` desde `src/core/ctx/index.ts`** — *Valor: Medio | Riesgo: Nulo.*
   - Hoy vive en `src/core/ctx/snapshot.ts:61` pero no se reexporta en `src/core/ctx/index.ts`. Facilita rehidratar trazas y snapshots en `eval/` y tests sin importar internos de `ctx/`.

3. **Extraer helpers/parámetros compartibles en `src/core/models/` sin romper `QwenEngine` ni `Decision20Engine`** — *Valor: Alto | Riesgo: Bajo.*
   - Exportar `MIN_COMPLETION_TOKENS`, `reserveCompletionTokens` y `buildGenerativeBody` (equivalente a `buildDecisionRequest` de `decision.ts:61`) para que `eval/core/client/*` no los duplique (`eval/core/client/generative.ts:10,19,151`).
   - Permitir en `stageRequests.ts` un parámetro opcional `StageParamsOverride` (`temperature`, `maxTokens`, `thinking`, `schema`) con default idéntico al actual, y opcionalmente aceptar en `QwenEngine`/`Decision20Engine` constructores de opciones (`{ params?, read?, today?, quiet? }`) manteniendo el comportamiento actual por defecto intacto.

4. **Inyectar `now?: () => Date` (para `TODAY`) en constructores de prompts / `StageConfig`** — *Valor: Medio | Riesgo: Bajo.*
   - `todayLine(now = new Date())` (`prompts.ts:32`) ya acepta `Date`, pero `ARGUMENTS_VIEW`, `PLAN_VIEW` y `FINAL_VIEW` llaman `todayLine()` sin argumentos. Pasar `now` opcional permite reproducibilidad exacta de snapshots históricos entre fechas distintas.

5. **Decidir y unificar `VerifyDecisionInput.request` (y `expected` en reactivo si aplica)** — *Valor: Medio | Riesgo: Bajo-Medio.*
   - Si no se quiere soportar `d4_request_done` / `A1-A2` en producción, documentar su retiro en `eval/`; si sí se quiere evaluar o activar, cablear explícitamente la decisión en `verify.ts:92` en lugar de que `scenario.ts:421` inyecte un campo que producción nunca manda.

6. **Hook opcional para `FragmentJudge` / `CaptureSink` en `WebSearchProvider` y umbrales configurables** — *Valor: Bajo-Medio | Riesgo: Medio.*
   - Permitir un wrapper/tracer opcional de `FragmentJudge` (sin que `src/tools/` importe `engine/` ni `trace/`, cumpliendo `tests/architecture.test.ts:36-44`) o exponer una etapa limpia `buildFragmentJudgeInput` en `adapters`.
   - Agrupar umbrales (`NOUL_APPROVE`, `REVIEW_APPROVE`, `COMPLETION_APPROVE`, `FIRST_QUERY_*`, `BUDGET`) en un objeto `thresholds` inyectable si el eval V2 va a optimizar umbrales en modo encadenado (hoy solo `close_check.ts` y `firstQuery` evalúan umbrales fuera de `BUDGET`).

---

## 8. Opciones de arquitectura y decisiones clave

El modo dataset existente (`eval/cli.ts` + `eval/core/runner.ts` + `eval/datasets/*.jsonl`) permanece **100 % intacto** en todas las opciones.

### Comparativa de 3 opciones para el «modo Jarvis real»

- **Opción A — Sub-módulo independiente paralelo dentro de `eval/real/`**
  - *Cómo funciona:* nuevos ejecutores `runRealStage` y `runRealTask` en `eval/real/` que consumen snapshots y usan `QwenEngine`/`Decision20Engine` directo con `DiscoveryEngine` de fixtures.
  - *Pros:* cero impacto en `runner.ts` y `client/*`; muy rápido de iterar para modo encadenado.
  - *Contras:* **agrava las duplicaciones** (§5.1): el modo dataset seguiría usando `eval/core/client/*` + `runner.ts` mientras el modo real usaría `QwenEngine`/`Decision20Engine`; un cambio de transporte o validación podría pasar en un modo y fallar en el otro.

- **Opción B — Capa de núcleo compartido en `eval/core/` + adaptadores por modo (RECOMENDADA)**
  - *Cómo funciona:*
    1. **Unificar motor ↔ eval:** `eval/core/client/*` reusa los helpers exportados de `src/core/models/` (`reserveCompletionTokens`, `buildDecisionRequest`, `buildGenerativeBody`) y `Variant` provee un helper `applyVariantPrompts(variant)` (`{ ...PROMPTS, ... }`, `{ ...DECISION_PROMPTS, ... }`).
    2. **Modo real aislado por etapa (`--source=real-stage` o script/subcomando dedicados):** carga un snapshot (`trace.json` / `TaskContext` rehidratado con `parseSnapshot` + punto de captura de etapa `{ callId | route+tools | candidate | previous }`), materializa exactamente el mismo `StageRequest` / `DecisionInput` que `src/` usando `ctx.view.*` + `adapters.ts` + `stageRequests.ts` + `DECISION_PROMPTS`, y pasa por el mismo pipeline de clientes, `parseOutput`, `graders` y `RunRecord`/`scoring.ts` que hoy usa el modo dataset.
    3. **Modo real encadenado (`--source=real-task`):** ejecuta `runTask(ctx, runtime, deps)` usando `QwenEngine` + `Decision20Engine` (con `applyVariantPrompts(variant)` y opcionalmente `params`/`read`), un `DiscoveryEngine` respaldado por fixtures de herramientas + `DiskView` virtual o directorio temporal aislado + política de `TaskRuntime` (auto-aprobación / respuestas scripted), y gradúa el `TaskContext` final + `TaskTraceRecorder` (cumplimiento de estado terminal, llamadas aprobadas, ausencias de loops, invariantes, y opcionalmente métricas por etapa extraídas de la traza).
  - *Pros:* cero duplicación entre `src/` y `eval/`; comparte reportes, hashes, `RunRecord` y comparación de variantes entre modo dataset y modo real por etapa; cambios en `src/` rompen tipos en build en ambos modos.
  - *Contras:* requiere pequeños refactorings previos en `src/core/contracts.ts` y `src/core/models/` (§7 puntos 1–4).

- **Opción C — Todo `eval/` montado encima de `QwenEngine` y `Decision20Engine` mediante `fetch` interceptor**
  - *Cómo funciona:* reemplazar `client/generative.ts` y `client/decision.ts` por instancias reales de `QwenEngine`/`Decision20Engine` incluso para datasets, interceptando respuestas para `--dry-run`, `mock` y `oracle`.
  - *Pros:* paridad 100 % garantizada de `rawInput` y reintentos entre dataset, real aislado y encadenado.
  - *Contras:* demasiado invasivo en esta fase; `eval/core/runner.ts` requiere medir métricas por intento, `tokensEstimated`, `retryThinking`, `params` y variantes `read:`/`pending2` que hoy `QwenEngine`/`Decision20Engine` rechazarían sin cambios profundos en `src/`.

### Respuestas explícitas a las 5 preguntas de arquitectura

1. **¿Cómo separar datos de escenario/snapshot vs variantes de prompts en el modo real por etapa?**
   - Igual que hoy hace `eval/core/scenario.ts`, pero ampliado a **`ContextSnapshot` + `StageTarget`**:
     - El **caso** guarda únicamente datos puros e independientes del prompt: bien un `Scenario` existente o bien un `ContextData` congelado (`trace.json` → `snapshot`, migrado si hace falta) + el puntero del punto de decisión (`route` con `routes`/`tools`, `args` con `tool`/`priorAttempts`/`memory`, `verify` con `callId`, `review` con `candidate`, `probe` con `callId`, `completion`, `d0`, `continuation`, `final` con `thread` opcional) + el `expect`. Nunca guarda `system`, `user` ni `state` pre-renderizados.
     - La **variante** aporta solo `Variant` (`PROMPTS`, `DECISION_PROMPTS`, y cuando aplique `params`/`read`).
     - En tiempo de carga/ejecución, un `materializeRealStage(snapshot, target, variant)` rehidrata `create.fromSnapshot(parsed)` y ejecuta la tubería real de `src/` (`ctx.view.*` → `adapters.ts` → `stageRequests.ts` / `DECISION_PROMPTS`) con `effectivePrompts(variant.prompts)`.
2. **¿Cómo garantizar chequeos de build/tipos cuando cambian firmas en `src/`?**
   - Confirmar en `tsconfig.json` que `npm run lint` (`tsc --noEmit`, `package.json:15`) typecheckea tanto `src/` como `eval/` y `tests/` bajo `strict`.
   - Prohibir los casts evasivos en la frontera (`as any` o `as unknown as`) en los adaptadores nuevos del eval real; tipar el runner real directamente contra `EngineDeps`, `VerifyDecisionInput`, `ArgsFromViewInput`, etc., de `src/core/contracts.ts`. Así cualquier cambio en un contrato o vista en `src/` rompe `npm run lint` en compilación antes de correr nada.
3. **¿Cómo diseñar tests de paridad `src/` ↔ `eval/`?**
   - Añadir tests deterministas (sin red, bajo `tests/` en `npm test`) que construyan un `TaskContext` no trivial (con pasos, llamadas fallidas, `ref`, `facts`, `userInput`, efectos) y verifiquen:
     - **Paridad de payload por etapa:** para la variante `prod`, el `PreparedRequest` (`url` y `body` JSON exacto salvo `keep_alive` si se unifica) que genera `eval/` coincide con el que envía `QwenEngine` / `Decision20Engine` (capturando con servidor HTTP loopback local o transport stub).
     - **Paridad de validadores y umbrales:** `validateArgs`, `parsePlanSteps`, `parsePendingList`, `firstQueryKind`, `reviewOutcome`, `verdictOf` y `postconditionOf` producen el mismo resultado en ambos lados.
4. **¿Cómo incluir un smoke test de `runTask` encadenado con mocks en `npm test`?**
   - Replicar el patrón probado en `/tmp/eval_v2_probe/run_task_probe.ts` como test rápido en `tests/` (usando `EngineLLM` e `IActionDecision` deterministas en memoria + `DiscoveryEngine` fake con los 3 servidores de `DESTINATIONS` + `RefVault` en `os.tmpdir()` + `DiskView` in-memory una vez inyectado en §7.1), cubriendo al menos:
     - 1 tarea **reactiva multi-paso** con `ref` grande, `postconditionOf` (`write_file`), `probe`, `checkCompletion` (D5) y `TaskTraceRecorder` + rehidratación con `parseSnapshot`.
     - 1 tarea **deliberativa** con rechazo de plan (`user_feedback`), `precheckCall`, espera de aprobación (`TaskRuntime`) y cierre `completed`.
   - Sin red ni Ollama ni PowerShell real: tarda < 200 ms y detecta inmediatamente cualquier rotura en las costuras de `runTask`.
5. **¿Cómo manejar migraciones de snapshots cuando evoluciona `CONTEXT_VERSION` (`src/core/ctx/snapshot.ts`)?**
   - Hoy `CONTEXT_VERSION` se valida estrictamente en `src/core/ctx/snapshot.ts:63-65`: si `raw.v !== CONTEXT_VERSION`, lanza `ContextError("snapshot_version")`.
   - En `eval/` (fuera de `src/`, para que producción siga estricta y limpia), introducir un registro `migrateSnapshot(raw): ContextData` ordenado por versión (`v -> v + 1`) antes de llamar a `parseSnapshot(migrated, limits)`: si `raw.v === CONTEXT_VERSION` pasa directo; si es menor, aplica migradores declarativos explícitos (p. ej. añadir campos obligatorios nuevos con su default o `null`); si no existe migrador (o es versión desconocida), **falla de forma ruidosa** en carga indicando versión encontrada vs esperada.

---

## 9. Riesgos y preguntas abiertas para el usuario

1. **Estrategia de efectos y sistema de archivos en el modo encadenado:**
   - ¿El harness encadenado usará un **directorio sandbox en disco temporal** por caso (reemplazando `home/desktop/documents/downloads` en `environment` y con `guardScope` apuntando al sandbox) o prefieres herramientas simuladas 100 % en memoria con `DiskView` virtual inyectado en `EngineDeps`? *(Nota: `run_command` real contra SO tiene efectos externos difíciles de virtualizar sin fixtures por comando).*
2. **Aprobaciones del usuario (`TaskRuntime`) durante corridas encadenadas automáticas:**
   - En tareas reales sin humano delante, cuando `guard.mandatory`, `tier === "red"` o `ask_user` pausa el flujo: ¿el evaluador debe tener un **respondedor scripted por caso** (aprobar/rechazar/contestar `userInput` según fixture), o forzar `autoMode: true` / `approvalTiers: true` sabiendo que rutas sensibles / comandos seguirán pidiendo aprobación?
3. **Fuente de verdad para el modo real por etapa:**
   - ¿Prefieres extraer casos reales directamente desde carpetas `jarvis-traces/*/trace.json` (rehidratando `snapshot` en el `n` previo a cada llamada a modelo) o definir escenarios ejecutables que corran `runTask` hasta cierto punto para congelar las vistas? *(Nota: `trace.json` guarda el snapshot **al terminar** la tarea; para reconstruir el `TaskContext` exacto del instante `n` de una consulta intermedia de la traza habría que o bien guardar snapshots por paso/evento o filtrar elementos con `at <= timestamp` / capturar vía `TaskTraceRecorder`).*
4. **Prioridad de las 7 variantes especiales (`4` `read:` + `3` `params.pending.schema`) y de `d4_request_done`:**
   - ¿El modo real encadenado necesita soportar variantes que cambian claves o esquema de JSON (`d4_keys_a`, `pending2*`, `fragment_judge_*`), o esas experimentaciones se mantienen solo en el modo dataset hasta que una gane y entre a `src/`?
5. **`fragment_judge` dentro o fuera del motor:**
   - ¿Quieres incorporar `fragment_judge` (con su prefijo `TODAY:` y `[source date: ...]`) como una etapa más capturable vía `CaptureSink` / `EngineDeps` en `src/`, o evaluarla únicamente aislada / vía fixture de `web_search`?
6. **Bug menor detectado en `src/core/engine/pendingList.ts:43-55`:**
   - Como se observó en §5.2 y §6 (Escenario 2), cuando dos ítems pendientes distintos incluyen rutas largas en el mismo directorio (`.../Documents/a.txt` y `.../Documents/b.txt`), `sameItem` los puede considerar el mismo ítem (`>= 0.6` de stems compartidos + carpeta en `proper`). Conviene confirmar si deseas abrir un fix separado para esto en `src/`.
