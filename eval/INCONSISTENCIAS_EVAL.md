# Auditoría e Inconsistencias de `eval/`

Diagnóstico integral del módulo `eval/` (alcance exclusivo `eval/`). Revisa compilación, contratos, fugas de memoria, E/S y rendimiento, bugs lógicos, sobreingeniería, código legacy, desalineación documental y cobertura de tests antes de iniciar refactors o nuevas funciones.

---

## Resumen ejecutivo

| Categoría | Crítico / Alto | Medio | Bajo | Principales focos |
|---|---:|---:|---:|---|
| 1. Compilación, dependencias y contratos rotos | 3 | 2 | — | 10 errores `tsc` en `eval/variants/`, imports inexistentes en `stageContract.ts`, `discover.ts` silencia errores |
| 2. Fugas de memoria, RAM y E/S | 2 | 4 | 1 | Leak ESM en `validateVariant.ts`, retención duplicada/triple de `RunRecord[]`, `analysisCache` global, re-lectura N×4 de archivos |
| 3. Bugs lógicos e inconsistencias | 4 | 5 | 2 | `runRootDir` indexado por modelo generativo, `DecisionClient` sin validación temprana, re-evaluación repetida de holdout, pérdida de `retryErrors`/`tokens` |
| 4. Sobreingeniería y duplicación | 2 | 2 | 1 | Parser TS manual (~500 líneas) en `validateVariant.ts` + `stageContract.ts` teniendo `esbuild`/`typescript`; CLI inconsistente entre `--auto` y normal |
| 5. Código legacy y desorden en `eval/variants/` | — | 3 | 2 | Variantes con `params`/`read` obsoletos, `runner/README.md` vacío, nombres mixtos (`Pending/` vs minúsculas, `d4/` vs `result_verification`) |
| 6. Documentación desalineada | — | 4 | 1 | `EJECUTAR_VARIANTES.md`, `conclusiones.md`, `GUIA_DECISION.md` y `MEJORES_VARIANTES.md` citan variantes borradas o afirmaciones falsas |
| 7. Brechas de tests | 1 | 2 | — | Sin test de compilación/carga de variantes activas ni cobertura de `cross.ts`, `psvalid.ts`, `exp/*` o holdout repetido |

**Hallazgos inmediatos de verificación estática (`npx tsc --noEmit`):**
- **`10` errores TypeScript dentro de `eval/variants/`** (`TS2724`, `TS2305`, `TS7006`), en 5 archivos de `continuation/` y `fragment_judge/`. *(Nota de contexto fuera de alcance: `tests/workspace_config.test.ts:6` también falla `TS2305`, no debe tocarse desde `eval/`.)*
- **`0` errores** actuales en la ejecución de `eval/core/eval_core.test.ts` y `eval/auto/eval_auto.test.ts` sobre los módulos core/auto, pero ninguno valida las variantes de `eval/variants/` en disco.

---

## 1. Compilación, dependencias y contratos rotos

### 1.1 [ALTO] 10 errores de TypeScript en 5 variantes activas de `eval/variants/`
`npx tsc --noEmit` falla sobre `eval/` debido a imports a símbolos inexistentes o movidos en `src/core/`:
- **`eval/variants/continuation/continuation_explicit_reference.ts:1`** y **`eval/variants/continuation/continuation_lean_focus.ts:1`**:
  - Importan `ContinuationDecisionInput` desde `../../../src/core/contracts.ts` (`TS2724`). El tipo en `contracts.ts` y en `eval/auto/stageContract.ts:483` es `ContinuationInput`.
- **`eval/variants/fragment_judge/fragment_judge_calibrated_signal.ts:1`**, **`fragment_judge_direct_evidence.ts:1`** y **`fragment_judge_signal_clean.ts:1`**:
  - Importan `FragmentJudgeInput` desde `../../../src/core/contracts.ts` (`TS2305`), cuando `FragmentJudgeInput` está exportado en `src/core/models/prompts.ts:285`.
  - Este fallo desencadena además `6` errores `TS7006` (parámetro implícito `any` en callbacks `(fragment, i)` dentro de esos tres archivos).

### 1.2 [ALTO] `discoverStageVariants` traga excepciones al cargar variantes (`eval/auto/discover.ts:172-174`)
- `discoverStageVariants` envuelve `await loadVariantSpec(name)` en un `try { ... } catch {}` vacío.
- Consecuencia: las 5 variantes con imports rotos (o cualquier variante que lance error en tiempo de carga) desaparecen silenciosamente del descubrimiento sin emitir ningún aviso al usuario, ocultando regresiones durante meses.

### 1.3 [ALTO] Contratos de imports en `stageContract.ts` y lista negra estática acoplada
- **`eval/auto/stageContract.ts:59`** instruye al modelo optimizador mediante `SHARED_IMPORTS_NOTE` qué helpers importar desde `src/core/models/prompts.ts`.
- Por otro lado, **`eval/auto/validateVariant.ts:42`** mantiene una lista negra manual `UNEXPORTED_PROMPTS_HELPERS` (`["ROUTE_HINTS", "POWERSHELL_RULES"]`) para bloquear helpers que `prompts.ts` no exporta. Si `src/core/models/prompts.ts` agrega o renombra exports, `stageContract.ts` y `validateVariant.ts` quedan desincronizados en silencio.

### 1.4 [MEDIO] Variante `ctx_pending_facts.ts` frágil por `.replace()` literal sobre `prod`
- **`eval/variants/ctx/ctx_pending_facts.ts:10-15`** construye su prompt ejecutando `.replace("reply with an empty list.", ...)` sobre `PROMPTS.PENDING_VIEW.SYSTEM` (y lanza un `Error` en carga si la subcadena desaparece).
- Viola la convención documentada de variantes (prompts explícitos e independientes de cambios menores de redacción en `src/`) y puede romper cargas en bloque en cuanto cambie esa frase en `prod`.

### 1.5 [MEDIO] Dependencia de `esbuild` en `devDependencies` para ejecución runtime de `--auto`
- **`eval/auto/validateVariant.ts:14`** importa `transformSync` desde `"esbuild"`, que figura en `devDependencies` de `package.json:40` (`"esbuild": "^0.28.2"`).
- Aunque `eval` es una herramienta de desarrollo, ya existe `"typescript": "^7.0.2"` en `devDependencies`; mantener lógica paralela de transformación con `esbuild` + parser regex manual agrega acoplamiento innecesario (ver sección 4.1).

---

## 2. Fugas de memoria, RAM y cuellos de botella de E/S

### 2.1 [CRÍTICO] Fuga de memoria sin cota en el módulo ESM de V8/Node (`eval/auto/validateVariant.ts:836-838`)
```ts
const mod = await import(`${pathToFileURL(filePath).href}?v=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
```
- Cada intento de compilación/validación en `--auto` genera una URL ESM distinta con query string (`?v=...`).
- En Node.js / V8, el registro interno del loader ESM **nunca libera** los módulos cargados ni sus closures/ASTs mediante GC mientras viva el proceso.
- En sesiones largas de `--auto` (hasta 2 variantes × 3 intentos × N vueltas, incluyendo variantes descartadas o movidas a `descartadas/`), el heap retiene de forma permanente todas las versiones fallidas e intermedias.

### 2.2 [ALTO] Retención duplicada/triple de `RunRecord[]` (con `rawInput` y `rawOutput`) y recálculo redundante
- **`eval/core/results.ts:114, 121-126`**: `createCellWriter` ya persiste cada línea en `runs.jsonl` conforme termina cada caso, pero además acumula todos los objetos completos en `records: RunRecord[]` y calcula `computeScoreSummary(records)` al cerrar en `close(meta)`.
- **`eval/core/runner.ts:607`**: `runWithConcurrency` vuelve a recolectar todos los `RunRecord` en otro array `records`.
- **`eval/core/batch.ts:166-176`**: filtra otra vez `result.records`, **vuelve a invocar `computeScoreSummary(writer.records)`** (cuando `writer.close(meta)` ya lo había calculado instantes antes) y guarda todos los `RunRecord[]` en `comparisonCells: InputCell[]`.
- **`eval/auto.ts:314, 397, 648`**: retiene `lastCells` con `records` completos (incluyendo `rawInput`/`rawOutput` de cientos de casos) en memoria entre vueltas mientras espera las respuestas del LLM optimizador.

### 2.3 [MEDIO] Caché global sin cota en `eval/core/stages/arguments.ts:20-28`
- `analysisCache = new Map<string, ReturnType<CommandAnalyzer>>()` está declarado a nivel de módulo sin límite máximo ni evicción LRU/TTL (a diferencia de `eval/cross.ts:78` y `eval/psvalid.ts:17`, donde el caché se crea acotado a la ejecución de la función).
- En corridas extensas o `--auto` multi-vuelta acumula entradas indefinidamente.

### 2.4 [MEDIO] Re-lectura y materialización repetida de `.jsonl` (`datasets.ts`, `cli.ts`, `validateVariant.ts`)
- **`eval/core/datasets.ts:190, 257`**: `loadFile` lee todo el archivo `.jsonl`, calcula el SHA-256 y materializa el escenario completo de cada línea **antes** de aplicar `filterCases` por `--stages`, `--ids` o `--limit`. En archivos mixtos como `smoke.jsonl` o al filtrar una sola etapa, se construyen escenarios innecesarios para descartarlos inmediatamente.
- **`eval/cli.ts:76` vs `eval/cli.ts:114`**: el CLI carga todos los datasets completos con `prod` en la línea 76 solo para calcular `totalCases` para la barra/cabecera, y en la línea 114 `runBatch` vuelve a cargar los mismos datasets desde cero desde disco.
- **`eval/auto/validateVariant.ts:691-692`**: dentro de `validateVariantFile`, por cada candidata y por cada intento de reparación vuelve a llamar a `loadDatasets(devPaths, { stages: [stage] }, variant)` desde disco de manera síncrona.

### 2.5 [MEDIO] Escaneo N+1 síncrono en caché inicial de `--auto` (`eval/auto/ranking.ts:229-297`)
- `scanReusableInitialRanking` recorre `(variantes × datasets × runDirs)` leyendo de forma síncrona `meta.json`, `scores.json` y el `runs.jsonl` completo.
- Si la última combinación `(variante, dataset)` carece de caché válido (`return null` en la línea 289), desecha todo el trabajo y los `RunRecord[]` ya leídos/parseados. Tampoco pre-filtra `runDirs` compatibles antes de entrar al doble bucle de variantes × datasets.

### 2.6 [MEDIO] Cuádruple recorrido recursivo de `eval/variants/` por cada carga (`eval/core/variants/load.ts:62-112`)
- Llamar a `loadVariantSpec(spec)` ejecuta:
  1. `loadVariant(spec)` -> `requireVariantFile(spec)` -> `variantMatches(spec)` (recorrido completo #1).
  2. `loadVariant(spec)` -> `variantFilePath(spec)` -> `variantMatches(spec)` (recorrido completo #2).
  3. `loadVariantSpec` -> `requireVariantFile(spec)` -> `variantMatches(spec)` (recorrido completo #3).
  4. `loadVariantSpec` -> `variantFilePath(spec)` -> `variantMatches(spec)` (recorrido completo #4).
- Para `N` variantes en Vuelta 0 de `--auto`, el árbol entero de `eval/variants/` se recorre `4N` veces.

### 2.7 [BAJO] Acumulación cuadrática `O(N²)` con operador spread en bucles
- `eval/core/report.ts:443`: `byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);`
- `eval/ui/views/comparison.ts:109`: `groups.set(k, [...(groups.get(k) ?? []), cell]);`
- `eval/cross.ts:174`: `tags.set(t, [...(tags.get(t) ?? []), r]);`
- Adicionalmente, `eval/cross.ts:203` y `eval/core/report.ts:293-300, 421-425` realizan búsquedas lineales (`cells.find`, `runs.filter`) dentro de bucles anidados. En todos estos casos conviene `list.push(...)` e indexación por `Map`.

---

## 3. Bugs lógicos e inconsistencias de comportamiento

### 3.1 [ALTO] `runRootDir` y caché de `--auto` indexan por el modelo generativo incluso en etapas de decisión
- **`eval/core/results.ts:63-68`** y **`eval/auto/ranking.ts:220-224`**: cuando `client === "real"`, `runRootDir` siempre guarda los resultados bajo `eval/results/<cfg.model>/` (modelo generativo), aunque todas las etapas evaluadas sean de decisión (`d0`, `route`, `tool_choice`, etc.) y el modelo evaluado real sea `cfg.decisionModel`.
- Ejemplo real observado: al correr `--auto --stage=d0 --decision-model=d3:2b-text --optimizer-model=qwen3.5:4b`, la carpeta creada fue `eval/results/qwen3.5_4b-text/2026-11-19_224745_auto_d0_r0`.
- Consecuencias: si el usuario cambia `--generative-model` (o usa distinto default) al evaluar una etapa de decisión, los resultados se mezclan en carpetas equivocadas o el caché reutilizable de `--auto` deja de encontrarse.

### 3.2 [ALTO] Asimetría de validación en `DecisionClient` y error `config:` no abortado en `runner.ts`
- **`eval/core/client/generative.ts:70-81, 178`** valida `cfg.url` al construir el cliente (lanza excepción si falta o si apunta a `/generate` o `/api/chat`).
- **`eval/core/client/decision.ts:50-65`** no valida `cfg.url` en `createDecisionClient`; devuelve `{ ok: false, error: "config: la URL de Decision 2.0 no está configurada..." }` dentro de cada `call()`.
- En **`eval/core/runner.ts:598-601`**, `isTransportError` (`generative.ts:45-47`) solo detecta prefijos `"timeout"`, `"network:"` y `"http_"`, **no `"config:"`**. Resultado: cuando falta la URL de decisión, `networkFailCount` queda en `0` y el runner recorre todo el dataset entero grabando errores de configuración caso por caso en lugar de abortar con código de salida `2`.
- Complementariamente, **`eval/cli.ts:131`** atrapa cualquier error de `createEvalClients(cfg)` con el mensaje fijo `"Error de configuración de URL generativa: ..."`, incorrecto si el fallo proviene del cliente de decisión.

### 3.3 [ALTO] `--auto` puede re-evaluar `--holdout` repetidamente con la misma variante (`eval/auto.ts:551-583`)
- Si una variante `!= prod` alcanza `>= target` en `dev`, falla la verificación en `--holdout`, y continúa siendo la mejor candidata no-`prod` en la vuelta siguiente (por ejemplo porque ninguna variante nueva superó su `dev` score), `eval/auto.ts` vuelve a disparar la evaluación contra `--holdout` sobre **la misma variante**, consumiendo tiempo, ensuciando estadísticas de holdout y duplicando alertas en `conclusiones.md`.

### 3.4 [ALTO] `--auto` no registra ni avanza estado cuando `validVariants.length === 0` (`eval/auto.ts:497-500`)
- Si el optimizador devuelve propuestas que fallan la validación tras todos los reintentos, la iteración ejecuta `continue` sin registrar el fallo en `conclusiones.md` ni actualizar `auto_state.json`.
- Puede consumir todas las vueltas restantes enviando exactamente el mismo contexto y obteniendo el mismo fallo repetido.

### 3.5 [MEDIO] `runGenerative` descarta `retryErrors` y `tokens` si falla tras reintentos por parseo (`eval/core/runner.ts:393-439`)
- En `runDecision` (`runner.ts:284`), si un intento previo falló por parseo y el último falla en cliente, se preservan `retryErrors` en `warnings`.
- En `runGenerative` (`runner.ts:424-439`), si `!result.ok` tras `attempt > 0`, los `retryErrors` acumulados **se descartan** (no entran en `warnings`) y los `tokens` de intentos anteriores **se omiten** del registro final. Además `rawInput` guarda el cuerpo del último intento con nota de error mientras `requestHash` corresponde al hash base del intento 0.

### 3.6 [MEDIO] `conclusiones.md` generada por el LLM sin validación factual (`eval/auto/optimizer.ts:622-627`, `eval/auto.ts:622-624`)
- Cuando el optimizador responde con `conclusions.update === true`, `eval/auto.ts` sobreescribe íntegramente `conclusiones.md` sin verificar estructura mínima ni contrastar cifras contra los resultados reales de la vuelta, permitiendo que modelos pequeños alucinen scores o variantes inexistentes y propaguen errores a vueltas siguientes.

### 3.7 [MEDIO] Validación por etapa en `validateVariant.ts` desalineada con `stages/*.ts`
- **`eval/auto/validateVariant.ts:742`**: para `fragment_judge`, solo verifica que el request devuelto incluya `f0` pero no comprueba `f1..fN` según `FRAGMENT_BATCH_SIZE` / `buildRequest`.
- **`eval/auto/validateVariant.ts:748-754`**: para `recovery`, rechaza cualquier salida que no coincida con un shape rígido único aunque **`eval/core/stages/recovery.ts:63`** sí soporta variantes multi-eje (como `recovery_two_axes`).

### 3.8 [MEDIO] Inconsistencias en caché de `--auto` y persistencia no atómica
- **`eval/auto/ranking.ts`**: `scanReusableInitialRanking` no invalida si cambia `--include-shortcut` ni si cambia el contenido de `conclusiones.md` de arranque; además exige coincidencia exacta `meta.model === cfg.model && meta.decisionModel === cfg.decisionModel` incluso en etapas puras de decisión donde `cfg.model` es irrelevante.
- **`eval/core/results.ts:114-130`**: `meta.json` y `scores.json` se escriben directamente sin `writeTmp + rename` atómico ni bandera `completed: true`; un proceso interrumpido con `Ctrl+C` deja directorios huérfanos parciales en `eval/results/`.
- **`eval/auto/feedback.ts:165-181`**: `extractFailureSamples` toma solo el primer fallo (`recs.find((r) => !r.passed)`), perdiendo la tasa de intermitencia cuando `--repeat > 1`, y agrupa `devDatasetNames` por nombre simple en vez de ruta resuelta.

### 3.9 [MEDIO] Bugs en scripts satélite (`eval/cross.ts`, `eval/psvalid.ts`, `eval/exp/*`)
- **Split `<variant>__<dataset>` inconsistente**: `cross.ts:139,253` y `psvalid.ts:32` usan `lastIndexOf("__")`, mientras **`eval/exp/d0_rules.ts:87`** y **`eval/exp/noul_cuts.ts:112`** usan `indexOf("__")` (se rompe con cualquier variante que contenga `__` en su nombre).
- **`eval/psvalid.ts:29-37`**: lee `readdirSync(dir)` sin comprobar `existsSync(dir)` y llama a `JSON.parse` sin `try/catch`; usa `String.fromCharCode(10)` (igual que `cross.ts:256`) en lugar de `/\r?\n/` (frágil en Windows con CRLF).
- **`eval/cross.ts:195, 146, 259-260`**: hardcodea `baseline = "prod"` y `r.iteration === 1`; además en la línea 260 aproxima `D4` con `Math.min(ok, cumple) >= NOUL_APPROVE` en lugar de usar los umbrales reales (`OK_APPROVE = 0.3` y `NOUL_APPROVE = 0.6`).
- **`eval/exp/noul_cuts.ts:135`**: bucle fijo `for (let i = 0; i < 5; i++)` en lugar de leer `JUDGE_BATCH` o las claves `f\d+` presentes.
- **`eval/exp/d0_rules.ts:17`** y **`eval/exp/noul_cuts.ts:24`**: importan directamente desde `../../src/core/types/firstQuery.ts` saltándose el barrel `eval/core/contract.ts`.

### 3.10 [BAJO] `printGlobalSummary` sin guarda de arreglo vacío (`eval/ui/views/run.ts:85-86`)
- Calcula `Math.max(...rows.map(...))` sin `if (rows.length === 0) return;` (devuelve `-Infinity` si `cells` está vacío), a diferencia de `comparison.ts:51,103` y `style.ts:97` que sí protegen el caso vacío.

### 3.11 [BAJO] Detalles menores de CLI y UI (`eval/cli.ts:174-175`, `eval/ui/style.ts:33`)
- `eval/cli.ts:174-175` imprime cada run con `console.log` plano por fuera de los helpers visuales de `eval/ui/`.
- `eval/ui/style.ts:33` fija `WIDTH` una sola vez al cargar el módulo; no se adapta si la terminal cambia de ancho ni tiene fallback explícito más allá del inicial.

---

## 4. Sobreingeniería y duplicación arquitectónica

### 4.1 [CRÍTICO] ~1,723 líneas de parsing TS manual y contratos duplicados (`stageContract.ts` + `validateVariant.ts`)
- **`eval/auto/validateVariant.ts` (877 líneas)**: aunque ya importa `esbuild.transformSync` (línea 14), implementa ~400 líneas de lexer y parser manual sobre texto TS (`maskCodePreserveOffsets`, `findMatchingBrace`, `parseTopLevelObjectEntries`, `findExportedVariantObjectBrace`, `applyNameOverride`, `checkImportsAndExports`, líneas 125–542):
  - `maskCodePreserveOffsets` no ignora literales RegExp (ej. `/[/}]/g`), por lo que un regex en un prompt o helper puede desbalancear llaves y romper el parser.
  - Renombrar `name` parcheando el texto del objeto exportado o verificar exports puede resolverse usando el compilador/AST oficial de TypeScript (ya presente en `devDependencies`) o un wrapper de re-export, eliminando cientos de líneas frágiles.
  - `validateStageRequestsAndContext` (líneas 707–763) reimplementa en un `if/else if` gigante las reglas de preguntas de las 9 etapas de decisión ya definidas en `eval/core/stages/*.ts`.
- **`eval/auto/stageContract.ts` (846 líneas)**:
  - `extractProdPromptSource` (líneas 750–845) es un segundo parser manual con máquina de estados para extraer prompts desde `src/core/models/prompts.ts` (tampoco maneja literales RegExp con `{}` ni arrow functions asignadas con `=`).
  - Duplica descripciones de preguntas, bindings y contratos que ya viven en `eval/core/stages/*.ts` y `eval/core/graders/*.ts`.

### 4.2 [MEDIO] Parseo de CLI duplicado e inconsistente entre modos y scripts
- En modo normal (`eval/core/config.ts:94`), `--decision-model` está **explícitamente prohibido** en `RENAMED_FLAGS` (obliga a `--model=+<dec>` o `gen+dec`), mientras que en `--auto` (`eval/auto/config.ts:70-71`) `--decision-model` y `--generative-model` **son los flags oficiales**.
- **`eval/cross.ts:53`**, **`eval/exp/d0_rules.ts:58`** y **`eval/exp/noul_cuts.ts:57`** reimplementan parseadores de `--flag=valor` ad-hoc en lugar de compartir una utilidad mínima común.

### 4.3 [BAJO] Generación ad-hoc de IDs (`results.ts:135`, `auto.ts:97`)
- `newRunId` en `eval/core/results.ts:135` hace `sha256(Math.random() + Date.now()).slice(0, 16)` y `makeRunTag` en `eval/auto.ts:97` usa `Math.random().toString(36)` en lugar de `randomUUID()` / `randomBytes()` de `node:crypto`.

---

## 5. Código legacy y desorden en `eval/variants/`

### 5.1 [MEDIO] Variantes activas con formato obsoleto (`params` / `read`) mezcladas con variantes vigentes
Según la documentación y la limpieza de Decision 2.0, `params` y `read` no forman parte del contrato actual de variantes, pero siguen activos y descubribles en `eval/variants/`:
- **Con `params` heredado (3 archivos en `Pending/`):** `pending2.ts`, `pending2_obj.ts`, `pending2_exp.ts` (acopladas al formato `rich` del experimento antiguo `PendingGrader.gradeRich` en `eval/core/graders/pending.ts:75-114`).
- **Con `read` heredado (5 archivos):**
  - `eval/variants/d5/d5_it6_move_aware_choice.ts`, `d5_it7_apex_choice.ts`, `d5_it8_apex_calibrated.ts`
  - `eval/variants/fragment_judge/fragment_judge_ternary.ts`
  - `eval/variants/args_review_D3/args_review_choice_plus_probe.ts`

### 5.2 [MEDIO] Carpeta huérfana y documentación fragmentada dentro de `eval/variants/`
- **`eval/variants/runner/README.md`**: describe una campaña y convención obsoleta (`run_<etapa>_<hipotesis>.ts` y `docs/evaluacion/PLAN_DE_MEDICION.md`) sin ningún `.ts` en la carpeta.
- **`eval/variants/ctx/`**: contiene 5 experimentos (`ctx_*.ts`, incluyendo el frágil `ctx_pending_facts.ts`) separados de las carpetas de etapas.
- **Archivos `conclusiones_*.md` dispersos** en 9 subcarpetas (`args_review_D3`, `arguments`, `d4`, `final`, `Pending`, `plan`, `question`, `route_D1`, `tool_choice_D2`), duplicando o quedando desactualizados frente a `eval/conclusiones.md` y `eval/variants/_auto/<etapa>/conclusiones.md`.
- **`eval/variants/decision_all_stages_example.ts`** vive en la raíz de `variants/` como plantilla y obliga a una exclusión hardcodeada en `eval/auto/discover.ts:152`.

### 5.3 [BAJO] Nomenclatura inconsistente de subcarpetas de variantes
- Mezcla de mayúscula inicial (`Pending/` vs el resto en minúscula), sufijos históricos de versión (`route_D1/`, `tool_choice_D2/`, `args_review_D3/` frente a `d0/`, `d4/`, `d5/`), y carpeta `d4/` mientras la etapa y los datasets se llaman `result_verification` / `verify_*`.

---

## 6. Documentación desalineada con el código real

- **`eval/EJECUTAR_VARIANTES.md`**:
  - Línea 3 afirma `"todo compila (npx tsc --noEmit)"` -> falso hoy (10 errores en `eval/variants/`).
  - Cita variantes ya eliminadas (`tool_choice_nomarker`, `tool_choice_request`, `d0_multi_nocriteria`, `d4_cumple_goal_aware`) y sugiere `--concurrency=2` pese a que `INSTRUCCIONES.md` y `GUIA_DECISION.md` advierten que distorsiona latencias locales.
- **`eval/conclusiones.md`**:
  - La tabla "Top 3 Variantes Conservadas" de la sección 2 no refleja el inventario real en disco: `d0/` tiene 9 `.ts`, `Pending/` 20 `.ts`, `question/` 13 `.ts`, `final/` 9 `.ts`, `arguments/` 9 `.ts`, `fragment_judge/` 8 `.ts`, `tool_choice_D2/` 6 `.ts`, `d4/` 6 `.ts`, `d5/` 5 `.ts`, `continuation/` 5 `.ts`, `recovery/` 4 `.ts`, `plan/` 4 `.ts`; además cita `d0_multi_nocriteria` (eliminada).
- **`eval/GUIA_DECISION.md`**:
  - Línea 5 lista 8 etapas de decisión olvidando `continuation`.
  - Línea 106 afirma `"--dataset=recovery no se resuelve"` de forma confusa respecto a cómo `expandShortSpec` (`eval/core/datasets.ts:81-97`) busca archivos vs carpetas.
  - Líneas 129–135 y 147 referencian variantes ya eliminadas (`recovery_three_options.ts`, `recovery_calibrated_synthesis`, `recovery_neutral_labels`).
- **`eval/MEJORES_VARIANTES.md`**:
  - Registro histórico (2026-11-09) con encabezado roto en líneas 142–145 (falta título antes de la ronda 1) y múltiples variantes eliminadas (`route_lean_direct`, `tool_choice_direct`, `args_review_compact_history`, etc.) sin aviso de documento histórico/archivado respecto a `eval/conclusiones.md`.
- **`eval/ui/views/help.ts:28`**:
  - Muestra flags de `--auto` distintos al modo estándar (`--decision-model` vs `--model=gen+dec`) sin explicar la convivencia ni el motivo de que `--decision-model` dé error fuera de `--auto`.

---

## 7. Brechas en la suite de tests (`eval/core/eval_core.test.ts` y `eval/auto/eval_auto.test.ts`)

1. **[ALTO] Sin test de compilación y carga de variantes activas**: ninguna prueba importa o valida sintácticamente todos los archivos `.ts` de `eval/variants/`, lo que permitió que 5 variantes con imports rotos permanecieran ocultas tras el `catch {}` de `discover.ts`.
2. **[MEDIO] Casos de borde faltantes en `--auto`**:
   - Re-evaluación repetida de `--holdout` sobre la misma variante top no-`prod`.
   - Vuelta con `0` variantes válidas y actualización de `auto_state.json`.
   - `maskCodePreserveOffsets` / parser TS frente a literales RegExp o comillas escapadas.
3. **[MEDIO] Sin cobertura de scripts y guardas auxiliares**:
   - No hay tests para `eval/cross.ts`, `eval/psvalid.ts`, `eval/exp/*` (split `__`, EOL `\r\n`), ni para `printGlobalSummary([])` o error `config:` en `DecisionClient`.

---

## 8. Plan de limpieza y refactorización sugerido (por fases)

### Fase 1 — Fixes críticos de compilación, contratos y abortos (bajo riesgo, alto impacto)
1. Corregir los 5 imports rotos en `eval/variants/continuation/*` (`ContinuationInput`) y `eval/variants/fragment_judge/*` (`FragmentJudgeInput` desde `prompts.ts` + tipos explícitos) y verificar `npx tsc --noEmit` en `eval/`.
2. Eliminar el `try/catch` silencioso en `eval/auto/discover.ts:172` (emitir warning explícito y fallar en test si una variante activa no carga).
3. Validar `cfg.url` en `createDecisionClient` igual que en `createGenerativeClient`, corregir el mensaje de error en `eval/cli.ts:131`, y tratar errores `config:` como fatales en `eval/core/runner.ts`.
4. Corregir `runGenerative` en `eval/core/runner.ts` para conservar `retryErrors` y `tokens` acumulados al fallar tras reintentos.
5. Corregir `printGlobalSummary` para arreglos vacíos y ajustar `indexOf("__")` -> `lastIndexOf("__")` y guardas en `eval/exp/*`, `eval/psvalid.ts`, `eval/cross.ts`.

### Fase 2 — Correcciones lógicas de `--auto` y carpetas de resultados
1. En `eval/core/results.ts` (`runRootDir`) y `eval/auto/ranking.ts`: indexar las corridas de etapas puras de decisión bajo el identificador de `decisionModel` (o un prefijo claro por cliente/modelo evaluado), evitando mezclar resultados bajo el modelo generativo.
2. En `eval/auto.ts`: evitar re-evaluar `--holdout` sobre una variante ya evaluada y rechazada en una vuelta anterior; registrar explícitamente las vueltas con `0` variantes válidas en `auto_state.json` y `conclusiones.md`.
3. Añadir validación estructural mínima antes de sobreescribir `conclusiones.md` desde la salida del optimizador.
4. Alinear `validateStageRequestsAndContext` con `eval/core/stages/*.ts` (soportar `f0..fN` en `fragment_judge` y variantes multi-eje válidas en `recovery`).

### Fase 3 — Memoria, E/S y simplificación arquitectónica
1. Mitigar el leak ESM en `eval/auto/validateVariant.ts`: ejecutar la importación/validación dinámica en un subproceso/worker efímero (o `vm`/runner aislado por lote) para que V8 libere los módulos de variantes temporales/descartadas al terminar cada validación.
2. Eliminar retención redundante de `RunRecord[]` en `results.ts` / `runner.ts` / `batch.ts` / `auto.ts` (conservar solo resúmenes + muestra acotada de fallos en RAM, leyendo `runs.jsonl` bajo demanda).
3. Acotar `analysisCache` en `eval/core/stages/arguments.ts`, cachear el índice de `eval/variants/` en `variants/load.ts` (de `4N` recorridos a `1`), y evitar materializar casos que luego descarta `filterCases` o re-leer datasets en `cli.ts` / `validateVariant.ts`.
4. Reemplazar los parsers TS manuales de `validateVariant.ts` y `extractProdPromptSource` en `stageContract.ts` usando la Compiler API de `typescript` (ya instalada en `devDependencies`) y derivando contratos directamente desde `eval/core/stages/*.ts`.
5. Unificar las banderas `--decision-model` / `--generative-model` / `--model` entre `eval/core/config.ts` y `eval/auto/config.ts`.

### Fase 4 — Limpieza de legacy, documentación y tests
1. Decidir qué hacer con las variantes legacy (`Pending/pending2*.ts` con `params`, variantes con `read` obsoleto, `ctx_pending_facts.ts` con `.replace()`, `eval/variants/runner/README.md`, `conclusiones_*.md` dispersos): migrar las útiles al formato vigente o moverlas a archivo histórico/descartadas.
2. Actualizar `eval/EJECUTAR_VARIANTES.md`, `eval/conclusiones.md`, `eval/GUIA_DECISION.md`, `eval/MEJORES_VARIANTES.md` y `eval/ui/views/help.ts` para que coincidan 1:1 con el código y los archivos reales.
3. Añadir un test en `eval/auto/eval_auto.test.ts` (o `eval_core.test.ts`) que verifique que todas las variantes activas de `eval/variants/` compilan y cargan correctamente, además de tests para holdout repetido, vuelta sin variantes válidas y scripts auxiliares.
