# Resumen de Evaluación — LLM

- **Modelo:** `qwen3.5:4b`
- **Dataset:** `v3` (cases_v3.ts)
- **Prompts:** `Q0 (producción: src/core/reasoner/prompts.ts)`
- **Filtro de Etapa:** `all`
- **Endpoint:** `http://127.0.0.1:11434/v1/chat/completions`
- **Contexto:** `16384` tokens
- **Timeouts:** `120000ms` (sin thinking) / `180000ms` (thinking)
- **Max tokens:** `plan=4096, replan=4096, arguments=2048, final_response=2048`
- **Final thinking:** `both`

## Métricas Globales

| Métrica | Valor |
|---|---|
| **Casos** | 51 |
| **Ejecuciones** (caso × modo thinking) | 59 |
| **Aprobadas (PASS)** | 53 (89.8%) |
| **Falladas (FAIL)** | 6 |
| **Errores de ejecución** | 0 |
| **Latencia Promedio** (sin errores) | 7092 ms |
| **Finish Reasons** | `{"stop":58,"length":1}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 12/14 | 85.7% | 0 | 0 | 5606 ms |
| **REPLAN** | 7/8 | 87.5% | 0 | 1 | 24092 ms |
| **ARGUMENTS** | 19/21 | 90.5% | 0 | 0 | 700 ms |
| **FINAL_RESPONSE** | 15/16 | 93.8% | 0 | 0 | 8283 ms |

## Checks por Etapa

Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.

### PLAN

| Check | Aprobados / Evaluados |
|---|---|
| first_route_matches | 10/11 (90.9%) |
| max_steps_met | 14/14 (100.0%) |
| min_steps_met | 12/13 (92.3%) |
| no_forbidden_keywords | 4/4 (100.0%) |
| not_truncated | 14/14 (100.0%) |
| required_keywords_met | 6/6 (100.0%) |
| required_routes_used | 10/11 (90.9%) |
| routes_allowed | 12/12 (100.0%) |
| valid_json | 14/14 (100.0%) |
| valid_steps_structure | 14/14 (100.0%) |
| has_objective (soft) | 14/14 (100.0%) |

### REPLAN

| Check | Aprobados / Evaluados |
|---|---|
| action_matches_expected | 7/7 (100.0%) |
| max_steps_met | 6/6 (100.0%) |
| min_steps_met | 6/6 (100.0%) |
| not_truncated | 7/8 (87.5%) |
| respects_completed | 4/4 (100.0%) |
| respects_effects | 3/3 (100.0%) |
| routes_allowed | 6/6 (100.0%) |
| valid_action | 7/7 (100.0%) |
| valid_json | 7/7 (100.0%) |
| valid_steps_structure | 6/6 (100.0%) |
| abort_steps_empty (soft) | 1/1 (100.0%) |
| has_abort_reason (soft) | 1/1 (100.0%) |
| has_objective (soft) | 1/6 (16.7%) |

### ARGUMENTS

| Check | Aprobados / Evaluados |
|---|---|
| field_content_array2d | 1/1 (100.0%) |
| field_content_includes | 2/2 (100.0%) |
| field_content_json | 2/2 (100.0%) |
| field_content_match | 0/1 (0.0%) |
| field_content_sheets | 1/1 (100.0%) |
| field_depth_match | 1/1 (100.0%) |
| field_destination_match | 1/1 (100.0%) |
| field_isUrl_match | 1/1 (100.0%) |
| field_mode_match | 1/1 (100.0%) |
| field_offset_match | 2/2 (100.0%) |
| field_path_match | 11/11 (100.0%) |
| field_paths_match | 1/1 (100.0%) |
| field_pattern_match | 1/1 (100.0%) |
| field_pid_match | 2/2 (100.0%) |
| field_range_match | 1/1 (100.0%) |
| field_searchType_match | 1/1 (100.0%) |
| field_sessionId_match | 1/1 (100.0%) |
| field_sheet_match | 1/1 (100.0%) |
| field_source_match | 1/1 (100.0%) |
| field_url_match | 1/1 (100.0%) |
| field_urls_match | 1/1 (100.0%) |
| no_forbidden_values | 5/6 (83.3%) |
| no_invented_fields | 20/20 (100.0%) |
| not_truncated | 21/21 (100.0%) |
| required_fields_present | 21/21 (100.0%) |
| schema_valid | 21/21 (100.0%) |
| valid_json | 21/21 (100.0%) |
| valid_refs | 1/1 (100.0%) |

### FINAL_RESPONSE

| Check | Aprobados / Evaluados |
|---|---|
| effects_mentioned | 4/4 (100.0%) |
| facts_retained | 15/16 (93.8%) |
| min_chars_met | 16/16 (100.0%) |
| no_hallucinations | 12/12 (100.0%) |
| non_empty | 16/16 (100.0%) |
| not_truncated | 16/16 (100.0%) |

## Comparación Thinking (On vs Off)

### Etapa: FINAL_RESPONSE

| Modo | Aprobadas / Total | Pass Rate | Errores | Latencia Avg | Tokens Out Avg |
|---|---|---|---|---|---|
| Sin thinking | 7/8 | 87.5% | 0 | 1919 ms | 192 |
| Con thinking | 8/8 | 100.0% | 0 | 14648 ms | 1634 |

#### Detalle por caso

- **v3_final_exito_planes_precios:** off=PASS (2150ms) | on=PASS (17475ms)
- **v3_final_exito_con_archivo_creado:** off=PASS (949ms) | on=PASS (13497ms)
- **v3_final_parcial_efectos_y_pendiente:** off=PASS (2378ms) | on=PASS (16431ms)
- **v3_final_abort_requiere_contrasena:** off=PASS (2123ms) | on=PASS (13090ms)
- **v3_final_fuentes_en_conflicto:** off=FAIL (1380ms) | on=PASS (16841ms)
- **v3_final_evidencia_sin_el_dato:** off=PASS (1962ms) | on=PASS (12997ms)
- **v3_final_lista_larga_completa:** off=PASS (2416ms) | on=PASS (10961ms)
- **v3_final_respuesta_parcial_una_de_dos:** off=PASS (1994ms) | on=PASS (15889ms)

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| v3_plan_word_desde_listado | plan | on | FAIL | Rutas requeridas no usadas: terminal |
| v3_plan_solo_web | plan | on | FAIL | Cantidad de pasos (0) menor al mínimo (1). |
| v3_replan_pdf_escaneado_sin_texto | replan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_args_write_xlsx_campo_sin_dato | arguments | off | FAIL | Valores hardcodeados prohibidos encontrados: 2024 |
| v3_args_write_con_referencia | arguments | off | FAIL | Campo 'content': esperado "{{ref:r1}}", recibido "Con fecha: 3/10\nBitcoin cae 2% en la jornada: https://cripto.example/btc - El precio de Bitcoin retrocedió…" |
| v3_final_fuentes_en_conflicto | final_response | off | FAIL | La respuesta final no incluye hechos obligatorios: 1199; 1299 |
