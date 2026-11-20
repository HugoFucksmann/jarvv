# Auditoría e Inconsistencias Consolidadas de `eval/` (2026-11-20)

Documento único y verificado contra el código y archivos vigentes (`eval/`, `src/` y `tests/`). Consolida los hallazgos resueltos en esta ronda (Bloque A + sincronización documental) y los puntos que permanecen abiertos o diferidos por decisión del usuario.

## Estado verificado (comprobaciones ejecutadas)

| Comprobación | Resultado | Detalle |
|---|---|---|
| `npm run lint` (`npx tsc --noEmit`) | **Pasa** | `0` errores de TypeScript |
| `npx tsx --test eval/core/eval_core.test.ts eval/auto/eval_auto.test.ts` | **32 pasan, 0 fallan** | 12 suites; `eval/variants/_auto/` ya no se crea ni queda residual |
| `npm run eval:smoke` / `npx tsx eval/psvalid.ts --help` / `npx tsx eval/cli.ts --list` | **Pasa** | Salida `0`; `14 etapas · 105 variantes · 91 datasets · 2464 casos` |
| Grafo de imports en `eval/` (`madge --circular --extensions ts`, `.madgerc = {}`) | **0 ciclos** | `172` archivos analizados sin excluir ciclos de tipos |
| `npx tsx --test --test-timeout=30000 tests/eval_arguments.test.ts tests/noul_cuts.test.ts` | **19 pasan, 2 fallan** | Las únicas 2 fallas son `tests/eval_arguments.test.ts:85-86` (PowerShell en Linux, diferido) |

---

## A. Pendientes, diferidos o sin decisión del usuario (NO tocados)

### A.1 [ALTO — Diferido] Falso positivo silencioso en análisis PowerShell en Linux (`src/core/engine/precheck.ts:364-375` / `tests/eval_arguments.test.ts:85-86`)
- En Linux (sin `pwsh` ni `powershell.exe`), `precheck.ts:364-375` atrapa `ENOENT` y devuelve `null` ("sin errores"), provocando que fallen los 2 casos de rechazo por sintaxis PowerShell inválida y comando inexistente en `tests/eval_arguments.test.ts:85-86`. Quedó diferido por el usuario.

### A.2 [MEDIO — Sin nuevas funcionalidades] `arguments` no ejercita `priorAttempts > 0` (`desalineaciones-eval.md` D8)
- `eval/core/stages/arguments.ts` llama siempre a `argsInput(...)` con `priorAttempts = 0` (`temperature = 0.1`), sin cubrir la subida de temperatura (`0.3` / `0.5`) en reintentos de producción (`src/core/engine/adapters.ts`). No se agregó para no introducir nuevas funcionalidades.

### A.3 [MEDIO — Pendiente] `at.attempts` en `recovery` mide magnitudes distintas (`PENDIENTES_CODIGO.md` §9.1)
- En producción (`src/core/engine/recoveryShadow.ts:13, 58`), `attempts` cuenta **pasos fallidos seguidos**.
- En los datasets vigentes de `eval/datasets/recovery/` (`eval/datasets/recovery/README.md:33`), `at.attempts` cuenta **llamadas fallidas** del caso. Se aclaró la diferencia en `eval/INSTRUCCIONES.md`, dejando datasets y `src/` sin cambios.

### A.4 [MEDIO — Pendiente de decisión sobre `src/`] `tool_choice_desc_a` aprobada en `eval/conclusiones.md` sin aplicar en `src/`
- `eval/conclusiones.md` marca `tool_choice_desc_a` como confirmada en dev/holdout e indica actualizar `src/core/tools/manifest.ts:206`; en `src/` sigue el texto anterior.

### A.5 [BAJO — Sin nuevas funcionalidades] Conversor de trazas reales `jarvis-traces/` → escenarios (`PENDIENTES_EVAL.md` §6)
- No existe script que convierta carpetas de `jarvis-traces/` a `.jsonl` de `eval/datasets/`. No se agregó por la restricción de no incorporar funcionalidades nuevas.

### A.6 [Pendientes de decisión de diseño / alcance]
- **Caché ESM de V8 en `--auto` (`eval/core/variants/load.ts` / `eval/auto.ts`):** las candidatas válidas aceptadas durante una sesión de `--auto` se importan vía ESM en el proceso principal (V8 no descarga módulos ESM hasta terminar el proceso). Queda pendiente decidir si aislar cada evaluación de variante en un subproceso/worker.
- **Validación de porcentajes en `eval/auto/conclusions.ts` (`validateConclusionsMarkdown`):** la expresión regular sigue comparando cualquier `` `variante` (XX%) `` contra el `score` global de la ronda actual, pudiendo rechazar porcentajes legítimos de un dataset individual, holdout o rondas previas.
- **Flags y baseline en `eval/cross.ts`:** sigue ignorando flags desconocidos en silencio (vs `parseArgvFlags` estricto) y fijando `baseline = "prod"` / `iteration === 1`.
- **Reorganización de `eval/variants/` y `conclusiones_*.md`:** persisten nombres mixtos de subcarpetas (`Pending/`, `route_D1/`, `tool_choice_D2/`, `args_review_D3/` vs `d0/`, `d4/`, `d5/`, `ctx/`) y archivos históricos `conclusiones_*.md` repartidos en subcarpetas.

---

## B. Resueltos en esta intervención (Bloque A + sincronización documental)

1. **Aislamiento de tests de `--auto` y eliminación de basura en disco (`eval/auto/eval_auto.test.ts`, `eval/auto/config.ts`, `eval/auto/discover.ts`, `eval/auto/ranking.ts`, `eval/auto/validateVariant.ts`, `eval/auto/optimizer.ts`, `eval/auto.ts`):**
   - Inyectado `variantsRoot` en `AutoLoopDeps` y helpers de `eval/auto/`; `eval_auto.test.ts` corre íntegramente en un directorio temporal en `os.tmpdir()` con symlinks a `src` y `eval/core` y copia de `prod.ts`, sin tocar `eval/variants/_auto/`.
   - Eliminadas las carpetas obsoletas `eval/variants/_auto/` y `eval/variants/_archivo_legacy/`.
2. **Suite `npm test` y cobertura de variantes activas (`package.json`, `eval/core/eval_core.test.ts`):**
   - `package.json` `"test"` ahora incluye `eval/core/*.test.ts` y `eval/auto/*.test.ts`.
   - `eval/core/eval_core.test.ts` valida la carga y forma de las **105 variantes activas** de `eval/variants/` (reemplazando la lista reducida anterior).
3. **Alineación `eval/` ↔ `src/` en reintentos e idioma:**
   - Eliminado el reintento por respuesta inválida en `runDecision` (`eval/core/runner.ts`), alineado con `src/core/engine/failures.ts` (decisión determinista; D16 resuelto en `docs/evaluacion/desalineaciones-eval.md`).
   - Traducido `retryNote` en `src/core/models/prompts.ts` al inglés (`PREVIOUS_ERROR: ...`).
4. **Cero dependencias circulares y fachada limpia (`/.madgerc`, `eval/core/contract.ts`, `eval/core/stages/types.ts`, `eval/core/report-types.ts`):**
   - `.madgerc` quedó en `{}` (sin `skipTypeImports: true`) y `madge --circular` reporta **0 ciclos** tras extraer `eval/core/stages/types.ts` y `eval/core/report-types.ts`.
   - Todos los módulos de `eval/` (fuera de `eval/variants/` y plantillas literales) importan `src/core/` exclusivamente a través de `eval/core/contract.ts`.
   - Movidos los `import` de `eval/core/client/generative.ts` al inicio del archivo.
5. **Reemplazo de parsers TS manuales y validación de variantes (`eval/auto/tsScanner.ts`, `eval/auto/stageContract.ts`, `eval/auto/validateVariant.ts`):**
   - Creado `eval/auto/tsScanner.ts` usando el scanner oficial de `typescript` (`createScanner`), eliminando las ~500 líneas de parsers manuales en `stageContract.ts` y `validateVariant.ts` (con soporte correcto para template literals anidados, regex con llaves y `import type` / `export { ... } from ...`).
   - Agregado `realpathSync` en `validateImportSpecifier` y delegada la validación específica de `DecisionRequest` por etapa a `getStage(stage).validateRequest`.
6. **Memoria, streaming, caché y escrituras atómicas:**
   - `eval/core/results.ts` y `eval/core/batch.ts` reducen payloads retenidos en RAM (`rawInput`, `rawOutput`, `parsedOutput`, etc.) exponiendo `cellDir`, usando escritura asíncrona por lotes/stream (`WriteQueue`) y `atomicWriteFileSync` (`.tmp` + `renameSync`), compartido también por `eval/core/report.ts`, `eval/auto/conclusions.ts` y `eval/auto/ranking.ts`.
   - `eval/auto/feedback.ts` y `eval/auto/ranking.ts` hidratan `runs.jsonl` bajo demanda en streaming (`forEachJsonlLineSync`), filtran `devDatasetPaths` por ruta resuelta y calculan tasa de fallos cuando `--repeat > 1`. `archiveLosingAutoVariants` resuelve colisiones de nombre en `descartadas/` e invalida el caché de variantes.
   - `eval/core/variants/load.ts` mantiene índice cacheado por `variantsRoot`, valida ambigüedad por duplicados y expone `invalidateVariantCache`.
   - `eval/core/datasets.ts` / `eval/cli.ts` / `eval/auto.ts` / `eval/ui/views/list.ts` comparten `RawDatasetCache` y usan `inspectDatasetHeaders` para `--list` sin materializar prompts.
   - `eval/core/stages/arguments.ts` usa caché LRU y limpia entradas si rechaza la promesa.
7. **Eliminación de código legacy y mejoras menores de CLI/UI:**
   - Retirados `ParamsOverride`, `ReadAnswer`, `DecisionReaders`, `Variant.params`, `Variant.read`, `readAllAnswers`, `PendingOutput.rich`, `gradeRich`, variantes de `recovery` en 2 ejes (`recovery_two_axes` rechazada en validación/tests) y aserciones heredadas.
   - Agregado `--help` en `eval/psvalid.ts` y ancho de terminal dinámico (`getTerminalWidth()`) en `eval/ui/style.ts`.
8. **Documentación sincronizada:**
   - Actualizados `eval/datasets/INDEX.md` (91 archivos, 2 464 casos, 14 etapas, sin referencias rotas a `eval/exp/memory_matching*`), `eval/datasets/recovery/README.md`, `eval/core/stages/recovery.ts`, `eval/INSTRUCCIONES.md`, `eval/README.md`, `docs/evaluacion/PLAN_DE_MEDICION.md`, `docs/evaluacion/DISENO_EVAL_AUTONOMO.md` y `docs/evaluacion/desalineaciones-eval.md`.

---

## C. Confirmados previamente como resueltos (referencia)

- Variantes de `continuation/` y `fragment_judge/` compilando con `0` errores; `discover.ts` avisa errores en lugar de tragarlos.
- `evaluatedModelDirName` en `results.ts` y `ranking.ts`, caché en 2 fases de `ranking.ts`, anti-re-evaluación repetida de holdout y registro de vueltas sin variantes válidas en `auto.ts`.
- Validación temprana de URL en `client/decision.ts`, prefijo `config:` fatal en `runner.ts`, `runGenerative` preservando `retryErrors`/`tokens`, y `newRunId`/`makeRunTag` con `randomUUID()`.
- Eliminación de acumulación `O(N²)` en `report.ts`/`comparison.ts`/`cross.ts`; arreglos de `lastIndexOf("__")`, CRLF y guardas en `psvalid.ts`, `cross.ts`, `d0_rules.ts`, `noul_cuts.ts` y `printGlobalSummary([])`; unificado `--decision-model`/`--generative-model` en `core/config.ts`.
