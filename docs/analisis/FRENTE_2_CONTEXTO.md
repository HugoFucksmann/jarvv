# Frente 2 — Contexto: qué recibe cada modelo y cómo mejorarlo

> 2026-11-13. Revisado sobre el código (`ctx/views/`, `render/`, `engine/adapters.ts`, `models/prompts.ts`, `budget.ts`) y sobre los prompts reales guardados en las trazas. Las propuestas marcadas «medido» se probaron en el laboratorio o contra los modelos. Cuando se escribió no se había tocado `src`.
>
> **2026-11-14: implementado en parte.** Mirá «Estado de implementación»; el resto es el análisis y las mediciones originales.

## Estado de implementación (2026-11-14)

Leyenda: ✅ hecho · ⚠ parcial · ⏸ pendiente · ❌ descartado o revertido.

| # | Decisión | Estado | Dónde está |
|---|---|---|---|
| DN-2.1 | Sin `Last result` en D1 y D2 | ✅ | `models/prompts.ts` (`frameLines`) |
| DN-2.2 | Sin `Previous approved calls` en D4 | ✅ (`forVerify` y `verifyInput` lo siguen calculando) | `models/prompts.ts` (`buildResultVerification`) |
| DN-2.3 | Reglas de comando solo si la herramienta tiene `command` | ✅ (corrige el `shell` inválido en `list_directory`) | `models/prompts.ts` (`ARGUMENTS_VIEW.buildSystemPrompt`) |
| DN-2.4 | Solicitud original en argumentos | ✅ línea `REQUEST:` en la vista de argumentos (solo reactivo, salvo que sea igual al paso). Datasets de argumentos del laboratorio, 3 repeticiones: 309/345 → 323/345 (90,3 → 93,6 %), ningún dataset empeoró (21 corridas mejores, 7 peores; medido junto con el cambio del pre-chequeo) | `render/args.ts`, `ctx/views/args.ts` |
| DN-2.5 | `pending` busca ante preguntas de hechos | ⚠ implementada pero **apagada** (`PENDING_FACTS_LOOKUP = false`), esperando autorización. Con D0, esas preguntas ya van a búsqueda por la ruta de una acción | `models/prompts.ts` |
| DN-2.6 | Formato de lo hecho en `pending` y D5 | ❌ cerrada: no mejoraba | — |
| DN-2.7 | Estructura `signals` + `data` + `note` | ⏸ | — |
| DN-2.8 | Secciones por herramienta | ⏸ (la parte de reglas de comando está cubierta por DN-2.3) | — |
| DN-2.9 | Topes al contexto real | ⏸ depende de cómo se arranca Ollama (`OLLAMA_CONTEXT_LENGTH=8192`; `d3` usa 4096) | `jarvis-config.json` |
| DN-2.10 | Idioma y relleno de la respuesta final | ⚠ relleno ✅ por código (`engine/finalClean.ts`, también con efectos). `not_found` de escrituras con texto propio ✅. Idioma ⏸ (lo prueba el usuario) | `engine/finalClean.ts`, `engine/finalize.ts` |

**Medido en esta etapa (2026-11-14)**
- **Relleno «No se realizaron cambios…»:** cambiar la regla del prompt lo bajó de 77 a 10 de 98 respuestas pero también bajó el acierto de `final` (−3, luego −6 y −8 puntos en los datasets gemai, dos corridas). Se descartó (variante `eval/variants/ctx/ctx_final_nofiller.ts`, conservada como evidencia) y se resolvió quitando la frase por código de la respuesta ya generada.
- **Prompt con argumentos bloqueados explícitos (R5):** el generador ya cambia los argumentos 25 de 30 veces con el prompt actual (dataset `args_blocked_repeat`); lo único que repite es un comando que es la respuesta correcta. R5 no hace falta.

## Resumen

El contexto como almacén está bien diseñado: una sola fuente, escritura atómica, todo lo demás derivado. **El problema está en la entrega.** Las vistas se arman según lo que hay en el contexto y no según lo que cada consulta necesita. El mismo resultado de una llamada se reenvía entero a seis consultas distintas, con identificadores internos y datos que solo le sirven al código.

Cambios por impacto:

| # | Cambio | Evidencia | Efecto |
|---|---|---|---|
| 1 | D1 y D2 sin `Last result` | Medido: misma ruta en 7 de 7 consultas reales | Estado de 360 a 26 tokens |
| 2 | D4 sin `Previous approved calls` | Medido en el laboratorio: 3 mejoras, 1 regresión, ningún dataset peor | En un caso real, de 2 009 a 935 tokens |
| 3 | Argumentos: reglas de PowerShell solo si la herramienta recibe un comando | Medido en el laboratorio: 2 mejoras, 0 regresiones | Unos 330 tokens menos por llamada; quita un error inducido (ver F7) |
| 4 | La solicitud original llega a la generación de argumentos | Traza: `Write-Output hola` se ejecutó como `echo hola` | Fidelidad |
| 5 | ~~Lo hecho por ítem cumplido~~ **descartado** | Medido en los 36 casos de cierre: 29 a 30 de 36 contra 31 de 36 del formato actual | No se hace; el ahorro era de 18 tokens |
| 5b | `pending`: excepción para preguntas de hechos cambiantes | Medido: de 0/12 a 11/12 preguntas de hechos abren un paso; charla vacía 8/8. En el laboratorio, 2 casos ajenos regresan (−5,2 en `llm_pending_hard`) y 1 mejora | **Necesita tu decisión** (DN-2.5) |
| 6 | Separar en el resultado los datos, las señales y los avisos | Diseño (F1) | Base de 5, del Frente 3 y de la verificación por código |
| 7 | Topes calculados contra el contexto real | El peor caso de D4 supera los 4 096 tokens reales | Evita el recorte silencioso |

## 1. Qué recibe cada consulta hoy

Tamaño máximo visto en las trazas, en tokens de entrada: `pending` 1 185 · D1 898 · D2 499 · argumentos 1 497 · D4 2 721 · D5 708 · final 1 476.

### `pending` (generativo)
- **Recibe:** reglas, `REQUEST`, lista anterior, `DONE` (una línea por llamada aprobada con `args`, hasta 600 caracteres del resultado y la ruta de la ref), `FAIL`, `USER`.
- **Sobra:** ruta de la ref, ids (`c1 s1`), `read`, `verdict=approved` (todo lo de `DONE` está aprobado).
- **Estorba:**
  - La regla «questions about general knowledge … reply with an empty list». Con ella, «¿Cuándo se estrena Avengers Doomsday?» se respondió dos veces sin buscar. Un 4B no tiene conocimiento fiable.
  - El texto del resultado. En una traza, con las dos búsquedas ya hechas, `pending` volvió a listar los dos ítems cumplidos (los salvó `reconcileList`).
- **Cambio (medido, ver DN-2.5):** agregar una excepción al final de la regla de lista vacía. El formato de `DONE` por ítem se probó y se descartó (§4).

### D1, ruta
- **Recibe:** `Request` (reactivo), `Step`, `Expected`, `Done`, `Last result` (el resultado anterior entero, hasta 2 500 caracteres), `Attempts not approved`, `User input`, `Environment`.
- **Sobra:** `Last result`. Medido: sin él, la ruta es la misma en 7 de 7 consultas reales.
- **Estorba:** la marca `[the last attempt on this route failed]` (Frente 3: 0 de 18 correcciones).
- **Cambio:** quitar `Last result`; en el reintento, quitar la ruta que falló.

### D2, herramienta
- **Recibe:** lo mismo que D1 más `Route`.
- **Cambio:** igual que D1. Opciones en el orden del catálogo (Frente 3, DN-3.7).

### Argumentos (generativo)
- **Recibe:** SYSTEM con las reglas de PowerShell siempre; `TODAY`, `ENV`, `TOOL`, `SCHEMA`, `STATE`, `USER`, `STEPS` o `DONE`, `REFS`, `DATA` (las 3 últimas lecturas completas), `EFFECTS`, `FAIL`, `LAST ERROR`, `TASK`.
- **Falta:** la solicitud original (en reactivo solo ve el ítem que escribió `pending`) y, a futuro, los hechos de memoria (Frente 1).
- **Sobra:**
  - Reglas de PowerShell y línea del sistema operativo para herramientas sin comando: unos 330 tokens en cada `web_search`, `read_file` o `create_directory`.
  - `ENV` para `web_search`.
  - `DATA` de lecturas que el paso no usa: para generar la búsqueda de Gemini recibió el resultado completo de la de GPT (342 tokens).
- **Estorba:**
  - «If the tool has a shell parameter, set it to "powershell"»: en una traza el modelo agregó `shell` a `list_directory`, la salida fue inválida y hubo que reintentar.
  - `FAIL` y `LAST ERROR` muestran dos veces el mismo listado rechazado.
  - `ERROR_PREVIO: …` va en español dentro de un prompt en inglés.
- **Cambio:** propuestas 3 y 4. Cada herramienta declara qué secciones necesita (ver §3).

### D3, revisión
- **Recibe:** `Target`, `User Input`, `Previous Errors`, `Call`, `Args`. Es compacto.
- **Sobra (en código):** ~~`forReview` y `reviewInput` siguen calculando `stepsDone`, `done`, `lastReads`, `env` y el schema, que el prompt ya no usa~~ *(retirado 2026-11-14 — P-14: `ReviewView` y `ReviewDecisionInput` quedaron limitados a `step`, `stepFailures`, `userInput` y `candidate.{route,tool,args}`)*.
- **Cambio:** hecho. Con solo 2 consultas en las trazas no hay datos para más.

### D4, verificación
- **Recibe:** `Step`, `Expected`, `User input`, la llamada evaluada (cabecera con ids, `args` hasta 2 000, resultado hasta 2 500, línea de ref) y `Previous approved calls` (hasta 3 llamadas anteriores completas).
- **Sobra:** `Previous approved calls`. Medido en el laboratorio (190 casos): 3 mejoras y 1 regresión, ningún dataset peor. También la ruta de la ref y los ids.
- **Falta:** la fecha, cuando el paso pide «lo último». D4 aprobó con 0,91 un pasaje de Gemini 2.5 fechado en 2025 como «último modelo» y la respuesta final lo dio por bueno. No medido.
- **Cambio:** propuesta 2. Lo que el código puede comprobar (código de salida, existencia en disco) no debería ser una pregunta al modelo.

### D5, cierre
- **Recibe:** `REQUEST` y `DONE` con el mismo formato que `pending`.
- **Problema:** muy sensible al texto del resultado. Sobre 18 cierres reales, el mismo caso da 0,34 con el resultado entero y 0,93 sin él; otro baja de 0,85 a 0,21 con un recorte de 300 caracteres. La cantidad de cierres aprobados no cambia (12 de 18 en las tres variantes) y los falsos cierres tampoco (2 de 6 al quitar la última llamada).
- **Cambio:** ninguno en el formato. Se midió `DONE` por ítem sobre los 36 casos de `eval/exp/close_check.ts` y no mejora (§4).

### Respuesta final (generativo)
- **Recibe:** `TODAY`, `REQUEST`, estado de la tarea, `STEPS`, `DATA` (3 últimas lecturas completas con cabecera, `args` y línea de ref), `EVIDENCE`, `USER`, `STATE`, `EFFECTS`.
- **Sobra:** ids, cabeceras y rutas de ref: el SYSTEM pide no mencionarlos y a la vez se le entregan. Medido: quitarlos no mejora (1 mejora, 2 regresiones en 47 casos: ruido). Prioridad baja.
- **Estorba:**
  - «Clearly report any changes … or specify that no changes were made» junto con `EFFECTS: none`: produce respuestas que empiezan con «No changes were made to the system» ante una simple pregunta.
  - «in the language of REQUEST»: 5 de 28 respuestas reales salieron en inglés.
- **Cambio:** idioma fijado por código; mencionar los cambios solo cuando los hubo. No medido (el grader del laboratorio no mira el idioma).

### Plan y pregunta al usuario
Sin muestras suficientes en las trazas (2 planes, 0 preguntas). No se auditaron con datos reales.

## 2. Fallas de diseño del contexto

- **F1. `summary` mezcla tres cosas en un solo texto:** los datos, las señales de la herramienta (`exit code`, `pid`, `duration`, `cwd`, «status: partial · 1 passage») y los avisos al modelo («These passages match the keywords…; check that they really answer it»). Ese texto, con tope de 2 500, se reenvía a todos. Consecuencias: la duración y el `pid` vuelven única cada entrada; el aviso de `web_search` llega a D5 y a la respuesta final, que no pueden hacer nada con él; el código no puede leer el código de salida sin parsear texto.
- **F2. Lo hecho se muestra por llamada, no por objetivo.** El contexto ya guarda `steps[].instruction`, que es el ítem de la lista. `forPending` y D5 muestran llamadas con argumentos y resultados, y el modelo tiene que deducir qué ítem cumple cada una.
- **F3. La solicitud se pierde después de `pending`.** En reactivo, D2, D3, D4 y los argumentos solo ven el ítem reescrito. Ya se parchó para D1 con la línea `Request:`.
- **F4. El mismo resultado se reenvía completo a seis consultas** (D1, argumentos, D4, D5, `pending`, final), cada una con su formato.
- **F5. Los topes no salen del contexto real.** Peor caso de D4 con los topes actuales: `evaluatedArgs` 2 000 + `readSummary` 2 500 + 3 llamadas previas de hasta 4 500 + `userInput` 6 000 caracteres: más de 20 000 caracteres, unos 6 000 tokens, contra 4 096 reales del decisor. La guarda compara contra 16 384 y no lo detecta.
- **F6. Identificadores internos en texto para modelos** (`c1 s1`, `verdict=approved`, `read`/`write`, rutas con uuid). A la respuesta final se le pide que no los mencione.
- **F7. Reglas que valen para una herramienta, dichas a todas** (PowerShell, `shell`).
- **F8. Rótulos de `pending` puestos con expresiones regulares** sobre el texto ya renderizado. Lo anota el propio código.
- **F9. Vistas que calculan campos que nadie usa** ~~(`forReview`)~~ *(resuelto 2026-11-14 en `forReview`/`reviewInput` — P-14; sigue abierto en `forVerify`/`verifyInput` y `lastResult` en `frameLines`)*.

## 3. Cómo armarlo

### 3.1 Alternativas

| Alternativa | Idea | A favor | En contra |
|---|---|---|---|
| A. Recortar los topes de `budget.ts` | Mismo diseño, números más chicos | Mínimo esfuerzo | No quita el reenvío ni el ruido; sigue ciego a qué necesita cada consulta |
| B. Que un modelo resuma cada resultado | Un «digest» escrito por el 4B | Texto corto | Otra llamada generativa por resultado y prosa de modelo dentro del contexto (rompe la invariante 2 de `CONTEXT_AND_MEMORY.md`) |
| **C. Ficha de llamada con niveles y matriz por consulta** | El código arma tres niveles de detalle y cada consulta declara cuál recibe | Determinista, sin modelos, se mide por consulta | Cambia renderizadores y adaptadores; pide separar `summary` (F1) |

**Recomendación: C.**

### 3.2 La ficha de llamada

Cada llamada se guarda con tres partes en lugar de un `summary`:

- `signals`: datos estructurados para el código (código de salida, duración, `pid`, cantidad de resultados, si quedó truncado).
- `data`: el contenido que devolvió la herramienta.
- `note`: clave cerrada con texto fijo (por ejemplo `partial_match`), como ya son `STATUS_NOTES` y `REASON_NOTES`.

Y se entrega en uno de tres niveles:

| Nivel | Contenido | Ejemplo |
|---|---|---|
| `line` | Herramienta, argumento principal y resultado en una palabra | `web_search "¿Cuál es el último modelo de GPT?" → ok` |
| `digest` | `line` + hasta 200 caracteres de `data` | … `→ ok: Novedades de GPT-5.6 …` |
| `full` | `line` + `data` completo (con su tope) + ref | Como hoy, sin ids ni señales |

### 3.3 Matriz por consulta

| Consulta | Solicitud | Ítem actual | Hecho | Llamada evaluada | Lecturas previas | Fallos del paso | Otros |
|---|---|---|---|---|---|---|---|
| `pending` | Sí | — | Ítems cumplidos, `line` | — | — | `line` + motivo | `USER` |
| D1 | Sí (recortada) | Sí | Ítems cumplidos | — | — | Se quitan opciones | — |
| D2 | — | Sí | — | — | — | Se quitan opciones | — |
| Argumentos | Sí (recortada) | Sí | `line` | — | Según la herramienta | `line` + argumentos prohibidos | Según la herramienta: `ENV`, reglas de comando, `REFS`, memoria |
| D3 | — | Sí | — | Candidata | — | `line` | `USER` |
| D4 | — | Sí | — | `full` | — | — | `USER`; `TODAY` si se confirma |
| D5 | Sí | — | Ítems cumplidos, `line` | — | — | — | — |
| Final | Sí | — | — | — | `full` | Motivo | Efectos, idioma |

> Nota (medido, §4): en las columnas «Hecho» de `pending` y D5 donde dice «Ítems cumplidos», **se mantiene el formato de hoy** (llamadas con resultado). El formato por ítem no mejoró el cierre. El resto de la matriz no cambia.

«Según la herramienta» se declara en el catálogo, junto a `params` y `notes`: por ejemplo `web_search` no necesita `ENV` ni lecturas previas; `write_file` necesita lecturas previas y `REFS`; `run_command` necesita `ENV`, estado y las reglas de comando.

### 3.4 Topes

Cada consulta recibe un presupuesto en tokens derivado del contexto real de su modelo (8 192 y 4 096), repartido entre sus secciones. Los topes de `budget.caps` dejan de ser números sueltos.

## 4. Lo medido

| Variante | Dónde | Resultado |
|---|---|---|
| D4 sin llamadas previas (`ctx_d4_norecent`) | Laboratorio, 190 casos de D4 | +3,0 puntos en `d4_verify`, +3,2 en `llm_verify_hard`, 0 en el resto; 3 mejoras, 1 regresión |
| Argumentos por herramienta (`ctx_args_by_tool`) | Laboratorio, 116 casos | +3,2 en `llm_arguments`, +3,3 en `llm_arguments_hard`, 0 en el resto; 2 mejoras, 0 regresiones |
| Final sin ids y con idioma fijado (`ctx_final_clean`) | Laboratorio, 47 casos | 1 mejora, 2 regresiones: sin efecto medible |
| D1 sin `Last result` | 7 consultas reales | Misma ruta en 7 de 7; estado de 360 a 26 tokens |
| D5 con `DONE` compacto | 18 cierres reales + 6 negativos | Mismos cierres (12) y mismos falsos cierres (2); probabilidades muy distintas caso a caso; de 271 a 71 tokens |
| D5 con `DONE` por ítem cumplido (3 formatos) | 36 casos de `eval/exp/close_check.ts`, umbral 0,75 | Actual 31/36 (1 falso sí, 4 falsos no). Por ítem sin resultado 29/36 (2 falsos sí); con 150 o 300 caracteres de resultado 29/36 (1 falso sí, 6 falsos no). Tokens 230 → 197 a 212. **No mejora** |
| `pending` con excepción para hechos cambiantes (`ctx_pending_facts`) | 12 preguntas de hechos + 8 de charla, y 53 casos del laboratorio ×2 | Hechos que abren un paso: 0/12 → 11/12. Charla vacía: 8/8. Laboratorio: 0 en `llm_gemai` y `llm_pending`, −5,2 en `llm_pending_hard`; regresan `pending-hard-008` (pierde la URL literal) y `pending-hard-026` (lista vacía), mejora `pending-hard-022` |
| `pending` reescribiendo la regla entera | Mismos casos | Hechos 12/12 pero charla 5/8 y −6,2 / +3,1 / −10,3 en el laboratorio: descartada |

Cuatro variantes quedaron en `eval/variants/ctx/`. No cambian `src`.

## DECISIONES NUEVAS

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| DN-2.1 | `Last result` en D1 y D2 | A dejar · B quitar | **B** |
| DN-2.2 | `Previous approved calls` en D4 | A dejar · B quitar | **B** |
| DN-2.3 | Reglas de comando en el prompt de argumentos | A siempre (hoy) · B solo si la herramienta tiene `command` | **B** |
| DN-2.4 | Solicitud original en argumentos (reactivo) | A no (hoy) · B línea `REQUEST` recortada, como en D1 | **B**, midiendo en el laboratorio con los datasets de argumentos |
| DN-2.5 | Regla de lista vacía de `pending` ante preguntas de hechos | A dejar (hoy: 0/12 buscan) · B agregar una excepción de una frase (11/12 buscan; 2 casos ajenos regresan) · C reescribir la regla (descartada) | **B**, pero es tuya: cambia el comportamiento ante preguntas («¿cuándo sale X?» pasa de responder de memoria a buscar) y la prueba es chica. Los 2 casos que regresan son inestabilidad del prompt, no del efecto buscado |
| DN-2.6 | Formato de lo hecho en `pending` y D5 | A por llamada con resultado (hoy) · B por ítem cumplido | **A**. Medido: B no mejora (29 a 30 de 36 contra 31 de 36). Queda cerrada |
| DN-2.7 | Estructura del resultado en el contexto | A `summary` único (hoy) · B `signals` + `data` + `note` | **B**. Cambia el formato del snapshot (`v: 2`) |
| DN-2.8 | Secciones por herramienta | A todas a todas (hoy) · B declaradas en el catálogo | **B** |
| DN-2.9 | Topes | A caracteres fijos (hoy) · B presupuesto por consulta según el contexto real | **B**; como mínimo, bajar la configuración al contexto real |
| DN-2.10 | Idioma y mención de cambios en la respuesta final | A reglas en el prompt (hoy) · B idioma por código y mención solo si hubo efectos | **B**, sin medir todavía |

## Orden de implementación

1. DN-2.1, DN-2.2 y DN-2.3: cambios de una función cada uno, ya medidos.
2. DN-2.5 (ya medido, falta tu decisión) y DN-2.4 (pide un cambio en `src`: la vista de argumentos no recibe la solicitud).
3. DN-2.9 mínimo (configuración) y DN-2.10.
4. DN-2.7 y DN-2.8: el rediseño de la entrega. DN-2.7 primero, porque DN-2.8 se apoya en él. DN-2.6 queda descartada.

## Límites

- Las muestras reales son pocas (7 consultas de D1 con resultado previo, 18 cierres). Las diferencias de 1 a 3 casos en el laboratorio están dentro del ruido que el propio laboratorio documenta.
- No medí DN-2.4 (la solicitud original en argumentos): una variante del laboratorio no puede hacerlo, porque el prompt de argumentos recibe la vista ya renderizada sin la solicitud; hace falta tocar `src`. Tampoco DN-2.10 (idioma): el grader de la respuesta final no mira el idioma.
- La excepción de DN-2.5 se midió con 12 preguntas de hechos que escribí yo y una sola corrida de 8 de charla; el laboratorio la mide con `--repeat=2`.
- Plan, replan y pregunta al usuario no se auditaron con datos reales.

## Validación pendiente en laboratorio (V) y bloqueados (C)
- **[V]** DN-2.10 idioma en respuesta final (el grader actual no evalúa idioma); DN-2.7 (`signals + data + note`) y DN-2.8 (secciones declaradas por herramienta) requieren validación completa de prompts con el laboratorio.
- **[C]** DN-2.5 (`PENDING_FACTS_LOOKUP = false` en `prompts.ts`) espera autorización explícita de producto; DN-2.9 requiere alinear la configuración al arranque real de Ollama (`8192` / `4096`).
