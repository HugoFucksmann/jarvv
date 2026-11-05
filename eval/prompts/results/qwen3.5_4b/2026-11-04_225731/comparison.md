# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|
| prod (baseline) | 78.8% (26/33) | — | 0 | 0 | 0 | 438ms |
| jarvis_alt_v2 | 90.9% (30/33) | +12.1% | 0 | 4 | 0 | 514ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | agentic_30 | `route` | 85.7% (6/7) | 85.7% | 328ms | 973ms | ~239/115/354 | 85.7% |
| `prod` | agentic_30 | `tool_choice` | 100.0% (4/4) | 100.0% | 30ms | 38ms | ~161/117/278 | 100.0% |
| `prod` | agentic_30 | `arguments` | 33.3% (1/3) | 33.3% | 2092ms | 2232ms | 191/63/254 | — |
| `prod` | agentic_30 | `final[think=on]` | 66.7% (2/3) | 66.7% | 7780ms | 21339ms | 160/1056/1216 | — |
| `prod` | agentic_30 | `final[think=off]` | 100.0% (3/3) | 100.0% | 438ms | 547ms | 108/32/140 | — |
| `prod` | agentic_30 | `args_review` | 33.3% (1/3) | 33.3% | 29ms | 369ms | ~135/105/240 | 33.3% |
| `prod` | agentic_30 | `result_verification` | 66.7% (2/3) | 66.7% | 422ms | 691ms | ~96/59/156 | 66.7% |
| `prod` | agentic_30 | `plan` | 100.0% (6/6) | 100.0% | 3538ms | 5540ms | 435/326/761 | — |
| `prod` | agentic_30 | `question` | 100.0% (1/1) | 100.0% | 1635ms | 1635ms | 65/24/89 | — |
| `jarvis_alt_v2` | agentic_30 | `route` | 100.0% (7/7) | 100.0% | 318ms | 853ms | ~291/116/407 | 100.0% |
| `jarvis_alt_v2` | agentic_30 | `tool_choice` | 100.0% (4/4) | 100.0% | 31ms | 36ms | ~161/117/278 | 100.0% |
| `jarvis_alt_v2` | agentic_30 | `arguments` | 66.7% (2/3) | 66.7% | 1927ms | 2139ms | 219/43/262 | — |
| `jarvis_alt_v2` | agentic_30 | `final[think=on]` | 100.0% (3/3) | 100.0% | 6924ms | 17071ms | 106/850/956 | — |
| `jarvis_alt_v2` | agentic_30 | `final[think=off]` | 100.0% (3/3) | 100.0% | 453ms | 547ms | 108/30/138 | — |
| `jarvis_alt_v2` | agentic_30 | `args_review` | 66.7% (2/3) | 66.7% | 66ms | 514ms | ~304/106/409 | 66.7% |
| `jarvis_alt_v2` | agentic_30 | `result_verification` | 66.7% (2/3) | 66.7% | 477ms | 886ms | ~186/59/245 | 66.7% |
| `jarvis_alt_v2` | agentic_30 | `plan` | 100.0% (6/6) | 100.0% | 3620ms | 8126ms | 435/372/806 | — |
| `jarvis_alt_v2` | agentic_30 | `question` | 100.0% (1/1) | 100.0% | 1599ms | 1599ms | 65/23/88 | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|
| `jarvis_alt_v2` | agentic_30 | `route` | +14.3% | +14.3% | -10ms |
| `jarvis_alt_v2` | agentic_30 | `tool_choice` | 0.0% | 0.0% | +1ms |
| `jarvis_alt_v2` | agentic_30 | `arguments` | +33.3% | — | -165ms |
| `jarvis_alt_v2` | agentic_30 | `final[think=on]` | +33.3% | — | -856ms |
| `jarvis_alt_v2` | agentic_30 | `final[think=off]` | 0.0% | — | +15ms |
| `jarvis_alt_v2` | agentic_30 | `args_review` | +33.3% | +33.4% | +37ms |
| `jarvis_alt_v2` | agentic_30 | `result_verification` | 0.0% | 0.0% | +55ms |
| `jarvis_alt_v2` | agentic_30 | `plan` | 0.0% | — | +82ms |
| `jarvis_alt_v2` | agentic_30 | `question` | 0.0% | — | -36ms |

## 3. Regresiones

Sin regresiones.

## 4. Mejoras

| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | agentic_30 | `fs-args-write-append` | `arguments` | falla | pasa | falla -> pasa |
| `jarvis_alt_v2` | agentic_30 | `term-route-tests` | `route` | falla | pasa | falla -> pasa |
| `jarvis_alt_v2` | agentic_30 | `term-review-ls-en-terminal` | `args_review` | falla | pasa | falla -> pasa |
| `jarvis_alt_v2` | agentic_30 | `comb-final-multipaso` | `final[think=on]` | falla | pasa | falla -> pasa |

## 5. Matrices de Confusión

### `prod` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | web |
|---|---|---|---|---|---|
| **ask_user** | 1 | 0 | 0 | 0 | 0 |
| **files** | 0 | 1 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 1 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 2 | 0 |
| **terminal** | 0 | 0 | 1 | 0 | 0 |
| **web** | 0 | 0 | 0 | 0 | 1 |

### `prod` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 1 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 1 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 1 | 0 |
| **move_file** | 0 | 0 | 0 | 1 |

### `prod` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing |
|---|---|---|
| **args_invalid** | 1 | 0 |
| **info_missing** | 0 | 1 |
| **tool_rejected** | 1 | 0 |

### `prod` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false | ok=true,cumple=false |
|---|---|---|
| **ok=false,cumple=false** | 1 | 0 |
| **ok=true,cumple=false** | 1 | 1 |

### `jarvis_alt_v2` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | terminal | web |
|---|---|---|---|---|---|---|
| **ask_user** | 1 | 0 | 0 | 0 | 0 | 0 |
| **files** | 0 | 1 | 0 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 1 | 0 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 2 | 0 | 0 |
| **terminal** | 0 | 0 | 0 | 0 | 1 | 0 |
| **web** | 0 | 0 | 0 | 0 | 0 | 1 |

### `jarvis_alt_v2` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 1 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 1 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 1 | 0 |
| **move_file** | 0 | 0 | 0 | 1 |

### `jarvis_alt_v2` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing | tool_rejected |
|---|---|---|---|
| **args_invalid** | 1 | 0 | 0 |
| **info_missing** | 0 | 1 | 0 |
| **tool_rejected** | 0 | 0 | 1 |

### `jarvis_alt_v2` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false | ok=true,cumple=false |
|---|---|---|
| **ok=false,cumple=false** | 1 | 0 |
| **ok=true,cumple=false** | 1 | 1 |

