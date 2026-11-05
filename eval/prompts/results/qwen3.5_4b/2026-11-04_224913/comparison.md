# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|
| prod (baseline) | 81.8% (27/33) | — | 0 | 0 | 0 | 682ms |
| jarvis_alt_v1 | 78.8% (26/33) | -3.0% | 1 | 0 | 0 | 676ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | agentic_30 | `route` | 85.7% (6/7) | 85.7% | 269ms | 4860ms | ~239/115/354 | 85.7% |
| `prod` | agentic_30 | `tool_choice` | 100.0% (4/4) | 100.0% | 33ms | 47ms | ~161/117/278 | 100.0% |
| `prod` | agentic_30 | `arguments` | 33.3% (1/3) | 33.3% | 2402ms | 6484ms | 198/56/254 | — |
| `prod` | agentic_30 | `final[think=on]` | 100.0% (3/3) | 100.0% | 15060ms | 23288ms | 145/1281/1426 | — |
| `prod` | agentic_30 | `final[think=off]` | 100.0% (3/3) | 100.0% | 564ms | 682ms | 108/33/141 | — |
| `prod` | agentic_30 | `args_review` | 33.3% (1/3) | 33.3% | 188ms | 254ms | ~135/105/239 | 33.3% |
| `prod` | agentic_30 | `result_verification` | 66.7% (2/3) | 66.7% | 611ms | 3332ms | ~96/59/156 | 66.7% |
| `prod` | agentic_30 | `plan` | 100.0% (6/6) | 100.0% | 3448ms | 6378ms | 435/336/771 | — |
| `prod` | agentic_30 | `question` | 100.0% (1/1) | 100.0% | 1374ms | 1374ms | 65/23/88 | — |
| `jarvis_alt_v1` | agentic_30 | `route` | 85.7% (6/7) | 85.7% | 277ms | 901ms | ~286/115/401 | 85.7% |
| `jarvis_alt_v1` | agentic_30 | `tool_choice` | 100.0% (4/4) | 100.0% | 31ms | 47ms | ~206/117/323 | 100.0% |
| `jarvis_alt_v1` | agentic_30 | `arguments` | 33.3% (1/3) | 33.3% | 1849ms | 2313ms | 296/65/361 | — |
| `jarvis_alt_v1` | agentic_30 | `final[think=on]` | 100.0% (3/3) | 100.0% | 14397ms | 17622ms | 364/1404/1768 | — |
| `jarvis_alt_v1` | agentic_30 | `final[think=off]` | 100.0% (3/3) | 100.0% | 711ms | 1417ms | 366/77/443 | — |
| `jarvis_alt_v1` | agentic_30 | `args_review` | 33.3% (1/3) | 33.3% | 66ms | 290ms | ~303/104/407 | 33.3% |
| `jarvis_alt_v1` | agentic_30 | `result_verification` | 33.3% (1/3) | 33.3% | 328ms | 676ms | ~176/59/235 | 33.3% |
| `jarvis_alt_v1` | agentic_30 | `plan` | 100.0% (6/6) | 100.0% | 3501ms | 45658ms | 562/1057/1619 | — |
| `jarvis_alt_v1` | agentic_30 | `question` | 100.0% (1/1) | 100.0% | 1505ms | 1505ms | 223/24/247 | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|
| `jarvis_alt_v1` | agentic_30 | `route` | 0.0% | 0.0% | +8ms |
| `jarvis_alt_v1` | agentic_30 | `tool_choice` | 0.0% | 0.0% | -2ms |
| `jarvis_alt_v1` | agentic_30 | `arguments` | 0.0% | — | -553ms |
| `jarvis_alt_v1` | agentic_30 | `final[think=on]` | 0.0% | — | -663ms |
| `jarvis_alt_v1` | agentic_30 | `final[think=off]` | 0.0% | — | +147ms |
| `jarvis_alt_v1` | agentic_30 | `args_review` | 0.0% | 0.0% | -122ms |
| `jarvis_alt_v1` | agentic_30 | `result_verification` | -33.3% | -33.4% | -283ms |
| `jarvis_alt_v1` | agentic_30 | `plan` | 0.0% | — | +53ms |
| `jarvis_alt_v1` | agentic_30 | `question` | 0.0% | — | +131ms |

## 3. Regresiones

| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|
| `jarvis_alt_v1` | agentic_30 | `term-verify-servidor-sin-confirmar` | `result_verification` | pasa | falla | pasa -> falla |

## 4. Mejoras

Sin mejoras.

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

### `jarvis_alt_v1` — agentic_30 — `route`

| Esperado \ Predicho | ask_user | files | fin | locate | web |
|---|---|---|---|---|---|
| **ask_user** | 1 | 0 | 0 | 0 | 0 |
| **files** | 0 | 1 | 0 | 0 | 0 |
| **fin** | 0 | 0 | 1 | 0 | 0 |
| **locate** | 0 | 0 | 0 | 2 | 0 |
| **terminal** | 1 | 0 | 0 | 0 | 0 |
| **web** | 0 | 0 | 0 | 0 | 1 |

### `jarvis_alt_v1` — agentic_30 — `tool_choice`

| Esperado \ Predicho | fetch | fetch_batch | interact_with_process | move_file |
|---|---|---|---|---|
| **fetch** | 1 | 0 | 0 | 0 |
| **fetch_batch** | 0 | 1 | 0 | 0 |
| **interact_with_process** | 0 | 0 | 1 | 0 |
| **move_file** | 0 | 0 | 0 | 1 |

### `jarvis_alt_v1` — agentic_30 — `args_review`

| Esperado \ Predicho | approved | info_missing |
|---|---|---|
| **args_invalid** | 1 | 0 |
| **info_missing** | 0 | 1 |
| **tool_rejected** | 1 | 0 |

### `jarvis_alt_v1` — agentic_30 — `result_verification`

| Esperado \ Predicho | ok=false,cumple=false |
|---|---|
| **ok=false,cumple=false** | 1 |
| **ok=true,cumple=false** | 2 |

