# Resumen de Evaluación — LLM

- **Modelo:** `qwen3.5:4b`
- **Dataset:** `v1` (cases_v1.ts)
- **Prompts:** `Q2 (Q2.ts)`
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
| **Latencia Promedio** (sin errores) | 4196 ms |
| **Finish Reasons** | `{"stop":8}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 1/2 | 50.0% | 0 | 0 | 3335 ms |
| **REPLAN** | 1/1 | 100.0% | 0 | 0 | 4674 ms |
| **ARGUMENTS** | 1/3 | 33.3% | 0 | 0 | 1311 ms |
| **FINAL_RESPONSE** | 2/2 | 100.0% | 0 | 0 | 9146 ms |

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
| no_forbidden_values | 0/2 (0.0%) |
| no_invented_fields | 3/3 (100.0%) |
| not_truncated | 3/3 (100.0%) |
| required_fields_present | 3/3 (100.0%) |
| schema_valid | 3/3 (100.0%) |
| valid_json | 3/3 (100.0%) |

### FINAL_RESPONSE

| Check | Aprobados / Evaluados |
|---|---|
| effects_mentioned | 2/2 (100.0%) |
| facts_retained | 2/2 (100.0%) |
| min_chars_met | 2/2 (100.0%) |
| non_empty | 2/2 (100.0%) |
| not_truncated | 2/2 (100.0%) |

## Comparación Thinking (On vs Off)

### Etapa: FINAL_RESPONSE

| Modo | Aprobadas / Total | Pass Rate | Errores | Latencia Avg | Tokens Out Avg |
|---|---|---|---|---|---|
| Sin thinking | 1/1 | 100.0% | 0 | 3952 ms | 415 |
| Con thinking | 1/1 | 100.0% | 0 | 14339 ms | 1736 |

#### Detalle por caso

- **final_abort_excel_no_creado:** off=PASS (3952ms) | on=PASS (14339ms)

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| plan_excel_modelos_ia | plan | on | FAIL | El primer paso debe usar 'web', pero usa 'locate'. |
| args_write_file_xlsx_2d | arguments | off | FAIL | Valores hardcodeados prohibidos encontrados: 2026-02-10 |
| args_start_process_script_excel | arguments | off | FAIL | Valores hardcodeados prohibidos encontrados: 2026-01-01 |
