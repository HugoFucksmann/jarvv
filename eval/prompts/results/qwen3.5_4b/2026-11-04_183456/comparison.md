# Reporte de Comparación

**Baseline:** `prod`

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | smoke | `route` | 100.0% (1/1) | 100.0% | 2624ms | 2624ms | ~81/94/175 | 100.0% |
| `prod` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 24ms | 24ms | ~74/93/167 | 100.0% |
| `prod` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 26ms | 26ms | ~94/105/199 | 100.0% |
| `prod` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 40ms | 40ms | ~71/58/129 | 100.0% |
| `prod` | smoke | `plan` | 100.0% (1/1) | 100.0% | 14391ms | 14391ms | 31/1183/1214 | — |
| `prod` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 436ms | 436ms | 33/32/65 | — |
| `prod` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 16599ms | 16599ms | 33/1786/1819 | — |
| `prod` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 296ms | 296ms | 35/15/50 | — |
| `prod` | smoke | `question` | 100.0% (1/1) | 100.0% | 213ms | 213ms | 30/12/42 | — |
| `route_example` | smoke | `route` | 100.0% (1/1) | 100.0% | 1006ms | 1006ms | ~110/95/205 | 100.0% |
| `route_example` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 23ms | 23ms | ~74/93/167 | 100.0% |
| `route_example` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 25ms | 25ms | ~94/105/199 | 100.0% |
| `route_example` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 40ms | 40ms | ~71/58/129 | 100.0% |
| `route_example` | smoke | `plan` | 100.0% (1/1) | 100.0% | 14543ms | 14543ms | 31/1098/1129 | — |
| `route_example` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 449ms | 449ms | 33/32/65 | — |
| `route_example` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 19129ms | 19129ms | 33/2048/2081 | — |
| `route_example` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 244ms | 244ms | 35/15/50 | — |
| `route_example` | smoke | `question` | 100.0% (1/1) | 100.0% | 220ms | 220ms | 30/12/42 | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|
| `route_example` | smoke | `route` | 0.0% | 0.0% | -1618ms |
| `route_example` | smoke | `tool_choice` | 0.0% | 0.0% | -1ms |
| `route_example` | smoke | `args_review` | 0.0% | 0.0% | -1ms |
| `route_example` | smoke | `result_verification` | 0.0% | 0.0% | 0ms |
| `route_example` | smoke | `plan` | 0.0% | — | +152ms |
| `route_example` | smoke | `arguments` | 0.0% | — | +13ms |
| `route_example` | smoke | `final[think=on]` | 0.0% | — | +2530ms |
| `route_example` | smoke | `final[think=off]` | 0.0% | — | -52ms |
| `route_example` | smoke | `question` | 0.0% | — | +7ms |

## 3. Regresiones

Sin regresiones.

## 4. Mejoras

Sin mejoras.

## 5. Matrices de Confusión

### `prod` — smoke — `route`

| Esperado \ Predicho | files |
|---|---|
| **files** | 1 |

### `prod` — smoke — `tool_choice`

| Esperado \ Predicho | read_file |
|---|---|
| **read_file** | 1 |

### `prod` — smoke — `args_review`

| Esperado \ Predicho | approved |
|---|---|
| **approved** | 1 |

### `prod` — smoke — `result_verification`

| Esperado \ Predicho | ok=true,cumple=true |
|---|---|
| **ok=true,cumple=true** | 1 |

### `route_example` — smoke — `route`

| Esperado \ Predicho | files |
|---|---|
| **files** | 1 |

### `route_example` — smoke — `tool_choice`

| Esperado \ Predicho | read_file |
|---|---|
| **read_file** | 1 |

### `route_example` — smoke — `args_review`

| Esperado \ Predicho | approved |
|---|---|
| **approved** | 1 |

### `route_example` — smoke — `result_verification`

| Esperado \ Predicho | ok=true,cumple=true |
|---|---|
| **ok=true,cumple=true** | 1 |

