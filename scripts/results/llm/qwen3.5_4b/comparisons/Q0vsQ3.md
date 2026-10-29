# Comparación de prompts — LLM eval
Generado: 2026-10-28T22:24:26 | Base: **Q0** | Casos: 51 | Filas caso×thinking: 59 (ejecuciones por versión en la tabla 1)

## 1. Corridas
| versión | carpetas | ejecuciones | modelo | contexto | max_tokens |
|---|---|---|---|---|---|
| Q0 | v3_Q0 | 59 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |
| Q2 | v3_Q3_ejemplos | 59 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |

## 2. Resumen general
`macro` promedia la tasa de cada etapa (todas pesan igual); `micro` cuenta todas las ejecuciones.

| versión | macro | micro | pass/total | errores | truncadas | lat mediana | tokens out prom. |
|---|---|---|---|---|---|---|---|
| Q0 (base) | 89.4% | 89.8% | 53/59 | 0 | 1 | 2,317 ms | 737 |
| Q2 | 81.9% (-7.4pp) | 83.1% | 49/59 | 0 | 3 | 2,009 ms | 396 |

**Mejor por macro:** Q0. Por casos que cambian: 'Q0' gana en 9 de 14 casos que cambian (p=0.424); NO concluyente con n=14 (p>=0.05).

## 3. Por etapa
### plan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 12/14 | 85.7% | 0 | 0 | 3,868 ms | 567 | 3437a5b437fe | 0 |
| Q2 | 12/14 | 85.7% | 0 | 0 | 3,482 ms | 347 | b65f977f0ebd | 0 |

Mejor: empate entre Q0, Q2 (85.7%)

### replan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 7/8 | 87.5% | 0 | 1 | 27,738 ms | 2,474 | 407ae162ac16 | 0 |
| Q2 | 6/8 | 75.0% (-12.5pp) | 0 | 0 | 3,856 ms | 383 | 1d64d8df1697 | 0 |

Mejor: **Q0** (87.5%)

### arguments
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 19/21 | 90.5% | 0 | 0 | 646 ms | 53 | 0d79e5ad14ec | 0 |
| Q2 | 18/21 | 85.7% (-4.8pp) | 0 | 0 | 435 ms | 32 | 452106327cc0 | 0 |

Mejor: **Q0** (90.5%)

### final_response
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 15/16 | 93.8% | 0 | 0 | 6,688 ms | 913 | 592c0bbf1278 | 0 |
| Q2 | 13/16 | 81.2% (-12.5pp) | 0 | 3 | 6,878 ms | 922 | 918a9ad93820 | 0 |

Mejor: **Q0** (93.8%)

## 4. Checks por etapa (solo los que no están al 100% en alguna versión)
### plan
| check | Q0 | Q2 |
|---|---|---|
| first_route_matches | 10/11 (90.9%) | 10/11 (90.9%) |
| min_steps_met | 12/13 (92.3%) | 12/13 (92.3%) |
| required_routes_used | 10/11 (90.9%) | 11/11 (100.0%) (+9.1pp) |

(8 checks al 100% en todas las versiones, omitidos)

### replan
| check | Q0 | Q2 |
|---|---|---|
| action_matches_expected | 7/7 (100.0%) | 7/8 (87.5%) † |
| has_objective (soft) | 1/6 (16.7%) | 1/8 (12.5%) † |
| not_truncated | 7/8 (87.5%) | 8/8 (100.0%) (+12.5pp) |
| routes_allowed | 6/6 (100.0%) | 6/7 (85.7%) † |

(9 checks al 100% en todas las versiones, omitidos)

### arguments
| check | Q0 | Q2 |
|---|---|---|
| field_content_match | 0/1 (0.0%) | 1/1 (100.0%) (+100.0pp) |
| field_isUrl_match | 1/1 (100.0%) | 0/1 (0.0%) (-100.0pp) |
| field_mode_match | 1/1 (100.0%) | 0/1 (0.0%) (-100.0pp) |
| field_searchType_match | 1/1 (100.0%) | 0/1 (0.0%) (-100.0pp) |
| no_forbidden_values | 5/6 (83.3%) | 6/6 (100.0%) (+16.7pp) |

(23 checks al 100% en todas las versiones, omitidos)

### final_response
| check | Q0 | Q2 |
|---|---|---|
| facts_retained | 15/16 (93.8%) | 13/13 (100.0%) † |
| non_empty | 16/16 (100.0%) | 13/16 (81.2%) (-18.8pp) |
| not_truncated | 16/16 (100.0%) | 13/16 (81.2%) (-18.8pp) |

(3 checks al 100% en todas las versiones, omitidos)

(soft) = se registra pero no afecta pass/fail.
† cobertura distinta a la de la base (el check se evaluó en otra fracción de ejecuciones): no se calcula diferencia. Pasa cuando una salida se trunca o viene vacía y el evaluador corta antes de registrar los demás checks, o cuando el check depende de la acción elegida (ej. has_objective en replan).

## 5. Casos
| caso | etapa | thinking | Q0 | Q2 | vs base |
|---|---|---|---|---|---|
| v3_plan_buscar_texto_en_archivos | plan | on | PASS | FAIL | regresa: Q2 |
| v3_plan_followup_resolver_contexto | plan | on | PASS | FAIL | regresa: Q2 |
| v3_plan_solo_web | plan | on | FAIL | PASS | mejora: Q2 |
| v3_plan_word_desde_listado | plan | on | FAIL | PASS | mejora: Q2 |
| v3_replan_abort_requiere_dato_del_usuario | replan | on | PASS | FAIL | regresa: Q2 |
| v3_replan_busqueda_irrelevante | replan | on | PASS | FAIL | regresa: Q2 |
| v3_replan_pdf_escaneado_sin_texto | replan | on | FAIL | PASS | mejora: Q2 |
| v3_args_read_file_url_remota | arguments | off | PASS | FAIL | regresa: Q2 |
| v3_args_start_search_por_contenido | arguments | off | PASS | FAIL | regresa: Q2 |
| v3_args_write_append_nota | arguments | off | PASS | FAIL | regresa: Q2 |
| v3_args_write_con_referencia | arguments | off | FAIL | PASS | mejora: Q2 |
| v3_args_write_xlsx_campo_sin_dato | arguments | off | FAIL | PASS | mejora: Q2 |
| v3_final_abort_requiere_contrasena | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_fuentes_en_conflicto | final_response | off | FAIL | PASS | mejora: Q2 |
| v3_final_fuentes_en_conflicto | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_parcial_efectos_y_pendiente | final_response | on | PASS | FAIL | regresa: Q2 |

(43 casos con el mismo resultado en todas las versiones, omitidos; usar --all-rows para verlos)

## 6. Cada versión contra la base (Q0)
| versión | mejoras | regresiones | empates | p (signos) | lectura |
|---|---|---|---|---|---|
| Q2 | 5 | 9 | 37 | 0.424 | 'Q0' gana en 9 de 14 casos que cambian (p=0.424); NO concluyente con n=14 (p>=0.05) \| mejora en: v3_args_write_con_referencia, v3_args_write_xlsx_campo_sin_dato, v3_plan_solo_web, v3_plan_word_desde_listado, v3_replan_pdf_escaneado_sin_texto \| regresa en: v3_args_read_file_url_remota, v3_args_start_search_por_contenido, v3_args_write_append_nota, v3_final_abort_requiere_contrasena, v3_final_parcial_efectos_y_pendiente, v3_plan_buscar_texto_en_archivos (+3) |

La prueba de signos cuenta casos (no filas): para final_response se unen thinking on y off de cada caso, así que cada caso aporta una sola observación. Con pocos casos casi nunca alcanza significancia. Repetir corridas del mismo prompt (`LABEL=rutaA,rutaB`) aporta más evidencia que agregar casos idénticos.

## 7. Thinking apagado vs encendido
| versión | etapa | pass off | pass on | lat off | lat on | tokens off | tokens on |
|---|---|---|---|---|---|---|---|
| Q0 | final_response | 7/8 (87.5%) | 8/8 (100.0%) | 2,058 ms | 14,693 ms | 192 | 1,634 |
| Q2 | final_response | 8/8 (100.0%) | 5/8 (62.5%) | 1,508 ms | 16,064 ms | 144 | 1,700 |

## 8. Errores (ejecuciones no aprobadas)
Los errores que difieren solo en números (conteos, ids) se agrupan; se muestra un ejemplo real y los casos afectados.

**Q0**: 6 ejecuciones no aprobadas, 7 errores registrados
- (1x) Rutas requeridas no usadas: terminal — casos: v3_plan_word_desde_listado
- (1x) Cantidad de pasos (0) menor al mínimo (1). — casos: v3_plan_solo_web
- (1x) El primer paso debe usar 'web', pero usa 'ninguno'. — casos: v3_plan_solo_web
- (1x) Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. — casos: v3_replan_pdf_escaneado_sin_texto
- (1x) Valores hardcodeados prohibidos encontrados: 2024 — casos: v3_args_write_xlsx_campo_sin_dato
- (1x) Campo 'content': esperado "{{ref:r1}}", recibido "Con fecha: 3/10\nBitcoin cae 2% en la jornada: https://cripto.example/btc - El precio de Bitcoin retrocedió…" — casos: v3_args_write_con_referencia
- (1x) La respuesta final no incluye hechos obligatorios: 1199; 1299 — casos: v3_final_fuentes_en_conflicto

**Q2**: 10 ejecuciones no aprobadas, 13 errores registrados
- (3x) Respuesta final truncada por límite de tokens (finish_reason=length). — casos: v3_final_parcial_efectos_y_pendiente, v3_final_abort_requiere_contrasena, v3_final_fuentes_en_conflicto
- (3x) Respuesta final vacía (finish_reason=length). — casos: v3_final_parcial_efectos_y_pendiente, v3_final_abort_requiere_contrasena, v3_final_fuentes_en_conflicto
- (1x) Cantidad de pasos (1) menor al mínimo (2). — casos: v3_plan_followup_resolver_contexto
- (1x) El primer paso debe usar 'locate', pero usa 'files'. — casos: v3_plan_buscar_texto_en_archivos
- (1x) Pasos con rutas no permitidas de replan: s1:terminal — casos: v3_replan_busqueda_irrelevante
- (1x) Se esperaba acción 'abort', pero el modelo eligió 'continue'. — casos: v3_replan_abort_requiere_dato_del_usuario
- (1x) Campo 'searchType': esperado "content", recibido undefined — casos: v3_args_start_search_por_contenido
- (1x) Campo 'mode': esperado "append", recibido undefined — casos: v3_args_write_append_nota
- (1x) Campo 'isUrl': esperado true, recibido undefined — casos: v3_args_read_file_url_remota
