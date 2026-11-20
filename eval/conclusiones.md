# Conclusiones del Laboratorio de Evaluación (`eval`)

Estado general de la campaña de evaluación comparativa de variantes de prompts con el modelo real frente a producción (`prod`).
Fecha de inicio: 2026-11-19.  
Modelo generativo: `qwen3.5:4b-text` @ Ollama  
Modelo de decisión: `d3:2b-text` @ Ollama  

---

## 1. Resumen Ejecutivo

| Etapa | Estado | Decisión / Recomendación | Detalle medido |
|---|---|---|---|
| `tool_choice` (D2) | **Confirmada** | **Aplicar `tool_choice_desc_a`** | Supera netamente a `prod` en dev (+13.8%, 11 mejoras, 0 regresiones) y confirmada en holdout (+17.6%, 6 mejoras, 0 regresiones). Resuelve la confusión entre `run_command` y `list_processes`. |
| `d0` | Concluida | `prod` se mantiene | Ninguna variante superó el umbral neto sin regresiones (`d0_multi_nocriteria` -4.5%; `d0_multi_short` +1.5% sin mejora en dev1). 0 falsos `chat`. |
| `result_verification` (D4) | Concluida | `prod` se mantiene | `d4_cumple_goal_aware` empeoró (-9.3%, 12 regresiones). `d4_cumple_has_data` (+0.9%) está en rango de ruido y aumentó malas aprobadas en dev2. |
| `route` (D1) | Concluida | `prod` se mantiene | Empate exacto en 90.0% (`route_concrete_signals` y `route_research_aware` 0.0% delta). |
| `continuation` | Concluida | `prod` se mantiene | `follow_examples` subió en dev (+7.3%) pero en holdout perdió (-2.1%, regresión en `cont-055`). Descartada por ruido. |
| `args_review` (D3) | Concluida | `prod` se mantiene | Evaluadas 23 variantes en 2 tandas. `args_review_choice_plus_probe` lideró con 79.4% (+2.9%, +1 caso neto, dentro de ruido). Las demás sufrieron regresiones severas. |
| `d5` | Concluida | `prod` se mantiene | Evaluadas 29 variantes en 2 tandas. `d5_it6_move_aware_choice` y `d5_it7_apex_choice` alcanzaron 91.7% (+8.3%), pero en 36 casos eso representa solo +3 casos de ventaja; `prod` se mantiene como base consolidada. |
| `fragment_judge` | Concluida | `prod` se mantiene | `prod` alcanzó 85.7% (36/42). Ninguna variante lo superó (`fragment_judge_balanced`, `concise`, `ranking` y `ternary` empataron en 85.7%). |
| `recovery` | Concluida | `prod` se mantiene | `prod` lideró con 73.7% (56/76). `recovery_three_options_nobehind` empató (73.7%) y las demás variantes cayeron hasta -7.9%. |

---

## 2. Resumen de Limpieza: Top 3 Variantes Conservadas por Etapa

Se corrieron todas las variantes de las 9 etapas de decisión (en tandas para las etapas con alto volumen) y se eliminaron 102 archivos de variantes obsoletas o con regresiones marcadas, preservando únicamente las 3 mejores por etapa:

| Etapa | Top 3 Variantes Conservadas | Variantes Eliminadas |
|---|---|---:|
| `d0` | `d0_multi_short`, `d0_domain_boundaries`, `d0_concise_calibrated` | 2 |
| `route_D1` | `route_concrete_signals`, `route_research_aware`, `route_clean_hints` | 10 |
| `tool_choice_D2` | `tool_choice_desc_a`, `tool_choice_desc_b`, `tool_choice_desc_a_request` | 11 |
| `args_review_D3` | `args_review_choice_plus_probe`, `args_review_fullview_clean`, `args_review_compact` | 20 |
| `d4` | `d4_cumple_has_data`, `d4_concise_precision`, `d4_precision_calibrated` *(+2 utilitarios de exp)* | 25 |
| `fragment_judge` | `fragment_judge_balanced`, `fragment_judge_concise`, `fragment_judge_ternary` | 6 |
| `d5` | `d5_it6_move_aware_choice`, `d5_it7_apex_choice`, `d5_it8_apex_calibrated` | 26 |
| `recovery` | `recovery_three_options_nobehind`, `recovery_rewrite_or_close`, `recovery_three_options_examples` | 2 |
| `continuation` | `follow_examples`, `follow_nocriteria`, `follow_short` | 0 |
| **Total Eliminadas** | — | **102** |

---

## 3. Resultados Detallados de las Nuevas Etapas Evaluadas

### 3.1 `args_review` (D3) — 23 variantes en 2 tandas
- **Datasets:** `args_review_16_cases` (16 casos), `args_review_current` (18 casos). Total: 34 casos.
- **Tanda 1 (`args_tanda1`):** `prod` obtuvo 76.5% (26/34). Empató `args_review_compact` (76.5%). Las demás variantes cayeron fuertemente: `args_review_strict` (70.6%), `args_review_precise` (70.6%), `args_review_r1_triple_noul` (55.9%), `args_review_r1_fine_choice` (38.2%).
- **Tanda 2 (`args_tanda2`):** `args_review_choice_plus_probe` obtuvo 79.4% (27/34, +2.9% delta vs prod, 1 regresión y 3 mejoras). `args_review_fullview_clean` obtuvo 76.5% (0.0%). Las demás cayeron (ej. `args_review_3q_noul` a 58.8%, `args_review_compact_grounded` a 67.6%).
- **Conclusión:** `prod` se mantiene.

### 3.2 `d5` (Cierre Reactivo) — 29 variantes en 2 tandas
- **Dataset:** `d5_close_check` (36 casos).
- **Tanda 1 (`d5_tanda1`):** `prod` obtuvo 86.1% (31/36). Lideraron `d5_it4_direct_done` (88.9%), `d5_it2_binary_choice` (88.9%) y `d5_it5_dual_choice` (88.9%).
- **Tanda 2 (`d5_tanda2`):** `d5_it6_move_aware_choice` y `d5_it7_apex_choice` alcanzaron 91.7% (33/36, +8.3%, 0 regresiones, 3 mejoras). `d5_it8_apex_calibrated` alcanzó 91.7% con 1 regresión y 4 mejoras.
- **Conclusión:** Si bien `d5_it6_move_aware_choice` y `d5_it7_apex_choice` mostraron buena respuesta frente a pasos de mover vs copiar, en un dataset pequeño de 36 casos +8.3% representa apenas 2 casos netos (dentro de la banda de ruido de 1-2 casos). `prod` se mantiene.

### 3.3 `fragment_judge` — 9 variantes
- **Datasets:** `fragment_judge_gem1` (8), `fragment_judge_gem2` (7), `fragment_judge_gem_hard` (11), `fragment_judge_jarvis_runtime` (16). Total: 42 casos.
- `prod` obtuvo 85.7% (36/42).
- Empataron en 85.7% exacto: `fragment_judge_balanced`, `fragment_judge_concise`, `fragment_judge_ranking` y `fragment_judge_ternary`.
- Las variantes complejas empeoraron: `fragment_judge_classifier` (66.7%, -19.0%), `fragment_judge_strict_facts` (78.6%), `fragment_judge_multipart_today` (81.0%).
- **Conclusión:** `prod` se mantiene.

### 3.4 `recovery` — 5 variantes
- **Datasets:** `recovery_casos` (29 canónicos), `recovery2` (47 canónicos). Total: 76 casos canónicos.
- `prod` obtuvo 73.7% (56/76).
- `recovery_three_options_nobehind`: 73.7% (0.0% delta).
- `recovery_three_options_examples`: 73.7% (+10.3% en recovery_casos pero -6.4% en recovery2, con 7 regresiones).
- `recovery_rewrite_or_close`: 68.4% (-5.3% neto, 8 regresiones).
- `recovery_two_axes`: 68.4% (-5.3% neto, 11 regresiones).
- **Conclusión:** `prod` se mantiene.

---

## 4. Recomendaciones para Producción

### 1. `tool_choice` (D2): Actualizar descripciones de `run_command` y `list_processes` (Impacto Crítico / Inmediato)

- **Archivo:** `src/core/tools/manifest.ts`
- **Cambio concreto:**
  ```typescript
  // Línea 206 aprox:
  def("terminal", "run_command", "PROCESS_CONTROL", "Run a PowerShell command: system info, hardware, disks, services, files.", {
  ```
  ```typescript
  // Línea 222 aprox:
  def("terminal", "list_processes", "READ", "List running processes with their memory use. Not for hardware or system info.", {
  ```
- **Justificación:** Validado con +13.8% neto en dev y confirmado con +17.6% neto en holdout (sin regresiones en ninguno de los dos).

---

## 5. Bitácora de Corridas

| Fecha / Hora | Comando exacto | Carpeta de resultados | Decisión tomada |
|---|---|---|---|
| 2026-11-19 20:42 | `eval/cli.ts --stages=tool_choice ...` | `eval/results/..._d2_r1` | `tool_choice_desc_a` seleccionada (+13.8%). |
| 2026-11-19 20:42 | `eval/cli.ts --stages=tool_choice ... (holdout)` | `eval/results/..._d2_holdout` | Confirmada `tool_choice_desc_a` (+17.6%). |
| 2026-11-19 20:42 | `eval/cli.ts --stages=d0 ...` | `eval/results/..._d0_r1` | `prod` se mantiene para D0. |
| 2026-11-19 20:43 | `eval/cli.ts --stages=result_verification ...` | `eval/results/..._d4_r1` | `prod` se mantiene para D4. |
| 2026-11-19 20:43 | `eval/cli.ts --stages=route ...` | `eval/results/..._route_r1` | `prod` se mantiene para D1. |
| 2026-11-19 20:44 | `eval/cli.ts --stages=continuation ...` | `eval/results/..._follow_r1` | `follow_examples` pasa a holdout (+7.3%). |
| 2026-11-19 20:44 | `eval/cli.ts --stages=continuation ... (holdout)` | `eval/results/..._follow_holdout` | `follow_examples` descartada por ruido en holdout (-2.1%). |
| 2026-11-19 20:50 | `eval/cli.ts --stages=args_review (Tanda 1)` | `eval/results/..._args_tanda1` | `prod` lidera con 76.5%. |
| 2026-11-19 20:50 | `eval/cli.ts --stages=args_review (Tanda 2)` | `eval/results/..._args_tanda2` | `args_review_choice_plus_probe` lidera con 79.4%. `prod` se mantiene. |
| 2026-11-19 20:50 | `eval/cli.ts --stages=d5 (Tanda 1)` | `eval/results/..._d5_tanda1` | `prod` 86.1%. Lideran it4_direct_done, it2_binary_choice (88.9%). |
| 2026-11-19 20:51 | `eval/cli.ts --stages=d5 (Tanda 2)` | `eval/results/..._d5_tanda2` | `d5_it6_move_aware_choice` y `d5_it7_apex_choice` lideran con 91.7%. |
| 2026-11-19 20:51 | `eval/cli.ts --stages=fragment_judge (Tanda 1)` | `eval/results/..._frag_tanda1` | `prod` 85.7%; ninguna variante lo supera. |
| 2026-11-19 20:52 | `eval/cli.ts --stages=recovery (Tanda 1)` | `eval/results/..._recov_tanda1` | `prod` 73.7%; variantes complejas retroceden. |
