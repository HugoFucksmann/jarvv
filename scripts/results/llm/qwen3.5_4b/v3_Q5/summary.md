# Resumen de Evaluación — LLM

- **Modelo:** `qwen3.5:4b`
- **Dataset:** `v3` (cases_v3.ts)
- **Prompts:** `Q5 (Q5.ts)`
- **Filtro de Etapa:** `arguments`
- **Endpoint:** `http://127.0.0.1:11434/v1/chat/completions`
- **Contexto:** `16384` tokens
- **Timeouts:** `120000ms` (sin thinking) / `180000ms` (thinking)
- **Max tokens:** `plan=4096, replan=4096, arguments=2048, final_response=2048`
- **Final thinking:** `both`

## Métricas Globales

| Métrica | Valor |
|---|---|
| **Casos** | 21 |
| **Ejecuciones** (caso × modo thinking) | 21 |
| **Aprobadas (PASS)** | 20 (95.2%) |
| **Falladas (FAIL)** | 1 |
| **Errores de ejecución** | 0 |
| **Latencia Promedio** (sin errores) | 569 ms |
| **Finish Reasons** | `{"stop":21}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **ARGUMENTS** | 20/21 | 95.2% | 0 | 0 | 569 ms |

## Checks por Etapa

Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.

### ARGUMENTS

| Check | Aprobados / Evaluados |
|---|---|
| field_content_array2d | 1/1 (100.0%) |
| field_content_includes | 1/1 (100.0%) |
| field_content_json | 1/2 (50.0%) |
| field_content_match | 1/1 (100.0%) |
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
| no_forbidden_values | 6/6 (100.0%) |
| no_invented_fields | 20/20 (100.0%) |
| not_truncated | 21/21 (100.0%) |
| required_fields_present | 21/21 (100.0%) |
| schema_valid | 21/21 (100.0%) |
| valid_json | 21/21 (100.0%) |
| valid_refs | 1/1 (100.0%) |

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| v3_args_write_xlsx_dos_hojas | arguments | off | FAIL | Campo 'content' no es un string JSON válido. |
