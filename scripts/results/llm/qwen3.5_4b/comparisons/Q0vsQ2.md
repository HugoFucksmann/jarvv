# Comparación de prompts — LLM eval
Generado: 2026-10-28T22:23:57 | Base: **Q0** | Casos: 51 | Filas caso×thinking: 59 (ejecuciones por versión en la tabla 1)

## 1. Corridas
| versión | carpetas | ejecuciones | modelo | contexto | max_tokens |
|---|---|---|---|---|---|
| Q0 | v3_Q0 | 59 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |
| Q2 | v3_Q2_reglas | 59 | qwen3.5:4b | 16384 | {"plan": 4096, "replan": 4096, "arguments": 2048, "final_response": 2048} |

## 2. Resumen general
`macro` promedia la tasa de cada etapa (todas pesan igual); `micro` cuenta todas las ejecuciones.

| versión | macro | micro | pass/total | errores | truncadas | lat mediana | tokens out prom. |
|---|---|---|---|---|---|---|---|
| Q0 (base) | 89.4% | 89.8% | 53/59 | 0 | 1 | 2,317 ms | 737 |
| Q2 | 81.9% (-7.4pp) | 81.4% | 48/59 | 0 | 6 | 2,360 ms | 647 |

**Mejor por macro:** Q0. Por casos que cambian: 'Q0' gana en 7 de 9 casos que cambian (p=0.180); NO concluyente con n=9 (p>=0.05).

## 3. Por etapa
### plan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 12/14 | 85.7% | 0 | 0 | 3,868 ms | 567 | 3437a5b437fe | 0 |
| Q2 | 12/14 | 85.7% | 0 | 0 | 4,675 ms | 535 | b909402f5f0b | 0 |

Mejor: empate entre Q0, Q2 (85.7%)

### replan
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 7/8 | 87.5% | 0 | 1 | 27,738 ms | 2,474 | 407ae162ac16 | 0 |
| Q2 | 7/8 | 87.5% | 0 | 1 | 12,908 ms | 1,523 | ee94a173850c | 0 |

Mejor: empate entre Q0, Q2 (87.5%)

### arguments
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 19/21 | 90.5% | 0 | 0 | 646 ms | 53 | 0d79e5ad14ec | 0 |
| Q2 | 18/21 | 85.7% (-4.8pp) | 0 | 0 | 675 ms | 54 | 03034969821d | 0 |

Mejor: **Q0** (90.5%)

### final_response
| versión | pass/total | tasa | errores | truncadas | lat mediana | tokens out | system hash | prompt a mano |
|---|---|---|---|---|---|---|---|---|
| Q0 (base) | 15/16 | 93.8% | 0 | 0 | 6,688 ms | 913 | 592c0bbf1278 | 0 |
| Q2 | 11/16 | 68.8% (-25.0pp) | 0 | 5 | 9,736 ms | 1,085 | 47d14292e60c | 0 |

Mejor: **Q0** (93.8%)

## 4. Checks por etapa (solo los que no están al 100% en alguna versión)
### plan
| check | Q0 | Q2 |
|---|---|---|
| first_route_matches | 10/11 (90.9%) | 10/11 (90.9%) |
| min_steps_met | 12/13 (92.3%) | 12/13 (92.3%) |
| required_routes_used | 10/11 (90.9%) | 10/11 (90.9%) |

(8 checks al 100% en todas las versiones, omitidos)

### replan
| check | Q0 | Q2 |
|---|---|---|
| has_objective (soft) | 1/6 (16.7%) | 0/7 (0.0%) † |
| not_truncated | 7/8 (87.5%) | 7/8 (87.5%) |

(11 checks al 100% en todas las versiones, omitidos)

### arguments
| check | Q0 | Q2 |
|---|---|---|
| field_content_match | 0/1 (0.0%) | 0/1 (0.0%) |
| field_searchType_match | 1/1 (100.0%) | 0/1 (0.0%) (-100.0pp) |
| no_forbidden_values | 5/6 (83.3%) | 5/6 (83.3%) |

(25 checks al 100% en todas las versiones, omitidos)

### final_response
| check | Q0 | Q2 |
|---|---|---|
| facts_retained | 15/16 (93.8%) | 11/11 (100.0%) † |
| non_empty | 16/16 (100.0%) | 11/16 (68.8%) (-31.2pp) |
| not_truncated | 16/16 (100.0%) | 11/16 (68.8%) (-31.2pp) |

(3 checks al 100% en todas las versiones, omitidos)

(soft) = se registra pero no afecta pass/fail.
† cobertura distinta a la de la base (el check se evaluó en otra fracción de ejecuciones): no se calcula diferencia. Pasa cuando una salida se trunca o viene vacía y el evaluador corta antes de registrar los demás checks, o cuando el check depende de la acción elegida (ej. has_objective en replan).

## 5. Casos
| caso | etapa | thinking | Q0 | Q2 | vs base |
|---|---|---|---|---|---|
| v3_replan_abort_requiere_dato_del_usuario | replan | on | PASS | FAIL | regresa: Q2 |
| v3_replan_pdf_escaneado_sin_texto | replan | on | FAIL | PASS | mejora: Q2 |
| v3_args_start_search_por_contenido | arguments | off | PASS | FAIL | regresa: Q2 |
| v3_final_abort_requiere_contrasena | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_evidencia_sin_el_dato | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_exito_con_archivo_creado | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_exito_planes_precios | final_response | on | PASS | FAIL | regresa: Q2 |
| v3_final_fuentes_en_conflicto | final_response | off | FAIL | PASS | mejora: Q2 |
| v3_final_respuesta_parcial_una_de_dos | final_response | on | PASS | FAIL | regresa: Q2 |

(50 casos con el mismo resultado en todas las versiones, omitidos; usar --all-rows para verlos)

## 6. Cada versión contra la base (Q0)
| versión | mejoras | regresiones | empates | p (signos) | lectura |
|---|---|---|---|---|---|
| Q2 | 2 | 7 | 42 | 0.180 | 'Q0' gana en 7 de 9 casos que cambian (p=0.180); NO concluyente con n=9 (p>=0.05) \| mejora en: v3_final_fuentes_en_conflicto, v3_replan_pdf_escaneado_sin_texto \| regresa en: v3_args_start_search_por_contenido, v3_final_abort_requiere_contrasena, v3_final_evidencia_sin_el_dato, v3_final_exito_con_archivo_creado, v3_final_exito_planes_precios, v3_final_respuesta_parcial_una_de_dos (+1) |

La prueba de signos cuenta casos (no filas): para final_response se unen thinking on y off de cada caso, así que cada caso aporta una sola observación. Con pocos casos casi nunca alcanza significancia. Repetir corridas del mismo prompt (`LABEL=rutaA,rutaB`) aporta más evidencia que agregar casos idénticos.

## 7. Thinking apagado vs encendido
| versión | etapa | pass off | pass on | lat off | lat on | tokens off | tokens on |
|---|---|---|---|---|---|---|---|
| Q0 | final_response | 7/8 (87.5%) | 8/8 (100.0%) | 2,058 ms | 14,693 ms | 192 | 1,634 |
| Q2 | final_response | 8/8 (100.0%) | 3/8 (37.5%) | 1,893 ms | 19,453 ms | 211 | 1,959 |

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

**Q2**: 11 ejecuciones no aprobadas, 17 errores registrados
- (5x) Respuesta final truncada por límite de tokens (finish_reason=length). — casos: v3_final_exito_planes_precios, v3_final_exito_con_archivo_creado, v3_final_abort_requiere_contrasena (+2)
- (5x) Respuesta final vacía (finish_reason=length). — casos: v3_final_exito_planes_precios, v3_final_exito_con_archivo_creado, v3_final_abort_requiere_contrasena (+2)
- (1x) Rutas requeridas no usadas: terminal — casos: v3_plan_word_desde_listado
- (1x) Cantidad de pasos (0) menor al mínimo (1). — casos: v3_plan_solo_web
- (1x) El primer paso debe usar 'web', pero usa 'ninguno'. — casos: v3_plan_solo_web
- (1x) Salida truncada por límite de tokens (finish_reason=length); content vacío. Producción descarta toda salida truncada. — casos: v3_replan_abort_requiere_dato_del_usuario
- (1x) Valores hardcodeados prohibidos encontrados: 2024 — casos: v3_args_write_xlsx_campo_sin_dato
- (1x) Campo 'content': esperado "{{ref:r1}}", recibido "Con fecha: 3/10\nBitcoin cae 2% en la jornada: https://cripto.example/btc - El precio de Bitcoin retrocedió…" — casos: v3_args_write_con_referencia
- (1x) Campo 'searchType': esperado "content", recibido "files" — casos: v3_args_start_search_por_contenido
