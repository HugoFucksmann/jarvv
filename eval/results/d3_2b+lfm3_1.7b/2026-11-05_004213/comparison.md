# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Modelo | Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|---|
| d3:2b | prod (baseline) | 73.1% (38/52) | — | 0 | 0 | 0 | 28ms |
| lfm3:1.7b | prod (baseline) | 0.0% (0/52) | — | 0 | 0 | 52 | 0ms |
| d3:2b | decision_alt_questions | 73.1% (38/52) | 0.0% | 0 | 0 | 0 | 66ms |
| lfm3:1.7b | decision_alt_questions | 0.0% (0/52) | 0.0% | 0 | 0 | 52 | 0ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## Comparación entre Modelos

Mismo dataset y variante contra cada modelo. Los deltas son contra el **primer modelo** de la lista (ref). Cada modelo corre solo las etapas de su tipo; la accuracy es la de las decisiones.

### `prod` — decision_combo_52 — etapas de decisión

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 73.1% (38/52) | — | 73.1% | — | 28ms | — | 39ms | — | ~159/97/257 | 0 |
| **lfm3:1.7b** | 0.0% (0/52) | -73.1% | — | — | 0ms | -28ms | 0ms | -39ms | — | 52 |

**`args_review`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 61.1% (11/18) | — | 61.1% | — | 26ms | — | 3158ms | — | ~161/105/265 | 0 |
| **lfm3:1.7b** | 0.0% (0/18) | -61.1% | — | — | 0ms | -26ms | 0ms | -3158ms | — | 18 |

**`result_verification`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 78.6% (11/14) | — | 78.6% | — | 38ms | — | 39ms | — | ~94/59/153 | 0 |
| **lfm3:1.7b** | 0.0% (0/14) | -78.6% | — | — | 0ms | -38ms | 0ms | -39ms | — | 14 |

**`route`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 75.0% (9/12) | — | 75.0% | — | 28ms | — | 31ms | — | ~235/115/350 | 0 |
| **lfm3:1.7b** | 0.0% (0/12) | -75.0% | — | — | 0ms | -28ms | 0ms | -31ms | — | 12 |

**`tool_choice`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 87.5% (7/8) | — | 87.5% | — | 24ms | — | 29ms | — | ~157/122/279 | 0 |
| **lfm3:1.7b** | 0.0% (0/8) | -87.5% | — | — | 0ms | -24ms | 0ms | -29ms | — | 8 |

**Accuracy por pregunta**

| Etapa | Pregunta | Rol | d3:2b acc | d3:2b errores | lfm3:1.7b acc | lfm3:1.7b errores |
|---|---|---|---|---|---|---|
| `result_verification` | `cumple` | principal | 85.7% (14) | FP 1 / FN 1 | — | — |
| `result_verification` | `ok` | principal | 92.9% (14) | FP 0 / FN 1 | — | — |

Los modelos obtuvieron el mismo resultado en todos los casos.

### `decision_alt_questions` — decision_combo_52 — etapas de decisión

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 73.1% (38/52) | — | 73.1% | — | 66ms | — | 92ms | — | ~270/138/408 | 0 |
| **lfm3:1.7b** | 0.0% (0/52) | -73.1% | — | — | 0ms | -66ms | 0ms | -92ms | — | 52 |

**`args_review`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 61.1% (11/18) | — | 61.1% | — | 66ms | — | 68ms | — | ~265/140/404 | 0 |
| **lfm3:1.7b** | 0.0% (0/18) | -61.1% | — | — | 0ms | -66ms | 0ms | -68ms | — | 18 |

**`result_verification`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 78.6% (11/14) | — | 78.6% | — | 90ms | — | 94ms | — | ~254/112/365 | 0 |
| **lfm3:1.7b** | 0.0% (0/14) | -78.6% | — | — | 0ms | -90ms | 0ms | -94ms | — | 14 |

**`route`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 75.0% (9/12) | — | 75.0% | — | 64ms | — | 69ms | — | ~314/152/466 | 0 |
| **lfm3:1.7b** | 0.0% (0/12) | -75.0% | — | — | 0ms | -64ms | 0ms | -69ms | — | 12 |

**`tool_choice`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **d3:2b** (ref) | 87.5% (7/8) | — | 87.5% | — | 61ms | — | 66ms | — | ~242/161/402 | 0 |
| **lfm3:1.7b** | 0.0% (0/8) | -87.5% | — | — | 0ms | -61ms | 0ms | -66ms | — | 8 |

**Accuracy por pregunta**

| Etapa | Pregunta | Rol | d3:2b acc | d3:2b errores | lfm3:1.7b acc | lfm3:1.7b errores |
|---|---|---|---|---|---|---|
| `result_verification` | `cumple` | principal | 85.7% (14) | FP 1 / FN 1 | — | — |
| `result_verification` | `ok` | principal | 92.9% (14) | FP 0 / FN 1 | — | — |

Los modelos obtuvieron el mismo resultado en todos los casos.

## 1. Resumen por Etapa

| Variante | Modelo | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| `prod` | d3:2b | decision_combo_52 | `args_review` | 61.1% (11/18) | 61.1% | 26ms | 3158ms | ~161/105/265 | 61.1% |
| `prod` | d3:2b | decision_combo_52 | `result_verification` | 78.6% (11/14) | 78.6% | 38ms | 39ms | ~94/59/153 | 78.6% |
| `prod` | d3:2b | decision_combo_52 | `route` | 75.0% (9/12) | 75.0% | 28ms | 31ms | ~235/115/350 | 75.0% |
| `prod` | d3:2b | decision_combo_52 | `tool_choice` | 87.5% (7/8) | 87.5% | 24ms | 29ms | ~157/122/279 | 87.5% |
| `prod` | lfm3:1.7b | decision_combo_52 | `args_review` | 0.0% (0/18) | 0.0% | 0ms | 0ms | — | — |
| `prod` | lfm3:1.7b | decision_combo_52 | `result_verification` | 0.0% (0/14) | 0.0% | 0ms | 0ms | — | — |
| `prod` | lfm3:1.7b | decision_combo_52 | `route` | 0.0% (0/12) | 0.0% | 0ms | 0ms | — | — |
| `prod` | lfm3:1.7b | decision_combo_52 | `tool_choice` | 0.0% (0/8) | 0.0% | 0ms | 0ms | — | — |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `args_review` | 61.1% (11/18) | 61.1% | 66ms | 68ms | ~265/140/404 | 61.1% |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `result_verification` | 78.6% (11/14) | 78.6% | 90ms | 94ms | ~254/112/365 | 78.6% |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `route` | 75.0% (9/12) | 75.0% | 64ms | 69ms | ~314/152/466 | 75.0% |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `tool_choice` | 87.5% (7/8) | 87.5% | 61ms | 66ms | ~242/161/402 | 87.5% |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `args_review` | 0.0% (0/18) | 0.0% | 0ms | 0ms | — | — |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `result_verification` | 0.0% (0/14) | 0.0% | 0ms | 0ms | — | — |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `route` | 0.0% (0/12) | 0.0% | 0ms | 0ms | — | — |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `tool_choice` | 0.0% (0/8) | 0.0% | 0ms | 0ms | — | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Modelo | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|---|
| `decision_alt_questions` | d3:2b | decision_combo_52 | `args_review` | 0.0% | 0.0% | +40ms |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `result_verification` | 0.0% | 0.0% | +52ms |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `route` | 0.0% | 0.0% | +36ms |
| `decision_alt_questions` | d3:2b | decision_combo_52 | `tool_choice` | 0.0% | 0.0% | +37ms |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `args_review` | 0.0% | — | 0ms |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `result_verification` | 0.0% | — | 0ms |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `route` | 0.0% | — | 0ms |
| `decision_alt_questions` | lfm3:1.7b | decision_combo_52 | `tool_choice` | 0.0% | — | 0ms |

## 3. Regresiones

Sin regresiones.

## 4. Mejoras

Sin mejoras.

## 5. Matrices de Confusión

### `prod` — decision_combo_52 — `args_review` — d3:2b

| Esperado \ Predicho | approved | info_missing | tool_rejected |
|---|---|---|---|
| **approved** | 6 | 0 | 0 |
| **args_invalid** | 4 | 0 | 0 |
| **info_missing** | 2 | 2 | 0 |
| **tool_rejected** | 1 | 0 | 3 |

### `prod` — decision_combo_52 — `result_verification` — d3:2b

| Esperado \ Predicho | ok=false,cumple=false | ok=false,cumple=true | ok=true,cumple=false | ok=true,cumple=true |
|---|---|---|---|---|
| **ok=false,cumple=false** | 3 | 1 | 0 | 0 |
| **ok=false,cumple=true** | 1 | 1 | 0 | 0 |
| **ok=true,cumple=false** | 1 | 0 | 3 | 0 |
| **ok=true,cumple=true** | 0 | 0 | 0 | 4 |

### `prod` — decision_combo_52 — `route` — d3:2b

| Esperado \ Predicho | ask_user | files | fin | locate | terminal |
|---|---|---|---|---|---|
| **ask_user** | 1 | 1 | 0 | 0 | 0 |
| **files** | 0 | 2 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 2 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 2 | 0 |
| **terminal** | 0 | 0 | 1 | 0 | 2 |
| **web** | 1 | 0 | 0 | 0 | 0 |

### `prod` — decision_combo_52 — `tool_choice` — d3:2b

| Esperado \ Predicho | fetch | interact_with_process | list_directory | read_process_output | search | start_search | write_file |
|---|---|---|---|---|---|---|---|
| **ask_user** | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| **fetch** | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| **interact_with_process** | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| **list_directory** | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| **read_process_output** | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| **search** | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| **start_search** | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| **write_file** | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

### `decision_alt_questions` — decision_combo_52 — `args_review` — d3:2b

| Esperado \ Predicho | approved | info_missing | tool_rejected |
|---|---|---|---|
| **approved** | 6 | 0 | 0 |
| **args_invalid** | 4 | 0 | 0 |
| **info_missing** | 2 | 2 | 0 |
| **tool_rejected** | 1 | 0 | 3 |

### `decision_alt_questions` — decision_combo_52 — `result_verification` — d3:2b

| Esperado \ Predicho | ok=false,cumple=false | ok=false,cumple=true | ok=true,cumple=false | ok=true,cumple=true |
|---|---|---|---|---|
| **ok=false,cumple=false** | 3 | 1 | 0 | 0 |
| **ok=false,cumple=true** | 1 | 1 | 0 | 0 |
| **ok=true,cumple=false** | 1 | 0 | 3 | 0 |
| **ok=true,cumple=true** | 0 | 0 | 0 | 4 |

### `decision_alt_questions` — decision_combo_52 — `route` — d3:2b

| Esperado \ Predicho | ask_user | files | fin | locate | terminal |
|---|---|---|---|---|---|
| **ask_user** | 1 | 1 | 0 | 0 | 0 |
| **files** | 0 | 2 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 2 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 2 | 0 |
| **terminal** | 0 | 0 | 1 | 0 | 2 |
| **web** | 1 | 0 | 0 | 0 | 0 |

### `decision_alt_questions` — decision_combo_52 — `tool_choice` — d3:2b

| Esperado \ Predicho | fetch | interact_with_process | list_directory | read_process_output | search | start_search | write_file |
|---|---|---|---|---|---|---|---|
| **ask_user** | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| **fetch** | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| **interact_with_process** | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| **list_directory** | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| **read_process_output** | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| **search** | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| **start_search** | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| **write_file** | 0 | 0 | 0 | 0 | 0 | 0 | 1 |


## 6. Preguntas por Etapa

Etapas de decisión con 2 o más preguntas evaluadas en el mismo request. FP = se predijo la clase y no era; FN = era y no se predijo. En `noul` la clase positiva es `yes`.

### `prod` — decision_combo_52 — `result_verification` — d3:2b

| Pregunta | Rol | Accuracy | Evaluadas | Sin respuesta |
|---|---|---|---|---|
| `cumple` | principal | 85.7% | 14 | 0 |
| `ok` | principal | 92.9% | 14 | 0 |

| Pregunta | Clase | TP | FP | FN | Precisión | Recall |
|---|---|---|---|---|---|---|
| `cumple` | `no` | 7 | 1 | 1 | 87.5% | 87.5% |
| `cumple` | `yes` | 5 | 1 | 1 | 83.3% | 83.3% |
| `ok` | `no` | 6 | 1 | 0 | 85.7% | 100.0% |
| `ok` | `yes` | 7 | 0 | 1 | 100.0% | 87.5% |

**Cruce entre preguntas** (en cuántos runs acertó cada una)

| A | B | Runs | Ambas bien | Solo A | Solo B | Ambas mal |
|---|---|---|---|---|---|---|
| `cumple` | `ok` | 14 | 11 | 1 | 2 | 0 |

### `decision_alt_questions` — decision_combo_52 — `result_verification` — d3:2b

| Pregunta | Rol | Accuracy | Evaluadas | Sin respuesta |
|---|---|---|---|---|
| `cumple` | principal | 85.7% | 14 | 0 |
| `ok` | principal | 92.9% | 14 | 0 |

| Pregunta | Clase | TP | FP | FN | Precisión | Recall |
|---|---|---|---|---|---|---|
| `cumple` | `no` | 7 | 1 | 1 | 87.5% | 87.5% |
| `cumple` | `yes` | 5 | 1 | 1 | 83.3% | 83.3% |
| `ok` | `no` | 6 | 1 | 0 | 85.7% | 100.0% |
| `ok` | `yes` | 7 | 0 | 1 | 100.0% | 87.5% |

**Cruce entre preguntas** (en cuántos runs acertó cada una)

| A | B | Runs | Ambas bien | Solo A | Solo B | Ambas mal |
|---|---|---|---|---|---|---|
| `cumple` | `ok` | 14 | 11 | 1 | 2 | 0 |

