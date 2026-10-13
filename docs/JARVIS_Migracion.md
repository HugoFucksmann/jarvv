Migración de JARVIS: motor único, decisiones en Eos y memoria por capas
Versión 1.3 · 13 de octubre de 2026 · Derivada de v1.2. Fuentes incorporadas en esta revisión: v1.2, contrato Decision-2.0-Eos-0.8B aportado, snapshot MCP generado el 2026-10-12 y documentación actual aportada: CORE_FLOW, ARCHITECTURE, CONTEXT_AND_MEMORY y TOOLS_AND_SECURITY. La comparación documental está registrada en el apéndice C; no equivale a una auditoría del código ni valida por sí sola que la documentación describa fielmente el runtime.
1. Propósito, alcance y convenciones
Este documento describe qué cambia en JARVIS al pasar del diseño actual (dos bucles de ejecución, cadena D1 → D2 → argumentos → D5, memoria sin transferencia de datos entre pasos) al diseño objetivo. Cubre flujo, lógica, memoria, seguridad, persistencia e interfaz. No contiene código ni cambios de archivos.
El catálogo detallado y las reglas por herramienta se mantienen en el documento de herramientas/manifiesto. Esta migración define los mecanismos y reglas por capacidad. El snapshot MCP disponible se incorpora como evidencia de inventario y brechas de política en la sección 21.1; no sustituye la auditoría del código ni el manifiesto tipado.
Supuestos de partida (confirmados por el responsable del proyecto):
• Razonador: Qwen 3.5 9B. Es la única inferencia que cuenta para la latencia.
• Clasificador: Decision 2.0 Eos 0.8B (Eos), con respuesta menor a 1 s y costo despreciable. Fue probado con 20 opciones en una sola pregunta.
• Objetivo de diseño: que Eos tome toda decisión que sea una elección cerrada, y que Qwen solo genere argumentos abiertos, planes, replanes, redacción y la respuesta final.
Convenciones:
• [HIPÓTESIS]: cifra o umbral propuesto, a calibrar con trazas reales. No es un valor final.
• [VERIFICAR]: afirmación inferida de la documentación que debe confirmarse en el código. La sección 18 las reúne.
• Hoy es el comportamiento descrito en la documentación actual. Objetivo es el comportamiento tras la migración.
2. Resumen ejecutivo
Cinco cambios estructurales y un conjunto de mejoras independientes:
1. Motor de paso único. FAST es un plan de un solo paso creado por código, y PLAN un plan de varios pasos generado por Qwen. Ambos usan el mismo motor (runStep) con las mismas reglas de terminación, error y recuperación. Solo cambia el driver que decide qué hacer cuando un paso termina.
2. Selección unificada en Eos. D1 y D2 se fusionan en una pregunta sobre un catálogo plano con prefijo de servidor. Incluye pseudo-herramientas internas (como recall). La opción “responder sin herramientas” existe solo en la primera decisión de FAST.
3. Verificación en dos preguntas binarias separadas (¿el resultado es válido? ¿se cumple el criterio?), sobre evidencia real y solo con señales limpias. Antes, el código decide el estado de cada efecto con una postcondición. Reemplaza a D5 y al juicio de plan.
4. Errores por señal y escalación por tabla. El código decide la respuesta a cada señal. La escalación usa una tabla por causa y Eos decide solo donde la tabla deja varias acciones. Desaparece la Etapa 5B de Qwen.
5. Memoria por capas con transferencia real: registro de efectos (effects), ledger por paso (solo PLAN), handoff determinista, referencias por placeholder {{ref:rX}}, recall para salidas no repetibles, evidencia con contenido para el juez y respuesta final armada por rol.
Presupuestos: un pool común de herramientas seleccionadas por Eos (30 en PLAN, 15 en FAST, incluidas las herramientas locales `recall`, `compose` y `ask_user`), un tope aparte de invocaciones MCP externas (2,5× el pool, incluye postcondiciones) y topes secundarios para limitar usos de herramientas locales.
Mejoras independientes: deadline global, timeouts de aprobación y de confirmación del plan, escritura atómica y redacción de datos persistidos, orden de prompt estable, seguridad adicional (11.7) y corrección de inconsistencias de documentación.
Efecto esperado sobre Qwen (la métrica de latencia):
Llamada a Qwen
Hoy
Objetivo
Plan
Solo PLAN
Solo PLAN. Puede ser un plan vacío en tareas conversacionales
Argumentos
1 por acción
1 por acción; ninguna si todos los argumentos son deterministas o de elección cerrada
Redacción (compose)
No existe
1 por selección de compose (FAST o PLAN)
Escalación (5B)
1 por fallo escalado
Eliminada (la deciden el código y Eos)
Replan
Solo PLAN
Solo PLAN
Respuesta final
1
1
Eos hace una selección y dos verificaciones por acción, y decide escalaciones puntuales. Con respuesta menor a 1 s, su costo no pesa en la latencia.
3. Diagnóstico del estado actual
Problemas que justifican la migración, con la evidencia que aparece en la documentación vigente.
ID
Problema
Evidencia en la documentación
Estado
C1
Dos motores con reglas propias para lo que debería ser idéntico
Terminación: FAST usa fin con umbrales 0.51/0.60 y PLAN usa juicio con 0.60. Recuperación: FAST escala (5B) y PLAN replanifica
Confirmado
C2
“Paso” significa cosas distintas
En FAST cada iteración crea un paso (MAX_STEPS = 15 limita a ~15 llamadas). En PLAN un paso es un subobjetivo con hasta 4 llamadas
Confirmado
C3
El enrutamiento tiene autoridad distinta según el modo
En PLAN el diagrama va de PlanStepLoop directo a ExecCall, sin D1. suggested_mcp del planner sería la ruta
Parcial. [VERIFICAR]
C4
fin mezcla “¿la meta está cumplida?” con “¿a dónde voy?”
Umbral asimétrico, validación de fin y redirección forzada a un servidor por defecto
Confirmado
C5
El juez ve metadatos, no contenido
D5 recibe un resumen estructurado de hasta 400 caracteres. El hallazgo (finding) se recorta a 120. La observación compacta (hasta 1.500) se inyecta a Qwen, no a Decision
Parcial. [VERIFICAR] qué recibe buildDecisionJudgement
C6
La memoria almacena pero no transfiere
FACTS guarda identificadores, no valores. LAST es una sola observación. [... omitido, ref:rX] es un puntero que ningún modelo puede seguir. La respuesta final usa las últimas 3 EVID por recencia
Confirmado
C7
La escalación resuelve el problema equivocado
Solo permite switch_mcp o abort. excludedToolForNextCall y [ya falló - EVITAR] impiden reintentar la misma herramienta con argumentos corregidos
Confirmado
C8
Decisiones deterministas pasan por un modelo
La regla de override de D5 (confianza < 0.50 y exit_code = 0) corrige al modelo cuando ignora señales ya conocidas
Confirmado
C9
Sin deadline de tarea
Tope de 30 llamadas, Qwen hasta 120 s (180 s con thinking) y MCP 30 s por llamada. El peor caso son decenas de minutos
Confirmado
C10
Aprobación sin expiración
La compuerta espera indefinidamente hasta que el usuario resuelva o cancele
Confirmado
C11
Salida de argumentos limitada a 1.024 tokens
Impide copiar contenidos largos entre herramientas (informes, archivos)
Confirmado
C12
Persistencia y privacidad débiles
writeFileSync directo, argumentos y observaciones en claro, prompts completos en consola
Confirmado
C13
Sin continuidad entre tareas
sessionHistory son strings. needs_context no tiene consumidor documentado
Confirmado
C14
El planner no conoce el catálogo de herramientas
PROMPTS.PLAN solo produce suggested_mcp y expected_outcome
[VERIFICAR]
C15
El orden de bloques del prompt de argumentos perjudica la caché de prefijo
LOG, PLAN, FAIL y FACTS (dinámicos) van antes de TOOL y SCHEMA
Confirmado
C16
Mutaciones sin postcondición verificable
Las mutaciones (archivo, borrado, proceso, descarga) solo devuelven un mensaje de éxito: el juez no ve el efecto
Parcial
C17
Salidas no repetibles inaccesibles
RefStore es solo del ejecutor: las salidas de comandos, de procesos y de páginas cambiantes no se pueden releer
Parcial
C18
Superficie de seguridad sin cubrir
Las acciones de UI son ALLOW automático, los comandos de arranque de servidores MCP no fijan versión, no hay marca de contenido no confiable y la lectura de secretos no tiene control
Confirmado en la documentación
Ejemplo de C6. En la traza de Node.js, el paso de escritura conoce la versión solo porque LAST contiene la observación inmediata anterior (la búsqueda). Con un paso intermedio, ese dato se perdería: FACTS solo tendría la URL.
4. Principios y reparto de responsabilidades
Regla única: si se deduce de señales, decide el código. Si es una elección entre opciones cerradas, decide Eos. Si hay que producir texto o estructura nueva, produce Qwen.
Decisión o tarea
Hoy
Objetivo
Respuesta a señales de error, anti-loop, presupuestos, reintentos, sustitución de referencias, handoff, ensamblado de contexto, Guard
Mezcla de código y modelos
Código
Estado de cada efecto tras una mutación (confirmado, confirmado por señal, no confirmado, contradicho)
Estado UNVERIFIED sin evidencia
Código, con una postcondición por capacidad (6.8)
Argumentos con valor fijo (p. ej. las lecturas de postcondición)
Qwen o código según el caso
Código
Responder sin herramientas o usar una herramienta, y cuál (incluye las pseudo-herramientas internas)
D1 y D2 (dos llamadas)
Eos, una sola pregunta
¿El resultado es válido?
D5
Eos, solo con señales limpias
¿Se cumple el criterio del paso?
Juicio de plan (solo PLAN)
Eos, en ambos modos
Escalación tras fallo
Qwen (Etapa 5B)
Tabla por causa (código). Eos solo donde la tabla deja varias acciones
Argumentos que son elecciones entre candidatos conocidos
Qwen
Eos sobre una lista armada por código, con opción “ninguno”
Argumentos abiertos (texto, rutas nuevas, contenido, comandos)
Qwen
Qwen
Plan, replan y redacción interna (compose)
Qwen (plan y replan)
Qwen
Respuesta final
Qwen
Qwen
5. Modelo de datos objetivo
Jerarquía: Tarea → Plan → Paso[] → Llamada[].
Plan.
• En FAST es un plan de un solo paso, generado por código. La meta del paso es el mensaje del usuario, el criterio es la propia meta y el presupuesto es el pool de la tarea. No hay llamada a Qwen ni confirmación.
• En PLAN lo genera Qwen y requiere siempre confirmación del usuario si contiene pasos. Un plan vacío no requiere confirmación y Qwen responde directamente.
Paso. Campos funcionales:
• goal: una frase con la meta del paso.
• type: tool (por defecto). La redacción interna se selecciona como pseudo-herramienta compose por Eos; no es un tipo de paso.
• criterion: descripción de la evidencia observable que demuestra el cumplimiento (no valores aún desconocidos).
• routeHint: pista opcional de subsistema. Es información para Eos, no una orden.
• inputsFrom: identificadores de pasos anteriores cuyos datos necesita, cuando no es el inmediato anterior.
• budget: tajada de llamadas del paso (12.1).
• result: resultado breve (≤ 160 caracteres) y referencias informativas, rellenados al cerrar. Solo PLAN.
• status: PENDING, RUNNING, WAITING_INPUT, DONE, BLOCKED, EXHAUSTED, CANCELLED. WAITING_INPUT es el único estado de espera; `waitingReason` distingue `approval`, `plan_confirmation` y `user_answer`.
• blockedCause: denegación, rechazo explícito o aprobación pendiente, para que el driver distinga los bloqueos.
Llamada. Registra: herramienta elegida (con prefijo de servidor) y confianza de selección, argumentos como plantilla (con placeholders) y como valores resueltos, decisión de Guard, señales, evidencia con contenido, resultado de la postcondición, veredictos de Eos (ok y cumple, cada uno con su confianza) y motivo de bloqueo si lo hubo.
Efectos (effects): definición única. Un efecto es el registro de una mutación realizada por la tarea, con cinco campos:
• capacidad: la clase de la acción (escritura de archivo, borrado, proceso, descarga, comando, configuración).
• destino: sobre qué se actuó (ruta, PID, ventana, clave de configuración).
• estado: confirmado (`CONFIRMED`, la postcondición coincide), confirmado por señal (`CONFIRMED_BY_SIGNAL`, código de salida 0 y salida limpia, sin depender de `ok`), no confirmado (`UNCONFIRMED`, no hay postcondición disponible o la evidencia es ambigua) o contradicho (`CONTRADICTED`, evidencia inequívoca contra el efecto). `ok` gobierna el cierre del paso, no el estado del efecto.
• llamada de origen: la llamada que produjo el efecto.

effects es la fuente única de “qué hizo la tarea”. Sustitución: el último estado por (capacidad, destino) prevalece, de modo que un efecto contradicho que un reintento corrigió deja de figurar como contradicho. El historial se conserva aparte. Compactación: las listas que reciben cumple y la respuesta final se agrupan por capacidad y se limitan a 12 líneas [HIPÓTESIS]. Usos:
1. Evidencia de cumple: lista determinista de efectos (6.4 y 7.2).
2. Umbral asimétrico: un efecto confirmado habilita cerrar con cumple ≥ 0.60 (7.5).
3. Complemento del LOG en FAST (9.1).
4. Respuesta final: declarar efectos no confirmado o contradicho y listar los procesos que siguen activos (9.5 y 11.6).

6. Resumen de salida para la tarea siguiente (9.9) y restricciones por efecto (candidato, 11.7).

Cambios de semántica:
• Un paso es siempre una meta con criterio. Una llamada es siempre una invocación de herramienta. FAST muestra un paso con N llamadas.
• UNVERIFIED deja de ser un estado que fluye por el sistema. Pasa a ser el estado del efecto (confirmado, confirmado por señal, no confirmado, contradicho).
• Estados de tarea: RUNNING, WAITING_INPUT, COMPLETED, PARTIAL, FAILED, CANCELLED. `WAITING_INPUT` puede representar aprobación, confirmación del plan o respuesta explícita del usuario; `waitingReason` distingue el caso.
• effects nace en la Fase 2 en versión mínima (capacidad y destino), derivada de Guard. El estado y las postcondiciones llegan en la Fase 4a (sección 15).
6. Flujo objetivo
6.1 Visión general
1. Se recibe la instrucción y el modo. Se crea la tarea en RUNNING con su deadline global. Un health check liviano (un ping, sin inferencia) comprueba que Eos y Qwen respondan. Si no, la tarea falla de inmediato con un aviso.
2. Se obtiene el plan. En FAST lo crea el código (un paso). En PLAN lo genera Qwen y puede ser vacío si la tarea es conversacional: entonces no hay confirmación y Qwen responde directamente. Si el plan tiene pasos, se espera la confirmación del usuario. Esa espera no cuenta para el deadline y expira a los 30 min (configurable): la tarea pasa a CANCELLED con el motivo “plan sin confirmar”.
3. Por cada paso se ejecuta el motor de paso (6.2).
4. El driver del modo decide qué hacer según el resultado del paso (6.3).
5. Al concluir, Qwen redacta la respuesta final (9.5).
6.2 Motor de paso (runStep)
Todos los pasos, incluidos los que invocan pseudo-herramientas internas, usan el motor runStep. Se repite mientras queden llamadas en el pool de la tarea y en la tajada del paso, y no haya vencido el deadline:
1. Contexto. Se construye la vista única de estado del paso (9.7).
2. Selección (Eos). Una pregunta sobre el catálogo plano (7.1), que incluye las pseudo-herramientas internas. Devuelve una herramienta o, solo en la primera decisión de FAST, “responder sin herramientas”.
3. Validación de existencia. Si la herramienta no figura en Discovery, el adaptador refresca el caché una vez y revalida. Es del adaptador MCP, no del flujo.
4. Argumentos. Por el camino que corresponda: determinista (código), elección cerrada (Eos sobre una lista del código, con “ninguno”) o abierto (Qwen con schema, placeholders y error previo). Hasta 2 reintentos de schema. Una salida truncada (finish_reason = length) cuenta como argumentos inválidos.
5. Sustitución de referencias. Los {{ref:rX}} se reemplazan por el contenido real, solo en los parámetros permitidos (9.3). Los placeholders solo se permiten en parámetros expresamente declarados por el manifiesto.
6. Anti-loop sobre los argumentos ya resueltos (11.3).
7. Guard sobre los argumentos reales: ALLOW, APPROVAL (con timeout) o DENY.
8. Despacho uniforme. Todas las herramientas, incluidas `recall`, `compose` y `ask_user`, pasan por el mismo ciclo de selección, validación de argumentos, anti-loop, Guard, ejecución, normalización de resultado y registro. El dispatcher enruta las herramientas internas a su handler local y las externas al adaptador MCP; esta diferencia solo determina el transporte, no crea un flujo privilegiado. Todas consumen el pool de llamadas seleccionadas; solo las externas consumen el tope MCP.
9. Procesamiento. ResultProcessor calcula señales, hallazgo, observación compacta, RefStore y deltas,.
10. Señales de error. Si hay alguna (salvo un timeout en una mutación, que pasa al paso 11), se aplica la política por señal (sección 8). No se consulta a Eos y no hay postcondición.
11. Postcondición. Solo si la llamada volvió sin error o tras un timeout en una mutación. El código ejecuta la lectura de la capacidad (6.8) y decide: confirmada, contradice la mutación o no disponible. Tras un timeout de mutación, se consulta la postcondición: si confirma, se sanea el timeout y la llamada se considera ejecutada; si contradice, se registra el fallo y se escala; si no está disponible o la evidencia es ambigua, el efecto queda `UNCONFIRMED` y se escala sin repetir automáticamente la mutación. Así se evita duplicar un efecto que pudo ocurrir pese al timeout. La postcondición está exenta de la política por señal y del anti-loop. Actualiza effects.
12. Verificación (Eos). Con señales limpias (o saneadas por la postcondición) y sin contradicción, dos preguntas binarias separadas sobre evidencia real (7.2).
13. Veredicto. El paso cierra DONE, continúa o agota su presupuesto (EXHAUSTED), según 7.5.
6.3 Drivers por modo
Resultado del paso
Driver FAST
Driver PLAN
DONE
Concluir COMPLETED
Siguiente paso. Si no quedan, concluir
EXHAUSTED (presupuesto agotado o abort con causa “inalcanzable”)
Concluir PARTIAL o FAILED y explicar qué faltó
handleReplan si queda presupuesto global; máximo 2 replanes por tarea
BLOCKED (DENY o rechazo explícito del usuario)
Concluir PARTIAL indicando qué se bloqueó
Solicitar replan si queda presupuesto global. Registrar la restricción (“no proponer X”); al agotar los dos replanes de la tarea, concluir PARTIAL/FAILED según avance
WAITING_INPUT (aprobación pendiente/timeout)
Concluir PARTIAL como “pendiente de aprobación” si vence el timeout
Igual: no replanificar automáticamente por timeout; no registrar una restricción del usuario
Deadline o presupuesto global agotado
Concluir PARTIAL
Concluir PARTIAL
Cancelación del usuario
CANCELLED
CANCELLED
El replan es el lugar donde se exploran alternativas tras una denegación. Cada replan aceptado consume el contador global `maxReplans=2` de la tarea, compartido entre todas las causas; ninguna causa lo reinicia. Dentro del paso, la escalación no replanifica por sí misma: `abort` devuelve el paso al driver como EXHAUSTED con causa “inalcanzable”.
6.4 Terminación
• El cierre lo decide cumple, no la elección de fin. Desaparecen la validación de fin, el umbral asimétrico 0.51/0.60 y la redirección forzada.
• Conversación directa. Solo en la primera decisión de FAST, Eos puede elegir “responder sin herramientas”. Qwen redacta la respuesta y la tarea concluye sin ejecutar nada. En PLAN cumple ese papel un plan vacío.
• Criterio acumulativo en FAST. El criterio es la meta completa del usuario. cumple se evalúa con el LOG completo del paso (hasta 15 líneas de ≤ 100 caracteres) y la lista determinista de effects, no solo con la última llamada. FAST no tiene ledger. En PLAN, los pasos son cortos y basta la evidencia de la última llamada más el handoff. Como opción posterior a la medición, la primera selección incluye una pregunta multi_paso (noul) para ofrecer pasar a PLAN.
• Estados finales. COMPLETED: pasos cumplidos. PARTIAL: hubo avance pero se agotó presupuesto, deadline, escalaciones o replanes, o hubo bloqueo terminal o aprobación sin respuesta (“pendiente de aprobación”). FAILED: sin avance útil o error irrecuperable. CANCELLED: cancelación del usuario, plan sin confirmar o reinicio del servidor.
6.5 Qué desaparece del flujo
• runFastLoop como bucle distinto de PLAN.
• La validación de fin, el umbral 0.60 post-acción y la redirección forzada.
• La Decision #2 como llamada separada.
• La Etapa 5B de Qwen.
• El estado de paso UNVERIFIED como flujo propio.
• El colapso estadístico de LOG (1-N: X ok, Y err).
• El bloqueo por “2 blocked_loop seguidos” como regla propia: pasa por la escalación general.
6.6 Ejemplo: la traza de Node.js en FAST
Instrucción: “Busca en la web la versión actual de Node.js y guárdala en un archivo version.txt”.
1. El código crea un plan de un paso (meta = mensaje, criterio = meta).
2. Llamada 1. Eos elige la búsqueda web. Qwen genera los argumentos. Guard: ALLOW. Señales limpias. Entra contenido web: el resultado se guarda como referencia informativa. Eos: ok sí, cumple no (falta guardar el archivo).
3. Llamada 2. Eos elige write_file. Qwen escribe el contenido con el LOG y la observación anterior. Guard: APPROVAL;  El usuario autoriza y la llamada vuelve sin error.
4. Postcondición. El código lee de vuelta el archivo: existen y coinciden tamaño y comienzo. El efecto queda confirmado .
5. Eos: ok sí y cumple sí con el umbral correspondiente al modo y al estado de mutación. El paso cierra DONE y la tarea concluye sin una decisión extra de fin.
6. Qwen redacta la respuesta final con el LOG y effects.
Qwen se invoca 3 veces (2 de argumentos y 1 final). El pool gasta 2 llamadas y hay 3 invocaciones MCP (2 más la postcondición), dentro del tope de 30.
6.7 Pasos compose (redacción sin herramienta)
`compose` es una herramienta local seleccionada por Eos para redactar contenido (informe, resumen o borrador) que un paso posterior usará. El planner no declara `type: compose`; la herramienta está disponible en FAST y PLAN.
• Qwen redacta el texto (hasta 1.500 tokens, la misma etapa que la respuesta final) con la meta del paso y la evidencia informativa disponible.
• El texto se guarda en RefStore como referencia informativa y el ledger conserva solo un result de hasta 160 caracteres. El paso siguiente lo usa con `{{ref:rX}}`. Esto evita el límite de 1.024 tokens de los argumentos.
• `compose` pasa por el pipeline común, incluidos Guard, normalización de resultado, `ok` y `cumple`. Consume una unidad del pool y una llamada de Qwen, pero no una invocación MCP; además respeta `maxComposeCallsPerTask` como límite secundario.
• Si la salida se trunca (finish_reason = length), se reintenta una vez pidiendo un texto más breve. Si vuelve a truncarse, el paso es DONE con la referencia marcada “contenido parcial”, y la respuesta final lo declara.
• El planner no lo usa para responder al usuario: eso es la respuesta final.
• La referencia producida es informativa y no hereda marcas de procedencia.
6.8 Postcondiciones por capacidad
Tras una mutación, el código ejecuta una lectura ALLOW sin LLM, elegida por la capacidad registrada en el manifiesto. El resultado actualiza effects y se aporta como evidencia a `ok` y `cumple`. La declaración `mutates` del planner es una pista no confiable y nunca determina permisos ni umbrales.
Capacidad
Postcondición
Confirmada si
Contradice si (solo evidencia inequívoca)
Escritura de archivo (FILE_WRITE)
Leer de vuelta el destino
Existe y, en una escritura completa, coinciden tamaño y comienzo (se normalizan saltos de línea y codificación)
No existe. Una diferencia de contenido, y cualquier edición parcial o anexado, queda “no confirmado”: no hay tamaño esperado definido
Borrado (FILE_DELETE)
Comprobar el destino
No existe (un not_found es éxito)
Sigue existiendo
Inicio de proceso (PROCESS_CONTROL)
Comprobar el PID
PID activo
Nunca. Un PID inexistente queda “no confirmado”: un proceso corto pudo terminar antes de la lectura
Terminación de proceso (PROCESS_CONTROL)
Comprobar el PID
PID inexistente
Nunca. Un PID activo queda “no confirmado”: puede tardar en terminar
Descarga (DOWNLOAD)
Comprobar el archivo descargado
Existe y su tamaño es mayor que 0
No existe. Tamaño 0 queda “no confirmado”
Ejecución de comandos (COMMAND_EXECUTION)
Sin postcondición genérica. Si el contrato declara un destino verificable, se lee
El contrato lo declara y coincide
Solo si el contrato declara un destino y la evidencia es inequívoca. Sin declaración, el efecto queda `CONFIRMED_BY_SIGNAL` solo si el adaptador informa código de salida 0 y no hay señales técnicas de error; en otro caso queda `UNCONFIRMED`. La respuesta de Eos `ok` no cambia retrospectivamente el estado factual del efecto.
Configuración (CONFIGURATION)
Releer el valor modificado
El valor coincide
Solo si el contrato declara comparación exacta y el valor difiere. Si no, “no confirmado”
Por defecto (capacidad no listada o sin lectura disponible)
Ninguna
Nunca
Nunca. Queda “no confirmado”
• Quién decide: el código, sin Eos ni Qwen. Resultados: confirmada (efecto confirmado), contradice la mutación (efecto contradicho, solo con evidencia inequívoca), confirmado por señal (solo comandos sin postcondición) y no disponible o ambigua (efecto no confirmado). Cualquier diferencia ambigua es no confirmado.
• Cuándo corre: solo si la llamada volvió sin error o tras un timeout en una mutación.
• Tras un timeout, la postcondición decide: confirmada → tratar como ejecutada; contradicha → fallo y escalación; no disponible o ambigua → `UNCONFIRMED` y escalación. No se repite automáticamente una mutación cuyo resultado no pudo comprobarse. Un reintento solo puede producirse después de que una nueva decisión de escalación elija explícitamente otra acción permitida; nunca como reintento automático del adaptador. Esta regla prioriza evitar efectos duplicados.
• Contradicción: se registra como fallo y se pasa a escalación normal. No se reintenta automáticamente la misma mutación. Una nueva ejecución requiere una decisión explícita de escalación/replan y vuelve a pasar por Guard.
• Exenciones: no pasa por la política por señal ni por el anti-loop. Por eso un not_found tras un borrado es éxito.
• Presupuesto: cada verificación de postcondición consume el tope de invocaciones MCP cuando requiere una llamada MCP, pero no consume una nueva llamada del pool. Se registra en la misma línea de la llamada en el LOG (9.8).
• Por herramienta: qué lectura se usa y con qué argumentos lo define el manifiesto de herramientas (sección 21). Los argumentos son deterministas.
7. Decisiones de Eos
7.1 Selección unificada (reemplaza D1 y D2)
• Catálogo plano con prefijo de servidor, incluidas `recall`, `compose` y `ask_user` como herramientas registradas. El manifiesto las identifica para enrutar al handler local, pero no las excluye del flujo común. El contrato aportado para Eos admite `choice`, `noul` y `score`; la selección usa `choice`. El tamaño actual del catálogo debe recalcularse con el snapshot MCP y el manifiesto final.
• Opción “responder sin herramientas” solo en la primera decisión de FAST. Es la conversación directa que hoy cubre fin en la primera iteración.
• Descripciones de una línea (primera oración, hasta 80 caracteres, como hoy). Presupuesto estimado del catálogo: ~1.000 tokens. [HIPÓTESIS]
• Estado que recibe Eos: meta del paso, routeHint como pista, resumen del ledger (PLAN) o LOG del paso (FAST), intentos previos con su causa, restricciones registradas por el replan y la última observación compacta.
• Filtros por código antes de preguntar: se excluyen servidores no disponibles y herramientas vetadas por una restricción del replan (“no proponer X”).
• Advertencias anti-repetición como información del estado, distinguiendo “ya ejecutada con estos argumentos” de “falló por argumentos” (esta última no veta la herramienta).
• Una sola opción disponible: se selecciona sin inferencia, como hoy.
• Fallback por confianza: bajo el mínimo de selección [HIPÓTESIS: 0.50], se repite la misma pregunta solo con las 5 mejores candidatas de la primera pasada y descripciones ampliadas. Es un único camino: no se conserva la lógica de dos etapas.
• Si el catálogo crece más allá de ~60 opciones, se prefiltra por servidor activo o por routeHint.
• Validación previa a adoptarla: armar ~50 casos reales (incluyendo ambiguos) y comparar la precisión de la llamada única contra la cadena de dos llamadas. Adoptar si la diferencia es de 2 puntos o menos. [HIPÓTESIS]
7.2 Verificación en dos preguntas binarias (reemplaza D5 y el juicio de plan)
Precondición: señales limpias (sin not_found, denied, empty_output, exit_code 0 o ausente; sin isError; un timeout solo si la postcondición lo sanó, 6.8) y una postcondición que no contradiga la mutación. Si hay señal de error, se aplica la sección 8. Si la postcondición contradice, es un fallo (7.3).
Pregunta
Qué responde
Entrada
ok
¿El resultado es una respuesta válida y utilizable (no un error disfrazado ni una página vacía)?
Señales, resumen, observación compacta (hasta 1.500 caracteres) y lectura de postcondición, si existe
cumple
¿La evidencia demuestra el criterio del paso?
Criterio, observación compacta, lectura de postcondición (si existe) y, en FAST, el LOG del paso. En ambos modos, la lista de effects compactada
• Son dos llamadas independientes y binarias, que pueden ejecutarse en paralelo. Se descarta fusionarlas: con un modelo de 0.8B, las preguntas combinadas suelen calibrar peor, y cada llamada es barata.
• Umbrales y cierre: ver 7.5.
• `ok` bajo umbral: en una operación de solo lectura se permite un reintento informado con el motivo (por ejemplo, una consulta mal formulada). Si la llamada mutó y el efecto está confirmado, no se repite automáticamente: se escala o replantea para evitar duplicarlo. Solo tras dos resultados negativos con argumentos distintos y señales limpias se veta la herramienta en el paso (sección 8).
• ok = sí y cumple bajo el umbral: el paso continúa dentro de su presupuesto.
• Sin postcondición disponible: el efecto queda no confirmado y se exige el umbral mayor (7.5).
• Eos inaccesible: la tarea concluye PARTIAL (si hubo avance) o FAILED. No hay fallback determinista, porque la selección y la escalación también dependen de Eos.
• Desaparece la regla de override de D5 (confianza < 0.50 con exit_code = 0): su motivo era corregir al modelo contra señales que ahora el código consulta primero.
• La postcondición prueba el efecto, no el contenido. Que el archivo exista con lo que Qwen escribió no demuestra que el contenido responda al criterio (por ejemplo, que la versión sea la correcta). Por eso cumple recibe también la lectura de postcondición y la evalúa contra el criterio.
7.3 Escalación (reemplaza la Etapa 5B de Qwen)
Se activa ante dos fallos seguidos, agotamiento de reintentos de argumentos, `blocked_loop`, `not_found` persistente, postcondición contradictoria o fallo repetido de una mutación tras verificación. DENY, rechazo explícito y espera de input son estados gestionados por el driver, no una escalación automática.

| Causa | Acciones | Decide |
|---|---|---|
| `NOT_FOUND_PERSISTENT` | `switch_tool` o `ask_user` | Eos, entre opciones permitidas |
| `ARGUMENTS_INVALID` | `switch_tool` | Tabla |
| `BLOCKED_LOOP` | `switch_tool` | Tabla |
| `NONZERO_EXIT_REPEATED` | `retry_with_hint` o `switch_tool` | Eos |
| `POSTCONDITION_CONTRADICTED` | Escalar sin repetir automáticamente la misma mutación; una acción nueva requiere selección explícita y vuelve a pasar por Guard | Código y luego tabla/Eos |
| Timeout de mutación sin confirmación | Registrar `UNCONFIRMED` y escalar; no repetir automáticamente la mutación | Código y luego tabla/Eos |
| `TOOL_VETOED` | `switch_tool` | Tabla |
| Sin alternativa o presupuesto agotado | `abort`, devuelve `EXHAUSTED` con causa `unreachable` | Tabla |

`ask_user` siempre está disponible como herramienta registrada. Qwen genera sus argumentos abiertos (la pregunta) y el handler local espera la respuesta. El paso/tarea entra en `WAITING_INPUT` con `waitingReason=user_answer`; la espera no consume deadline y, al expirar, la tarea termina `PARTIAL` con “pendiente de respuesta”. La respuesta se añade al LOG y a los facts. `recall`, `compose` y `ask_user` pasan por el mismo pipeline de herramientas, incluidos anti-loop, Guard, normalización, `ok` y `cumple`; el resultado específico de `ask_user` solo indica que hay una respuesta pendiente, no que la meta de la tarea esté cumplida. Todas consumen el pool común; las internas no consumen invocaciones MCP. Mantienen topes secundarios configurables como protección adicional, sin reiniciar el presupuesto común.

7.4 Elecciones cerradas dentro de los argumentos
Cuando un argumento es una elección entre candidatos conocidos, el código arma la lista y Eos elige. Qwen genera solo el resto de los argumentos.
• Con 0 candidatos se vuelve al camino abierto (Qwen). Con 1, el código lo toma sin inferencia. Con 2 o más, decide Eos con una opción adicional “ninguno”. Si elige “ninguno” o su confianza queda bajo el mínimo, se vuelve al camino abierto (Qwen). Así se evita, por ejemplo, un clic equivocado en una acción de que es ALLOW.
• Qué argumentos son elecciones cerradas y de dónde salen sus candidatos lo define el manifiesto de herramientas (sección 21). Las herramientas con argumentos totalmente deterministas se saltan a Qwen por completo.
7.5 Umbrales y calibración
Umbral
Hoy
Objetivo
fin (normal / post-acción)
0.51 / 0.60
Desaparece
Override de D5
0.50
Desaparece
ok
Sin umbral propio (D5 con override)
≥ 0.60
cumple en un paso sin mutación, o con postcondición confirmada
0.60 (solo PLAN)
≥ 0.60
cumple en un paso con mutación sin postcondición confirmada
No existe
≥ 0.75
Dependencia de contexto
0.60
Se mantiene, con consumidor definido en 9.9
Mínimo de selección
No existe
0.50, para disparar la segunda pasada
• Con postcondición confirmada, el paso cierra con ok y cumple ≥ 0.60. Sin ella, en un paso con mutación, se exige cumple ≥ 0.75.
• Entre 0.60 y 0.75 en ese caso, el paso continúa dentro de su presupuesto. Si lo agota, queda EXHAUSTED. Un falso cumple tras una mutación cuesta más que un falso ok, por eso el umbral mayor.
• Los valores 0.60, 0.75 y 0.50 son iniciales. [HIPÓTESIS]
• Calibración: recolectar trazas [Decision → SEND/RECV] de al menos 30 tareas exitosas y 20 fallidas [HIPÓTESIS] y medir falsos positivos y negativos de cumple. Los umbrales se congelan solo en la Fase 6.
• Un efecto confirmado por señal no habilita el umbral 0.60: en un paso con mutación exige cumple ≥ 0.75.
7.6 Ventana y presupuesto de Eos
• Ventana operativa 8.192 tokens, como hoy. La nativa de Eos admite hasta 16.384 y no se sube salvo necesidad demostrada.
• El estimador pasa de chars / 3.5 a chars / 3, porque 3.5 es optimista para español, JSON y rutas de Windows. [HIPÓTESIS]
• Orden de descarte: historial antiguo, notas de intentos, resumen del ledger. El catálogo y las preguntas nunca se recortan. Si no cabe, error controlado (como hoy).
8. Errores y reintentos por señal
Principio: primero señales, después modelo. Se distingue “la herramienta falló” de “los argumentos eran malos”: solo lo primero justifica vetar una herramienta.
Señal
Respuesta determinista
denied (Guard DENY)
Paso BLOCKED, terminal. Se registra el motivo. Sin búsqueda de rodeos en el bucle. Decide el driver
Rechazo explícito del usuario
Igual que DENY, incluyendo el motivo opcional que escribió el usuario
Aprobación sin respuesta (timeout)
Resultado propio, no un rechazo: tarea/paso `WAITING_INPUT` con `waitingReason=approval`. Si vence el timeout, concluye PARTIAL como “pendiente de aprobación”, sin replan ni restricción registrada
not_found
Un reintento informado de la misma herramienta con el error en el contexto de argumentos (por ejemplo, una ruta mal adivinada). Si persiste, escalación
empty_output (herramientas con emptyIsError)
Un reintento con argumentos distintos (otra consulta, otro patrón). Si persiste, escalación
Argumentos inválidos, incluida una salida truncada (finish_reason = length)
Hasta 2 reintentos de schema con el error previo. Si la causa es truncamiento, el error pide usar {{ref:rX}} o un contenido más corto. Si se agotan, escalación con causa “argumentos”. No veta la herramienta
El adaptador refresca el árbol y reintenta una vez, sin que el flujo lo vea. Si persiste, fallo normal
timeout de MCP
Lectura: un reintento técnico. Mutación: la postcondición (6.8) decide. Si confirma, la señal se sanea y la llamada sigue como ejecutada. Si contradice, es un fallo y se escala. Si no está disponible o es ambigua, el efecto queda `UNCONFIRMED` y se escala. Nunca se repite automáticamente una mutación cuyo resultado no pudo comprobarse. Para comandos largos se usa el timeout propio de la herramienta (sección 21) o la ejecución en segundo plano con sondeo
exit_code distinto de 0
Fallo lógico. La salida de error pasa al contexto. Reintento informado dentro del presupuesto y luego escalación
ok = no con señales limpias
En lectura: reintento informado con el motivo. Si la mutación quedó confirmada, no repetirla automáticamente; escalar/replanificar. Veto solo tras dos resultados negativos con argumentos distintos
Postcondición que contradice la mutación
Fallo lógico. No se repite automáticamente la misma mutación. Pasa a escalación; cualquier acción nueva debe seleccionarse explícitamente y volver a pasar por Guard
Postcondición no disponible
El efecto queda no confirmado y la respuesta final lo declara. No se reintenta la mutación
blocked_loop
No es un error del servicio. Pasa por la escalación general. Desaparece la regla de “2 bloqueos seguidos”
Servidor MCP caído
Se marca no disponible, se excluyen sus herramientas del catálogo y se escala con switch_tool
Eos inaccesible
La tarea concluye PARTIAL (si hubo avance) o FAILED. Eos decide también la selección y la escalación, por lo que no hay fallback
Qwen inaccesible o timeout
En argumentos, fallo del paso. En la conclusión, respuesta sintética estructurada (como hoy)
Pool, tope de invocaciones MCP o deadline agotado
Conclusión PARTIAL
• excludedToolForNextCall queda reservado para “esta herramienta no sirve” (dos ok = no con argumentos distintos y señales limpias). Nunca se aplica por not_found ni por argumentos inválidos.
• Toda causa de fallo o bloqueo se registra tipificada (señal, herramienta, argumentos resumidos, motivo) y viaja a la selección, la escalación y el replan, para que el sistema no vuelva a proponer la misma acción bloqueada.
9. Memoria y contexto
Principio: el contexto es una función pura del estado. Todos los prompts (de Qwen y de Eos) se construyen desde una única vista del estado, con presupuesto por bloque y orden de descarte explícito.
9.1 Capas de memoria
Capa
Contenido
Vida
Quién la lee
Paso
LOG completo (≤ 100 caracteres por línea; hasta 15 líneas en FAST y 8 en PLAN [HIPÓTESIS]), FAIL, LAST
El paso
Eos (selección y verificación), Qwen (argumentos)
Efectos (effects)
Registro de mutaciones definido en la sección 5
La tarea
Eos (cumple), respuesta final, banner de Guard
Ledger (solo PLAN)
Por paso: estado, result (≤ 160 caracteres) y referencias informativas
La tarea
Qwen (como PREV), replan, respuesta final, Eos (resumen)
Facts y punteros

La tarea
Todos
RefStore

La tarea
El ejecutor (sustitución de placeholders), la pseudo-herramienta recall (a través del ejecutor) y el constructor de la respuesta final. Ningún modelo lo lee directamente
Resumen de salida
FACTS finales, resultado final y effects (≤ 500 caracteres)
La sesión
Tarea siguiente, si needs_context lo activa
Restricciones registradas
“No proponer X” del replan y rechazos explícitos, con su causa tipificada
La tarea
Eos (selección y escalación) y replan
9.2 Handoff determinista entre pasos (PLAN)
Al cerrar un paso en DONE, el motor guarda su result (el hallazgo de la llamada que cumplió el criterio) y marca como informativa la observación de la última lectura exitosa del paso. El paso siguiente recibe PREV (resultado del paso anterior más esa observación, con tope de ~1.500 caracteres [HIPÓTESIS]) y LAST (la última observación del paso actual). Si el planner declara inputsFrom, se traen del ledger los datos de pasos no inmediatos, con el mismo tope. No requiere ninguna llamada a Qwen. FAST no tiene handoff: es un solo paso.
Referencias informativas en FAST. Como FAST no tiene handoff, son informativas las lecturas exitosas del paso ordenadas por recencia, con la primera lectura o búsqueda del paso siempre incluida (9.5).
Extracción fundamentada (opcional, tras la medición de la Fase 1). Solo cuando un paso posterior declara inputsFrom: Qwen extrae los valores necesarios en JSON con campos nulables y el código comprueba que cada valor aparezca literalmente en la evidencia; si no aparece, se descarta. Cuesta una llamada de Qwen únicamente en pasos con dependencia y evita valores inventados.
9.3 Referencias por placeholder y recall
• Qwen puede escribir `{{ref:rX}}` en un argumento. El ejecutor sustituye el contenido real antes del anti-loop y de Guard, por lo que Guard evalúa los argumentos reales.
• Los placeholders solo se admiten en los parámetros declarados por el manifiesto. Siempre están prohibidos en comando, ruta, URL y texto de UI. UI queda fuera de alcance de la v1.
• Una referencia inexistente es un error de argumentos con reintento y error previo.
• El catálogo de referencias muestra una línea por referencia (ID, tipo de resultado, tamaño aproximado), con cantidad máxima configurable.
• `recall(ref, rango o expresión regular)` es una herramienta local de solo lectura sobre RefStore. Eos la selecciona como cualquier otra herramienta y Qwen genera los argumentos abiertos cuando haga falta. Pasa por el pipeline común, consume el pool y no consume invocaciones MCP. Tiene un tope secundario por tarea como protección adicional. Deja una línea compacta en el LOG; la respuesta final no invoca `recall`.
• RefStore es informativo: no conserva marcas web/sensible ni herencia de procedencia. Los topes de almacenamiento quedan en configuración.
• El StepCall persistido conserva la plantilla con placeholders y, del contenido resuelto, tamaño y huella. [PARA REVISIÓN: confirmar límites y firma de recall con la implementación.]

9.4 Evidencia para el juez
• La pregunta cumple recibe criterio más observación compacta, no solo el hallazgo de 120 caracteres.
• Al planificar, Qwen redacta expected_outcome describiendo el tipo de evidencia observable (“resultados que mencionen la versión actual”), no valores todavía desconocidos. Esto se instruye en el prompt de plan.
9.5 Respuesta final por rol, no por recencia
Qwen recibe:
• GOAL.
• En FAST, el LOG completo y effects. En PLAN, el ledger completo y effects.
• FACTS.
• Porciones de referencias informativas (en FAST, según la regla de 9.2), que arma el constructor con presupuesto dinámico: llena el espacio de entrada libre por prioridad (informativas, luego la última lectura exitosa, luego el resto) [HIPÓTESIS: ~15.000 caracteres con ventana de 8.192]. Si trunca una referencia, la marca “contenido parcial”.
• La lista de efectos no confirmado o contradicho, de bloqueos o denegaciones y de procesos que siguen activos (11.6).
Debe declarar lo no confirmado, el contenido parcial y, en PARTIAL, qué faltaba. Para tareas de transformación (“lee este archivo y resúmelo”), el constructor incluye porciones del archivo; la respuesta final no invoca recall.
Truncamiento. Si la respuesta termina con finish_reason = length, se regenera una vez pidiendo concisión. Si vuelve a truncarse, se entrega con la nota “respuesta truncada”.
La limpieza de RefStore al concluir se mantiene y debe cubrir también excepciones y cancelación. [VERIFICAR] core.ts.
9.6 Unificación de FACTS y Scratchpad
Hoy coexisten dos almacenes con claves solapadas, y facts.path y facts.url adoptan el primer resultado hallado. Objetivo: un solo almacén con nombres canónicos. El valor vigente es el seleccionado de forma explícita (por Eos en 7.4 o por uso en una llamada exitosa). Los candidatos se guardan en una lista aparte.
9.7 Ensamblado con presupuesto único y orden estable
Un solo constructor recibe (estado, etapa) y aplica prioridades.
• Presupuesto de entrada = 8.192 − max_tokens − margen (el pensamiento también consume salida). Estimador chars / 3. [HIPÓTESIS]
• Orden de descarte: contexto de charla, FAIL antiguos, líneas antiguas del LOG del paso, recorte de PREV. El system prompt, la meta y el schema nunca se recortan.
• Orden de bloques en el prompt de argumentos (por frecuencia de cambio, para reutilizar el prefijo en llama.cpp):
Hoy
Objetivo
system, GOAL, CHAT, LOG, PLAN, FAIL, FACTS, TOOL, SCHEMA, LAST, ERROR_PREVIO, TASK
system, GOAL, PLAN (ledger), PREV, FACTS, catálogo de refs, LOG del paso, FAIL, y al final TOOL, SCHEMA, LAST, ERROR_PREVIO, TASK
TOOL y SCHEMA van al final porque cambian con cada selección y romperían el prefijo reutilizable. La mejora de latencia depende de que Ollama conserve el slot entre llamadas. [MEDIR] el tiempo de prefill antes y después.
9.8 Qué pasa con el LOG
El LOG de cada paso se conserva completo, con líneas de ≤ 100 caracteres (hasta 15 en FAST y 8 en PLAN). La postcondición de una llamada se registra en la misma línea de esa llamada, y recall no abre línea propia: se anota en la línea de la llamada a la que sirve. Así el LOG no supera su tope aunque haya postcondiciones. El colapso estadístico 1-N: X ok, Y err se elimina: en PLAN el ledger da la vista macro, y en FAST el LOG completo más effects la reemplazan.
9.9 Continuidad entre tareas
Al concluir una tarea se guarda un resumen de salida: FACTS finales, resultado final y effects (≤ 500 caracteres). Se inyecta en la tarea siguiente solo si Eos activa needs_context (umbral 0.60). Esto da por primera vez un consumidor a needs_context y resuelve seguimientos como “ahora bórralo”. Alcance: la sesión. La memoria a largo plazo queda fuera de esta migración.
9.10 Límites: de hoy a objetivo
Límite
Hoy
Objetivo
LOG
Colapso al superar 12 líneas, conserva 6
LOG completo por paso (≤ 100 caracteres por línea; 15 líneas en FAST, 8 en PLAN)
FAIL
5 más recientes
5 recientes por paso, con causa tipificada, más las restricciones del replan, que persisten
Historial a Decision
3 LOG + 2 FAIL, hasta 4.000 caracteres
Vista única con presupuesto por bloque
Intentos (MAX_ATTEMPTS / MAX_NOTE_CHARS)
8 / 60
Se mantienen
Resumen de resultado (MAX_RESULT_CHARS)
400
Se mantiene como cabecera. El juez recibe además la observación compacta
Hallazgo (finding)
120 caracteres
Etiqueta del ledger. result hasta 160
Observación compacta
1.500 caracteres
Se mantiene
Evidencia en respuesta final
Últimas 3
Porciones por prioridad con presupuesto dinámico (~15.000 caracteres)
MAX_SCRATCHPAD_CHARS
2.000
Se integra en el almacén único
10. Cambios en el uso de Qwen
Etapa
Hoy
Objetivo
Salida máxima
Plan (solo PLAN)
Descompone en hasta 15 pasos con suggested_mcp y expected_outcome
Hasta 8 pasos o plan vacío. Recibe el catálogo de herramientas por servidor (~300 tokens). Produce criterio observable, marca los pasos de redacción como compose y, opcionalmente, inputsFrom
1.500
Argumentos (Etapa 3)
Todos los campos
Solo los campos abiertos. Admite placeholders {{ref:rX}}
1.024
Redacción interna (compose, FAST y PLAN)
No existe
Texto para un paso posterior (6.7)
1.500
Escalación (Etapa 5B)
Elige switch_mcp o abort
Eliminada. La deciden el código y Eos
n/a
Replan (solo PLAN)
Reformula los pasos restantes
Recibe las restricciones registradas (herramientas denegadas, rechazos) y el ledger
1.500
Respuesta final (Etapa 6)
Basada en LOG, FACTS y las últimas 3 EVID
Según 9.5
1.500
Conversación directa
fin en la primera iteración
Prompt corto, sin ledger. En PLAN, tras un plan vacío
1.500
• Truncamiento: se detecta finish_reason = length en argumentos (8), compose (6.7) y respuesta final (9.5). [VERIFICAR] que el cliente de Qwen lo exponga.
• Thinking: el ajuste del usuario aplica solo a plan, replan, pasos compose y respuesta final. Según ARCHITECTURE, la generación de argumentos nunca está entre las etapas con reasoning_effort. [VERIFICAR] en dispatchPrompt y mantenerla sin thinking.
• Timeouts: se mantienen 120 s (180 s con thinking). El deadline global se aplica por encima (12.2).
• Métrica de latencia: llamadas a Qwen por tarea y, por llamada, el tiempo de prefill frente al de generación.
11. Seguridad y Guard
La política de Guard (ALLOW, APPROVAL, DENY) sigue siendo determinista e independiente de los modelos. Cambian los puntos donde se aplica y algunos detalles operativos.
11.1 Guard sobre argumentos reales
La sustitución de `{{ref:rX}}` ocurre antes del anti-loop y de Guard. Guard inspecciona los argumentos resueltos. En v1 no se añade política específica para rutas o ventanas sensibles ni se marca contenido por procedencia web. Las reglas generales de Guard y las restricciones por herramienta del replan siguen vigentes. Los placeholders quedan prohibidos en parámetros de comando, ruta, URL y texto de UI, y solo se permiten donde el manifiesto lo declara.

11.2 Aprobaciones
• Timeout configurable [HIPÓTESIS: 10 min]. Al vencer no se trata como rechazo: el paso queda bloqueado por “aprobación pendiente” y la tarea concluye PARTIAL. Hoy la compuerta espera indefinidamente.
• Cancelación explícita del usuario: se mantiene.
• Alcance por invocación única: se mantiene. No hay autorización permanente.
• Motivo del rechazo: el texto opcional del usuario viaja al replan como restricción registrada. Solo los rechazos explícitos generan restricción; el timeout no.
• GuardBanner muestra la herramienta, la ruta o el destino y el comando completo. Para contenido, una vista previa acotada (~500 caracteres) con opción de expandir, el tamaño y una cuenta regresiva del timeout. El usuario no aprueba a ciegas lo que se va a escribir o ejecutar.

• El tiempo de espera de una aprobación no consume el deadline (12.2).
11.3 Anti-loop
• Se calcula sobre los argumentos ya resueltos (con huella del contenido), de modo que escribir dos veces el mismo contenido se detecta.
• La documentación actual lo describe como “firma repetida sin lectura intermedia” pero la firma usa nonReadCounter. Se fija una sola semántica: se bloquea la repetición idéntica de una llamada si no hubo ninguna mutación entre ambas. Las exenciones de sondeo vigentes se mantienen. [VERIFICAR] qué hace hoy el código.
• Nueva exención: lecturas mientras haya procesos en segundo plano activos en la tarea, porque su contenido cambia sin mutación intermedia.
• Las postcondiciones están exentas (6.8). recall sí pasa por el anti-loop (9.3).
• Un blocked_loop pasa por la escalación general (sección 8).
11.4 Catálogo plano y herramientas no registradas
Con el catálogo plano, toda herramienta nueva que descubra un servidor sería una opción para Eos. La heurística actual de getPolicy() clasifica como READ (con ALLOW) los nombres con prefijo de lectura y sin términos destructivos, así que una herramienta de nombre inofensivo que mute estado se ejecutaría sin aprobación. Propuesta: una herramienta no registrada se ofrece a Eos solo si la heurística la clasifica como READ; las demás no se ofrecen hasta registrarlas en el manifiesto de herramientas (sección 21), del que se deriva el PolicyRegistry.
11.5 Persistencia y privacidad
• Escritura atómica de jarvis-tasks.json (archivo temporal y renombrado) en lugar de writeFileSync directo.
• Argumentos sensibles: el StepCall persistido guarda la plantilla con placeholders y, del contenido resuelto, tamaño y huella. Los textos escritos y los contenidos de archivos no se almacenan en claro.
• Evidencia persistida: obs, el result del ledger y los valores de FACTS también pueden contener secretos. Antes de persistir se aplica redacción por patrones y un tope de tamaño. Las lecturas de rutas sensibles no se persisten.
• Consola: los prompts completos ([Decision → SEND], [Qwen → SEND]) se emiten solo en modo depuración y con los mismos enmascarados.
• Fuera del alcance mínimo (decisión abierta): cifrado en reposo.
11.6 Cancelación, procesos y concurrencia
• Cancelación con llamada MCP en vuelo: la tarea pasa a CANCELLED, el resultado tardío se descarta y RefStore se limpia en toda ruta de salida. [VERIFICAR] core.ts.
• Procesos: los procesos que la tarea inició (efectos de inicio de proceso) se terminan solo al cancelar. Al concluir no se terminan: la respuesta final lista los que siguen activos.
• Concurrencia: se mantiene la advertencia actual (varias tareas sobre la UI interfieren en foco y controles). 
• Limpieza de procesos activos. Si la tarea concluye sin cancelar, o tras un reinicio, los procesos solo se listan. 
11.7 Superficie de seguridad adicional
- Versiones de servidores MCP fijadas: Fase 0.
- Procesos: terminarlos solo al cancelar y listar los activos en la respuesta final: Fase 2.
- Se eliminan de v1 los controles específicos de procedencia web, rutas/ventanas sensibles, y control de UI. Sus riesgos se registran en “Fuera de alcance de la v1 y riesgos aceptados”.
- Se mantienen las restricciones por herramienta del replan (“no proponer X”). No se implementan restricciones por efecto.

12. Presupuestos y límites
12.1 Tabla de límites

| Límite | Hoy | Objetivo v1.3 |
|---|---|---|
| Pasos del plan (`MAX_STEPS`) | 15; en FAST limita de hecho las llamadas a ~15 | Máximo 8 en PLAN. En FAST el paso es único [HIPÓTESIS] |
| Pool de herramientas elegidas por Eos (`MAX_TOOL_CALLS_TASK`) | 30 | 30 en PLAN y 15 en FAST. Cada herramienta elegida, incluidas las locales, consume una unidad. Las llamadas MCP externas y las lecturas MCP de postcondición cuentan además contra el tope MCP. Los reintentos técnicos del adaptador no crean una nueva selección ni gastan pool, pero cuentan contra el tope MCP [HIPÓTESIS] |
| Tajada por paso (`MAX_TOOL_CALLS_PER_STEP`) | 4 (solo PLAN) | 4 iniciales por paso en PLAN. Lo no gastado vuelve al pool de la tarea |
| Tope de invocaciones MCP | No existe | 2,5× el pool: 60 en PLAN y 30 en FAST. Incluye postcondiciones y reintentos del adaptador [HIPÓTESIS] |
| `recall` | No existe | Consume el pool común y no el tope MCP. Tope secundario de 20 por tarea |
| Pasos `compose` | No existen | Consumen el pool común y no el tope MCP. Cuentan además como una llamada de Qwen; `maxComposeCallsPerTask` es un límite secundario |
| `MAX_ARG_RETRIES` | 2 | Se mantiene |
| `MAX_ESCALATIONS` | 2 | Se mantiene. Aplica a `switch_tool` y `ask_user` |
| `maxReplans` | 2 | Límite global por tarea, compartido por todas las causas de replanificación; no se reinicia por causa |
| Deadline global de tarea | No existe | Nuevo [HIPÓTESIS: 10 min, configurable] |
| Timeout de aprobación | No existe | Nuevo [HIPÓTESIS: 10 min, configurable]. Resultado propio, no rechazo (sección 8) |
| Expiración de la confirmación del plan | No existe | Nuevo: 30 min, configurable. La tarea pasa a `CANCELLED` (6.1) |

12.2 Deadline global
• Es un reloj de tarea que excluye los tiempos de espera del usuario: aprobaciones, confirmación del plan y, si existe, ask_user.
• Se comprueba antes de cada llamada a Qwen, a Eos y a una herramienta. Al vencer no se inician llamadas nuevas. La llamada ya en vuelo se espera hasta su timeout y luego la tarea concluye PARTIAL.
• La interfaz muestra el tiempo restante y avisa al acercarse al límite.
13. Persistencia, API e interfaz
13.1 Esquema de jarvis-tasks.json
Un único esquema versionado (schemaVersion). Tarea: identificador, modo, mensaje, estado, plan con pasos (puede ser vacío), effects (definido en la sección 5), registra el resultado, ledger (solo PLAN), almacén único de hechos, referencias informativas, restricciones registradas, uso de presupuesto (llamadas del pool, invocaciones MCP, recall, escalaciones, replanes, inicio, deadline, tiempo en espera), resumen de salida y respuesta final. Paso y llamada: como en la sección 5. Se conservan las últimas 20 tareas.
13.2 Migración de tareas persistidas
• Antes del primer arranque con el esquema nuevo se hace una copia de respaldo del archivo.
• Las tareas persistidas con el esquema viejo se descartan después de crear una copia de respaldo. No existe conversión.
• Las tareas RUNNING o WAITING_INPUT al reiniciar siguen pasando a CANCELLED, como hoy. No hay reanudación automática.
13.3 API y eventos
• Endpoints actuales: se mantienen (process, confirm-plan, approve, deny, cancel, state, events).
• Aprobación con timeout: emite APPROVAL_RESOLVED con resolución “timeout”. La expiración de la confirmación del plan emite un evento propio.
• Eventos nuevos: selección tomada (herramienta y confianza), resultado de postcondición, resultado de verificación (ok y cumple con confianza), escalación decidida (acción y causa), aviso de presupuesto o deadline.
• `ask_user` forma parte del alcance v1. Usa el estado común WAITING_INPUT y un endpoint para la respuesta del usuario; `waitingReason` identifica `user_answer`.
• No se añade un endpoint de limpieza manual en v1. Los procesos activos se enumeran al concluir; se terminan automáticamente solo al cancelar la tarea.
13.4 Interfaz
• Timeline y ProcessFlow: interpretan un solo esquema (paso con N llamadas). FAST muestra un paso.
• ContextInspector: muestra las capas de memoria (paso, effects, ledger, hechos, referencias, resumen de salida) y el uso de tokens por bloque.
• DecisionStream: muestra la selección, las dos verificaciones con su confianza y las escalaciones.
• GuardBanner: comando completo, vista previa acotada del contenido (~500 caracteres, expandible), tamaño,  y cuenta regresiva del timeout.
• Marcas visibles: estado de cada efecto (confirmado, confirmado por señal, no confirmado, contradicho), tiempo restante del deadline, procesos activos (solo informativos; sin acción de limpieza en v1) y restricciones registradas por el replan.
14. Impacto por documento y módulo
14.1 Documentación a reescribir
Documento
Qué cambia
CORE_FLOW
Diagrama de flujo único (motor de paso y drivers), tabla de pasos, decisiones, iteraciones y límites, tabla de errores por señal y traza de ejemplo
ARCHITECTURE
Componentes (motor de paso y drivers en lugar de dos bucles; Eos con selección, verificación y escalación; Qwen sin Etapa 5B), tabla de modelo y parámetros (umbrales), reparto código / Eos / Qwen
CONTEXT_AND_MEMORY
Construcción del contexto (orden estable), capas de memoria, effects, evidencias, datos enviados a modelos y límites
TOOLS_AND_SECURITY
Ejecución (sustitución de refs, postcondiciones, política por señal), aprobaciones (timeout), seguridad (sección 11) y persistencia. La tabla de permisos por capacidad no cambia. El catálogo y las reglas por herramienta pasan a DOC_HERRAMIENTAS
DOC_HERRAMIENTAS
Se genera desde el manifiesto tipado de herramientas (sección 21)
14.2 Módulos afectados (conceptualmente)
Módulo
Cambio funcional
Motores de ejecución (modeEngines)
Se convierten en motor de paso más dos drivers. Desaparecen la validación de fin y la escalación por Qwen
Ejecutor de llamadas (callExecutor)
Sustitución de placeholders con parámetros permitidos, recall, postcondiciones por capacidad, política por señal, anti-loop sobre argumentos resueltos
Motor de decisión (decision)
Selección, verificación (dos preguntas) y escalación por tabla más Eos. Elecciones cerradas de argumentos
Razonador (qwen)
Sin Etapa 5B. Argumentos con placeholders. Redacción compose. Replan con restricciones. Detección de truncamiento
Prompts (prompts)
Orden estable, catálogo en el plan, criterio observable, plan vacío, constructor único con presupuesto
Contexto (context)
effects, ledger (PLAN), almacén único de hechos, handoff, resumen de salida
Procesador de resultados (resultProcessor)
Evidencia con contenido, marca informativa y catálogo de referencias
Orquestador (core)
Deadline, presupuestos, expiración del plan, cancelación con llamada en vuelo, persistencia atómica y migración
Tipos (types)
Modelo Tarea → Plan → Paso → Llamada, effects, estados de paso, causas tipificadas
Política (guard, policyRegistry)
Sin reglas especiales para rutas sensibles ni UI; solo política general y manifiesto
Interfaz
Según 13.4
15. Plan de migración por fases
Cada fase se implementa de forma aislada, con criterio de salida y flag de reversión cuando haya cambio de comportamiento.

| Fase | Contenido | Criterio de salida | Reversión |
|---|---|---|---|
| 0. Persistencia segura y preparación | Escritura atómica, redacción por patrones al persistir, versiones fijadas de servidores MCP y correcciones documentales. No reordenar prompts. | Regresión base sin cambios de comportamiento. | Revertir cada cambio independiente. |
| 1. Medición y contrato | Trazas reales, fixtures de replay, resolución de [VERIFICAR], línea base de latencia/prefill, catálogo y manifiesto tipado aprobado. | Contrato de herramientas y línea base aprobados. | No aplica. |
| 2. Infraestructura y cambios con flags | Deadline, presupuestos, expiraciones, reintentos transitorios de Eos, ask_user, compose/recall internos, persistencia intermedia aditiva con `schemaVersion`, effects mínimo solo si tiene consumidor tras los recortes. Reordenamiento de bloques del prompt detrás de flag. Retirar UI en commit aislado `ui-legacy` antes de activar Fase 2. | Flags probados individualmente; tareas viejas respaldadas antes de descartarse; prompt medido antes/después. | Flag por cambio; restaurar backup si falla persistencia. |
| 3. Motor único y Eos | runStep, selección unificada, ok/cumple, umbrales por modo y mutación, escalación tipificada; “incorrecta” de D5 hasta Fase 3 representa el equivalente de `ok = no` en Fase 2. | Replay, tests de transición y test diferencial FAST ≡ PLAN de un paso. | Flag que restaura los motores/decisiones anteriores. |
| 4a. Memoria base | Placeholders permitidos, recall, effects completo si no se incorporó antes, evidencia para Eos, LAST separado de postcondición, LOG y handoff. | Casos de transferencia multi-paso y postcondiciones pasan. | Flag por mecanismo. |
| 4b. Planner y continuidad | Planner con catálogo, criterio, `mutates`, plan vacío, validaciones y replan; compose y elecciones cerradas; needs_context. | Plan máximo válido, transferencia y seguimiento entre tareas pasan. | Flag por mecanismo. |
| 5. Modelo persistido e interfaz | Esquema final, descarte de tareas viejas tras backup verificado y vistas para paso con N llamadas. | Suite de regresión y lectura de estado consistentes. | Restaurar backup y flag al esquema anterior. |
| 6. Limpieza | Retirar adaptadores antiguos/flags, centralizar constantes y manifiesto, generar tablas y pruebas tipadas de transición. | Tests pasan; no quedan dependencias circulares; documentación generada coincide con constantes. | No aplica. |

La línea base de prefill se mide en Fase 1. El reordenamiento de bloques ocurre en Fase 2 con flag. El pool es 30 PLAN y 15 FAST; el tope MCP es 2,5× el pool. Para FAST, 15 × 2,5 = 37,5: aplicar techo y configurar 38 invocaciones. Los efectos mínimos en Fase 2 solo se introducen si un consumidor superviviente los necesita; de lo contrario, pasan a Fase 4a.

**Puerta de Fase 5:** considerar incidentes atribuibles a adaptadores/modelo de datos y divergencias no corregibles en el test diferencial, siempre después de los recortes de alcance de v1. Los umbrales numéricos de la puerta son [HIPÓTESIS] y deben residir en configuración hasta validarse con trazas.

16. Validación y métricas
Métrica
Cómo se mide
Objetivo [HIPÓTESIS]
Llamadas a Qwen por tarea (media y p90)
Trazas [Qwen → SEND]
Menor que la línea base (al menos 1 menos por tarea con escalación)
Latencia total de tarea (p50 y p90)
Tiempos de la tarea
Menor que la línea base
Prefill frente a generación en Qwen
Duraciones por llamada
Prefill menor tras el reordenamiento de prompt
Precisión de selección
Set de ~50 casos etiquetados
No inferior a la cadena D1 + D2
Falsos positivos y negativos de cumple
Al menos 50 pasos etiquetados a mano
Falsos positivos mínimos (son los que cierran en falso)
Efectos no confirmado o contradicho
Estado final de effects
no confirmado excepcional
Reintentos informados que corrigen not_found
Trazas por señal
Mayor que cero. Antes era imposible
Invocaciones MCP y uso de recall por tarea
Contadores de presupuesto
Dentro del tope 2,5× el pool y del tope de 20
Tareas que alcanzan deadline o presupuesto
Estados finales por causa
Pocas y explicables
Aprobaciones vencidas y aprobaciones adicionales por reglas de seguridad
Eventos de timeout y de Guard
Informativa
Casos de regresión mínimos: búsqueda y escritura (la traza de Node.js, con postcondición de la escritura); búsqueda, lectura intermedia y escritura; lectura de un archivo largo y copia por placeholder; ruta mal adivinada (not_found); borrado con not_found posterior como éxito; postcondición confirmada, contradictoria y no disponible; patrón DENY; rechazo del usuario con replan; aprobación sin respuesta; blocked_loop; conversación directa; plan vacío; confirmación del plan que expira; cancelación con llamada en vuelo; reinicio con tarea pendiente; plan del máximo (8 pasos) con replan; paso compose truncado; argumentos truncados; respuesta final truncada; seguimiento “ahora bórralo” que activa needs_context; elección cerrada con “ninguno”; proceso activo al concluir; pool y tope MCP agotados; comando de más de 30 s.
Casos agregados en v1.2. Timeout de mutación con postcondición confirmada, contradictoria y no disponible; proceso corto que termina antes de la lectura; escritura con saltos de línea normalizados; escritura parcial; comando exitoso sin postcondición (confirmado por señal); efecto corregido por un reintento; lista de efectos compactada en una tarea de UI de 15 acciones; referencia derivada de evidencia web; 
Replay. Las pruebas se ejecutan con replay: se graban entradas y salidas de Eos, Qwen y MCP y se repiten de forma determinista, sin modelos.
17. Riesgos y mitigaciones
Riesgo
Mitigación
cumple es el único mecanismo de terminación: un falso positivo cierra en falso y un falso negativo cicla
Dos preguntas separadas, evidencia con contenido, criterios observables, umbral 0.75 sin postcondición confirmada, presupuestos por paso y de tarea, medición antes de congelar umbrales
La selección en una sola llamada pierde precisión con casos ambiguos
Validación con ~50 casos, segunda pasada con 5 candidatas, flag de reversión, prefiltro si el catálogo crece
Costo y regresiones de la migración de datos e interfaz
Fases, copia de respaldo y puerta con señales concretas antes de la Fase 5
Una postcondición no es viable para una capacidad
El efecto queda no confirmado, se exige el umbral mayor y la respuesta final lo declara
Las postcondiciones suman invocaciones MCP
Son lecturas ALLOW sin LLM. No gastan el pool y cuentan contra el tope 2,5× el pool
Contenido sustituido de gran tamaño o con instrucciones incrustadas
Guard evalúa el contenido real, tamaño máximo por llamada, el contenido se trata siempre como dato
Qwen escribe un placeholder mal formado o inexistente
Error de argumentos con reintento y error previo. Catálogo de refs claro en el prompt
La caché de prefijo no aporta
Se mide en la Fase 1. No es requisito del diseño
El catálogo plano desborda la ventana de Eos
Presupuesto por bloque, estimador chars / 3, prefiltro
La escalación elige acciones inadecuadas y provoca ciclos
MAX_ESCALATIONS, restricciones registradas, tabla por causa y abort, que devuelve el paso al driver como EXHAUSTED con causa “inalcanzable”
La tabla de escalación no cubre una causa nueva
Eos decide donde la tabla deja varias acciones. abort siempre es posible
Una elección cerrada de argumentos escoge el candidato equivocado
Solo con 2 o más candidatos, opción “ninguno”, Guard y aprobación siguen vigentes
Deadline demasiado corto y PARTIAL prematuros
Configurable, excluye esperas del usuario, calibración con trazas
Un paso compose inventa contenido
Recibe solo evidencia informativa. El texto va a RefStore y la respuesta final no lo presenta como verificado
La ausencia de controles de procedencia y rutas sensibles deja riesgos aceptados
Recortes registrados en la sección B
Un truncamiento pasa desapercibido
Detección de finish_reason = length en argumentos, compose y respuesta final. [VERIFICAR] que el cliente lo exponga
Reintentar una mutación tras una contradicción duplica efectos
“Contradice” solo con evidencia inequívoca. Se escala sin reintentar automáticamente la misma mutación; una nueva acción requiere selección explícita y vuelve a pasar por Guard (6.8)
Un paso cierra porque la postcondición prueba el efecto, pero no que el contenido responda al criterio
cumple recibe también la lectura de postcondición (7.2)
18. Pendientes por verificar con el código
Los puntos siguientes deben resolverse mediante lectura del código y trazas. El contraste no se considera completado mientras no se disponga del repositorio y sus módulos. No convertir hipótesis en hallazgos.
1. modeEngines: ruta real de PLAN y autoridad de suggested_mcp.
2. prompts: entradas exactas de las decisiones actuales y del planner.
3. qwen: thinking por etapa, num_ctx y exposición de finish_reason.
4. callExecutor: sustitución de referencias antes del anti-loop y Guard; ejecución y contabilización de postcondiciones; reintentos tras timeout.
5. anti-loop: semántica real y contador usado.
6. core: limpieza de RefStore en excepciones/cancelación y resultado tardío de llamadas en vuelo.
7. decision: consumidor actual de needs_context y tipos de pregunta soportados por Decision 2.0.
8. modeEngines: tratamiento actual de UNVERIFIED.
9. resultProcessor: almacenamiento de observaciones, facts y RefStore.
10. guard/policyRegistry: permisos efectivos y origen de clasificación.
11. Configuración real, constantes, estados y persistencia.
12. Contrato de start_process, kill_process y sondeo de procesos largos.
13. API de Decision 2.0: forma exacta de la pregunta para cada llamada Eos.
14. Manifiesto de herramientas: capacidades, argumentos, timeout y lecturas verificables.

Estado de auditoría v1.3: NO VERIFICADO — el material recibido contiene solo este documento, no el código fuente ni las trazas requeridas. El apéndice “Hallazgos del código” debe actualizarse cuando se entregue el repositorio. 

19. Inconsistencias de la documentación actual
Son independientes del rediseño. Algunas desaparecen con él y el resto conviene corregirlas en la Fase 0.
#
Inconsistencia
Destino
1
Escalación en PLAN. La tabla de pasos dice que en PLAN se replanifica, pero el diagrama envía StepFail, ArgFail, GuardDeny y UserDeny a Escalation, y switch_mcp vuelve a FastLoop, lo que abandona el plan sin decirlo
Desaparece con el motor único
2
LoopBlock frente a ArgFail. El primero vuelve a FastLoop (o concluye tras 2 bloqueos) y el segundo escala
Desaparece (ambos escalan)
3
Dos descripciones del fallback de fin. CORE_FLOW dice redirección forzada a un servidor por defecto. ARCHITECTURE dice que se elige la mejor ruta no-fin según probabilidades
Desaparece (no hay fin validado)
4
Anti-loop. Descrito como “sin lectura intermedia” pero firmado con nonReadCounter
Se corrige en la Fase 2 (11.3)
5
Traza de ejemplo frente a la memoria. La traza dice que Qwen usa FACTS “con datos de Node.js”, pero FACTS solo guarda identificadores. La versión le llega por LAST
Se corrige al reescribir la traza
6
MAX_STEPS y MAX_TOOL_CALLS_TASK. En FAST el límite efectivo es ~15 llamadas, no 30. El tope de 30 solo actúa en PLAN
Desaparece con el paso único y el pool por modo
7
FACTS y Scratchpad con claves solapadas. La tabla de memoria muestra path frente a path (probable errata en el nombre de una de las claves)
Desaparece con el almacén único
20. Decisiones tomadas
1. `recall`, `compose` y `ask_user` se registran como herramientas locales y pasan por el mismo pipeline general que las herramientas MCP. Solo cambia el handler de ejecución; las internas consumen pool, pero no el tope MCP.
2. FAST usa siempre cumple ≥ 0.75. PLAN usa 0.60 si el paso no muta o tiene postcondición confirmada; 0.75 si muta sin postcondición confirmada. Confirmado por señal no habilita 0.60.
3. La confirmación del plan es obligatoria, salvo plan vacío.
4. Las tareas persistidas con esquema viejo se descartan tras copia de respaldo; no se convierten.
5. El reordenamiento de bloques del prompt pasa a Fase 2, con flag. La línea base de prefill se mide en Fase 1.
6. El tope de invocaciones MCP es 2,5× el pool; todos los demás valores de la sección 20 anterior se mantienen salvo donde esta v1.3 los cambie expresamente.
7. Ejecución concurrente no se exige ni se prohíbe; se mantiene la advertencia, sin bloqueo por recurso.
8. Control de UI y `windows` MCP quedan fuera de alcance de la v1; se conserva arquitectura por capacidades para reincorporarlos. El snapshot MCP se usa como evidencia de que el inventario de seguridad actual requiere actualización.
9. Las restricciones por efecto, la idempotencia como atributo de manifiesto, el cifrado en reposo y la limpieza manual de procesos quedan fuera de alcance.
10. Se elimina toda lógica normativa de rutas/ventanas sensibles y procedencia web/tainted; se conserva redacción por patrones al persistir y consola completa solo en depuración.
11. Los procesos se terminan solo al cancelar; los que sigan activos se enumeran en la respuesta final.
12. Las preguntas y los valores no fijados están en la tabla de configuración y en “Preguntas pendientes agrupadas”.

21. Contrato con DOC_HERRAMIENTAS
El manifiesto tipado es la fuente de verdad para capacidades, mutabilidad, Guard, ejecutor, selección y documentación generada. Por herramienta declara: (1) capacidad y subtipo; (2) si muta, postcondición o ausencia de ella, lectura y argumentos deterministas; (3) argumentos de elección cerrada y fuente de candidatos; (4) parámetros donde se permiten placeholders; (5) timeout propio o modo en segundo plano; (6) handler/transport (`local` o `mcp`). Qwen puede proponer `mutates` en el plan solo como información auxiliar; el runtime lo recalcula desde el manifiesto y el tipo de herramienta seleccionada. Si no hay metadatos confiables o la herramienta no está registrada, no se asume que sea de solo lectura: no se ofrece para ejecución hasta registrarla y asignarle política explícita. Para comandos largos, el manifiesto declara timeout propio o `start_process` + sondeo; la finalización se verifica mediante estado terminal del proceso y salida/resultados disponibles, no por el mero hecho de haberlo iniciado. La regla de herramientas no registradas sigue en 11.4.

### 21.1 Snapshot de herramientas MCP (observado el 2026-10-12)
Fuente: snapshot `GET /api/mcp/:server/tools`, con salidas reales de `tools/list` por MCP/stdio aportadas para esta revisión. Los conteos y los nombres reflejan esa ejecución concreta; deben reconsultarse antes de modificar políticas. Las conclusiones sobre riesgo se derivan de las descripciones y flags incluidos en el snapshot.

| Servidor | Herramientas observadas | Divergencia documental | Tratamiento de migración |
|---|---:|---|---|
| `windows` | 21 | Documento actual citado: 12; +9 no documentadas | Fuera del catálogo por defecto de v1. Si se reincorpora, registrar cada herramienta y política explícita; no usar heurística como control final. |
| `desktop_commander` | 26 | Documento actual citado: 12; +14 no documentadas | Mantener solo herramientas registradas explícitamente. Revisar especialmente procesos, configuración, escritura PDF, movimiento, directorios y herramientas de búsqueda/paginación. |
| `free_search` | 11 | Documento actual citado: 14; −3 ausentes | Actualizar nombres/contratos y retirar referencias a `fetch_page` y `read_cached_resource` si el código confirma que ya no existen. `download` requiere aprobación. |

Hallazgos de seguridad del snapshot:
- `windows` expone `PowerShell`, `FileSystem`, `Process` y `Registry`; no deben quedar protegidas solo por heurísticas de nombres o `readOnlyHint`.
- En `desktop_commander`, nombres como `create_directory`, `move_file`, `write_pdf`, `start_process`, `interact_with_process`, `force_terminate` y `kill_process` requieren una política explícita basada en su capacidad real, no en el prefijo del nombre.
- `readOnlyHint` y `destructiveHint` son metadatos aportados por el servidor MCP; ayudan al descubrimiento, pero no reemplazan el manifiesto confiable ni el Guard local.
- El snapshot informa que varias herramientas no están mapeadas en `PolicyRegistry`. La v1 no debe ejecutar herramientas no registradas: hasta que exista entrada de manifiesto y política explícita, se excluyen del catálogo ejecutable.
- La discrepancia entre inventario real y `TOOLS_AND_SECURITY.md` debe corregirse en los documentos actuales del JARVIS como trabajo de auditoría separado. Este documento de migración registra el hallazgo, pero no afirma que esos archivos ya se hayan corregido.

22. Registro de cambios (apéndice no normativo)
La bitácora histórica de v1.1 y v1.2 se mantiene fuera del texto normativo. Esta versión consolida las decisiones de la tarea y las especificaciones marcadas para revisión.

## 23. Protocolo de implementación
1. Auditoría antes que código.
2. Ante contradicciones entre documento y código, registrar la evidencia y preguntar antes de cambiar el diseño. Agrupar las preguntas en un único mensaje.
3. Implementar una fase por vez. No avanzar sin cumplir su criterio de salida y definir/activar su flag de reversión.
4. No inventar valores. Todo valor [HIPÓTESIS] debe residir en configuración y no queda fijado normativamente hasta validarlo.
5. Todo cambio de comportamiento queda detrás de un flag desde la Fase 2.
6. Insumos para la auditoría de implementación: código y pruebas del JARVIS actual; CORE_FLOW, ARCHITECTURE, CONTEXT_AND_MEMORY y TOOLS_AND_SECURITY (son documentos del sistema actual, no de esta migración); trazas reales de Decision 2.0; referencia oficial de la API; y manifiesto cuando exista.

## A. Especificaciones canónicas [PARA REVISIÓN]

### A.1 Enumeraciones canónicas
Cada concepto se define una sola vez. Texto español para documentación; identificador inglés único para código. La lista es propuesta normativa pendiente de revisión contra los tipos reales.

**Capacidades**
- Lectura: `READ`
- Escritura de archivo: `FILE_WRITE`
- Borrado de archivo: `FILE_DELETE`
- Control de procesos: `PROCESS_CONTROL`
- Descarga: `DOWNLOAD`
- Ejecución de comandos: `COMMAND_EXECUTION`
- Configuración: `CONFIGURATION`
- Capacidad no clasificada: `UNKNOWN`
- Control de interfaz: `UI_ACTION` — reservada para una posible reincorporación, no disponible en v1.

**Señales**
- Sin error tipificado: `CLEAN`
- Acceso denegado: `DENIED`
- Recurso inexistente: `NOT_FOUND`
- Salida vacía: `EMPTY_OUTPUT`
- Tiempo agotado: `TIMEOUT`
- Código de salida distinto de cero: `NONZERO_EXIT_CODE`
- Bucle bloqueado: `BLOCKED_LOOP`
- Argumentos inválidos: `INVALID_ARGUMENTS`
- Error informado por herramienta: `TOOL_ERROR`
- Error de servicio: `SERVICE_UNAVAILABLE`
- Resultado ambiguo: `AMBIGUOUS_RESULT`

**Causas tipificadas**
`ARGUMENTS_INVALID`, `NOT_FOUND_PERSISTENT`, `EMPTY_OUTPUT_PERSISTENT`, `NONZERO_EXIT_REPEATED`, `BLOCKED_LOOP`, `MUTATION_TIMEOUT_UNVERIFIED`, `POSTCONDITION_CONTRADICTED`, `TOOL_VETOED`, `BUDGET_EXHAUSTED`, `DEADLINE_EXPIRED`, `EOS_UNAVAILABLE`, `QWEN_UNAVAILABLE`, `USER_DENIED`, `USER_INPUT_PENDING`, `APPROVAL_PENDING`, `PLAN_INVALID`.

**Estados de efecto**
- Confirmado: `CONFIRMED`
- Confirmado por señal: `CONFIRMED_BY_SIGNAL`
- No confirmado: `UNCONFIRMED`
- Contradicho: `CONTRADICTED`

**Eventos**
`TASK_CREATED`, `PLAN_PROPOSED`, `PLAN_CONFIRMED`, `PLAN_EXPIRED`, `STEP_STARTED`, `STEP_STATE_CHANGED`, `TOOL_SELECTED`, `CALL_STARTED`, `CALL_FINISHED`, `POSTCONDITION_CHECKED`, `EOS_VERDICT`, `ESCALATION_SELECTED`, `USER_INPUT_REQUESTED`, `USER_INPUT_RECEIVED`, `BUDGET_WARNING`, `DEADLINE_WARNING`, `TASK_FINISHED`.

### A.2 Transiciones de estado [PARA REVISIÓN]
**Tarea**
- `RUNNING → COMPLETED`: todos los pasos del plan completados o plan vacío respondido.
- `RUNNING → PARTIAL`: hubo avance y el trabajo terminó sin completar la meta por presupuesto, deadline, escalación terminal o espera de respuesta.
- `RUNNING → FAILED`: no hubo avance útil y ocurrió un error irrecuperable, incluido un plan inválido tras el único reintento.
- `RUNNING → CANCELLED`: cancelación explícita o reinicio con tarea activa. El vencimiento de confirmación del plan conserva la regla ya documentada de `CANCELLED`.
- Estado terminal no transiciona a otro estado terminal.

**Paso**
- `PENDING → RUNNING` al iniciar.
- `RUNNING → WAITING_INPUT` cuando una herramienta necesita una entrada externa o una aprobación; `waitingReason` identifica `approval`, `plan_confirmation` o `user_answer`.
- `WAITING_INPUT → RUNNING` al recibirse la entrada requerida; el paso pasa a `BLOCKED` al expirar. Si `waitingReason=plan_confirmation`, la tarea termina `CANCELLED`; si es `approval` o `user_answer`, termina `PARTIAL`. La cancelación explícita del usuario termina `CANCELLED`.
- `RUNNING → DONE` cuando `ok` es positivo y `cumple` supera el umbral correspondiente.
- `RUNNING → EXHAUSTED` al agotar presupuesto o escalar con `abort`.
- `RUNNING → BLOCKED` ante DENY o rechazo explícito.
- Cualquier estado no terminal puede pasar a `CANCELLED` por cancelación de tarea.

**Llamada**
- `PENDING → RUNNING → SUCCEEDED | FAILED | WAITING_INPUT`. `WAITING_INPUT` es el único estado de espera; `waitingReason` identifica `approval`, `plan_confirmation` o `user_answer`.
- La postcondición es un resultado separado, no un estado de llamada: `CONFIRMED`, `CONFIRMED_BY_SIGNAL`, `UNCONFIRMED` o `CONTRADICTED`.
- Un timeout de mutación conduce a verificación de postcondición. Si se confirma, se registra como ejecutada; si se contradice, se escala; si no hay evidencia suficiente, queda `UNCONFIRMED` y no se reintenta automáticamente. La escalación puede proponer una nueva acción explícita, que vuelve a pasar por Guard. `AMBIGUOUS_RESULT` equivale a no confirmado.

### A.3 Fichas de llamadas a Eos
Contrato de entrada/salida tomado del extracto Decision-2.0-Eos-0.8B que el responsable identifica como documentación oficial de Hugging Face. La URL no se adjuntó, por lo que queda pendiente contrastarlo directamente con la fuente oficial y con trazas reales del runtime. `choice` usa `criteria` como objeto de opciones; `noul` devuelve la probabilidad afirmativa; `score` devuelve un valor ordinal, `legend` y distribución. La salida se lee desde `result["answers"]`. Las decisiones binarias no esperan strings YES/NO: el runtime compara la probabilidad `noul` con el umbral configurado.

Ejemplo mínimo de entrada compatible con el contrato aportado:

```json
{
  "state": "El usuario solicita buscar el manual de una impresora y guardar el PDF.",
  "questions": {
    "tool": {
      "type": "choice",
      "instructions": "¿Qué herramienta corresponde a la primera acción?",
      "criteria": {
        "free_search:search": "Buscar información en Internet",
        "desktop_commander:read_file": "Leer un archivo o URL",
        "RESPOND_DIRECTLY": "Responder sin ejecutar herramientas"
      }
    },
    "requires_internet": {
      "type": "noul",
      "instructions": "¿La solicitud requiere acceso a Internet?"
    },
    "priority": {
      "type": "score",
      "instructions": "¿Qué prioridad tiene la tarea?",
      "criteria": ["Baja", "Media", "Alta"]
    }
  }
}
```

Forma conceptual de la respuesta (valores ilustrativos):

```json
{
  "answers": {
    "tool": { "choice": "free_search:search", "probabilities": {} },
    "requires_internet": { "noul": 0.95 },
    "priority": { "score": 1.8, "legend": {}, "probabilities": {} }
  }
}
```

El runtime debe usar `answers.<id>.choice` para una selección, `answers.<id>.noul` para la probabilidad afirmativa y `answers.<id>.score` cuando se use una escala ordinal. Para aplicar un umbral a `choice`, se debe leer la probabilidad de la opción elegida desde `probabilities` si la implementación real la expone en ese formato; si no, la confianza de selección queda pendiente de verificar y no debe inventarse.

| Llamada | Entradas | Opciones / salida | Umbral | Error y recuperación | Tipo de pregunta y redacción |
|---|---|---|---|---|---|
| Selección | Meta, routeHint, catálogo permitido, LOG/ledger, intentos y restricciones | `answers.tool.choice` (ID exacto del catálogo); en primera selección FAST puede incluir `RESPOND_DIRECTLY` | Mínimo de selección configurable usando la probabilidad de la opción elegida | Un reintento con las mejores candidatas; si Eos falla, terminar según avance | `type: choice`, `criteria` como objeto ID→descripción. “¿Qué opción permite avanzar mejor hacia la meta con la evidencia disponible?” |
| `ok` | Señales limpias, resumen, observación y postcondición si existe | `answers.ok.noul` (probabilidad afirmativa) | ≥ 0.60 inicial [HIPÓTESIS] | Bajo umbral: reintento informado solo para lectura; si el efecto de una mutación está confirmado, escalar/replanificar sin repetirla automáticamente. Veto solo tras dos negativas con argumentos distintos y señales limpias | `type: noul`. “¿El resultado es válido y utilizable, sin ser un error disfrazado?” |
| `cumple` | Criterio, observación, LAST, LOG en FAST, effects y postcondición aparte | `answers.cumple.noul` (probabilidad afirmativa) | FAST ≥ 0.75; PLAN ≥ 0.60 sin mutación o con postcondición confirmada; PLAN ≥ 0.75 con mutación sin postcondición confirmada | Si Eos falla, tarea PARTIAL si hubo avance; si no, FAILED | `type: noul`. “¿La evidencia demuestra que se cumple el criterio observable del paso?” |
| Escalación | Causa tipificada, llamada y argumentos resumidos, intentos, restricciones, escalaciones restantes | `answers.escalation.choice` (ID de acción permitida) | Umbral mínimo configurable por probabilidad | Fallo de Eos: acción determinista segura definida por la tabla | `type: choice`, `criteria` como objeto acción→descripción. “¿Qué acción permitida resuelve mejor esta causa?” |
| Elección cerrada de argumentos | Lista de candidatos construida por código | `answers.argument.choice` (ID exacto del candidato o `NONE`) | Mínimo configurable sobre la probabilidad de la opción elegida | `NONE` o baja confianza vuelve a generación abierta por Qwen | `type: choice`, `criteria` como objeto ID→descripción. “¿Qué candidato corresponde a la intención y evidencia?” |
| `needs_context` | Resumen de salida de la tarea previa y nueva instrucción | `answers.needs_context.noul` (probabilidad afirmativa) | Umbral configurable [HIPÓTESIS] | Error de Eos: no inyectar el resumen y registrar el fallo | `type: noul`. “¿La nueva instrucción necesita el resumen de la tarea anterior para interpretarse correctamente?” |

### A.4 Planner: esquema JSON y validación [PARA REVISIÓN]
Forma lógica propuesta; los nombres definitivos deben coincidir con los tipos del código:

```json
{
  "steps": [
    {
      "id": "step_1",
      "goal": "Meta concreta del paso",
      "criterion": "Evidencia observable requerida",
      "routeHint": "opcional",
      "inputsFrom": [],
      "mutates": false,
      "budget": 4
    }
  ]
}
```

Validaciones: JSON válido; máximo 8 pasos; `steps: []` permitido para tareas conversacionales; cada paso debe tener `id`, `goal` y `criterion` no vacíos; IDs únicos; `inputsFrom` solo puede referir a pasos existentes anteriores; `mutates`, si llega en el JSON, debe ser booleano pero es solo una pista; el runtime no confía en él y determina la mutabilidad efectiva desde el manifiesto de la herramienta seleccionada. Presupuesto entero positivo dentro del máximo configurado. No se admite `type: compose`. Ante JSON inválido, más de 8 pasos, referencia inexistente/posterior o criterio ausente, reintentar una vez enviando el error; si vuelve a fallar, tarea `FAILED` con mensaje claro. El replan usa las mismas validaciones y además rechaza si su primer paso repite la meta del paso bloqueado; un reintento con el error y, si vuelve a fallar, `FAILED`. `mutates` puede estar presente en el JSON por compatibilidad, pero se ignora como fuente de autoridad y se recalcula desde el manifiesto tras seleccionar la herramienta; no se acepta como justificación de permisos ni de umbral.

### A.5 Tabla de configuración [PARA REVISIÓN]
Los valores heredados se conservan salvo cambio explícito. Toda cifra marcada [HIPÓTESIS] debe estar en `jarvis-config.json` y no incrustarse en lógica. `maxReplans=2` es un contador global por tarea: todos los motivos de replan consumen el mismo contador.

| Clave propuesta | Valor inicial | Flag / fase | Estado |
|---|---:|---|---|
| `maxToolCallsPlan` | 30 | Fase 2 | Conservado |
| `maxToolCallsFast` | 15 | Fase 2 | Conservado |
| `maxMcpInvocationsMultiplier` | 2.5 | Fase 2 | Decisión v1.3 |
| `maxRecallCallsPerTask` | 20 | Fase 4a | Conservado |
| `maxComposeCallsPerTask` | [HIPÓTESIS: 8] | Fase 4b | Calibrar |
| `maxAskUserCallsPerTask` | [HIPÓTESIS: 3] | Fase 2 | Calibrar |
| `askUserTimeoutMs` | [HIPÓTESIS: 600000] | Fase 2 | Calibrar; excluido del deadline |
| `maxEscalations` | 2 | Fase 3 | Conservado |
| `maxReplans` | 2 por tarea, global | Fase 3 | Decisión v1.3; compartido entre todas las causas |
| `maxArgRetries` | 2 | Fase 2 | Conservado |
| `taskDeadlineMs` | [HIPÓTESIS: 600000] | Fase 2 | Conservado como propuesta configurable |
| `approvalTimeoutMs` | [HIPÓTESIS: 600000] | Fase 2 | Conservado como propuesta configurable |
| `planConfirmationTimeoutMs` | 1800000 | Fase 2 | Conservado |
| `eosSelectionMinConfidence` | [HIPÓTESIS: 0.50] | Fase 3 | Calibrar |
| `eosOkMinConfidence` | [HIPÓTESIS: 0.60] | Fase 3 | Calibrar |
| `eosCumpleFastThreshold` | 0.75 | Fase 3 | Decisión v1.3 |
| `eosCumplePlanNoMutationThreshold` | 0.60 | Fase 3 | Decisión v1.3 |
| `eosCumplePlanMutationUnverifiedThreshold` | 0.75 | Fase 3 | Decisión v1.3 |
| `maxPlanSteps` | 8 | Fase 4b | Conservado |
| `maxStepToolCalls` | 4 | Fase 3 | Conservado |
| `maxRefBytes` | [HIPÓTESIS: 2097152] | Fase 4a | Calibrar |
| `maxRefStoreBytesPerTask` | [HIPÓTESIS: 20971520] | Fase 4a | Calibrar |
| `maxResolvedContentBytesPerCall` | [HIPÓTESIS: 1048576] | Fase 4a | Calibrar |
| `reorderPromptBlocksEnabled` | `false` por defecto | Fase 2 | Flag requerido; medir baseline en Fase 1 |
| `retryEosCount` | [HIPÓTESIS: 2 intentos totales] | Fase 2 | Calibrar |
| `retryEosDelayMs` | [HIPÓTESIS: 250] | Fase 2 | Calibrar |
| `longCommandMode` | Por manifiesto: timeout o segundo plano | Fase 1 | Requiere contrato de herramienta |
| `legacyUiRemoval` | Commit aislado `ui-legacy` antes de Fase 2 | Pre-Fase 2 | Operación de repositorio |

## B. Fuera de alcance de la v1 y riesgos aceptados

1. **Concurrencia de tareas.** No se exige ni se prohíbe; se conserva la advertencia de interferencia compartida. No hay bloqueo por recurso. Riesgo: dos tareas pueden actuar sobre el mismo recurso y producir interferencias.
2. **Rutas y ventanas sensibles.** Se elimina el sistema específico de rutas/ventanas sensibles, las aprobaciones por lectura sensible, `isSafeReadonlyCommand` para ese fin, la redacción de observaciones en tiempo de ejecución, la marca sensible de RefStore, recall redactado, la regla de ventanas sensibles, el atributo de manifiesto correspondiente y sus pruebas. Se conserva 11.5: escritura atómica, redacción por patrones al persistir y consola completa solo en depuración. Riesgo: lectura de secretos sin control específico y acciones de UI sobre terminales sin revisión; UI, no obstante, también queda fuera de v1.
3. **Procedencia web y `tainted`.** Se eliminan la bandera `tainted`, `effects.procedencia`, marcas web, herencia de marcas y aviso de procedencia web en el banner. La búsqueda web entrega resultados al flujo como hoy. Riesgo: no hay señal explícita de procedencia para advertir que contenido recuperado de la web se reutiliza en una acción.
4. **Restricciones por efecto.** Se eliminan. Se mantienen las restricciones por herramienta del replan (“no proponer X”). Riesgo: el mismo efecto puede intentarse por otra herramienta o vía después de un rechazo.
5. **Reintentos de mutaciones.** No se implementa idempotencia como atributo de manifiesto. Ante timeout, se verifica la postcondición: confirmada → éxito; contradicha → fallo y escalación; no disponible/ambigua → `UNCONFIRMED` y escalación, sin reintento automático. Una acción nueva solo puede surgir de una decisión explícita de escalación/replan y vuelve a pasar por Guard. Riesgo residual: una acción alternativa puede duplicar efectos si no existe postcondición verificable.
6. **Procesos.** Solo se terminan al cancelar. Los activos se enumeran en la respuesta final. Se elimina la acción de limpieza y su endpoint. Riesgo: procesos persistentes pueden consumir recursos hasta que el usuario los termine por otra vía.
7. **Cifrado en reposo.** Fuera de alcance. Riesgo: la copia persistida puede ser leída por quien obtenga acceso al archivo; se mantiene redacción por patrones antes de persistir.
8. **Control de UI y windows-mcp.** Fuera de alcance de la v1. Eliminar el servidor windows y sus herramientas del catálogo/configuración por defecto; `UI_ACTION` y su fila de postcondición; `stale_element` y su lógica de adaptador; `window_handle`/`element_id` como fuentes de candidatos y facts; invalidación de estado volátil; exención `ui_wait` del anti-loop; pruebas UI; menciones a UI en 11.7, Fase 2 y concurrencia; atributos de manifiesto exclusivos de UI y requisito UI Automation del README. No adaptar esos módulos: proponer su eliminación en un commit aislado etiquetado `ui-legacy` antes de Fase 2. Reemplazar `launch_app`/`close_window` por `start_process`/`kill_process` de Desktop Commander. La arquitectura por capacidades se conserva para reincorporación futura, junto con adaptador UI, capacidades, manifiesto, Guard, estados/candidatos y pruebas específicas. Riesgo: no habrá automatización de interfaz gráfica en v1.
9. **Valores no medidos.** Todo valor [HIPÓTESIS] sigue sujeto a calibración con trazas y vive en configuración.

## C. Hallazgos del código y diferencias

**Estado: contraste documental realizado; auditoría del código pendiente.** Se dispone de la especificación v1.2, del contrato Decision-2.0-Eos-0.8B, del snapshot MCP del 2026-10-12 y de los documentos actuales CORE_FLOW, ARCHITECTURE, CONTEXT_AND_MEMORY y TOOLS_AND_SECURITY. No se dispone del repositorio ni de trazas reales de Eos, por lo que no se afirma haber verificado `modeEngines`, `callExecutor`, `prompts`, `resultProcessor`, `types/context`, `decision`, `qwen`, `guard/policyRegistry` ni `core`. La tabla siguiente conserva las diferencias de implementación como pendientes; el nuevo apartado C.1 registra únicamente discrepancias entre documentos y el diseño objetivo v1.3.

| Área | Qué dice v1.3 | Qué hace el código | Impacto | Propuesta / evidencia necesaria |
|---|---|---|---|---|
| `modeEngines` | Un motor `runStep`, FAST como plan de un paso y PLAN como plan de hasta 8 pasos | No verificado: código no adjunto | Riesgo de divergencia de flujo y terminación | Inspeccionar ambos bucles, rutas de salida y tratamiento de `suggested_mcp`; añadir prueba diferencial FAST vs PLAN de un paso |
| `callExecutor` | Placeholders permitidos por manifiesto; `recall`, `compose`, `ask_user` internos; postcondición separada de LAST | No verificado | Sustitución/Guard/anti-loop y contabilidad podrían diferir | Seguir orden real de llamadas, errores, persistencia y contadores; pruebas de replay |
| `prompts` / planner | Esquema con `mutates`, criterio obligatorio, inputsFrom solo anteriores; no `type: compose` | No verificado | Planes inválidos o incompatibles | Contrastar prompts, parser, schema y validadores; probar reintento único |
| `resultProcessor` | RefStore informativo sin marcas web/sensible; LAST conserva observación principal | No verificado | Pérdida o mezcla de evidencia | Comprobar dónde se asignan LAST, finding, obs, refs y facts |
| `types/context` | Estados y enumeraciones canónicas; `effects` con cuatro estados y sin procedencia | No verificado | Incompatibilidad de tipos y tareas persistidas | Contrastar interfaces, serialización y `schemaVersion` |
| `decision` / API Eos | Selección con `choice`; verificaciones binarias con `noul`; `needs_context` con `noul` | Contrato resumido aportado; integración real no verificada | Posible mapeo de probabilidades o payload incompatible | Comparar implementación con el contrato aportado y revisar trazas SEND/RECV antes de implementar |
| `qwen` | Plan/replan/compose/final con límite de salida; retry Eos no aplica; truncamiento detectable | No verificado | Truncamiento o timeouts mal gestionados | Confirmar `finish_reason`, timeouts, thinking y límites reales |
| `guard/policyRegistry` | Sin reglas especiales de rutas sensibles ni UI; reglas por herramienta del replan se conservan | No verificado | Riesgo de que política real contradiga el alcance nuevo | Contrastar catálogo y reglas derivadas del manifiesto; pruebas de denegación |
| `core` | Esperas de usuario excluidas del deadline; reintentos transitorios Eos; procesos solo terminan al cancelar | No verificado | Estados colgados, deadlines incorrectos o procesos huérfanos | Auditar cancelación, persistencia, timers y llamadas en vuelo |
| Persistencia | `schemaVersion`, copia y descarte de tareas viejas | No verificado | Pérdida de historial si el respaldo falla | Verificar atomicidad, recuperación y descarte tras backup confirmado |
| Manifiesto | Sin atributo idempotencia, rutas sensibles, procedencia web o atributos exclusivos de UI; timeout o modo en segundo plano por herramienta | No verificado; manifiesto no adjunto | Contrato runtime/docs puede quedar desalineado | Crear manifiesto desde catálogo real y validar contra herramientas disponibles |
| Procesos largos | El manifiesto declara timeout propio o `start_process` + sondeo; finalización comprobada con estado del proceso y salida/resultados disponibles | No verificado | Comandos podrían expirar antes de finalizar o confundirse con finalizados | Definir por herramienta; sondear hasta estado terminal o deadline, registrar PID y salida; no inferir éxito solo por PID creado |

### C.1 Contraste con la documentación actual del JARVIS

**Base del contraste:** `CORE_FLOW.md`, `ARCHITECTURE.md` y los contenidos aportados de `CONTEXT_AND_MEMORY` y `TOOLS_AND_SECURITY`, todos con revisión indicada al 2026-10-11. Este apartado compara lo que esos documentos describen con el objetivo normativo de v1.3; no verifica si las descripciones coinciden con el código real.

| Área | Documentación actual | Objetivo v1.3 | Diferencia / acción necesaria |
|---|---|---|---|
| Motor de ejecución | FAST usa `runFastLoop`; PLAN usa `runPlanLoop`; FAST encadena D1 → D2 → Qwen argumentos → D5 y puede escalar con Qwen 5B. | Un único `runStep`; FAST y PLAN son drivers; Eos selecciona, verifica y participa en escalación por tabla; se elimina la etapa 5B de Qwen. | Cambio estructural mayor. Actualizar flujo, estados, errores y pruebas en conjunto; no implementar como simple renombrado de los bucles actuales. |
| Selección | Decision #1 elige subsistema (`windows`, `desktop_commander`, `free_search`, `fin`); Decision #2 elige herramienta dentro del servidor. | Una selección Eos sobre catálogo plano de herramientas y herramientas internas. | Cambian el contrato de decisión, el catálogo ofrecido y la semántica de `fin`; revisar el adaptador y las trazas Eos antes de codificar. |
| Verificación | Decision #5 juzga resultado `correcta/incorrecta`; PLAN usa `evaluatePlanJudgement` con `cumple/no_cumple`; existe override por `exit_code == 0`. | Separar estado factual del efecto/postcondición y juicio semántico (`ok` y `cumple`). | El override actual no debe trasladarse sin redefinir su relación con señales, postcondición y confianza. Requiere pruebas para salida 0 con efecto no confirmado. |
| Contexto de Qwen | GOAL, CHAT opcional, LOG, PLAN, FAIL, FACTS, TOOL, SCHEMA, LAST y TASK; reintentos incluyen `ERROR_PREVIO`. | Constructor único con orden estable, argumentos con placeholders, referencias `{{ref:rX}}`, contexto por capas y evidencia para juez/compose/final. | La forma actual es específica de generación de argumentos; hay que definir el contrato de contexto por etapa y el límite de cada bloque, sin asumir que todos los prompts reciben los mismos datos. |
| Decision 2.0 | `state` sintético; preguntas `route`, `needs_context`, `selected_tool`, `evaluation` y juicio de plan. El documento describe estimación de tokens y techo de 8192. | Eos concentra selección, verificaciones binarias y decisiones puntuales de escalación. | El número, tipos y orden de preguntas cambian. Confirmar con API y trazas reales los tipos de respuesta, campos de confianza y mapeo de `result["answers"]`. |
| Memoria de tarea | LOG colapsado, FAIL de hasta 5 entradas, FACTS, Scratchpad con claves solapadas y RefStore volátil por tarea. No hay memoria de usuario permanente. | Capas explícitas: effects, ledger de PLAN, handoff determinista, almacén único de hechos, refs con placeholders, recall y resumen de salida. | No confundir `facts`/`scratchpad` actuales con el modelo objetivo. Especificar precedencia y migración de datos en tipos y persistencia; el diseño no añade por sí solo memoria permanente entre tareas. |
| Evidencia y refs | `Evidence` incluye `ok`, `summary`, `obs`, `ref`, `flags`; LAST usa observación compacta y final recibe últimas tres evidencias. RefStore mantiene el texto completo en memoria. | Evidencia utilizable por verificadores; referencias sustituibles por placeholders y `recall` para contenido no repetible. | Definir ciclo de vida, resolución, límites y errores de refs. La persistencia de referencias no debe inferirse: el documento actual las describe como volátiles. |
| Sanitización / datos | `safe()` neutraliza etiquetas `<obs>`; `sanitizeForMemory` limpia controles y prefijos; argumentos y observaciones se persisten en texto claro y los prompts completos se registran en consola. | Redacción por patrones al persistir y escritura atómica; se descartan las tareas antiguas tras respaldo verificado. | Hay una brecha de privacidad e integridad de persistencia. La redacción debe aplicarse antes de persistir/loguear, y la escritura atómica debe cubrir el archivo real; cifrado en reposo queda fuera de v1. |
| Seguridad y catálogo | `PolicyRegistry` tiene catálogo estático, pero herramientas no mapeadas pueden clasificarse heurísticamente como READ o COMMAND_EXECUTION; las mutaciones requieren aprobación. | El manifiesto confiable define capacidad/mutabilidad; herramientas sin política/registro explícito no se ejecutan. Se elimina UI/windows MCP del alcance v1. | El objetivo endurece el fallback actual y elimina UI de v1. No asumir que la lista documental de tools coincide con el snapshot MCP; generar catálogo/políticas desde el manifiesto y validar cada herramienta. |
| Aprobaciones y espera | `WAITING_APPROVAL` queda suspendido indefinidamente hasta resolución o cancelación; no hay timeout. | Estado común `WAITING_INPUT` con `waitingReason`, timeout de aprobación y expiración de confirmación del plan. | Requiere cambios coordinados en modelo de estado, timers, API, SSE y UI; contemplar carreras entre timeout, cancelación y respuesta del usuario. |
| Reintentos y errores | Qwen argumentos hasta 2 reintentos; stale element se reintenta una vez; escalación Qwen 5B hasta 2; replan hasta 2. | Errores clasificados por señal y tabla; mutaciones con timeout no se repiten automáticamente si el efecto ya está confirmado; `maxReplans=2` global. | Revisar contabilidad de llamadas y replanes globales. La política de timeout de mutaciones requiere postcondición comprobable y estado `UNCONFIRMED`. |
| Procesos largos | `start_process`, `read_process_output` e `interact_process` están documentados; el flujo no define un contrato general de sondeo hasta estado terminal. | Manifiesto declara timeout por herramienta o ejecución en segundo plano con sondeo y resultado final comprobado. | Pendiente fijar contrato por herramienta: PID, estado terminal, captura de salida, deadline y criterio de éxito. No tratar el inicio del proceso como finalización de la tarea. |
| Presupuestos | FAST se limita por `MAX_STEPS=15`; PLAN hasta 15 pasos, 4 llamadas por paso y tope global de 30 llamadas; aprobación no expira. | Pool común de 15 en FAST y 30 en PLAN, tope MCP externo de 2,5× pool, límites secundarios para tools internas y deadline global. | Los contadores deben distinguir selección/pool, invocaciones MCP y llamadas internas; comprobar que las postcondiciones también contabilizan contra el presupuesto externo. |
| Interfaz y eventos | `DecisionStream` muestra eventos del ciclo actual; `GuardBanner` permite aprobar/rechazar; `ContextInspector` no aparece en la documentación actual aportada. | Timeline de paso único, capas de memoria, selección/verificaciones/escalación, deadline y cuenta regresiva de aprobación. | Actualizar los contratos SSE y componentes; no dar por existente `ContextInspector` sin comprobar el frontend. |

**Discrepancias concretas entre el inventario documentado y el snapshot MCP:** se conserva la comparación de la sección 21.1 (21/26/11 herramientas observadas frente a 12/12/14 documentadas para windows/desktop_commander/free_search). Los nombres y conteos del snapshot describen una ejecución puntual, no el inventario garantizado del runtime. El diseño v1 excluye `windows` y exige registro explícito para las herramientas admitidas.

**Resultado del contraste documental:** las fuentes actuales describen una arquitectura coherente con dos bucles y el pipeline D1/D2/D5 existente; v1.3 es una migración real de contratos y responsabilidades, no una descripción del sistema ya implementado. No se certifica que los documentos actuales sean correctos respecto al código.

### Diferencias adicionales detectables dentro del propio documento v1.2
Estas son contradicciones documentales, no del código:
- v1.2 declara compose como tipo de paso y a la vez como pseudo-herramienta interna; v1.3 fija la segunda opción.
- v1.2 ofrece `ask_user` como condicional/fase posterior y contiene filas “con/sin ask_user”; v1.3 lo incluye en la v1 y lo deja siempre disponible.
- v1.2 permite conversión de tareas antiguas; v1.3 exige respaldo y descarte.
- v1.2 sitúa el reordenamiento de prompts en Fase 0; v1.3 lo mueve a Fase 2 y exige medir prefill en Fase 1.
- v1.2 usa 2× el pool para el tope MCP; v1.3 fija 2,5×.
- v1.2 mezcla “confirmado por señal” con `ok`; v1.3 separa el hecho observado del juicio semántico: código de salida 0 y ausencia de señales técnicas de error bastan para `CONFIRMED_BY_SIGNAL` cuando no existe postcondición, mientras `ok` y `cumple` deciden si el paso puede cerrarse.
- v1.2 mezcla LAST y postcondición en el flujo/LOG; v1.3 exige que LAST conserve la observación principal y que la postcondición ocupe un campo aparte.
- v1.2 no define `mutates` en el esquema de paso; v1.3 lo usa como dato auxiliar, pero el valor efectivo se resuelve desde el manifiesto de la herramienta elegida y no desde la salida de Qwen.
- v1.2 no formaliza la política de reintento de plan/replan inválido; v1.3 establece un reintento y luego FAILED.

## D. Preguntas pendientes agrupadas

No se eleva ninguna pregunta de redacción. Para completar la auditoría técnica hacen falta estos insumos, agrupados en un único pedido:
1. **Código:** repositorio o archivos actuales de `modeEngines`, `callExecutor`, `prompts`, `resultProcessor`, `types/context`, `decision`, `qwen`, `guard/policyRegistry` y `core`, además de `jarvis-config.json` y pruebas relevantes.
2. **Trazas y contratos externos:** 2–3 trazas reales de Decision 2.0 (una exitosa y una fallida de PLAN como mínimo) y la referencia de API de Decision 2.0. El manifiesto de herramientas cuando exista.
3. **Decisiones técnicas que sí pueden cambiar el diseño:** (a) validar en la integración real que las llamadas a Decision 2.0 respeten el contrato aportado (`choice`, `noul`, `score`, `result["answers"]`) y confirmar cómo se exponen las probabilidades en la versión de runtime; (b) contrato de herramientas para comandos largos y sondeo; (c) si el modelo persistido puede descartar las tareas viejas solo después de una copia de respaldo verificada.

Hasta recibir esos materiales, el documento v1.3 es una consolidación normativa basada en las decisiones de la tarea y en la v1.2; el apéndice de código permanece explícitamente pendiente y no debe interpretarse como auditoría concluida.
