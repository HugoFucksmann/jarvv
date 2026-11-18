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
Con opciones **cercanas** (p. ej. `rewrite_item` vs `replan`, `skip_continue` vs `close`) el modelo se confunde; con opciones bien separadas acierta. Al diseñar una pregunta: criterios que difieran en **una señal observable** (un dato presente en el estado), no en matices.

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
- En `recovery`: falso `skip_continue` (ejecuta ítems que dependían del fallido) y falso `close` (corta algo arreglable); en `independent`, el falso «independiente» es el caro.
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
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --variant=prod,recovery_neutral_labels
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
- **Más texto en el prompt para que «entienda mejor»**: el 2B responde mejor a menos texto y rótulos. Ver 2.2.

### Límites conocidos que los prompts no arreglan
D1 falla casi siempre en «hacé ping a google.com» (la palabra de dominio lo manda a `web`) y cuando el verbo de archivo (crear, mover) pesa más que «en la terminal»; D4/D5 aprueban «copiar» donde se pidió «mover» (0,97–0,99) y rechazan pedidos condicionales completos (0,09–0,19). Eso se arregla con **código** (pre-chequeos, tablas), no con prompts. Ver [`docs/evaluacion/limitaciones/d3-2b.md`].

---

## 5. Estado de la etapa `recovery` (la que se está probando ahora)

Consulta de Decisión **tras un paso fallido**: qué hacer con el ítem (`close`, `skip_continue`, `rewrite_item`, `replan`) y si los ítems de atrás son independientes (`independent`). **No existe en el motor**: se evalúa primero; el diseño y el despliegue en «modo sombra» están en `docs/pendientes/PENDIENTES_CODIGO.md` §9.1, punto 6.

- Etapa: `eval/core/stages/recovery.ts`. Prompt base (`prod`): `DECISION_PROMPTS.buildRecovery` en `src/core/models/prompts.ts`. Dataset semilla (30 casos) y **regla de etiquetado**: `eval/datasets/recovery/README.md`. Plantilla de variante: `eval/variants/recovery/recovery_neutral_labels.ts`.
- **Primera lectura (n = 30, indicativa, un solo prompt):** `action` 17/29 (58,6 %): `replan` 5/5, `rewrite_item` 8/11, `skip_continue` 2/7, `close` 3/7. `independent` 12/17 (0 falsos «independiente», 5 falsos «dependiente», el lado seguro).
- **Patrón a atacar:** con dos intentos fallidos el modelo sigue eligiendo `rewrite_item` (3 de los 5 `skip_continue` fallidos tenían `attempts = 2`). Hipótesis a probar: que la causa y el número de intentos pesen más (rótulo claro en el estado, criterio de `rewrite_item` que cite «primer intento»), separar `independent` o `skip_continue` en su propia consulta, y quitar el rótulo heredado de `pending` («REPLACE IN PENDING»), que empuja a reescribir.
- Recordar 2.3: `skip_continue` y `close` son opciones parecidas; la diferencia observable es **si hay ítems detrás que dependan**. Ese dato tiene que estar a la vista en el estado, no deducirse.
- Las etiquetas son una **regla de trabajo para ser consistentes**, no una verdad: los casos que no encajan van `isRaw: true` con tag `borderline`. Revisarlas con una persona antes de concluir sobre el modelo.

---

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
