# Frente 3 — Decision: determinismo, reintentos, caché y datos volátiles

> 2026-11-13. Medido contra `d3:2b` real (`/v1/systemone`, Ollama 0.40.13) con las 137 entradas de decisión únicas de las trazas guardadas y los 196 casos de los datasets de D1. Cuando se escribió no se había tocado `src`.
>
> **2026-11-14: implementado en parte.** Mirá «Estado de implementación»; el resto es el análisis y las mediciones originales.

## Estado de implementación (2026-11-14)

Leyenda: ✅ hecho · ⚠ parcial · ⏸ pendiente · ❌ descartado o revertido.

| # | Decisión | Estado | Dónde está |
|---|---|---|---|
| DN-3.1 | Reintento de D1: quitar la ruta fallida | ❌ revertido. La regla para lecturas quitaba la ruta correcta en un test (lectura de terminal con resultado dudoso) y en las trazas no había evidencia a favor. **Vigente la original**: 2 rechazos `not_accomplished` agotan la ruta, y D1 marca `[the last attempt on this route failed]`. Mecanismo nuevo en debate | `engine/limits.ts`, `models/prompts.ts` |
| DN-3.2 | Reintento de D2: quitar la herramienta con `loop_blocked` | ❌ revertido: forzaba otra herramienta, a veces de escritura con aprobación del usuario. Vigente `[FAILED - AVOID]` | `models/prompts.ts` |
| DN-3.3 | Entrada de decisión repetida | ⚠ reutiliza la respuesta ✅; contarla como «sin avance» y fallar el paso ⏸ | `engine/env.ts` (`memoizeDecision`) |
| DN-3.4 | Sin repetición por respuesta inválida (Decision) | ✅ D1 a D5 y D0 | `engine/*` (`queryModel(…, 0)`) |
| DN-3.5 | Caché | ⚠ B (por tarea) ✅ en `memoizeDecision`; C (LRU entre tareas) ⏸ | `engine/env.ts` |
| DN-3.6 | Quitar datos volátiles de las vistas de decisión | ⏸ (con los modelos sin visión las decisiones cuestan 20 a 130 ms: bajó la prioridad) | — |
| DN-3.7 | Orden de las opciones de D2 | ✅ orden del catálogo | `tools/manifest.ts` (`sortByCatalog`) |
| DN-3.8 | Zona de duda en umbrales | ⏸ | — |

**Mecanismo propuesto por el usuario para el reintento (sin implementar):** tras el segundo rechazo de D4 en un mismo paso, cortar el paso y volver a `pending` → D1 (D0 corre solo al empezar la tarea). Hoy un paso no tiene tope por rechazos de D4: solo lo acotan 6 ejecuciones o 10 intentos. Sería una fila nueva en `STEP_RULES` (`engine/limits.ts`) con causa propia.

**Evidencia de las trazas (2026-11-14):** en las 38 trazas con detalle hay 6 rechazos de D4 y ninguno tuvo después una llamada aprobada. De 22 tareas con `loop_blocked` en el índice, 9 completaron (8 con un solo bloqueo): no se puede afirmar que cortar al primer bloqueo sea seguro.

## Resumen

1. **Decision no es determinista bit a bit, pero sí en la práctica.** La misma entrada da la misma elección; la probabilidad se mueve hasta ±0,025 según qué consulta se hizo antes.
2. **Repetir la misma consulta no aporta nada** (0 de 18 correcciones). La marca que hoy se agrega al reintentar D1 tampoco (0 de 18). **Quitar la opción que falló corrige 14 de 18.**
3. **La caché casi no ahorra tiempo** (una decisión cuesta 30 a 50 ms), pero una memoria por tarea da reproducibilidad exacta y sirve de detector de «no hubo avance».
4. **Hay datos volátiles en casi todas las entradas** (ruta de la ref con id de tarea y uuid, ids de llamada, duración y `pid`). No cambian la decisión, pero impiden reutilizar resultados y gastan tokens.

## 1. ¿Misma entrada, misma salida?

`/v1/systemone` no recibe temperatura: devuelve probabilidades calculadas sobre los logits. No hay muestreo que apagar.

| Prueba | Salida idéntica | Diferencia máxima de probabilidad | Decisiones que cambian |
|---|---|---|---|
| A. La misma consulta 10 veces seguidas (60 casos) | 60/60 | 0 | 0 |
| B. La misma consulta con otra consulta previa distinta | 6/60 | 0,023 | 0 |
| C. Tras una llamada al generativo en el medio | 7/20 | 0,023 | 0 |
| D. Tras descargar y recargar el modelo | 1/20 | 0,018 | 0 |
| E. Contra la salida guardada en la traza (otro día) | 1/137 | 0,025 | 1 (D5: de aprobar a rechazar, por 0,007) |
| F. Las mismas opciones `choice` en orden inverso | — | 0,219 | 2/82 |
| G. Las mismas preguntas `noul` en orden inverso | — | 0,000 | 0/37 |

- **Causa de B a E:** el servidor reutiliza el prefijo de la consulta anterior, y el resultado numérico depende de cuánto prefijo reutilizó. En producción ya se ve: en una misma tarea, dos consultas D1 con entrada idéntica dieron 0,831 y 0,849.
- **Alcance real del ruido:** en las trazas, 1 de 74 respuestas de D4 está a menos de 0,03 de su umbral (0,6) y 1 de 18 de D5 del suyo (0,75). En D1 y D2 ninguna elección tiene un margen menor a 0,06 entre la primera y la segunda opción. El ruido afecta a cerca del 2 % de las decisiones con umbral.
- **F importa más que el ruido:** el orden de las opciones mueve la probabilidad hasta 0,22 y cambia 2 de 82 elecciones (una D1 `files` 0,55 → `terminal` 0,65; una D3 `approved` 0,63 → `args_invalid` 0,54). Las rutas salen de una constante (`EXECUTABLE_ROUTES`), orden fijo. **Las herramientas de D2 salen del descubrimiento MCP**: su orden depende del servidor y nada lo fija.
- **G:** las preguntas `noul` se evalúan por separado; su orden no influye.

## 2. Reintentos

### Qué se repite hoy

| Dónde | Qué pasa | ¿Cambia la entrada? |
|---|---|---|
| `queryModel` (`engine/failures.ts`) con `invalidResponseRetries = 1` | Ante una respuesta inválida de Decision, repite la misma consulta | No. Si la respuesta fue inválida por el contenido, volverá a serlo |
| D1 tras un intento rechazado | Agrega el intento a `Attempts not approved` y la marca `[the last attempt on this route failed]` en la opción | Sí, pero no sirve (ver abajo) |
| D1 y D2 tras un `loop_blocked` | Vuelven a consultarse dentro del paso | A veces no: en las trazas, 4 de 58 consultas de D1 y 4 de 58 de D2 fueron byte a byte iguales a una anterior de la misma tarea, con el mismo resultado |
| Generación de argumentos tras un fallo | Sube la temperatura (0,1 → 0,3 → 0,5) con casi el mismo prompt | En la traza del 12/11, 6 salidas idénticas seguidas (`{"path":"C:\\Windows","depth":2}`) |
| Paso nuevo tras una escalación | `pending` reescribe el ítem | En esa traza devolvió el mismo texto 3 veces |

### Qué reintento sí aporta (medido)

Sobre los 18 casos de los datasets de D1 donde la primera elección es incorrecta:

| Reintento | Aciertos |
|---|---|
| Misma consulta | 0/18 |
| Con el intento fallido a la vista (`Attempts not approved`) | 3/18 |
| Intento a la vista + marca en la opción (lo que hace hoy `buildRouteChoice`) | **0/18** |
| **Quitando la opción que falló** | **14/18** |

La marca empeora respecto de mostrar solo el intento: el texto agregado a la descripción de la ruta la refuerza en vez de debilitarla.

### Propuesta: un reintento cambia las opciones o la evidencia, nunca solo una anotación

Tres alternativas para D1 y D2:

| Alternativa | Ventaja | Desventaja |
|---|---|---|
| A. Seguir anotando (hoy) | Sin cambios | Medido: no corrige |
| B. Reformular la pregunta en el reintento | No pierde opciones | Cada redacción de D1 mueve casos ajenos (`docs/limitaciones/d3-2b.md`); hay que medir cada una |
| **C. Quitar del conjunto la opción que falló en el paso** | 14/18; es código; no depende de la redacción | Si la opción quitada era la correcta y falló por los argumentos, se pierde. Mitigación: si no queda ninguna, se ofrecen todas (ya existe para `not_accomplished`) |

**Recomendación: C**, extendiendo lo que el motor ya hace con `maxNotAccomplishedPerRoute` (hoy solo cuenta `not_accomplished` y recién al segundo).

Reglas concretas:

- **R1 (D1):** una ruta deja de ofrecerse en el paso tras el primer intento ejecutado y rechazado por D4, sea `not_accomplished` o `no_usable_data`. Se quita la marca `[the last attempt on this route failed]`.
- **R2 (D2):** una herramienta cuya llamada quedó `loop_blocked` deja de ofrecerse en el paso (el generador ya mostró que repite los argumentos). Se quita `[FAILED - AVOID]`.
- **R3 (entrada repetida):** el motor guarda la huella de cada entrada de decisión de la tarea. Si una entrada se repite, no consulta: reutiliza la respuesta y lo cuenta como «sin avance», lo que falla el paso de inmediato en lugar de gastar otra vuelta.
- **R4 (`queryModel`):** no repetir una consulta de decisión idéntica por respuesta inválida. El transporte ya reintenta los fallos de red.
- **R5 (argumentos):** tras un `loop_blocked`, no subir la temperatura con el mismo prompt: pasar los argumentos bloqueados como valores prohibidos explícitos, o aplicar R2. Subir la temperatura no cambió la salida en ninguno de los 6 intentos vistos.

## 3. Caché de resultados

### Cuánto hay para ganar

- Dentro de una tarea: 8 de 116 consultas de D1 y D2 son idénticas a una anterior (todas en tareas en bucle).
- Entre tareas distintas: 21 de 165 entradas de decisión coinciden con las de otra tarea (13 %), casi todas la D1 de la primera vuelta de un pedido repetido.
- Ahorro por acierto: 30 a 50 ms. Con la VRAM al límite, hasta 1 s si evita el cambio de modelo, pero solo si aciertan todas las decisiones de ese tramo.

### Alternativas

| Alternativa | Qué da | Costo y riesgo |
|---|---|---|
| A. Sin caché (hoy) | — | Ruido de ±0,025 entre repeticiones |
| **B. Memoria por tarea** (`Map` huella → respuesta, vive con la tarea) | Reproducibilidad exacta dentro de la tarea y la señal de R3 | Unas 20 líneas. Sin invalidación: muere con la tarea |
| C. LRU en RAM entre tareas (clave: modelo + huella de `state` y `questions`) | 13 % de aciertos hoy; más si se limpian los datos volátiles | Hay que invalidar al cambiar el modelo o los prompts (resuelto si la clave incluye el modelo y el texto de las preguntas) |
| D. Caché en disco | Sobrevive al reinicio | Estado nuevo en disco por 40 ms: no compensa |

**Recomendación: B ahora** (es la base de R3) **y C después de limpiar los datos volátiles** (sin eso casi no acierta). D descartada.

No cachear: D4 sobre resultados de herramientas con política `retry_failed` o `allow` (el resultado cambia; la entrada también, así que la huella lo cubre sola) ni el juez de fragmentos (la pregunta lleva `TODAY`).

## 4. Datos volátiles en las entradas

Vistos en los prompts reales de las trazas:

| Dato | Dónde aparece | Efecto | Cambio |
|---|---|---|---|
| `ref:r1 (17753, E:\…\data\refs\task_<id>\<uuid>.txt)` | D1 (`Last result`), D4, D5, `pending`, respuesta final | Distinto en cada tarea: ninguna entrada con una ref coincide con otra. Unos 40 tokens que la decisión no usa | Quitar de las vistas de decisión; dejar solo en `args` (única etapa que puede leer la ref) |
| `duration: 0.3s · pid: 3080 · cwd: …` en el resumen de `run_command` | D4, D5, `pending`, final | Cambia en cada ejecución del mismo comando | Sacar del texto; son señales para el código (ver Frente 2, F1) |
| Ids de llamada y paso (`c5 s2`) | Todas las vistas | Estables dentro de la tarea, pero la misma llamada lleva otro id tras un reintento | No mostrarlos a los modelos de decisión |
| `verdict=approved`, `read` | D5, `pending`, D4 (`recent`) | No volátil, pero constante: todo lo que está en DONE está aprobado | Quitar |
| Orden de las herramientas en D2 | `criteria` de `selected_tool` | Depende del orden del descubrimiento MCP; el orden cambia 2 de 82 elecciones | Ordenar por el orden del catálogo (`SYSTEM_TOOL_MANIFEST`) |
| `TODAY` | Juez de fragmentos | Cambia una vez por día: correcto | Dejar |
| Orden de claves del JSON | `JSON.stringify` del payload | Orden de inserción: estable | Nada |

## DECISIONES NUEVAS

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| DN-3.1 | Cómo reintenta D1 | A anotar (hoy) · B reformular · C quitar la ruta fallida | **C**, tras el primer rechazo ejecutado |
| DN-3.2 | Cómo reintenta D2 | A marcar `[FAILED - AVOID]` (hoy) · C quitar la herramienta con `loop_blocked` | **C** |
| DN-3.3 | Entrada de decisión repetida en la tarea | A consultar igual (hoy) · B reutilizar y contar como «sin avance» | **B** |
| DN-3.4 | Repetición por respuesta inválida de Decision | A una repetición (hoy) · B ninguna | **B** |
| DN-3.5 | Caché | A ninguna · B por tarea · C LRU en RAM · D disco | **B ahora, C después de DN-3.6** |
| DN-3.6 | Datos volátiles en vistas de decisión | A dejar · B quitar ruta de ref, ids, duración y `pid` | **B** (coordinado con Frente 2) |
| DN-3.7 | Orden de las opciones de D2 | A el del servidor MCP (hoy) · B el del catálogo | **B** |
| DN-3.8 | Zona de duda en umbrales (±0,03) | A ignorar (hoy) · B registrar en la traza · C tratarla como rechazo | **B**: afecta al 2 % y conviene medirlo antes de cambiar el comportamiento |

## Orden por impacto

1. DN-3.1 y DN-3.2: corrigen 14 de 18 errores de ruta al primer reintento y cortan los bucles de `loop_blocked` (72 de 295 llamadas en las trazas).
2. DN-3.3 con DN-3.5 B: las tareas perdidas fallan antes; reproducibilidad exacta por tarea.
3. DN-3.7: quita la única fuente de variación que cambia elecciones.
4. DN-3.6 y DN-3.5 C: habilitan reutilizar entre tareas y bajan tokens.
5. DN-3.4 y DN-3.8: limpieza y medición.

## Límites

- Una máquina y una sesión. Las pruebas A a G usan entradas reales pero pocas (60 a 137).
- El experimento de reintento usa los 18 errores de los datasets de D1, que escribió una sola persona; el intento fallido se simuló con una línea fija.
- No medí R2 ni R5 con casos propios: se apoyan en lo visto en las trazas.
