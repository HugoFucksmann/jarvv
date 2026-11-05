# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|
| prod (baseline) | 80.8% (80/99) | — | 0 | 0 | 0 | 226ms |
| jarvis_alt_v2 | 88.9% (88/99) | +8.1% | 1 | 3 | 0 | 243ms |
| jarvis_alt_v3 | 80.8% (80/99) | 0.0% | 3 | 2 | 0 | 265ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | agentic_30 | `route` | 85.7% (18/21) | 85.7% | 33ms | 392ms | ~239/115/354 | 85.7% |
| `prod` | agentic_30 | `tool_choice` | 100.0% (12/12) | 100.0% | 28ms | 33ms | ~161/117/278 | 100.0% |
| `prod` | agentic_30 | `arguments` | 33.3% (3/9) | 33.3% | 995ms | 3122ms | 193/65/258 | — |
| `prod` | agentic_30 | `final[think=on]` | 100.0% (9/9) | 100.0% | 6221ms | 21462ms | 124/979/1103 | — |
| `prod` | agentic_30 | `final[think=off]` | 88.9% (8/9) | 66.7% | 373ms | 577ms | 108/30/138 | — |
| `prod` | agentic_30 | `args_review` | 33.3% (3/9) | 33.3% | 26ms | 202ms | ~135/105/239 | 33.3% |
| `prod` | agentic_30 | `result_verification` | 66.7% (6/9) | 66.7% | 47ms | 231ms | ~96/59/156 | 66.7% |
| `prod` | agentic_30 | `plan` | 100.0% (18/18) | 100.0% | 3748ms | 5452ms | 435/353/787 | — |
| `prod` | agentic_30 | `question` | 100.0% (3/3) | 100.0% | 402ms | 1385ms | 65/23/88 | — |
| `jarvis_alt_v2` | agentic_30 | `route` | 100.0% (21/21) | 100.0% | 37ms | 282ms | ~291/116/407 | 100.0% |
| `jarvis_alt_v2` | agentic_30 | `tool_choice` | 100.0% (12/12) | 100.0% | 28ms | 31ms | ~161/117/278 | 100.0% |
| `jarvis_alt_v2` | agentic_30 | `arguments` | 66.7% (6/9) | 66.7% | 666ms | 1593ms | 219/43/262 | — |
| `jarvis_alt_v2` | agentic_30 | `final[think=on]` | 100.0% (9/9) | 100.0% | 7961ms | 19194ms | 119/988/1107 | — |
| `jarvis_alt_v2` | agentic_30 | `final[think=off]` | 88.9% (8/9) | 66.7% | 391ms | 517ms | 108/31/139 | — |
| `jarvis_alt_v2` | agentic_30 | `args_review` | 66.7% (6/9) | 66.7% | 35ms | 302ms | ~304/106/409 | 66.7% |
| `jarvis_alt_v2` | agentic_30 | `result_verification` | 66.7% (6/9) | 66.7% | 64ms | 274ms | ~186/59/245 | 66.7% |
| `jarvis_alt_v2` | agentic_30 | `plan` | 94.4% (17/18) | 83.3% | 3546ms | 5491ms | 435/336/770 | — |
| `jarvis_alt_v2` | agentic_30 | `question` | 100.0% (3/3) | 100.0% | 244ms | 1402ms | 65/23/88 | — |
| `jarvis_alt_v3` | agentic_30 | `route` | 100.0% (21/21) | 100.0% | 33ms | 331ms | ~291/116/407 | 100.0% |
| `jarvis_alt_v3` | agentic_30 | `tool_choice` | 100.0% (12/12) | 100.0% | 27ms | 35ms | ~161/117/278 | 100.0% |
| `jarvis_alt_v3` | agentic_30 | `arguments` | 44.4% (4/9) | 0.0% | 615ms | 1657ms | 238/46/283 | — |
| `jarvis_alt_v3` | agentic_30 | `final[think=on]` | 100.0% (9/9) | 100.0% | 7597ms | 18012ms | 119/997/1116 | — |
| `jarvis_alt_v3` | agentic_30 | `final[think=off]` | 77.8% (7/9) | 66.7% | 349ms | 523ms | 108/30/138 | — |
| `jarvis_alt_v3` | agentic_30 | `args_review` | 33.3% (3/9) | 33.3% | 33ms | 265ms | ~356/105/461 | 33.3% |
| `jarvis_alt_v3` | agentic_30 | `result_verification` | 33.3% (3/9) | 33.3% | 49ms | 491ms | ~184/59/243 | 33.3% |
| `jarvis_alt_v3` | agentic_30 | `plan` | 100.0% (18/18) | 100.0% | 3642ms | 5762ms | 435/356/791 | — |
| `jarvis_alt_v3` | agentic_30 | `question` | 100.0% (3/3) | 100.0% | 350ms | 1315ms | 65/23/88 | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|
| `jarvis_alt_v2` | agentic_30 | `route` | +14.3% | +14.3% | +4ms |
| `jarvis_alt_v2` | agentic_30 | `tool_choice` | 0.0% | 0.0% | 0ms |
| `jarvis_alt_v2` | agentic_30 | `arguments` | +33.3% | — | -329ms |
| `jarvis_alt_v2` | agentic_30 | `final[think=on]` | 0.0% | — | +1740ms |
| `jarvis_alt_v2` | agentic_30 | `final[think=off]` | 0.0% | — | +18ms |
| `jarvis_alt_v2` | agentic_30 | `args_review` | +33.3% | +33.4% | +9ms |
| `jarvis_alt_v2` | agentic_30 | `result_verification` | 0.0% | 0.0% | +17ms |
| `jarvis_alt_v2` | agentic_30 | `plan` | -5.6% | — | -202ms |
| `jarvis_alt_v2` | agentic_30 | `question` | 0.0% | — | -158ms |
| `jarvis_alt_v3` | agentic_30 | `route` | +14.3% | +14.3% | 0ms |
| `jarvis_alt_v3` | agentic_30 | `tool_choice` | 0.0% | 0.0% | -1ms |
| `jarvis_alt_v3` | agentic_30 | `arguments` | +11.1% | — | -380ms |
| `jarvis_alt_v3` | agentic_30 | `final[think=on]` | 0.0% | — | +1376ms |
| `jarvis_alt_v3` | agentic_30 | `final[think=off]` | -11.1% | — | -24ms |
| `jarvis_alt_v3` | agentic_30 | `args_review` | 0.0% | 0.0% | +7ms |
| `jarvis_alt_v3` | agentic_30 | `result_verification` | -33.3% | -33.4% | +2ms |
| `jarvis_alt_v3` | agentic_30 | `plan` | 0.0% | — | -106ms |
| `jarvis_alt_v3` | agentic_30 | `question` | 0.0% | — | -52ms |

## 3. Regresiones

| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | agentic_30 | `comb-plan-web-y-archivo` | `plan` | 3/3 | 2/3 | 3/3 -> 2/3 |
| `jarvis_alt_v3` | agentic_30 | `term-args-start-process` | `arguments` | 3/3 | 2/3 | 3/3 -> 2/3 |
| `jarvis_alt_v3` | agentic_30 | `comb-final-multipaso` | `final[think=off]` | 2/3 | 1/3 | 2/3 -> 1/3 |
| `jarvis_alt_v3` | agentic_30 | `prob-verify-permiso-denegado` | `result_verification` | 3/3 | 0/3 | 3/3 -> 0/3 |

## 4. Mejoras

| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | agentic_30 | `fs-args-write-append` | `arguments` | 0/3 | 3/3 | 0/3 -> 3/3 |
| `jarvis_alt_v2` | agentic_30 | `term-route-tests` | `route` | 0/3 | 3/3 | 0/3 -> 3/3 |
| `jarvis_alt_v2` | agentic_30 | `term-review-ls-en-terminal` | `args_review` | 0/3 | 3/3 | 0/3 -> 3/3 |
| `jarvis_alt_v3` | agentic_30 | `fs-args-write-append` | `arguments` | 0/3 | 2/3 | 0/3 -> 2/3 |
| `jarvis_alt_v3` | agentic_30 | `term-route-tests` | `route` | 0/3 | 3/3 | 0/3 -> 3/3 |

## 5. Matrices de Confusión

### `prod` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | web |
|---|---|---|---|---|---|
| **ask_user** | 3 | 0 | 0 | 0 | 0 |
| **files** | 0 | 3 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 3 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 6 | 0 |
| **terminal** | 0 | 0 | 3 | 0 | 0 |
| **web** | 0 | 0 | 0 | 0 | 3 |

### `prod` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 3 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 3 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 3 | 0 |
| **move_file** | 0 | 0 | 0 | 3 |

### `prod` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing |
|---|---|---|
| **args_invalid** | 3 | 0 |
| **info_missing** | 0 | 3 |
| **tool_rejected** | 3 | 0 |

### `prod` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false | ok=true,cumple=false |
|---|---|---|
| **ok=false,cumple=false** | 3 | 0 |
| **ok=true,cumple=false** | 3 | 3 |

### `jarvis_alt_v2` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | terminal | web |
|---|---|---|---|---|---|---|
| **ask_user** | 3 | 0 | 0 | 0 | 0 | 0 |
| **files** | 0 | 3 | 0 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 3 | 0 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 6 | 0 | 0 |
| **terminal** | 0 | 0 | 0 | 0 | 3 | 0 |
| **web** | 0 | 0 | 0 | 0 | 0 | 3 |

### `jarvis_alt_v2` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 3 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 3 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 3 | 0 |
| **move_file** | 0 | 0 | 0 | 3 |

### `jarvis_alt_v2` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing | tool_rejected |
|---|---|---|---|
| **args_invalid** | 3 | 0 | 0 |
| **info_missing** | 0 | 3 | 0 |
| **tool_rejected** | 0 | 0 | 3 |

### `jarvis_alt_v2` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false | ok=true,cumple=false |
|---|---|---|
| **ok=false,cumple=false** | 3 | 0 |
| **ok=true,cumple=false** | 3 | 3 |

### `jarvis_alt_v3` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | terminal | web |
|---|---|---|---|---|---|---|
| **ask_user** | 3 | 0 | 0 | 0 | 0 | 0 |
| **files** | 0 | 3 | 0 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 3 | 0 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 6 | 0 | 0 |
| **terminal** | 0 | 0 | 0 | 0 | 3 | 0 |
| **web** | 0 | 0 | 0 | 0 | 0 | 3 |

### `jarvis_alt_v3` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 3 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 3 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 3 | 0 |
| **move_file** | 0 | 0 | 0 | 3 |

### `jarvis_alt_v3` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing |
|---|---|---|
| **args_invalid** | 3 | 0 |
| **info_missing** | 0 | 3 |
| **tool_rejected** | 3 | 0 |

### `jarvis_alt_v3` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false | ok=true,cumple=false |
|---|---|---|
| **ok=false,cumple=false** | 0 | 3 |
| **ok=true,cumple=false** | 3 | 3 |

