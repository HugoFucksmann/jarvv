# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|
| prod (baseline) | 100.0% (3/3) | — | 0 | 0 | 0 | 0ms |
| jarvis_alt_v2 | 100.0% (3/3) | 0.0% | 0 | 0 | 0 | 0ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## 1. Resumen por Etapa

| Variante | Modelo | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| `prod` | — | decision_combo_52 | `args_review` | 100.0% (3/3) | 100.0% | 0ms | 0ms | ~146/65/211 | 100.0% |
| `jarvis_alt_v2` | — | decision_combo_52 | `args_review` | 100.0% (3/3) | 100.0% | 0ms | 0ms | ~315/65/380 | 100.0% |

`~` = tokens estimados (caracteres/3), no medidos por el modelo.

## 2. Deltas vs Baseline

| Variante | Modelo | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | — | decision_combo_52 | `args_review` | 0.0% | 0.0% | 0ms |

## 3. Regresiones

Sin regresiones.

## 4. Mejoras

Sin mejoras.

## 5. Matrices de Confusión

### `prod` — decision_combo_52 — `args_review`

| Esperado \ Predicho | approved | args_invalid | info_missing |
|---|---|---|---|
| **approved** | 1 | 0 | 0 |
| **args_invalid** | 0 | 1 | 0 |
| **info_missing** | 0 | 0 | 1 |

### `jarvis_alt_v2` — decision_combo_52 — `args_review`

| Esperado \ Predicho | approved | args_invalid | info_missing |
|---|---|---|---|
| **approved** | 1 | 0 | 0 |
| **args_invalid** | 0 | 1 | 0 |
| **info_missing** | 0 | 0 | 1 |

