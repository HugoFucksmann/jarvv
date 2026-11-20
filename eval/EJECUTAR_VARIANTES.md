# Cómo correr lo que falta en `eval/`

Comandos pendientes de ejecución sobre variantes y datasets activos en `eval/`. Las tandas de decisión ya ejecutadas el 2026-11-19 (`tool_choice`, `d0`, `result_verification`, `route` y `continuation` en `dev`/`holdout`) están consolidadas en [`conclusiones.md`](./conclusiones.md).

Antes de correr modelos reales, validar offline:
`npx tsc --noEmit` y `npx tsx --test eval/core/eval_core.test.ts eval/auto/eval_auto.test.ts`.

## Reglas del juego

1. **Primero `dev`, después `holdout`, una sola vez.** Se compara con `dev`/`dev2`; `holdout`/`holdout2` solo confirman ganadoras una vez.
2. **Sin `--repeat` en decisión.** D trabaja a temperatura 0. Con 40–60 casos, 1 caso de diferencia es ruido; usar `--concurrency=1` para medir latencias (`p50`/`p95`).
3. **Mirar errores asimétricos.** En D4/D5/continuación separar falsos aprobados de falsos rechazos; en D0 falsos `chat`; en `recovery` falso `close` vs falso reintento.
4. **`prod` se agrega solo** como baseline. Hace falta Ollama activo con los modelos de `jarvis-config.json`.

---

## 1. Pendientes en etapas de decisión y scripts offline

### D3 (`args_review`): vista completa y cruce con pre-chequeo (`PENDIENTES_EVAL.md` §1)

```powershell
npx tsx eval/cli.ts --stages=args_review --dataset=args_review_16_cases,args_review_gemai,args_review_gemaiL,args_review_current,args_review_jarvis_runtime,args_review_variedad --variant=args_review_fullview_clean,args_review_compact --concurrency=1 --label=d3_fullview
npx tsx eval/cross.ts --dataset=args_review_16_cases,args_review_gemai,args_review_gemaiL,args_review_current,args_review_jarvis_runtime,args_review_variedad --runs=eval/results/<modelo>/<carpeta_d3_fullview>
```

### D5: cierre reactivo y `d5_variedad` (`PENDIENTES_EVAL.md` §3)

```powershell
npx tsx eval/cli.ts --stages=d5 --dataset=d5_close_check,d5_variedad --variant=d5_evidence_strict,d5_noul_calibrated --concurrency=1 --label=d5_variedad
```

### Análisis offline de reglas D0 y cortes `noul` (requiere `runs.jsonl` reales de `prod`)

```powershell
npx tsx eval/exp/d0_rules.ts eval/results/<modelo>/<carpeta_con_corrida_d0>
npx tsx eval/exp/noul_cuts.ts eval/results/<modelo>/<carpeta_de_corrida>
```

`noul_cuts.ts` acepta `--variant=`, `--dataset=`, `--bucket=canonical|raw|all`, `--best-range=0.25-0.75` o la carpeta entera del modelo.

---

## 2. Pendientes en etapas generativas y memoria (`PLAN_DE_MEDICION.md`)

### `arguments`: suite completa post-eliminación de `REFS` + validez PowerShell

```powershell
npx tsx eval/cli.ts --stages=arguments --dataset=llm_arguments,llm_arguments_hard,llm_arguments_cmd,llm_arguments_extra_hard,args_blocked_repeat,arguments_current_tools,arguments_jarvis_runtime,arguments_recalled_variedad --variant=args_structured_brief,arguments_clean_prod,arguments_strict_context --concurrency=1 --label=args_full
npm run eval:psvalid -- eval/results/<modelo>/<carpeta_args_full>
```

*(Si se amplía el dataset con `recalled`, re-verificar `args_structured_brief` contra `prod`.)*

### `pending`: `pending_variedad` y variantes de hechos / contexto

```powershell
npx tsx eval/cli.ts --stages=pending --dataset=llm_pending,llm_pending_hard,llm_gemai,pending_jarvis_runtime,pending_variedad --variant=pending_facts_safe,pending_conditional_clean --concurrency=1 --label=pending_full
```

### `question`: verificar los 3 casos migrados de `refs_unresolved` a `info_missing`

```powershell
npx tsx eval/cli.ts --stages=question --dataset=llm_question,llm_question_hard,llm_question_gemai,question_jarvis_runtime --concurrency=1 --label=question_check
```

### Aplazados por latencia (correr solo cuando se decida habilitar `thinking`)

```powershell
npx tsx eval/cli.ts --stages=plan --dataset=plan_16_cases,plan_gemai,plan_jarvis_runtime --thinking=prod --concurrency=1 --label=plan_thinking
npx tsx eval/cli.ts --stages=final --dataset=final_16_cases,final_gemai,final_gemai2,final_jarvis_runtime,final_recalled_variedad --thinking=both --concurrency=1 --label=final_thinking
```

---

## Referencias

- Flags y contratos de etapas: [`INSTRUCCIONES.md`](./INSTRUCCIONES.md)
- Reglas del modelo de decisión y `recovery`: [`GUIA_DECISION.md`](./GUIA_DECISION.md)
- Lista completa de pendientes de medición e infraestructura: [`INCONSISTENCIAS_EVAL_2026-11-20.md`](./INCONSISTENCIAS_EVAL_2026-11-20.md)
