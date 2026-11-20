# Plan: datasets nuevos y variantes a medir (2026-11-19)

Para los dos agentes que trabajan en `eval/`: uno **arma datasets** (Parte A) y otro **escribe y corre variantes** (Parte B). Los dos leen antes [`eval/INSTRUCCIONES.md`](../../eval/INSTRUCCIONES.md) (§4 datasets, §6 variantes, §7 interpretar) y [`eval/GUIA_DECISION.md`](../../eval/GUIA_DECISION.md) (lo que ya se sabe y lo que no vale la pena repetir). Este documento dice **qué** falta medir y **por qué**; el cómo está en esos dos.

## 1. Para qué

Las trazas reales del 18 y 19 de noviembre mostraron fallos que los datasets actuales no cubren. Hoy se decide por impresión; el objetivo es poder decidir con números.

| Decisión abierta | Evidencia que la motiva | Qué falta para decidir |
|---|---|---|
| **D2:** descripciones de `run_command` y `list_processes` | «Identificar el hardware del equipo» eligió `list_processes` (0,51 contra 0,48) y la tarea falló. Un replay de 192 consultas reales con descripciones nuevas mantuvo las 71 elecciones buenas y cambió 11 de las 44 malas de terminal | Dataset de D2 de terminal y búsqueda; correr las variantes de descripción |
| **D2:** el marcador `[FAILED - AVOID]` | Subió `list_processes` de 0,51 a 0,81 justo al marcarla; tras un bloqueo por repetición, D2 volvió a elegir la misma herramienta en 23 de 24 casos | Casos con intentos previos; variantes sin marcador |
| **D0 `multi`:** criterios de la `noul` | Una tarea de seis partes salió `single` (0,38). Con criterios `true`/`false` sube a 0,77. `kind` (choice) y `multi` (noul) se contradicen en el 32 % de las consultas reales | Dataset de pedidos reales etiquetados; comparar redacciones y reglas de combinación |
| **Continuación del hilo (`follow`)** | Única `noul` de producción sin criterios, corte 0,3 en una zona poblada. No hay dataset ni etapa en `eval/` | Etapa nueva `continuation` y su dataset |
| **D4 `cumple`** | Rechaza resultados que sí traen los datos (0,12 a 0,54) en pasos del tipo «analizar» o «recopilar», y aprobó una salida basura (`() () ()`) con 0,92. Su zona del medio (0,2 a 0,9) acierta como una moneda | Dataset con esos fenómenos; variantes de la pregunta; análisis de cortes |
| **D1:** rutas de pasos de investigación | «Recopilar información de pasajes» fue a `files` y se resolvió escribiendo un archivo; «bucsa… la carpeta» fue a `files` con `move_file` | Dataset de pasos reales |

Contexto de producción que los casos deben respetar: en reactivo, D0 clasifica y `pending` parte el pedido en ítems; D1 y D2 ven **el paso** (D1 además la línea `Request:`); D4 evalúa contra el paso. Los pasos reales suenan como «Identificar el hardware del equipo», «Recopilar información de pasajes aéreos o terrestres…», «Analizar el contenido de los archivos en el escritorio…».

## 2. Reglas comunes

- **Etiquetar lo correcto, no lo que pasó.** Una llamada aprobada puede ser mala y una rechazada puede ser buena. La etiqueta sale de lo que un criterio humano cuidadoso esperaría. Si no hay acuerdo claro, el caso va con `isRaw: true` y tag `borderline`.
- **No escribir casos a medida de una variante.** Quien arma el dataset no conoce las variantes ni tiene que ajustarlas. Los datasets se escriben antes de correr nada.
- **Dev y holdout.** Cada dataset nuevo se parte en `*_dev.jsonl` (≈70 %) y `*_holdout.jsonl` (≈30 %). El holdout se corre **una sola vez**, al final, solo con la variante ganadora.
- **Dificultad mezclada:** casos típicos, difíciles y adversariales (`isRaw`). Clases balanceadas, no más del 60 % de una misma respuesta.
- **Redacción de usuario real:** español rioplatense, con tipeos («bucsa», «provicia») y sin tildes, rutas de Windows con espacios y acentos. IDs únicos y estables; `description` en español; tags por fenómeno (por ejemplo `typo`, `compound`, `step_phrasing`, `running_search`, `negative_result`, `wrong_dir`).
- **Sin duplicar** los casos que ya existen (revisar `eval/datasets/INDEX.md`).
- **Lo que ya se sabe que no funciona** está en `GUIA_DECISION.md` §4: no repetir reglas negativas en el prompt, más texto, renombrar claves ni `--repeat` (el modelo de decisión es determinista; entre corridas hay ±1 caso de ruido por la carga).

## 3. Parte A: datasets nuevos

### 3.1 De dónde salen los casos
**Quien arma los datasets no está en la PC del usuario**, y `jarvis-traces/` no se versiona. Las fuentes que tiene a mano son:
1. Los archivos de [`docs/evaluacion/fuentes/`](fuentes/README.md): 124 pedidos reales, 39 pares de continuación, 161 pasos y 290 llamadas, ya extraídos de las trazas y **sin veredictos ni probabilidades** para no sesgar el etiquetado.
2. Las trazas adicionales que el usuario adjunte (formato abajo).
3. Los datasets existentes de `eval/datasets/` como modelo de formato.

Formato de las trazas adjuntas, por si hace falta ir más allá de las fuentes extraídas. Carpeta `jarvis-traces/`:
- `index.jsonl`: una línea por tarea (`request`, `state`, `stopReason`, `steps`, `calls`). Las 120 instrucciones distintas salen de acá.
- `<carpeta>/summary.md`: la tarea resumida con sus pasos, llamadas y la respuesta final. Empezar por acá.
- `<carpeta>/trace.json`: `snapshot` (pasos, llamadas con `args`, `status`, `verdict`, `summary`) y `queries` (cada consulta a un modelo con su etapa y salida interpretada).
- `<carpeta>/full.json.gz` (descomprimir): `models[]` con `{ seq, stage, input, output }` (la entrada y salida crudas de cada consulta de D0, D1, D2, D4, etc.) y `tools[]`. `input` es un texto JSON.

### 3.2 Qué crear

| Archivo | Etapa | Contenido | Mínimo |
|---|---|---|---:|
| `eval/datasets/D0/d0_real_usuario_dev.jsonl` y `_holdout.jsonl` | `d0` | Los 124 pedidos de `fuentes/pedidos_reales.json`, etiquetadas `chat`/`single`/`multi`, más 20 pedidos nuevos que **enumeren** tres o más cosas («Revisá mi equipo: identificá A, B y C…») y 10 `single` largos que parecen compuestos (un solo objetivo con mucho detalle). Los de `chat` llevan `minChatProbability`; las preguntas de hechos que no son charla, `maxChatProbability` | 150 |
| `eval/datasets/route_D1/route_pasos_reales_dev.jsonl` y `_holdout.jsonl` | `route` | **Pasos** (no pedidos) tal como los produce `pending`, tomados de `fuentes/pasos_reales.json`, con el pedido original en `scenario.request`. Fenómenos: pasos de investigación posteriores a haber creado un archivo (deben ir a `web`); «Identificar hardware / servicios / herramientas instaladas / procesos» (`terminal`); buscar una carpeta o un archivo de ubicación desconocida (`locate`); pasos tipeados con errores; pasos abstractos («Analizar…», «Proponer…») como `isRaw` | 60 |
| `eval/datasets/tool_choice_D2/tool_choice_terminal_locate_dev.jsonl` y `_holdout.jsonl` | `tool_choice` | Ruta `terminal` (`run_command`, `list_processes`, `stop_process`): hardware, SO, discos, servicios, herramientas instaladas, procesos por memoria o CPU, abrir una app, detener un proceso. Ruta `locate` (`start_search`, `get_more_search_results`): con un `start_search` previo que devolvió `Status: RUNNING … Use get_more_search_results` (esperado `get_more_search_results`) y sin él. **Con intentos previos** (`calls` con `verdict: rejected` o `status: loop_blocked`): en unos la herramienta correcta es la misma (cambian los argumentos) y en otros es otra; decirlo en la `description` | 60 |
| `eval/datasets/d4/verify_pasos_reales_dev.jsonl` y `_holdout.jsonl` | `result_verification` | Llamadas de `fuentes/llamadas_reales.json` con su `resumen` tal cual (es lo que vio el motor). Fenómenos: listado correcto para un paso de «analizar»; salida basura o vacía de formato (`() () ()`, `Name Extension ----` sin filas); comando que lista la carpeta equivocada (el home en vez del escritorio); búsqueda `RUNNING` con 0 resultados; búsqueda `COMPLETED` con 0 resultados para «si encontrás…» y para «buscá… con otras palabras»; `web_search` con `found` y 1 fuente, y con `partial`; escritura que no cumple el lugar pedido. `expectedOk` y `expectedCumple` por criterio humano | 80 |
| `eval/datasets/d5/d5_trazas_reales.jsonl` (opcional) | `d5` | Cierres de tareas reales (completadas y parciales) con su estado y lo hecho | 20 |
| `eval/datasets/continuation/continuation_dev.jsonl` y `_holdout.jsonl` | `continuation` (**etapa nueva**, la crea el agente de la Parte B) | Pares tarea anterior y pedido nuevo, ver abajo | 80 |

**Formato de `continuation`** (que el agente de la Parte B implementa; el de datasets solo escribe los JSONL):

```json
{"id":"cont-001","stage":"continuation","tags":["ellipsis"],"description":"«y en la de escritorio?» depende de la tarea anterior.",
 "scenario":{"mode":"reactive","request":"y en la de escritorio?",
   "recalled":{"thread":{"previous_request":"que archivos hay en la carpeta jarvis de documentos?","previous_answer":"Hay 2 archivos: notas.md y plan.md."}}},
 "expect":{"expectedFollows":true}}
```

`expectedFollows` es booleano; opcionales `minProbability` (solo con `true`) y `maxProbability` (solo con `false`). Contenido: los 39 pares de `fuentes/pares_continuacion_reales.json` (casi todos son independientes), seguimientos sintéticos (pronombres, elipsis, «ahora…», «y el otro?», «guardalo», «resumilo», «borrá el segundo») y **independientes difíciles** (repite el pedido anterior, mismo tema con objeto propio, nombra el mismo archivo con una acción nueva). Dejar al menos el 35 % de seguimientos. El `previous_answer` va recortado a 500 caracteres, como en producción.

### 3.3 Entrega de la Parte A
Los archivos de arriba, el `eval/datasets/INDEX.md` actualizado y un `docs/evaluacion/DATASETS_NUEVOS_2026-11-19.md` corto con: fuente de cada caso (traza o sintético), regla de etiquetado por etapa, casos `borderline` y su motivo, y cuántos casos quedaron en dev y en holdout.

## 4. Parte B: variantes y experimentos

Etapas y claves fijas: `route` (`route`), `tool_choice` (`selected_tool`), `d0` (`kind`, `multi`), `result_verification` (`ok`, `cumple`). Las descripciones de herramientas que ve D2 vienen de `data.tools[].description` (tope de **80 caracteres** en producción); una variante las puede reemplazar por nombre dentro de su constructor.

### 4.1 Variantes a escribir

| Etapa | Variante | Qué prueba |
|---|---|---|
| `tool_choice` | `tool_choice_desc_a` | Descripciones nuevas: `run_command` = `Run a PowerShell command: system info, hardware, disks, services, files.`; `list_processes` = `List running processes with their memory use. Not for hardware or system info.` |
| `tool_choice` | `tool_choice_desc_b` | Otra redacción de las dos, escrita por el agente (≤ 80 caracteres), que difiera en **una señal observable** del pedido |
| `tool_choice` | `tool_choice_nomarker` | Producción sin `[FAILED - AVOID]` |
| `tool_choice` | `tool_choice_request` | Producción más la línea `Request:` al inicio del estado, como hace D1 |
| `tool_choice` | `tool_choice_desc_a_request` | La combinación de las dos anteriores |
| `d0` | `d0_multi_nocriteria` | La pregunta `multi` sin criterios (el prompt de producción **antes** del cambio de hoy). Producción ya lleva criterios largos |
| `d0` | `d0_multi_short` | Instrucción `Does the request ask for two or more separate actions?`; true: `The request asks for two or more different things to do or find`; false: `The request asks for exactly one thing to do or find` |
| `result_verification` | `d4_cumple_has_data` | `cumple` como «¿el resultado contiene lo que el paso necesita para darse por hecho?» en lugar de «¿cumple el paso?», con criterios `true`/`false` equivalentes |
| `result_verification` | `d4_cumple_goal_aware` | Una redacción que distinga pasos de acción de pasos de análisis; la define el agente y la documenta |
| `continuation` | `follow_nocriteria` | La pregunta de producción, sin criterios |
| `continuation` | `follow_short` | Instrucción `Does the new request depend on the previous task: does it refer to it or need its result to be understood?`; true: `The new request needs the previous task to be understood`; false: `The task does not need previous tasks to be carried out` |
| `continuation` | `follow_examples` | Criterios con ejemplos entre paréntesis: true `The new request needs the previous task to be understood: it refers to its result ("it", "that", "the first one", "also", "now") or is a short follow-up that leaves out the object ("and in the other one?", "and when?").`; false `The new request says what to do and on what, in full, so it is understood without the previous task. A request that repeats the previous one, or is about the same topic, is false.` |

Para `route` (D1): escribir 2 o 3 variantes que ajusten solo los criterios de `files`, `locate` y `web` hacia los fenómenos del dataset de pasos reales, y reportarlas junto con `prod`.

### 4.2 La etapa `continuation`
No existe. Crearla siguiendo `INSTRUCCIONES.md` §4 («sumar una etapa nueva»): módulo en `eval/core/stages/continuation.ts`, registro, tipos, caso de humo, oracle. Construye el request con `DECISION_PROMPTS.buildContinuation` (recibe `{ previous: { request, answer }, request }`), lee la probabilidad de `follow` (`noul`) y la compara con `CONTINUATION_APPROVE` (`src/core/engine/thread.ts`, 0,3). El oráculo responde `expectedFollows`.

### 4.3 Análisis de cortes (script durable)
Escribir `eval/exp/noul_cuts.ts`, que lea una carpeta de resultados (`eval/results/<modelo>/<corrida>/`, los `runs.jsonl`) y, **por pregunta `noul`** (`ok`, `cumple`, `request_complete`, `multi`, `follow`, juez de fragmentos), imprima:
1. cuántos casos caen en cada tramo de 0,1 de probabilidad y qué porcentaje de ellos son realmente «sí»;
2. para cada corte de 0,10 a 0,90 (paso 0,05): «aprobados malos» (corte alcanzado y esperado «no») y «buenos rechazados» (corte no alcanzado y esperado «sí»);
3. el comparativo de tres juegos de cortes: **producción actual** (`ok` 0,3, `cumple` 0,6, cierre 0,75, juez 0,5, `multi` 0,5, `follow` 0,3), **mejor medido** y **mejor medido menos 5 puntos**.
Una `noul` devuelve la probabilidad del «sí»: 0,5 es «no sé» y la confianza crece con la distancia a 0,5. El valor y la respuesta esperada están en cada `runs.jsonl` (`questions.<clave>.noul` y `.expected`; en D0, `parsedOutput.multi` y `expectedLabel`).

Para D0 sumar `eval/exp/d0_rules.ts`: con las probabilidades guardadas, comparar reglas de combinación de `kind` y `multi` (la de producción: `chat ≥ 0,7`, si no `multi ≥ 0,5`; solo `kind.multi ≥ t`; `multi` o `kind.multi ≥ 0,9`; ambas altas) y reportar acierto y falsos `chat`.

### 4.4 Cómo correr
- **Con Ollama en la PC** (`d3:2b-text` para decisión; el contexto real de `d3` es 4096 y hay un `OLLAMA_CONTEXT_LENGTH=8192`, ver `docs/evaluacion/INFORME_MEDICION_2026-11-17.md` §4): `npx tsx eval/cli.ts --stages=<etapa> --dataset=<archivo_dev> --variant=prod,<v1>,<v2> --concurrency=2 --label=<nombre>`. Sin `--repeat`.
- **Sin Ollama (por ejemplo, en la web):** validar con `--client=oracle` (debe dar 100 %) y `--dry-run`, probar la maquinaria con `--client=mock`, dejar escritos los comandos exactos y **no inventar números**. Quien tenga el modelo corre las corridas reales.
- Cada corrida compara contra `prod`: si cambia `src/`, la fecha o la configuración, hay que volver a correr la base.
- Los ganadores en dev se validan **una vez** en el holdout.

### 4.5 Entrega de la Parte B
- Variantes en `eval/variants/<etapa>/`, la etapa `continuation` y los dos scripts de `eval/exp/`.
- Un informe `docs/evaluacion/INFORME_VARIANTES_2026-11-19.md` con, por variante y dataset: porcentaje de acierto contra `prod`, **la lista de casos que mejoran y que empeoran**, y los errores separados en «aprobó algo malo» y «rechazó algo bueno» (en D1 y D2, el tipo de confusión). Cierra con una recomendación por decisión de la tabla del §1 y qué falta medir.
- No modificar `src/`: la decisión de pasar una variante a producción es del dueño del proyecto.
