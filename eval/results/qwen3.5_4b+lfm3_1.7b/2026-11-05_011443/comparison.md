# Reporte de Comparación

**Baseline:** `prod`

## Resumen por Variante

| Modelo | Variante | passRate | Δ vs baseline | Regresiones | Mejoras | Fallas cliente | p50 |
|---|---|---|---|---|---|---|---|
| qwen3.5:4b | prod (baseline) | 70.7% (41/58) | — | 0 | 0 | 0 | 915ms |
| lfm3:1.7b | prod (baseline) | 60.3% (35/58) | — | 0 | 0 | 0 | 460ms |
| qwen3.5:4b | jarvis_alt_v2 | 74.1% (43/58) | +3.4% | 1 | 3 | 0 | 611ms |
| lfm3:1.7b | jarvis_alt_v2 | 56.9% (33/58) | -3.4% | 2 | 0 | 0 | 444ms |

Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.

## Comparación entre Modelos

Mismo dataset y variante contra cada modelo. Los deltas son contra el **primer modelo** de la lista (ref). Cada modelo corre solo las etapas de su tipo; la accuracy es la de las decisiones.

### `prod` — llm_generative_48 — etapas generativas

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 70.7% (41/58) | — | — | — | 915ms | — | 25652ms | — | 210/549/759 | 0 |
| **lfm3:1.7b** | 60.3% (35/58) | -10.3% | — | — | 460ms | -455ms | 37434ms | +11782ms | 242/1064/1306 | 0 |

**`plan`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 92.9% (13/14) | — | — | — | 3660ms | — | 85442ms | — | 472/1076/1548 | 0 |
| **lfm3:1.7b** | 64.3% (9/14) | -28.6% | — | — | 8409ms | +4749ms | 41865ms | -43577ms | 615/3954/4568 | 0 |

**`arguments`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 42.9% (6/14) | — | — | — | 728ms | — | 1027ms | — | 187/67/254 | 0 |
| **lfm3:1.7b** | 0.0% (0/14) | -42.9% | — | — | 398ms | -330ms | 517ms | -510ms | 205/81/286 | 0 |

**`final[think=on]`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 72.7% (8/11) | — | — | — | 6045ms | — | 25699ms | — | 128/1400/1528 | 0 |
| **lfm3:1.7b** | 100.0% (11/11) | +27.3% | — | — | 1259ms | -4786ms | 3048ms | -22651ms | 91/373/463 | 0 |

**`final[think=off]`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 63.6% (7/11) | — | — | — | 252ms | — | 505ms | — | 95/22/116 | 0 |
| **lfm3:1.7b** | 90.9% (10/11) | +27.3% | — | — | 365ms | +113ms | 485ms | -20ms | 92/83/175 | 0 |

**`question`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 87.5% (7/8) | — | — | — | 251ms | — | 314ms | — | 68/22/89 | 0 |
| **lfm3:1.7b** | 62.5% (5/8) | -25.0% | — | — | 134ms | -117ms | 173ms | -141ms | 68/27/95 | 0 |

**Casos donde los modelos discrepan (22)**

| Caso | Stage | qwen3.5:4b | lfm3:1.7b |
|---|---|---|---|
| `pl-locate-antes-de-leer` | `plan` | pasa | falla |
| `pl-fetch-y-guardar` | `plan` | pasa | falla |
| `pl-dos-comandos` | `plan` | pasa | falla |
| `pl-tres-proyectos` | `plan` | pasa | falla |
| `pl-replan-efecto-ejecutado` | `plan` | falla | pasa |
| `pl-replan-feedback-backup` | `plan` | pasa | falla |
| `ar-search-sin-max` | `arguments` | pasa | falla |
| `ar-proc-timeout` | `arguments` | pasa | falla |
| `ar-move-espacios` | `arguments` | pasa | falla |
| `ar-interact-pid` | `arguments` | pasa | falla |
| `ar-fetch-batch` | `arguments` | pasa | falla |
| `ar-read-multiple` | `arguments` | pasa | falla |
| `fn-multipaso` | `final[think=off]` | falla | pasa |
| `fn-sin-plan-pro` | `final[think=on]` | falla | pasa |
| `fn-comparar-precios` | `final[think=on]` | falla | pasa |
| `fn-comparar-precios` | `final[think=off]` | falla | pasa |
| `fn-timeout-proceso` | `final[think=on]` | falla | pasa |
| `fn-timeout-proceso` | `final[think=off]` | falla | pasa |
| `qs-un-dato-bloqueante` | `question` | pasa | falla |
| `qs-nombre-con-guion-bajo` | `question` | falla | pasa |
| `qs-sin-jerga-interna` | `question` | pasa | falla |
| `qs-ingles` | `question` | pasa | falla |

### `jarvis_alt_v2` — llm_generative_48 — etapas generativas

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 74.1% (43/58) | — | — | — | 611ms | — | 17457ms | — | 208/342/550 | 0 |
| **lfm3:1.7b** | 56.9% (33/58) | -17.2% | — | — | 444ms | -167ms | 24554ms | +7097ms | 254/863/1117 | 0 |

**`plan`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 100.0% (14/14) | — | — | — | 2965ms | — | 7698ms | — | 436/392/828 | 0 |
| **lfm3:1.7b** | 57.1% (8/14) | -42.9% | — | — | 4721ms | +1756ms | 41158ms | +33460ms | 583/3097/3680 | 0 |

**`arguments`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 50.0% (7/14) | — | — | — | 539ms | — | 869ms | — | 238/47/285 | 0 |
| **lfm3:1.7b** | 0.0% (0/14) | -50.0% | — | — | 393ms | -146ms | 472ms | -397ms | 288/78/366 | 0 |

**`final[think=on]`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 72.7% (8/11) | — | — | — | 6872ms | — | 25290ms | — | 93/1210/1303 | 0 |
| **lfm3:1.7b** | 100.0% (11/11) | +27.3% | — | — | 1512ms | -5360ms | 3639ms | -21651ms | 91/407/498 | 0 |

**`final[think=off]`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 63.6% (7/11) | — | — | — | 243ms | — | 530ms | — | 95/21/116 | 0 |
| **lfm3:1.7b** | 90.9% (10/11) | +27.3% | — | — | 369ms | +126ms | 474ms | -56ms | 92/79/171 | 0 |

**`question`**

| Modelo | passRate | Δ pass | Accuracy | Δ acc | p50 | Δ p50 | p95 | Δ p95 | Tokens (P/C/T) | Fallas cliente |
|---|---|---|---|---|---|---|---|---|---|---|
| **qwen3.5:4b** (ref) | 87.5% (7/8) | — | — | — | 241ms | — | 311ms | — | 68/20/87 | 0 |
| **lfm3:1.7b** | 50.0% (4/8) | -37.5% | — | — | 134ms | -107ms | 242ms | -69ms | 68/30/99 | 0 |

**Casos donde los modelos discrepan (22)**

| Caso | Stage | qwen3.5:4b | lfm3:1.7b |
|---|---|---|---|
| `pl-locate-antes-de-leer` | `plan` | pasa | falla |
| `pl-fetch-y-guardar` | `plan` | pasa | falla |
| `pl-dos-comandos` | `plan` | pasa | falla |
| `pl-url-conocida-precio` | `plan` | pasa | falla |
| `pl-tres-proyectos` | `plan` | pasa | falla |
| `pl-replan-feedback-backup` | `plan` | pasa | falla |
| `ar-search-sin-max` | `arguments` | pasa | falla |
| `ar-proc-timeout` | `arguments` | pasa | falla |
| `ar-move-espacios` | `arguments` | pasa | falla |
| `ar-interact-pid` | `arguments` | pasa | falla |
| `ar-fetch-batch` | `arguments` | pasa | falla |
| `ar-read-multiple` | `arguments` | pasa | falla |
| `ar-ref-contenido` | `arguments` | pasa | falla |
| `fn-sin-plan-pro` | `final[think=on]` | falla | pasa |
| `fn-comparar-precios` | `final[think=on]` | falla | pasa |
| `fn-comparar-precios` | `final[think=off]` | falla | pasa |
| `fn-carpeta-mas-grande` | `final[think=off]` | falla | pasa |
| `fn-timeout-proceso` | `final[think=on]` | falla | pasa |
| `fn-timeout-proceso` | `final[think=off]` | falla | pasa |
| `qs-un-dato-bloqueante` | `question` | pasa | falla |
| `qs-sin-jerga-interna` | `question` | pasa | falla |
| `qs-ingles` | `question` | pasa | falla |

## 1. Resumen por Etapa

| Variante | Modelo | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| `prod` | qwen3.5:4b | llm_generative_48 | `plan` | 92.9% (13/14) | 92.9% | 3660ms | 85442ms | 472/1076/1548 | — |
| `prod` | qwen3.5:4b | llm_generative_48 | `arguments` | 42.9% (6/14) | 42.9% | 728ms | 1027ms | 187/67/254 | — |
| `prod` | qwen3.5:4b | llm_generative_48 | `final[think=on]` | 72.7% (8/11) | 72.7% | 6045ms | 25699ms | 128/1400/1528 | — |
| `prod` | qwen3.5:4b | llm_generative_48 | `final[think=off]` | 63.6% (7/11) | 63.6% | 252ms | 505ms | 95/22/116 | — |
| `prod` | qwen3.5:4b | llm_generative_48 | `question` | 87.5% (7/8) | 87.5% | 251ms | 314ms | 68/22/89 | — |
| `prod` | lfm3:1.7b | llm_generative_48 | `plan` | 64.3% (9/14) | 64.3% | 8409ms | 41865ms | 615/3954/4568 | — |
| `prod` | lfm3:1.7b | llm_generative_48 | `arguments` | 0.0% (0/14) | 0.0% | 398ms | 517ms | 205/81/286 | — |
| `prod` | lfm3:1.7b | llm_generative_48 | `final[think=on]` | 100.0% (11/11) | 100.0% | 1259ms | 3048ms | 91/373/463 | — |
| `prod` | lfm3:1.7b | llm_generative_48 | `final[think=off]` | 90.9% (10/11) | 90.9% | 365ms | 485ms | 92/83/175 | — |
| `prod` | lfm3:1.7b | llm_generative_48 | `question` | 62.5% (5/8) | 62.5% | 134ms | 173ms | 68/27/95 | — |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `plan` | 100.0% (14/14) | 100.0% | 2965ms | 7698ms | 436/392/828 | — |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `arguments` | 50.0% (7/14) | 50.0% | 539ms | 869ms | 238/47/285 | — |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `final[think=on]` | 72.7% (8/11) | 72.7% | 6872ms | 25290ms | 93/1210/1303 | — |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `final[think=off]` | 63.6% (7/11) | 63.6% | 243ms | 530ms | 95/21/116 | — |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `question` | 87.5% (7/8) | 87.5% | 241ms | 311ms | 68/20/87 | — |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `plan` | 57.1% (8/14) | 57.1% | 4721ms | 41158ms | 583/3097/3680 | — |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `arguments` | 0.0% (0/14) | 0.0% | 393ms | 472ms | 288/78/366 | — |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `final[think=on]` | 100.0% (11/11) | 100.0% | 1512ms | 3639ms | 91/407/498 | — |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `final[think=off]` | 90.9% (10/11) | 90.9% | 369ms | 474ms | 92/79/171 | — |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `question` | 50.0% (4/8) | 50.0% | 134ms | 242ms | 68/30/99 | — |

## 2. Deltas vs Baseline

| Variante | Modelo | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |
|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `plan` | +7.1% | — | -695ms |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `arguments` | +7.1% | — | -189ms |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `final[think=on]` | 0.0% | — | +827ms |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `final[think=off]` | 0.0% | — | -9ms |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `question` | 0.0% | — | -10ms |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `plan` | -7.1% | — | -3688ms |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `arguments` | 0.0% | — | -5ms |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `final[think=on]` | 0.0% | — | +253ms |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `final[think=off]` | 0.0% | — | +4ms |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `question` | -12.5% | — | 0ms |

## 3. Regresiones

| Variante | Modelo | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `fn-carpeta-mas-grande` | `final[think=off]` | pasa | falla | pasa -> falla |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `pl-url-conocida-precio` | `plan` | pasa | falla | pasa -> falla |
| `jarvis_alt_v2` | lfm3:1.7b | llm_generative_48 | `qs-nombre-con-guion-bajo` | `question` | pasa | falla | pasa -> falla |

## 4. Mejoras

| Variante | Modelo | Dataset | Caso | Stage | Baseline | Variante | Cambio |
|---|---|---|---|---|---|---|---|
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `pl-replan-efecto-ejecutado` | `plan` | falla | pasa | falla -> pasa |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `ar-ref-contenido` | `arguments` | falla | pasa | falla -> pasa |
| `jarvis_alt_v2` | qwen3.5:4b | llm_generative_48 | `fn-multipaso` | `final[think=off]` | falla | pasa | falla -> pasa |
