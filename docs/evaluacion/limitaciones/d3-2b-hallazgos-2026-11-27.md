# d3:2b: límites medidos en D4, D5 y el cierre (2026-11-27)

Complementa [d3-2b.md](./d3-2b.md) (2026-11-13, D1 a D5 con casos escritos a mano). Esta ficha recoge lo que se midió después, con datasets nuevos (trazas reales y casos sintéticos guiados por ellas) y con preguntas, formatos, cortes y modelos distintos. Es el modelo de **decisión**, no Qwen.

**Conclusión corta.** En D4 (¿el resultado cumple el paso?) y D5 (¿el pedido completo está cumplido?) el límite es del modelo de 2B: ninguna redacción, formato de pregunta, combinación ni corte lo supera de forma robusta. Cada cambio mueve errores de lugar (falsos «sí» contra falsos «no»). Lo que sí movió resultados fue darle **mejor contexto** (ver más abajo) y un **modelo más grande** (`d3:4b-text`).

## Cómo se midió

| Qué | Dónde |
|---|---|
| Trazas reales, curadas y etiquetadas con reglas | `eval/datasets/result_verification/result_verification_traces_{1,holdout_1}.jsonl` (22 casos) y `eval/datasets/d5/d5_traces_{1,holdout_1}.jsonl` (11). Las genera `eval/exp/traces_d4_d5.ts` sobre `npm run eval:traces` |
| Sintéticos con el formato real de las herramientas | `…_syn_{1,holdout_1}.jsonl`: D4 115 casos, D5 124 (resultados largos y truncados, pedidos de varias partes, copiar contra mover, condicionales) |
| Datasets de siempre | `result_verification_*` (342 casos) y `d5_*` (315), de desarrollo difíciles y holdout fáciles |
| Experimentos | `eval/exp/d4_questions.ts`, `d5_questions.ts`, `d5_coverage.ts`, `list_coverage.ts`, `write_reads.ts`, `list_args.ts` |

El modelo trabaja a **temperatura 0**: repetir una corrida no aporta (las diferencias de ±1 a 2 casos vienen de la concurrencia). Lo único que cambia el resultado es el texto de la entrada.

## 1. Las probabilidades se saturan y no están calibradas

- **Cobertura de una lista** (`covers`: «¿la lista cubre todo lo que pide el pedido?»), medida con 417 listas de verdad conocida (132 completas y 285 con un ítem menos). Las completas dan mediana 1,00 y las incompletas **0,85**:

  | Corte | Listas incompletas aceptadas | Listas completas rechazadas |
  |---|---|---|
  | 0,75 | 187/285 (66 %) | 1/132 |
  | 0,80 | 171/285 (60 %) | 3/132 |
  | 0,95 | 85/285 (30 %) | 20/132 |
  | 0,98 | 49/285 (17 %) | 28/132 |
  | 0,99 | 19/285 (7 %) | 37/132 (28 %) |
  | 0,995 | 6/285 (2 %) | 58/132 (44 %) |

  Un corte de 0,75 a 0,80 casi no separa; solo cerca de 1,0 sirve. La separación (AUC) de cada forma de preguntar: `covers` 0,905, `noul` invertida 0,930, `score` 0,942, `choice` 0,909.
- En D5 y D4 una probabilidad de 0,9 no es «90 % de acierto»: cumple el principio ya anotado en [d3-2b.md](./d3-2b.md).

## 2. D5: no juzga bien un pedido de varias partes con resultados largos

- Con el pedido de revisar la PC (virus y procesos viejos) ya cumplido, D5 dio **0,28 a 0,46** (corte 0,75) y, al crecer el DONE con pasos repetidos, **0,05 a 0,18**.
- En los 104 casos difíciles de desarrollo la separación está **invertida** (AUC 0,17 con `prod`): puntúa más alto lo incompleto que lo cumplido. En el holdout fácil separa del todo (AUC 1,00) y `prod` acierta 207/211.
- **Otros formatos** (`noul` de producción, `noul` invertida «¿falta algo?», `score` de 5 niveles, `choice` todo hecho / falta / hecho distinto, y medias o mínimos entre ellos): ninguno supera a `prod`. En 19 estados reales, lo cumplido puntúa de 0,05 a 0,6 y lo incompleto de 0,05 a 0,76. Reducir el DONE a una línea por llamada tampoco ayuda.
- **Cobertura por requisito** (una pregunta por par requisito–llamada, con los requisitos de la lista inicial de `pending`): en difíciles sube de 46 a 64 de 104, pero en el holdout fácil baja de 207 a 158 de 211 (42 falsos «sí») y en sintéticos de 110 a 90 de 124 (27 falsos «sí»). Con requisitos tan gruesos (1,7 por caso), cualquier llamada de aspecto relacionado «cubre» el requisito: copiar cubre mover, el informe de red cubre la hora.
- **Variantes de prompt:** 29 variantes (2 manuales y 26 generadas por el modo automático, más `prod`) sobre 135 casos: de 112 a 119 aciertos contra 116 de `prod`; `d5_v04` (la regla de condicionales) baja a 82. Las generadas no se pueden cargar hoy tal cual (el eval las rechaza por incompletas): se midieron envueltas en modo `structure`.
- Los pedidos **condicionales** y **copiar por mover** siguen como en [d3-2b.md](./d3-2b.md).

## 3. D4: juzga por parecido de palabras, y sin el pedido no ve lo que el paso perdió

- **Una URL opaca se rechaza y una con el nombre se aprueba.** En la traza «busca y abrí en el navegador la página de Lost en IMDb» el paso quedó como «abrir la página de Lost en el navegador» (la lista de pendientes perdió «en IMDb»):

  | Llamada | `cumple` sin el pedido | con el pedido a la vista |
  |---|---|---|
  | `imdb.com/title/tt0411008/` (la correcta) | 0,45, se rechaza | 0,96, se aprueba |
  | `justwatch.com/us/tv-show/lost` (la incorrecta) | 0,98, se aprueba | 0,17, se rechaza |

  La verificación nunca recibe la solicitud: `VerifyDecisionInput.request` existe en el contrato pero `verifyInput` no la llena y `buildResultVerification` no la usa. Caso único, **no medido en los datasets**.
- **Rechaza lecturas correctas.** En 47 estados reales etiquetados a mano, `prod` (corte 0,6) rechaza 14 de 34 resultados correctos; la IP local de la PC da 0,43 y 0,45 aunque el resultado trae el IPv4.
- **Cortes.** Lecturas (236 casos y los 47 estados), con corte para lecturas distinto del de escrituras:

  | Corte de lecturas | Falsos «sí» | Falsos «no» |
  |---|---|---|
  | 0,60 | 42 | 20 |
  | 0,50 | 48 | 16 |
  | 0,40 | 55 | 12 |
  | 0,35 | 56 | 3 |

  Lo que se evita está casi todo en los 47 estados reales; en las trazas reales nuevas los falsos «no» no cambian hasta 0,35 y en los sintéticos los falsos «sí» pasan de 9 a 16 con 0,4 (lecturas de otra carpeta, de otro archivo, listas sin lo pedido).
- **Formatos y combinaciones** (`has`, `noul` invertida, `score`, `choice` y sus medias): no hay una que gane en los tres conjuntos. La media de `cumple` y `choice` con corte 0,6 no empeora ninguno (reales 78,7 % contra 63,8 %), pero no arregla la IP. El cruce según la banda de probabilidad (rescatar con una segunda pregunta si `cumple` está entre 0,35 y 0,6) mejora los 47 estados con que se eligieron los parámetros (14 → 5 falsos «no») y **no se repite** en trazas reales ni sintéticos.
- **Quitar ruido del estado** (el id de la llamada, la ruta, `read ok`, el encabezado de ejecución del comando) **empeora**: `prod` baja de 63,8 % a 51,1 % en los estados reales. Lo contrario de la lista de pendientes, donde sí ayudó.
- **Una regla por sección de `system_info`** no sirve: hay negativos con la sección correcta y sin lo pedido (el puerto 3000 que no figura, la unidad F: que no existe).
- **Variantes** (28 sobre 137 casos): `prod` 117, `result_verification_v02` 115, `v04` 106 y las generadas entre 68 y 115.
- **`web_search` con `status: found` no pasa por el modelo**: el código responde `cumple` y `ok` (`codeAnswersCumple`). Una búsqueda `found` con resultados irrelevantes se aprueba siempre; por eso esos casos no pueden estar en los datasets de D4.

## 4. D1: depende de la descripción de la ruta y de lo que ve alrededor

- Con las descripciones anteriores de `terminal` y `system`, el paso «Verificar si hay virus o malware en la PC» iba a `system` con 54 a 64 % cuando el estado traía lecturas previas, y a `terminal` con 84 % sin ellas. Las descripciones nuevas (`terminal`: consultas a medida, virus, hora de inicio de procesos, listas filtradas; `system`: informes rápidos y acciones) subieron `route_1` de 17 a 23 de 40, `route_hard_1` de 7 a 14 de 23 y dejaron los holdouts entre 95 y 100 %.

## 5. Lo que sí ayudó

| Cambio | Efecto medido |
|---|---|
| Vista de `pending`, D5 y `recovery` con DONE por pasos (instrucción, herramienta, resultado), sin ids ni encabezado de ejecución, y fallos con su razón | D5 en difíciles de 28 a 45 de 104 (+17), holdout 211 → 207 (−4); recovery y pending sin cambio |
| Pasos que escriben con todas las lecturas a la vista | El dato de pasajes aparece 8 de 8 veces (antes 0 de 8) |
| Cobertura de la lista ≥ 0,99, ítems cumplidos y ningún paso fallido: cerrar sin D5 | 7 de 8 tareas reales cerraron bien; ver `CORE_FLOW.md` |
| **Modelo `d3:4b-text`** con el mismo prompt | D5 81,8 % → 88,2 % (368 → 397 de 450); D4 78,1 % → 87,5 % (374 → 419 de 479) |

Detalle del `d3:4b-text`:

| Conjunto | D5 2B | D5 4B | D4 2B | D4 4B |
|---|---|---|---|---|
| Difíciles viejos | 45/104 | 77/104 | 41/124 | 85/124 |
| Holdout viejos (fáciles) | 207/211 | 202/211 | 217/218 | 208/218 |
| Trazas reales | 6/11 | 6/11 | 16/22 | 19/22 |
| Sintéticos | 110/124 | 112/124 | 100/115 | 107/115 |

Cuesta algunos casos fáciles (−5 en D5, −9 en D4) y la latencia mediana pasa de unos 75 ms a unos 180 ms (2,4 veces). Hay que comprobar que quepa en memoria junto al generativo y que `decisionMaxContext` coincida con el contexto cargado.

## Qué no es concluyente

- Los 47 estados reales se etiquetaron a mano y casi todos son de una sola tarea (revisar la PC); «procesos viejos» admite más de una lectura.
- Las trazas reales dan pocos casos (22 y 11) porque 21 de las 26 trazas eran el mismo pedido.
- Los sintéticos los escribió una persona y resultaron más fáciles que las trazas reales (`prod` 85 a 92 % contra 50 a 80 %).
- Lo de la solicitud en D4 se probó con una sola traza y falta medirlo en `result_verification_*` (los casos con `at.lastItem` ya traen el pedido).
- Las variantes generadas por el modo automático se produjeron contra un `prod` y datasets anteriores.

## Qué sigue sin resolver

- D4 no sabe qué página, archivo o carpeta pidió el usuario si el paso la perdió: probar darle la solicitud.
- Un corte más bajo para lecturas es una decisión de producto (aceptar más lecturas equivocadas a cambio de menos rechazos), no una mejora medida.
- Para D5 y D4, esperar o adoptar un modelo mayor es lo que más mueve resultados; los datasets de este documento sirven para medirlo.
