# Reporte de Comparación

**Baseline:** `prod`

## 1. Resumen por Etapa

| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|
| `prod` | smoke | `route` | 100.0% (1/1) | 100.0% | 5152ms | 5152ms | 81/94/175 | 100.0% |
| `prod` | smoke | `tool_choice` | 100.0% (1/1) | 100.0% | 5189ms | 5189ms | 74/93/167 | 100.0% |
| `prod` | smoke | `args_review` | 100.0% (1/1) | 100.0% | 27ms | 27ms | 94/105/199 | 100.0% |
| `prod` | smoke | `result_verification` | 100.0% (1/1) | 100.0% | 60ms | 60ms | 71/58/129 | 100.0% |
| `prod` | smoke | `plan` | 100.0% (1/1) | 100.0% | 31374ms | 31374ms | 31/3082/3113 | — |
| `prod` | smoke | `arguments` | 100.0% (1/1) | 100.0% | 31726ms | 31726ms | 33/32/65 | — |
| `prod` | smoke | `final[think=on]` | 100.0% (1/1) | 100.0% | 7208ms | 7208ms | 33/843/876 | — |
| `prod` | smoke | `final[think=off]` | 100.0% (1/1) | 100.0% | 7057ms | 7057ms | 35/15/50 | — |
| `prod` | smoke | `question` | 100.0% (1/1) | 100.0% | 420ms | 420ms | 30/12/42 | — |

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

