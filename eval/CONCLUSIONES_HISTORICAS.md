# Conclusiones históricas — revisión (D3) y verificación (D4)

> **Documento histórico (mediciones del 2026-11-07).** Los nombres de variantes y datasets que cita ya no existen en el repo. Lo vigente está en [`MEJORES_VARIANTES.md`](./MEJORES_VARIANTES.md) y en los `conclusiones_*.md` de cada carpeta de `variants/`.

> Documento de referencia, pensado también para pasárselo a un agente que mejore prompts. Empieza por una guía (qué prompt hace qué, cómo medir) y sigue con tres secciones: **lo que sirve**, **lo que no sirve** y **lo que se está probando**; después, la línea base actual, el catálogo de fallas, las hipótesis abiertas y las reglas de trabajo. Lo que sirve
> puede vetarse más adelante si se descubre que no funciona: cada punto dice con qué evidencia se aceptó y qué lo vetaría.
>
> Fecha de las mediciones: 2026-11-07. Modelos: `qwen3.5:4b` (generativo) y `d3:2b` (decisión), ambos en Ollama local.

## Para quien mejore prompts (leer primero)

**Alcance.** Se trabaja solo en prompts y en variantes del eval. No se toca el flujo (`src/core/engine`), el contexto (`src/core/ctx`) ni el
pre-chequeo (`engine/precheck.ts`); un cambio de flujo se propone aparte. Pasar una variante a `src/core/reasoner/prompts.ts` lo decide el
dueño del flujo después de medirla (reglas en 7).

**Qué prompt hace qué** (reactivo, que es el modo que se usa; `ask_user` ya no es opción de D1/D2):

| Etapa | Modelo | Dónde está el prompt | Qué recibe |
|---|---|---|---|
| `pending` (lista de pendientes; el primero es la instrucción del paso) | qwen3.5:4b, sin thinking, JSON `{"pending":[…]}` | `PROMPTS.PENDING_VIEW` (`reasoner/prompts.ts`) | `REQUEST`, `PENDING`, `STATE`, `USER`, `DONE`, `FAIL` |
| D1 `route` (files, locate, terminal, web) | d3:2b, pregunta `choice` | `DECISION_PROMPTS.buildRouteChoice` + `DESTINATIONS[ruta].description` (`tools/manifest.ts`) + `ROUTE_HINTS` | `Step:` y los intentos del paso (no el pedido) |
| D2 `tool_choice` | d3:2b, `choice` (se omite con una sola herramienta) | `DECISION_PROMPTS.buildToolChoice` + descripción de cada herramienta (manifest) | igual que D1 |
| `arguments` | qwen3.5:4b, sin thinking, JSON conforme al schema | `PROMPTS.ARGUMENTS_VIEW` (`SYSTEM`, `osLine`, `READ_REFS_NOTE`, `buildUserPrompt`) | `ENV`, `TOOL`, `SCHEMA`, y la vista (`STATE`, `USER`, `DONE`, `REFS`, `DATA`, `EFFECTS`, `FAIL`, `TASK`) |
| pre-chequeo | **código, no es un prompt** | `engine/precheck.ts` | argumentos resueltos y fuentes de la tarea |
| D3 `args_review` | d3:2b, `choice` de 3 opciones | `REVIEW_OPTIONS` y `DECISION_PROMPTS.buildArgsReview` | paso, intentos fallidos, lecturas, llamada candidata con schema |
| D4 `result_verification` | d3:2b, dos preguntas `noul` (`ok`, `cumple`; aprueba si ambas > 0,5) | `VERIFY_QUESTIONS` y `DECISION_PROMPTS.buildResultVerification` | instrucción del paso, hechas, la llamada evaluada |
| `question` (cuando D3 da `info_missing` o se llega al tope de llamadas) | qwen3.5:4b | `PROMPTS.QUESTION` | vista de `forAsk` (con el pedido) |
| `plan` (modo deliberativo) | qwen3.5:4b con thinking | `PROMPTS.PLAN_VIEW` | vista de `forPlan` |
| `final` | qwen3.5:4b | `PROMPTS.FINAL_VIEW` | vista de `forFinal` |

`question`, `plan` y `final` **no se midieron en esta ronda** y no tienen línea base (ver 5).

**Lo aprendido hasta ahora sobre cómo escribirlos**
- Los prompts cortos, objetivos y concisos andan mejor. d3:2b casi no reacciona a texto largo (en `args_review` rechazaba como
  `tool_rejected` PowerShell correcto y aprobaba rutas inventadas aunque el prompt lo prohibiera). qwen3.5:4b sí sigue instrucciones,
  pero copia lo que ve: un comando rechazado que aparece en el prompt se repite.
- `pending` no debe nombrar comandos ni herramientas (inventaba `ps`); cada ítem es un objetivo en palabras del usuario.
- Una pregunta `noul` con `criteria: {true, false}` quita la zona gris y ayuda (ver 1.3 y 3.1); el servicio la acepta.
- El sistema operativo dentro del prompt de argumentos subió `scenarios_arguments` de 76,5 % a 94 % (ya está en `prod`).
- Un ejemplo en el prompt que **es** la respuesta del caso medido mide cuánto copia el modelo, no cuánto generaliza.
- La temperatura de d3 es 0: repetir una decisión no agrega información; en las etapas generativas sí conviene `--repeat=3` o más.

**Cómo se mide una variante** (detalle en `eval/README.md` y `eval/INSTRUCCIONES.md`; ejemplos en `eval/variants/*.ts`)
- Una variante es un archivo en `eval/variants/` con `prompts` (reemplaza piezas enteras de `PROMPTS` o `DECISION_PROMPTS`, que rearman
  los casos por escenario) y, para casos fijos, ediciones de `state`, `questions`, `criteria`, `system`, `user`. Para decisiones con varias
  preguntas existen `combine` (D3) y `combineVerification` (D4); ver `eval/core/d4_checks.ts` (D4) y la sección 8 para lo que ya se descartó.
- `npm run eval -- --stages=<etapa> --dataset=<datasets> --variant=prod,<tuya> [--repeat=N] --label=<x>` y, para D3,
  `npm run eval:cross` (falsos rechazos, recall, pareado). Comandos completos al final.
- **Criterio de aceptación:** mirar caso por caso (regresiones y mejoras, test pareado), no solo el porcentaje; en decisiones, los falsos
  rechazos y los falsos aprobados por separado. Ajustar sobre unos datasets y **validar en otros** (los casos reales de las trazas son la
  validación final; no iterar umbrales sobre los mismos casos).

---

## Cómo leer los números

- **Las repeticiones no son muestras.** D3 corre a temperatura 0: repetir un caso da la misma respuesta (`needs_user` salió 0,83
  y 0,84 en las seis repeticiones). Las etapas de decisión se miden con `--repeat=1`; "60 corridas" de 20 casos son 20 casos.
- **El pass rate no decide.** Se miden por separado los **falsos rechazos** (de las llamadas buenas, cuántas se rechazan: es
  lo caro, rompe lo que andaba) y el **recall por modo de falla** (de las malas, cuántas se detectan y con qué etiqueta).
- **Test pareado.** `eval:cross` compara cada variante con `prod` caso por caso (discordantes y p exacto del test de signos).
- **Tres datasets de `args_review` (105 casos: 32 buenos, 73 malos).** Ninguno es una muestra de uso real:
  - `reales_args_review` (36): reconstruidos de `jarvis-traces.jsonl`; la etiqueta la puso una persona, no un modelo. Es el menos circular.
  - `mut_args_review` (52): mutaciones de 14 llamadas buenas (etiqueta correcta por construcción). **Circular:** solo prueba las fallas enumeradas.
  - `scenarios_args_review` (17): escritos a mano por otro agente (se quitaron los 3 `tool_rejected`, que ya no existen).
- **Verificación (D4):** `old_verificacion` (87 casos: 45 buenos, 42 malos), convertido de `dataset_v2/v3` de las pruebas viejas.
- Comandos y generadores al final.

---

## 1. Lo que sirve

### 1.1 Pre-chequeo determinista antes de D3 (`src/core/engine/precheck.ts`)
Reglas de código, sin modelo, sobre los argumentos resueltos: valor vacío o `N/A`, marcador de posición, ruta de otro usuario,
ruta de Linux dentro de un comando, comando que no existe o con opciones `--` sobre un cmdlet (parser de PowerShell +
`Get-Command`), shell inexistente, y ruta de lectura o URL que no aparece en nada de lo que la tarea sabe.

| 105 casos | Acierto | Falsos rechazos | Malas con la etiqueta correcta | Malas que pasan |
|---|---|---|---|---|
| D3 de producción solo | 56 % (59) | **19 %** (6/32) | 45 % (33/73) | 49 % (36/73) |
| **Pre-chequeo solo** | **89 %** (93) | **0 %** (0/32) | **84 %** (61/73) | 16 % (12/73) |
| Pre-chequeo + D3 de producción | 86 % (90) | 19 % (6/32) | 88 % (64/73) | 12 % (9/73) |

Pareado contra D3 de producción: 37 casos mejoran, 3 empeoran, p < 0,001. Solo en los 36 casos reales: 83 % contra 44 %,
0 de 12 buenas rechazadas contra 3 de 12.

- **Costo:** ~0,3 s por `start_process` (un proceso PowerShell); el resto es instantáneo.
- **Por qué se acepta:** cero falsos rechazos en 32 buenas, y atrapa lo que D3 deja pasar (ruta inventada, `ps aux`, `top`,
  URL inventada, `.xlsx` inexistente).
- **Límites que conviene tener presentes:**
  - Las reglas se escribieron mirando estos casos (sesgo hacia ellos).
  - Depende del PATH de la PC: con Git para Windows, `head`, `grep`, `wc`, `cat`, `find` y `sudo` existen y el comando correría.
    Esos casos se etiquetaron inválidos (Windows común) y llevan el tag `depende_del_path`; son 6 de los 12 que no detecta (7 con `rev-linux-grep-cmd`, que no lo lleva).
  - No ve errores semánticos (contenido equivocado en un archivo) ni opciones inventadas de un programa (`tasklist /SO`).
  - "Ruta de lectura que no aparece" puede dar falsos rechazos si el usuario nombra un archivo sin extensión y el modelo la agrega.
- **Lo vetaría:** un solo falso rechazo repetido en uso real, o un recall menor a 70 % en casos reales nuevos.

### 1.2 `tool_rejected` fuera de D3
D3 ya no ofrece "elegí otra herramienta" (opciones: `approved`, `args_invalid`, `info_missing`).
- **Evidencia:** precisión de 25 % de `tool_rejected` en `scenarios_args_review` (40 predichos, 10 correctos); en trazas reales,
  la mayoría de los 23 `tool_rejected` eran comandos realmente malos (≈15) con la etiqueta equivocada; D2 ya elige la herramienta
  y D4 atrapa una equivocada con `not_accomplished`.
- **No comparable:** el pass rate de `prod` pasó de 35 % a 56 % también porque cambió el dataset (se quitaron 3 casos).
- **Lo vetaría:** que en uso real una herramienta equivocada cueste más de una llamada por paso.

### 1.3 `noul` admite `criteria: { true, false }`
El servicio d3:2b aceptó y respondió bien preguntas `noul` con `criteria` (0 errores de parseo o de cliente en las 348 corridas de D4 y
las 630 de D3). Es la base de 3.1 y 3.2; el efecto en D4 está en 3.1.

### 1.4 Sistema operativo dinámico en el LLM de argumentos
`UserEnvironment.platform` → línea del system prompt (`ARGUMENTS_VIEW.osLine`). Con ella, tras un intento rechazado el LLM de
argumentos corrige los comandos de Linux: 30 de 30 en `fail_sin_razon`. No corrige un patrón propio que el modelo repite (la tabla hash inválida de los procesos con más RAM): ver 3.4. Las trazas con comandos de Linux repetidos eran anteriores.
- **Lo vetaría:** comandos de Linux en Windows en corridas reales con la línea activa.

### 1.5 Prácticas de medición
`--repeat=1` en decisión; falsos rechazos y recall por modo de falla; test pareado; conjunto de casos reales aparte de las
mutaciones; `--concurrency=3` por defecto (la latencia p50/p95 deja de ser comparable).

### 1.6 Prompts ya aplicados a `prod` (candidata C, de la corrida `2026-11-07_015324_candidatas`, `--repeat=3`)
Cifras contra el `prod` de ese momento (antes de aplicarlas):

| Etapa (dataset) | `prod` de entonces | Aplicado | Qué cambió |
|---|---|---|---|
| `pending` (`scenarios_pending`) | 64,7 % | 94,1 % | lista vacía acotada a dos casos; ítems sin comandos ni herramientas; el ítem fallido se reescribe |
| `pending` (`dificil_pending`) | 74,5 % | 80,4 % | ídem |
| `arguments` (`scenarios_arguments`) | 76,5 % | 94,1 %–100 % | línea del sistema operativo (Windows y PowerShell, equivalentes de comandos de Linux) |
| D1 `route` (`scenarios_reactivo`, `dificil_reactivo`) | 87,5 %, 94,4 % | 100 %, 100 % | `ROUTE_HINTS`: `files` no abre aplicaciones, `terminal` sí, `locate` tras un `not_found` |

Riesgo conocido de D1: en `scenarios_chains` ganó un caso y perdió otro (`seq-comparar-precios-03-route`). Lo **no** aplicado de esa ronda:
la regla extra de `pending` "cumplido tras fallo" (vació la lista en `dpen-parcial-falta-guardar`, que cerraría la tarea antes de tiempo), y los textos
de D3 y D4 de `cand_b` (`args_review` bajó de 35 % a 25 %; D4 mejoró 5 casos y empeoró 3 sin mover los que apuntaba). Las variantes anteriores
(`pending_corto`, `pending_corto2`, `pending_ejemplos`, `args_so_basico`, `args_so_equivalencias`, `route_lexico`) fueron absorbidas por `cand_a`/`cand_b`.
- **Lo vetaría:** una regresión de estos prompts en la línea base de la sección 4 o en uso real.

---

## 2. Lo que no sirve

### 2.1 `tool_fit` como pregunta de D3
Dio 0,06 y 0,07 a comandos de PowerShell correctos: juzga el contenido del comando, no el tipo de herramienta (D3 ve los
argumentos y no las otras herramientas). Es la causa de los falsos `tool_rejected` de `prod`.

### 2.2 Preguntas binarias de D3 con regla en código como **reemplazo** de la pregunta única
Con el pre-chequeo delante o sin él, ninguna variante gana a `prod` en D3 solo (105 casos):

| Variante (D3 solo) | Acierto | Falsos rechazos | Malas con etiqueta correcta | Malas que pasan |
|---|---|---|---|---|
| `prod` | 56 % | 19 % | 45 % | 49 % |
| `d3_checks` (args_grounded + needs_user, criteria, promedio y veto) | 48 % | 3 % | 26 % | 67 % |
| `d3_checks_any` (rechaza si cualquiera < 0,5) | 50 % | 3 % | 29 % | 64 % |
| `d3_checks_sincrit` (sin criteria) | 39 % | 0 % | 12 % | 74 % |
| `d3_grounded` (solo args_grounded, umbral 0,4) | 44 % | 3 % | 21 % | 71 % |
| `d3_needs` (solo needs_user) | 35 % | 0 % | 7 % | 89 % |

Bajan los falsos rechazos (19 % → 0–3 %) a costa de dejar pasar entre 64 % y 89 % de las malas. Sin `criteria` es peor
(39 % contra 48 %: los `criteria` ayudan). El promedio no aporta sobre el AND estricto (`d3_checks` 48 % y `d3_checks_any` 50 %,
diferencia de un caso).

### 2.3 Votación por mayoría 2 de 3 para **verificar** (pruebas viejas)
"Un solo indicio de fallo debe bastar para vetar": en verificación el error caro es aprobar algo malo. En D3 (el error caro es
rechazar algo bueno) la regla se invierte, pero 2.2 muestra que cruzar estas preguntas con d3:2b no alcanza.

### 2.4 "Reescribilo desde cero, no copies el anterior" en la razón del rechazo
Empeora: con el comando oculto baja de 55 % a 20 % de comandos válidos, y con el comando visible sigue en 0 %. Ver 3.4.

### 2.4b Temperatura más alta (0,2 y 0,3) en el reintento de la lista de pendientes vacía (2026-11-07)
Prueba: `pending` sobre `scenarios_pending` y `dificil_pending` (17 casos cada uno), `--repeat=5`, temperatura 0,1 (`prod`) contra 0,2 y 0,3. Con 0,1 pasan 94,1 % y 80,0 %; con 0,2, 94,1 % y 77,6 %; con 0,3, 96,5 % y 71,8 %. Lo que el reintento intenta arreglar, una lista vacía cuando debía traer ítems, no ocurrió ni una vez a ninguna temperatura (0 de 135 corridas con ítems esperados) ni se inventaron ítems donde debía ir vacía (0 de 15). No se incorpora a `src`: no hay fallo que corregir en estos datasets y 0,3 empeora `dificil_pending` (regresiones: `dpen-comando-del-usuario-tasklist` 5/5 a 1/5, `dpen-verificacion-rechazada-incompleto` 3/5 a 1/5). Si aparece una lista vacía real en una traza, medirlo con ese caso. Las variantes `pend_t02` y `pend_t03` se borraron. Corrida: `2026-11-07_182930_pend_temp`.

### 2.5 Otras conclusiones de las pruebas viejas que siguen valiendo
`read_status` aislada y J2 para verificar ausencias (activa un veto equivocado); repetir llamadas a temperatura 0 para medir ruido
(diferencia 0,000); la pregunta `ok` sola ("¿hay datos?") no detecta contenido equivocado.

---

## 3. Lo que se está probando

### 3.1 D4: preguntas combinadas y `criteria` (`old_verificacion`, 87 casos)
D4 de producción deja pasar **62 %** de los casos malos cercanos (nombres parecidos, destino equivocado, contenido distinto).

| Variante | Buenos aprobados | Buenos ≥ 0,9 | Malos que pasan (> 0,5) | Peor caso malo |
|---|---|---|---|---|
| `prod` (`ok` + `cumple`) | 100 % (45/45) | 96 % | 62 % (26/42) | 0,998 |
| `d4_cumple_criteria` | 98 % (44/45) | 93 % | 50 % (21/42) | 0,998 |
| `d4_criteria_dual` | 98 % (44/45) | 91 % | 52 % (22/42) | 0,999 |
| `d4_j1` (cuatro vías + `cumple` con criteria, veto AND) | 96 % (43/45) | **80 %** | **43 %** (18/42) | 0,999 |

- **Lectura:** el diseño J1 baja los malos aprobados 19 puntos a costa de 4 de cada 100 buenos y de la auto-aprobación. Ninguna
  variante se acerca a lo que midieron las pruebas viejas (0 falsos positivos, peor malo 0,355): o la conversión del dataset es
  más difícil (el resumen es solo la observación, y `failed` con error explícito se descartó), o el modelo de entonces era otro.
- **Pendiente:** reconstruir los casos como estaban en las pruebas viejas, probar la política de 3 bandas (0,90 / 0,60), y medir
  en los casos reales de las trazas (hoy no hay etiquetas de D4 reales).

### 3.2 D3 binario **como complemento** del pre-chequeo
`pre+d3w` (pre-chequeo y D3 solo para escrituras) con `d3_checks`: 90 % (95/105), 0 falsos rechazos, 86 % de malas con la
etiqueta correcta, contra 89 % (93/105), 0 y 84 % del pre-chequeo solo: **+2 casos, no significativo**. De los 12 casos malos que el
pre-chequeo no ve, `prod` atrapa 3 (dos opciones inventadas de `tasklist` y un `head`) y `d3_checks` 2 (las de `tasklist`). Por ahora D3 aporta poco
sobre el pre-chequeo; falta ver si `needs_user` (único con separación limpia, 0,83–0,95 contra ≤ 0,2) aporta con más casos
de `info_missing` (hay 2 por dataset).

### 3.3 D3 solo para escrituras (aplicado a `src` el 2026-11-07)
En `callRunner.ts` solo `kind === "write"` pasa por D3; las lecturas salen del pre-chequeo directo. En la tubería `pre+d3w` una lectura no rechazada por el pre-chequeo se aprueba sin consultar a D3. Con `prod` baja los falsos
rechazos de 19 % a 13 %; con `d3_checks` a 0 %. En los datasets casi todo es `start_process` (escritura), así que casi no se ve.
Falta un dataset con lecturas (`search`, `fetch`, `read_file`) representativas.

### 3.4 Qué ve el LLM de argumentos tras un rechazo (falla real: los 10 procesos con más RAM)
En una corrida real qwen3.5:4b escribió 6 veces seguidas `Get-Process | Sort-Object @{Get-Member -Name 'WorkingSet64' …}` (tabla hash
inválida). El pre-chequeo la rechazó las 6 veces (razón: error de sintaxis) y el pedido terminó en `no_alternatives`. Se reprodujo con
`ram_real` (4 casos × 10 repeticiones) y se probaron formas de mostrar el intento rechazado (`ram_retry_a`–`d`, 20 corridas por celda;
"válido" = sin errores con el parser de PowerShell, `npm run eval:psvalid`):

| Qué ve el modelo | `prod` | `args_comando_simple` (una frase: "el comando más simple, sin tablas hash") |
|---|---|---|
| Primer intento (sin rechazo previo) | **0 %** (0/20) | **100 %** (20/20) |
| Tras un rechazo, comando fallido + razón (como hoy) | 0 % | 0 % |
| Tras un rechazo, **sin el comando** + razón | 0 % | **55 %** (11/20) |
| Tras un rechazo, comando + razón + "reescribilo desde cero" | 0 % | 0 % |
| Tras un rechazo, sin el comando + razón + "reescribilo desde cero" | 0 % | 20 % |

- **Dos causas distintas.** (1) El primer intento falla siempre en este pedido: lo arregla la frase del prompt (100 %).
  (2) Tras el rechazo el modelo **copia el comando fallido que ve en la línea FAIL**, aunque la razón esté al lado: no basta con la razón
  ni con el prompt. Sacar el comando de esa línea ayuda (55 %) pero solo junto con el prompt (sin él, 0 %).
- **Efecto de la razón por sí sola:** ninguno medible (`fail_con_razon` 30/30 contra `fail_sin_razon` 30/30, efecto techo en 10 casos
  sencillos). Sin el `ram_real` no se habría visto: hace falta una falla que el modelo no resuelve solo.
- **Regresión de la frase:** `scenarios_arguments` 51/51 (sin cambio); `dificil_arguments` 47/48 contra 48/48 (`darg-start-search-pdf` 2/3 contra 3/3).
- **El ejemplo en el prompt (`args_comando_ejemplo`) no suma sobre la frase** (misma tasa; el ejemplo es la respuesta del caso medido).
- **No aplicado a `src`.** Cambios candidatos: la frase de `args_comando_simple` en `ARGUMENTS_VIEW`, y que `failureLine`
  (`render/shared.ts`) no imprima `args` de un intento `args_invalid` que traiga razón.

### 3.4b Catálogo web: `research` en lugar de `search` y `fetch_batch` (aplicado el 2026-11-07, sin medir)
Se quitaron `search`, `fetch_batch`, `fetch.render`, `fetch.max_age_hours` y `start_process.shell`, y se agregó `research` (solo `question`). Hipótesis a medir:
- Menos pasos sin herramienta y menos `loop_blocked` en pedidos de información (la cadena buscar y leer pasa a una llamada), y sin el señuelo `render: "browser"`.
- **Extractor propio de `research`** (2026-11-07): fuentes con fecha y snippet más las líneas de las páginas parecidas a la pregunta. Con el modelo final sobre las dos salidas reales: la respuesta pasó de "GPT-5" (con una frase inventada sobre "análisis de finales de 2026") a "GPT-5.5" anclado en una fuente con fecha, y desapareció el "Gemini 2.5 Pro lanzado en octubre de 2026" que el modelo inventaba. Sin resolver: una tabla con modelos más nuevos queda fuera del resumen. n = 2 pedidos × 2 repeticiones.
- Riesgos: resultados largos (casi siempre quedan en una ref; D4 y el modelo final ven solo el principio), el tiempo de espera de 30 s de las llamadas MCP, y que el pre-chequeo tenga las URL de las páginas leídas como fuente (ahora lee las refs).
- Qué medir: pasos y llamadas por pedido, `loop_blocked`, tiempo total, si la respuesta final sale del texto leído, y D4 sobre resultados de `research` (hace falta un resultado real para armar los casos).

### 3.4c Repeticiones y salida parcial (aplicado el 2026-11-07, traza "último modelo de GPT y Gemini → md", `partial` en 95 s, 10 de 14 llamadas desperdiciadas)
Cambios en `src`: lista de pendientes mantenida por el código (`pendingList.ts`), tope `maxItemFailures` y salida parcial en `runReactive`, `loop_blocked` con mensaje explícito y argumentos visibles (rechazos con razón: ocultos), encabezado de estado fijo en la respuesta final, línea "EFFECTS: none", y en `research` el extractor prioriza líneas con año (la segunda línea de una fuente solo entra si puntúa ≥ 60 % de la mejor).
Mediciones (dataset `repeticiones`, `eval/gen/repeticiones.ts`, 4 casos reales, `arguments`): 5/20 antes y 15/20 después del cambio de `loop_blocked`. Sin regresión: `scenarios_arguments` 100 %, `dificil_arguments` 97,6 %. Los reintentos tras rechazo siguen flojos (`ram_retry_a/b/d`: 15 %/5 %/55 %, ruidoso, sin efecto estable). El encabezado fijo se verificó con un render, no con el modelo final.
Límites: el extractor no resuelve la recencia (tablas con modelos nuevos quedan en la ref); `start_process` es siempre `write`, así que sigue pasando por D3; el 4B copia el query visible tras un descarte de D4.

### 3.5 Ideas que no son preguntas (sin probar)
1. **Validar contra el schema de la herramienta** (obligatorios, tipos, enums) antes de D3: determinista, casi gratis.
2. **Memoria de rechazos:** si el candidato repite el `sig` de uno ya rechazado en el paso, bloquearlo sin consultar a D3.
3. **Citar o fallar:** pedir al LLM de argumentos una fuente por valor (`{"args":…, "sources":…}`) y verificar en código que cada
   fuente aparece. Convierte "¿está inventado?" en una comprobación literal.
4. **Verificar por lectura posterior** en las escrituras (después de `write_file` o `move_file`, listar o leer el destino) en vez
   de preguntarle a D4 si la acción se cumplió.
5. **Comprobación determinista de cantidad** en D4: si el paso pide N elementos, contar las líneas del resultado
   (el caso "3 de 10 procesos" que D4 aprobaba).
6. **Cascada por capacidad:** si la respuesta de d3:2b cae en la zona ambigua (0,3–0,7), escalar a un modelo mayor. Antes hace
   falta saber si el techo es de capacidad o de diseño de la pregunta: correr las mismas preguntas con un juez más grande.
7. **D2 con margen:** si D2 duda entre herramientas (diferencia de probabilidad baja) y la anterior falló, elegir la otra.
8. **Casos reales etiquetados para D4:** las trazas tienen 18 verificaciones reales; etiquetarlas a mano.

---

---

## 4. Línea base actual de `prod` (2026-11-07, `qwen3.5:4b` + `d3:2b`, `--repeat=3`)

`prod` ya incluye todo lo aplicado: `pending` y aclaraciones de D1 de la candidata C, línea del sistema operativo en argumentos, D3 sin
`tool_rejected` y el pre-chequeo (el pre-chequeo no entra en estas etapas). Corrida: `eval/results/qwen3.5_4b/2026-11-07_041207_linea_base_prod`.
Los porcentajes de decisión cuentan cada caso 3 veces (copias): mirar los casos fallados, no el porcentaje.

| Etapa | Dataset | Pass (casos con fallos / casos) |
|---|---|---|
| `pending` | `scenarios_pending` | 96,1 % (1/17) |
| `pending` | `dificil_pending` | 78,4 % (4/17) |
| `arguments` | `scenarios_arguments` | 100 % (0/17) |
| `arguments` | `dificil_arguments` | 100 % (0/16) |
| `arguments` | `ram_real` (falla real de la tabla hash) | **0 %** (4/4) |
| D1 `route` | `scenarios_reactivo` / `dificil_reactivo` | 100 % / 100 % |
| D1 `route` | `scenarios_chains` | 58,3 % (10/24) — ver nota |
| D2 `tool_choice` | `scenarios_reactivo` / `dificil_reactivo` | 100 % / 94,1 % (1/17) |
| D2 `tool_choice` | `scenarios_chains` | 68,8 % (5/17) — ver nota |
| D3 `args_review` | `scenarios_args_review` / `reales_args_review` / `mut_args_review` | 47 % / 44 % / 65 % (falsos rechazos 19 % en conjunto; ver 1.1) |
| D4 `result_verification` | `scenarios_reactivo` | 75,0 % (4/16) |
| D4 `result_verification` | `scenarios_chains` | 58,3 % (10/24) — ver nota |
| D4 `result_verification` | `old_verificacion` | 64,4 %; deja pasar el 62 % de los malos (ver 3.1) |

**Nota sobre `scenarios_chains`:** sus `expect` son "una primera propuesta: revisarlos" (dice el propio dataset) y 8 casos de `route` esperan
`fin` o `ask_user`, que ya no son opciones. Antes de optimizar contra esos fallos hay que revisar las etiquetas; no se usó para decidir nada.

---

## 5. Catálogo de fallas observadas (donde un prompt puede ayudar)

**`pending`**
- `dpen-archivo-no-encontrado` (0/3 en `prod` y en todas las candidatas): tras un `not_found` repite "abrir el archivo" en vez de buscarlo primero.
- `dpen-verificacion-rechazada-error`, `dpen-verificacion-rechazada-incompleto`, `dpen-vacio-tras-fallos-y-exito`, `pen-reescribe-segunda-vez` (2/3): no reescribe
  el ítem fallido, o con un rechazo previo no ve el éxito posterior y no vacía la lista.
- Trazas reales: "busca el último modelo de gpt" se partió en 3 pasos, y los pasos 2 y 3 ("identificar el último modelo mencionado en la búsqueda") no
  necesitan ninguna herramienta (la respuesta ya estaba en la búsqueda del paso 1), pero el flujo exige una llamada por paso: bucle de `loop_blocked`.
  "Guardá en un Excel la información de GPT y Gemini" empezó con `read_file` de un `.xlsx` que no existe.

**`arguments`**
- Falla real (`ram_real`): para "los 10 procesos con más RAM" escribe `Sort-Object @{Get-Member -Name 'WorkingSet64' …}` (tabla hash inválida) el 100 % de las veces
  con el prompt de producción; una frase en el prompt lo arregla en el primer intento (3.4).
- Tras un rechazo copia el comando fallido que ve en la línea FAIL, aunque esté la razón al lado (3.4).
- Inventa valores que el pre-chequeo hoy atrapa: URLs (`openai.com/news/openai-gpt-5`), rutas (`jarvis.xlsx`), `usuario` en `C:\Users\usuario`.
- Antes de la línea del sistema operativo: `shell: "cmd"` o `"bash"` con comandos de Linux (`ps aux`, `top`); ya corregido en gran parte.

**D1 / D2**
- `dtc-locate-busqueda-nueva-con-otra-activa` (D2, 0/3). En una traza D2 dudó entre `search` (0,47), `fetch` (0,32) y `fetch_batch` (0,21) para
  "identificar el último modelo de GPT"; las descripciones de `search`, `fetch` y `fetch_batch` se parecen.

**D3**
- Falsos rechazos de `prod`: PowerShell correcto (`Get-Process | Sort-Object WorkingSet …`) rechazado como `args_invalid` (4 casos) y `fetch_batch` con URLs de los
  resultados rechazado como `info_missing` (2 casos). Aprueba comandos de Linux y rutas inventadas. Con el pre-chequeo delante, D3 agrega poco (3).
- La pregunta de 3 opciones largas mezcla etiquetas; `needs_user` como pregunta binaria sí separa limpio (0,83–0,95 contra ≤ 0,2).

**D4**
- Aprueba lo parcial o irrelevante: `rv-ram-solo-tres` (3 de 10 procesos), `rv-busqueda-irrelevante`, `rv-pagina-solo-cookies`, `rv-leer-otro-archivo`.
- En `old_verificacion` deja pasar el 62 % de los malos cercanos (nombre parecido, destino equivocado, contenido distinto, "éxito" sin el efecto pedido).

---

## 6. Hipótesis abiertas sobre prompts

Cada una dice qué probar y con qué. Las que dependen de un cambio de código se marcan **(requiere código)**: se prueban en el eval simulando el
cambio en el dataset y se proponen al dueño del flujo.

| # | Etapa | Hipótesis | Cómo medirla | Aceptar si |
|---|---|---|---|---|
| H1 | `arguments` | La frase de `args_comando_simple` ("el comando más simple, sin tablas hash…") generaliza a otros pedidos de PowerShell. | Dataset nuevo de 15–20 pedidos de comandos variados (procesos, servicios, archivos, red) con `npm run eval:psvalid`; `scenarios_arguments` y `dificil_arguments` por regresiones (hoy 1 caso baja de 3/3 a 2/3). | Más comandos válidos sin regresiones. |
| H2 | `arguments` | El modelo copia el comando fallido: no mostrarlo en FAIL (`ram_retry_b`) o mostrar solo la razón y qué evitar mejora el reintento. **(requiere código)** | `ram_retry_a`–`d` con otras formas de la razón (por ejemplo "no uses tablas hash"; lo que **no** funcionó: "reescribilo desde cero"). | Más de 55 % válidos en el reintento. |
| H3 | `arguments` | Pedir una fuente por valor (`{"args":…, "sources":…}`) reduce los valores inventados, y el código la verifica. **(requiere código)** | Variante de `ARGUMENTS_VIEW` + `reales_args_review` / `mut_args_review`. | Menos valores inventados sin más rechazos de buenos. |
| H4 | `pending` | Una regla "un ítem que solo reformula lo que ya está en DONE no es un ítem" evita los pasos sin herramienta. | Dataset nuevo desde la traza de GPT (listas previas y DONE reales) y `scenarios_pending`/`dificil_pending` por regresiones. | Lista vacía o ítem con acción real; sin cerrar antes de tiempo (`dpen-parcial-falta-guardar`). |
| H5 | `pending` | Tras un fallo, el ítem fallido se reescribe si el prompt dice qué fue lo que falló ("lo encontrado no existe: primero buscarlo"); o marcar el ítem fallido en la lista anterior. **(la marca requiere código)** | `dpen-archivo-no-encontrado` y los otros 4 casos que fallan. | 3/3 en esos casos sin perder el resto. |
| H6 | `pending` | El techo es de capacidad: con thinking o con un modelo mayor mejora. | `--thinking=on`, `--model=qwen3.5:9b` con el mismo prompt. | Si mejora mucho, el problema no es el texto. |
| H7 | D2 | Descripciones más cortas y diferenciadas de `search` / `fetch` / `fetch_batch` (cuándo cada una) bajan la duda. | `tool_choice` en `dificil_reactivo` y casos nuevos web; descripciones en `tools/manifest.ts` (límite `MAX_TOOL_DESC_CHARS`). | Margen mayor entre la elegida y la segunda sin regresiones. |
| H8 | D1 | Más aclaraciones por ruta, como las de `ROUTE_HINTS` (`files` no abre aplicaciones, `terminal` sí, `locate` tras un `not_found`), cubren las rutas que fallan. | `route` en `dificil_reactivo` y casos nuevos; revisar antes las etiquetas de `scenarios_chains`. | Sin regresiones. |
| H9 | D3 | Con el pre-chequeo resolviendo lo comprobable, D3 debe juzgar solo lo semántico (contenido o destino equivocado, dato que falta); reescribir su pregunta en ese sentido, corta y con `criteria`. | `args_review` + `eval:cross` (falsos rechazos y recall sobre lo que el pre-chequeo no ve). Un `needs_user` con más casos de `info_missing` (hay 2 por dataset). | Cero falsos rechazos y recall mayor al del pre-chequeo solo. |
| H10 | D4 | Las preguntas con `criteria` (`d4_cumple_criteria`, `d4_j1`) bajan los falsos aprobados; incluir la cantidad pedida y exigir cobertura completa sube más. | `old_verificacion`, `scenarios_reactivo` y los 4 `rv-*` que fallan; etiquetar las 18 verificaciones reales de las trazas. | Menos de 43 % de malos que pasan (J1) con al menos 96 % de buenos. |
| H11 | `question`, `final`, `plan` | Sin medir: pueden tener fallas que no vimos. | Crear datasets chicos por escenario primero (`scenarios_messages` ya trae algunos). | — |

**Hipótesis ya descartadas o sin efecto** (no repetir): `tool_fit` como pregunta; promedio de preguntas binarias como reemplazo de D3 (2.2); "reescribilo desde cero"
(2.4); la razón del rechazo sola (3.4); votación 2 de 3 para verificar (2.3).

---

## 7. Reglas de trabajo para el agente de prompts

1. Una sola variable por variante (el nombre y el comentario de cabecera dicen la hipótesis y qué dataset la mide); componer con `a+b` solo después de medir cada una.
2. No tocar `src`. Una variante vive en `eval/variants/`; si el cambio necesita código, se anota como **(requiere código)** y se prueba simulándolo en un dataset.
3. Los datasets generados (`reales_args_review`, `mut_args_review`, `old_verificacion`, `fail_*`, `ram_*`) se regeneran con `eval/gen/*.ts`; no se editan a mano. Un dataset
   nuevo va con su generador o con casos por escenario (`eval/core/scenario.ts`) y se valida primero con `--client=oracle` (debe dar 100 %).
4. Reportar siempre: caso por caso (mejoras y regresiones), no solo el porcentaje; falsos rechazos y falsos aprobados en decisiones; qué dataset se usó para ajustar y cuál para validar.
5. Anotar en este archivo lo que se descarte (sección 2) y lo que se acepte con su evidencia (sección 1): lo aceptado puede vetarse después.

## Resultados crudos

`eval/results/qwen3.5_4b/` (una carpeta por corrida con `comparison.md`, `comparison.json` y `<variante>__<dataset>/runs.jsonl`) y `eval/results/_cross/`. Las corridas citadas:
`2026-11-07_015324_candidatas`, `_034546_d3_final`, `_034644_d4_final`, `_034846_razon_en_fail2`, `_035734_ram_real`, `_035909_args_simple_regresion`, `_040211_ram_retry`, `_041207_linea_base_prod`.

## 8. Variantes y datasets eliminados (limpieza del 2026-11-07)

Se borraron los archivos (las variantes nuevas no estaban en git); las cifras están en las secciones 1 a 3 y en `eval/results/`. **No repetir** estas ideas
sin una razón nueva. Sobre "Resultado": D3 y D4 con la regla de aprobar solo lo bueno, 105 y 103 casos.

| Variante | Qué probaba | Resultado |
|---|---|---|
| `d3_checks`, `d3_checks_any`, `d3_checks_sincrit`, `d3_needs`, `d3_grounded` | D3 como preguntas binarias (`args_grounded`, `needs_user`) con regla en código | 35–50 % contra 56 % de `prod`; bajan los falsos rechazos pero dejan pasar 64–89 % de las malas |
| `d3_semantic_checks` | preguntas binarias semánticas | 39 % |
| `d3_compact_choice` | 3 opciones cortas | 42,9 %; sin las definiciones largas aprueba Linux y rutas inventadas |
| `d3_flags_criteria` | pregunta binaria sobre flags válidas | 40 % de falsos rechazos |
| `d3_four_choice` | una cuarta opción `os_incompatible` | 29 % |
| `d3_variant` (+ `new/`) | dos preguntas de "hay un problema" | 48 % contra 56 %; con el pre-chequeo no aporta |
| `d4_variant` (+ `new/`) | tres preguntas sí/no (`effect_ok`, `target_ok`, `content_ok`) | igual acierto que `prod`: atrapa 12 malos más y rechaza 11 buenos más |
| `d4_concise_criteria`, `d4_criteria_dual` | solo preguntas binarias con `criteria` | 68 % y 52 % de falsos aprobados: sin la elección de cuatro vías el modelo se sesga a "sí" |
| `d4_direct_checks` | tres sí/no directas | 14 de 54 buenos rechazados |
| `d4_j2_precise` | preguntas de objetivo y cantidad | 5 buenos rechazados |
| `d4_j1_soft`, `d4_j1_harmonic`, `d4_j1_hybrid` | otras reglas de combinación de `d4_j1` | 77–78 contra 80–82 del estricto; los umbrales del híbrido estaban ajustados a los mismos casos |
| `d4_five_way_balanced` | cinco vías sin ejemplos | 77, sin ventaja sobre `d4_five_way` |
| `args_comando_ejemplo` | la frase de `args_comando_simple` más un ejemplo | misma tasa; el ejemplo era la respuesta del caso medido |
| `args_so_basico`, `args_so_equivalencias`, `pending_corto`, `pending_corto2`, `pending_ejemplos`, `cand_a`, `cand_b`, `cand_c`, `route_lexico` | primera ronda de `pending`, argumentos y D1 | absorbidas por `prod` (sección 1.6) o sin mejora (`route_lexico`, `pending_ejemplos`, las reglas extra de `cand_b`) |
| `prompt_prueba`, `decision_alt_questions` | pruebas de mecanismo | sin uso (`prod_explicit` ya comprueba el camino `prompts`) |
| `eval/variants/archivo/` (8 variantes de D3 de la primera ronda) | D3 con `tool_rejected` | obsoletas: esa opción ya no existe |

**Variantes que quedan:** `prod` (línea base), `prod_explicit` (comprobación de mecanismo), `route_example` (ejemplo para quien escribe variantes), `args_comando_simple`
(arregla la falla de los procesos con RAM), `d4_j1` (la mejor de D4), `d4_five_way` y `d4_cumple_criteria` (alternativas más simples).

**Datasets eliminados:** `fail_con_razon` y `fail_sin_razon` (la razón sola no tuvo efecto, 30/30 contra 30/30) con su generador `eval/gen/razon_en_fail.ts`, y
`verificacion_corrida` (fixture de comprobación). **Casos obsoletos quitados:** 6 de `scenarios_chains` y 2 de `scenarios_messages` (esperaban `fin` o `ask_user`, que ya no son opciones).
**No se tocaron** los datasets de contexto libre (`agentic_30`, `agentic_hard_40`, `decision_combo_52`, `decision_discriminating`, `llm_generative_48`, `smoke`): se dejan para
probar con las mejores variantes. Ojo: los cuatro primeros conservan 23 casos obsoletos (esperan `tool_rejected`, `fin` o `ask_user`) que fallan por construcción; no cuentan al comparar.

## Cómo reproducir

```bash
# regenerar datasets (los generadores están en eval/gen)
npx tsx eval/gen/reales.ts              # reales_args_review  (desde jarvis-traces.jsonl)
npx tsx eval/gen/mutaciones.ts          # mut_args_review
npx tsx eval/gen/verificacion_vieja.ts  # old_verificacion    (desde la rama main)

# (Las variantes d3_* y el resto de la sección 8 ya no existen: estos comandos documentan cómo se midió, no se pueden repetir tal cual.)
# D3: variantes sobre los tres datasets (corrida del 2026-11-07_034546_d3_final)
npm run eval -- --stages=args_review --dataset=scenarios_args_review,mut_args_review,reales_args_review --variant=prod,d3_checks,d3_checks_any,d3_checks_sincrit,d3_needs,d3_grounded --label=d3_final

# D4 (2026-11-07_034644_d4_final)
npm run eval -- --stages=result_verification --dataset=old_verificacion --variant=prod,d4_cumple_criteria,d4_criteria_dual,d4_j1 --label=d4_final

# cruce con el pre-chequeo (tuberías, falsos rechazos, pareado) y resumen de D4
npm run eval:cross -- --dataset=scenarios_args_review,mut_args_review,reales_args_review --runs=eval/results/qwen3.5_4b/<corrida> --label=x

# falla real de los procesos con más RAM (ram_real y ram_retry_a..d) y validez de sintaxis
npx tsx eval/gen/ram_real.ts && npx tsx eval/gen/ram_retry.ts
npm run eval -- --stages=arguments --dataset=ram_real --variant=prod,args_comando_simple,args_comando_ejemplo --repeat=10 --label=ram_real
npm run eval -- --stages=arguments --dataset=ram_retry_a,ram_retry_b,ram_retry_c,ram_retry_d --variant=prod,args_comando_simple --repeat=10 --label=ram_retry
npm run eval:psvalid -- eval/results/qwen3.5_4b/<corrida>
```

Las variantes antiguas de D3 que usaban `tool_rejected` se eliminaron (sección 8).
