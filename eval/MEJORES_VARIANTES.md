---

# 10. Quinta Ronda: dos rondas de variantes nuevas (6 etapas, thinking=off)

Fecha: 2026-11-09. Modelos `qwen3.5:4b` (generativo, `thinking=off`, `concurrency=1`) y `d3:2b` (decisión, `concurrency=2`, `repeat=2`). En cada etapa: `prod` + la mejor variante anterior + 2 variantes nuevas, dos rondas (R1 y R2). Los prompts de `prod` cambiaron desde las rondas anteriores (umbrales, LAST ERROR), por eso los números de `prod` no coinciden con los del resto del documento. La misma `prod` varía ~3 puntos entre corridas en las etapas generativas: diferencias menores son ruido.

| Etapa | Mejor variante | Resultado | Evidencia |
|---|---|---|---|
| `route` | `route_lean_direct` (≈ `prod`) | 100 % = prod | Etapa saturada; sin `Done` baja a 93,8 % (`route_min*`) |
| `tool_choice` | `tool_choice_direct_nofail` (= `tool_choice_direct`) | 100 % vs 87,5 % de prod (+12,5) | Gana la **instrucción**; `tool_choice_lean` (instrucción de prod) no mejora |
| `args_review` | `args_review_compact_history` | 72,9 % vs 62,5 % (+10,4) | Criterios cortos; con criterios de prod 58,3 %; `grounded` 54,2 %; todo el efecto en `16_cases` |
| `final` | `final_summary` | 81,3-84,4 % vs 78,1-81,3 % (+3, no significativo) | `answerfirst` y `short` bajan ~10 puntos |
| `question` | `question_prod_trailer2` | 94,6 % vs 90,5 % (+4,1) | Recordatorio final de formato; recortar la vista no ayuda |
| `pending` | `pending_elite_labels` (`_full` 83,1 %) | 81,8-84,4 % vs 79,2-81,8 % (+2,6 en ambas rondas) | Rótulos en todas las secciones; sin `TODAY`; SYSTEM corto |

Detalle y razones por etapa: ver `conclusiones_*.md` de cada carpeta de `variants/`.

**A implementar (ganadoras):** `tool_choice_direct`/`_nofail`, `args_review_compact_history`, `question_prod_trailer2`, `pending_elite_labels` y `final_summary`. `route` no necesita cambio. Las mejoras de `final`, `question` y `pending` son chicas y no alcanzan significancia con estos datasets: conviene validarlas en un holdout antes de pasarlas a `src`.


---

# 9. Cuarta y Última Ronda de Evaluación (Variantes Elite + Ganadoras Históricas)

---

### A. `args_review` (Decisión · 48 casos)
* **Datasets:** `args_review_16_cases`, `args_review_gemai`, `args_review_gemaiL`
* **Variantes probadas:** `prod`, `args_review_compact`, `args_review_compact_history`, `args_review_hybrid_elite`
* **Resultados:**
  * **`args_review_compact`**: **72.9% (35/48)** | **Δ +10.4%** — p50: 45ms (-11ms)
  * **`args_review_compact_history`**: **72.9% (35/48)** | **Δ +10.4%** — p50: 44ms (-12ms)
  * **`prod` (baseline)**: 62.5% (30/48) — p50: 56ms
  * **`args_review_hybrid_elite`**: 56.3% (27/48) | Δ -6.2%
* **Conclusión:** La concisión pura de `args_review_compact` / `args_review_compact_history` es imbatible para d3:2b (+10.4% neto vs prod y 87.5% en datasets reales limpios).

---

### B. `question` (Generativa · 74 casos)
* **Datasets:** `llm_question`, `llm_question_hard`, `llm_question_gemai`
* **Variantes probadas:** `prod`, `question_clean_view`, `question_precision_elite`
* **Resultados:**
  * **`prod` (baseline)**: **90.5% (67/74)** — p50: 196ms
  * **`question_clean_view`**: 89.2% (66/74) | Δ -1.4% — **p50: 186ms (-10ms más rápida)** (3 mejoras en casos complejos de rechazo)
  * **`question_precision_elite`**: 87.8% (65/74) | Δ -2.7% — p50: 206ms (75.0% en `gemai`)
* **Conclusión:** `prod` sigue siendo el estándar más sólido. `question_clean_view` es la mejor alternativa para producción si se busca latencia mínima con un pass rate prácticamente idéntico (-1.4%).

---

### C. `pending` (Generativa · 77 casos)
* **Datasets:** `llm_pending`, `llm_pending_hard`, `llm_gemai`
* **Variantes probadas:** `prod`, `pending_tiny_focused`, `pending_focused_elite`
* **Resultados:**
  * **`pending_focused_elite`**: **83.1% (64/77)** | **Δ +2.6%** — **p50: 282ms (-11ms)** (8 mejoras netas; **87.5% en `llm_gemai` vs 56.3% de prod**)
  * **`prod` (baseline)**: 80.5% (62/77) — p50: 293ms
  * **`pending_tiny_focused`**: 80.5% (62/77) | Δ 0.0% — p50: 281ms
* **Conclusión:** **`pending_focused_elite` es la campeona definitiva**. Eliminar el ruido de `TODAY:` y añadir marcadores de sección explícitos (`### COMPLETED TASKS (DONE):` y `### FAILED TASKS (REPLACE IN PENDING):`) destrabó al modelo qwen3.5:4b, elevando un +31.3% de efectividad en el dataset nuevo `gemai`.

---

# 8. Tercera Ronda de Evaluación (Variación de Contexto de Entrada + Prompts Ganadores)

Se probaron para cada etapa las 2 variantes con mejor historial frente a 2 nuevas variantes diseñadas variando la estructura/información del contexto (`buildArgsReview`, `buildUserPrompt`).

---

### A. `args_review` (Decisión)
* **Datasets (48 casos):** `args_review_16_cases`, `args_review_gemai`, `args_review_gemaiL`
* **Variantes:** `prod`, `args_review_compact`, `args_review_compact_desc`, `args_review_compact_history`
* **Resultados:**
  * **`prod` (baseline):** 62.5% (30/48) — p50: 56ms
  * **`args_review_compact`:** **72.9% (35/48)** | **Δ +10.4%** — p50: 45ms (-11ms)
  * **`args_review_compact_history`:** **72.9% (35/48)** | **Δ +10.4%** — p50: 45ms (-11ms)
  * **`args_review_compact_desc`:** 70.8% (34/48) | **Δ +8.3%** — p50: 44ms (-12ms)
* **Conclusión:** La compresión del contexto al objetivo (`Target`), entrada de usuario y llamada candidata (`args_review_compact` o sumando `Previous Errors`) eleva la precisión de d3:2b a más del 72.9% (87.5% en casos limpios) reduciendo 11ms de latencia.

---

### B. `question` (Generativa)
* **Datasets (74 casos):** `llm_question`, `llm_question_hard`, `llm_question_gemai`
* **Variantes:** `prod`, `question_short`, `question_focus_rejected`, `question_clean_view`
* **Resultados:**
  * **`prod` (baseline):** **93.2% (69/74)** — p50: 195ms
  * **`question_clean_view`:** 89.2% (66/74) | Δ -4.1% — **p50: 182ms (-13ms más rápida)**
  * **`question_short`:** 87.8% (65/74) | Δ -5.4% — p50: 199ms
  * **`question_focus_rejected`:** 86.5% (64/74) | Δ -6.8% — p50: 224ms
* **Conclusión:** `prod` sigue siendo el prompt más balanceado para `question`. Si se prioriza máxima velocidad/reducción de tokens, `question_clean_view` ahorra latencia (182ms p50) y aportó mejoras en casos complejos de rechazo (`question-hard-013` y `question-hard-040`).

---

### C. `pending` (Generativa)
* **Datasets (77 casos):** `llm_pending`, `llm_pending_hard`, `llm_gemai`
* **Variantes:** `prod`, `pending_tiny`, `pending_tiny_notoday`, `pending_tiny_focused`
* **Resultados:**
  * **`prod` (baseline):** 76.6% (59/77) — p50: 292ms
  * **`pending_tiny_focused`:** **83.1% (64/77)** | **Δ +6.5%** — **p50: 256ms (-36ms más rápida)** *(11 mejoras vs 6 regresiones)*
  * **`pending_tiny_notoday`:** 80.5% (62/77) | **Δ +3.9%** — p50: 283ms
  * **`pending_tiny`:** 80.5% (62/77) | **Δ +3.9%** — p50: 266ms
* **Conclusión:** **`pending_tiny_focused` es la ganadora absoluta**. Estructurar visualmente el contexto del usuario destacando `### COMPLETED TASKS (DONE):` y `### FAILED TASKS (REPLACE IN PENDING):` disparó la efectividad a 81.3% en `llm_gemai` (+18.8% vs prod) y 89.7% en `llm_pending_hard` (+6.9% vs prod) bajando la latencia en 36ms.

---

# 7. Segunda Ronda de Evaluación (3 Datasets por Etapa: Iniciales + Nuevos)

Evaluación enfocada en las 3 etapas solicitadas, agregando un dataset nuevo a cada una (`args_review_gemaiL`, `llm_question_gemai` y `llm_gemai`), probando contra el oráculo previamente (100% verificado) y testeando la mejor variante previa + 2 nuevas variantes más cortas y objetivas.

---

### A. `args_review` (Decisión)
* **Datasets (48 casos totales):** `args_review_16_cases`, `args_review_gemai`, `args_review_gemaiL`
* **Variantes evaluadas:** `prod`, `args_review_strict`, `args_review_compact` *(nueva)*, `args_review_precise` *(nueva)*
* **Resultados:**
  * **`prod` (baseline):** 62.5% (30/48) — acc 62.5% | p50 56ms
  * **`args_review_compact`:** **72.9% (35/48)** | **Δ +10.4%** | p50 45ms *(11 mejoras vs 5 regresiones; 87.5% en 16_cases)*
  * **`args_review_strict`:** 60.4% (29/48) | Δ -2.1% | p50 48ms
  * **`args_review_precise`:** 50.0% (24/48) | Δ -12.5% | p50 49ms
* **Ganador indiscutido:** `args_review_compact`.

---

### B. `question` (Generativa)
* **Datasets (74 casos totales):** `llm_question`, `llm_question_hard`, `llm_question_gemai`
* **Variantes evaluadas:** `prod`, `question_short`, `question_objective` *(nueva)*, `question_direct` *(nueva)*
* **Resultados:**
  * **`prod` (baseline):** **90.5% (67/74)** — p50 194ms
  * **`question_short`:** 87.8% (65/74) | Δ -2.7% — p50 205ms
  * **`question_objective`:** 87.8% (65/74) | Δ -2.7% — p50 227ms *(logró 96.2% en llm_question_hard superando al 92.3% de prod)*
  * **`question_direct`:** 87.8% (65/74) | Δ -2.7% — p50 207ms
* **Ganador:** `prod` se mantiene como la más sólida globalmente, con `question_objective` como mejor alternativa para casos difíciles (`hard`).

---

### C. `pending` (Generativa)
* **Datasets (77 casos totales):** `llm_pending`, `llm_pending_hard`, `llm_gemai`
* **Variantes evaluadas:** `prod`, `pending_tiny`, `pending_objective` *(nueva)*, `pending_compact` *(nueva)*
* **Resultados:**
  * **`prod` (baseline):** 80.5% (62/77) — p50 301ms
  * **`pending_tiny`:** **83.1% (64/77)** | **Δ +2.6%** — p50 280ms *(6 mejoras vs 4 regresiones; 75.0% en llm_gemai vs 56.3% de prod)*
  * **`pending_compact`:** 79.2% (61/77) | Δ -1.3% — p50 293ms
  * **`pending_objective`:** 77.9% (60/77) | Δ -2.6% — p50 225ms
* **Ganador indiscutido:** `pending_tiny`.


Fecha: 2026-11-09
Configuración de ejecución: Modelos qwen3.5:4b (generativo) + d3:2b (decisión). Etapas generativas con `thinking=off`, `concurrency=1`. Etapas de decisión a `concurrency=2`.

---

## 1. `route` (Decisión)
* **Datasets:** `route_16_cases`, `route_gemai` (32 casos totales)
* **Variantes evaluadas:** `prod`, `route_direct`, `route_fast`
* **Resultados:**
  * **`prod`**: 100.0% (32/32)
  * **`route_direct`**: 100.0% (32/32) | Δ 0.0%
  * **`route_fast`**: 100.0% (32/32) | Δ 0.0%
* **Mejor variante:** Empate perfecto al 100%. `route_direct` tuvo menor latencia p50 (~50ms).

---

## 2. `tool_choice` (Decisión)
* **Datasets:** `tool_choice_16_cases` (16 casos totales)
* **Variantes evaluadas:** `prod`, `tool_choice_detailed`, `tool_choice_direct`
* **Resultados:**
  * **`prod`**: 87.5% (14/16)
  * **`tool_choice_detailed`**: 100.0% (16/16) | **Δ +12.5%** (2 mejoras)
  * **`tool_choice_direct`**: 100.0% (16/16) | **Δ +12.5%** (2 mejoras)
* **Mejor variante:** `tool_choice_direct` / `tool_choice_detailed` (ambas resolvieron los 2 fallos de producción).

---

## 3. `args_review` (Decisión)
* **Datasets:** `args_review_16_cases`, `args_review_gemai` (32 casos totales)
* **Variantes evaluadas:** `prod`, `args_review_permissive`, `args_review_strict`
* **Resultados:**
  * **`prod`**: 56.3% (18/32)
  * **`args_review_permissive`**: 65.6% (21/32) | **Δ +9.4%** (4 mejoras, 1 regresión)
  * **`args_review_strict`**: 68.8% (22/32) | **Δ +12.5%** (5 mejoras, 1 regresión)
* **Mejor variante:** `args_review_strict` (68.8% global, alcanzando 75% en `args_review_16_cases`).

---

## 4. `final` (Generativa)
* **Datasets:** `final_16_cases`, `final_gemai` (32 casos totales)
* **Variantes evaluadas:** `prod`, `final_direct`, `final_summary`
* **Resultados:**
  * **`prod`**: 78.1% (25/32) — p50: 396ms
  * **`final_direct`**: 68.8% (22/32) | Δ -9.4% — p50: 362ms
  * **`final_summary`**: 84.4% (27/32) | **Δ +6.3%** (5 mejoras, 3 regresiones) — p50: 1533ms
* **Mejor variante:** `final_summary` (84.4% global, 75.0% en gemai vs 62.5% de prod).

---

## 5. `question` (Generativa)
* **Datasets:** `llm_question`, `llm_question_hard` (54 casos totales)
* **Variantes evaluadas:** `prod`, `question_short`, `question_tiny`
* **Resultados:**
  * **`prod`**: 98.1% (53/54) — p50: 216ms
  * **`question_short`**: 98.1% (53/54) | Δ 0.0% (1 mejora, 1 regresión) — p50: 231ms
  * **`question_tiny`**: 94.4% (51/54) | Δ -3.7% (1 mejora, 3 regresiones) — p50: 282ms
* **Mejor variante:** `question_short` / `prod` (ambas en 98.1%).

---

## 6. `pending` (Generativa)
* **Datasets:** `llm_pending`, `llm_pending_hard` (61 casos totales)
* **Variantes evaluadas:** `prod`, `pending_short`, `pending_tiny`
* **Resultados:**
  * **`prod`**: 83.6% (51/61) — p50: 297ms
  * **`pending_short`**: 78.7% (48/61) | Δ -4.9% (4 mejoras, 7 regresiones) — p50: 283ms
  * **`pending_tiny`**: 85.2% (52/61) | **Δ +1.6%** (5 mejoras, 4 regresiones) — p50: 272ms
* **Mejor variante:** `pending_tiny` (85.2% global, superó a prod tanto en passRate como en p50).

