# Resumen de Evaluación — LLM

- **Modelo:** `qwen3.5:4b`
- **Dataset:** `v1` (cases_v1.ts)
- **Prompts:** `Q2_reglas (Q2_reglas.ts)`
- **Filtro de Etapa:** `all`
- **Endpoint:** `http://127.0.0.1:11434/v1/chat/completions`
- **Contexto:** `16384` tokens
- **Timeouts:** `120000ms` (sin thinking) / `180000ms` (thinking)
- **Max tokens:** `plan=4096, replan=4096, arguments=2048, final_response=2048`
- **Final thinking:** `both`

## Métricas Globales

| Métrica | Valor |
|---|---|
| **Casos** | 7 |
| **Ejecuciones** (caso × modo thinking) | 8 |
| **Aprobadas (PASS)** | 5 (62.5%) |
| **Falladas (FAIL)** | 3 |
| **Errores de ejecución** | 0 |
| **Latencia Promedio** (sin errores) | 5882 ms |
| **Finish Reasons** | `{"stop":7,"length":1}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 1/2 | 50.0% | 0 | 0 | 4342 ms |
| **REPLAN** | 1/1 | 100.0% | 0 | 0 | 9641 ms |
| **ARGUMENTS** | 2/3 | 66.7% | 0 | 0 | 1379 ms |
| **FINAL_RESPONSE** | 1/2 | 50.0% | 0 | 1 | 12298 ms |

## Checks por Etapa

Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.

### PLAN

| Check | Aprobados / Evaluados |
|---|---|
| first_route_matches | 0/1 (0.0%) |
| max_steps_met | 2/2 (100.0%) |
| min_steps_met | 1/1 (100.0%) |
| no_forbidden_keywords | 1/1 (100.0%) |
| not_truncated | 2/2 (100.0%) |
| required_keywords_met | 1/1 (100.0%) |
| required_routes_used | 1/1 (100.0%) |
| routes_allowed | 1/1 (100.0%) |
| valid_json | 2/2 (100.0%) |
| valid_steps_structure | 2/2 (100.0%) |
| has_objective (soft) | 2/2 (100.0%) |

### REPLAN

| Check | Aprobados / Evaluados |
|---|---|
| action_matches_expected | 1/1 (100.0%) |
| max_steps_met | 1/1 (100.0%) |
| min_steps_met | 1/1 (100.0%) |
| not_truncated | 1/1 (100.0%) |
| respects_completed | 1/1 (100.0%) |
| respects_effects | 1/1 (100.0%) |
| routes_allowed | 1/1 (100.0%) |
| valid_action | 1/1 (100.0%) |
| valid_json | 1/1 (100.0%) |
| valid_steps_structure | 1/1 (100.0%) |
| has_objective (soft) | 0/1 (0.0%) |

### ARGUMENTS

| Check | Aprobados / Evaluados |
|---|---|
| field_content_json | 0/1 (0.0%) |
| no_forbidden_values | 1/2 (50.0%) |
| no_invented_fields | 3/3 (100.0%) |
| not_truncated | 3/3 (100.0%) |
| required_fields_present | 3/3 (100.0%) |
| schema_valid | 3/3 (100.0%) |
| valid_json | 3/3 (100.0%) |

### FINAL_RESPONSE

| Check | Aprobados / Evaluados |
|---|---|
| effects_mentioned | 1/1 (100.0%) |
| facts_retained | 1/1 (100.0%) |
| min_chars_met | 1/1 (100.0%) |
| non_empty | 1/2 (50.0%) |
| not_truncated | 1/2 (50.0%) |

## Comparación Thinking (On vs Off)

### Etapa: FINAL_RESPONSE

| Modo | Aprobadas / Total | Pass Rate | Errores | Latencia Avg | Tokens Out Avg |
|---|---|---|---|---|---|
| Sin thinking | 1/1 | 100.0% | 0 | 5359 ms | 514 |
| Con thinking | 0/1 | 0.0% | 0 | 19237 ms | 2048 |

#### Detalle por caso

- **final_abort_excel_no_creado:** off=PASS (5359ms) | on=FAIL (19237ms)

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| plan_excel_modelos_ia | plan | on | FAIL | El primer paso debe usar 'web', pero usa 'locate'. |
| args_write_file_xlsx_2d | arguments | off | FAIL | Valores hardcodeados prohibidos encontrados: 2026-02-10 |
| final_abort_excel_no_creado | final_response | on | FAIL | Respuesta final truncada por límite de tokens (finish_reason=length). |
