# Comparación de prompts — LLM eval
Generado: 2026-10-28T20:36:05 | Base: **Q0** | Casos: 7 | Filas caso×thinking: 8 (ejecuciones por versión en la tabla 1)

## 1. Corridas
| versión | carpetas | ejecuciones | modelo | contexto | max_tokens |
|---|---|---|---|---|---|
| Q0 | v1_Q0 | 8 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |
| Q2 | v1_Q2 | 8 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |

## 2. Resumen general
`macro` promedia la tasa de cada etapa (todas pesan igual); `micro` cuenta todas las ejecuciones.

| versión | macro | micro | pass/total | errores | truncadas | lat mediana | tokens out prom. |
|---|---|---|---|---|---|---|---|
| Q2 | 70.8% (+4.2pp) | 62.5% | 5/8 | 0 | 0 | 2,893 ms | 473 |
| Q0 (base) | 66.7% | 62.5% | 5/8 | 0 | 1 | 3,410 ms | 798 |

**Mejor por macro:** Q2. Por casos que cambian: empate (1 mejoras, 1 regresiones).

## 3. Por etapa
### plan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 1/2 | 50.0% | 0 | 0 | 4,301 ms | 352 | 3437a5b437fe | 0 |
| Q2 | 1/2 | 50.0% | 0 | 0 | 3,335 ms | 383 | 294f4e20da13 | 0 |

Mejor: empate entre Q0, Q2 (50.0%)

### replan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 1/1 | 100.0% | 0 | 0 | 22,655 ms | 2,758 | 407ae162ac16 | 0 |
| Q2 | 1/1 | 100.0% | 0 | 0 | 4,674 ms | 555 | e111636f2f9c | 0 |

Mejor: empate entre Q0, Q2 (100.0%)

### arguments
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 2/3 | 66.7% | 0 | 0 | 1,627 ms | 101 | 0d79e5ad14ec | 0 |
| Q2 | 1/3 | 33.3% (-33.3pp) | 0 | 0 | 1,701 ms | 104 | 43f13812f305 | 0 |

Mejor: **Q0** (66.7%)

### final_response
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 1/2 | 50.0% | 0 | 1 | 10,861 ms | 1,312 | 592c0bbf1278 | 0 |
| Q2 | 2/2 | 100.0% (+50.0pp) | 0 | 0 | 9,146 ms | 1,076 | 7585c77d0710 | 0 |

Mejor: **Q2** (100.0%)

## 4. Checks por etapa (solo los que no están al 100% en alguna versión)
### plan
| check | Q0 | Q2 |
|---|---|---|
| first_route_matches | 0/1 (0.0%) | 0/1 (0.0%) |

(10 checks al 100% en todas las versiones, omitidos)

### replan
| check | Q0 | Q2 |
|---|---|---|
| has_objective (soft) | 1/1 (100.0%) | 0/1 (0.0%) (-100.0pp) |

(10 checks al 100% en todas las versiones, omitidos)

### arguments
| check | Q0 | Q2 |
|---|---|---|
| field_content_json | 0/1 (0.0%) | 0/1 (0.0%) |
| no_forbidden_values | 2/2 (100.0%) | 0/2 (0.0%) (-100.0pp) |

(5 checks al 100% en todas las versiones, omitidos)

### final_response
| check | Q0 | Q2 |
|---|---|---|
| non_empty | 1/2 (50.0%) | 2/2 (100.0%) (+50.0pp) |
| not_truncated | 1/2 (50.0%) | 2/2 (100.0%) (+50.0pp) |

(3 checks al 100% en todas las versiones, omitidos)

(soft) = se registra pero no afecta pass/fail.

## 5. Casos
| caso | etapa | thinking | Q0 | Q2 | vs base |
|---|---|---|---|---|---|
| args_start_process_script_excel | arguments | off | PASS | FAIL | regresa: Q2 |
| final_abort_excel_no_creado | final_response | on | FAIL | PASS | mejora: Q2 |

(6 casos con el mismo resultado en todas las versiones, omitidos; usar --all-rows para verlos)

## 6. Cada versión contra la base (Q0)
| versión | mejoras | regresiones | empates | p (signos) | lectura |
|---|---|---|---|---|---|
| Q2 | 1 | 1 | 5 | 1.000 | empate (1 mejoras, 1 regresiones) \| mejora en: final_abort_excel_no_creado \| regresa en: args_start_process_script_excel |

La prueba de signos cuenta casos (no filas): para final_response se unen thinking on y off de cada caso, así que cada caso aporta una sola observación. Con pocos casos casi nunca alcanza significancia. Repetir corridas del mismo prompt (`LABEL=rutaA,rutaB`) aporta más evidencia que agregar casos idénticos.

## 7. Thinking apagado vs encendido
| versión | etapa | pass off | pass on | lat off | lat on | tokens off | tokens on |
|---|---|---|---|---|---|---|---|
| Q0 | final_response | 1/1 (100.0%) | 0/1 (0.0%) | 5,148 ms | 16,574 ms | 575 | 2,048 |
| Q2 | final_response | 1/1 (100.0%) | 1/1 (100.0%) | 3,952 ms | 14,339 ms | 415 | 1,736 |

## 8. Errores (ejecuciones no aprobadas)
Los errores que difieren solo en números (conteos, ids) se agrupan; se muestra un ejemplo real y los casos afectados.

**Q0**: 3 ejecuciones no aprobadas, 4 errores registrados
- (1x) El primer paso debe usar 'web', pero usa 'locate'. — casos: plan_excel_modelos_ia
- (1x) Campo 'content' no es un string JSON válido. — casos: args_write_file_xlsx_2d
- (1x) Respuesta final truncada por límite de tokens (finish_reason=length). — casos: final_abort_excel_no_creado
- (1x) Respuesta final vacía (finish_reason=length). — casos: final_abort_excel_no_creado

**Q2**: 3 ejecuciones no aprobadas, 4 errores registrados
- (2x) Valores hardcodeados prohibidos encontrados: 2026-02-10 — casos: args_write_file_xlsx_2d, args_start_process_script_excel
- (1x) El primer paso debe usar 'web', pero usa 'locate'. — casos: plan_excel_modelos_ia
- (1x) Campo 'content' no es un string JSON válido. — casos: args_write_file_xlsx_2d
