# Auditoría del Módulo `eval`

> Documento vivo de auditoría técnica (solo lectura sobre el código fuente).
> Última actualización: **2026-11-21** (**Pasada 3**).

---

## 1. Resumen ejecutivo

El módulo `eval` cuenta con una arquitectura modular sólida (registro enchufable de 14 etapas en `eval/core/stages/`, fachada única de integración en `eval/core/contract.ts`, aislamiento de lotes por worker para `--auto`, caché en streaming para JSONL y herramientas dedicadas como `eval:cross`, `eval:psvalid` y `eval:traces`). Tras completar la **Pasada 3** (creación de dataset y variante integrales cubriendo las 14 etapas):

- **Entregables de Pasada 3 (`CONFIRMADO` sin modelos reales):** creados `eval/datasets/integral_v1.jsonl` (**280 casos**, exactamente **20 por etapa** y **0** casos `raw` o `prod_shortcut`) y `eval/variants/integral_v1.ts` (5 vistas generativas + 9 constructores de decisión). Validados con `npm run lint` (`0` errores), `--list` (`280 casos`), `--dry-run` (`560` requests `POST` con salida `0`), y corrida completa en memoria con `runDataset`: **`280/280` en verde con `--client=oracle` (`prod`)** más `20/20` en `postCheck` de `arguments` en Linux.
- **Nuevo hallazgo (`EV-025`, Alta / CONFIRMADO):** `eval/core/scenario.ts` impide materializar casos de `plan` con `TRIGGER: initial` en modo `deliberative`, ya que crea incondicionalmente un registro en `plans` y un paso por defecto con `instruction: ""`; todo caso deliberativo de `plan` queda forzado a `user_feedback` o `step_failure`.
- **Seguridad y desalineaciones previas (`EV-001`..`EV-024`):** se mantiene `EV-001` (**Media** local / **Crítica** ante trazas externas o `--optimizer-url` remoto) y los hallazgos abiertos de `args_review` (`EV-018`), truncado en `continuation`/`pending` (`EV-012`), `powershell.exe` en Linux (`EV-002`) y los 7 fixtures fugados previamente en `eval/datasets/` (`EV-013`/`EV-023`).

### Conteo de hallazgos por severidad

| Severidad | Cantidad | IDs |
|---|---:|---|
| Crítica *(Esc. B/C; Media en local)* | 1 | `EV-001` |
| Alta | 12 | `EV-002`, `EV-003`, `EV-004`, `EV-010`, `EV-013`, `EV-016`, `EV-017`, `EV-018`, `EV-019`, `EV-020`, `EV-023`, `EV-025` |
| Media | 8 | `EV-005`, `EV-006`, `EV-007`, `EV-008`, `EV-011`, `EV-012`, `EV-021`, `EV-022` |
| Baja | 4 | `EV-009`, `EV-014`, `EV-015`, `EV-024` |
| **Total** | **25** | **`EV-001` .. `EV-025`** |

---

## 2. Alcance de esta pasada

### Qué se revisó directamente (Pasada 1 + Pasada 2)
- **Configuración y manifiestos:** `package.json`, `npm ls --depth=0`, `ls -la --full-time eval/datasets/` y `eval/auto/fixtures/datasets/`.
- **Entrypoints y scripts:** `eval/cli.ts`, `eval/auto.ts`, `eval/cross.ts`, `eval/psvalid.ts`, `eval/traces.ts`, `eval/exp/d0_rules.ts`, `eval/exp/noul_cuts.ts`.
- **Núcleo (`eval/core/`):** `batch.ts`, `case.ts`, `config.ts`, `contract.ts`, `datasets.ts`, `io.ts`, `questions.ts`, `report.ts`, `report-format.ts`, `report-types.ts`, `results.ts`, `runner.ts`, `scenario.ts`, `scoring.ts`, `traces.ts`, `client/{decision,generative,mock,oracle}.ts`, `variants/{labels,load,types}.ts`.
- **Todas las etapas (`eval/core/stages/`):** `index.ts`, `shared.ts`, `types.ts`, `d0.ts`, `d5.ts`, `route.ts`, `tool_choice.ts`, `args_review.ts`, `result_verification.ts`, `recovery.ts`, `plan.ts`, `arguments.ts`, `final.ts`, `question.ts`, `continuation.ts`, `fragment_judge.ts`, `pending.ts`.
- **Todos los graders (`eval/core/graders/`):** `common.ts`, `arguments.ts`, `final.ts`, `label.ts`, `pending.ts`, `plan.ts`, `question.ts`.
- **Optimizador autónomo (`eval/auto/`):** `batchRunner.ts`, `batchWorker.ts`, `conclusions.ts`, `config.ts`, `discover.ts`, `ephemeralVariant.ts`, `feedback.ts`, `optimizer.ts`, `ranking.ts` (1–418), `stageContract.ts` (1–884), `tsScanner.ts`, `validateVariant.ts`.
- **Fixtures (`eval/auto/fixtures/`):** `datasets/*`, `variants/recovery_three_options_nobehind.ts.txt`.
- **UI y datasets:** `eval/ui/{order,style,wizard}.ts`, `eval/ui/views/{comparison,help,list,run}.ts`, `eval/datasets/smoke.jsonl`.
- **Contraparte `src/`:** `src/core/budget.ts`, `src/core/engine/{callConfirm,classify,precheck,thread}.ts`, `src/core/models/{decision,qwen}.ts`, `src/core/types/routes.ts`.
- **Tests completos:** `eval/core/eval_core.test.ts`, `eval/auto/eval_auto.test.ts`, `tests/eval_arguments.test.ts`, `tests/noul_cuts.test.ts`.
- **Documentación:** `eval/README.md`, `eval/INSTRUCCIONES.md`, `eval/GUIA_DECISION.md`, `docs/evaluacion/desalineaciones-eval.md`, `docs/pendientes/PENDIENTES_EVAL.md`.

### Comprobaciones no destructivas ejecutadas en Pasada 2
1. **`npm run lint` (`tsc --noEmit`):** completado con **0 errores** de compilación TypeScript.
2. **`npx tsx eval/cli.ts --dataset=smoke --dry-run --limit=1`:** salida **`0`** (confirma discrepancia con `eval/INSTRUCCIONES.md:110` que documenta código `2`).
3. **`npx tsx --test eval/core/eval_core.test.ts eval/auto/eval_auto.test.ts tests/eval_arguments.test.ts tests/noul_cuts.test.ts`:** **51 pruebas / 12 suites → 49 pasaron, 2 fallaron** (ambas en `tests/eval_arguments.test.ts:84`: `sintaxis PowerShell inválida` y `comando que no existe`, por `true !== false`).
4. **Sonda en memoria de escape para `EV-001` (`npx tsx -e`, sin escrituras a disco):**
   - Dentro de `evaluateCjsVariantModule` con `vm.runInNewContext`: `({}).constructor.constructor("return typeof process")()` devolvió **`"undefined"`** (aislado en realm VM) y un cierre con `globalThis["pro"+"cess"]` devuelto al host también evaluó **`"undefined"`**;
   - **Perforación reproducida 1:** `PROMPTS.constructor.constructor("return typeof process")()` (objeto importado de `../../../../src/core/models/prompts.ts`) y `exports.constructor.constructor("return typeof process")()` devolvieron **`"object"`** (acceso al `Function` del proceso host);
   - **Perforación reproducida 2:** en `evaluateCjsVariantModule` sin `validateSpecifier` (tal como llama `loadVariantSpecEphemeral`), `require("node:fs").readFileSync` resultó **`"function"`**.
5. **`grep -rnE "parsePlanSteps|dotenv|decision_all_stages_example" eval/ src/ tests/`:** confirmó `0` importadores de `eval/core/contract.ts:parsePlanSteps`, `0` usos de `dotenv` en todo el repo, y referencias exclusivas a `decision_all_stages_example` en `discover.ts` e `INSTRUCCIONES.md`.
6. **`ls -la --full-time eval/datasets/` y `npm ls --depth=0 --json`:** reveló 7 copias residuales de `eval/auto/fixtures/datasets/*.jsonl` (`2026-11-21 18:08:52`) junto a `smoke.jsonl` (`17:01:40`), y versiones instaladas `typescript@7.0.2`, `esbuild@0.28.2`, `tsx@4.23.15`, `@types/node@22.20.5`, `dotenv@17.4.2`.

### Qué NO se revisó (o no verificó)
- Contenido interno de `jarvis-traces/**` (incluyendo los `.json.gz` binarios) ni el detalle completo de `jarvis-config.json`.
- Pruebas del directorio `tests/*.test.ts` ajenas a `eval` (más allá de `eval_arguments.test.ts` y `noul_cuts.test.ts`).
- Ejecución en vivo en **Windows (`powershell.exe`)** ni contra un servidor **Ollama** real (detalladas en la Sección 6).

---

## 3. Hallazgos, agrupados por categoría

### 3.1 Seguridad y aislamiento (`eval/auto`)

#### `EV-001` — Escape de `node:vm` vía objetos del host y ausencia de `validateSpecifier` en `loadVariantSpecEphemeral`
- **Severidad:** Crítica *(en Escenarios B y C)* / Media *(en Escenario A)*
- **Estado:** CONFIRMADO *(escapes por `exports`/`PROMPTS` y `loadVariantSpecEphemeral` reproducidos; salto por índice/corchetes en escaneo léxico CONFIRMADO; resto de vectores en prompts de host PROBABLE)*
- **Ubicación:** `eval/auto/validateVariant.ts:31-42, 110-141, 657-680, 744`; `eval/auto/ephemeralVariant.ts:23-49, 69`; `eval/auto/optimizer.ts:278-279, 368-371`; `eval/auto/batchRunner.ts:80-83`
- **Descripción:** **Modelo de amenaza:**
  - *Escenario A (uso local actual: `--optimizer-model` Ollama local, desarrollador y trazas locales confiables):* riesgo **Media** (alucinaciones o efectos colaterales accidentales al validar código TS).
  - *Escenario B (trazas/datasets con contenido web o de archivos externos procesados por `optimizer.ts:278-279` en `inputCompact`/`rawOutput` → Prompt Injection indirecta al generador TS)* o *Escenario C (`--optimizer-url` apuntando a un servicio remoto/externo):* riesgo **Crítica** (RCE en el proceso Node del host con acceso a FS, red y `process.env`, incluida la clave `--optimizer-api-key-env`).
- **Evidencia:**
  1. **Reproducido (`CONFIRMADO`):** en nuestra sonda en memoria, `({}).constructor.constructor` y `globalThis` dentro de `vm.runInNewContext` (`ephemeralVariant.ts:39-47`) permanecen aislados en el realm de la VM (`typeof process === "undefined"`). Sin embargo, `ephemeralVariant.ts:43` inyecta `exports` (creado en el host) y `ephemeralVariant.ts:34` resuelve módulos de `src/core/**` con `hostRequire` (objetos del host): tanto `exports.constructor.constructor("return typeof process")()` como `PROMPTS.constructor.constructor("return typeof process")()` retornaron **`"object"`**, burlando el aislamiento de `node:vm`.
  2. **Reproducido (`CONFIRMADO`):** el escaneo léxico de `validateVariant.ts:668-677` omite `BANNED_IDENTIFIERS` precedidos por `.` o `?.` (`foo.eval`, `foo?.process`) y literales por corchetes (`obj["eval"]`), dejando pasar el ataque en fase estática.
  3. **Reproducido (`CONFIRMADO`):** `loadVariantSpecEphemeral` (`ephemeralVariant.ts:69`) invoca `evaluateCjsVariantModule(cjsCode, filePath)` **sin** `validateSpecifier`, permitiendo `require("node:fs")` (`hasReadFileSync: "function"`) al recargar variantes en `discoverStageVariants`, `batchRunner.ts:80` o `--seed-top` (`auto.ts:357`).
  4. **Contexto host en ejecución de prompts (`PROBABLE`):** las funciones exportadas (`Variant.prompts`) se ejecutan en el host al materializar `loadDatasets` (`validateVariant.ts:744`, `batchRunner.ts:83`); aunque sus globales directos siguen ligados al `globalThis` de la VM, cualquier objeto pasado desde el host en tiempo de llamada vuelve a exponer `.constructor.constructor`.
- **Remediación sugerida:** Compilar y evaluar variantes generadas en un subproceso/worker con permisos restringidos sin acceso a FS/red/env y pasar siempre `validateImportSpecifier` en `loadVariantSpecEphemeral`.

---

### 3.2 Bugs y casos borde

#### `EV-002` — Fallo silencioso sin `powershell.exe` en `postCheck` y `eval:psvalid`; 2 tests fallan en Linux y `--client=oracle` omite `postCheck`
- **Severidad:** Alta
- **Estado:** CONFIRMADO *(bugs de código y fallo en Linux)* / NO VERIFICADO *(comportamiento real en Windows con `powershell.exe`)*
- **Ubicación:** `src/core/engine/precheck.ts:366-377`; `eval/core/stages/arguments.ts:157-170`; `eval/core/runner.ts:432`; `eval/psvalid.ts:35-37, 57-60`; `tests/eval_arguments.test.ts:77-78, 84-88`
- **Descripción:** Debe separarse **(a) bug real de código** de **(b) limitación del entorno Linux**:
  - **(a) Bugs de código (`CONFIRMADO`):** `analyzePowerShell` (`precheck.ts:368-376`) captura todo error de `execFileAsync("powershell.exe", ...)` (incluyendo `ENOENT`) y retorna `null`; con ese `null`, `argumentsStage.postCheck` (`arguments.ts:169`) marca `precheck_ok = true` aprobando sintaxis rota o cmdlets inventados sin error ni aviso; `eval/psvalid.ts:36` cuenta `report !== null` dando `0 % (0/N)` comandos válidos sin detectar la ausencia del binario, y además `psvalid.ts:57` omite filtrar `r.iteration === 1` y `r.bucket === "canonical"`; finalmente `runner.ts:432` solo corre `entry.postCheck` cuando `cfg.client === "real"`, dejando sin validar `postCheck` bajo `oracle` o `mock`.
  - **(b) Limitación de entorno Linux (`CONFIRMADO`) y comportamiento esperado en Windows (`NO VERIFICADO`):** el contenedor Linux carece de `powershell.exe`, lo que dispara el bug (a) y hace fallar 2/51 tests (`tests/eval_arguments.test.ts:84`: `sintaxis PowerShell inválida` y `comando que no existe`). En Windows (`win32`) con `powershell.exe` presente en `PATH`, `precheck.ts:293-343` debería ejecutar el parser AST + `Get-Command` y rechazar ambos comandos devolviendo un `finding` no nulo (`NO VERIFICADO` en vivo).
- **Remediación sugerida:** Propagar o distinguir el error de binario ausente (`ENOENT`) desde `analyzePowerShell` para fallar/advertir en `psvalid.ts`, `postCheck` y tests, y filtrar `psvalid.ts` a `iteration === 1` y `bucket === "canonical"`.

#### `EV-003` — Crash no capturado en `eval/cross.ts` y errores en parseo de runs, buckets, colisiones y códigos de salida
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/cross.ts:87-103, 128-134, 174, 186, 303, 314-319, 387-388, 403`; `eval/psvalid.ts:46, 68`
- **Descripción:** `eval/cross.ts` reimplementa de forma frágil la carga de datasets y resultados, provocando excepciones no capturadas ante rutas legacy/desconocidas y métricas incorrectas en D3 y D4.
- **Evidencia:**
  1. `precheckRows` (`cross.ts:128`) invoca `getToolPolicy(serverOf(route), tool)` **fuera** del `try/catch` (`130-134`): cualquier ruta inválida o legacy (p. ej. `"files"`) lanza fuera de captura.
  2. `loadCases` (`87-103`) lee JSONL manualmente, descarta líneas corruptas sin fallo (`96-98`) y omite `materializeScenario`/`validateCase`.
  3. `loadRuns` (`174`), `d4Report` (`303`) y `eval/psvalid.ts:46` parten `<variante>__<dataset>` por `lastIndexOf("__")`, rompiendo si el nombre del dataset contiene `__`.
  4. `loadRuns` (`186`) y `d4Report` (`314-317`) no filtran `r.bucket === "canonical"`, y `d4Report` (`317`) mete en `v.bad` registros con `r.expectedLabel === null` (p. ej. llamadas fallidas sin etiqueta).
  5. `cross.ts:387-388` usa timestamp truncado al minuto (`slice(0, 16)`) sobrescribiendo archivos en ejecuciones dentro del mismo minuto; `cross.ts:403` y `psvalid.ts:68` salen con código `1` en error de CLI en lugar de `2`.
- **Remediación sugerida:** Reutilizar `loadDatasets` en `cross.ts`, mover `getToolPolicy(serverOf(...))` dentro del `try/catch`, filtrar `bucket === "canonical"` (y `expectedLabel !== null` en D4) y añadir sufijo único en `_cross/`.

#### `EV-004` — `eval/auto.ts` con `--seed-top` sin caché pasa métricas `0% (0/0)` al optimizador y nunca evalúa `--target` en Vuelta 0
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/auto.ts:217-228, 352-378, 399-435, 481-484`
- **Descripción:** Con `--seed-top` y sin caché previo compatible, el bucle omite Vuelta 0 e inyecta estadísticas vacías falsas al optimizador; sin `--seed-top`, nunca corta aunque una variante activa ya cumpla `--target` en Vuelta 0.
- **Evidencia:** Si `cfg.seedTop.length > 0` y `scanReusableInitialRanking` retorna `null` (`auto.ts:367-378`), se omite Vuelta 0 dejando `lastRanked = []`, `lastStats = []` y `lastFailureSamples = []`; en Vuelta 1 (`482-483`), `buildTop2Contexts` fabrica resúmenes falsos con `score: 0, passedRuns: 0, totalRuns: 0` (`217-228`) y cero fallos. En la ruta normal (`399-435`), si una variante `!= prod` ya supera `cfg.target`, no se comprueba ni `--holdout` antes de generar nuevas variantes en Vuelta 1.
- **Remediación sugerida:** Ejecutar Vuelta 0 real si `--seed-top` no halla caché compatible y verificar `--target` (+ `--holdout`) al cerrar Vuelta 0.

#### `EV-005` — Alertas de holdout y rondas inválidas se recortan al compactar `conclusiones.md`
- **Severidad:** Media
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/auto/conclusions.ts:51-65, 244-246, 284-286`; `eval/auto.ts:663, 678-700`
- **Descripción:** Las notas agregadas al final de `conclusiones.md` desaparecen silenciosamente si el archivo alcanzó el límite de líneas o caracteres.
- **Evidencia:** `recordHoldoutOverfitAlert` (`conclusions.ts:244-246`) y `recordInvalidRoundNote` (`284-286`) agregan líneas al final (`lines.push(...)`) antes de pasar por `compactMarkdownToLimits` (`51-61`), que corta el exceso por el final (`lines.slice(0, 149)` y `slice(0, 11970)`). Además, en `auto.ts:685-700`, la alerta de holdout se registra después de consultar `decideConclusionsUpdate` (`663`).
- **Remediación sugerida:** Insertar las alertas al principio de la sección `## Últimas rondas` podando primero entradas antiguas antes del límite global.

#### `EV-006` — Inconsistencias en `eval/core/runner.ts` con reintentos, `--dry-run` y excepciones de cliente/worker
- **Severidad:** Media
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/runner.ts:136, 232-245, 332, 346-360, 384-389, 437, 580`; `eval/auto.ts:150-152`; `eval/cli.ts:159`
- **Descripción:** Se observan inconsistencias en manejo de truncado + error de parseo, trazabilidad de `requestHash` tras reintento y captura de excepciones en cliente y worker.
- **Evidencia:**
  1. En `runGenerative` (`runner.ts:386-388`), si `rejectTruncated === false` (`final`, `question`), un truncado (`finishReason === "length"`) que también falla `parseOutput` propaga `parseError` en vez de `TRUNCATED_ERROR`. Además `rawInput` (`437`) actualiza al cuerpo del reintento mientras `requestHash` (`332`) conserva el del intento 1.
  2. En `--dry-run`, `runDecision` (`239`) y `runGenerative` (`353`) emiten registros con `passed: false` sin `client_call_ok`, y `cli.ts:159` sale con `0`.
  3. `runOne` (`136`) y `runDataset` (`580`) no envuelven `client.call` en `try/catch`; y `runComparativeBatchInWorker` (`auto.ts:150-152`) no captura `stderr` cuando un worker aborta fuera de su `try/catch`.
- **Remediación sugerida:** Priorizar `TRUNCATED_ERROR` cuando `truncated && !isLast`, actualizar `requestHash` junto con `rawInput` y capturar excepciones de `client.call` y `stderr` del worker.

#### `EV-007` — Reconstrucción imprecisa en `eval/core/traces.ts` para `recovery`, `result_verification`, schemas multilínea y `full.json.gz`
- **Severidad:** Media
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/traces.ts:217-224, 287-297, 444-447, 681, 818-842`
- **Descripción:** La conversión de `jarvis-traces/` a `.jsonl` descarta datos ya recuperados de `full.json.gz` y aplica fallbacks silenciosos que pueden alterar los casos exportados.
- **Evidencia:**
  1. En `recovery` (`818-842`), `extractRecoveryBlock` extrae `recBlock.attempts` (`321-322`), pero la línea `841` lo ignora y calcula `Math.max(1, consecutive || 1)` mirando solo la cola final en `failed`; la línea `820` toma `slice.steps.at(-1)?.instruction` sin verificar `state === "failed"`.
  2. En `result_verification` (`445-446`), si `linkedCallId` no está en `filteredCalls`, cae silenciosamente al último elemento (`filteredCalls.length - 1`).
  3. `extractEnvAndSchemaFromInput` (`287-297`) usa `/TOOL:\s*([\w-]+)/` (no admite `.` ni `:`) y `/SCHEMA:\s*(.*)/` (solo JSON en una línea).
  4. `readTraceBundle` (`222`) silencia errores en `full.json.gz` sin aviso y `fullBySeq` (`681`) sobrescribe ante `seq` repetidos.
- **Remediación sugerida:** Usar `recBlock.attempts` si está presente, descartar casos `result_verification` sin `linkedCallId` exacto y advertir si falla la lectura de `full.json.gz`.

#### `EV-008` — `--limit` omite validación de casos posteriores y `countDatasetStages` falla sin contexto de línea
- **Severidad:** Media
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/datasets.ts:244-256, 289-326`
- **Descripción:** Con `--limit`, el tail del dataset ni se materializa ni se valida; y `--list` / `countDatasetStages` no reporta archivo ni línea al fallar.
- **Evidencia:** En `loadFile` (`datasets.ts:289-293`), `if (filters.limit !== undefined && cases.length >= filters.limit) continue;` se ejecuta antes de `materializeScenario` (`297`), `validateCase` (`311`) y el chequeo de IDs autogenerados duplicados (`317-325`). `countDatasetStages` (`244-256`) lanza error genérico sin número de línea.
- **Remediación sugerida:** Aplicar `filters.limit` después de validar todo el archivo (o ofrecer flag separado) e incluir `archivo:línea` en errores de `countDatasetStages`.

#### `EV-009` — Fallback de `wizard.ts` expone `smoke` y `holdout` como datasets dev y no reutiliza `RawDatasetCache`
- **Severidad:** Baja
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/ui/wizard.ts:221-226`
- **Descripción:** Si el autodescubrimiento falla en el paso 4 del asistente (`--auto`), se proponen `smoke` y datasets `*_holdout*` como si fueran datasets de desarrollo.
- **Evidencia:** `wizard.ts:223` llama `discoverStageDatasets(stage, [], [])` sin `rawCache` y el `catch` (`224-226`) rellena la lista con `listDatasetNames()` completo sin filtrar.
- **Remediación sugerida:** Filtrar `smoke` y `*_holdout*` en el fallback de `wizard.ts:225` y pasar `createRawDatasetCache()`.

#### `EV-020` — `scanReusableInitialRanking` omite `url`, `decisionUrl`, `promptEnv.date` y `timeoutMs` al reutilizar corridas previas
- **Severidad:** Alta
- **Estado:** CONFIRMADO *(comparación de huella en código)* / PROBABLE *(falsa reutilización efectiva si varía `--url`/`--decision-url` o cambia de día)*
- **Ubicación:** `eval/auto/ranking.ts:289-307`; `eval/core/scenario.ts:52-75`; `eval/core/results.ts:175-210`
- **Descripción:** La detección de corridas iniciales reutilizables en `--auto` puede reciclar resultados generados contra otro servidor (`--url` / `--decision-url`), distinto timeout o distinta fecha del sistema inyectada en prompts.
- **Evidencia:** `scanReusableInitialRanking` (`ranking.ts:294-307`) compara `model`/`decisionModel`, `variantHash`, `datasetHash`, `cases.hash`, `promptEnv.stageConfigHash`, `repeat`, `thinking`, `client`, `includeShortcut` y filtros vacíos, pero **no** comprueba `meta.url` (etapas generativas), `meta.decisionUrl` (etapas de decisión), `meta.params?.timeoutMs` ni `meta.promptEnv?.date` (`scenario.ts:74`, usada en prompts con `todayLine()`). En consecuencia, un cambio de puerto/proxy/cuantización remota bajo el mismo nombre de modelo recicla cachés obsoletos sin reejecutar.
- **Remediación sugerida:** Validar también `meta.url` / `meta.decisionUrl`, `meta.params?.timeoutMs` y `meta.promptEnv?.date` dentro de `metaMatches` en `ranking.ts:294-307`.

#### `EV-021` — Prompt de `optimizer.ts` sin presupuesto de contexto, crecimiento en reparación y ruta dependiente de `cwd`
- **Severidad:** Media
- **Estado:** CONFIRMADO *(ausencia de presupuesto y uso de `resolve()` sin raíz de módulo)* / NO VERIFICADO *(desborde real en modelos Ollama 8K–16K)*
- **Ubicación:** `eval/auto/optimizer.ts:149, 278-279, 354-366, 465, 480, 547, 625`; `eval/auto/stageContract.ts:753`; `eval/auto/validateVariant.ts:116-117, 393`
- **Descripción:** El optimizador no controla el tamaño acumulado del prompt frente al contexto del modelo optimizador y asume que `process.cwd()` coincide siempre con la raíz del repositorio.
- **Evidencia:** `generateVariantsForRound` fija `maxTokens: 4096` (`465`, y `2048` en `625`) sin acotar ni estimar el tamaño de `prodPromptSource` + Top-2 completo + 14 muestras de fallo (`354-366`); en los reintentos de reparación (`480`, `547`) concatena además hasta `raw.slice(0, 3000)` / `raw.slice(0, 6000)` sin recorte del historial previo ni advertencia contra inyección de instrucciones dentro de `inputCompact`/`rawOutput` (`278-279`). Por otro lado, `stageContract.ts:753` y `validateVariant.ts:116-117, 393` usan `resolve("src/core/...")` relativo a `cwd` en lugar de `import.meta.url`.
- **Remediación sugerida:** Estimar tokens antes de llamar al optimizador (podando muestras en reparaciones y añadiendo delimitadores de datos no confiables) y resolver `src/core/` relativo a `import.meta.url`.

#### `EV-024` — Inconsistencias menores en `scoring.ts`, `report.ts` y detección de módulo principal en `eval/traces.ts`
- **Severidad:** Baja
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/scoring.ts:160-165, 197, 251-270`; `eval/core/report.ts:171-183, 236`; `eval/traces.ts:157`
- **Descripción:** Pequeñas inconsistencias entre `scores.json`, `ComparisonReport` y la entrada CLI de `traces.ts`.
- **Evidencia:**
  1. Si un `stageKey` solo tiene casos en `bucket === "raw"`, `scoring.ts:160-270` emite un resumen en `scores.json` con `totalRuns: 0`, `passRate: 0`, `latencySamples: 0`, `p50DurationMs: 0`, `p95DurationMs: 0` (aunque `report.ts:171-182` sí omite `p50`/`p95` cuando `latencySamples === 0`).
  2. `scoring.ts:197` y `report.ts:236` filtran `if (r.expectedLabel)` por *truthiness* en lugar de `r.expectedLabel !== null && r.expectedLabel !== undefined`.
  3. `eval/traces.ts:157` compara `pathToFileURL(process.argv[1]).href === import.meta.url` sin normalizar con `resolve(process.argv[1])` (a diferencia de `eval/auto.ts` y `eval/cross.ts`).
- **Remediación sugerida:** Usar `resolve(process.argv[1])` en `eval/traces.ts:157`, chequear `!== null && !== undefined` en `expectedLabel` y omitir `p50`/`p95` o marcar `undefined` cuando `latencySamples === 0` en `scoring.ts`.

---

### 3.3 Desalineación `eval ↔ src`

#### `EV-010` — Contrato de etapa `route` en `eval/auto` y mock de tests siguen referenciando la ruta eliminada `"files"`
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/auto/stageContract.ts:124` y `eval/auto/eval_auto.test.ts:920` vs `src/core/types/routes.ts:7`
- **Descripción:** El contrato descriptivo para el optimizador y el mock de `route` en tests usan la ruta obsoleta `"files"`, dividida en producción en `files_read` y `files_write`.
- **Evidencia:** `stageContract.ts:124` indica `'files', 'terminal', 'web'` y `eval_auto.test.ts:920` devuelve `"files"` como ruta por defecto en el mock, mientras `src/core/types/routes.ts:7` define `EXECUTABLE_ROUTES = ["terminal", "files_read", "files_write", "system", "multimedia", "web"]`.
- **Remediación sugerida:** Actualizar `stageContract.ts:124` y `eval_auto.test.ts:920` a `EXECUTABLE_ROUTES`.

#### `EV-011` — Clientes `generative.ts` y `decision.ts` omiten `keep_alive`; `generative.ts` duplica constantes y clasifica HTTP 200 no-JSON como red
- **Severidad:** Media
- **Estado:** CONFIRMADO *(divergencia de código)* / PROBABLE *(sesgo de latencia al descargarse el modelo en Ollama)*
- **Ubicación:** `eval/core/client/generative.ts:14, 74-85, 121-144, 206-208` y `eval/core/client/decision.ts:58` vs `src/core/models/qwen.ts:277, 352-367, 403, 459` y `src/core/models/decision.ts:70`
- **Descripción:** *(Ampliado en Pasada 2)* Ni el cliente generativo ni el cliente de decisión de `eval` replican exactamente el payload de producción hacia Ollama.
- **Evidencia:**
  1. `qwen.ts:403` y `src/core/models/decision.ts:70` (`buildDecisionRequest`) envían `keep_alive: config.modelKeepAlive` en cada request, mientras **`eval/core/client/generative.ts:121-144`** y **`eval/core/client/decision.ts:58`** omiten `keep_alive`.
  2. `generative.ts:14` y `74-85` duplican `MIN_COMPLETION_TOKENS = 256` y `resolveUrl` de `qwen.ts`.
  3. Ante HTTP 200 con cuerpo no JSON, `qwen.ts:459` lanza `LLMValidationError`, pero `generative.ts:207` retorna `"network: la respuesta no es JSON válido"`, tratado como fallo de transporte en `isFatalClientError` (`49-51`).
- **Remediación sugerida:** Reexportar `MIN_COMPLETION_TOKENS`, `resolveUrl` y `buildDecisionRequest` desde `src/`, incluir `keep_alive` en ambos clientes de `eval/` y no prefijar `network:` en HTTP 200 malformado.

#### `EV-012` — Truncado de `previous_answer` divergente en `continuation` y `pending`, y `stageConfigHash` incompleto
- **Severidad:** Media
- **Estado:** CONFIRMADO *(verificado directamente contra `src/core/engine/thread.ts` en Pasada 2)*
- **Ubicación:** `eval/core/stages/continuation.ts:38` y `eval/core/stages/pending.ts:37` vs `src/core/engine/thread.ts:16, 24-27`; `eval/core/scenario.ts:66-75`
- **Descripción:** *(Revalidado en Pasada 2)* `continuation.ts` hardcodea el límite de hilo sin sufijo `"…"`, `pending.ts` omite el truncado aplicado por producción y `stageConfigHash` ignora parámetros relevantes del prompt.
- **Evidencia:**
  1. `src/core/engine/thread.ts:16, 26` define `THREAD_ANSWER_CHARS = 500` y `previousTaskOf` recorta con **`"…"`** al final (`slice(0, 500) + "…"`), además de `.trim()`. En cambio, `eval/core/stages/continuation.ts:38` hardcodea `500` **sin** `.trim()` ni `"…"`, y `eval/core/stages/pending.ts:37` pasa `t.previous_answer` íntegro sin truncar (cuando producción lo recibe ya truncado por `previousTaskOf` en `TaskManager`).
  2. `scenario.ts:69-70` solo incluye `{ qwenMaxTokens, thinking, askMaxTokens, pendingMaxTokens }` en `stageConfigHash`, omitiendo `qwenNumCtx`, `decisionMaxContext`, `reviewFullView` y los umbrales `VERIFY_APPROVE`/`NOUL_APPROVE`.
- **Remediación sugerida:** Usar `previousTaskOf` (o `THREAD_ANSWER_CHARS`) desde `contract.ts` en `continuation.ts` y `pending.ts`, e incluir `qwenNumCtx`, `decisionMaxContext` y `reviewFullView` en `stageConfigHash`.

#### `EV-018` — `args_review` en `eval` omite `{ fullView }` y umbral `BUDGET.sensitiveApprove`, y `stageContract.ts` enseña firma incompleta
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/stages/args_review.ts:32, 49` y `eval/auto/stageContract.ts:233` vs `src/core/models/decision.ts:279`, `src/core/engine/callConfirm.ts:93-95` y `src/core/budget.ts:66`
- **Descripción:** La evaluación de Decisión 3 (`args_review`) no replica dos mecanismos reales de producción: la vista completa condicional (`reviewFullView`) y el umbral estricto (`0.65` frente a `0.60`) en comandos sensibles/amarillos.
- **Evidencia:**
  1. `src/core/models/decision.ts:279` llama a `this.prompts.buildArgsReview(input, { fullView: this.getConfig().reviewFullView === true })`. En cambio, `eval/core/stages/args_review.ts:32` invoca `D.buildArgsReview(reviewInput(...))` con un único argumento, impidiendo evaluar el modo `reviewFullView: true` (aun cuando `fullView` existiera en `jarvis-config.json`).
  2. `src/core/engine/callConfirm.ts:93-95` pasa `BUDGET.sensitiveApprove` (`0.65`, `src/core/budget.ts:66`) a `reviewOutcome` para herramientas de nivel sensible o amarillo, mientras `args_review.ts:49` llama `reviewOutcome(...)` sin segundo argumento (siempre `0.60`), sin soporte para casos sensibles en `expect`/`scenario`.
  3. `eval/auto/stageContract.ts:233` muestra al optimizador `function buildArgsReview(data: ReviewDecisionInput): DecisionInput` omitiendo el segundo parámetro `options?: { fullView?: boolean }`.
- **Remediación sugerida:** Pasar `{ fullView: h.config().reviewFullView === true }` en `args_review.ts:32`, documentar `options` en `stageContract.ts:233` y soportar umbral estricto opcional en `args_review`.

#### `EV-025` — `scenario.ts` impide evaluar la etapa `plan` con `TRIGGER: initial` en modo `deliberative`
- **Severidad:** Alta
- **Estado:** CONFIRMADO *(descubierto al materializar `integral_v1.jsonl` y verificado en `scenario.ts`, `plan.ts` y `src/core/ctx/views/plan.ts`)*
- **Ubicación:** `eval/core/scenario.ts:116-118, 132-134, 159-160`; `eval/core/stages/plan.ts:51-56`; `src/core/ctx/views/plan.ts:28-36`
- **Descripción:** La etapa `plan` en el evaluador no puede representar el disparo real de primer plan (`TRIGGER: initial`) definido por producción, dejando todo ese subtipo fuera de evaluación automática.
- **Evidencia:**
  1. En `src/core/ctx/views/plan.ts:28-36`, `buildPlanView` solo produce `trigger: { kind: "initial" }` cuando `data.plans.length === 0` (y sin paso `failed`). Si `data.plans.length > 0` y no hay paso fallido, exige `options.feedback !== null` (o lanza `ContextError: forPlan: el plan user_feedback exige el feedback como parámetro`) y produce `user_feedback`.
  2. Sin embargo, `buildContext` (`eval/core/scenario.ts:116-118`) agrega **siempre** un plan inicial en `data.plans` cuando `sc.mode === "deliberative"`, e inicializa `stepSpecs = sc.steps && sc.steps.length > 0 ? sc.steps : [{}]`, creando un paso sintético con `instruction: ""` (`L. 133`) que además rompe la validación de contexto (`step.instruction debe ser null o un texto no vacío (nunca "")`).
  3. Intentar `mode: "reactive"` tampoco reproduce un plan inicial limpio porque `scenario.ts:134, 159-160` inserta un paso activo en estado `running` dentro de `CURRENT`. Como consecuencia, ningún caso del eval puede probar `TRIGGER: initial` (ni siquiera `smoke.jsonl`, que solo prueba `plan` vía `step_failure`).
- **Remediación sugerida:** Omitir el plan y los pasos sintéticos en `scenario.ts` cuando un caso de `plan` (o con flag explícito en `ScenarioAt`) tenga `steps` vacío y sin `at.feedback`.

---

### 3.4 Calidad del eval, métricas, fixtures y tests

#### `EV-013` — Inventario activo reducido a `smoke.jsonl` y `prod.ts` (`--auto` sin `--dataset` falla por diseño; hoy hay 7 fixtures residuales fugados)
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/datasets/`; `eval/variants/prod.ts`; `eval/auto/discover.ts:84-99`; `eval/README.md:73`
- **Descripción:** El repositorio base no incluye datasets de trabajo ni variantes fuera de `smoke.jsonl` y `prod.ts`, por lo que `eval --auto` sin `--dataset` falla por defecto. Además, al inspeccionar el estado actual del directorio de trabajo (`2026-11-21 18:08:52`) se observan 7 datasets de fixtures dejados en `eval/datasets/` por una corrida previa interrumpida de `eval_auto.test.ts` (`EV-023`).
- **Evidencia:** `eval/variants/` solo contiene `prod.ts`; en un árbol limpio, `eval/datasets/` solo contiene `smoke.jsonl` (excluido por `discoverStageDatasets` en `discover.ts:88`), haciendo fallar `npm run eval:auto -- --stage=<etapa>` con salida `2`. Actualmente `eval/datasets/` contiene además 7 archivos copiados desde `eval/auto/fixtures/datasets/` (`args_review_16_cases.jsonl`, `continuation_dev.jsonl`, `continuation_holdout.jsonl`, `d0_variedad.jsonl`, `pending_min.jsonl`, `recovery_casos.jsonl`, `route_16_cases.jsonl`).
- **Remediación sugerida:** Documentar `--dataset` explícito junto a datasets reales gestionados por el usuario o incluir datasets base curados sin mezclarlos con copias temporales de tests.

#### `EV-014` — `gitInfo()` en `meta.json` queda vacío silenciosamente fuera de repositorios `.git`
- **Severidad:** Baja
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/core/results.ts:81, 94-103, 200-201`
- **Descripción:** En workspaces sin `.git`, `meta.json` omite `gitCommit` y `gitDirty` sin dejar marca explícita de trazabilidad.
- **Evidencia:** `tryGit` (`results.ts:83-89`) retorna `undefined` al fallar `git` y `buildRunMeta` (`200-201`) omite las claves sin alternativa.
- **Remediación sugerida:** Emitir `gitCommit: "unavailable"` o un hash del árbol `src/` cuando `tryGit` falle.

#### `EV-019` — Etiquetas erróneas (`files_read` en casos de escritura) en fixtures de `route` y fixture legacy roto de `recovery`
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/auto/fixtures/datasets/route_16_cases.jsonl:9, 13`; `eval/auto/fixtures/datasets/route_gemai.jsonl:2, 10, 14`; `eval/auto/fixtures/datasets/recovery_casos.jsonl:1-3, 14, 20-25, 33`; `eval/auto/fixtures/variants/recovery_three_options_nobehind.ts.txt:1-8, 21, 87-120`
- **Descripción:** Dos fixtures de `route` etiquetan tareas explícitas de creación/modificación/movimiento de archivos como `files_read` pese a ofrecer `files_write` en `at.routes`, penalizando al modelo cuando acierta; y el fixture de variante de `recovery` contiene rutas y modos eliminados.
- **Evidencia:**
  1. `route_16_cases.jsonl` espera `"expectedRoute":"files_read"` cuando `at.routes` incluye `"files_write"` en `route-009` (L. 9: *"Escribí un archivo resumen.txt en Documents..."*) y `route-013` (L. 13: *"Mové el archivo C:/Users/hugof/config.default a C:/Users/hugof/config.json"*).
  2. `route_gemai.jsonl` incurre en lo mismo con `route-018` (L. 2: *"Agregá la entrada 'build:ci'..."*), `route-026` (L. 10: *"Creá un archivo .gitignore..."*) y `route-030` (L. 14: *"Reemplazá ... la URL..."*).
  3. `recovery_three_options_nobehind.ts.txt` importa a 3 niveles `../../../src/...` (inválido en `eval/variants/_auto/recovery/`, que exige 4 niveles), implementa modos rechazados por `recoveryStage.validateRequest` (`cascade`, `ens`, `argmax3`, `axes` en L. 21, 87–120) y cita datasets inexistentes (`recovery_n1`..`recovery_n4`, L. 8). `recovery_casos.jsonl` conserva en sus cabeceras (L. 3: `expect.answers.independent`) y en `rec-bd-01` (L. 33) el diseño antiguo de 4 acciones con `skip_continue`.
- **Remediación sugerida:** Corregir `"expectedRoute":"files_write"` en los 5 casos de `route_*.jsonl` y limpiar o actualizar los fixtures obsoletos de `recovery`.

#### `EV-022` — Falsos positivos de `INTERNAL_LEAK_RE`, asimetrías en graders y puntos ciegos en `oracleOutput` / `questions.ts`
- **Severidad:** Media
- **Estado:** CONFIRMADO *(en inspección de graders/oráculos)* / PROBABLE *(impacto en datasets futuros con snake_case)*
- **Ubicación:** `eval/core/graders/question.ts:14, 54`; `eval/core/graders/arguments.ts:59-67, 77-83`; `eval/core/stages/{arguments,final,pending,plan}.ts`; `eval/core/questions.ts:15, 116`
- **Descripción:** Varios graders y oráculos presentan heurísticas frágiles o incompletas frente a los campos que prometen evaluar.
- **Evidencia:**
  1. `question.ts:14, 54`: `INTERNAL_LEAK_RE = /\b(?:[a-z]+_[a-z0-9_]+|[csr]\d+)\b/` marca como "fuga interna" **cualquier** token en minúscula `snake_case` sin extensión (p. ej. variables `api_key`, `build_ci`, claves JSON o carpetas como `mi_carpeta`).
  2. `graders/arguments.ts:59-67 vs 77-83`: `exactFieldValues` compara de forma exacta sensible a mayúsculas y `\`/`/` (`stableStringify`), mientras `forbiddenHardcodedValues` normaliza `normValue` (minúsculas y `/` Windows); una discrepancia solo de barra o mayúsculas falla `exactFieldValues`.
  3. `oracleOutput`: `arguments.ts:94` cae a `"mock"` para strings sin `enum`/`const` (ignorando `pattern` del JSON Schema o pudiendo chocar con restricciones de dominio); `final.ts:37-39`, `plan.ts:77-98` y `pending.ts:53-56` ignoran las restricciones negativas (`forbiddenHallucinations`, `forbiddenKeywordsInGoal`, `forbiddenRepeatedGoals`, `forbiddenExecutedEffects`, `forbiddenKeywords`, `maxItems`), confiando en que cadenas dummy (`"Listo."`, `"Plan step"`, `"Next action"`) no colisionen.
  4. `questions.ts:116`: evalúa **toda** pregunta extra `noul` con `NOUL_APPROVE` (`0.6`) salvo `ok`/`cumple` (`VERIFY_APPROVE`), sin permitir el umbral propio de `continuation` (`0.3`) o `fragment_judge` (`0.5`).
- **Remediación sugerida:** Sustituir el regex `snake_case` genérico en `question.ts` por la lista real de herramientas MCP + prefijos internos `[csr]\d+` y respetar restricciones negativas / umbrales por pregunta en `oracleOutput` y `questions.ts`.

#### `EV-023` — Fuga persistente de datasets por `eval_auto.test.ts` y brechas de cobertura real en la suite de tests
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `eval/auto/eval_auto.test.ts:41-52, 920`; `eval/core/eval_core.test.ts:197-234, 472-505`; `tests/noul_cuts.test.ts:1-46`
- **Descripción:** La suite de tests modifica el directorio vivo del proyecto sin garantizar aislamiento ante interrupciones, y deja sin cobertura crítica varias partes reales de `eval`.
- **Evidencia:**
  1. **Fuga confirmada en disco:** `eval_auto.test.ts:41-52` copia `eval/auto/fixtures/datasets/*` dentro del directorio vivo `eval/datasets/` en `before()`, saltando ficheros si ya existen (`if (existsSync(dest)) continue;`). Tras una ejecución interrumpida previa (`18:08:52`), 7 archivos fixture quedaron de forma permanente en `eval/datasets/` y las ejecuciones posteriores nunca los limpian (`--list` y `eval` ahora los incluyen como datasets propios).
  2. `eval_auto.test.ts` no prueba los escapes de `EV-001` (`exports.constructor.constructor`, `loadVariantSpecEphemeral`), ni `--seed-top` sin caché (`EV-004`), ni pérdida de alertas al compactar `conclusions.md` (`EV-005`), y usa la ruta muerta `"files"` en el mock (`920`).
  3. `eval_core.test.ts:197-234` solo valida 4 de 9 graders de etiquetas de decisión (omite `ToolChoice`, `ArgsReview`, `ResultVerification`, `FragmentJudge` y `D5`), prueba `smoke.jsonl` contra `oracle` (consistencia interna de sintéticos más que validez real frente al modelo) y usa un trace sintético pequeño que no ejercita fallos reales de `eval/core/traces.ts` (`EV-007`).
  4. `tests/noul_cuts.test.ts:1-46` únicamente aserta 3 constantes/objetos estáticos de `src/` sin importar ni probar código alguno de `eval/`, pese a su cabecera.
- **Remediación sugerida:** Ejecutar `eval_auto.test.ts` contra un `datasetsRoot` temporal aislado en lugar de mutar `eval/datasets/`, y añadir pruebas de regresión para `EV-001`, `EV-004`, `EV-005` y los 5 graders de decisión faltantes.

---

### 3.5 Código legacy / muerto

#### `EV-015` — Función exportada sin uso `parsePlanSteps` en `contract.ts` y exclusión obsoleta `decision_all_stages_example`
- **Severidad:** Baja
- **Estado:** CONFIRMADO *(confirmado por grep global en `eval/`, `src/` y `tests/`)*
- **Ubicación:** `eval/core/contract.ts:153-157`; `eval/auto/discover.ts:6, 151, 160`
- **Descripción:** Símbolos y filtros heredados de versiones anteriores siguen presentes sin ningún consumidor activo.
- **Evidencia:** `grep -rnE "parsePlanSteps|decision_all_stages_example" eval/ src/ tests/` confirma `0` importadores de `eval/core/contract.ts:154` (solo existe otro `parsePlanSteps` independiente en `src/core/models/qwen.ts`; `eval/core/stages/plan.ts` usa `parsePlanStepsResult`) y confirma que `decision_all_stages_example` solo sobrevive en exclusiones de `discover.ts` y texto de `INSTRUCCIONES.md:287`.
- **Remediación sugerida:** Eliminar `parsePlanSteps` de `eval/core/contract.ts` y la exclusión `decision_all_stages_example` de `eval/auto/discover.ts`.

---

### 3.6 Dependencias

#### `EV-016` — API experimental de TypeScript 7 (`typescript/unstable/*`), dependencia implícita de Windows (`powershell.exe`) y `dotenv` sin cargar
- **Severidad:** Alta
- **Estado:** CONFIRMADO
- **Ubicación:** `package.json:28, 44`; `eval/auto/tsScanner.ts:9-10`; `src/core/engine/precheck.ts:368`; `eval/core/config.ts`
- **Descripción:** `eval` depende de APIs internas inestables de TS 7, requiere `powershell.exe` sin alternativa `pwsh` en Linux/macOS y declara `dotenv` en dependencias sin cargarlo en ninguna parte del código.
- **Evidencia:** `package.json:44` usa `"typescript": "^7.0.2"` (instalado `7.0.2`) con imports `"typescript/unstable/ast"` y `"typescript/unstable/ast/scanner"` (`tsScanner.ts:9-10`). `precheck.ts:368` ejecuta `"powershell.exe"` duro. Y `grep -rn "dotenv"` en `eval/`, `src/` y `tests/` devuelve **0 coincidencias** pese a estar `"dotenv": "^17.2.3"` (`17.4.2` instalado) en `package.json:28`.
- **Remediación sugerida:** Fijar `typescript` a versión exacta en `package.json` y documentar explícitamente la dependencia de Windows (`powershell.exe`) o cargar `.env` / eliminar `dotenv` si no se va a usar.

---

### 3.7 Configuración, ejecución y documentación desactualizada

#### `EV-017` — Documentación operativa y de desalineaciones contradice el estado actual del código
- **Severidad:** Alta
- **Estado:** CONFIRMADO *(contrastado en Pasada 2 contra `arguments.ts`, `eval_core.test.ts` y ejecución viva de `cli.ts --dry-run`)*
- **Ubicación:** `docs/evaluacion/desalineaciones-eval.md:3-17`; `eval/INSTRUCCIONES.md:34, 80, 84, 110, 137-138, 150, 197, 200, 287, 310, 329-331`; `eval/GUIA_DECISION.md:92, 95, 101-103, 147-148, 165, 230`; `docs/pendientes/PENDIENTES_EVAL.md:93, 121, 181, 184`
- **Descripción:** Cuatro documentos clave contradicen al código actual en esquemas de ruta, código de salida de `--dry-run`, inventario y desalineaciones ya resueltas vs nuevas abiertas.
- **Evidencia:**
  - `docs/evaluacion/desalineaciones-eval.md:7-16`: mantiene `D8` (`priorAttempts = 0`) como única desalineación abierta, cuando ya fue implementada en `eval/core/stages/arguments.ts:118-126` (con test propio en `eval_core.test.ts:399-471`) e ignora `EV-010`, `EV-011`, `EV-012` y `EV-018`.
  - `eval/INSTRUCCIONES.md`: L. 110 documenta que `--dry-run` termina con código **`2`**, mientras `eval/cli.ts:159` devuelve **`0`** (verificado en ejecución: `npx tsx eval/cli.ts --dataset=smoke --dry-run --limit=1` → exit **`0`**); L. 34, 137-138 y 197 usan rutas eliminadas (`'files'`, `'locate'`); L. 80/84 listan modelos sin sufijo `-text`; L. 150 omite `pending` al explicar `recalled`; L. 200, 287, 310, 329-331 citan archivos inexistentes (`recovery/README.md`, `decision_all_stages_example`, `args_review_D3`, `args_review_gemai`, `args_review_gemaiL`).
  - `eval/GUIA_DECISION.md`: L. 92 menciona composición `a+b` (rechazada por `eval/core/variants/load.ts:137-140`) y apunta a carpetas eliminadas (`eval/datasets/recovery/`, `eval/variants/recovery/`).
  - `docs/pendientes/PENDIENTES_EVAL.md`: L. 93, 121, 181, 184 piden `eval/traces.ts` (ya implementado) y citan datasets/casos ya eliminados.
- **Remediación sugerida:** Actualizar en bloque `desalineaciones-eval.md`, `INSTRUCCIONES.md`, `GUIA_DECISION.md` y `PENDIENTES_EVAL.md` contra el código y las pruebas actuales.

---

## 4. Matriz de desalineación `eval ↔ src`

| Aspecto | En `src/` (fuente de verdad) | En `eval/` / docs | Estado | Hallazgo |
|---|---|---|---|---|
| Rutas ejecutables (`route`) | `EXECUTABLE_ROUTES = ["terminal", "files_read", "files_write", "system", "multimedia", "web"]` (`src/core/types/routes.ts:7`) | `stageContract.ts:124`, `eval_auto.test.ts:920` e `INSTRUCCIONES.md` aún usan `'files'`; fixtures `route_*` esperan `'files_read'` en escrituras | CONFIRMADO | `EV-010`, `EV-017`, `EV-019` |
| Payload `keep_alive` a Ollama (Qwen + Decision) | Envían `keep_alive: config.modelKeepAlive` (`src/core/models/qwen.ts:403` y `src/core/models/decision.ts:70`) | Lo omiten `eval/core/client/generative.ts:121-144` y `eval/core/client/decision.ts:58` | CONFIRMADO | `EV-011` |
| Constante `MIN_COMPLETION_TOKENS` y `resolveUrl` | Privados en `src/core/models/qwen.ts:277, 352-367` | Duplicados en `eval/core/client/generative.ts:14, 74-85` | CONFIRMADO | `EV-011` |
| Respuesta HTTP 200 no-JSON | Lanza `LLMValidationError` (`qwen.ts:459`) | Devuelve `"network: ..."` tratado como fallo fatal (`generative.ts:207`) | CONFIRMADO | `EV-011` |
| Hilo `previous_answer` (`continuation` y `pending`) | `previousTaskOf` recorta a `THREAD_ANSWER_CHARS = 500` + `"…"` tras `.trim()` (`src/core/engine/thread.ts:16, 26`) | `continuation.ts:38` trunca a `500` sin `"…"` ni `.trim()`, y `pending.ts:37` no trunca | CONFIRMADO | `EV-012` |
| `args_review` (`fullView`, firma y umbral estricto) | `decision.ts:279` pasa `{ fullView }`; `callConfirm.ts:93-95` usa `BUDGET.sensitiveApprove` (`0.65`) | `args_review.ts:32, 49` omite `{ fullView }` y usa siempre `0.60`; `stageContract.ts:233` enseña firma de 1 argumento | CONFIRMADO | `EV-018` |
| Huella `stageConfigHash` | Config real incluye `qwenNumCtx`, `decisionMaxContext`, `reviewFullView` | `promptEnvironment()` solo hashea `{ qwenMaxTokens, thinking, askMaxTokens, pendingMaxTokens }` (`scenario.ts:69-70`) | CONFIRMADO | `EV-012` |
| `priorAttempts` en `arguments` (D8) | `argsInput` recibe `priorAttempts` | Ya implementado en `arguments.ts:118-126` y testeado (`eval_core.test.ts:399-471`); doc `desalineaciones-eval.md:7-16` obsoleto | CONFIRMADO | `EV-017` |
| Reintento en `final`/`question` truncados + `parseError` | Verifica texto y truncado (`qwen.ts:529-534, 589-594`) | `runner.ts:386-388` prioriza `parseError` y desincroniza `requestHash` vs `rawInput` | CONFIRMADO | `EV-006` |
| `postCheck` en modo `oracle` y binario PowerShell | `precheck.ts:368` llama `"powershell.exe"` y rechaza si devuelve hallazgo | Sin binario en Linux retorna `null` → `precheck_ok = true` silencioso; `runner.ts:432` omite `postCheck` en `oracle` | CONFIRMADO | `EV-002`, `EV-016` |
| Trigger `initial` en etapa `plan` | `buildPlanView` (`src/core/ctx/views/plan.ts:31-32`) emite `initial` solo con `data.plans.length === 0` | `scenario.ts:117-118` siempre crea un registro `plans` y un paso por defecto en `deliberative`, forzando `user_feedback` o `step_failure` | CONFIRMADO | `EV-025` |

---

## 5. Dependencias

| Paquete / Runtime | Declarado (`package.json`) | Instalado (`npm ls`) | Estado / Problema |
|---|---|---|---|
| `typescript` (`devDependencies`) | `^7.0.2` | `7.0.2` | Rango `^` junto a imports experimentales `typescript/unstable/ast` y `typescript/unstable/ast/scanner` en `eval/auto/tsScanner.ts:9-10`. |
| `esbuild` (`devDependencies`) | `^0.28.2` | `0.28.2` | Rango `^` (0.x); usado en transpilación CJS de variantes efímeras (`ephemeralVariant.ts:8`, `validateVariant.ts:14`). Operativo. |
| `tsx` (`devDependencies`) | `^4.21.0` | `4.23.15` | Rango `^`; ejecuta CLIs y tests. Operativo en Node `v22.23.2`. |
| `@types/node` (`devDependencies`) | `^22.14.0` | `22.20.5` | Alineado con Node `v22.23.2`. Sin conflictos en `tsc --noEmit`. |
| `dotenv` (`dependencies`) | `^17.2.3` | `17.4.2` | Declarado en `package.json:28`, **0 usos** en todo el repositorio (`.env` no se carga automáticamente en `eval/auto`). |
| `powershell.exe` (SO externo) | N/A | Ausente en Linux | Dependencia implícita en `src/core/engine/precheck.ts:368`: sin fallback a `pwsh`, causa 2 fallos en `tests/eval_arguments.test.ts` y ciega `postCheck` / `eval:psvalid` en Linux. |

---

## 6. Dataset y variante creados (Pasada 3)

### Archivos creados y limpieza de trabajo
- **Dataset único:** `eval/datasets/integral_v1.jsonl` (**280 casos**, exactamente **20 por cada una de las 14 etapas**, **0** casos `raw` y **0** marcados `prod_shortcut`).
- **Variante única:** `eval/variants/integral_v1.ts` (export `default` con `name: "integral_v1"`, implementando las 5 vistas de `PROMPTS` —`ARGUMENTS_VIEW`, `QUESTION`, `PLAN_VIEW`, `PENDING_VIEW`, `FINAL_VIEW`— y los 9 constructores de `DECISION_PROMPTS`).
- **Aislamiento de repositorio:** no se modificaron `smoke.jsonl`, `prod.ts`, `src/`, `eval/core/`, `eval/auto/`, `tests/`, ni `package.json`; no se escribieron archivos temporales ni corridas en `eval/results/`. *(Nota: los 7 archivos fixture fugados previamente en `eval/datasets/` documentados en `EV-013`/`EV-023` se dejaron intactos sin tocar).*

### Distribución de casos por etapa y categoría

| Etapa | Tipo | Total | Típicos / base | Borde | Negativos | Ambiguos | Recuperación / Seguridad / Especiales | Casos dependientes |
|---|---|---:|---:|---:|---:|---:|---|---|
| `d0` | Decisión | 20 | 14 | 4 | 2 | 2 | 5 `chat`, 8 `single`, 7 `multi` | — |
| `route` | Decisión | 20 | 15 | 3 | 2 | 2 | 1 `recovery`; solo 6 rutas `EXECUTABLE_ROUTES` | — |
| `tool_choice` | Decisión | 20 | 19 | 1 | 1 | — | 1 `recovery`; ≥2 opciones por caso | — |
| `args_review` | Decisión | 20 | 7 | 9 | 8 | 1 | 1 `security`; aprobaciones, rechazos y `info_missing` | **`EV-018`** (6 casos `ev-018`) |
| `result_verification` | Decisión | 20 | 10 | 9 | 6 | 1 | Incluye `lastItem`, truncados y `known` previo | — |
| `fragment_judge` | Decisión | 20 | 9 | 6 | 6 | 1 | 3 `security` (inyección en `<obs>`), lote múltiple | — |
| `d5` | Decisión | 20 | 12 | 4 | 9 | 1 | Cierre real vs tareas multi-paso incompletas | — |
| `recovery` | Decisión | 20 | 11 | 8 | 2 | — | Solo 3 acciones (`rewrite_item`, `replan`, `close`) | — |
| `continuation` | Decisión | 20 | 8 | 5 | 10 | 2 | Pronombres, elipsis, cambio de tema, respuestas largas | **`EV-012`** (2 casos `ev-012`) |
| `plan` | Generativa | 20 | 11 | 4 | 2 | — | 9 `step_failure` + 11 `user_feedback` | **`EV-025`** (8 casos `ev-025-workaround`) |
| `arguments` | Generativa | 20 | 17 | 3 | — | — | Cubre las 6 rutas y `priorAttempts=1` (D8) | **`EV-002`** (2 casos `ev-002-windows`) |
| `final` | Generativa | 20 | 11 | 7 | 5 | — | 1 `security`; unidades exactas, fallos parciales, cero fugas | — |
| `question` | Generativa | 20 | 13 | 6 | 1 | — | 1 `security`; desambiguación sin tokens `snake_case` ni IDs | — |
| `pending` | Generativa | 20 | 12 | 7 | 4 | — | 2 `recovery`; listas reactivas, reintentos y `previous` | (`EV-012` en `previous_answer`) |
| **Total** | **14 etapas** | **280** | — | — | — | — | **280 `canonical` · 0 `prod_shortcut` · 0 `raw`** | **18 casos marcados** |

### Base de trazas, diseño de variante y supuestos aplicados
1. **Insumos verificados directamente en código:** en la Pasada 2 de `AUDITORIA_EVAL.md` no existía una sección titulada literalmente *"Insumos para la fase siguiente"*, por lo que todos los contratos, esquemas de `Scenario`, `ExpectSpec`, `inputSchema` de herramientas MCP (`src/tools/*/*.ts`) y reglas de cada grader (`eval/core/stages/*.ts` y `eval/core/graders/*.ts`) se verificaron directamente sobre el código fuente.
2. **Trazas reales e higienización:** se consultaron únicamente las 6 trazas más recientes por fecha como referencia realista de tareas (búsquedas web + reportes en `.md`, fallos de `delete_file`/`find_files`/`loop_blocked`, rechazos `user_rejected`, respuestas parciales). Todos los datos, rutas y usuarios quedaron anonimizados bajo `C:/Users/usuario/...` (sin usuarios reales ni credenciales).
3. **Variante `eval/variants/integral_v1.ts`:** mantiene compatibilidad exacta con los contratos de `validateRequest` y `parseOutput` de `eval`, añade guía explícita de desambiguación entre las 6 `EXECUTABLE_ROUTES`, pistas por herramienta, defensa anti-inyección en `<obs>`, reglas explícitas para PowerShell 5.1 sin `&&` ni `@{...}` calculados, soporte opcional `{ fullView }` en `buildArgsReview` (`EV-018`) y prohibición estricta de fugas internas (`[csr]\d+` / `snake_case`) en `QUESTION` y `FINAL_VIEW`.
4. **Supuestos de diseño:**
   - **Cero atajos triviales:** todos los casos de `route` y `tool_choice` ofrecen ≥2 opciones (`nonCanonical = 0`).
   - **Compatibilidad con `QuestionGrader` (`EV-022`):** en `question` y `final` se evitaron tokens `snake_case` en respuestas esperadas para no disparar falsos positivos de `INTERNAL_LEAK_RE`.
   - **Compatibilidad con `precheckCall` en `arguments`:** los casos con campos `path` requeridos (como `iv1-args-03`) especifican ruta explícita en `request` y `exactFieldValues` para evitar que `oracleOutput` emita `"mock"` y sea rechazado por la verificación de rutas del pre-chequeo.
   - **Sin dependencia de `route_16_cases`/`route_gemai`/`recovery_casos`:** se descartaron como plantilla por las etiquetas erróneas y modos legacy señalados en `EV-019`.

### Dependencias de hallazgos abiertos
- **`EV-018` (`args_review`, 6 casos: `iv1-review-04`, `iv1-review-05`, `iv1-review-11`, `iv1-review-12`, `iv1-review-17`, `iv1-review-19`):** ejercitan escenarios donde producción aplica `fullView: true` (`lastReads` / `env`) o umbral estricto `BUDGET.sensitiveApprove = 0.65` (`callConfirm.ts:93-95`). Deben revalidarse cuando `eval/core/stages/args_review.ts` pase `{ fullView }` y soporte `0.65`.
- **`EV-025` (`plan`, 8 casos: `iv1-plan-01`..`iv1-plan-07`, `iv1-plan-18`):** concebidos originalmente como planes iniciales (`TRIGGER: initial`), adaptados a `user_feedback` (`ev-025-workaround`) para respetar la restricción actual de `scenario.ts`; la evaluación de `TRIGGER: initial` queda **no cubierta** hasta corregir `EV-025`.
- **`EV-012` (`continuation`, 2 casos: `iv1-cont-08`, `iv1-cont-20`, y `pending` con `thread.previous_answer`):** casos límite de respuestas previas >500 caracteres que pueden divergir ligeramente respecto a producción mientras `continuation.ts` no añada `"…"`/`.trim()` y `pending.ts` no trunque a `500`.
- **`EV-002` (`arguments`, 2 casos: `iv1-args-19`, `iv1-args-20`):** en Linux `precheckCall` retorna `null` por falta de `powershell.exe`; su `postCheck` real debe revalidarse en Windows.

### Validación ejecutada sin Ollama ni Windows (`CONFIRMADO`)
1. **`npm run lint` (`tsc --noEmit`):** salida **`0`** (`0` errores de TypeScript incluyendo `eval/variants/integral_v1.ts`).
2. **`npx tsx eval/cli.ts --list`:** detecta `integral_v1` en **Variantes** y `integral_v1` (**280 casos**, `20` en cada una de las 14 etapas) en **Datasets**; salida **`0`**.
3. **`npx tsx eval/cli.ts --dataset=integral_v1 --variant=prod,integral_v1 --dry-run`:** salida **`0`**, **`560` requests `POST`** generadas (`280 × 2` variantes) sin errores de esquema, escenario ni contexto.
4. **Corrida completa en memoria (`npx tsx -e` con `runDataset`, sin escrituras en disco):**
   - `prodValidateErr: 0`, `iv1ValidateErr: 0`, `nonCanonical: 0` (sobre `280` casos × `2` variantes).
   - **Oráculo (`--client=oracle` sobre `prod`):** **`280/280` aprobados (`oracleFailed: 0`)**; además **`20/20` en verde** al ejecutar manualmente `argsEntry.postCheck` sobre las salidas del oráculo en `arguments` (bajo entorno Linux).
   - **Mock (`--client=mock` sobre `integral_v1`):** **`280`** casos ejecutados sin errores de red/contexto; `276/280` pasan `output_parse_ok`. Los **4** restantes (`iv1-args-10`, `iv1-args-12`, `iv1-args-13`, `iv1-args-16`) fallan exclusivamente por una limitación propia de `eval/core/client/mock.ts:92` (`mockValueFor` devuelve `"mock"` literal para propiedades `enum` requeridas como `action`, `section` y `setting`, no por defecto del dataset).

### Qué NO se cubrió o requiere entorno externo (`NO VERIFICADO`)
- Evaluación semántica real de `integral_v1` vs `prod` contra modelos **Ollama** activos.
- Validación AST real de PowerShell (`precheck_ok`) para `arguments` (`iv1-args-19`, `iv1-args-20`) y `eval:psvalid` bajo **Windows** con `powershell.exe`.
- Etapa `plan` con `TRIGGER: initial` (bloqueada por `EV-025`) y evaluación efectiva de `reviewFullView: true` / `sensitiveApprove = 0.65` (bloqueada por `EV-018`).

---

## 7. Pruebas pendientes para el usuario (`NO VERIFICADO`)

Las siguientes comprobaciones requieren entorno **Windows con `powershell.exe`** o un servidor **Ollama activo** con modelos descargados:

| # | Qué probar | Cómo ejecutarlo | Resultado esperado | Hallazgo asociado |
|---|---|---|---|---|
| 1 | Tests de `arguments` en Windows real | `npx tsx --test tests/eval_arguments.test.ts` (en PowerShell sobre Windows) | **27/27 tests en verde**, incluyendo `sintaxis PowerShell inválida` y `comando que no existe` rechazados por `analyzePowerShell` | `EV-002`, `EV-016` |
| 2 | Validador `eval:psvalid` sobre una corrida `arguments` real | `npm run eval:psvalid -- eval/results/<modelo>/<corrida>` (en Windows) | Informe con porcentaje real distinto de `0 %` si la corrida tiene comandos válidos y sin mezcla de `raw`/repeticiones | `EV-002` |
| 3 | Smoke completo en vivo contra Ollama | `npm run eval -- --dataset=smoke --stages=d0,route,arguments,final --thinking=both` | Corrida completa sin errores de red/timeout; verificar si `smoke` detecta regresiones y comparar tiempos con/sin descarga por falta de `keep_alive` | `EV-011`, `EV-013` |
| 4 | Ejecución real de `eval:cross` con `route`, D3 y D4 | `npm run eval:cross -- <carpeta_corrida>` | Sin crash en `getToolPolicy(serverOf(...))`; contrastar si casos `raw` o sin `expectedLabel` distorsionan los totales | `EV-003` |
| 5 | Bucle autónomo `--auto` con optimizador local 8K–16K + holdout | `npm run eval -- --auto --stage=args_review --dataset=<dev> --holdout=<holdout> --max-loops=3` | Confirmar si el prompt en reparación excede `num_ctx` del optimizador (`EV-021`) y si `conclusiones.md` conserva alertas de holdout (`EV-005`) | `EV-005`, `EV-021` |
| 6 | Comportamiento real de `eval:traces` sobre `jarvis-traces/` completo | `npm run eval:traces -- --dry-run` | Confirmar cuántos casos de `recovery` y `result_verification` se pierden o caen al fallback del último `callId` en trazas reales | `EV-007` |
| 7 | Comparativa real `prod` vs `integral_v1` con las 14 etapas en Ollama | `npm run eval -- --dataset=integral_v1 --variant=prod,integral_v1` | Corrida de `560` ejecuciones base sin errores fatales; comparar tasa de éxito por etapa entre `prod` e `integral_v1` y revisar los 6 casos `ev-018` | `EV-018`, `EV-011` |
| 8 | Validación `arguments` (`iv1-args-19`, `iv1-args-20`) en Windows real | `npm run eval -- --dataset=integral_v1 --variant=prod,integral_v1 --stages=arguments` (en Windows) y luego `npm run eval:psvalid -- eval/results/<modelo>/<corrida>` | Verificar que los comandos generados para `iv1-args-19` (`npm test` sin `&&`) e `iv1-args-20` (`Select-Object` sin `@{...}`) pasan `precheck_ok = true` con `powershell.exe` real | `EV-002` |

---

## 8. Áreas no cubiertas / pendientes para próximas auditorías

1. **Inspección de `jarvis-traces/**` reales (`.json` y `.json.gz`) y `jarvis-config.json`:** verificar tasas reales de `seq` duplicados, `linkedCallId` faltante y formato de schemas multilínea en los logs de producción guardados.
2. **Pruebas del resto de `tests/*.test.ts` (fuera de `eval_arguments` y `noul_cuts`):** comprobar si otras pruebas de `src/` reflejan contratos que `eval/` consume indirectamente (`contract.ts`).
3. **Validación en vivo de Windows + Ollama** (Sección 7) para pasar de `NO VERIFICADO` a `CONFIRMADO`/`DESATADO` los puntos dependientes de runtime real.

---

## 9. Historial de auditorías

| Fecha | Pasada | Enfoque | Cambios hechos al documento |
|---|---|---|---|
| 2026-11-21 | Pasada 1 | Auditoría inicial transversal: seguridad de `eval/auto`, entrypoints (`cli`, `auto`, `cross`, `psvalid`), `core` (`runner`, `datasets`, `scenario`, `traces`, `contract`, clientes), desalineación con `src/`, dependencias, tests y docs. | Creación de `AUDITORIA_EVAL.md` con `EV-001`..`EV-017`. *(Nota: la respuesta resumen inicial en chat mostró el informe duplicado; el archivo en disco contenía una única versión limpia de 292 líneas que se conservó íntegra sin pérdida de información).* |
| 2026-11-21 | Pasada 2 | Revalidación de `EV-001`..`EV-017` (modelo de amenaza + sonda en memoria de `EV-001`, separación bug vs Linux en `EV-002`, verificación de `EV-012`/`EV-017`) y cobertura completa de `eval/auto/*`, `fixtures/**`, las 14 etapas, todos los `graders/*`, `report`, `scoring`, `traces.ts`, UI y suites completas de tests. | Reclasificación de `EV-001` por escenario con evidencia empírica exacta; desdoble de `EV-002`; ampliación de `EV-011` (`decision.ts`), `EV-012` (confirmado vs `thread.ts`), `EV-013` (fixtures fugados) y `EV-017`; adición de **`EV-018`..`EV-024`**; actualización de tabla de dependencias con versiones instaladas y nueva Sección **"Pruebas pendientes para el usuario"**. |
| 2026-11-21 | Pasada 3 | Construcción y validación sin modelos reales del dataset integral (`eval/datasets/integral_v1.jsonl`, 280 casos = 20×14) y la variante completa (`eval/variants/integral_v1.ts`). | Adición de **`EV-025`** (incapacidad de `scenario.ts` para evaluar `plan` con `TRIGGER: initial`); fila nueva en matriz `eval ↔ src`; nueva Sección 6 **"Dataset y variante creados (Pasada 3)"** con distribución, supuestos, dependencias (`EV-018`, `EV-025`, `EV-012`, `EV-002`) y resultados de validación (`lint`, `--list`, `--dry-run`, `oracle` 280/280, `mock` 276/280); ampliación de pruebas pendientes en Ollama y Windows. |
