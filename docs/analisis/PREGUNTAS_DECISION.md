# Preguntas a Decisión: qué se pregunta hoy y qué conviene preguntar

> 2026-11-14. Medido contra `d3:2b-text` (y `d3:4b-text` de control) con `/v1/systemone`. Las muestras son chicas y varias etiquetadas a mano: sirven para decidir qué construir, no como medida final. Los scripts están en `eval/exp/` (`question_sets_d4.ts`, `question_views_d4.ts`, `place_wordings.ts`, `close_check.ts`).

## Qué se hizo
**Comprobación de ubicación de lo escrito (implementada; hoy es la sonda `place` de `tools/probes.ts`).** Tras una escritura del catálogo cuya poscondición en disco se cumple (`write_file`, `create_directory`, `move_file`), la sonda hace dos consultas `noul` sobre el mismo resultado y se rechaza (`not_accomplished`) si la menor de las dos probabilidades es < 0,6:
- **V1:** el estado de D4 (resultado de la llamada) y «¿el archivo está en la carpeta que pidió el usuario?».
- **V2:** estado mínimo con la ruta separada en carpetas (`C: > Users > Hugo F > Desktop > jarvis`) y «¿la lista de carpetas contiene el lugar que pide el pedido?» (para una carpeta nueva se lista completa, con ella misma).

Medido: con el pedido «carpeta jarvis» y otros tres, V1 rechazó 8 de 11 destinos equivocados, V2 9 de 11 y **juntas (la menor de las dos) 11 de 11**, con las 4 correctas aprobadas; el `cumple` genérico de D4 daba 0,63 a 0,92 a los equivocados (no distinguía). 0 falsos rechazos en 12 pedidos que no nombran un lugar (con el aviso «si no nombra un lugar, respondé sí» había 2: se descartó). Con la implementación final, 27 casos (incluye carpetas nuevas y movimientos): 11/11 correctas aprobadas y 15/15 equivocadas rechazadas; la variante 2 de carpetas nuevas se ajustó mirando esa misma muestra. El 4B da una falla por variante, así que no hace falta para esto. **No cubre** dos carpetas con el mismo nombre (necesita un dato: hecho guardado, `locate` o preguntar).

## Las preguntas de hoy
| Decisión | Pregunta(s) | Observación |
|---|---|---|
| D0 | `kind` (`choice`: chat / single / multi) + `multi` (`noul`) | Una sola vista de la solicitud. 31/35 en el dataset; los 3 fallos de charla son conocimiento técnico estable |
| Continuación | `follow` (`noul`) | Una sola vista. Los seguimientos cortos rondan 0,34 a 0,43 y el umbral 0,3 se eligió sobre el mismo conjunto |
| D1 | `route` (`choice` con pistas por ruta) | Una consulta, sin señal de confianza salvo la probabilidad |
| D2 | `selected_tool` (`choice`) | Con una sola herramienta no se consulta |
| D3 | `review` (`choice`: approved / args_invalid / info_missing), solo en escrituras sin confirmación humana | Una pregunta para tres cosas distintas; aprobó 5 de 5 rutas inventadas (hoy cubiertas por el pre-chequeo) |
| D4 | `ok` y `cumple` (`noul`); `ok` ya lo responde el código en lecturas deterministas | Ver abajo |
| D5 | `request_complete` (`noul`) | Un falso «sí» cierra la tarea incompleta en silencio |
| Juez de fragmentos | un `noul` por fragmento | Sin cambios |

## Qué mostró la medición

### 1. Preguntar más sobre el mismo estado casi no ayuda (D4, 184 casos)
Con la pregunta de producción más cuatro extra en la misma consulta (`error`, `answered`, `other`, `missing`), todos los conjuntos quedan en **80 a 82 %** (±1 caso). Solo mueven el punto entre falsos positivos y falsos negativos.

| Conjunto (aprobar si todas ≥ 0,6) | Aprueba mal (de 95) | Rechaza bien (de 89) | Aciertos |
|---|---|---|---|
| producción: `ok` + `cumple` | 17 | 17 | 150/184 (81,5 %) |
| solo `cumple` | 19 | 16 | 149 |
| `ok` + `cumple` + `missing` | 15 | 19 | 150 |
| las 6 | 13 | 22 | 149 |
| media de las 6 ≥ 0,8 | 14 | 19 | 151 |

Las preguntas extra son del mismo modelo mirando el mismo texto: sus errores están correlacionados. Con `d3:4b-text` la producción da 85,3 % y con `missing` 87,5 % (+4 casos), pero ese modelo no entra junto a qwen en 8 GB. Dato útil: la pregunta `ok` reformulada («¿es un error, un mensaje de falla o vacío?») separa mejor que la de hoy (AUC 0,96 contra 0,93 cuando el modelo la responde), pero hoy `ok` casi no importa porque el código la resuelve en lecturas deterministas.

### 2. Cambiar la *vista* descorrelaciona más que cambiar la redacción
La misma pregunta `cumple` sobre cuatro renderizados del mismo resultado (completo, mínimo, resultado primero, entre comillas):
- cada renderizado falla en 31 a 37 casos de 184; **los cuatro a la vez en 16**; alguno en 54;
- AUC: 0,89 solo, **0,92 con la media de los cuatro**; aciertos 149 → 152 o 153;
- **confianza por acuerdo:** cuando los cuatro coinciden (146 casos) el error es **11 %**; cuando discrepan (38 casos) es **42 %**, casi moneda al aire.

### 3. D5, dos preguntas distintas (36 casos, `eval/exp/close_check.ts`)
| | Falsos «sí» (cierra incompleta) | Falsos «no» | Aciertos |
|---|---|---|---|
| `request_complete` de producción (D1) a 0,6 | 2 | 3 | 31/36 |
| variante D2 sola a 0,6 | 5 | 2 | 29/36 |
| **las dos, aprobar solo si ambas ≥ 0,6** | **1** | 3 | 32/36 |
| **media de las dos ≥ 0,6** | **1** | **2** | **33/36** |

Los errores de D1 y D2 son en gran parte distintos. Un caso (`n05`) cierra mal con todas las variantes.

## Qué propongo (DECISIÓN NUEVA, nada de esto está implementado salvo la ubicación)
1. **D5 con dos preguntas (media ≥ 0,6).** Es la mejora medida más clara y toca justo el error más caro (cerrar incompleta). Dos consultas en vez de una (~100 ms). Validar con más casos antes de fijar el umbral.
2. **Tres resultados en vez de dos para las escrituras:** aprobar si todas las vistas coinciden en aprobar, rechazar si coinciden en rechazar, **dudar** si discrepan. La duda no ejecuta más: pregunta al usuario o cierra la tarea (es lo que se pidió: si no se puede garantizar, cerrar). Hay que definir qué hacer con una escritura ya ejecutada que quedó en duda (el residuo).
3. **D4 `cumple` sobre varias vistas** (completo, entre comillas, resultado primero), con la media como probabilidad y el acuerdo como confianza. Cuesta 3 consultas de ~25 ms.
4. **Mismo criterio para D1, D0 y continuación:** una segunda vista barata (sin pistas / con la solicitud en vez del paso) y duda cuando discrepan. **Sin medir todavía**: hay que armar casos con la respuesta verdadera.
5. **D3:** separar la pregunta única en polares (`¿hay algún valor inventado?`, `¿falta información del usuario?`, `¿el comando o la ruta es peligroso?`) y exigir que todas pasen. **Sin medir.**

## Límites
- Los 184 casos de D4 y los 36 de D5 son los de los datasets; varias etiquetas son mías o de otro agente y algunas son discutibles (por eso hay un piso de error que ningún set baja).
- Las combinaciones se eligieron mirando los mismos datos con los que se miden: la ganancia real puede ser menor.
- Una vista nueva suma consultas (cada una ~25 a 50 ms) pero no memoria: el modelo ya está cargado.

---

## Casos que el 2B falla siempre: dataset, camino esperado y qué separa (2026-11-14, segunda parte)

### El dataset (`eval/exp/hard_cases.jsonl`, `eval/exp/hard_cases.ts`)
Ocho clases, cada una con un caso malo y su gemelo correcto (el gemelo mide los falsos positivos). Se armó mirando los 16 casos de D4 que fallan con las cuatro vistas (por ejemplo `append` en vez de «al principio», `app*.log` para «todos los .log», hoja `Hoja1` en vez de `Ventas`, un listado sin fechas para «los más recientes») y los de lugar.

| Caso | Qué pasó | Veredicto esperado | Camino esperado |
|---|---|---|---|
| c1 lugar | pidió la carpeta jarvis **de Documentos** y escribió en la del escritorio | rechazar | **preguntar o cerrar**: el archivo ya existe en el lugar equivocado (residuo) |
| c2 lugar | pidió Proyectos **del escritorio** y escribió en la de Documentos | rechazar | preguntar o cerrar (mismo residuo) |
| c3 posición | pidió «al principio» y `mode: append` agrega al final | rechazar | **reintentar** con el motivo «append agrega al final; reescribí con la línea primero» |
| c4 alcance | pidió «todos los .log» y el patrón `app*.log` trajo uno | rechazar | reintentar con `*.log` |
| c5 ítem | pidió la hoja Ventas y se leyó la `Hoja1` | rechazar | reintentar con `sheet: "Ventas"` |
| c6 atributo | pidió «los más recientes» y el listado no trae fechas | rechazar | reintentar con otra herramienta (`run_command` ordenando por fecha) |
| c7 estado | el proceso de los tests solo se lanzó, sin salida | no aprobar | **esperar** (continuar con el `pid`) |
| c8 cierre (D5) | pidió buscar y guardar; solo se buscó | no cerrar | continuar con lo que falta (reabrir la lista) |

Cada gemelo bueno debe aprobar y seguir.

### Resultado con las preguntas de hoy (producción) y con sondas por herramienta
Producción sobre los 7 casos malos (el 8.º es de D5): **5 de 7 aprobados mal** (c1 por la ubicación a 0,65; c3, c4, c5 y c6 por `cumple` 0,83 a 0,99), 0 falsos negativos. D5 acierta c8 (`close_1` 0,11 y `close_2` 0,20; los buenos 0,98 y 0,99).

El `cumple` genérico no ve estos fallos: son incoherencias entre lo pedido y un **argumento** (`mode`, `pattern`, `sheet`) o una **propiedad** que la herramienta no devuelve. Lo que separó fue cambiar *qué se muestra en el estado*: poner lado a lado lo pedido y lo hecho, y explicar la semántica de la herramienta.

| Sonda (dónde aplica) | Redacción hoy | Redacción que separa | «bien» malo / bueno |
|---|---|---|---|
| posición (`write_file`) | «¿el texto está donde dice el paso?» | estado con «texto agregado al FINAL (mode append)» o la primera línea del contenido, y «si el paso pide el principio, ¿está al principio? si pide el final, ¿al final?» | 0,91 / 0,98 → **0,28 / 0,99** |
| alcance (`start_search`) | «¿cubre todo lo pedido?» | dos líneas: «El usuario pidió: …» y «La búsqueda miró solo nombres: `app*.log`», «¿son el mismo conjunto de archivos?» | 0,85 / 0,99 → **0,35 / 0,98** |
| ítem (`read_file` de Excel) | «¿muestra el ítem que nombra el paso?» | argumentos enviados y primeras líneas, «¿se leyó un ítem por defecto o distinto?» (afirmativa = malo) | 0,72 / 0,99 → **0,11 / 0,99** |
| atributo (`list_directory`) | «¿trae los atributos necesarios?» | **dos etapas:** «¿el paso pide ordenar o elegir por una propiedad (reciente, grande)?» y, solo si sí, «¿el resultado la muestra?» | en una consulta rechaza mal 5 de 11; en dos etapas, 0 |
| terminado (`run_command`) | — | no hace falta: `cumple` ya rechaza c7 (0,11) y la sonda aplicada a todos los comandos rechazaba mal 4 de 90 | descartada |

Cada sonda se aplica **solo a su herramienta** (decisión del código por herramienta, sin palabras clave): aplicadas a todas las filas daban falsos negativos en las que no les corresponden (`covers_all` baja a 0,67 en una escritura correcta, `same_target` a 0,27 en una salida de tests).

**Medido sobre las 184 filas de D4 más las del dataset difícil:**
- Difíciles (7 malos + 7 buenos con herramienta): producción 9 de 14; **con las sondas 13 de 14** (falsos positivos 5 → 1; el que queda es c1, que cubre la ubicación).
- D4 (184): las que sirven (posición, ítem, alcance, atributo en dos etapas) rechazan bien 1 + 1 + 2 + 2 y rechazan mal 0 + 0 + 1 + 0. Con las versiones de una sola consulta de `attrs` y `finished` los falsos negativos pasaban de 17 a 27: por eso la versión en dos etapas y descartar `finished`.

### Umbrales: subirlos no es la palanca
| Qué | Umbral 0,6 | Umbral 0,8 |
|---|---|---|
| D4 producción (184 casos) | falsos «aprobar mal» 17, rechaza bien 17 · 150/184 | 13 y 20 · 151/184 |
| ubicación, mín(V1, V2 de hoy), 30 casos (13 correctos) | correctas 13/13, equivocadas rechazadas 16/17 | **11/13, 17/17** (cambia 2 falsos negativos por 1 falso positivo) |
| D5, media de dos preguntas (36 casos) | 33/36 | a 0,7: 31/36 |

Los casos malos de c3 a c6 puntúan **0,83 a 0,99** con la pregunta de hoy, por encima de cualquier umbral razonable. Lo que los separa es la pregunta (arriba), no el número. Sí conviene un umbral por sonda cuando el margen lo permite (posición y atributo separan con ≥ 0,6 sin falsos negativos).

La pregunta de ubicación tiene un margen delgado: con los criterios `true`/`false` de producción, la correcta más baja y la equivocada más alta de mín(V1, V2 de hoy) puntúan lo mismo (0,63; la equivocada es c1, «jarvis de Documentos» escrito en el escritorio). V1 sola aprueba 13/13 correctas con mínimo 0,87 pero deja pasar 6 de 17 equivocadas; V2 de hoy aporta las que V1 deja pasar. Probadas otras dos redacciones de V2: B («todas las carpetas nombradas») da 0,19 a una correcta sin lugar nombrado; C («mismo orden») con mín(V1, C) llega a 97 % a 0,85 (13/13 y 15/17), parecido al de hoy a 0,55 a 0,6 (97 %). Ninguna domina: con 30 casos la diferencia es de uno o dos casos.

### Qué haría a nivel de código (sin patrones por palabra)
1. **Sondas por herramienta, declaradas en el catálogo** (`tools/manifest.ts`): cada herramienta lleva cómo mostrar lo pedido contra lo hecho y qué preguntar. El código elige la sonda por herramienta y por tipo de archivo (`.xlsx`), no por palabras del pedido. El motivo de rechazo de cada sonda es fijo y va a `FAIL` («`append` agrega al final; reescribí el archivo con la línea primero»): hoy el generador recibe «no cumple» sin saber por qué.
2. **Explicar la semántica de la herramienta en el estado** con datos que el catálogo ya tiene (`list_directory` devuelve solo nombres; `mode: append` agrega al final; `start_search` busca por nombre).
3. **Tres resultados:** aprobar si todas las sondas aplicables pasan, rechazar con el motivo, y **dudar** cuando la ubicación o el acuerdo entre vistas queda en la zona media: no se sigue, se pregunta o se cierra.
4. **Residuo:** c1 y c2 dejan un archivo en el lugar equivocado. Cerrar bien exige o detectar el lugar antes de escribir (preguntar por la ubicación de una carpeta que existe en dos lugares, hecho guardado, `locate`) o dejarlo registrado en la respuesta como «escrito en X, no en Y». Esto no se resuelve con preguntas al modelo.

Scripts: `eval/exp/hard_cases.ts` (dataset y políticas), `polar_wordings.ts` (redacciones), `probes_d4.ts` y `probes_refine.ts` (sondas sobre D4), `place_wordings.ts` (ubicación y umbrales).

### Límites de esta segunda parte
- Las redacciones de las sondas de `polar_wordings.ts`, `probes_d4.ts` y `probes_refine.ts` se probaron **sin** los textos `criteria.true` / `criteria.false` que usa producción (la pregunta de ubicación sí, y con ellos cambió el resultado de la variante 2). Antes de implementarlas hay que repetirlas con criterios.
- Cada clase del dataset difícil tiene un solo par (malo y bueno): la separación de 0,6 a 0,98 es una señal, no una medida. En D4 cada sonda aplica a entre 2 y 22 filas.
- El dataset es de una sola PC y de una sola carpeta de usuario (`Hugo F`).


## Tercera parte: sondas implementadas y medidas con criterios y casos de producción (2026-11-14)

Implementadas en `src/core/tools/probes.ts` (declaradas en `tools/manifest.ts`, ejecutadas por `engine/probes.ts`). `eval/exp/probe_eval.ts` arma el estado y la pregunta con las mismas funciones `stages()` que usa el motor (criterios `true`/`false` incluidos), con pedidos en español, argumentos como los mandaría el generador y resúmenes como los deja la herramienta; compone el resultado como el motor (compuerta, `badWhenTrue`, umbral). `d3:2b-text`, 52 casos (18 ubicación, 12 posición, 12 alcance, 12 ítem, 12 atributo; la mitad buenos):

| sonda | a 0,5 (buenas / malas) | a 0,6 (umbral) | a 0,7 | a 0,8 |
|---|---|---|---|---|
| ubicación | 8/8 · 8/10 | **8/8 · 9/10** | 7/8 · 10/10 | 7/8 · 10/10 |
| posición | 6/6 · 6/6 | **6/6 · 6/6** | 6/6 · 6/6 | 6/6 · 6/6 |
| alcance | 6/6 · 5/6 | **6/6 · 5/6** | 6/6 · 5/6 | 4/6 · 6/6 |
| ítem | 6/6 · 3/6 | **6/6 · 5/6** | 6/6 · 5/6 | 6/6 · 5/6 |
| atributo | 6/6 · 5/6 | **6/6 · 5/6** | 6/6 · 5/6 | 6/6 · 5/6 |

A 0,6: **0 buenas rechazadas y 30 de 34 malas rechazadas**. Las cuatro que se escapan: ubicación (jarvis de Documentos escrito en el escritorio, 0,64: el margen delgado de siempre), alcance (`app*.log` para «todos los .log», 0,71), ítem (hoja «Hoja1» enviada para «la hoja Costos», 0,99: el modelo ve los argumentos y el resumen y no compara el nombre) y atributo («modificados esta semana» no pasa la compuerta, 1,00 de «solo lista»). Con 6 casos por lado, subir el umbral cambia un caso por otro: se deja en 0,6. Los casos que escapan son candidatos a una pregunta mejor, no a un umbral.

### Regresión de las sondas de producción sobre D4 (2026-11-14)

`eval/exp/probe_regression.ts`, `d3:2b-text`, las sondas del catálogo sobre los 184 casos de D4 (47 con alguna sonda aplicable) y 14 filas difíciles, sumadas al veredicto base (`ok` y `cumple` ≥ 0,6):

| | falsos positivos | falsos negativos | aciertos |
|---|---|---|---|
| D4 hoy (base) | 18/95 | 17/89 | 149/184 |
| D4 + sondas | 13/95 | **18/89** | **153/184** |
| difíciles, base | 5/7 | 0/7 | 9/14 |
| difíciles + sondas | 2/7 | 0/7 | 12/14 |

Un falso negativo nuevo en D4: `verify-105` (posición, 0,60 justo bajo el umbral), que se midió con el pedido de tres pasos y no con la instrucción del paso (en deliberativo producción usa el paso). La primera corrida tuvo otro: un renombrado en la misma carpeta que la sonda de ubicación rechazaba con 0,20; ahora `move_file` con origen y destino en la misma carpeta no pasa por ella. Por sonda, las que más aportan: alcance (rechaza bien 2), ítem (1), atributo (1), posición (1); ubicación no cambia D4 (sus casos malos de D4 no son de lugar) pero separa 13/14 en los casos difíciles.
