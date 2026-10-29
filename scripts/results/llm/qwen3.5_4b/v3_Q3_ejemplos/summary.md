# Resumen de Evaluación — LLM

- **Modelo:** `qwen3.5:4b`
- **Dataset:** `v3` (cases_v3.ts)
- **Prompts:** `Q3_ejemplos (Q3_ejemplos.ts)`
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
| **Aprobadas (PASS)** | 49 (83.1%) |
| **Falladas (FAIL)** | 10 |
| **Errores de ejecución** | 0 |
| **Latencia Promedio** (sin errores) | 3997 ms |
| **Finish Reasons** | `{"stop":56,"length":3}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 12/14 | 85.7% | 0 | 0 | 3657 ms |
| **REPLAN** | 6/8 | 75.0% | 0 | 0 | 3869 ms |
| **ARGUMENTS** | 18/21 | 85.7% | 0 | 0 | 507 ms |
| **FINAL_RESPONSE** | 13/16 | 81.3% | 0 | 3 | 8939 ms |

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
| required_routes_used | 11/11 (100.0%) |
| routes_allowed | 12/12 (100.0%) |
| valid_json | 14/14 (100.0%) |
| valid_steps_structure | 14/14 (100.0%) |
| has_objective (soft) | 14/14 (100.0%) |

### REPLAN

| Check | Aprobados / Evaluados |
|---|---|
| action_matches_expected | 7/8 (87.5%) |
| max_steps_met | 7/7 (100.0%) |
| min_steps_met | 7/7 (100.0%) |
| not_truncated | 8/8 (100.0%) |
| respects_completed | 5/5 (100.0%) |
| respects_effects | 3/3 (100.0%) |
| routes_allowed | 6/7 (85.7%) |
| valid_action | 8/8 (100.0%) |
| valid_json | 8/8 (100.0%) |
| valid_steps_structure | 8/8 (100.0%) |
| has_objective (soft) | 1/8 (12.5%) |

### ARGUMENTS

| Check | Aprobados / Evaluados |
|---|---|
| field_content_array2d | 1/1 (100.0%) |
| field_content_includes | 2/2 (100.0%) |
| field_content_json | 2/2 (100.0%) |
| field_content_match | 1/1 (100.0%) |
| field_content_sheets | 1/1 (100.0%) |
| field_depth_match | 1/1 (100.0%) |
| field_destination_match | 1/1 (100.0%) |
| field_isUrl_match | 0/1 (0.0%) |
| field_mode_match | 0/1 (0.0%) |
| field_offset_match | 2/2 (100.0%) |
| field_path_match | 11/11 (100.0%) |
| field_paths_match | 1/1 (100.0%) |
| field_pattern_match | 1/1 (100.0%) |
| field_pid_match | 2/2 (100.0%) |
| field_range_match | 1/1 (100.0%) |
| field_searchType_match | 0/1 (0.0%) |
| field_sessionId_match | 1/1 (100.0%) |
| field_sheet_match | 1/1 (100.0%) |
| field_source_match | 1/1 (100.0%) |
| field_url_match | 1/1 (100.0%) |
| field_urls_match | 1/1 (100.0%) |
| no_forbidden_values | 6/6 (100.0%) |
| no_invented_fields | 20/20 (100.0%) |
| not_truncated | 21/21 (100.0%) |
| required_fields_present | 21/21 (100.0%) |
| schema_valid | 21/21 (100.0%) |
| valid_json | 21/21 (100.0%) |
| valid_refs | 1/1 (100.0%) |

### FINAL_RESPONSE

| Check | Aprobados / Evaluados |
|---|---|
| effects_mentioned | 3/3 (100.0%) |
| facts_retained | 13/13 (100.0%) |
| min_chars_met | 13/13 (100.0%) |
| no_hallucinations | 10/10 (100.0%) |
| non_empty | 13/16 (81.3%) |
| not_truncated | 13/16 (81.3%) |

## Comparación Thinking (On vs Off)

### Etapa: FINAL_RESPONSE

| Modo | Aprobadas / Total | Pass Rate | Errores | Latencia Avg | Tokens Out Avg |
|---|---|---|---|---|---|
| Sin thinking | 8/8 | 100.0% | 0 | 1603 ms | 144 |
| Con thinking | 5/8 | 62.5% | 0 | 16275 ms | 1700 |

#### Detalle por caso

- **v3_final_exito_planes_precios:** off=PASS (1375ms) | on=PASS (15090ms)
- **v3_final_exito_con_archivo_creado:** off=PASS (775ms) | on=PASS (12781ms)
- **v3_final_parcial_efectos_y_pendiente:** off=PASS (1634ms) | on=FAIL (19624ms)
- **v3_final_abort_requiere_contrasena:** off=PASS (1027ms) | on=FAIL (19538ms)
- **v3_final_fuentes_en_conflicto:** off=PASS (1382ms) | on=FAIL (19714ms)
- **v3_final_evidencia_sin_el_dato:** off=PASS (2432ms) | on=PASS (16836ms)
- **v3_final_lista_larga_completa:** off=PASS (2226ms) | on=PASS (15293ms)
- **v3_final_respuesta_parcial_una_de_dos:** off=PASS (1971ms) | on=PASS (11324ms)

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| v3_plan_followup_resolver_contexto | plan | on | FAIL | Cantidad de pasos (1) menor al mínimo (2). |
| v3_plan_buscar_texto_en_archivos | plan | on | FAIL | El primer paso debe usar 'locate', pero usa 'files'. |
| v3_replan_busqueda_irrelevante | replan | on | FAIL | Pasos con rutas no permitidas de replan: s1:terminal |
| v3_replan_abort_requiere_dato_del_usuario | replan | on | FAIL | Se esperaba acción 'abort', pero el modelo eligió 'continue'. |
| v3_args_start_search_por_contenido | arguments | off | FAIL | Campo 'searchType': esperado "content", recibido undefined |
| v3_args_write_append_nota | arguments | off | FAIL | Campo 'mode': esperado "append", recibido undefined |
| v3_args_read_file_url_remota | arguments | off | FAIL | Campo 'isUrl': esperado true, recibido undefined |
| v3_final_parcial_efectos_y_pendiente | final_response | on | FAIL | Respuesta final truncada por límite de tokens (finish_reason=length). |
| v3_final_abort_requiere_contrasena | final_response | on | FAIL | Respuesta final truncada por límite de tokens (finish_reason=length). |
| v3_final_fuentes_en_conflicto | final_response | on | FAIL | Respuesta final truncada por límite de tokens (finish_reason=length). |
