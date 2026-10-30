# Resumen de Evaluación — LLM

- **Modelo:** `turintech/minicpm5-2b-artemis:q4_k_s`
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
| **Aprobadas (PASS)** | 37 (62.7%) |
| **Falladas (FAIL)** | 22 |
| **Errores de ejecución** | 0 |
| **Latencia Promedio** (sin errores) | 5826 ms |
| **Finish Reasons** | `{"stop":53,"length":6}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 7/14 | 50.0% | 0 | 5 | 16413 ms |
| **REPLAN** | 4/8 | 50.0% | 0 | 1 | 9361 ms |
| **ARGUMENTS** | 13/21 | 61.9% | 0 | 0 | 277 ms |
| **FINAL_RESPONSE** | 13/16 | 81.3% | 0 | 0 | 2077 ms |

## Checks por Etapa

Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.

### PLAN

| Check | Aprobados / Evaluados |
|---|---|
| first_route_matches | 5/6 (83.3%) |
| max_steps_met | 9/9 (100.0%) |
| min_steps_met | 8/8 (100.0%) |
| no_forbidden_keywords | 3/3 (100.0%) |
| not_truncated | 9/14 (64.3%) |
| required_keywords_met | 3/4 (75.0%) |
| required_routes_used | 5/6 (83.3%) |
| routes_allowed | 6/7 (85.7%) |
| valid_json | 9/9 (100.0%) |
| valid_steps_structure | 9/9 (100.0%) |
| has_objective (soft) | 9/9 (100.0%) |

### REPLAN

| Check | Aprobados / Evaluados |
|---|---|
| action_matches_expected | 4/7 (57.1%) |
| max_steps_met | 3/3 (100.0%) |
| min_steps_met | 3/3 (100.0%) |
| not_truncated | 7/8 (87.5%) |
| respects_completed | 3/3 (100.0%) |
| respects_effects | 2/2 (100.0%) |
| routes_allowed | 3/3 (100.0%) |
| valid_action | 7/7 (100.0%) |
| valid_json | 7/7 (100.0%) |
| valid_steps_structure | 3/3 (100.0%) |
| abort_steps_empty (soft) | 4/4 (100.0%) |
| has_abort_reason (soft) | 4/4 (100.0%) |
| has_objective (soft) | 0/3 (0.0%) |

### ARGUMENTS

| Check | Aprobados / Evaluados |
|---|---|
| field_content_array2d | 1/1 (100.0%) |
| field_content_includes | 1/1 (100.0%) |
| field_content_json | 1/2 (50.0%) |
| field_content_match | 0/1 (0.0%) |
| field_depth_match | 0/1 (0.0%) |
| field_destination_match | 1/1 (100.0%) |
| field_isUrl_match | 1/1 (100.0%) |
| field_mode_match | 0/1 (0.0%) |
| field_offset_match | 2/2 (100.0%) |
| field_path_match | 7/11 (63.6%) |
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
| no_invented_fields | 19/20 (95.0%) |
| not_truncated | 21/21 (100.0%) |
| required_fields_present | 20/21 (95.2%) |
| schema_valid | 20/21 (95.2%) |
| valid_json | 21/21 (100.0%) |
| valid_refs | 1/1 (100.0%) |

### FINAL_RESPONSE

| Check | Aprobados / Evaluados |
|---|---|
| effects_mentioned | 4/4 (100.0%) |
| facts_retained | 13/16 (81.3%) |
| min_chars_met | 16/16 (100.0%) |
| no_hallucinations | 12/12 (100.0%) |
| non_empty | 16/16 (100.0%) |
| not_truncated | 16/16 (100.0%) |

## Comparación Thinking (On vs Off)

### Etapa: FINAL_RESPONSE

| Modo | Aprobadas / Total | Pass Rate | Errores | Latencia Avg | Tokens Out Avg |
|---|---|---|---|---|---|
| Sin thinking | 6/8 | 75.0% | 0 | 895 ms | 152 |
| Con thinking | 7/8 | 87.5% | 0 | 3260 ms | 598 |

#### Detalle por caso

- **v3_final_exito_planes_precios:** off=PASS (1442ms) | on=PASS (3285ms)
- **v3_final_exito_con_archivo_creado:** off=PASS (419ms) | on=PASS (3033ms)
- **v3_final_parcial_efectos_y_pendiente:** off=PASS (1161ms) | on=PASS (8240ms)
- **v3_final_abort_requiere_contrasena:** off=PASS (1043ms) | on=PASS (2470ms)
- **v3_final_fuentes_en_conflicto:** off=PASS (558ms) | on=PASS (2102ms)
- **v3_final_evidencia_sin_el_dato:** off=FAIL (762ms) | on=FAIL (2900ms)
- **v3_final_lista_larga_completa:** off=PASS (1032ms) | on=PASS (1760ms)
- **v3_final_respuesta_parcial_una_de_dos:** off=FAIL (740ms) | on=PASS (2291ms)

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| v3_plan_pdf_a_resumen_txt | plan | on | FAIL | Faltan palabras clave requeridas en los pasos del plan: txt |
| v3_plan_word_desde_listado | plan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_plan_localizar_calcular_guardar | plan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_plan_nombre_de_tool_en_pedido | plan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_plan_borrado_listar_antes | plan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_plan_buscar_texto_en_archivos | plan | on | FAIL | Pasos con rutas no permitidas: s1:terminal, s2:terminal |
| v3_plan_objetivo_en_ingles | plan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_replan_busqueda_irrelevante | replan | on | FAIL | Se esperaba acción 'continue', pero el modelo eligió 'abort'. |
| v3_replan_error_transitorio_no_abortar | replan | on | FAIL | Se esperaba acción 'continue', pero el modelo eligió 'abort'. |
| v3_replan_pdf_escaneado_sin_texto | replan | on | FAIL | Se esperaba acción 'continue', pero el modelo eligió 'abort'. |
| v3_replan_conflicto_destino_con_plan_restante | replan | on | FAIL | Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. |
| v3_args_write_xlsx_dos_hojas | arguments | off | FAIL | Campo 'path': esperado "C:\\Users\\eval\\Documents\\laptops.xlsx", recibido "C:/Users/eval/Documents/laptops.xlsx" |
| v3_args_write_xlsx_campo_sin_dato | arguments | off | FAIL | Campo 'path': esperado "C:\\Users\\eval\\Desktop\\precios.xlsx", recibido "C:/Users/eval/Desktop/prices.xlsx" |
| v3_args_write_con_referencia | arguments | off | FAIL | Campo 'content': esperado "{{ref:r1}}", recibido "Con fecha: 3/10\nBitcoin cae 2% en la jornada: https://cripto.example/btc - El precio de Bitcoin retrocedió…" |
| v3_args_list_directory_profundidad | arguments | off | FAIL | Campo 'path': esperado "C:\\Users\\eval\\Downloads", recibido "C:/Users/eval/Downloads" |
| v3_args_start_search_por_contenido | arguments | off | FAIL | Campo 'path': esperado "C:\\Users\\eval\\Documents", recibido "C:/Users/eval/Documents" |
| v3_args_start_process_zip_con_espacios | arguments | off | FAIL | Violación de schema: faltan campos requeridos: command; command: se esperaba string y se recibió null |
| v3_args_write_append_nota | arguments | off | FAIL | Campo 'mode': esperado "append", recibido "rewrite" |
| v3_args_read_file_xlsx_hoja_y_rango | arguments | off | FAIL | Campos inventados fuera del schema: method |
| v3_final_evidencia_sin_el_dato | final_response | off | FAIL | La respuesta final no incluye hechos obligatorios: encontr |
| v3_final_evidencia_sin_el_dato | final_response | on | FAIL | La respuesta final no incluye hechos obligatorios: encontr |
| v3_final_respuesta_parcial_una_de_dos | final_response | off | FAIL | La respuesta final no incluye hechos obligatorios: 24.12.0 |
