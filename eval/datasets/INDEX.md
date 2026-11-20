# Índice de Datasets del Eval (`eval/datasets/`)

> Inventario completo y verificado contra `npx tsx eval/cli.ts --client=oracle` y `npx tsx eval/cli.ts --list`.
> **Totales en `eval/datasets/`:** **91 archivos `.jsonl`** · **2 464 casos** (**2 351 canónicos** + **113 adversariales con `isRaw: true`**) cubriendo las **14 etapas** del eval (incluye `smoke.jsonl` y los conjuntos `_dev`/`_dev2`/`_holdout`/`_holdout2` incorporados el 2026-11-19).

---

## Resumen por etapa

| Etapa | Tipo | Datasets | Total casos | Canónicos | `isRaw` | Notas |
|---|---|---:|---:|---:|---:|---|
| `d0` | Decisión | 7 | 375 | 347 | 28 | Primera consulta reactiva (`chat` / `single` / `multi`), incluye `d0_real_usuario_*` |
| `route` | Decisión | 12 | 409 | 390 | 19 | Decisión 1 (`files` / `locate` / `terminal` / `web`), incluye `route_pasos_reales_*` |
| `tool_choice` | Decisión | 8 | 172 | 161 | 11 | Decisión 2 (herramienta dentro de la ruta), incluye `tool_choice_terminal_locate_*` |
| `args_review` | Decisión | 6 | 97 | 93 | 4 | Decisión 3 (`approved` / `args_invalid` / `info_missing`) |
| `result_verification` | Decisión | 14 | 398 | 380 | 18 | Decisión 4 (`ok` y `cumple`), incluye `verify_pasos_reales_*` |
| `fragment_judge` | Decisión | 4 | 42 | 42 | 0 | Juez de fragmentos web (`web_search`) |
| `d5` | Decisión | 2 | 51 | 47 | 4 | Decisión 5 (cierre de tarea reactiva) |
| `recovery` | Decisión | 7 | 247 | 240 | 7 | Qué hacer tras un paso fallido (`close` / `rewrite_item` / `replan`). En el motor corre en modo sombra |
| `continuation` | Decisión | 4 | 167 | 157 | 10 | Hilo de conversación (`follow`), conjuntos `_dev`/`_dev2`/`_holdout`/`_holdout2` |
| `plan` | Generativa | 3 | 48 | 48 | 0 | Planificación y replanning deliberativo |
| `arguments` | Generativa | 8 | 163 | 159 | 4 | Generación JSON de argumentos (incluye `recalled`) |
| `final` | Generativa | 6 | 82 | 78 | 4 | Respuesta final (incluye `recalled` y tamaños) |
| `question` | Generativa | 4 | 90 | 90 | 0 | Pregunta al usuario ante `info_missing` |
| `pending` | Generativa | 5 | 111 | 107 | 4 | Lista de pendientes del motor reactivo |
| *Multietapa* (`smoke`) | Mixto | 1 | 12 | 12 | 0 | 1 caso por etapa (`route`..`d5`, `recovery` y `continuation`, excepto `fragment_judge` y `d0`) |
| **Total `.jsonl`** | — | **91** | **2 464** | **2 351** | **113** | — |

---

## Catálogo completo por carpeta

### Raíz (`eval/datasets/`)
| Archivo | Etapa(s) | Total | Canónicos | `isRaw` | Qué cubre |
|---|---|---:|---:|---:|---|
| `eval/datasets/smoke.jsonl` | 12 etapas (`route`, `tool_choice`, `args_review`, `result_verification`, `plan`, `arguments`, `final`, `question`, `pending`, `d5`, `recovery`, `continuation`) | 12 | 12 | 0 | Prueba rápida de humo end-to-end del harness (incluye `smoke-d5`, `smoke-recovery` y `smoke-continuation`). |

### `D0/` (`d0`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/D0/d0_casos_ejemplo.jsonl` | 35 | 35 | 0 | Base inicial T1: charla, acciones simples y pedidos compuestos. |
| `eval/datasets/D0/d0_jarvis_runtime.jsonl` | 18 | 18 | 0 | Pedidos reales estilo Jarvis Windows (rutas, URLs, hechos cambiantes vs conocimiento estable). |
| `eval/datasets/D0/d0_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Ambigüedad `single` vs `multi` con filtros, charla vs búsqueda actual, errores de tipeo e inyección. |
| `eval/datasets/D0/d0_real_usuario_dev.jsonl` / `dev2` | 106 + 109 | 97 + 101 | 9 + 8 | Pedidos `chat`/`single`/`multi` (ajuste): saludos, conocimiento estable, hechos que cambian, enumeraciones y `single` largos. |
| `eval/datasets/D0/d0_real_usuario_holdout.jsonl` / `holdout2` | 45 + 47 | 41 + 44 | 4 + 3 | Holdouts correspondientes a `d0_real_usuario_*`. |

### `route_D1/` (`route`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/route_D1/route_16_cases.jsonl` | 16 | 16 | 0 | Casos base balanceados entre `files`, `locate`, `terminal`, `web`. |
| `eval/datasets/route_D1/route_gemai.jsonl` | 16 | 16 | 0 | Casos adicionales de generalización (rutas mixtas y fallbacks). |
| `eval/datasets/route_D1/route_D1_hard.jsonl` | 38 | 38 | 0 | Casos difíciles de enrutamiento y desempates. |
| `eval/datasets/route_D1/route_context.jsonl` | 12 | 12 | 0 | Señales de contexto actual (URLs, procesos vivos, `not_found` → `locate`, rechazos). *(Ver nota sobre `rt-ctx-10` abajo.)* |
| `eval/datasets/route_D1/route_jarvis_runtime.jsonl` | 18 | 18 | 0 | Casos realistas de runtime Windows en español rioplatense. |
| `eval/datasets/route_D1/route_terminal_explicit.jsonl` | 82 | 82 | 0 | Pedidos con mención explícita de terminal/PowerShell/comando. |
| `eval/datasets/route_D1/route_terminal_goals.jsonl` | 82 | 82 | 0 | Mismos objetivos expresados como metas sin nombrar terminal. |
| `eval/datasets/route_D1/route_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Rutas con espacios y acentos, apps vs `files`, conteos/filtros, `not_found`, typos e inyección `<obs>`. |
| `eval/datasets/route_D1/route_pasos_reales_dev.jsonl` / `dev2` | 48 + 42 | 42 + 38 | 6 + 4 | Pasos (no pedidos) con el pedido original (`web`, `terminal`, `locate`, pasos abstractos y con tipeos). |
| `eval/datasets/route_D1/route_pasos_reales_holdout.jsonl` / `holdout2` | 21 + 19 | 18 + 17 | 3 + 2 | Holdouts correspondientes a `route_pasos_reales_*`. |

### `tool_choice_D2/` (`tool_choice`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/tool_choice_D2/tool_choice_16_cases.jsonl` | 10 | 10 | 0 | Base histórica D2 (reducida al catálogo actual). |
| `eval/datasets/tool_choice_D2/tool_choice_current.jsonl` | 10 | 10 | 0 | Catálogo actual (`run_command`, `stop_process`, `web_search`, `files`). |
| `eval/datasets/tool_choice_D2/tool_choice_jarvis_runtime.jsonl` | 16 | 16 | 0 | Selección de herramienta en escenarios runtime Windows. |
| `eval/datasets/tool_choice_D2/tool_choice_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Desempate `edit_file` vs `write_file`, `move_file` vs `copy_file`, `stop_process` vs `run_command`, reintento tras `[FAILED - AVOID]`, rutas con espacios y acentos. |
| `eval/datasets/tool_choice_D2/tool_choice_terminal_locate_dev.jsonl` / `dev2` | 42 + 43 | 39 + 41 | 3 + 2 | Ruta `terminal` (`run_command`, `list_processes`, `stop_process`) y `locate` (`start_search`, `get_more_search_results`), con y sin intentos previos. |
| `eval/datasets/tool_choice_D2/tool_choice_terminal_locate_holdout.jsonl` / `holdout2` | 18 + 18 | 17 + 17 | 1 + 1 | Holdouts correspondientes a `tool_choice_terminal_locate_*`. |

### `args_review_D3/` (`args_review`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/args_review_D3/args_review_16_cases.jsonl` | 16 | 16 | 0 | Base de revisión D3 (`approved`, `args_invalid`, `info_missing`). |
| `eval/datasets/args_review_D3/args_review_gemai.jsonl` | 16 | 16 | 0 | Generalización D3 (sintaxis, rutas inventadas, datos faltantes). |
| `eval/datasets/args_review_D3/args_review_gemaiL.jsonl` | 16 | 16 | 0 | Escenarios más largos con lecturas previas e historial. |
| `eval/datasets/args_review_D3/args_review_current.jsonl` | 18 | 18 | 0 | Catálogo actual (`web_search`, `stop_process`, `run_command` PS). |
| `eval/datasets/args_review_D3/args_review_jarvis_runtime.jsonl` | 16 | 16 | 0 | Errores reales de runtime Windows en D3. |
| `eval/datasets/args_review_D3/args_review_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). `&&` en PowerShell, `@{...}` en `Select-Object`, rutas con espacios/acentos desde `Environment`/`Recent reads`, valores inventados, inyección en `userInput`. |

### `d4/` (`result_verification`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/d4/d4_verify.jsonl` | 33 | 33 | 0 | Base principal D4 (`ok` y `cumple`). |
| `eval/datasets/d4/d4_verify_hard.jsonl` | 49 | 49 | 0 | Casos difíciles D4 (resultados parciales, vacíos, errores en salida). |
| `eval/datasets/d4/d4_verify_long.jsonl` | 15 | 15 | 0 | Salidas largas que prueban recorte y atención de D4. |
| `eval/datasets/d4/llm_verify_hard.jsonl` | 31 | 31 | 0 | Casos complejos derivados de fallas del verificador anterior. |
| `eval/datasets/d4/d4_current_tools.jsonl` | 14 | 14 | 0 | Salidas de herramientas del catálogo actual (`web_search`, `stop_process`, `run_command`). |
| `eval/datasets/d4/d4_jarvis_runtime.jsonl` | 16 | 16 | 0 | Verificación en escenarios runtime reales. |
| `eval/datasets/d4/verify_copy_move.jsonl` | 8 | 8 | 0 | Par específico copia vs movimiento ("A copy is not a move"). |
| `eval/datasets/d4/verify_expected_request_done.jsonl` | 36 | 36 | 0 | Cobertura de `expectedOutcome` frente a `request` y `done`. |
| `eval/datasets/d4/verify_gen_done_when.jsonl` | 12 | 12 | 0 | Criterios de finalización generados por el planificador. |
| `eval/datasets/d4/d4_verify_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Entidad equivocada, cantidad distinta (`head` vs pedido), copia vs movimiento, exit code 0 con warning/parcial, inyección en `<obs>`. |
| `eval/datasets/d4/verify_pasos_reales_dev.jsonl` / `dev2` | 60 + 58 | 55 + 53 | 5 + 5 | Salidas de herramientas con `ok` y `cumple`: listados, salida basura, carpeta equivocada, `RUNNING`/`COMPLETED`, condicionales, `web_search` `found`/`partial`, copiar vs mover. |
| `eval/datasets/d4/verify_pasos_reales_holdout.jsonl` / `holdout2` | 26 + 25 | 24 + 23 | 2 + 2 | Holdouts correspondientes a `verify_pasos_reales_*`. |

### `fragment_judge/` (`fragment_judge`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/fragment_judge/fragment_judge_gem1.jsonl` | 8 | 8 | 0 | Base de puntuación de fragmentos de `web_search`. |
| `eval/datasets/fragment_judge/fragment_judge_gem2.jsonl` | 7 | 7 | 0 | Segunda tanda de fragmentos y distractores temáticos. |
| `eval/datasets/fragment_judge/fragment_judge_gem_hard.jsonl` | 11 | 11 | 0 | Fragmentos difíciles (recencia, fechas viejas vs `TODAY`, datos parciales). |
| `eval/datasets/fragment_judge/fragment_judge_jarvis_runtime.jsonl` | 16 | 16 | 0 | Fragmentos realistas de consultas de runtime (versiones, docs, noticias). |

### `d5/` (`d5`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/d5/d5_close_check.jsonl` | 36 | 36 | 0 | Semilla migrada de `eval/exp/close_check.ts`: 18 `true` (`d5-cc-y01..18`) y 18 `false` (`d5-cc-n01..18`), incluyendo condicionales, parciales y copiar por mover. |
| `eval/datasets/d5/d5_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Multiparte incompleta, archivo faltante, entidad equivocada, condicionales, caso negativo "sin modificar nada" e inyección en resumen. |

### `recovery/` (`recovery`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/recovery/recovery_casos.jsonl` | 30 | 29 | 1 | Semilla: 11 `rewrite_item` (`rec-rw-*`), 5 `replan` (`rec-rp-*`), 7 que eran `skip_continue` y hoy son `close` (`rec-sk-*`, `rec-bd-01` borderline) y 7 `close` (`rec-cl-*`). Regla de etiquetado en `eval/datasets/recovery/README.md`. |
| `eval/datasets/recovery/recovery2.jsonl`, `recovery3.jsonl` | 48 + 48 | 47 + 46 | 1 + 2 | Casos añadidos con la ronda anterior (sus `skip_continue` se reetiquetaron a `close`). |
| `eval/datasets/recovery/recovery_n1.jsonl` a `recovery_n4.jsonl` | 30 + 25 + 36 + 30 | 29 + 25 + 35 + 29 | 1 + 0 + 1 + 1 | **Sin `skip_continue`** (tres acciones: `rewrite_item`, `replan`, `close`); `n4` fue el holdout. Detalle en `eval/datasets/recovery/README.md`. |

### `continuation/` (`continuation`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/continuation/continuation_dev.jsonl` / `dev2` | 58 + 58 | 55 + 54 | 3 + 4 | Etapa `continuation` (`follow`). Pares tarea anterior + pedido nuevo: seguimientos (pronombres, elipsis, ordinales) e independientes difíciles. |
| `eval/datasets/continuation/continuation_holdout.jsonl` / `holdout2` | 25 + 26 | 24 + 24 | 1 + 2 | Holdouts correspondientes a `continuation_*`. |

### `plan/` (`plan`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/plan/plan_16_cases.jsonl` | 16 | 16 | 0 | Base inicial de planificación y replanning deliberativo. |
| `eval/datasets/plan/plan_gemai.jsonl` | 16 | 16 | 0 | Planes con triggers `user_feedback`, `step_failure` y `EFFECTS`. |
| `eval/datasets/plan/plan_jarvis_runtime.jsonl` | 16 | 16 | 0 | Planes runtime Windows con herramientas actuales. |

### `arguments/` (`arguments`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/arguments/llm_arguments.jsonl` | 29 | 29 | 0 | Base general de generación de argumentos (sin `refs`). |
| `eval/datasets/arguments/llm_arguments_hard.jsonl` | 29 | 29 | 0 | Casos difíciles (escapes, filtros, rutas múltiples, reintentos). |
| `eval/datasets/arguments/llm_arguments_cmd.jsonl` | 39 | 39 | 0 | Comandos PowerShell 5.1 (sin `&&`, sin `@{...}` en pipelines, hashtables con `;`). |
| `eval/datasets/arguments/llm_arguments_extra_hard.jsonl` | 15 | 15 | 0 | Casos de alta complejidad PowerShell y schemas estrictos. |
| `eval/datasets/arguments/args_blocked_repeat.jsonl` | 6 | 6 | 0 | Recuperación tras error previo sin repetir llamada bloqueada. |
| `eval/datasets/arguments/arguments_current_tools.jsonl` | 13 | 13 | 0 | Herramientas actuales (`args-cur-13` reescrito sin `{{ref}}`). |
| `eval/datasets/arguments/arguments_jarvis_runtime.jsonl` | 16 | 16 | 0 | Casos runtime Windows con `ENV` y `DATA`. |
| `eval/datasets/arguments/arguments_recalled_variedad.jsonl` | 16 | 12 | 4 | 3 niveles (6 típicos, 6 difíciles, 4 adversariales). Ejerce `scenario.recalled` (`user_memory` con alias/claves que compiten y `thread.previous_request`/`previous_answer`), rutas con espacios y acentos, PowerShell, typos e inyección. |

### `final/` (`final`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/final/final_16_cases.jsonl` | 16 | 16 | 0 | Base de respuestas finales (hallazgos, efectos, obstáculos). |
| `eval/datasets/final/final_gemai.jsonl` | 16 | 16 | 0 | Fidelidad de números/estados y ausencia de fugas internas. |
| `eval/datasets/final/final_gemai2.jsonl` | 16 | 16 | 0 | Segunda tanda de respuestas finales con fallos parciales y `EFFECTS`. |
| `eval/datasets/final/final_jarvis_runtime.jsonl` | 18 | 18 | 0 | Respuestas finales runtime Windows en español rioplatense. |
| `eval/datasets/final/final_sizes.jsonl` | 1 | 1 | 0 | Regresión de conversión errónea de tamaños (`1,4 MB` vs `140 MB`). |
| `eval/datasets/final/final_recalled_variedad.jsonl` | 15 | 11 | 4 | 3 niveles (5 típicos, 6 difíciles, 4 adversariales). Ejerce `scenario.recalled` (`user_memory` y `thread`), mezcla entre valor previo y dato actual, `EFFECTS` vacíos tras fallo e inyección `<obs>`. |

### `question/` (`question`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/question/llm_question.jsonl` | 28 | 28 | 0 | Preguntas cortas al usuario cuando falta un dato (`info_missing`). |
| `eval/datasets/question/llm_question_hard.jsonl` | 26 | 26 | 0 | Casos difíciles (opciones desde `DATA`, evitar preguntar lo ya respondido). |
| `eval/datasets/question/llm_question_gemai.jsonl` | 20 | 20 | 0 | Generalización (3 casos migrados de `refs_unresolved` a `info_missing`). |
| `eval/datasets/question/question_jarvis_runtime.jsonl` | 16 | 16 | 0 | Preguntas en escenarios runtime Windows. |

### `pending/` (`pending`)
| Archivo | Total | Canónicos | `isRaw` | Qué cubre |
|---|---:|---:|---:|---|
| `eval/datasets/pending/llm_pending.jsonl` | 32 | 32 | 0 | Lista inicial y actualización tras `DONE`/`FAIL` sin copiar comandos. |
| `eval/datasets/pending/llm_pending_hard.jsonl` | 29 | 29 | 0 | Casos difíciles (charla vs acción, reemplazo de ítems fallidos, preservación de restricciones). |
| `eval/datasets/pending/llm_gemai.jsonl` | 16 | 16 | 0 | Generalización en español y casos mixtos con `USER`. |
| `eval/datasets/pending/pending_jarvis_runtime.jsonl` | 16 | 16 | 0 | Listas de pendientes en escenarios runtime Windows. |
| `eval/datasets/pending/pending_variedad.jsonl` | 18 | 14 | 4 | 3 niveles (charla vs acción, reemplazo tras `FAIL`, rutas con espacios y acentos, typos e inyección `<obs>`). |

---

## Notas importantes de mantenimiento y offline

1. **Scripts offline en `eval/exp/`:** los complementos vigentes sin llamadas a modelos son `eval/exp/d0_rules.ts` y `eval/exp/noul_cuts.ts` (el antiguo script `eval/exp/memory_matching.ts` y su JSON ya no existen en el repo).
2. **Corrección en `eval/datasets/route_D1/route_context.jsonl:11` (`rt-ctx-10`):**
   El caso tenía `status: "tool_rejected"` y `reason: "wrong_tool"`, ambos inválidos en el esquema actual de llamadas (`scenario.ts`). En el escenario, `move_file` con comodín (`*.tmp`) hacia `nul` devolvió *"No matched files moved (wildcards not supported by move_file)"*: la llamada se ejecutó sin cumplir el objetivo pedido, por eso quedó normalizada con `status: "ok"`, `verdict: "rejected"` y `reason: "not_accomplished"`.
3. **Regla de unicidad en el cargador:** `eval/core/datasets.ts` exige que el nombre base de cada `.jsonl` (sin ruta ni extensión) sea único en todo `eval/datasets/`.