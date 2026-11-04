# Resumen de Evaluación — LLM

- **Modelo:** `qwen2.5:7b`
- **Dataset:** `v1` (cases_v1.ts)
- **Prompts:** `Q0 (producción: src/core/reasoner/prompts.ts)`
- **Filtro de Etapa:** `plan`
- **Endpoint:** `http://127.0.0.1:11434/v1/chat/completions`
- **Contexto:** `16384` tokens
- **Timeouts:** `120000ms` (sin thinking) / `180000ms` (thinking)
- **Max tokens:** `plan=4096, replan=4096, arguments=2048, final_response=2048`
- **Final thinking:** `both`

## Métricas Globales

| Métrica | Valor |
|---|---|
| **Casos** | 2 |
| **Ejecuciones** (caso × modo thinking) | 2 |
| **Aprobadas (PASS)** | 0 (0.0%) |
| **Falladas (FAIL)** | 0 |
| **Errores de ejecución** | 2 |
| **Latencia Promedio** (sin errores) | 0 ms |
| **Finish Reasons** | `{}` |

## Desglose por Etapa

| Etapa | Aprobadas / Total | Pass Rate | Errores | Truncadas | Latencia Promedio |
|---|---|---|---|---|---|
| **PLAN** | 0/2 | 0.0% | 2 | 0 | 0 ms |

## Checks por Etapa

Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.

### PLAN

Sin checks evaluados (todas las ejecuciones fallaron por excepción).

## Ejecuciones no aprobadas

| Caso | Etapa | Thinking | Estado | Primer error |
|---|---|---|---|---|
| plan_excel_modelos_ia | plan | on | ERROR | [LlmEval TransportError] fetch failed (connect EACCES 127.0.0.1:11434) (duración: 1028ms) |
| plan_sin_herramientas | plan | on | ERROR | [LlmEval TransportError] fetch failed (connect EACCES 127.0.0.1:11434) (duración: 1011ms) |
