# Migración de JARVIS: motor único, decisiones en Eos y memoria por capas

Versión 1.2 · 12 de octubre de 2026 · Base: CORE\_FLOW, ARCHITECTURE, CONTEXT\_AND\_MEMORY y TOOLS\_AND\_SECURITY (revisión 2026-10-11)

## 1. Propósito, alcance y convenciones

Este documento describe qué cambia en JARVIS al pasar del diseño actual (dos bucles de ejecución, cadena D1 → D2 → argumentos → D5, memoria sin transferencia de datos entre pasos) al diseño objetivo. Cubre flujo, lógica, memoria, seguridad, persistencia e interfaz. No contiene código ni cambios de archivos.

**Fuera de alcance:** el catálogo de herramientas (nombres, conteos, descripciones) y las reglas por herramienta. Viven en `DOC_HERRAMIENTAS`. Aquí solo hay mecanismos y reglas por capacidad. Lo que ese documento debe definir está en la sección 21.

**Supuestos de partida (confirmados por el responsable del proyecto):**

- Razonador: Qwen 3.5 9B. Es la única inferencia que cuenta para la latencia.
- Clasificador: Decision 2.0 Eos 0.8B (Eos), con respuesta menor a 1 s y costo despreciable. Fue probado con 20 opciones en una sola pregunta.
- Objetivo de diseño: que Eos tome toda decisión que sea una elección cerrada, y que Qwen solo genere argumentos abiertos, planes, replanes, redacción y la respuesta final.

**Convenciones:**

- **\[HIPÓTESIS\]**: cifra o umbral propuesto, a calibrar con trazas reales. No es un valor final.
- **\[VERIFICAR\]**: afirmación inferida de la documentación que debe confirmarse en el código. La sección 18 las reúne.
- **Hoy** es el comportamiento descrito en la documentación actual. **Objetivo** es el comportamiento tras la migración.

## 2. Resumen ejecutivo

Cinco cambios estructurales y un conjunto de mejoras independientes:

1. **Motor de paso único.** FAST es un plan de un solo paso creado por código, y PLAN un plan de varios pasos generado por Qwen. Ambos usan el mismo motor (`runStep`) con las mismas reglas de terminación, error y recuperación. Solo cambia el *driver* que decide qué hacer cuando un paso termina.
2. **Selección unificada en Eos.** D1 y D2 se fusionan en una pregunta sobre un catálogo plano con prefijo de servidor. Incluye pseudo-herramientas internas (como `recall`). La opción “responder sin herramientas” existe solo en la primera decisión de FAST.
3. **Verificación en dos preguntas binarias separadas** (¿el resultado es válido? ¿se cumple el criterio?), sobre evidencia real y solo con señales limpias. Antes, el código decide el estado de cada efecto con una postcondición. Reemplaza a D5 y al juicio de plan.
4. **Errores por señal y escalación por tabla.** El código decide la respuesta a cada señal. La escalación usa una tabla por causa y Eos decide solo donde la tabla deja varias acciones. Desaparece la Etapa 5B de Qwen.
5. **Memoria por capas con transferencia real:** registro de efectos (`effects`), ledger por paso (solo PLAN), handoff determinista, referencias por placeholder `{{ref:rX}}`, `recall` para salidas no repetibles, evidencia con contenido para el juez y respuesta final armada por rol.

**Presupuestos:** un pool de llamadas elegidas por Eos (30 en PLAN, 15 en FAST), un tope aparte de invocaciones MCP (2× el pool, incluye postcondiciones) y `recall` fuera del pool con tope propio (20).

**Mejoras independientes:** deadline global, timeouts de aprobación y de confirmación del plan, escritura atómica y redacción de datos persistidos, orden de prompt estable, seguridad adicional (11.7) y corrección de inconsistencias de documentación.

**Efecto esperado sobre Qwen (la métrica de latencia):**

| Llamada a Qwen | Hoy | Objetivo |
| --- | --- | --- |
| Plan | Solo PLAN | Solo PLAN. Puede ser un plan vacío en tareas conversacionales |
| Argumentos | 1 por acción | 1 por acción; ninguna si todos los argumentos son deterministas o de elección cerrada |
| Redacción (`compose`) | No existe | 1 por paso `compose` (solo PLAN) |
| Escalación (5B) | 1 por fallo escalado | Eliminada (la deciden el código y Eos) |
| Replan | Solo PLAN | Solo PLAN |
| Respuesta final | 1 | 1 |

Eos hace una selección y dos verificaciones por acción, y decide escalaciones puntuales. Con respuesta menor a 1 s, su costo no pesa en la latencia.

## 3. Diagnóstico del estado actual

Problemas que justifican la migración, con la evidencia que aparece en la documentación vigente.

| ID | Problema | Evidencia en la documentación | Estado |
| --- | --- | --- | --- |
| C1 | Dos motores con reglas propias para lo que debería ser idéntico | Terminación: FAST usa `fin` con umbrales 0.51/0.60 y PLAN usa juicio con 0.60. Recuperación: FAST escala (5B) y PLAN replanifica | Confirmado |
| C2 | “Paso” significa cosas distintas | En FAST cada iteración crea un paso (`MAX_STEPS = 15` limita a \~15 llamadas). En PLAN un paso es un subobjetivo con hasta 4 llamadas | Confirmado |
| C3 | El enrutamiento tiene autoridad distinta según el modo | En PLAN el diagrama va de `PlanStepLoop` directo a `ExecCall`, sin D1. `suggested_mcp` del planner sería la ruta | Parcial. \[VERIFICAR\] |
| C4 | `fin` mezcla “¿la meta está cumplida?” con “¿a dónde voy?” | Umbral asimétrico, validación de `fin` y redirección forzada a un servidor por defecto | Confirmado |
| C5 | El juez ve metadatos, no contenido | D5 recibe un resumen estructurado de hasta 400 caracteres. El hallazgo (`finding`) se recorta a 120. La observación compacta (hasta 1.500) se inyecta a Qwen, no a Decision | Parcial. \[VERIFICAR\] qué recibe `buildDecisionJudgement` |
| C6 | La memoria almacena pero no transfiere | `FACTS` guarda identificadores, no valores. `LAST` es una sola observación. `[... omitido, ref:rX]` es un puntero que ningún modelo puede seguir. La respuesta final usa las últimas 3 EVID por recencia | Confirmado |
| C7 | La escalación resuelve el problema equivocado | Solo permite `switch_mcp` o `abort`. `excludedToolForNextCall` y `[ya falló - EVITAR]` impiden reintentar la misma herramienta con argumentos corregidos | Confirmado |
| C8 | Decisiones deterministas pasan por un modelo | La regla de override de D5 (confianza < 0.50 y `exit_code = 0`) corrige al modelo cuando ignora señales ya conocidas | Confirmado |
| C9 | Sin deadline de tarea | Tope de 30 llamadas, Qwen hasta 120 s (180 s con thinking) y MCP 30 s por llamada. El peor caso son decenas de minutos | Confirmado |
| C10 | Aprobación sin expiración | La compuerta espera indefinidamente hasta que el usuario resuelva o cancele | Confirmado |
| C11 | Salida de argumentos limitada a 1.024 tokens | Impide copiar contenidos largos entre herramientas (informes, archivos) | Confirmado |
| C12 | Persistencia y privacidad débiles | `writeFileSync` directo, argumentos y observaciones en claro, prompts completos en consola | Confirmado |
| C13 | Sin continuidad entre tareas | `sessionHistory` son strings. `needs_context` no tiene consumidor documentado | Confirmado |
| C14 | El planner no conoce el catálogo de herramientas | `PROMPTS.PLAN` solo produce `suggested_mcp` y `expected_outcome` | \[VERIFICAR\] |
| C15 | El orden de bloques del prompt de argumentos perjudica la caché de prefijo | `LOG`, `PLAN`, `FAIL` y `FACTS` (dinámicos) van antes de `TOOL` y `SCHEMA` | Confirmado |
| C16 | Mutaciones sin postcondición verificable | Las mutaciones (archivo, borrado, proceso, descarga) solo devuelven un mensaje de éxito: el juez no ve el efecto | Parcial |
| C17 | Salidas no repetibles inaccesibles | `RefStore` es solo del ejecutor: las salidas de comandos, de procesos y de páginas cambiantes no se pueden releer | Parcial |
| C18 | Superficie de seguridad sin cubrir | Las acciones de UI son `ALLOW` automático, los comandos de arranque de servidores MCP no fijan versión, no hay marca de contenido no confiable y la lectura de secretos no tiene control | Confirmado en la documentación |

**Ejemplo de C6.** En la traza de Node.js, el paso de escritura conoce la versión solo porque `LAST` contiene la observación inmediata anterior (la búsqueda). Con un paso intermedio, ese dato se perdería: `FACTS` solo tendría la URL.

## 4. Principios y reparto de responsabilidades

Regla única: **si se deduce de señales, decide el código. Si es una elección entre opciones cerradas, decide Eos. Si hay que producir texto o estructura nueva, produce Qwen.**

| Decisión o tarea | Hoy | Objetivo |
| --- | --- | --- |
| Respuesta a señales de error, anti-loop, presupuestos, reintentos, sustitución de referencias, handoff, ensamblado de contexto, Guard | Mezcla de código y modelos | Código |
| Estado de cada efecto tras una mutación (confirmado, confirmado por señal, no confirmado, contradicho) | Estado `UNVERIFIED` sin evidencia | Código, con una postcondición por capacidad (6.8) |
| Argumentos con valor fijo (p. ej. las lecturas de postcondición) | Qwen o código según el caso | Código |
| Responder sin herramientas o usar una herramienta, y cuál (incluye las pseudo-herramientas internas) | D1 y D2 (dos llamadas) | Eos, una sola pregunta |
| ¿El resultado es válido? | D5 | Eos, solo con señales limpias |
| ¿Se cumple el criterio del paso? | Juicio de plan (solo PLAN) | Eos, en ambos modos |
| Escalación tras fallo | Qwen (Etapa 5B) | Tabla por causa (código). Eos solo donde la tabla deja varias acciones |
| Argumentos que son elecciones entre candidatos conocidos | Qwen | Eos sobre una lista armada por código, con opción “ninguno” |
| Argumentos abiertos (texto, rutas nuevas, contenido, comandos) | Qwen | Qwen |
| Plan, replan y redacción (`compose`) | Qwen (plan y replan) | Qwen |
| Respuesta final | Qwen | Qwen |

## 5. Modelo de datos objetivo

**Jerarquía:** Tarea → Plan → Paso\[\] → Llamada\[\].

**Plan.**

- En FAST es un plan de un solo paso, generado por código. La meta del paso es el mensaje del usuario, el criterio es la propia meta y el presupuesto es el pool de la tarea. No hay llamada a Qwen ni confirmación.
- En PLAN lo genera Qwen y requiere confirmación del usuario. Puede ser un plan vacío si la tarea es conversacional: en ese caso no hay confirmación y Qwen responde directamente.

**Paso.** Campos funcionales:

- `goal`: una frase con la meta del paso.
- `type`: `tool` (por defecto) o `compose` (6.7).
- `criterion`: descripción de la evidencia observable que demuestra el cumplimiento (no valores aún desconocidos).
- `routeHint`: pista opcional de subsistema. Es información para Eos, no una orden.
- `inputsFrom`: identificadores de pasos anteriores cuyos datos necesita, cuando no es el inmediato anterior.
- `budget`: tajada de llamadas del paso (12.1).
- `result`: resultado breve (≤ 160 caracteres) y referencias informativas, rellenados al cerrar. Solo PLAN.
- `status`: `PENDING`, `RUNNING`, `WAITING_APPROVAL`, `DONE`, `BLOCKED`, `EXHAUSTED`, `CANCELLED`.
- `blockedCause`: denegación, rechazo explícito o aprobación pendiente, para que el driver distinga los bloqueos.

**Llamada.** Registra: herramienta elegida (con prefijo de servidor) y confianza de selección, argumentos como plantilla (con placeholders) y como valores resueltos, decisión de Guard, señales, evidencia con contenido, resultado de la postcondición, veredictos de Eos (`ok` y `cumple`, cada uno con su confianza) y motivo de bloqueo si lo hubo.

**Efectos (`effects`): definición única.** Un efecto es el registro de una mutación realizada por la tarea, con cinco campos:

- **capacidad:** la clase de la acción (escritura de archivo, borrado, proceso, descarga, UI, comando, configuración).
- **destino:** sobre qué se actuó (ruta, PID, ventana, clave de configuración).
- **estado:** `confirmado` (la postcondición coincide), `confirmado por señal` (sin postcondición, pero con código de salida 0, salida limpia y `ok` positivo; es más débil que `confirmado`), `no confirmado` (no hay postcondición disponible o la evidencia es ambigua) o `contradicho` (la postcondición lo contradice con evidencia inequívoca).
- **llamada de origen:** la llamada que produjo el efecto.
- **procedencia:** `usuario`, `local` o `web`, según el origen del contenido. Es `web` si alguna referencia marcada como web contribuyó; las marcas se heredan (9.3).

`effects` es la fuente única de “qué hizo la tarea”. **Sustitución:** el último estado por (capacidad, destino) prevalece, de modo que un efecto `contradicho` que un reintento corrigió deja de figurar como contradicho. El historial se conserva aparte. **Compactación:** las listas que reciben `cumple` y la respuesta final se agrupan por capacidad y se limitan a 12 líneas \[HIPÓTESIS\]. Usos:

1. Evidencia de `cumple`: lista determinista de efectos (6.4 y 7.2).
2. Umbral asimétrico: un efecto `confirmado` habilita cerrar con `cumple` ≥ 0.60 (7.5).
3. Complemento del `LOG` en FAST (9.1).
4. Respuesta final: declarar efectos `no confirmado` o `contradicho` y listar los procesos que siguen activos (9.5 y 11.6).
5. Banner de aprobación: avisar si un archivo a ejecutar fue escrito en la tarea con contenido web (11.2).
6. Resumen de salida para la tarea siguiente (9.9) y restricciones por efecto (candidato, 11.7).

**Marca `tainted` (por tarea).** Pasa a verdadero cuando contenido web entra al contexto o a `RefStore`. Se guarda en el esquema (13.1). Es una señal de contexto y es pegajosa, por eso no genera avisos por sí sola: el aviso del banner sale de la procedencia de cada efecto (11.2).

**Cambios de semántica:**

- Un paso es siempre una meta con criterio. Una llamada es siempre una invocación de herramienta. FAST muestra un paso con N llamadas.
- `UNVERIFIED` deja de ser un estado que fluye por el sistema. Pasa a ser el estado del efecto (`confirmado`, `confirmado por señal`, `no confirmado`, `contradicho`).
- Los estados de tarea no cambian: `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED`.
- `effects` nace en la Fase 2 en versión mínima (capacidad, destino, procedencia), derivada de Guard. El estado y las postcondiciones llegan en la Fase 4a (sección 15).

## 6. Flujo objetivo

### 6.1 Visión general

1. Se recibe la instrucción y el modo. Se crea la tarea en `RUNNING` con su deadline global. Un health check liviano (un ping, sin inferencia) comprueba que Eos y Qwen respondan. Si no, la tarea falla de inmediato con un aviso.
2. Se obtiene el plan. En FAST lo crea el código (un paso). En PLAN lo genera Qwen y puede ser vacío si la tarea es conversacional: entonces no hay confirmación y Qwen responde directamente. Si el plan tiene pasos, se espera la confirmación del usuario. Esa espera no cuenta para el deadline y expira a los 30 min (configurable): la tarea pasa a `CANCELLED` con el motivo “plan sin confirmar”.
3. Por cada paso se ejecuta el motor de paso (6.2).
4. El driver del modo decide qué hacer según el resultado del paso (6.3).
5. Al concluir, Qwen redacta la respuesta final (9.5).

### 6.2 Motor de paso (`runStep`)

Un paso `compose` no usa este motor: se aplica 6.7. Para los demás pasos, se repite mientras queden llamadas en el pool de la tarea y en la tajada del paso, y no haya vencido el deadline:

1. **Contexto.** Se construye la vista única de estado del paso (9.7).
2. **Selección (Eos).** Una pregunta sobre el catálogo plano (7.1), que incluye las pseudo-herramientas internas. Devuelve una herramienta o, solo en la primera decisión de FAST, “responder sin herramientas”.
3. **Validación de existencia.** Si la herramienta no figura en Discovery, el adaptador refresca el caché una vez y revalida. Es del adaptador MCP, no del flujo.
4. **Argumentos.** Por el camino que corresponda: determinista (código), elección cerrada (Eos sobre una lista del código, con “ninguno”) o abierto (Qwen con schema, placeholders y error previo). Hasta 2 reintentos de schema. Una salida truncada (`finish_reason = length`) cuenta como argumentos inválidos.
5. **Sustitución de referencias.** Los `{{ref:rX}}` se reemplazan por el contenido real, solo en los parámetros permitidos (9.3). Una referencia sensible exige aprobación.
6. **Anti-loop** sobre los argumentos ya resueltos (11.3).
7. **Guard** sobre los argumentos reales: `ALLOW`, `APPROVAL` (con timeout) o `DENY`.
8. **Despacho.** Una pseudo-herramienta interna (`recall`) la atiende el ejecutor. Lo demás va al adaptador MCP, que absorbe las señales propias del servidor (como el elemento obsoleto), los timeouts y la reconexión. El flujo solo ve un resultado o un error tipificado.
9. **Procesamiento.** `ResultProcessor` calcula señales, hallazgo, observación compacta, `RefStore` y deltas, y marca `tainted` y las referencias sensibles.
10. **Señales de error.** Si hay alguna (salvo un timeout en una mutación, que pasa al paso 11), se aplica la política por señal (sección 8). No se consulta a Eos y no hay postcondición.
11. **Postcondición.** Solo si la llamada volvió sin error o tras un timeout en una mutación. El código ejecuta la lectura de la capacidad (6.8) y decide: confirmada, contradice la mutación o no disponible. Tras un timeout, la postcondición decide: si confirma, la señal de timeout se sanea y la llamada sigue como exitosa; si contradice, es un fallo; si no está disponible, se escala con causa “timeout sin verificación” y no se reintenta la mutación. Está exenta de la política por señal y del anti-loop. Actualiza `effects`.
12. **Verificación (Eos).** Con señales limpias (o saneadas por la postcondición) y sin contradicción, dos preguntas binarias separadas sobre evidencia real (7.2).
13. **Veredicto.** El paso cierra `DONE`, continúa o agota su presupuesto (`EXHAUSTED`), según 7.5.

### 6.3 Drivers por modo

| Resultado del paso | Driver FAST | Driver PLAN |
| --- | --- | --- |
| `DONE` | Concluir `COMPLETED` | Siguiente paso. Si no quedan, concluir |
| `EXHAUSTED` (presupuesto agotado o `abort` con causa “inalcanzable”) | Concluir `PARTIAL` o `FAILED` y explicar qué faltó | `handleReplan`, hasta `MAX_REPLAN` |
| `BLOCKED` (DENY o rechazo explícito del usuario) | Concluir `PARTIAL` indicando qué se bloqueó | Replan una vez con la restricción registrada (“no proponer X”). Si choca de nuevo, concluir `PARTIAL` |
| `BLOCKED` (aprobación sin respuesta) | Concluir `PARTIAL` como “pendiente de aprobación” | Igual: sin replan ni restricción registrada |
| Deadline o presupuesto global agotado | Concluir `PARTIAL` | Concluir `PARTIAL` |
| Cancelación del usuario | `CANCELLED` | `CANCELLED` |

El replan es el único lugar donde se exploran alternativas tras una denegación. Dentro del paso, la escalación no replanifica ni concluye la tarea: `abort` devuelve el paso al driver como `EXHAUSTED` con causa “inalcanzable”.

### 6.4 Terminación

- **El cierre lo decide `cumple`, no la elección de `fin`.** Desaparecen la validación de `fin`, el umbral asimétrico 0.51/0.60 y la redirección forzada.
- **Conversación directa.** Solo en la primera decisión de FAST, Eos puede elegir “responder sin herramientas”. Qwen redacta la respuesta y la tarea concluye sin ejecutar nada. En PLAN cumple ese papel un plan vacío.
- **Criterio acumulativo en FAST.** El criterio es la meta completa del usuario. `cumple` se evalúa con el `LOG` completo del paso (hasta 15 líneas de ≤ 100 caracteres) y la lista determinista de `effects`, no solo con la última llamada. FAST no tiene ledger. En PLAN, los pasos son cortos y basta la evidencia de la última llamada más el handoff. Como opción posterior a la medición, la primera selección incluye una pregunta `multi_paso` (`noul`) para ofrecer pasar a PLAN.
- **Estados finales.** `COMPLETED`: pasos cumplidos. `PARTIAL`: hubo avance pero se agotó presupuesto, deadline, escalaciones o replanes, o hubo bloqueo terminal o aprobación sin respuesta (“pendiente de aprobación”). `FAILED`: sin avance útil o error irrecuperable. `CANCELLED`: cancelación del usuario, plan sin confirmar o reinicio del servidor.

### 6.5 Qué desaparece del flujo

- `runFastLoop` como bucle distinto de PLAN.
- La validación de `fin`, el umbral 0.60 post-acción y la redirección forzada.
- La Decision #2 como llamada separada.
- La Etapa 5B de Qwen.
- El estado de paso `UNVERIFIED` como flujo propio.
- El colapso estadístico de `LOG` (`1-N: X ok, Y err`).
- El bloqueo por “2 `blocked_loop` seguidos” como regla propia: pasa por la escalación general.

### 6.6 Ejemplo: la traza de Node.js en FAST

Instrucción: “Busca en la web la versión actual de Node.js y guárdala en un archivo version.txt”.

1. El código crea un plan de un paso (meta = mensaje, criterio = meta).
2. **Llamada 1.** Eos elige la búsqueda web. Qwen genera los argumentos. Guard: `ALLOW`. Señales limpias. Entra contenido web: `tainted` pasa a verdadero. Eos: `ok` sí, `cumple` no (falta guardar el archivo).
3. **Llamada 2.** Eos elige `write_file`. Qwen escribe el contenido con el `LOG` y la observación anterior. Guard: `APPROVAL`; el banner indica que el contenido proviene de la web. El usuario autoriza y la llamada vuelve sin error.
4. **Postcondición.** El código lee de vuelta el archivo: existen y coinciden tamaño y comienzo. El efecto queda `confirmado` con procedencia `web`.
5. Eos: `ok` sí y `cumple` sí con confianza ≥ 0.60. El paso cierra `DONE` y la tarea concluye sin una decisión extra de `fin`.
6. Qwen redacta la respuesta final con el `LOG` y `effects`.

Qwen se invoca 3 veces (2 de argumentos y 1 final). El pool gasta 2 llamadas y hay 3 invocaciones MCP (2 más la postcondición), dentro del tope de 30.

### 6.7 Pasos `compose` (redacción sin herramienta)

Un paso `compose` es un paso de plan sin herramienta, para redactar contenido (informe, resumen, borrador) que un paso posterior usará. El planner lo marca con `type: compose`. No existe en FAST: allí la síntesis es la respuesta final.

- Qwen redacta el texto (hasta 1.500 tokens, la misma etapa que la respuesta final) con la meta del paso y la evidencia informativa disponible.
- El texto se guarda en `RefStore` como referencia informativa y el ledger conserva solo un `result` de hasta 160 caracteres. El paso siguiente lo usa con `{{ref:rX}}`. Esto evita el límite de 1.024 tokens de los argumentos.
- No pasa por selección, Guard ni verificación de Eos: el paso es `DONE` si el texto no está vacío. Cuenta como una llamada de Qwen, no como llamada del pool ni invocación MCP.
- Si la salida se trunca (`finish_reason = length`), se reintenta una vez pidiendo un texto más breve. Si vuelve a truncarse, el paso es `DONE` con la referencia marcada “contenido parcial”, y la respuesta final lo declara.
- El planner no lo usa para responder al usuario: eso es la respuesta final.

* La referencia producida hereda las marcas “web” y “sensible” de la evidencia que usó (9.3).

### 6.8 Postcondiciones por capacidad

Tras una mutación, el código ejecuta una lectura `ALLOW` sin LLM, elegida por la capacidad que Guard ya clasifica. El resultado actualiza `effects` y alimenta `ok` y `cumple`.

| Capacidad | Postcondición | Confirmada si | Contradice si (solo evidencia inequívoca) |
| --- | --- | --- | --- |
| Escritura de archivo (`FILE_WRITE`) | Leer de vuelta el destino | Existe y, en una escritura completa, coinciden tamaño y comienzo (se normalizan saltos de línea y codificación) | No existe. Una diferencia de contenido, y cualquier edición parcial o anexado, queda “no confirmado”: no hay tamaño esperado definido |
| Borrado (`FILE_DELETE`) | Comprobar el destino | No existe (un `not_found` es éxito) | Sigue existiendo |
| Inicio de proceso (`PROCESS_CONTROL`) | Comprobar el PID | PID activo | Nunca. Un PID inexistente queda “no confirmado”: un proceso corto pudo terminar antes de la lectura |
| Terminación de proceso (`PROCESS_CONTROL`) | Comprobar el PID | PID inexistente | Nunca. Un PID activo queda “no confirmado”: puede tardar en terminar |
| Descarga (`DOWNLOAD`) | Comprobar el archivo descargado | Existe y su tamaño es mayor que 0 | No existe. Tamaño 0 queda “no confirmado” |
| Acción de UI (`UI_ACTION`) | Observar los cambios de la ventana con el identificador del almacén | Hay cambios | Nunca. Sin cambios queda “no confirmado” |
| Ejecución de comandos (`COMMAND_EXECUTION`) | Sin postcondición genérica. Si el contrato declara un destino verificable, se lee | El contrato lo declara y coincide | Solo si el contrato declara un destino y la evidencia es inequívoca. Sin declaración, el efecto queda “confirmado por señal” si el código de salida es 0, la salida es limpia y `ok` es positivo; si no, “no confirmado” |
| Configuración (`CONFIGURATION`) | Releer el valor modificado | El valor coincide | Solo si el contrato declara comparación exacta y el valor difiere. Si no, “no confirmado” |
| Por defecto (capacidad no listada o sin lectura disponible) | Ninguna | Nunca | Nunca. Queda “no confirmado” |

- **Quién decide:** el código, sin Eos ni Qwen. Resultados: *confirmada* (efecto `confirmado`), *contradice la mutación* (efecto `contradicho`, solo con evidencia inequívoca), *confirmado por señal* (solo comandos sin postcondición) y *no disponible o ambigua* (efecto `no confirmado`). Cualquier diferencia ambigua es `no confirmado`.
- **Cuándo corre:** solo si la llamada volvió sin error o tras un timeout en una mutación.
- **Tras un timeout, la postcondición decide.** Si confirma, la señal de timeout se sanea y la llamada sigue como exitosa. Si contradice, es un fallo. Si no está disponible, se escala con causa “timeout sin verificación” y no se reintenta la mutación.
- **Contradicción y reintento:** una contradicción es un fallo y la mutación no se repite a ciegas. Solo se reintenta si la herramienta es idempotente (sección 21) o después de volver a comprobar el estado.
- **Exenciones:** no pasa por la política por señal ni por el anti-loop. Por eso un `not_found` tras un borrado es éxito.
- **Presupuesto:** no cuenta contra el pool. Sí cuenta contra el tope de invocaciones MCP (12.1). Se registra en la misma línea de su llamada en el `LOG` (9.8).
- **Por herramienta:** qué lectura se usa y con qué argumentos lo define el manifiesto de herramientas (sección 21). Los argumentos son deterministas.

## 7. Decisiones de Eos

### 7.1 Selección unificada (reemplaza D1 y D2)

- **Catálogo plano** con prefijo de servidor, más las pseudo-herramientas internas (por ejemplo, `recall`), que el manifiesto marca como internas. El tamaño actual está muy por debajo del rango admitido de 2 a 255 opciones. El responsable ya probó 20 opciones con buen resultado.
- **Opción “responder sin herramientas”** solo en la primera decisión de FAST. Es la conversación directa que hoy cubre `fin` en la primera iteración.
- **Descripciones** de una línea (primera oración, hasta 80 caracteres, como hoy). Presupuesto estimado del catálogo: \~1.000 tokens. \[HIPÓTESIS\]
- **Estado que recibe Eos:** meta del paso, `routeHint` como pista, resumen del ledger (PLAN) o `LOG` del paso (FAST), intentos previos con su causa, restricciones registradas por el replan y la última observación compacta.
- **Filtros por código antes de preguntar:** se excluyen servidores no disponibles y herramientas vetadas por una restricción del replan (“no proponer X”).
- **Advertencias anti-repetición** como información del estado, distinguiendo “ya ejecutada con estos argumentos” de “falló por argumentos” (esta última no veta la herramienta).
- **Una sola opción disponible:** se selecciona sin inferencia, como hoy.
- **Fallback por confianza:** bajo el mínimo de selección \[HIPÓTESIS: 0.50\], se repite la misma pregunta solo con las 5 mejores candidatas de la primera pasada y descripciones ampliadas. Es un único camino: no se conserva la lógica de dos etapas.
- **Si el catálogo crece** más allá de \~60 opciones, se prefiltra por servidor activo o por `routeHint`.
- **Validación previa a adoptarla:** armar \~50 casos reales (incluyendo ambiguos) y comparar la precisión de la llamada única contra la cadena de dos llamadas. Adoptar si la diferencia es de 2 puntos o menos. \[HIPÓTESIS\]

### 7.2 Verificación en dos preguntas binarias (reemplaza D5 y el juicio de plan)

**Precondición:** señales limpias (sin `not_found`, `denied`, `empty_output`, `stale_element`; `exit_code` 0 o ausente; sin `isError`; un `timeout` solo si la postcondición lo sanó, 6.8) y una postcondición que no contradiga la mutación. Si hay señal de error, se aplica la sección 8. Si la postcondición contradice, es un fallo (7.3).

| Pregunta | Qué responde | Entrada |
| --- | --- | --- |
| `ok` | ¿El resultado es una respuesta válida y utilizable (no un error disfrazado ni una página vacía)? | Señales, resumen, observación compacta (hasta 1.500 caracteres) y lectura de postcondición, si existe |
| `cumple` | ¿La evidencia demuestra el criterio del paso? | Criterio, observación compacta, lectura de postcondición (si existe) y, en FAST, el `LOG` del paso. En ambos modos, la lista de `effects` compactada |

- Son **dos llamadas independientes y binarias**, que pueden ejecutarse en paralelo. Se descarta fusionarlas: con un modelo de 0.8B, las preguntas combinadas suelen calibrar peor, y cada llamada es barata.
- **Umbrales y cierre:** ver 7.5.
- `ok` = no: primero un reintento informado con el motivo (por ejemplo, una consulta mal formulada). Solo tras dos resultados con `ok` = no y argumentos distintos se veta la herramienta en el paso (sección 8).
- `ok` = sí y `cumple` bajo el umbral: el paso continúa dentro de su presupuesto.
- **Sin postcondición disponible:** el efecto queda `no confirmado` y se exige el umbral mayor (7.5).
- **Eos inaccesible:** la tarea concluye `PARTIAL` (si hubo avance) o `FAILED`. No hay fallback determinista, porque la selección y la escalación también dependen de Eos.
- Desaparece la regla de override de D5 (confianza < 0.50 con `exit_code = 0`): su motivo era corregir al modelo contra señales que ahora el código consulta primero.

* **La postcondición prueba el efecto, no el contenido.** Que el archivo exista con lo que Qwen escribió no demuestra que el contenido responda al criterio (por ejemplo, que la versión sea la correcta). Por eso `cumple` recibe también la lectura de postcondición y la evalúa contra el criterio.

### 7.3 Escalación (reemplaza la Etapa 5B de Qwen)

**Cuándo se activa:** el paso acumula dos fallos seguidos, se agotan los reintentos de argumentos, hay `blocked_loop`, `not_found` persiste tras el reintento informado, una postcondición contradice la mutación o un timeout de mutación queda sin postcondición disponible (“timeout sin verificación”). No se activa tras `DENY`, rechazo explícito del usuario ni aprobación sin respuesta: esos casos son terminales para el paso y los resuelve el driver.

**Primero una tabla determinista por causa. Eos decide solo donde la tabla deja varias acciones.** Así se reduce la varianza de un modelo de 0.8B y se evita que juzgue si la meta es inalcanzable.

| Causa | Acciones posibles | Decide |
| --- | --- | --- |
| `not_found` persistente, con `ask_user` habilitado | `switch_tool` o `ask_user` | Eos |
| `not_found` persistente, sin `ask_user` | `switch_tool` | Tabla |
| Argumentos inválidos agotados | `switch_tool` | Tabla |
| `blocked_loop` | `switch_tool` | Tabla |
| `exit_code` distinto de 0 repetido | `retry_with_hint` o `switch_tool` | Eos |
| Postcondición que contradice la mutación | `retry_with_hint` o `switch_tool`, solo si la herramienta es idempotente o tras comprobar el estado. Si no, `abort` | Eos |
| Timeout de mutación sin postcondición, con `ask_user` habilitado | `ask_user` o `abort`. Nunca reintentar la mutación | Eos |
| Timeout de mutación sin postcondición, sin `ask_user` | `abort` | Tabla |
| Veto por dos `ok` = no | `switch_tool` | Tabla |
| Sin alternativa, o escalaciones o presupuesto agotados | `abort`: devuelve el paso al driver como `EXHAUSTED` con causa “inalcanzable” | Tabla |

**Acciones:**

- `retry_with_hint` repite selección y argumentos con el motivo del fallo.
- `switch_tool` elige otra herramienta (del mismo servidor o de otro) vetando la que se demostró inadecuada.
- `ask_user` pide un dato con un mensaje armado por plantilla y requiere un estado de paso nuevo (13.3). \[HIPÓTESIS: puede entrar en una fase posterior\]
- `abort` devuelve el paso al driver como `EXHAUSTED` con causa “inalcanzable”. Dentro del paso, la escalación nunca replanifica ni concluye la tarea: `replan` y la conclusión las decide el driver (6.3).

**Contexto de Eos cuando decide:** causa tipificada, herramienta y argumentos resumidos, intentos previos, restricciones registradas y escalaciones restantes. `MAX_ESCALATIONS = 2` aplica a `switch_tool` y `ask_user`. `retry_with_hint` consume pool y tajada. Con unas 20 tareas fallidas la muestra es chica para calibrar la escalación, por eso se empieza con la tabla. \[HIPÓTESIS\]

### 7.4 Elecciones cerradas dentro de los argumentos

Cuando un argumento es una elección entre candidatos conocidos, el código arma la lista y Eos elige. Qwen genera solo el resto de los argumentos.

- Con 0 candidatos se vuelve al camino abierto (Qwen). Con 1, el código lo toma sin inferencia. Con 2 o más, decide Eos con una opción adicional “ninguno”. Si elige “ninguno” o su confianza queda bajo el mínimo, se vuelve al camino abierto (Qwen). Así se evita, por ejemplo, un clic equivocado en una acción de UI, que es `ALLOW`.
- Qué argumentos son elecciones cerradas y de dónde salen sus candidatos lo define el manifiesto de herramientas (sección 21). Las herramientas con argumentos totalmente deterministas se saltan a Qwen por completo.

### 7.5 Umbrales y calibración

| Umbral | Hoy | Objetivo |
| --- | --- | --- |
| `fin` (normal / post-acción) | 0.51 / 0.60 | Desaparece |
| Override de D5 | 0.50 | Desaparece |
| `ok` | Sin umbral propio (D5 con override) | ≥ 0.60 |
| `cumple` en un paso sin mutación, o con postcondición confirmada | 0.60 (solo PLAN) | ≥ 0.60 |
| `cumple` en un paso con mutación sin postcondición confirmada | No existe | ≥ 0.75 |
| Dependencia de contexto | 0.60 | Se mantiene, con consumidor definido en 9.9 |
| Mínimo de selección | No existe | 0.50, para disparar la segunda pasada |

- Con postcondición confirmada, el paso cierra con `ok` y `cumple` ≥ 0.60. Sin ella, en un paso con mutación, se exige `cumple` ≥ 0.75.
- Entre 0.60 y 0.75 en ese caso, el paso continúa dentro de su presupuesto. Si lo agota, queda `EXHAUSTED`. Un falso `cumple` tras una mutación cuesta más que un falso `ok`, por eso el umbral mayor.
- Los valores 0.60, 0.75 y 0.50 son iniciales. \[HIPÓTESIS\]
- **Calibración:** recolectar trazas `[Decision → SEND/RECV]` de al menos 30 tareas exitosas y 20 fallidas \[HIPÓTESIS\] y medir falsos positivos y negativos de `cumple`. Los umbrales se congelan solo en la Fase 6.

* Un efecto `confirmado por señal` no habilita el umbral 0.60: en un paso con mutación exige `cumple` ≥ 0.75.

### 7.6 Ventana y presupuesto de Eos

- Ventana operativa 8.192 tokens, como hoy. La nativa de Eos admite hasta 16.384 y no se sube salvo necesidad demostrada.
- El estimador pasa de `chars / 3.5` a `chars / 3`, porque 3.5 es optimista para español, JSON y rutas de Windows. \[HIPÓTESIS\]
- Orden de descarte: historial antiguo, notas de intentos, resumen del ledger. El catálogo y las preguntas nunca se recortan. Si no cabe, error controlado (como hoy).

## 8. Errores y reintentos por señal

**Principio:** primero señales, después modelo. Se distingue “la herramienta falló” de “los argumentos eran malos”: solo lo primero justifica vetar una herramienta.

| Señal | Respuesta determinista |
| --- | --- |
| `denied` (Guard `DENY`) | Paso `BLOCKED`, terminal. Se registra el motivo. Sin búsqueda de rodeos en el bucle. Decide el driver |
| Rechazo explícito del usuario | Igual que `DENY`, incluyendo el motivo opcional que escribió el usuario |
| Aprobación sin respuesta (timeout) | Resultado propio, no un rechazo: paso `BLOCKED` con causa “aprobación pendiente”. La tarea concluye `PARTIAL` como “pendiente de aprobación”, sin replan ni restricción registrada |
| `not_found` | Un reintento informado de la misma herramienta con el error en el contexto de argumentos (por ejemplo, una ruta mal adivinada). Si persiste, escalación |
| `empty_output` (herramientas con `emptyIsError`) | Un reintento con argumentos distintos (otra consulta, otro patrón). Si persiste, escalación |
| Argumentos inválidos, incluida una salida truncada (`finish_reason = length`) | Hasta 2 reintentos de schema con el error previo. Si la causa es truncamiento, el error pide usar `{{ref:rX}}` o un contenido más corto. Si se agotan, escalación con causa “argumentos”. No veta la herramienta |
| `stale_element` | El adaptador refresca el árbol y reintenta una vez, sin que el flujo lo vea. Si persiste, fallo normal |
| `timeout` de MCP | Lectura: un reintento. Mutación: la postcondición (6.8) decide. Si confirma, la señal se sanea y la llamada sigue como exitosa. Si contradice, es un fallo. Si no está disponible, se escala con causa “timeout sin verificación”. Nunca se repite una mutación a ciegas. Para comandos largos se usa el timeout propio de la herramienta (sección 21) o la ejecución en segundo plano con sondeo |
| `exit_code` distinto de 0 | Fallo lógico. La salida de error pasa al contexto. Reintento informado dentro del presupuesto y luego escalación |
| `ok` = no con señales limpias | Reintento informado con el motivo. Veto de la herramienta solo tras dos resultados con argumentos distintos |
| Postcondición que contradice la mutación | Fallo lógico. No se repite la mutación a ciegas. Solo se reintenta si la herramienta es idempotente o tras comprobar el estado: reintento informado o `switch_tool` (7.3) |
| Postcondición no disponible | El efecto queda `no confirmado` y la respuesta final lo declara. No se reintenta la mutación |
| `blocked_loop` | No es un error del servicio. Pasa por la escalación general. Desaparece la regla de “2 bloqueos seguidos” |
| Servidor MCP caído | Se marca no disponible, se excluyen sus herramientas del catálogo y se escala con `switch_tool` |
| Eos inaccesible | La tarea concluye `PARTIAL` (si hubo avance) o `FAILED`. Eos decide también la selección y la escalación, por lo que no hay fallback |
| Qwen inaccesible o timeout | En argumentos, fallo del paso. En la conclusión, respuesta sintética estructurada (como hoy) |
| Pool, tope de invocaciones MCP o deadline agotado | Conclusión `PARTIAL` |

- `excludedToolForNextCall` queda reservado para “esta herramienta no sirve” (dos `ok` = no con argumentos distintos y señales limpias). Nunca se aplica por `not_found` ni por argumentos inválidos.
- Toda causa de fallo o bloqueo se registra **tipificada** (señal, herramienta, argumentos resumidos, motivo) y viaja a la selección, la escalación y el replan, para que el sistema no vuelva a proponer la misma acción bloqueada.

## 9. Memoria y contexto

**Principio:** el contexto es una función pura del estado. Todos los prompts (de Qwen y de Eos) se construyen desde una única vista del estado, con presupuesto por bloque y orden de descarte explícito.

### 9.1 Capas de memoria

| Capa | Contenido | Vida | Quién la lee |
| --- | --- | --- | --- |
| Paso | `LOG` completo (≤ 100 caracteres por línea; hasta 15 líneas en FAST y 8 en PLAN \[HIPÓTESIS\]), `FAIL`, `LAST` | El paso | Eos (selección y verificación), Qwen (argumentos) |
| Efectos (`effects`) | Registro de mutaciones definido en la sección 5 | La tarea | Eos (`cumple`), respuesta final, banner de Guard |
| Ledger (solo PLAN) | Por paso: estado, `result` (≤ 160 caracteres) y referencias informativas | La tarea | Qwen (como `PREV`), replan, respuesta final, Eos (resumen) |
| Facts y punteros | Un solo almacén clave-valor (`path`, `url`, `window_handle`, `element_id`, `process_id`, candidatos) | La tarea | Todos |
| `RefStore` | Contenido íntegro de cada resultado, con marcas “sensible” y “web” | La tarea | El ejecutor (sustitución de placeholders), la pseudo-herramienta `recall` (a través del ejecutor) y el constructor de la respuesta final. Ningún modelo lo lee directamente |
| Resumen de salida | `FACTS` finales, resultado final y `effects` (≤ 500 caracteres) | La sesión | Tarea siguiente, si `needs_context` lo activa |
| Restricciones registradas | “No proponer X” del replan y rechazos explícitos, con su causa tipificada | La tarea | Eos (selección y escalación) y replan |

### 9.2 Handoff determinista entre pasos (PLAN)

Al cerrar un paso en `DONE`, el motor guarda su `result` (el hallazgo de la llamada que cumplió el criterio) y marca como **informativa** la observación de la última lectura exitosa del paso. El paso siguiente recibe `PREV` (resultado del paso anterior más esa observación, con tope de \~1.500 caracteres \[HIPÓTESIS\]) y `LAST` (la última observación del paso actual). Si el planner declara `inputsFrom`, se traen del ledger los datos de pasos no inmediatos, con el mismo tope. No requiere ninguna llamada a Qwen. FAST no tiene handoff: es un solo paso.

**Referencias informativas en FAST.** Como FAST no tiene handoff, son informativas las lecturas exitosas del paso ordenadas por recencia, con la primera lectura o búsqueda del paso siempre incluida (9.5).

**Extracción fundamentada (opcional, tras la medición de la Fase 1).** Solo cuando un paso posterior declara `inputsFrom`: Qwen extrae los valores necesarios en JSON con campos nulables y el código comprueba que cada valor aparezca literalmente en la evidencia; si no aparece, se descarta. Cuesta una llamada de Qwen únicamente en pasos con dependencia y evita valores inventados.

### 9.3 Referencias por placeholder y `recall`

- Qwen escribe `{{ref:rX}}` en un argumento. El ejecutor sustituye el contenido real **antes** del anti-loop y de Guard, por lo que Guard evalúa los argumentos reales.
- Esto hace accionable el puntero `ref:rX` y elimina el límite práctico de 1.024 tokens de salida para contenidos largos.
- **Catálogo de referencias:** una línea por ref en el prompt de argumentos (por ejemplo, `r1: búsqueda web, 5 resultados, 4 KB`), las últimas \~8. \[HIPÓTESIS\]
- Una referencia inexistente es un error de argumentos (reintento con el error previo).
- **Parámetros permitidos.** Por defecto, los placeholders están prohibidos. El manifiesto de herramientas declara los parámetros de contenido donde se admiten. Quedan siempre prohibidos en parámetros de comando, ruta y URL, y en la entrada de texto de UI (escribiría contenido no confiable en la ventana enfocada). Una referencia con contenido web nunca llena un parámetro prohibido.
- **Referencias sensibles.** La referencia de la lectura de una ruta sensible se marca “sensible”. Usarla en un placeholder exige `APPROVAL` en esa llamada (11.1).
- **Contenido omitido.** Para un archivo largo basta volver a leerlo con desplazamiento y longitud. Para las demás salidas se usa `recall`.
- **`recall(ref, rango o expresión regular)`** es una pseudo-herramienta interna de solo lectura (`READ`) sobre `RefStore`. Eos la elige en la selección y elige el `ref` (7.4); Qwen fija el rango. Pasa por el anti-loop (repetir la misma referencia y rango se bloquea) y queda registrada en el `LOG`. No es una invocación MCP: queda fuera del pool y del tope MCP, con tope propio de 20 por tarea. Sobre una referencia sensible devuelve contenido redactado. La respuesta final no usa `recall` (9.5).
- **Persistencia:** el `StepCall` guarda la plantilla con placeholders y, del contenido resuelto, solo tamaño y huella (11.5).
- **Topes:** `RefStore` por referencia y por tarea \[HIPÓTESIS: 2 MB y 20 MB\], y 1 MB de contenido sustituido por llamada \[HIPÓTESIS\]. Al superar el tope de `RefStore` se descartan primero las referencias no informativas más antiguas.

* **Herencia de marcas.** Una referencia derivada (de un paso `compose` o de una extracción fundamentada) hereda las marcas “web” y “sensible” de las referencias que usó. Así no se blanquea contenido no confiable ni se evade el aviso de procedencia.

### 9.4 Evidencia para el juez

- La pregunta `cumple` recibe criterio más observación compacta, no solo el hallazgo de 120 caracteres.
- Al planificar, Qwen redacta `expected_outcome` describiendo el **tipo de evidencia observable** (“resultados que mencionen la versión actual”), no valores todavía desconocidos. Esto se instruye en el prompt de plan.

### 9.5 Respuesta final por rol, no por recencia

Qwen recibe:

- `GOAL`.
- En FAST, el `LOG` completo y `effects`. En PLAN, el ledger completo y `effects`.
- `FACTS`.
- Porciones de referencias informativas (en FAST, según la regla de 9.2), que arma el constructor con presupuesto dinámico: llena el espacio de entrada libre por prioridad (informativas, luego la última lectura exitosa, luego el resto) \[HIPÓTESIS: \~15.000 caracteres con ventana de 8.192\]. Si trunca una referencia, la marca “contenido parcial”.
- La lista de efectos `no confirmado` o `contradicho`, de bloqueos o denegaciones y de procesos que siguen activos (11.6).

Debe declarar lo no confirmado, el contenido parcial y, en `PARTIAL`, qué faltaba. Para tareas de transformación (“lee este archivo y resúmelo”), el constructor incluye porciones del archivo; la respuesta final no invoca `recall`.

**Truncamiento.** Si la respuesta termina con `finish_reason = length`, se regenera una vez pidiendo concisión. Si vuelve a truncarse, se entrega con la nota “respuesta truncada”.

La limpieza de `RefStore` al concluir se mantiene y debe cubrir también excepciones y cancelación. \[VERIFICAR\] `core.ts`.

### 9.6 Unificación de `FACTS` y `Scratchpad`

Hoy coexisten dos almacenes con claves solapadas, y `facts.path` y `facts.url` adoptan el primer resultado hallado. Objetivo: **un solo almacén** con nombres canónicos. El valor vigente es el seleccionado de forma explícita (por Eos en 7.4 o por uso en una llamada exitosa). Los candidatos se guardan en una lista aparte.

### 9.7 Ensamblado con presupuesto único y orden estable

Un solo constructor recibe (estado, etapa) y aplica prioridades.

- **Presupuesto de entrada** = 8.192 − `max_tokens` − margen (el pensamiento también consume salida). Estimador `chars / 3`. \[HIPÓTESIS\]
- **Orden de descarte:** contexto de charla, `FAIL` antiguos, líneas antiguas del `LOG` del paso, recorte de `PREV`. El system prompt, la meta y el schema nunca se recortan.
- **Orden de bloques en el prompt de argumentos** (por frecuencia de cambio, para reutilizar el prefijo en llama.cpp):

| Hoy | Objetivo |
| --- | --- |
| system, `GOAL`, `CHAT`, `LOG`, `PLAN`, `FAIL`, `FACTS`, `TOOL`, `SCHEMA`, `LAST`, `ERROR_PREVIO`, `TASK` | system, `GOAL`, `PLAN` (ledger), `PREV`, `FACTS`, catálogo de refs, `LOG` del paso, `FAIL`, y al final `TOOL`, `SCHEMA`, `LAST`, `ERROR_PREVIO`, `TASK` |

`TOOL` y `SCHEMA` van al final porque cambian con cada selección y romperían el prefijo reutilizable. La mejora de latencia depende de que Ollama conserve el slot entre llamadas. **\[MEDIR\]** el tiempo de prefill antes y después.

### 9.8 Qué pasa con el `LOG`

El `LOG` de cada paso se conserva completo, con líneas de ≤ 100 caracteres (hasta 15 en FAST y 8 en PLAN). La postcondición de una llamada se registra en la misma línea de esa llamada, y `recall` no abre línea propia: se anota en la línea de la llamada a la que sirve. Así el `LOG` no supera su tope aunque haya postcondiciones. El colapso estadístico `1-N: X ok, Y err` se elimina: en PLAN el ledger da la vista macro, y en FAST el `LOG` completo más `effects` la reemplazan.

### 9.9 Continuidad entre tareas

Al concluir una tarea se guarda un resumen de salida: `FACTS` finales, resultado final y `effects` (≤ 500 caracteres). Se inyecta en la tarea siguiente solo si Eos activa `needs_context` (umbral 0.60). Esto da por primera vez un consumidor a `needs_context` y resuelve seguimientos como “ahora bórralo”. Alcance: la sesión. La memoria a largo plazo queda fuera de esta migración.

### 9.10 Límites: de hoy a objetivo

| Límite | Hoy | Objetivo |
| --- | --- | --- |
| `LOG` | Colapso al superar 12 líneas, conserva 6 | `LOG` completo por paso (≤ 100 caracteres por línea; 15 líneas en FAST, 8 en PLAN) |
| `FAIL` | 5 más recientes | 5 recientes por paso, con causa tipificada, más las restricciones del replan, que persisten |
| Historial a Decision | 3 `LOG` + 2 `FAIL`, hasta 4.000 caracteres | Vista única con presupuesto por bloque |
| Intentos (`MAX_ATTEMPTS` / `MAX_NOTE_CHARS`) | 8 / 60 | Se mantienen |
| Resumen de resultado (`MAX_RESULT_CHARS`) | 400 | Se mantiene como cabecera. El juez recibe además la observación compacta |
| Hallazgo (`finding`) | 120 caracteres | Etiqueta del ledger. `result` hasta 160 |
| Observación compacta | 1.500 caracteres | Se mantiene |
| Evidencia en respuesta final | Últimas 3 | Porciones por prioridad con presupuesto dinámico (\~15.000 caracteres) |
| `MAX_SCRATCHPAD_CHARS` | 2.000 | Se integra en el almacén único |

## 10. Cambios en el uso de Qwen

| Etapa | Hoy | Objetivo | Salida máxima |
| --- | --- | --- | --- |
| Plan (solo PLAN) | Descompone en hasta 15 pasos con `suggested_mcp` y `expected_outcome` | Hasta 8 pasos o plan vacío. Recibe el catálogo de herramientas por servidor (\~300 tokens). Produce criterio observable, marca los pasos de redacción como `compose` y, opcionalmente, `inputsFrom` | 1.500 |
| Argumentos (Etapa 3) | Todos los campos | Solo los campos abiertos. Admite placeholders `{{ref:rX}}` | 1.024 |
| Redacción (`compose`, solo PLAN) | No existe | Texto para un paso posterior (6.7) | 1.500 |
| Escalación (Etapa 5B) | Elige `switch_mcp` o `abort` | **Eliminada.** La deciden el código y Eos | n/a |
| Replan (solo PLAN) | Reformula los pasos restantes | Recibe las restricciones registradas (herramientas denegadas, rechazos) y el ledger | 1.500 |
| Respuesta final (Etapa 6) | Basada en `LOG`, `FACTS` y las últimas 3 EVID | Según 9.5 | 1.500 |
| Conversación directa | `fin` en la primera iteración | Prompt corto, sin ledger. En PLAN, tras un plan vacío | 1.500 |

- **Truncamiento:** se detecta `finish_reason = length` en argumentos (8), `compose` (6.7) y respuesta final (9.5). \[VERIFICAR\] que el cliente de Qwen lo exponga.
- **Thinking:** el ajuste del usuario aplica solo a plan, replan, pasos `compose` y respuesta final. Según ARCHITECTURE, la generación de argumentos nunca está entre las etapas con `reasoning_effort`. \[VERIFICAR\] en `dispatchPrompt` y mantenerla sin thinking.
- **Timeouts:** se mantienen 120 s (180 s con thinking). El deadline global se aplica por encima (12.2).
- **Métrica de latencia:** llamadas a Qwen por tarea y, por llamada, el tiempo de prefill frente al de generación.

## 11. Seguridad y Guard

La política de Guard (`ALLOW`, `APPROVAL`, `DENY`) sigue siendo determinista e independiente de los modelos. Cambian los puntos donde se aplica y algunos detalles operativos.

### 11.1 Guard sobre argumentos reales y secretos

- La sustitución de `{{ref:rX}}` ocurre antes del anti-loop y de Guard. Guard y la inspección de comandos ven siempre el contenido real.
- **Rutas sensibles.** Una lista configurable de patrones (por ejemplo, archivos `.env`, claves y credenciales \[HIPÓTESIS\]) define qué es sensible. Guard exige `APPROVAL` al leer una ruta sensible, también cuando aparece dentro de la cadena de un comando: la detección de rutas sensibles se integra en `isSafeReadonlyCommand`, de modo que `cat` y similares sobre una ruta sensible dejan de ser lectura segura. La observación se redacta en los prompts de Eos y Qwen mediante patrones de secretos. Su referencia queda marcada “sensible”, la marca se hereda (9.3) y la referencia no puede usarse en un placeholder sin aprobación en esa llamada. El manifiesto de herramientas declara cuáles leen rutas sensibles (sección 21).
- **Diseño deliberado.** El modelo nunca ve el valor de un secreto, aunque el usuario apruebe la lectura. Si la tarea necesita usarlo (por ejemplo, para configurar algo), lo hace con `{{ref:rX}}` y aprobación en esa llamada: el ejecutor sustituye el valor sin pasarlo por el prompt.

### 11.2 Aprobaciones

- **Timeout configurable** \[HIPÓTESIS: 10 min\]. Al vencer no se trata como rechazo: el paso queda bloqueado por “aprobación pendiente” y la tarea concluye `PARTIAL`. Hoy la compuerta espera indefinidamente.
- **Cancelación** explícita del usuario: se mantiene.
- **Alcance** por invocación única: se mantiene. No hay autorización permanente.
- **Motivo del rechazo:** el texto opcional del usuario viaja al replan como restricción registrada. Solo los rechazos explícitos generan restricción; el timeout no.
- **GuardBanner** muestra la herramienta, la ruta o el destino y el comando completo. Para contenido, una vista previa acotada (\~500 caracteres) con opción de expandir, el tamaño y una cuenta regresiva del timeout. El usuario no aprueba a ciegas lo que se va a escribir o ejecutar.
- **Aviso de procedencia web.** Si se aprueba ejecutar un archivo que la misma tarea escribió con contenido web (un efecto con procedencia `web`), el banner lo indica. El aviso sale de la procedencia de cada efecto; `tainted`, que es pegajosa, no genera avisos por sí sola.
- El tiempo de espera de una aprobación **no consume el deadline** (12.2).

### 11.3 Anti-loop

- Se calcula sobre los **argumentos ya resueltos** (con huella del contenido), de modo que escribir dos veces el mismo contenido se detecta.
- La documentación actual lo describe como “firma repetida sin lectura intermedia” pero la firma usa `nonReadCounter`. Se **fija una sola semántica**: se bloquea la repetición idéntica de una llamada si no hubo ninguna mutación entre ambas. Las exenciones de sondeo vigentes se mantienen. \[VERIFICAR\] qué hace hoy el código.
- **Nueva exención:** lecturas mientras haya procesos en segundo plano activos en la tarea, porque su contenido cambia sin mutación intermedia.
- Las postcondiciones están exentas (6.8). `recall` sí pasa por el anti-loop (9.3).
- Un `blocked_loop` pasa por la escalación general (sección 8).

### 11.4 Catálogo plano y herramientas no registradas

Con el catálogo plano, toda herramienta nueva que descubra un servidor sería una opción para Eos. La heurística actual de `getPolicy()` clasifica como `READ` (con `ALLOW`) los nombres con prefijo de lectura y sin términos destructivos, así que una herramienta de nombre inofensivo que mute estado se ejecutaría sin aprobación. Propuesta: una herramienta no registrada se ofrece a Eos solo si la heurística la clasifica como `READ`; las demás no se ofrecen hasta registrarlas en el manifiesto de herramientas (sección 21), del que se deriva el `PolicyRegistry`.

### 11.5 Persistencia y privacidad

- **Escritura atómica** de `jarvis-tasks.json` (archivo temporal y renombrado) en lugar de `writeFileSync` directo.
- **Argumentos sensibles:** el `StepCall` persistido guarda la plantilla con placeholders y, del contenido resuelto, tamaño y huella. Los textos escritos y los contenidos de archivos no se almacenan en claro.
- **Evidencia persistida:** `obs`, el `result` del ledger y los valores de `FACTS` también pueden contener secretos. Antes de persistir se aplica redacción por patrones y un tope de tamaño. Las lecturas de rutas sensibles no se persisten.
- **Consola:** los prompts completos (`[Decision → SEND]`, `[Qwen → SEND]`) se emiten solo en modo depuración y con los mismos enmascarados.
- Fuera del alcance mínimo (decisión abierta): cifrado en reposo.

### 11.6 Cancelación, procesos y concurrencia

- **Cancelación con llamada MCP en vuelo:** la tarea pasa a `CANCELLED`, el resultado tardío se descarta y `RefStore` se limpia en toda ruta de salida. \[VERIFICAR\] `core.ts`.
- **Procesos:** los procesos que la tarea inició (efectos de inicio de proceso) se terminan **solo al cancelar**. Al concluir no se terminan: la respuesta final lista los que siguen activos.
- **Concurrencia:** se mantiene la advertencia actual (varias tareas sobre la UI interfieren en foco y controles). Opción recomendada pero no obligatoria: un bloqueo por recurso.

* **Limpieza de procesos activos.** Si la tarea concluye sin cancelar, o tras un reinicio, los procesos solo se listan. Como `effects` guarda los PID y se persiste, la interfaz ofrece una acción de limpieza que termina los procesos activos de esa tarea, con `APPROVAL`.

### 11.7 Superficie de seguridad adicional

Riesgos que el rediseño no crea pero conviene cerrar a la vez, con la fase propuesta en el plan (sección 15).

| Riesgo | Mitigación | Fase |
| --- | --- | --- |
| Acciones de UI sobre ventanas sensibles (terminal, diálogo Ejecutar) evitan la inspección de comandos | Todo `UI_ACTION` exige `APPROVAL` cuando la ventana enfocada es sensible, no solo escribir texto. \[VERIFICAR\] cómo identificarla | 2 |
| Comandos de arranque de servidores MCP sin versión fijada | Fijar la versión de cada servidor | 0 |
| Procesos que siguen activos tras concluir | Terminarlos solo al cancelar. La respuesta final lista los activos y la interfaz ofrece una acción de limpieza (11.6) | 2 |
| Contenido web no confiable en el contexto | Procedencia por efecto como señal principal, marcas “web” heredadas por las referencias derivadas, referencias web prohibidas en parámetros no permitidos (9.3) y banner de aprobación. `tainted` queda como señal de contexto | 2 (`effects` mínimo y banner) y 4a (placeholders) |
| Lectura de secretos, incluida la que ocurre dentro de un comando (`cat` y similares) | `APPROVAL` al leer rutas sensibles, detección en la cadena del comando (11.1), observación redactada y referencia sensible sin uso en placeholders sin aprobación | 2 (Guard y redacción) y 4a (placeholders) |
| Ejecución de un archivo escrito en la misma tarea con contenido web | El banner indica la procedencia web del archivo (11.2) | 2 (con `effects` mínimo) |
| Mismo efecto por otra vía tras un rechazo | Registrar (capacidad, destino) de cada rechazo explícito. Una llamada posterior con el mismo efecto exige `APPROVAL` citando el rechazo | Candidato posterior a la Fase 1 |

## 12. Presupuestos y límites

### 12.1 Tabla de límites

| Límite | Hoy | Objetivo |
| --- | --- | --- |
| Pasos del plan (`MAX_STEPS`) | 15. En FAST limita de hecho las llamadas a \~15 | Máximo 8 en PLAN. En FAST el paso es único \[HIPÓTESIS\] |
| Pool de llamadas elegidas por Eos (`MAX_TOOL_CALLS_TASK`) | 30 | 30 en PLAN y 15 en FAST. Cada llamada MCP elegida por Eos gasta una unidad, incluidos los reintentos informados. \`recall\` y \`compose\` no gastan. Los reintentos del adaptador (elemento obsoleto, lectura reintentada por timeout) no gastan pool pero sí cuentan en el tope MCP \[HIPÓTESIS\] |
| Tajada por paso (`MAX_TOOL_CALLS_PER_STEP`) | 4 (solo PLAN) | 4 iniciales por paso en PLAN. Lo no gastado vuelve al pool de la tarea |
| Tope de invocaciones MCP | No existe | 2× el pool: 60 en PLAN y 30 en FAST. Incluye las postcondiciones y los reintentos del adaptador \[HIPÓTESIS\] |
| `recall` | No existe | Fuera del pool y del tope MCP. Tope propio de 20 por tarea |
| Pasos `compose` | No existen | No gastan pool ni tope MCP. Cuentan como una llamada de Qwen |
| `MAX_ARG_RETRIES` | 2 | Se mantiene |
| `MAX_ESCALATIONS` | 2 | Se mantiene. Aplica a `switch_tool` y `ask_user` |
| `MAX_REPLAN` | 2 | Se mantiene. Lo gasta el driver (6.3). Un bloqueo terminal admite un solo replan con la restricción registrada |
| Deadline global de tarea | No existe | Nuevo \[HIPÓTESIS: 10 min, configurable\] |
| Timeout de aprobación | No existe | Nuevo \[HIPÓTESIS: 10 min, configurable\]. Resultado propio, no rechazo (sección 8) |
| Expiración de la confirmación del plan | No existe | Nuevo: 30 min, configurable. La tarea pasa a `CANCELLED` (6.1) |
| Timeouts de Qwen / MCP / Eos | 120 s (180 s con thinking) / 30 s / 30 s | Se mantienen. Timeout propio por herramienta donde el manifiesto lo declare |
| Topes de `RefStore` | No existen | Por referencia y por tarea \[HIPÓTESIS: 2 MB y 20 MB\]. Contenido sustituido por llamada: 1 MB \[HIPÓTESIS\] |
| Presupuesto de tokens de entrada | Por bloque, repartido | Contexto − `max_tokens` − margen, con descarte ordenado |

### 12.2 Deadline global

- Es un reloj de tarea que **excluye** los tiempos de espera del usuario: aprobaciones, confirmación del plan y, si existe, `ask_user`.
- Se comprueba antes de cada llamada a Qwen, a Eos y a una herramienta. Al vencer no se inician llamadas nuevas. La llamada ya en vuelo se espera hasta su timeout y luego la tarea concluye `PARTIAL`.
- La interfaz muestra el tiempo restante y avisa al acercarse al límite.

## 13. Persistencia, API e interfaz

### 13.1 Esquema de `jarvis-tasks.json`

Un único esquema versionado (`schemaVersion`). Tarea: identificador, modo, mensaje, estado, plan con pasos (puede ser vacío), `effects` (definido en la sección 5), marca `tainted`, ledger (solo PLAN), almacén único de hechos, referencias con sus marcas “sensible” y “web”, restricciones registradas, uso de presupuesto (llamadas del pool, invocaciones MCP, `recall`, escalaciones, replanes, inicio, deadline, tiempo en espera), resumen de salida y respuesta final. Paso y llamada: como en la sección 5. Se conservan las últimas 20 tareas.

### 13.2 Migración de tareas persistidas

- Antes del primer arranque con el esquema nuevo se hace una **copia de respaldo** del archivo.
- Las tareas terminadas con el esquema viejo se **convierten a solo lectura** (los pasos FAST, uno por llamada, se agrupan en un paso con N llamadas y se marcan “histórico, no reanudable”) o se **descartan** si la conversión resulta costosa. Decisión abierta (sección 20).
- Las tareas `RUNNING` o `WAITING_APPROVAL` al reiniciar siguen pasando a `CANCELLED`, como hoy. No hay reanudación automática.

### 13.3 API y eventos

- **Endpoints actuales:** se mantienen (`process`, `confirm-plan`, `approve`, `deny`, `cancel`, `state`, `events`).
- **Aprobación con timeout:** emite `APPROVAL_RESOLVED` con resolución “timeout”. La expiración de la confirmación del plan emite un evento propio.
- **Eventos nuevos:** selección tomada (herramienta y confianza), resultado de postcondición, resultado de verificación (`ok` y `cumple` con confianza), escalación decidida (acción y causa), aviso de presupuesto o deadline.
- **Si se incorpora `ask_user`:** un estado de paso nuevo (`WAITING_INPUT`) y un endpoint para la respuesta del usuario. Si no se incorpora, la acción queda fuera.

* **Limpieza de procesos:** un endpoint para terminar los procesos activos de una tarea, con aprobación.

### 13.4 Interfaz

- **Timeline y ProcessFlow:** interpretan un solo esquema (paso con N llamadas). FAST muestra un paso.
- **ContextInspector:** muestra las capas de memoria (paso, `effects`, ledger, hechos, referencias, resumen de salida) y el uso de tokens por bloque.
- **DecisionStream:** muestra la selección, las dos verificaciones con su confianza y las escalaciones.
- **GuardBanner:** comando completo, vista previa acotada del contenido (\~500 caracteres, expandible), tamaño, aviso de procedencia web y cuenta regresiva del timeout.
- **Marcas visibles:** estado de cada efecto (`confirmado`, `confirmado por señal`, `no confirmado`, `contradicho`), tiempo restante del deadline, procesos activos (con acción de limpieza) y restricciones registradas por el replan.

## 14. Impacto por documento y módulo

### 14.1 Documentación a reescribir

| Documento | Qué cambia |
| --- | --- |
| CORE\_FLOW | Diagrama de flujo único (motor de paso y drivers), tabla de pasos, decisiones, iteraciones y límites, tabla de errores por señal y traza de ejemplo |
| ARCHITECTURE | Componentes (motor de paso y drivers en lugar de dos bucles; Eos con selección, verificación y escalación; Qwen sin Etapa 5B), tabla de modelo y parámetros (umbrales), reparto código / Eos / Qwen |
| CONTEXT\_AND\_MEMORY | Construcción del contexto (orden estable), capas de memoria, `effects`, evidencias, datos enviados a modelos y límites |
| TOOLS\_AND\_SECURITY | Ejecución (sustitución de refs, postcondiciones, política por señal), aprobaciones (timeout), seguridad (sección 11) y persistencia. La tabla de permisos por capacidad no cambia. El catálogo y las reglas por herramienta pasan a `DOC_HERRAMIENTAS` |
| `DOC_HERRAMIENTAS` | Se genera desde el manifiesto tipado de herramientas (sección 21) |

### 14.2 Módulos afectados (conceptualmente)

| Módulo | Cambio funcional |
| --- | --- |
| Motores de ejecución (`modeEngines`) | Se convierten en motor de paso más dos drivers. Desaparecen la validación de `fin` y la escalación por Qwen |
| Ejecutor de llamadas (`callExecutor`) | Sustitución de placeholders con parámetros permitidos, `recall`, postcondiciones por capacidad, política por señal, anti-loop sobre argumentos resueltos |
| Motor de decisión (`decision`) | Selección, verificación (dos preguntas) y escalación por tabla más Eos. Elecciones cerradas de argumentos |
| Razonador (`qwen`) | Sin Etapa 5B. Argumentos con placeholders. Redacción `compose`. Replan con restricciones. Detección de truncamiento |
| Prompts (`prompts`) | Orden estable, catálogo en el plan, criterio observable, plan vacío, constructor único con presupuesto |
| Contexto (`context`) | `effects`, ledger (PLAN), almacén único de hechos, handoff, resumen de salida |
| Procesador de resultados (`resultProcessor`) | Evidencia con contenido, marca informativa, catálogo de referencias, marcas `tainted`, “sensible” y “web” |
| Orquestador (`core`) | Deadline, presupuestos, expiración del plan, cancelación con llamada en vuelo, persistencia atómica y migración |
| Tipos (`types`) | Modelo Tarea → Plan → Paso → Llamada, `effects`, estados de paso, causas tipificadas |
| Política (`guard`, `policyRegistry`) | `APPROVAL` en lecturas de rutas sensibles (incluidas las que aparecen dentro de un comando) y en `UI_ACTION` sobre ventanas sensibles. Sin otros cambios de política |
| Interfaz | Según 13.4 |

## 15. Plan de migración por fases

Cada fase tiene un criterio de salida y una forma de revertirla. Las fases 2, 3, 4a y 4b aportan valor aunque la Fase 5 se posponga.

| Fase | Contenido | Criterio de salida | Reversión |
| --- | --- | --- | --- |
| 0. Sin cambio de comportamiento | Escritura atómica y redacción de datos persistidos (11.5). Versiones fijas de los servidores MCP (11.7). Reordenamiento de los bloques actuales del prompt (estable primero). Corrección de la documentación (sección 19) | Las tareas actuales funcionan igual. Prefill de Qwen medido antes y después | Revertir cada cambio |
| 1. Medición y contrato de herramientas | Trazas `[Decision → SEND/RECV]` y fixtures para replay. Resolver los \[VERIFICAR\] (sección 18). Armar los 50 casos de selección y la línea base de llamadas a Qwen y latencia. Experimento con un `num_ctx` mayor en Qwen (no en Eos). Calibración de las preguntas binarias de Eos (`choice` o `noul`). **Entregable: el manifiesto tipado de herramientas y `DOC_HERRAMIENTAS` generado desde él (sección 21)**, con los pendientes por herramienta resueltos | Informe con decisiones sobre 7.1 (una o dos llamadas), postcondiciones (6.8), 7.4, `num_ctx` y candidatos posteriores. Manifiesto y documento aprobados | No aplica |
| 2. Cambios de comportamiento y seguridad (con flags) | **Requiere el manifiesto (Fase 1).** Deadline global y presupuestos (pool y tope MCP). Timeouts de aprobación y de confirmación del plan. Política por señal. Anti-loop con semántica fija y exención por procesos (11.3). Herramientas no registradas (11.4). `effects` mínimo (capacidad, destino, procedencia), derivado de Guard. GuardBanner con comando completo y aviso de procedencia (11.2). Seguridad (11.7): ventanas sensibles, secretos (Guard, detección en comandos y redacción), procesos activos y su limpieza, `tainted`. Health check liviano | Las tareas actuales no regresionan con los flags activos. Los casos de seguridad pasan | Un flag por mejora |
| 3. Eos y `runStep` | Selección unificada con respaldo de 5 candidatas, verificación en dos preguntas con umbrales 0.60 y 0.75, escalación por tabla más Eos, Qwen 5B desactivada. Se extrae `runStep` como frontera de función sobre el motor actual, con el adaptador “un paso por llamada” para FAST. Test diferencial FAST ≡ PLAN de un paso, que se escribe aquí y corre desde entonces | Precisión de selección no inferior a la línea base. Falsos positivos de `cumple` aceptables. Escalación sin regresiones. El test diferencial corre y registra sus divergencias | Flag que restaura D1 + D2, D5 y 5B |
| 4a. Memoria base | **Requiere el manifiesto (Fase 1).** Placeholders con parámetros permitidos y referencias sensibles, con marcas heredadas. `recall`. `effects` completo (estado y postcondiciones) sobre el mínimo de la Fase 2. Evidencia para el juez. `LOG` completo. Respuesta final por rol con presupuesto dinámico y detección de truncamiento. Almacén único y ensamblador único. Ledger y handoff para PLAN | Las tareas multi-paso con transferencia de datos pasan, incluida la que tiene un paso intermedio. “No confirmado” es excepcional. Mejora de prefill medida | Flag por mecanismo |
| 4b. Planner, `compose`, elecciones cerradas y continuidad | Planner con catálogo, criterio observable, plan vacío y pasos `compose`. Elecciones cerradas con opción “ninguno” (según el manifiesto). Continuidad entre tareas (9.9) | Un plan de 8 pasos con `compose` y datos compartidos pasa. El seguimiento “ahora bórralo” funciona | Flag por mecanismo |
| 5. Modelo de datos e interfaz | Esquema nuevo, migración de persistencia e interfaz. FAST pasa a ser un plan de un paso. Como `runStep` ya existe, esta fase solo cambia el modelo de datos | Suite de regresión FAST y PLAN equivalente a la actual | Restaurar la copia de respaldo y el flag al modelo anterior |
| 6. Limpieza | Retirar código y flags antiguos y los adaptadores heredados (incluido “un paso por llamada”). Congelar umbrales. Reescribir los cuatro documentos. Módulo único de constantes y manifiesto, con un script que genera las tablas de los documentos. Tablas de transición tipadas con tests. El test diferencial FAST ≡ PLAN pasa a ser permanente. Verificar que no haya dependencias circulares | Tablas de los documentos generadas desde las constantes. Los tests pasan | No aplica |

**Nota sobre la Fase 3.** Hasta que existan las postcondiciones (Fase 4a), toda mutación exige `cumple` ≥ 0.75. Una caída de la tasa de éxito en esa etapa no es una regresión.

**Puerta antes de la Fase 5.** Es la fase de mayor costo porque cambia el modelo de datos, la persistencia y las vistas. La puerta se decide con dos medidas que pueden salir distintas, tomadas durante las fases 3 a 4b: (a) incidentes atribuibles a los adaptadores heredados o a las ramas por modo en la interfaz y la persistencia, registrados con su costo; (b) divergencias FAST ≢ PLAN de un paso que el test diferencial detecta y que no se pueden corregir en el adaptador. La Fase 5 se ejecuta si (a) llega a 3 incidentes o (b) detecta al menos una divergencia no corregible \[HIPÓTESIS\]. Si ninguna se cumple, la Fase 5 se pospone y solo se migra o descarta el historial (13.2).

**Candidatos posteriores a la Fase 1.** Extracción fundamentada (9.2), restricciones por efecto (11.7), pregunta `multi_paso` en FAST (6.4) y bloqueo por recurso (11.6). Se programan según la medición, entre la 4b y la 6.

## 16. Validación y métricas

| Métrica | Cómo se mide | Objetivo \[HIPÓTESIS\] |
| --- | --- | --- |
| Llamadas a Qwen por tarea (media y p90) | Trazas `[Qwen → SEND]` | Menor que la línea base (al menos 1 menos por tarea con escalación) |
| Latencia total de tarea (p50 y p90) | Tiempos de la tarea | Menor que la línea base |
| Prefill frente a generación en Qwen | Duraciones por llamada | Prefill menor tras el reordenamiento de prompt |
| Precisión de selección | Set de \~50 casos etiquetados | No inferior a la cadena D1 + D2 |
| Falsos positivos y negativos de `cumple` | Al menos 50 pasos etiquetados a mano | Falsos positivos mínimos (son los que cierran en falso) |
| Efectos `no confirmado` o `contradicho` | Estado final de `effects` | `no confirmado` excepcional |
| Reintentos informados que corrigen `not_found` | Trazas por señal | Mayor que cero. Antes era imposible |
| Invocaciones MCP y uso de `recall` por tarea | Contadores de presupuesto | Dentro del tope 2× el pool y del tope de 20 |
| Tareas que alcanzan deadline o presupuesto | Estados finales por causa | Pocas y explicables |
| Aprobaciones vencidas y aprobaciones adicionales por reglas de seguridad | Eventos de timeout y de Guard | Informativa |

**Casos de regresión mínimos:** búsqueda y escritura (la traza de Node.js, con postcondición de la escritura); búsqueda, lectura intermedia y escritura; lectura de un archivo largo y copia por placeholder; ruta mal adivinada (`not_found`); borrado con `not_found` posterior como éxito; postcondición confirmada, contradictoria y no disponible; patrón `DENY`; rechazo del usuario con replan; aprobación sin respuesta; `blocked_loop`; `stale_element`; conversación directa; plan vacío; confirmación del plan que expira; cancelación con llamada en vuelo; reinicio con tarea pendiente; plan del máximo (8 pasos) con replan; paso `compose` truncado; argumentos truncados; respuesta final truncada; seguimiento “ahora bórralo” que activa `needs_context`; elección cerrada con “ninguno”; lectura de una ruta sensible; acción de UI sobre una ventana sensible; ejecución de un archivo escrito con contenido web (banner); proceso activo al concluir; pool y tope MCP agotados; comando de más de 30 s.

**Casos agregados en v1.2.** Timeout de mutación con postcondición confirmada, contradictoria y no disponible; proceso corto que termina antes de la lectura; escritura con saltos de línea normalizados; escritura parcial; comando exitoso sin postcondición (`confirmado por señal`); contradicción con herramienta idempotente y no idempotente; efecto corregido por un reintento; lista de efectos compactada en una tarea de UI de 15 acciones; referencia derivada de evidencia web; lectura de un secreto dentro de un comando; limpieza de procesos activos tras un reinicio.

**Replay.** Las pruebas se ejecutan con replay: se graban entradas y salidas de Eos, Qwen y MCP y se repiten de forma determinista, sin modelos.

## 17. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| `cumple` es el único mecanismo de terminación: un falso positivo cierra en falso y un falso negativo cicla | Dos preguntas separadas, evidencia con contenido, criterios observables, umbral 0.75 sin postcondición confirmada, presupuestos por paso y de tarea, medición antes de congelar umbrales |
| La selección en una sola llamada pierde precisión con casos ambiguos | Validación con \~50 casos, segunda pasada con 5 candidatas, flag de reversión, prefiltro si el catálogo crece |
| Costo y regresiones de la migración de datos e interfaz | Fases, copia de respaldo y puerta con señales concretas antes de la Fase 5 |
| Una postcondición no es viable para una capacidad | El efecto queda `no confirmado`, se exige el umbral mayor y la respuesta final lo declara |
| Las postcondiciones suman invocaciones MCP | Son lecturas `ALLOW` sin LLM. No gastan el pool y cuentan contra el tope 2× el pool |
| Contenido sustituido de gran tamaño o con instrucciones incrustadas | Guard evalúa el contenido real, tamaño máximo por llamada, el contenido se trata siempre como dato |
| Qwen escribe un placeholder mal formado o inexistente | Error de argumentos con reintento y error previo. Catálogo de refs claro en el prompt |
| La caché de prefijo no aporta | Se mide en la Fase 1. No es requisito del diseño |
| El catálogo plano desborda la ventana de Eos | Presupuesto por bloque, estimador `chars / 3`, prefiltro |
| La escalación elige acciones inadecuadas y provoca ciclos | `MAX_ESCALATIONS`, restricciones registradas, tabla por causa y `abort`, que devuelve el paso al driver como `EXHAUSTED` con causa “inalcanzable” |
| La tabla de escalación no cubre una causa nueva | Eos decide donde la tabla deja varias acciones. `abort` siempre es posible |
| Una elección cerrada de argumentos escoge el candidato equivocado | Solo con 2 o más candidatos, opción “ninguno”, Guard y aprobación siguen vigentes |
| Deadline demasiado corto y `PARTIAL` prematuros | Configurable, excluye esperas del usuario, calibración con trazas |
| Un paso `compose` inventa contenido | Recibe solo evidencia informativa. El texto va a `RefStore` y la respuesta final no lo presenta como verificado |
| Las reglas de seguridad suman aprobaciones y fricción | Listas de rutas y ventanas sensibles configurables. Se mide la tasa de aprobaciones adicionales |
| Un truncamiento pasa desapercibido | Detección de `finish_reason = length` en argumentos, `compose` y respuesta final. \[VERIFICAR\] que el cliente lo exponga |
| Reintentar una mutación tras una contradicción duplica efectos | “Contradice” solo con evidencia inequívoca. Se reintenta solo si la herramienta es idempotente o tras comprobar el estado (6.8) |
| Un paso cierra porque la postcondición prueba el efecto, pero no que el contenido responda al criterio | cumple recibe también la lectura de postcondición (7.2) |

## 18. Pendientes por verificar con el código

Todo lo marcado \[VERIFICAR\] en este documento, reunido:

1. **C3.** Si en PLAN `suggested_mcp` fija la ruta sin corrección posible (`modeEngines`).
2. **C5.** Qué recibe exactamente `buildDecisionJudgement` y `buildDecisionFive` (`prompts`).
3. Si `PROMPTS.PLAN` recibe el catálogo de herramientas o solo `suggested_mcp`.
4. Configuración de thinking por etapa, `num_ctx` y truncamiento en `dispatchPrompt`, y si el cliente de Qwen expone `finish_reason` (`qwen`).
5. Punto de inserción de la sustitución de refs antes del anti-loop y de Guard (`callExecutor`).
6. Dónde ejecuta el código las postcondiciones sin pasar por la selección de Eos, y cómo se registran en el `LOG` y en el tope MCP (`callExecutor`).
7. Semántica real del anti-loop: “sin lectura intermedia” frente a `nonReadCounter`.
8. Limpieza de `RefStore` en excepciones y cancelación con llamada MCP en vuelo (`core`).
9. Si `needs_context` tiene algún consumidor hoy (`decision`).
10. Cómo se trata hoy `UNVERIFIED` dentro de `modeEngines`.
11. Si `ResultProcessor` puede marcar `tainted` y las referencias “sensible” y “web” (`resultProcessor`).
12. Cómo aplica Guard `APPROVAL` a la lectura de rutas sensibles sobre la clasificación actual de lectura (`guard`).
13. Cómo calibra Eos las preguntas binarias: `choice` de dos opciones frente a `noul`.
14. Si Qwen admite un `num_ctx` mayor con la VRAM disponible (experimento de la Fase 1).
15. Cómo identificar que la ventana enfocada es sensible (terminal, diálogo Ejecutar) (11.7).

**Pendientes por herramienta.** Los pendientes que dependen del catálogo (nombres reales frente a `tools/list`, si las lecturas de procesos drenan el buffer, qué lectura existe por capacidad, argumentos reales de la lectura de postcondición de UI y viabilidad de cada elección cerrada) se asignan a la construcción del manifiesto de herramientas en la Fase 1 y se registran allí. Además, queda por verificar cómo integrar la detección de rutas sensibles en la inspección de comandos (`isSafeReadonlyCommand`, módulo `guard`).

**Material adicional que ayudaría a cerrarlos:** dos o tres trazas reales de consola `[Decision → SEND/RECV]` (una exitosa y una fallida de PLAN).

## 19. Inconsistencias de la documentación actual

Son independientes del rediseño. Algunas desaparecen con él y el resto conviene corregirlas en la Fase 0.

| # | Inconsistencia | Destino |
| --- | --- | --- |
| 1 | **Escalación en PLAN.** La tabla de pasos dice que en PLAN se replanifica, pero el diagrama envía `StepFail`, `ArgFail`, `GuardDeny` y `UserDeny` a `Escalation`, y `switch_mcp` vuelve a `FastLoop`, lo que abandona el plan sin decirlo | Desaparece con el motor único |
| 2 | **`LoopBlock` frente a `ArgFail`.** El primero vuelve a `FastLoop` (o concluye tras 2 bloqueos) y el segundo escala | Desaparece (ambos escalan) |
| 3 | **Dos descripciones del fallback de `fin`.** CORE\_FLOW dice redirección forzada a un servidor por defecto. ARCHITECTURE dice que se elige la mejor ruta no-fin según probabilidades | Desaparece (no hay `fin` validado) |
| 4 | **Anti-loop.** Descrito como “sin lectura intermedia” pero firmado con `nonReadCounter` | Se corrige en la Fase 2 (11.3) |
| 5 | **Traza de ejemplo frente a la memoria.** La traza dice que Qwen usa `FACTS` “con datos de Node.js”, pero `FACTS` solo guarda identificadores. La versión le llega por `LAST` | Se corrige al reescribir la traza |
| 6 | **`MAX_STEPS` y `MAX_TOOL_CALLS_TASK`.** En FAST el límite efectivo es \~15 llamadas, no 30. El tope de 30 solo actúa en PLAN | Desaparece con el paso único y el pool por modo |
| 7 | **`FACTS` y `Scratchpad` con claves solapadas.** La tabla de memoria muestra `path` frente a `path` (probable errata en el nombre de una de las claves) | Desaparece con el almacén único |

## 20. Decisiones abiertas para el responsable

1. **Alcance de la Fase 5.** Si se ejecuta completa (modelo de datos, persistencia e interfaz) o se reduce a migrar tareas viejas, según la puerta definida en la sección 15.
2. **`ask_user`.** Si entra con la escalación o se pospone, porque requiere un estado de paso y un endpoint nuevos.
3. **Tareas persistidas con el esquema viejo.** Convertirlas a solo lectura o descartarlas.
4. **Valores iniciales.** Deadline 10 min, timeout de aprobación 10 min, expiración de la confirmación del plan 30 min, umbrales 0.60 y 0.75, pool 30 y 15, tope MCP 2× el pool y `recall` 20.
5. **Confirmación del plan.** Siempre (como hoy, salvo plan vacío) o solo cuando el plan incluye pasos que requieren aprobación.
6. **Listas de rutas y ventanas sensibles.** Quién las mantiene y con qué valores iniciales.
7. **Cifrado en reposo y bloqueo por recurso.** Quedan fuera del alcance mínimo. Hay que decidir si se planifican.
8. **Candidatos posteriores a la Fase 1.** Extracción fundamentada (9.2), restricciones por efecto (11.7), pregunta `multi_paso` (6.4): cuáles se ejecutan según la medición.

## 21. Contrato con `DOC_HERRAMIENTAS`

Este documento define mecanismos y reglas por capacidad, y no replica el catálogo de herramientas. La fuente de verdad es un **manifiesto tipado único**, consumido por el código en ejecución (Guard, ejecutor y selección). `DOC_HERRAMIENTAS` y el `PolicyRegistry` se generan o derivan de él, para no tener dos fuentes que se desfasen. Por cada herramienta, el manifiesto debe definir:

1. **Capacidad**, con el subtipo cuando importe (por ejemplo, inicio o terminación de proceso).
2. **Postcondición:** qué lectura usa, con qué argumentos deterministas y cuándo es confirmada o contradice (6.8). O declarar que no tiene.
3. **Argumentos de elección cerrada** y la fuente de sus candidatos (7.4).
4. **Parámetros donde se permiten placeholders** (9.3). Los demás quedan prohibidos.
5. **Timeout propio**, si difiere del general (secciones 8 y 12.1).
6. **Si lee rutas sensibles** (11.1).
7. **Si es interna:** una pseudo-herramienta atendida por el ejecutor, como `recall`.
8. **Idempotencia y reintento seguro:** si repetir la llamada es seguro. Tras una contradicción solo se reintenta si es idempotente o después de comprobar el estado (6.8).
9. **Lectura de contenido grande:** si es una lectura que puede devolver contenido muy grande y qué compactador usa para la observación (9.10).

Una herramienta que el manifiesto no registre se trata según 11.4. Los pendientes por herramienta de la sección 18 se resuelven al construir el manifiesto, en la Fase 1.

## 22. Registro de cambios (v1.1 y v1.2)

| Sección | Cambio |
| --- | --- |
| 1, 3, 4, 6.6, 7, 8, 9, 11, 15, 16, 18, 19, 21 | Se retira del documento la lista de herramientas (conteos, nombres reales y \[VERIFICAR\] asociados). Los mecanismos quedan por capacidad. Sección 21 nueva con el contrato con `DOC_HERRAMIENTAS` |
| 2, 12.1 | Presupuestos: pool de llamadas elegidas por Eos (30 en PLAN, 15 en FAST), tope de invocaciones MCP (2× el pool, incluye postcondiciones) y `recall` fuera del pool con tope de 20 |
| 6.2, 6.8, 8 | Postcondiciones exentas de la política por señal y del anti-loop, con tres resultados decididos por el código, solo si la llamada volvió sin error o tras un timeout. Pasos 10 y 11 reordenados |
| 6.8 | Tabla por capacidad con filas de ejecución de comandos, terminación de procesos, configuración y por defecto |
| 6.1, 12.1, 12.2, 13.3 | La espera de confirmación del plan no cuenta para el deadline y expira a los 30 min |
| 5, 6.4, 9.1, 9.5, 9.8 | FAST: `LOG` completo (≤ 100 caracteres por línea, hasta 15 líneas) más `effects`. Ledger solo en PLAN |
| 6.7, 8, 9.1, 9.3, 9.5, 10 | `recall` como pseudo-herramienta interna. La respuesta final no usa `recall` y marca “contenido parcial”. Detección de `finish_reason = length`. Corregida la lectura de `RefStore` en 9.1 |
| 15 | Fases reordenadas (0, 1, 2, 3, 4a, 4b, 5, 6). Puerta antes de la Fase 5 con señales concretas |
| 6.3, 7.3, 17 | `abort` restablecido: devuelve el paso al driver como `EXHAUSTED` “inalcanzable” |
| 9.3, 11.1, 11.7 | Secretos: `APPROVAL` al leer rutas sensibles, observación redactada y referencia sin uso en placeholders sin aprobación |
| 5, 11.7, 13.1 | La regla de ventanas sensibles aplica a todo `UI_ACTION`. Marca `tainted` por tarea en el esquema |
| 9.5, 11.6, 11.7 | Los procesos se terminan solo al cancelar. La respuesta final lista los que siguen activos |
| 11.2, 11.7 | El banner de aprobación indica si el archivo a ejecutar se escribió en la tarea con contenido web |
| 5, 13.1 | `effects` definido una sola vez (capacidad, destino, estado, llamada de origen, procedencia), con sus usos |
| 4, 6.2, 6.6, 9.1, 16 | Actualizadas: reparto, orden del motor, postcondición tras la escritura, capas de memoria y caso de plan del máximo (8 pasos) |
| 6.2, 7.2, 7.5 | Umbral asimétrico: con postcondición confirmada cierra con `ok` y `cumple` ≥ 0.60; sin ella, `cumple` ≥ 0.75; entre ambos el paso continúa y, si agota presupuesto, queda `EXHAUSTED` |
| 7.3 | Dos filas para `not_found` persistente (con y sin `ask_user`). Fila nueva para postcondición contradictoria |
| 5, 6.1 | Plan vacío permitido en PLAN. Health check de 6.1 como ping liviano |
| 20 | Decisión nueva: confirmación del plan siempre o solo con pasos que requieren aprobación |
| 15 (Fase 6) | Módulo único de constantes con script de tablas, tablas de transición tipadas con tests y test diferencial FAST ≡ PLAN de un paso |

**Cambios de v1.2**

| Sección | Cambio |
| --- | --- |
| 5, 9.3, 11.2 | Efectos con cuatro estados (se agrega `confirmado por señal`). El último estado por (capacidad, destino) prevalece, con historial aparte. Listas compactadas por capacidad y tope de 12 líneas. `tainted` queda como señal de contexto y el aviso usa la procedencia por efecto. Las marcas “web” y “sensible” se heredan |
| 6.2, 6.8, 7.2, 7.3, 8 | Timeout de mutación: la postcondición decide (sanea, falla o escala con “timeout sin verificación”, sin reintentar). “Contradice” solo con evidencia inequívoca. Reintento tras una contradicción solo si la herramienta es idempotente o tras comprobar el estado |
| 6.8 | Inicio y terminación de proceso nunca contradicen. Escritura parcial y diferencias de contenido quedan “no confirmado”. Comandos sin postcondición quedan “confirmado por señal” con código de salida 0, salida limpia y `ok` positivo |
| 7.2 | `cumple` recibe también la lectura de postcondición |
| 6.2, 9.1, 9.2, 9.5, 9.8, 12.1 | Rama `compose` indicada. Fila de restricciones registradas. Regla de “informativa” en FAST. Postcondición en la misma línea de `LOG` de su llamada. Pool definido como “llamada MCP elegida por Eos”. Los reintentos del adaptador cuentan en el tope MCP |
| 11.1, 11.7 | Detección de rutas sensibles dentro de la cadena del comando, integrada en `isSafeReadonlyCommand`. Se declara como deliberado que el modelo nunca ve el valor de un secreto |
| 11.6, 13.3, 13.4 | Acción de limpieza de procesos activos tras concluir sin cancelar o tras un reinicio |
| 15 | `effects` mínimo en la Fase 2. Manifiesto y `DOC_HERRAMIENTAS` como entregable de la Fase 1 y prerrequisito de las fases 2 y 4a. Puerta basada en medidas. Test diferencial desde la Fase 3. Nota sobre el umbral 0.75 en la Fase 3 |
| 21, 11.4, 14.1, 18 | Manifiesto tipado único del que se genera `DOC_HERRAMIENTAS`. Atributos 8 (idempotencia) y 9 (lectura grande y compactador). Pendientes por herramienta asignados a la Fase 1 |
