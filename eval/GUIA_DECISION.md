# Guía del modelo de Decisión (D) para quien trabaja en `eval/`

Leer **antes** de tocar un prompt, una variante o un dataset de una etapa de decisión. Es una entrada corta: lo que ya se sabe, lo que no vale la pena probar y cómo medir sin engañarse. El detalle histórico está en los documentos enlazados al final; si algo de acá lo contradice una medición nueva y bien hecha, actualizar esta guía.

Etapas de decisión del eval: `d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery` (y `plan`/`pending`/`question`/`final` son del generativo, no de este modelo).

---

## 1. Qué es D

D (`d3:2b-text` en Ollama, endpoint `/v1/systemone`) **no razona ni genera texto**: recibe preguntas y devuelve **probabilidades por opción**. El **código** de Jarvis lee esas probabilidades y toma la decisión (umbrales, combinaciones, mapeo a un resultado). El rendimiento depende de **qué preguntas se le hacen** y de **cómo se combinan** sus respuestas.

Entrada (`DecisionInput`):
- `state`: texto de contexto (qué se pidió, el paso, el resultado, los errores…).
- `questions`: diccionario de preguntas.

Salida: probabilidades por opción de cada pregunta.

Tipos de pregunta:
- `noul`: verdadero/falso, con criterios para `true` y para `false`.
- `choice`: multiopción, con criterios por cada clave.

### Cómo combinar preguntas (la palanca principal)

Una decisión no tiene por qué salir de una sola pregunta. Se pueden hacer varias en el mismo request y combinarlas **en código**:

| Patrón | Ejemplo |
|---|---|
| Varias `noul`, todas deben dar `true` (AND) | `valid` y `has_info` ambas altas |
| Una `noul` invertida como alarma (`true` = hay problema) | se pasa si da bajo |
| Un `choice` solo | gana la opción de mayor probabilidad |
| `choice` + `noul` cruzados | el `choice` dice «approved» 0,8 pero la `noul` de alcance da 0,3 → no pasa |
| Umbral propio por pregunta | no tiene que ser 0,5 |
| Mapeo a salida según qué pregunta falla | falla A → `args_invalid`; falla B → `info_missing` |

### Principios de redacción de preguntas

- **Una pregunta mide un solo eje.** Si hay una «y» que mezcla dos condiciones, se separa en dos.
- Si una pregunta no cubre todos los casos, usar 2 o 3.
- **Criterios concretos** (qué se ve en la entrada cuando es `true` / `false`), nunca vagos («correcto», «bien»).
- En preguntas invertidas, decir explícito que `true` = problema.
- Los umbrales se calibran con casos reales, no a ojo.

---

## 2. Reglas del terreno (verificadas en este repo)

### 2.1 Determinismo: no repetir corridas
D trabaja con **temperatura 0**. Si ningún carácter de la entrada cambia, la salida es idéntica. Consecuencias:
- `--repeat=N` con N > 1 **no aporta nada** en etapas de decisión (la diferencia medida entre repeticiones es 0,000; las pequeñas diferencias entre corridas, ±1–2 casos, vienen de cambios de contexto o de carga, no de azar de muestreo).
- El motor memoiza (`memoizeDecision`, por tarea): la misma consulta repetida no vuelve a ir al modelo. Un prompt que da una respuesta mala la dará mala **siempre** con ese texto.
- Lo único que cambia resultados: el **texto** (prompt/estado) o el **dataset**.

### 2.2 El modelo casi no lee
- D es un modelo de 2B: **reacciona poco a textos largos**. Prompts cortos y rótulos claros ganan. Ejemplo medido: `args_review_compact` (solo objetivo, pedido y llamada candidata) 72,9 % contra `prod` 62,5 %, y además más rápido.
- **Los nombres de las claves no importan**: cambiar `ok` por `step_accomplished` dio resultados idénticos (cambio medio de probabilidad 0,0005). No gastar variantes en renombrar claves; lo que pesa es el texto de `instructions` y `criteria`.
- Lo que el modelo ve en la entrada pesa más que lo que se le explica: **sigue un `Expected` malo** (con `done_when` mal escritos a propósito acierta 3/18; sin ellos 18/18). Todo lo que se le pone en `state` lo toma como verdad.
- **Palabras sueltas del paso mueven la respuesta** («Mover» con `Copy-Item` → 0,08; «Pasar»/«Trasladar» → 0,95–0,98). Un cambio de redacción mueve casos ajenos: validar siempre contra todo el dataset, no solo contra el caso que se quería arreglar.

### 2.3 Opciones parecidas = el 2B elige peor
Con opciones **cercanas** (p. ej. `rewrite_item` vs `replan`) el modelo se confunde; con opciones bien separadas acierta. Al diseñar una pregunta: criterios que difieran en **una señal observable** (un dato presente en el estado), no en matices.

### 2.4 Las probabilidades no están calibradas
Un 0,9 no significa «90 % de acierto». En `recovery` la probabilidad de la acción elegida fue media 0,61 en aciertos contra 0,58 en errores: **no separa**. No usar la probabilidad como medida de confianza sin medirla antes en el dataset (curva acierto vs. umbral). Los umbrales de producción se calibraron por etapa:

| Umbral | Valor | Dónde |
|---|---|---|
| `NOUL_APPROVE` | 0,6 | `engine/verify.ts` (verificación, cada `noul`) |
| `REVIEW_APPROVE` | 0,6 | `engine/verify.ts` (revisión de argumentos) |
| `BUDGET.sensitiveApprove` | 0,65 | `budget.ts` (revisión estricta de acciones sensibles) |
| `COMPLETION_APPROVE` | 0,75 | `engine/completion.ts` (cierre de tarea reactiva, D5) |
| `CONTINUATION_APPROVE` | 0,3 | `engine/thread.ts` |
| `JUDGE_FOUND` | 0,6 | `tools/web/webSearchProvider.ts` |

(Leerlos del código antes de citarlos: pueden haber cambiado.)

### 2.5 Tamaño de contexto
El modelo de producción se carga con `num_ctx` 16384 (`d3:2b-text`, ver `docs/operacion/OLLAMA_MODELOS_TEXTO.md`). Si en una máquina Ollama lo carga con 4096 u 8192 por defecto, un `state` largo se **trunca en silencio** y los resultados cambian sin avisar. Si una corrida da números raros, comprobar el contexto cargado antes de culpar al prompt. Los resultados de laboratorio solo son comparables entre sí con el mismo modelo y el mismo contexto.

### 2.6 Qué cuesta cada error
En decisiones **no todos los errores valen igual**; siempre reportar por separado:
- En aprobaciones (`args_review`, `result_verification`, `d5`): **falsos aprobados** (pasa algo malo) vs **falsos rechazos** (se bloquea algo bueno, el usuario lo paga con una tarea que no avanza).
- En `recovery`: falso `close` (corta algo arreglable) y falso reintento (insiste en algo que ya se sabe que no tiene arreglo).
Un porcentaje global alto puede esconder un error caro.

---

## 3. Cómo medir bien

1. **Primero el oráculo**: `--client=oracle` debe dar 100 % sobre un dataset nuevo (valida casos y graders). **Solo vale con `prod`**: con variantes da error de configuración. Una variante se valida con `--client=mock --dry-run` (muestra el prompt que se enviaría) y luego con el modelo real.
2. **Una variable por variante.** El nombre y el comentario de cabecera dicen la hipótesis y el dataset que la mide. Componer (`a+b`) solo después de medir cada una.
3. **Reportar caso por caso**: qué casos mejoran y cuáles regresan, no solo el porcentaje; falsos aprobados/rechazados; qué dataset se usó para ajustar y cuál para validar.
4. **No ajustar y validar en el mismo dataset.** Una diferencia de 1–3 casos está dentro del ruido; con n < 50, +3 puntos no es significativo (usar comparación pareada, McNemar, antes de afirmar que una variante gana).
5. **Cuidado con los datasets chicos.** `recovery` tiene 30 casos: sirve para ver qué pasa, **no para decidir**. Ampliar con casos reales antes de adoptar un prompt.
6. **No tocar `src/`** desde una variante. Una variante vive en `eval/variants/<etapa>/` y reemplaza **builders enteros** de `DECISION_PROMPTS`/`PROMPTS` (se fusionan con `effectivePrompts`). Si el cambio necesita código, anotarlo como **(requiere código)** y probarlo simulándolo en el dataset.
7. Los datasets generados (`reales_*`, `mut_*`, `old_*`, `fail_*`, `ram_*`) se regeneran con `eval/gen/*.ts`: no se editan a mano.

### Comandos

```powershell
npm run eval -- --client=oracle --dataset=eval/datasets/recovery --stages=recovery
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --variant=prod,recovery_three_options_nobehind
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --ids=rec-rp-02 --dry-run --client=mock
```

- La carpeta del dataset se pasa **completa**: `--dataset=eval/datasets/<carpeta>` (`--dataset=recovery` no se resuelve).
- Los resultados van a `eval/results/` (ignorado por git).
- Una corrida mide una variante contra `prod` en los mismos casos: incluir siempre `prod` en `--variant`.

---

## 4. Lo que no funcionó (verificado)

Cada punto tiene su evidencia en el documento enlazado. **No volver a probarlo sin una hipótesis nueva.**

- **Repetir corridas (`--repeat`) con D**: no mide nada (temperatura 0). Ver 2.1.
- **Cambiar nombres de claves** de las preguntas: sin efecto (D4: 131/172 en las cuatro redacciones). Ver 2.2.
- **`tool_fit` como pregunta de D3**: da 0,06–0,07 a comandos correctos; juzga el contenido del comando, no el tipo de herramienta (causa de falsos `tool_rejected`). [`CONCLUSIONES_HISTORICAS` §2.1]
- **Preguntas binarias de D3 con regla en código como reemplazo de la pregunta única** (`args_grounded`, `needs_user`, con/sin `criteria`, AND/promedio/«cualquiera»): bajan los falsos rechazos (19 % → 0–3 %) pero dejan pasar 64–89 % de las malas. Ninguna gana a `prod` en D3 solo. [§2.2]
- **Votación por mayoría 2 de 3** para verificar: no aporta; el AND estricto da lo mismo. [§2.3]
- **«Reescribilo desde cero, no copies el anterior»** en la razón del rechazo: empeora (55 % → 20 % de comandos válidos). [§2.4]
- **Subir la temperatura del reintento** (generativo, `pending`, 0,2 y 0,3): sin ganancia; el fallo que busca arreglar no ocurre. [§2.4b]
- **Una `noul` por herramienta en D2**: empeora (20/22) y es 3 veces más lenta. **La opción `none`** («ninguna herramienta sirve») no es confiable: falsos `none` en casos válidos; el umbral no la separa. [`limitaciones/d3-2b`]
- **Una `noul` por ruta en D1** en lugar de un `choice`: 4 preguntas y 229 ms contra 80 ms, y `locate` cae a 4/6. [`limitaciones/d3-2b`]
- **Preguntas detalladas en D5**: una pregunta mínima ganó (2 falsos «sí» contra 5 con la detallada). [`limitaciones/d3-2b`]
- **Aplicar una regla a todos los pasos** («A copy is not a move.» en todos): sube `cumple` en casos ajenos (−3 de 164). Hay que condicionarla (solo pasos de mover/renombrar). [`limitaciones/d3-2b`]
- **Fiarse de la probabilidad** como confianza (recovery): no separa aciertos de errores. Ver 2.4.
- *(Los puntos de `recovery` de abajo se midieron con la versión de cuatro opciones; las variantes están en `eval/variants/_archivo_recovery_4_opciones/`.)*
- **Rótulo neutro `FAILED CALLS` sin `independent` en `recovery` (`recovery_neutral_labels`)**: baja de 58,6 % a 55,2 % (-3,4 %, 2 regresiones `rec-rw-05`, `rec-rw-10` y 1 mejora `rec-cl-05`). Quitar el contexto de reemplazo sesga negativamente las decisiones de reintento.
- **Redefinir `replan` como prerrequisito faltante en `recovery` (`recovery_replan_prereq`)**: cae bruscamente a 41,4 % (-17,2 %, 5 regresiones graves en `rec-rw-05`, `rec-rw-07`, `rec-rp-01`, `rec-cl-02`, `rec-cl-07`). El 2B confunde "prerequisite" y manda a replan casos de cierre o de reescritura.
- **Eliminar `PENDING_VIEW` para dejar solo estado ultra-compacto en `recovery` (`recovery_compact_state`)**: colapsa `replan` a 0/16 aciertos en los dos datasets (18 regresiones vs prod), perdiendo completamente la capacidad de detectar necesidad de replanificar por falta del historial de llamadas previas.
- **Reglas negativas en la instrucción de recovery ("If attempts >= 2 do NOT choose rewrite_item") (`recovery_attempt_constraint` / `recovery_precise_attempts`)**: empeoran el passRate general frente a prod (-3,3 % y -4,9 %, con 20 y 19 regresiones). El 2B atiende a la mención del token ("rewrite_item") o se confunde con la negación lógica compleja, colapsando el recall de `close` (a 0-8 %) y disparando falsos `rewrite_item`.
- **Simplificación extrema en una frase por opción (`recovery_concise_rules`)**: cae a 38,5 % (-4,9 % vs prod), disparando falsos replan (19 falsos en recovery3) al quedar el criterio de replan demasiado laxo ("an essential prerequisite step is missing or wrong").
- **Intentar forzar routing por intento en la instrucción de action (`recovery_attempt_routed`)**: rinde 62,3 % global (+16,4 %), pero genera 9 falsos `skip_continue` y 17 regresiones vs prod. La instrucción condicional larga sobrecarga la atención del 2B frente a criterios independientes claros.
- **Ampliar palabras clave de prerrequisito en replan (`recovery_synthesis_prereq_boost` y `recovery_boundary_balance`)**: baja el passRate a 61,5 % y 59,0 % (perdiendo 5 y 9 puntos frente al 66,4 % de `recovery_calibrated_synthesis`). Introducir términos de servicios, paquetes o múltiples ejemplos induce falsos `close` o canibaliza `rewrite_item`.
- **Más texto en el prompt para que «entienda mejor»**: el 2B responde mejor a menos texto y rótulos. Ver 2.2.

### Límites conocidos que los prompts no arreglan
D1 falla casi siempre en «hacé ping a google.com» (la palabra de dominio lo manda a `web`) y cuando el verbo de archivo (crear, mover) pesa más que «en la terminal»; D4/D5 aprueban «copiar» donde se pidió «mover» (0,97–0,99) y rechazan pedidos condicionales completos (0,09–0,19). Eso se arregla con **código** (pre-chequeos, tablas), no con prompts. Ver [`docs/evaluacion/limitaciones/d3-2b.md`].

---

## 5. Estado de la etapa `recovery` (la que se está probando ahora)

Consulta de Decisión **tras un paso fallido**: qué hacer con el ítem (`close`, `rewrite_item` o `replan`; sin `skip_continue`). **En el motor corre solo en modo sombra** (ver «Modo sombra» abajo): registra qué haría y no actúa; el diseño y el despliegue están en `docs/pendientes/PENDIENTES_CODIGO.md` §9.1, punto 6.

- Etapa: `eval/core/stages/recovery.ts`. Prompt de producción (`prod`): `DECISION_PROMPTS.buildRecovery` en `src/core/models/prompts.ts` (es `recovery_three_options_nobehind`). Datasets y regla de etiquetado: `eval/datasets/recovery/README.md`. Plantilla de variante: `eval/variants/recovery/recovery_three_options.ts`.
- **Con el prompt de producción actual** sobre los 240 casos de `eval/datasets/recovery/` (los 7 datasets, `skip_continue` reetiquetado a `close`): 78 % (186/240); `rewrite_item` 91 %, `replan` 52 %, `close` 81 %. Es el mismo número que `recovery_three_options_nobehind`.
- **Dónde se pierde:** `replan` (lo cubren las reglas de `recoveryRules.ts`) y los `close` que el modelo manda a reintentar. Las reglas delante del modelo suben el acierto a ~95 % en `n1`–`n4` (ver arriba), con la salvedad de la circularidad.
- Recordar 2.3: `rewrite_item` y `replan` son opciones parecidas: es lo que más confunde el 2B y lo que cubren las reglas.
- Las etiquetas son una **regla de trabajo para ser consistentes**, no una verdad: los casos que no encajan van `isRaw: true` con tag `borderline`. Revisarlas con una persona antes de concluir sobre el modelo.

---

### Modo sombra (conectado al motor, 2026-11-18)

`recovery` ya corre en el motor **sin actuar** (`src/core/engine/recoveryShadow.ts`, llamado desde `runTask.ts` justo antes de `list.failHead(...)`; config `recoveryShadow`, **encendida por defecto**; `false` la apaga). Tras cada paso fallido del reactivo calcula `recoveryRule` (las reglas) y, solo si no deciden, consulta a Decisión (`chooseRecovery`, el prompt de producción), y registra **un evento `llm` de etapa `recovery`** en la traza. No cambia la lista, los contadores, el contexto ni el cierre; nunca lanza; no pausa si Decisión no responde (registra el error). Lo cubren 4 tests en `tests/engine.test.ts`, incluido «la tarea hace exactamente lo mismo con y sin sombra».

El `output` del evento es un JSON: `{ cause, attempts, callsInStep, rule, ruleIfCalls, model, final, source, modelRawOutput }`. **Ojo con `attempts`:** son los pasos fallidos seguidos (lo que dice el prompt: «Attempts so far»), no las llamadas. Un paso solo falla tras 2 o 3 errores de la herramienta, así que `callsInStep` casi siempre es ≥ 2 y los datasets del eval (donde `attempts` cuenta llamadas) y producción **no significan lo mismo**; por eso se registra también `ruleIfCalls` (lo que habrían decidido las reglas contando llamadas). Qué mirar con trazas reales: (1) `final` contra lo que pasó después (¿el siguiente `pending` reescribió el ítem, replanificó, o cerró?); (2) con qué frecuencia deciden las reglas (`source: "rule"`) y si alguna vez se equivocaron; (3) cuál de las dos lecturas de `attempts` coincide mejor con lo que pasó; (4) si el modelo tiende a `close` por la lectura de «1 attempt» (sesgo posible por la diferencia de significado). Hasta tener esas trazas, no activar nada.

### Lo que se midió después (2026-11-18, 7 rondas, `recovery` sin `skip_continue`)

Decisión de diseño: **se quitó `skip_continue` (y `independent`)**. Un ítem existe porque el pedido lo necesita; si no se puede hacer, cerrar es lo honesto y lo seguro, y los casos `skip_continue` de los primeros datasets eran armados (un fallo y un ítem de atrás sin relación). Con datasets sin `skip`, la pregunta de 3 opciones (`rewrite_item`, `replan`, `close`) le gana a la de 4 opciones (82 % contra 78 % en dev; 69 % contra 59 % en holdout). Nombre de la opción de parar (`close` o `skip_continue`) y `rewrite_current_item`: sin efecto.

Datasets de esta ronda (escritos a mano, ya en `eval/datasets/recovery/`): `recovery_n1` y `recovery_n2` (55 casos) y `recovery_n3` (36) fueron el conjunto de ajuste (91); `recovery_n4` (30) fue el holdout y se midió una sola vez. **Ya no es un holdout limpio**: para seguir probando, escribir un dataset nuevo y reservarlo. Tres casos «carpeta con contenido» (`Remove-Item` sin `-Recurse`) se marcaron `isRaw`/`borderline` porque son arreglables con un argumento y la etiqueta `replan` es discutible.

| Qué se probó | Resultado (acierto en 3 acciones) |
|---|---|
| `prod` | 45–46 % |
| Pregunta única de 3 opciones, criterios cortos (`recovery_three_options`) | 83–85 % dev, 69 % holdout |
| Igual, sin la línea «Items after it» y con «application does not exist, tests fail» en `close` (`recovery_three_options_nobehind`) | **87 % dev, 79 % holdout** |
| Dos `noul` (bloqueado, falta algo) combinadas en código (`recovery_two_axes`) | 84 % dev, **83 % holdout** (más falsos `close`: 4 y 2) |
| Criterios con ejemplos (`recovery_three_options_examples`) | 80 % dev, 79 % holdout; sube `replan` (90 %) y baja `rewrite_item` (65 %) |

No sirvieron (no volver a probar sin hipótesis nueva): vista «enfocada» (sin lista de pendientes) en lugar de la completa (−3 puntos); instrucción en forma de árbol de decisión («primero close, luego replan…»: sobre-cierra, 15 falsos `close`); clasificar el tipo de fallo en lugar de elegir acción (`replan` cae a 30 %); cascada «¿cerrar o editar?» y luego «¿ítem o replan?» (la primera pregunta corta de más: 11–22 falsos `close`); tres `noul` independientes con `argmax` (74 %); poner el error dentro de la instrucción (78 %); regla de intentos escrita como número («Attempts so far: 1», 81 %); combinar la pregunta de 3 opciones con los ejes (la regla «prereq≥0,5 convierte rewrite en replan» dio 85 % en dev pero 80 % y 78 % con otras redacciones del eje: es inestable).

Lectura honesta: en dev la mejor y la peor de las 3 opciones difieren en 2–3 casos (dentro del ruido: la misma variante da 83–85 % en corridas distintas por la concurrencia), y el holdout tiene 29 casos. Lo que sí es sólido: **cualquiera de estas supera a `prod` por 25–40 puntos**, y el techo de la 2B con prompts ronda el 85 %. El cuello es `replan` (57–70 %): distinguir «falta algo» de «error de tipeo» exige mirar el listado previo, y el 2B no lo hace de forma fiable. Eso es trabajo para una regla de código (códigos de error como `ENOENT`/`EADDRINUSE`, comando no reconocido), no para más prompt.

### Regla de código delante del modelo (`missingPrerequisite`, 2026-11-18)

`src/core/engine/recoveryRules.ts` (función pura, **sin conectar al motor**, con tests en `tests/recovery_rules.test.ts`) reconoce cuándo el error dice sin ambigüedad que **falta un prerrequisito** y devuelve `replan` sin consultar al modelo: puerto ocupado (`EADDRINUSE`), formato no soportado (`Unsupported … format/type`), programa no reconocido (si no parece un cmdlet mal escrito), `Could not find a part of the path` y `ENOENT` al **escribir**. Un `ENOENT` al **leer** no basta (puede ser un tipeo o el archivo en otro lugar): lo deja al modelo.

Medido sobre `recovery_n1` a `recovery_n4` (118 casos canónicos, `eval/results/`, análisis con las respuestas guardadas):

| | Acierto en 3 acciones |
|---|---|
| La regla sola | dispara en 24 casos, **24 correctos y 0 falsos positivos**; ve 24 de 28 `replan` (no ve los 4 de «el archivo está en otra carpeta») |
| Modelo solo: `recovery_three_options_nobehind` | 83 % (98/118) |
| Regla + `recovery_three_options_nobehind` | **89 % (105/118)** |
| Regla + `recovery_rewrite_or_close` (el modelo solo elige `rewrite_item` o `close`) | **89 % (105/118)**; `rewrite_item` 95 %, `replan` 86 %, `close` 86 % |
| `prod` + regla | 54 % |

Conclusión: la regla resuelve el punto débil (`replan` pasa de 57–70 % a 86 %) y deja al modelo la parte donde acierta (reintentar o cerrar). Con la regla delante, el prompt de dos opciones rinde igual que el de tres y es más simple.

Cautelas: los mensajes de error de los datasets los escribí yo a partir de formatos reales (PowerShell, Node, `EADDRINUSE`), pero conocía las familias de la regla, así que **el 0 de falsos positivos es optimista** hasta probarlo con trazas reales; los mensajes de las herramientas de archivos no son uniformes. Lo que queda mal (13 casos): los 4 de «archivo en otra carpeta», 5 `close` que el modelo manda a reintentar (aplicación de escritorio que no existe, tests que fallan, timeout, acción denegada con ítems detrás), y 2 `rewrite_item` que manda a cerrar. Siguientes reglas posibles: `close` por señales duras (permiso denegado, red inalcanzable, disco lleno) y «el archivo no está donde se buscó» usando el listado previo de la tarea (necesita el contexto, no solo el error). Etiquetado a tener presente: un programa de desarrollo que falta (`node`, `pip`, `git`) se etiquetó `replan` (se puede instalar), una aplicación de escritorio que falta (Photoshop, Word) se etiquetó `close`; es un criterio, no una verdad.

#### Reglas de parada (`close`) y precisión medida con datos que no escribí

`recoveryRules.ts` suma `hardStop` y `recoveryRule` (el punto de entrada: causa de rechazo → `close`; prerrequisito → `replan`; parada dura → `close`; si no, `null` = preguntarle al modelo). Paradas duras: causa `user_rejected` / `denied` / `repeat_blocked` (desde el primer intento); permiso denegado y tests o compilación que fallan (desde el primero); red o servicio caído (incluye 401/403/429/5xx y timeouts), disco lleno, archivo corrupto o bloqueado, y `Start-Process <aplicación>` que no existe, **solo con 2 o más intentos** (un fallo puede ser transitorio); «sin datos» solo desde el tercero. Un prerrequisito que sigue faltando al tercer intento ya no se replanifica. 14 tests en `tests/recovery_rules.test.ts`; sigue **sin conectar al motor**.

| | Resultado |
|---|---|
| Sobre `recovery_n1` a `recovery_n4` (118) | reglas: 73 casos, 73 correctos, 0 falsos positivos; reglas + `recovery_three_options` **96 %** (113/118), + `recovery_three_options_nobehind` **95 %**, + `recovery_rewrite_or_close` **95 %**, + `prod` 90 % |
| Sobre los 122 casos que **no** escribí (`recovery_casos`, `recovery2`, `recovery3`; `skip_continue` cuenta como `close`) | primera pasada: disparan en 38, 35 correctos, **3 falsos positivos**; cobertura `replan` 13/26, `close` 22/61, `rewrite_item` 2/35 (los dos son falsos positivos) |

**Leer con cuidado:** la cobertura de 100 % en `close` sobre `n1`–`n4` es **circular** (esos casos los escribí sabiendo qué familias reconoce la regla). El dato honesto es el segundo: sobre datos ajenos las reglas cubren cerca del 40 % de los `close` y la mitad de los `replan`, con ~92 % de precisión en la primera pasada. Los 3 falsos positivos eran casos que parecen un prerrequisito pero se arreglan reescribiendo y se corrigieron: `grep` no existe en PowerShell (`Select-String`; lista `UNIX_ONLY`), un `ENOENT` cuyo mensaje dice «Pass recursive: true» (se corrige el argumento), y una aplicación inexistente al tercer intento. **Esos tres datasets ya no son una validación independiente de las reglas ajustadas**; la medición honesta de precisión necesita trazas reales de Jarvis. La causa de rechazo (`user_rejected`, `denied`) cierra sin discusión, por diseño.

## 6. Checklist antes de dar por buena una variante

- [ ] La hipótesis cabe en una frase y está en la cabecera de la variante.
- [ ] Se validó con `--client=mock --dry-run` (el prompt sale como se esperaba).
- [ ] Se corrió con `prod` en los **mismos** casos (no contra números de otro día).
- [ ] No se usó `--repeat` > 1 (no aporta).
- [ ] Se reportaron mejoras **y regresiones** caso por caso, y los errores caros por separado.
- [ ] Ajuste y validación en datasets distintos; la diferencia supera el ruido (≥ 5–6 casos o prueba pareada).
- [ ] Se comprobó que no cambió un caso ajeno (2.2).
- [ ] Si usa probabilidades como confianza, hay curva acierto-vs-umbral medida (2.4).
- [ ] Lo descartado se anotó en la sección 4 de esta guía con su evidencia.

---

## 7. Dónde está el detalle

| Tema | Documento |
|---|---|
| Conclusiones históricas del eval (qué sirve y qué no, por etapa) | [`CONCLUSIONES_HISTORICAS.md`](./CONCLUSIONES_HISTORICAS.md) |
| Mejores variantes por etapa y rondas de prueba | [`MEJORES_VARIANTES.md`](./MEJORES_VARIANTES.md) |
| Cómo correr el eval, formato de casos, etapas | [`INSTRUCCIONES.md`](./INSTRUCCIONES.md), [`README.md`](./README.md) |
| Límites medidos de `d3:2b` por etapa | [`../docs/evaluacion/limitaciones/d3-2b.md`](../docs/evaluacion/limitaciones/d3-2b.md) |
| Preguntas de decisión del motor | [`../docs/evaluacion/analisis/PREGUNTAS_DECISION.md`](../docs/evaluacion/analisis/PREGUNTAS_DECISION.md), [`FRENTE_3_DECISION.md`](../docs/evaluacion/analisis/FRENTE_3_DECISION.md) |
| Modelos sin proyector de visión, `num_ctx`, `keep_alive` | [`../docs/operacion/OLLAMA_MODELOS_TEXTO.md`](../docs/operacion/OLLAMA_MODELOS_TEXTO.md) |
| Dataset y regla de la etapa `recovery` | [`datasets/recovery/README.md`](./datasets/recovery/README.md) |
