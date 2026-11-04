# Reporte de Comparación

**Baseline:** `prod`

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | smoke | `route` | 100.0% (1/1) | 100.0% | 2608ms | 2608ms | 81/94/175 | 100.0% |
| `prod` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 24ms | 24ms | 74/93/167 | 100.0% |
| `prod` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 23ms | 23ms | 94/105/199 | 100.0% |
| `prod` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 42ms | 42ms | 71/58/129 | 100.0% |
| `prod` | smoke | `plan` | 100.0% (1/1) | 100.0% | 12254ms | 12254ms | 31/1044/1075 | — |
| `prod` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 399ms | 399ms | 33/32/65 | — |
| `prod` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 10276ms | 10276ms | 33/1192/1225 | — |
| `prod` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 330ms | 330ms | 35/15/50 | — |
| `prod` | smoke | `question` | 100.0% (1/1) | 100.0% | 238ms | 238ms | 30/12/42 | — |

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

