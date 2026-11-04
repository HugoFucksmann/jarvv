# Reporte de Comparación

**Baseline:** `prod`

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | decision_discriminating | `route` | 0.0% (0/3) | 0.0% | 0ms | 0ms | ~94/24/118 | 0.0% |
| `prod` | decision_discriminating | `tool_choice` | 0.0% (0/2) | 0.0% | 0ms | 0ms | ~85/29/114 | 0.0% |
| `prod` | decision_discriminating | `args_review` | 0.0% (0/3) | 0.0% | 0ms | 0ms | ~107/26/133 | 0.0% |
| `prod` | decision_discriminating | `result_verification` | 0.0% (0/2) | 0.0% | 0ms | 0ms | ~85/19/104 | 0.0% |
| `prod` | smoke | `route` | 100.0% (1/1) | 100.0% | 0ms | 0ms | ~81/24/105 | 100.0% |
| `prod` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 0ms | 0ms | ~74/29/103 | 100.0% |
| `prod` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 0ms | 0ms | ~94/26/120 | 100.0% |
| `prod` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 0ms | 0ms | ~71/19/90 | 100.0% |
| `prod` | smoke | `plan` | 100.0% (1/1) | 100.0% | 0ms | 0ms | ~23/30/53 | — |
| `prod` | smoke | `arguments` | 0.0% (0/1) | 0.0% | 0ms | 0ms | ~24/5/29 | — |
| `prod` | smoke | `final[think=on]` | 0.0% (0/1) | 0.0% | 0ms | 0ms | ~23/5/28 | — |
| `prod` | smoke | `final[think=off]` | 0.0% (0/1) | 0.0% | 0ms | 0ms | ~23/5/28 | — |
| `prod` | smoke | `question` | 0.0% (0/1) | 0.0% | 0ms | 0ms | ~20/5/25 | — |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

Sin deltas (no hay variantes para comparar contra la baseline).

## 3. Regresiones

Sin regresiones.

## 4. Mejoras

Sin mejoras.

## 5. Matrices de Confusión

### `prod` — decision_discriminating — `route`

| Esperado \ Predicho | files |
|---|---|
| **ask_user** | 1 |
| **fin** | 1 |
| **web** | 1 |

### `prod` — decision_discriminating — `tool_choice`

| Esperado \ Predicho | read_file |
|---|---|
| **ask_user** | 1 |
| **write_file** | 1 |

### `prod` — decision_discriminating — `args_review`

| Esperado \ Predicho | approved |
|---|---|
| **args_invalid** | 1 |
| **info_missing** | 1 |
| **tool_rejected** | 1 |

### `prod` — decision_discriminating — `result_verification`

| Esperado \ Predicho | ok=true,cumple=true |
|---|---|
| **ok=false,cumple=false** | 1 |
| **ok=true,cumple=false** | 1 |

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

