# Pendientes y Estado Actual de `eval/` (2026-11-20)

Documento vivo con **lo que falta en `eval/`** (los ítems ya resueltos y los `conclusiones_*.md` históricos fueron limpiados). Verificado contra `eval/`, `src/`, `docs/pendientes/` y `docs/evaluacion/`.

## Estado verificado (comprobaciones sin GPU)

| Comprobación | Resultado | Detalle |
|---|---|---|
| `npm run lint` (`npx tsc --noEmit`) | **Pasa** | `0` errores de TypeScript |
| `npx tsx --test eval/core/eval_core.test.ts eval/auto/eval_auto.test.ts` | **36/36 pasan** | 12 suites |
| `npm run eval:smoke` / `eval:cross` / `eval/psvalid.ts --help` / `eval/auto.ts --help` / `eval/traces.ts --help` | **Pasa** | Salida `0` |
| `npx tsx eval/cli.ts --client=oracle` | **100 %** | `14` etapas · `105` variantes · `91` datasets · `2 464` casos (`2 351` canónicos + `113` `isRaw`) |
| `npx madge --circular --extensions ts eval` | **0 ciclos** | `.madgerc = {}` |

---

## 1. Pendientes técnicos dentro de `eval/`

1. **Orden de nombres en `eval/variants/`:**
   - Persisten nombres mixtos de subcarpetas (`Pending/`, `route_D1/`, `tool_choice_D2/`, `args_review_D3/` frente a `d0/`, `d4/`, `d5/`, `ctx/`).

---

## 2. Mediciones pendientes con modelos y scripts offline

Detalle de comandos listos para correr en [`EJECUTAR_VARIANTES.md`](./EJECUTAR_VARIANTES.md) (cruzado con `docs/pendientes/PENDIENTES_EVAL.md` y `docs/evaluacion/PLAN_DE_MEDICION.md`):

- **Calibración offline sin modelo (`eval/exp/d0_rules.ts`, `eval/exp/noul_cuts.ts`):** requiere carpetas con `runs.jsonl` reales de `prod` (actualmente no hay corridas guardadas en el workspace).
- **`args_review` (D3, `PENDIENTES_EVAL.md` §1):** medir `args_review_fullview_clean` y `args_review_compact` en `args_review_*` y cruzar con `eval:cross` (`reviewFullView` sigue apagado en `src/`). `reviewReads` requiere tareas reales end-to-end.
- **`d5` (`PENDIENTES_EVAL.md` §3):** medir `d5_variedad` + `d5_close_check` (`d5_evidence_strict`, `d5_noul_calibrated`) y contrastar `completionCoverageGuard` contra trazas reales.
- **`web_search` / `fragment_judge` y `TODAY` en D4 (`PENDIENTES_EVAL.md` §4):** falta medir regresiones en `result_verification` al agregar `TODAY` en búsquedas web y medir multiparte/recencia cuando se implemente la guarda en `src/`.
- **`arguments` (`PLAN_DE_MEDICION.md` 2.5 / `INFORME_MEDICION_2026-11-17.md`):** correr suite completa post-eliminación de `REFS` con `eval:psvalid` y ampliar casos con `recalled` para validar `args_structured_brief` (con 12 casos no alcanzó significancia estadística).
- **`pending` (`PENDIENTES_EVAL.md` §2):** medir `pending_variedad`, `llm_pending_hard` y `llm_gemai` (y la opción C de `PENDING_FACTS_LOOKUP` cuando se implemente en `src/core/engine/runTask.ts`).
- **`question` (`PENDIENTES_EVAL.md` §6):** medir los 3 casos migrados de `refs_unresolved` a `info_missing` en `llm_question_gemai`.
- **`plan` (`--thinking=prod`) y `final` (`--thinking=both`):** aplazados por el costo de latencia de `thinking` (decenas de segundos por llamada).
- **`recovery` (`GUIA_DECISION.md` §5):** ampliar con trazas reales de `recoveryShadow` (la serie `n1`–`n4` ya no tiene un holdout limpio).

---

## 3. Pendientes vinculados fuera de `eval/` (referencia)

- **Aplicar `tool_choice_desc_a` en `src/core/tools/manifest.ts:206,222`:** confirmada en dev (+13.8 %) y holdout (+17.6 %) sin regresiones en [`conclusiones.md`](./conclusiones.md); en `src/` todavía figura la descripción anterior.
- **PowerShell `ENOENT` en Linux (`src/core/engine/precheck.ts:364-375` / `tests/eval_arguments.test.ts:85-86`):** diferido (en Linux sin `pwsh`, `precheck` devuelve `null` y fallan esos 2 casos).
- **Entorno Ollama y calibración en producción (`PENDIENTES_EVAL.md` §5):** verificar `num_ctx` real (8192/4096 frente a 16384 esperado) y calibrar umbrales, topes y timeouts en trazas reales.
