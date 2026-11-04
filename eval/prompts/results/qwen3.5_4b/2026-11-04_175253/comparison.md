# Reporte de Comparación

**Baseline:** `prod`

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | smoke | `route` | 100.0% (1/1) | 100.0% | 644ms | 644ms | 81/94/175 | 100.0% |
| `prod` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 647ms | 647ms | 74/93/167 | 100.0% |
| `prod` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 31ms | 31ms | 94/105/199 | 100.0% |
| `prod` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 53ms | 53ms | 71/58/129 | 100.0% |
| `prod` | smoke | `plan` | 100.0% (1/1) | 100.0% | 14126ms | 14126ms | 31/1394/1425 | — |
| `prod` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 14508ms | 14508ms | 33/32/65 | — |
| `prod` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 12112ms | 12112ms | 33/1360/1393 | — |
| `prod` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 11916ms | 11916ms | 35/15/50 | — |
| `prod` | smoke | `question` | 100.0% (1/1) | 100.0% | 420ms | 420ms | 30/12/42 | — |
| `route_example` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 247ms | 247ms | 74/93/167 | 100.0% |
| `route_example` | smoke | `route` | 100.0% (1/1) | 100.0% | 268ms | 268ms | 110/94/204 | 100.0% |
| `route_example` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 39ms | 39ms | 94/105/199 | 100.0% |
| `route_example` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 51ms | 51ms | 71/58/129 | 100.0% |
| `route_example` | smoke | `plan` | 100.0% (1/1) | 100.0% | 20369ms | 20369ms | 31/2149/2180 | — |
| `route_example` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 20762ms | 20762ms | 33/32/65 | — |
| `route_example` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 8714ms | 8714ms | 33/956/989 | — |
| `route_example` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 8535ms | 8535ms | 35/15/50 | — |
| `route_example` | smoke | `question` | 100.0% (1/1) | 100.0% | 466ms | 466ms | 30/12/42 | — |

## 2. Deltas vs Baseline

| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|
| `route_example` | smoke | `tool_choice` | 0.0% | 0.0% | -400ms |
| `route_example` | smoke | `route` | 0.0% | 0.0% | -376ms |
| `route_example` | smoke | `args_review` | 0.0% | 0.0% | +8ms |
| `route_example` | smoke | `result_verification` | 0.0% | 0.0% | -2ms |
| `route_example` | smoke | `plan` | 0.0% | — | +6243ms |
| `route_example` | smoke | `arguments` | 0.0% | — | +6254ms |
| `route_example` | smoke | `final[think=on]` | 0.0% | — | -3398ms |
| `route_example` | smoke | `final[think=off]` | 0.0% | — | -3381ms |
| `route_example` | smoke | `question` | 0.0% | — | +46ms |

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

### `route_example` — smoke — `tool_choice`

| Esperado \ Predicho | read_file |
|---|---|
| **read_file** | 1 |

### `route_example` — smoke — `route`

| Esperado \ Predicho | files |
|---|---|
| **files** | 1 |

### `route_example` — smoke — `args_review`

| Esperado \ Predicho | approved |
|---|---|
| **approved** | 1 |

### `route_example` — smoke — `result_verification`

| Esperado \ Predicho | ok=true,cumple=true |
|---|---|
| **ok=true,cumple=true** | 1 |

