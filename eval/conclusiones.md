# Conclusiones del Laboratorio de Evaluación (`eval`)

Estado de la campaña comparativa de prompts en etapas de decisión con el modelo real frente a producción (`prod`).  
Fecha de campaña: 2026-11-19 · Modelo generativo: `qwen3.5:4b-text` · Modelo de decisión: `d3:2b-text`.

*(Las mediciones pendientes —etapas generativas, `args_review` con vista completa + `eval:cross`, `d5_variedad` y calibración con trazas reales— están en [`INCONSISTENCIAS_EVAL_2026-11-20.md`](./INCONSISTENCIAS_EVAL_2026-11-20.md) y [`EJECUTAR_VARIANTES.md`](./EJECUTAR_VARIANTES.md).)*

---

## 1. Resumen Ejecutivo (etapas de decisión medidas el 2026-11-19)

| Etapa | Estado | Decisión / Recomendación | Detalle medido |
|---|---|---|---|
| `tool_choice` (D2) | **Confirmada (pendiente aplicar en `src/`)** | **Aplicar `tool_choice_desc_a`** | Supera netamente a `prod` en dev (+13.8%, 11 mejoras, 0 regresiones) y confirmada en holdout (+17.6%, 6 mejoras, 0 regresiones). Resuelve la confusión entre `run_command` y `list_processes`. |
| `d0` | Concluida | `prod` se mantiene | Ninguna variante de esa tanda superó el umbral neto sin regresiones (`d0_multi_short` +1.5% sin mejora consistente en dev1; 0 falsos `chat`). |
| `result_verification` (D4) | Concluida | `prod` se mantiene | Variantes anteriores descartadas; `d4_cumple_has_data` (+0.9%) estuvo en rango de ruido y aumentó malas aprobadas en dev2. |
| `route` (D1) | Concluida | `prod` se mantiene | Empate exacto en 90.0% (`route_concrete_signals` y `route_research_aware` 0.0% delta). |
| `continuation` | Concluida | `prod` se mantiene | `follow_examples` subió en dev (+7.3%) pero en holdout perdió (-2.1%, regresión en `cont-055`). Descartada por ruido. |
| `args_review` (D3) | Parcial (`fullview` pendiente) | `prod` se mantiene por ahora | En `args_review_16_cases` + `args_review_current` (34 casos): `prod` 76.5%, `args_review_compact` 76.5%, `args_review_fullview_clean` 76.5%. Falta correr con los 6 datasets (`eval:cross`) para evaluar `reviewFullView`. |
| `d5` | Parcial (`d5_variedad` pendiente) | `prod` se mantiene | En `d5_close_check` (36 casos), `prod` obtuvo 86.1%. Falta evaluar `d5_variedad` y `completionCoverageGuard`. |
| `fragment_judge` | Concluida | `prod` se mantiene | `prod` alcanzó 85.7% (36/42). Ninguna variante activa lo superó (`fragment_judge_balanced` y `concise` empataron en 85.7%). |
| `recovery` | Parcial (faltan trazas reales) | `prod` se mantiene | En 76 casos canónicos (`recovery_casos`, `recovery2`), `prod` obtuvo 73.7% y `recovery_three_options_nobehind` empató en 73.7%. Ampliación real vía `recoveryShadow` pendiente. |

---

## 2. Inventario Vigente en `eval/variants/` (105 archivos `.ts`)

Las variantes heredadas con `params` o `read` obsoletos y la carpeta `_archivo_legacy/` ya fueron eliminadas del repositorio. Todas las variantes activas actuales exportan constructores completos (`DECISION_PROMPTS` o `PROMPTS`) y pasan carga y validación en `eval_core.test.ts`:

| Carpeta | Variantes activas actuales | Cantidad (.ts) |
|---|---|---:|
| *(raíz)* | `prod`, `decision_elite_fusion`, `decision_all_stages_example` | 3 |
| `d0` | `d0_action_boundary`, `d0_chat_balanced`, `d0_chat_strict`, `d0_concise_calibrated`, `d0_domain_boundaries`, `d0_multi_short`, `d0_multi_subordinate`, `d0_r1_action_axes`, `d0_r1_concise_verbs` | 9 |
| `route_D1` | `route_clean_hints`, `route_concrete_signals`, `route_research_aware` | 3 |
| `tool_choice_D2` | `tool_choice_desc_a`, `tool_choice_desc_b`, `tool_choice_desc_a_request`, `tool_choice_hybrid_calibrated`, `tool_choice_precision_criteria`, `tool_choice_r1_action_verbs` | 6 |
| `args_review_D3` | `args_review_compact`, `args_review_fullview_clean` | 2 |
| `d4` | `d4_concise_precision`, `d4_cumple_has_data`, `d4_precision_calibrated`, `d4_prod_hint`, `d4_request_done`, `verify_concrete_evidence` | 6 |
| `fragment_judge` | `fragment_judge_balanced`, `fragment_judge_calibrated_signal`, `fragment_judge_concise`, `fragment_judge_direct_evidence`, `fragment_judge_r1_facts_focused`, `fragment_judge_r1_signal_short`, `fragment_judge_signal_clean` | 7 |
| `d5` | `d5_evidence_strict`, `d5_noul_calibrated` | 2 |
| `recovery` | `recovery_boundary_calibrated`, `recovery_rewrite_or_close`, `recovery_three_options_examples`, `recovery_three_options_nobehind` | 4 |
| `continuation` | `continuation_explicit_reference`, `continuation_lean_focus`, `follow_examples`, `follow_nocriteria`, `follow_short` | 5 |
| `plan` | `plan_adaptive`, `plan_concise`, `plan_effects_grounded`, `plan_windows_routes` | 4 |
| `arguments` | `args_g`, `args_g_sinej`, `args_mem_explicit`, `args_ps_elite`, `args_ps_objetive`, `args_ps_perfect`, `args_structured_brief`, `arguments_clean_prod`, `arguments_strict_context` | 9 |
| `final` | `final_direct`, `final_faithful_status`, `final_lang_natural`, `final_structured_strict`, `final_summary`, `final_summary_answerfirst`, `final_summary_facts`, `final_summary_notoday`, `final_summary_short`, `final_thread_grounded` | 10 |
| `question` | `question_clean_view`, `question_direct`, `question_focus_rejected`, `question_objective`, `question_precision_elite`, `question_prod_dedup`, `question_prod_trailer`, `question_prod_trailer2`, `question_short`, `question_short_trailer`, `question_structured_ask`, `question_tiny`, `question_zero_jargon` | 13 |
| `Pending` | 17 variantes (`pending_*`) | 17 |
| `ctx` | `ctx_args_by_tool`, `ctx_d4_norecent`, `ctx_final_clean`, `ctx_final_nofiller`, `ctx_pending_facts` | 5 |
| **Total** | — | **105** |

---

## 3. Acción Pendiente para Producción

### `tool_choice` (D2): Actualizar descripciones de `run_command` y `list_processes`

- **Archivo (fuera de `eval/`, pendiente de aplicar en `src/`):** `src/core/tools/manifest.ts` (líneas ~206 y ~222; todavía tiene la redacción anterior).
- **Cambio validado (`tool_choice_desc_a`):**
  ```typescript
  def("terminal", "run_command", "PROCESS_CONTROL", "Run a PowerShell command: system info, hardware, disks, services, files.", {
  ```
  ```typescript
  def("terminal", "list_processes", "READ", "List running processes with their memory use. Not for hardware or system info.", {
  ```
- **Justificación:** +13.8 % neto en dev (11 mejoras, 0 regresiones) y +17.6 % neto en holdout (6 mejoras, 0 regresiones).

---

## 4. Bitácora de Corridas (2026-11-19)

| Fecha / Hora | Etapa | Decisión tomada |
|---|---|---|
| 2026-11-19 20:42 | `tool_choice` (dev + holdout) | Confirmada `tool_choice_desc_a` (+13.8% dev, +17.6% holdout; pendiente aplicar en `src/`). |
| 2026-11-19 20:42 | `d0` (dev) | `prod` se mantiene para D0. |
| 2026-11-19 20:43 | `result_verification` (dev) | `prod` se mantiene para D4. |
| 2026-11-19 20:43 | `route` (dev) | `prod` se mantiene para D1. |
| 2026-11-19 20:44 | `continuation` (dev + holdout) | `follow_examples` descartada por ruido en holdout (-2.1%). |
| 2026-11-19 20:50 | `args_review` (Tandas 1 y 2) | `prod`, `args_review_compact` y `args_review_fullview_clean` en 76.5% sobre 34 casos. |
| 2026-11-19 20:50–20:51 | `d5` (Tandas 1 y 2) | `prod` 86.1% en `d5_close_check`; variantes legacy retiradas. |
| 2026-11-19 20:51 | `fragment_judge` (Tanda 1) | `prod` 85.7%; ninguna variante activa lo supera. |
| 2026-11-19 20:52 | `recovery` (Tanda 1) | `prod` 73.7%; variantes complejas retroceden. |
