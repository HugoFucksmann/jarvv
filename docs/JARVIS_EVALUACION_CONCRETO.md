# JARVIS — Plan de mejoras

> Documento consolidado (2026-11-13). Base: la documentación (`ARCHITECTURE.md`, `CORE_FLOW.md`, `CONTEXT_AND_MEMORY.md`), el código, las trazas guardadas (`jarvis-traces/`: 116 tareas en el índice, 35 con detalle) y pruebas directas contra Ollama. No se editó código.

**Rol:** JARVIS es un agente root coordinador local. El usuario habla con él y él se mueve en la PC, ejecuta herramientas y, a futuro, llama a agentes especializados (fuera de este análisis).
**Criterio:** código determinista > modelo de decisión (30 a 60 ms) > modelo generativo (Qwen 4B, solo para texto libre).
**Alcance:** mejorar lo que JARVIS hace hoy. Lo que agrega capacidades va en «Mejoras futuras».
**Leyenda:** 🟢 pequeño · 🟡 medio · 🔴 mayor · 🧪 se prueba sin tocar código · 🔧 requiere código
**Equivalencias con los nombres de las pruebas originales:** N1 = VRAM al límite (D) · T1 = D0 corta/larga (B1) · T2 = tarea larga por código (B1) · T3 = fusionar D1 y D2 (descartado) · T4 = paralelismo en decisión (descartado) · T5 = herramientas básicas (B4) · E1 a E20 = experimentos (§5; los hechos o descartados se listan al inicio de esa sección).

## 1. Qué se midió

Entorno: Ollama 0.40.13, RTX 3070 Ti de 8 GB, `qwen3.5:4b` (Q4_K_M, 3,36 GB) y `d3:2b` (Q8_0, 3,08 GB).

| Hallazgo | Dato |
|---|---|
| Alternar entre los dos modelos cuesta ~1 s por cambio | VRAM al límite (7,9 de 8,2 GB). Una decisión tarda 37 ms tras otra decisión y 570 ms (p50) tras una llamada generativa. Una tarea de una acción hace 4 cambios |
| Arranque en frío | 7,3 s el generativo + 5 s el decisor. Ollama los descarga a los 5 minutos; no hay calentamiento de modelos (`server.ts` solo precalienta los servidores MCP) y el código no envía `keep_alive` |
| Contexto desalineado | Configurado 16 384 en `jarvis-config.json`; real 8 192 (Qwen; hay un `OLLAMA_CONTEXT_LENGTH=8192` en el entorno) y 4 096 (`d3:2b`). La guarda calcula contra 16 384, así que no protege: un prompt de entre 8k y 16k se recorta en silencio. Máximo visto: 1 497 tokens en `args` y 2 721 en `verify` (66 % del contexto real del decisor) |
| Costo propio del generativo | `pending` y `args`: 200 a 300 ms (generación a ~105 tokens/s). `final`: 1,2 a 1,7 s, con ~128 tokens de salida (la única cara) |
| Tarea de una acción | Mediana 10,7 s con 7 consultas a modelos (48 tareas completadas de una llamada en el índice); unos 4 s son cambios de modelo |
| Fallos (295 llamadas) | 72 `loop_blocked`, 46 `args_invalid`, 6 `tool_error`. De 116 tareas, 21 canceladas por el usuario |
| Estados de tarea (116) | 86 `completed`, 21 `cancelled`, 6 `failed`, 3 `partial`. Por pasos: 14 sin pasos, 61 de un paso, 41 de dos o más |
| Estados de llamada (295) | 158 `ok`, 72 `loop_blocked`, 46 `args_invalid`, 10 `user_rejected`, 6 `tool_error` (suman 292; las otras 3 están en estados que el análisis original no detalla) |
| Esperas del usuario | Una confirmación («abrí la calculadora») tardó 12,7 s: más que todos los modelos juntos |
| Herramientas lentas | `web_search` tarda 6 a 16 s; ahí los modelos no son el cuello |
| D4 (verificación) | Falla en hechos que el código puede comprobar: aprueba una copia donde se pidió mover, rechaza movimientos correctos |
| Respuesta final | 5 de 28 salieron en inglés ante pedidos en español |

**Dónde se gasta el tiempo (flujo según la documentación):**

| Etapa | Quién | Frecuencia |
|---|---|---|
| Lista de pendientes (primera vuelta, reactivo) | Generativo | Toda tarea reactiva |
| D1 (ruta) y D2 (herramienta) | Decisión | Cada llamada, salvo opción única |
| Generar argumentos | Generativo | Cada llamada |
| Pre-chequeo, lista negra, Guard, anti-bucle | Código | Cada llamada |
| D3 (revisar argumentos) | Decisión | Solo escrituras con `autoMode` encendido |
| D4 (verificación, 2 preguntas) | Decisión | Cada llamada ejecutada |
| D5 (cierre, `request_complete`) | Decisión | Al vaciarse la lista |
| Respuesta final | Generativo | Casi todo cierre |
| Pregunta al usuario, plan, replan, lista tras fallo | Generativo | Ocasional |

La lectura original (solo documentación) estimaba ~3 llamadas generativas y ~5 consultas de decisión (0,2 a 0,3 s) por tarea de una acción, y concluía que el costo dominante era el generativo. **Corrección tras medir:** en producción lo dominante es alternar entre los dos modelos y arrancarlos en frío; la decisión es el tramo barato.

**Latencia por etapa** (trazas, 35 tareas con detalle):

| Etapa | Modelo | n | p50 | p90 |
|---|---|---|---|---|
| `pending` | Generativo | 55 | 1 242 ms | 4 500 ms |
| `route` (D1) | Decisión | 58 | 499 ms | 3 716 ms |
| `tool` (D2) | Decisión | 58 | 32 ms | 45 ms |
| `args` | Generativo | 58 | 1 688 ms | 2 305 ms |
| `verify` (D4) | Decisión | 37 | 410 ms | 1 073 ms |
| `completion` (D5) | Decisión | 18 | 57 ms | 78 ms |
| `final` | Generativo | 29 | 1 751 ms | 2 543 ms |

D1 y D4 son lentas porque vienen después de una llamada generativa; D2 y D5 vienen después de una decisión. `args` recibe unos 873 tokens y escribe 20: esos 1,7 s no son generación sino cambio de modelo. La misma consulta de decisión tarda 37 ms (p50) tras otra decisión y 570 ms (p50; p90 2,9 s) tras una generativa; el generativo tarda 1 683 ms (p50) cuando viene después de una decisión.

**Pruebas directas** (consultas reales de una traza repetidas contra Ollama):

| Prueba | Generativo (`args`) | Decisión (`route`) |
|---|---|---|
| Arranque en frío | 7,3 s | 5,0 a 5,2 s |
| Mismo modelo que la consulta anterior | 170 a 210 ms | 32 a 51 ms |
| Después de usar el otro modelo (ambos en GPU) | 1,0 a 1,3 s | 1,0 a 1,05 s |
| Alternando con `d3:2b-cpu` (decisión en CPU) | 185 a 210 ms | 2,1 s (D4: 3,0 s) |
| Alternando con un segundo modelo de 1,64 GB en GPU | 170 a 200 ms | 21 a 29 ms (modelo sustituto) |

El registro de Ollama muestra, tras cada cambio, 1 114 ms para evaluar 4 tokens (3,6 tokens/s) contra 45 ms cuando el modelo viene de usarse. Con un segundo modelo más chico (7,4 GB en total) la penalización desaparece. La caché de prefijo funciona (760 de 764 tokens) pero ahorra unos 100 ms.

**Cómo leer las prioridades:** mientras la VRAM siga al límite (N1, en pausa), cada llamada generativa entre dos decisiones cuesta ~1,5 a 2 s. Si N1 se resuelve, baja a ~200 ms y esas mejoras valen sobre todo por fiabilidad. El laboratorio mide cada etapa con el mismo modelo seguido, así que sus latencias no representan producción.

**Límites de las mediciones:** una sola máquina y sesión; las 35 trazas con detalle son sobre todo búsquedas web y terminal; los casos de D0 (122) y de herramientas básicas (58) se etiquetaron a mano y los umbrales se ajustaron sobre el mismo conjunto; algunas de las 116 tareas (p. ej. ~25 de «procesos por memoria») pueden ser pruebas repetidas y no uso diverso (a confirmar).

**Lo que ya está bien (conservar):**
- D1 a D5 son preguntas de clasificación (`choice`/`noul`), no texto libre: encajan con un modelo chico.
- D5 ya cierra tareas sin llamar al generativo: es el patrón a replicar.
- La lista de pendientes la mantiene el código; el modelo solo la genera al empezar, tras un fallo y al vaciarse.
- Pre-chequeo, `readOnly`, anti-bucle y topes son deterministas; los resultados voluminosos van fuera del contexto (refs).
- Contratos entre modelos y motor, y una traza completa que sirve de base de evaluación.

**Referencias en el repositorio:** `docs/limitaciones/d3-2b.md` (D1 manda a `files` pedidos que necesitan terminal; una `noul` por opción fue peor; fallas de D4) y `docs/limitaciones/qwen-3.5-4b.md` (`pending` cambia de idioma con comandos en inglés).

## 2. Plan priorizado

### A. Rápido y barato (hacer primero)

| # | Mejora | Ganancia | Esfuerzo |
|---|---|---|---|
| A1 | **Modelos calientes:** consulta mínima a cada modelo al arrancar (como ya se hace con MCP) y `keep_alive` largo (`OLLAMA_KEEP_ALIVE`). Segundo paso opcional: calentar cuando el usuario empieza a escribir o hablar, si no se quiere retener la VRAM siempre | ~12 s en la primera tarea tras una pausa | 🟢 🧪🔧 |
| A2 | **Contexto configurado = real** (8 192 y 4 096) en `qwenNumCtx` y `decisionMaxContext` | Corrección: hoy la guarda de contexto no funciona | 🟢 🧪 |
| A3 | **Cortar por código las repeticiones** que el modelo no corrige (ver abajo) | Tareas perdidas: de ~30 s a ~5 s | 🟢 🔧 |
| A4 | **Idioma de la respuesta final fijado por código** («Answer in Spanish») y sin frase de relleno cuando no hubo efectos | Calidad percibida | 🟢 🧪 |
| A5 | **Entender las 21 cancelaciones** (¿en qué etapa?) y emitir progreso por código en esperas largas («Buscando: …») | Menos cancelaciones | 🟢 |
| A6 | **Medir primero:** que el resumen de la traza marque si cada consulta vino después de un cambio de modelo, y registrar márgenes (probabilidades) y confirmaciones al usuario por tarea | Base para ordenar todo lo demás | 🟢 🧪🔧 |
| A7 | **Salida estructurada en `args`:** probar el esquema de la herramienta como `json_schema` (hoy `args` usa `json_object`; `pending` y el plan ya usan `json_schema`) | Menos reintentos por salida inválida | 🟢 🧪 |

**A3, los tres cortes:**
1. Si el generador devuelve los mismos argumentos que acaban de bloquearse, fallar el paso o dejar de ofrecer esa herramienta, sin otra vuelta de D1 y D2.
2. Si tras un fallo `pending` devuelve el mismo ítem, tratarlo como abandonado.
3. Tras un rechazo del usuario sin instrucción, no repetir la misma confirmación. Caso real: el usuario rechazó `Start-Process calc`, el modelo generó los mismos argumentos y se le preguntó de nuevo.

Ejemplo real: 6 veces seguidas `list_directory {depth: 2}`, 30 consultas y 28,7 s para una tarea perdida desde la segunda llamada. A esto se suman **pistas calculadas por código** en `LAST ERROR` (ruta inexistente → entradas parecidas del directorio; comando inexistente → comandos parecidos, algo que el pre-chequeo ya sabe; búsqueda sin resultados → alternativa de ampliar). Motivo: un 4B corrige mal a ciegas; cada paso fallido arrastra una escalación (llamada generativa de pendientes más un paso nuevo) y, si se repite, un cierre `partial`. El estado no exitoso más frecuente no es `tool_error` (6) sino `loop_blocked` (72): el modelo vuelve a generar exactamente lo mismo.

**A1, evidencia.** Arranque en frío de 7,3 s (generativo) y 5 s (decisión); Ollama descarga a los 5 minutos, así que la primera tarea tras una pausa paga ~12 s. En las trazas `pending` p90 4,5 s y `route` p90 3,7 s. Hoy el primer timeout por carga se registra como servicio no disponible y cierra la tarea (ver E, Timeouts).

**A2, detalle.** La propia documentación exige que la configuración coincida con el contexto real. La guarda de contexto calcula contra 16 384: un prompt de entre 8k y 16k se recortaría en silencio y podría perder el SYSTEM (lo advierte el comentario de `qwen.ts`). `verify` lleva las llamadas previas completas y ya llegó a 2 721 tokens de 4 096. Bajar la configuración a los valores reales es barato; subir el contexto real cuesta VRAM (ver D).

**A4 y A5, evidencia.** Respuestas finales como «The calculator application has been launched successfully…» ante pedidos en español (5 de 28), y dos que empiezan con «No changes were made to the system» sin haber buscado nada. Es probable que parte de las 21 cancelaciones venga de no saber si la tarea avanza; confirmarlo mirando en qué etapa se cancelaron (E20). El progreso se arma con datos que el proveedor ya tiene («Buscando: …», «Leyendo 3 páginas…»).

**A6.** Las latencias del laboratorio no representan producción (mide cada etapa con el mismo modelo seguido: `pending` p50 290 ms contra 1 242 ms en trazas). La traza ya registra duración, tokens y probabilidades por consulta; falta marcar el cambio de modelo, que es lo que más explica la latencia.

**A7.** La caché de prefijo no justifica reordenar prompts (descartado), pero la salida estructurada sí puede reducir reintentos. Se mide junto con E16 (salida estructurada activada o no).

### B. Sacar llamadas generativas del camino

| # | Mejora | Ganancia | Esfuerzo |
|---|---|---|---|
| B1 | **D0: clasificar la solicitud** (charla / una acción / varias) | 65 % de las tareas dejan de llamar a `pending` | 🟡 |
| B2 | **Literal de la solicitud directo al argumento** («ejecutá en la terminal: X», ruta o URL exactas) | Dos llamadas generativas y dos cambios de modelo menos; el comando que corre es el del usuario | 🟢 a 🟡 |
| B3 | **Respuesta final por plantilla o en streaming** | 1,2 a 2,5 s de espera | 🟢 / 🟡 |
| B4 | **Herramientas básicas en lugar de terminal** (T5) | Terminal baja de 63 % a 15–20 % del uso | 🟡 |
| B5 | **Argumentos por candidatos y relleno declarado** | Menos `args_invalid`, menos repeticiones | 🟡 a 🔴 |

**B1, D0 (probado con `d3:2b`).**
- Una consulta de decisión (p50 42 ms) con dos preguntas: `kind` (`choice`: `chat` / `single` / `multi`, de la que solo se usa la probabilidad de `chat`) y `multi` (`noul`: «¿pide dos o más acciones separadas?»). Regla: `chat` ≥ 0,7 → charla; si no, `multi` ≥ 0,5 → varias acciones; si no → una acción.
- Resultado: 109/122 (89,3 %); ponderado por frecuencia real, 151/166 (91 %); 0 falsos `chat` en 189 casos de reserva. Los 122 casos son 72 solicitudes únicas reales del índice (que representan las 116 tareas) más 50 de los datasets de `pending`, etiquetadas a mano; la prueba corrió contra `d3:2b` real con `/v1/systemone`. Un solo `choice` con tres opciones (70 a 78 %) y una `noul` «¿necesita herramientas?» (34 %) no funcionaron.
- Errores del conjunto de ajuste: 10 tareas de varias acciones tomadas por una (error barato: D5 no cierra y se consulta `pending`) y 3 de una acción tomadas por varias (sin costo: flujo actual). Charla: 12 de 12.
- Reserva (189 casos, todos con herramientas): 0 falsos `chat`; charla nueva 12/12. Preguntas de hechos: 3 de 10 tomadas por charla con probabilidad 0,51 a 0,65 (p. ej. «¿cuál es el último modelo de Claude?»). Con umbral 0,7 no pasa ninguna, y lo que queda entre 0,5 y 0,7 sigue el flujo de hoy.
- **`chat` debe limitarse a saludos y preguntas sobre JARVIS.** Las preguntas de hechos van a búsqueda web: hoy «¿cuándo se estrena avengers doomsday?» se respondió sin buscar. Por eso el umbral de `chat` es 0,7.
- Una acción: el código crea la lista con la solicitud como único ítem, el paso corre igual y D5 cierra. Si D0 se equivoca y era «varias», D5 no cierra y se consulta `pending` como hoy (error barato).
- Efecto: charla 3 → 1 llamadas generativas; una acción 3 → 2. De las 116 tareas, 14 son charla y 61 de un paso. Además el paso recibe la solicitud literal, sin la reescritura de `pending` (que hoy convirtió «ejecutá: Write-Output hola» en `echo hola`).
- No es un flujo nuevo: son entradas distintas al reactivo.
- Ahorro real: `pending` cuesta ~250 ms propios; lo que se ahorra de verdad es un cambio de modelo (~1 s mientras no se resuelva D). El argumento fuerte es la **fidelidad**: hoy la pérdida de restricciones entre solicitud y paso se parcha con una línea `Request:` en D1, que con la solicitud literal sobra.
- Promoción: `multi` y una clase opcional `plan` (larga o riesgosa → modo deliberativo con confirmación) también pueden activarse durante la ejecución con señales que el motor ya tiene (lista con más de N ítems, escalaciones).
- **Tarea larga:** se detecta por código, no por modelo. Una primera lista de 3 o más ítems es tarea larga (la decisión no las separa: 0,08 a 0,46). Sirve para avisar, mostrar la lista como plan o pedir confirmación según el nivel de autonomía.
- Pendiente: convertir los casos en dataset del laboratorio (`eval/datasets/d0/`) e integrar.

**B2, literal de la solicitud.** Cuando la solicitud trae el valor exacto (un comando tras «ejecutá en la terminal:», una ruta completa, una URL), el código lo copia tal cual al argumento, sin `pending` ni `args` generativos. Guard, lista negra y pre-chequeo corren igual. Evidencia: «ejecutá en la terminal: Write-Output hola» se ejecutó como `echo hola`; ahí no cambió el resultado, pero con `robocopy` o `ren` (los casos de `route_terminal_explicit`) sí importa. `docs/limitaciones/qwen-3.5-4b.md` muestra además que `pending` cambia de idioma con comandos en inglés. Es el primer piloto natural de B5. Medir sobre `route_terminal_explicit` qué porcentaje se extrae con una regla. 🟢 a 🟡.

**B3, respuesta final.** Plantilla armada por código («Listo: creé la carpeta X») cuando la tarea terminó `completed` y todas sus llamadas son escrituras; no puede afirmar algo falso porque sale de los efectos reales. Cada herramienta o receta declara su frase de «hecho» y varias acciones se unen en orden («Listo: creé Proyectos y moví notas.txt dentro.»). Hoy todo cierre salvo `cancelled` llama al generativo, aunque el fallback sin modelo y el encabezado por código (`renderStatusNote`) ya existen, y el prompt final debe advertir que `read`/`write` es el tipo de la herramienta y no lo que hizo. Con lecturas o búsquedas (la mayoría de las tareas reales) sigue redactando el generativo, pero con **streaming** por el canal SSE (hoy se pide con `stream: false` y el usuario ve todo junto tras 1,2 a 2,5 s): el primer texto aparece en menos de 200 ms (en voz, sintetizar por oración). No cambia el tiempo total, sí la espera percibida. El estado terminal ya se escribe antes de la respuesta, así que no cambia ninguna invariante. Segunda fase opcional: mostrar directo los listados simples con lo que ya condensan los extractores. El alcance real de la plantilla hay que medirlo (E6): en las trazas casi todas las tareas completadas son lecturas o búsquedas. La plantilla también evita el defecto del idioma.

**B4, herramientas básicas (T5).**
- Pedidos reales que hoy caen en `run_command`: procesos por memoria (~25, ver límite en §1), abrir una aplicación (6), abrir una página o reproducir algo (4), archivos más pesados (2).
- Siete herramientas con descripción escrita una sola vez:

| Herramienta | Qué hace | Tipo | Argumentos |
|---|---|---|---|
| `top_processes` | Procesos que más memoria o CPU usan, o los de un programa | Lectura | `by`, `count`, `name` |
| `system_info` | Fecha y hora, disco libre, RAM, tiempo encendida, IP local | Lectura | `what` (lista cerrada) |
| `disk_usage` | Tamaño de una carpeta, o los archivos o carpetas más grandes | Lectura | `path`, `count`, `kind` |
| `open_app` | Abrir una aplicación por nombre | Acción reversible | `name` |
| `open_url` | Abrir una página en el navegador | Acción reversible | `url` |
| `copy_file` | Copiar un archivo o carpeta | Escritura | `source`, `destination` |
| `delete_file` | Borrar a la papelera | Escritura, siempre con confirmación | `path` |
- Elección directa entre 18 herramientas: 55/58 (94,8 %); ponderado por uso real, 98/101; pedidos que terminan en `run_command`: 63/101 → 15/101.
- En dos etapas con una ruta nueva `system` (y `copy_file` y `delete_file` en `files`): 50/58 (86,2 %); ponderado, 91/101; terminal 20/101. Sin regresión relevante en los datasets de D1 (175/196 contra 178/196); los casos que pasan de `terminal` a `system` son los esperados («cuánto pesa Downloads», «qué IP tengo», «abrí la calculadora»).
- **Comparar las dos formas en el laboratorio antes de elegir:** con las básicas, la elección directa acertó más que las dos etapas (55/58 contra 50/58), lo que reabre la fusión de D1 y D2 descartada en §3.
- Ganancia: argumentos de lista cerrada en lugar de PowerShell, sin confirmación ni D3 ni parseo de comandos para las lecturas, `open_app`/`open_url` en nivel verde, y resultado de formato fijo que habilita la plantilla de B3.
- Fallos vistos: pedidos sin herramienta básica («bajá https://…», «comprimí…») no siempre vuelven a `run_command`; servicios y puertos van a `list_processes` (conviene unificarla con `top_processes`); «abrí el bloc de notas» cae en `files/write_file` en dos etapas (el error conocido de D1).
- Requisito: «ejecutá en la terminal: X» se resuelve por código antes de D2 (B2).
- Hoy «abrí la calculadora» termina en `Start-Process calc`, tratado como escritura con confirmación (12,7 s de espera).
- Esfuerzo: un proveedor nativo (como `jarvis_terminal`) y una línea por herramienta en el catálogo. Estado: elección probada; faltan el dataset en el laboratorio y el proveedor.
- **Falta medir:** generación de argumentos con Qwen y ejecución real.
- **Recetas de terminal (idea previa, parcialmente absorbida por B4).** Un catálogo corto (10 a 15) de recetas parametrizadas para lo que siga resolviéndose con PowerShell libre tras B4 (listar y buscar archivos, red, crear carpeta, mover y copiar): la decisión elige la receta, el código llena los huecos y renderiza el comando, y cada receta declara si es lectura o escritura (las de lectura nunca piden aprobación). `run_command` libre queda como último recurso. Motivo: la seguridad hoy depende de parsear comandos (`commandRules`, `readOnly`, sintaxis), con límites admitidos (concatenación, tuberías, variables); una receta no necesita parseo. Se apoya en el punto de extensión que ya existe (una línea en el catálogo, `ToolHost`). Elegir cuáles por frecuencia real en las trazas, **después de B4**, midiendo qué queda en `run_command` (E5). 🟡 a 🔴, una receta por vez. Evidencia: D1 manda a `files` pedidos que necesitan terminal («los 5 archivos más grandes», `docs/limitaciones/d3-2b.md`); una receta con descripción propia le da a D2 una opción que hoy no existe.

**B5, argumentos.**
- **Por candidatos:** el código arma los candidatos (rutas y URLs de la solicitud, carpetas conocidas, resultados de lecturas previas y refs, última ruta usada), descarta los que no existen en el disco, y con uno solo no consulta a ningún modelo; con varios, la decisión (`choice`) elige. Si no queda ninguno, cae al generativo como hoy. La lista debe ser corta (el decisor trabaja con 4 096 tokens). Ejemplo: «leé el README del proyecto»: D2 elige `read_file`, un paso previo listó la carpeta, el candidato único es `C:\proy\README.md` y el argumento se resuelve con cero llamadas a modelos. Motivo: hoy el modelo inventa valores y el pre-chequeo los rechaza después («rutas y URLs que no aparecen en nada de lo que la tarea sabe»); con candidatos eso se vuelve estructural.
- **Relleno declarado:** cada herramienta declara cómo se llena cada argumento: ruta existente → candidatos; ruta nueva → carpeta conocida + nombre por código (entre comillas o «llamada X»; si no se puede extraer, el generativo genera solo el nombre); enum, booleano o número → esquema, valor por defecto o código (`mode` y `recursive`: decisión `choice`/`noul` o valor por defecto; `offset`: siguiente tramo a leer; `pid`: del hecho `process`); texto existente (`old_string`) → líneas candidatas del archivo ya leído; texto nuevo → generativo, solo ese campo; `web_search` → la instrucción como consulta primero, y el generativo reformula solo si D4 rechaza.
- **Ejemplo con `edit_file`:** «cambiá el puerto 3000 por 8080 en config.json» → `path` por candidato, `old_string` la línea que contiene «3000», el número de reemplazos lo cuenta el código y `new_string` es esa línea con «8080»: cero llamadas generativas. Cuando sí hace falta el generativo, recibe los campos ya fijados y escribe solo lo que falta (salida más corta, sin poder inventar la ruta).
- **Incremental:** lo que no declare métodos de relleno sigue usando el generativo como hoy; empezar por las 8 a 10 herramientas más usadas y por el caso más simple, el literal que ya viene en la solicitud (B2). Refs, anti-bucle, Guard y pre-chequeo corren igual. Vale por fiabilidad (46 `args_invalid`), no por latencia: `args` cuesta ~200 ms propios.
- Cautela: casi todas las llamadas reales son `run_command` y `web_search`, de texto libre, así que la cobertura puede ser baja. Medir E13 y E19 antes de diseñar.

### C. Menos esperas y más fiabilidad en la seguridad

| # | Mejora | Ganancia | Esfuerzo |
|---|---|---|---|
| C1 | **Aprobación por niveles** en lugar de `autoMode` binario | 5 a 13 s por confirmación evitada | 🟡 |
| C2 | **Verificación por código antes que D4** | Menos rechazos y aprobaciones falsas | 🟡 |
| C3 | **Calibrar las decisiones** | Fiabilidad | 🟢 🧪 |

**C1.** Hoy o se pregunta en casi toda escritura (`autoMode` apagado) o no se pregunta nunca y la última barrera es D3, un 2B. Propuesta, decidida por código: **verde** (lecturas, abrir apps o URLs, crear algo nuevo sin sobrescribir) sin confirmación; **amarillo** con D3 en umbral estricto o con pregunta según el nivel de autonomía; **rojo** (borrar, sobrescribir, rutas sensibles, reglas `sensitive`) siempre confirma el humano. Agregados: una **lista de permitidos** del usuario (al aprobar, «aprobar siempre este comando»), simétrica a `blacklist`; y no repetir la misma pregunta tras un rechazo (A3). A verificar: si Guard puede saber que el destino ya existe. Contexto: con `autoMode` encendido D3 decide solo incluso en reglas `sensitive` (Defender, firewall, tareas programadas); solo las rutas sensibles y la salida de datos con claves (`egress.ts`) piden confirmación siempre. Con la propuesta el ajuste pasa de un booleano a un **nivel de autonomía** y el código decide el nivel de cada llamada, sin modelos nuevos. Medir antes cuántas confirmaciones por tarea serían «verdes» (E12). La espera de confirmación es el mayor tiempo muerto de una tarea y no depende de ningún modelo: una sola (12,7 s en «abrí la calculadora») pesa más que todos los modelos juntos, y 21 de 116 tareas terminaron canceladas.

**C2.** La pregunta `ok` la responde el código cuando el estado ya es concluyente (`ok` con código de salida 0, o `no_data`). Las escrituras llevan una **poscondición** comprobada en el disco (`create_directory` → la carpeta existe; `move_file` → el origen ya no está y el destino sí; `write_file` → existe con el tamaño esperado). D4 queda para lo que el código no puede saber: si lo leído responde a lo pedido (`cumple` en lecturas y búsquedas). Evidencia: D4 aprueba una copia donde se pidió mover (0,97 a 0,99), rechaza movimientos correctos (`ok` 0,51 con `Move-Item` y `Test-Path`) y sigue un `Expected` mal escrito (3/18). Las tres fallas son sobre hechos comprobables en el disco. Cada rechazo falso cuesta una vuelta completa de modelos, y hoy D4 llega tarde a `autoMode` y no deshace nada: con poscondiciones es una barrera real.

**C3.** Calibrar los umbrales (0,6 / 0,65 / 0,75) por pregunta y herramienta con las trazas, registrar los márgenes, y armar por plantilla las preguntas al usuario (la decisión elige qué argumento falta). Hoy D3 es una sola elección (`approved` / `args_invalid` / `info_missing`). Dividirla en varias `noul` específicas, como D4 con `VERIFY_CHECKS` («¿la ruta es la que pidió el usuario?», «¿el contenido corresponde a lo pedido?», «¿sobrescribe algo no mencionado?»; cuatro preguntas cuestan menos de 0,2 s), no está probado: en D1 y D2 fue peor (20/22 contra 22/22) y 3 veces más lento; vale el experimento E14, sin darlo por ganado.

**C3, usos concretos del margen** (30 a 60 ms por consulta dejan espacio donde hoy hay riesgo):
- **Acuerdo en escrituras sensibles:** preguntar con dos formulaciones, o con el orden de las opciones barajado (reduce el sesgo de posición). Si discrepan, se pregunta al usuario, no al generativo.
- **Margen como señal:** si D2 duda entre dos herramientas en una escritura, preguntar «¿X o Y?» con una plantilla armada por código.
- **Preguntas al usuario sin generativo:** cuando falta información, la decisión elige qué argumento falta y una plantilla arma la pregunta («¿Qué archivo querés editar?»).
- **Más preguntas a D4:** no por ahora. D4 ya es el punto débil (sigue un `Expected` malo, confunde copiar con mover); primero C2.

### D. VRAM al límite (N1, en pausa por decisión del usuario)

Es la mejora más grande disponible (~4 s por tarea de una acción), y con un segundo modelo de 1,64 GB la penalización desaparece. Opciones: probar `d3:2b` en una cuantización más liviana (Q4_K_M, cerca de la mitad) y medir su precisión (E15); liberar VRAM ajena (el escritorio usa ~1,7 GB; superposición de NVIDIA y apps con aceleración, y comprobar si el servidor de voz usa la GPU); mantener los contextos en el mínimo (A2). Hipótesis, no verificada, para liberar espacio sin tocar la cuantización: limitar las ranuras paralelas (el decisor carga con 16 y T4 mostró que no ayudan) y probar KV cuantizada o flash attention. El decisor en CPU queda descartado (2,1 s por consulta). Riesgo: que la cuantización liviana pierda precisión en D3 y D4, que ya están justos; por eso se mide antes (E15). La prueba con un modelo de 1,64 GB demuestra que el problema es el espacio, no que un `d3:2b` liviano conserve la precisión.

### E. Menores

| Mejora | Detalle | Esfuerzo |
|---|---|---|
| Compactar el contexto | Los efectos nunca se recortan (reserva de 12 000 caracteres, unos 4 000 tokens). Con 8 192 tokens reales en el generativo ocupa la mitad, no un cuarto como con 16 k, y una tarea larga cierra `unrecoverable`. Compactar efectos viejos a una línea (herramienta, argumentos, estado, ref) conservando la invariante de no ocultar efectos. No subir el contexto: cuesta VRAM | 🟡 |
| Timeouts | Distinguir timeout de caída (limitación ya documentada). Hoy un timeout se registra como servicio no disponible y cierra la tarea: no cerrar por un único timeout transitorio | 🟢 |
| Lista tras un fallo | Pedir al modelo solo el ítem reescrito (salida más corta); el código ya conserva el resto con `reconcileList` | 🟢 |
| Constantes duras | Revisar con datos de las trazas: 20 pasos, 6 llamadas por paso, 10 intentos, etc. | 🧪 |
| Documentación | `ARCHITECTURE.md` (§3 y §6) habla de cuatro decisiones y `CORE_FLOW.md` describe una quinta (D5): actualizar | 🟢 |

### Cómo queda una tarea de una acción

| Etapa | Hoy | Con B1 + B4 + B3 |
|---|---|---|
| Clasificar | — | D0 (42 ms) |
| Lista de pendientes | Generativo | Código |
| Ruta y herramienta | D1, D2 | D1, D2 |
| Argumentos | Generativo, PowerShell libre | Generativo con lista cerrada o nombre; código si hay literal (B2) |
| Confirmación | Sí, si es comando | No, si es lectura o nivel verde (C1) |
| Verificación y cierre | D4, D5 | D4, D5 (código donde alcance: C2) |
| Respuesta | Generativo | Plantilla, o generativo en streaming |
| Llamadas generativas | 3 | 1 a 2 |

## 3. Descartado

| Idea | Motivo |
|---|---|
| Reordenar prompts para la caché de prefijo | La caché funciona pero ahorra ~100 ms, y las etapas se intercalan |
| Decisor más grande | Agrava la VRAM (en esta GPU). En latencia sería barato (~150 ms contra ~40 ms), pero la dirección a probar es la contraria: un `d3:2b` más liviano (E15) |
| Subir el contexto a 32 k (y E10, 16 k contra 32 k) | Más VRAM y agrava N1. 8 192 alcanza para las tareas actuales (máximo visto: 1 497 tokens en `args`); el límite real está en el decisor: `verify` llegó a 2 721 de 4 096 (A2) |
| Fusionar D1 y D2 en una consulta | 172/196 (87,8 %) contra 178/196 (90,8 %) sobre los datasets de D1 con las 11 herramientas del catálogo; ahorra solo ~32 ms (con las herramientas básicas conviene recomparar) |
| Paralelizar consultas de decisión | Unos 28 ms por pregunta sin importar cómo lleguen, también con `OLLAMA_NUM_PARALLEL=4`. Prueba con 15 `noul` sobre pasajes reales de 600 caracteres: 3 lotes de 5 en serie 410 a 419 ms, en paralelo 399 a 411 ms; una consulta con las 15, 395 a 419 ms; 15 de 1 en paralelo, 448 a 451 ms; D1 para 4 pasos, 94 a 99 ms en serie y 82 ms en paralelo. Las probabilidades no cambian (diferencia máxima 0,013) |
| Detectar tareas largas con el modelo | No las separa; se usa el largo de la lista |
| Más preguntas a D4 | Primero C2 |
| Decisor en CPU | 2,1 s por consulta |
| Un tercer flujo «Directo» | D0 logra lo mismo como entrada al reactivo; un flujo aparte suma tests y casos borde sin ganancia extra |
| Dividir D1 y D2 en una `noul` por opción | Peor (20/22 contra 22/22) y 3 veces más lento (`docs/limitaciones/d3-2b.md`) |

## 4. Mejoras futuras (agregar capacidades)

1. **Delegación a agentes especializados:** destino `agent` en el catálogo (JARVIS decide a quién delegar, entrega un encargo acotado y recibe el resultado como ref, con el mismo Guard). El progreso llega por eventos, con las mismas aprobaciones. Incluye escalar a un modelo de frontera ante las señales de fracaso existentes (`replans_exhausted`, `review_rejected`, `not_accomplished` ×2, tercera escalación) y extender `egress.ts` a todo lo que salga hacia la nube.
2. **Memoria entre tareas:** playbooks y hechos del usuario en config, generados fuera de línea desde las trazas (el backend sigue sin leerlas). Sin romper el principio de que cada tarea nace de cero: un archivo generado fuera de línea desde trazas aprobadas o confirmado por el usuario. Usos: ejemplos para generar argumentos y atajos que se ejecutan sin generativo tras N éxitos. Habilita continuidad («abrí lo de ayer»).
3. **Contexto vivo de la PC:** ventana activa, portapapeles, carpeta de trabajo, archivos recientes, apps abiertas. Resuelve «este archivo» sin llamada generativa.
4. **Aprobaciones y respuestas en lenguaje natural** (Telegram y voz), clasificadas por la decisión (`aprobar` / `rechazar` / `modificar`).
5. **Modelo generativo distinto por etapa** (argumentos, plan, respuesta final).
6. **Lecturas independientes en paralelo** dentro de una tarea larga.
7. **Deshacer:** copia de seguridad antes de sobrescribir y papelera en lugar de borrar.
8. **Herramientas nuevas:** pedidos reales sin herramienta hoy («bajá el volumen un 10 %», «sacá una captura de pantalla», «reproducí … en YouTube»). Las básicas de B4 no entran acá: reemplazan lo que se hace por terminal.
9. **Tareas programadas o recurrentes** y avisos proactivos.
10. **Reanudar tareas tras reiniciar** y cola con prioridad cuando Telegram, voz y la interfaz compiten por los modelos (existe el snapshot `v1` pero no la restauración).
11. **Afinar el modelo de decisión** con trazas etiquetadas (por un modelo mayor o por correcciones del usuario).
12. **Descartar LangChain/LangGraph para el núcleo.** JARVIS ya tiene grafo de estados, interrupciones, checkpoints y streaming, hechos a medida y con garantías que un framework no da (`apply` atómico, estado terminal cerrado, Guard antes de todo despacho, saneamiento de prompts, traza). LangChain asume que un LLM elige herramientas y JARVIS lo invierte (un clasificador por logits decide, el generativo solo genera). La complejidad real está en las políticas que compensan a los modelos chicos, que un framework no elimina, y el stack es TypeScript, donde las versiones JS suelen ir detrás de las de Python. Reevaluar solo dentro de un agente especializado, como caja negra detrás del catálogo.

## 5. Experimentos pendientes

Hechos: línea base de trazas (E1), alternancia de modelos, arranque en frío (parte de E11), contexto real, caché, T1 a T5; E2 en parte (distribución de pasos). Descartado: E10. E7 (decisor mayor para D3 y D4) pierde prioridad: agrava la VRAM.

| # | Experimento | Qué responde |
|---|---|---|
| E3 | D0 como dataset del laboratorio y con casos nuevos | Si el 89 % se sostiene fuera del conjunto de ajuste |
| E4 | Slot-filling: reproducir lecturas pasadas con candidatos por código | ¿La decisión elige el argumento real? |
| E5 | Cobertura de recetas sobre los comandos que sigan en `run_command` tras B4 | Qué recetas construir primero |
| E6 | % de tareas completadas con solo escrituras | Alcance de la plantilla de B3 |
| E8 | Generativo más chico para argumentos y pendientes | Hasta dónde se puede bajar sin perder éxito |
| E9 | Calibración de umbrales y distribución de márgenes | Mejores umbrales por pregunta y herramienta (C3) |
| E12 | Confirmaciones al usuario por tarea y cuántas serían «verdes» | Valor de la aprobación por niveles (C1) |
| E13 | Tipo de cada argumento por herramienta en las trazas | Cobertura real del relleno declarado (B5) |
| E19 | `web_search` con la instrucción como consulta contra la generada | Si se puede sacar `args` de la tarea más frecuente |
| E14 | D3 dividido en `noul` contra una sola elección | Si mejora sin costo de latencia |
| E15 | `d3:2b` liviano contra Q8: precisión en D1 a D5 y latencia alternando con Qwen | Si N1 se resuelve con configuración |
| E16 | `keep_alive` permanente y tras 10 minutos sin uso; salida estructurada en `args` activada o no | Que A1 elimina el arranque en frío y cuánto aporta A7 |
| E17 | Consultas gastadas después del primer `loop_blocked` | Ahorro de A3 |
| E18 | Casos de `verify_copy_move` y `d4_verify` que decide una poscondición | Alcance de C2 |
| E20 | Etapa en que se cancelaron las 21 tareas | Si pesan las esperas o las confirmaciones |
| — | Argumentos de las herramientas básicas con Qwen y ejecución real | Cierra la prueba de B4 |

## 6. Registro de notas

> Anotar acá ideas nuevas, resultados de experimentos y decisiones. Formato: fecha · idea o experimento · resultado · decisión.

- 2026-11-13 · E1, línea base desde 35 trazas · la decisión tarda 37 ms tras otra decisión y 570 ms (p50) tras una generativa; tarea de una llamada: mediana 10,7 s · la latencia la explica la alternancia de modelos, no la cantidad de llamadas generativas.
- 2026-11-13 · Alternancia contra Ollama · ~1 000 ms por cambio con Qwen + `d3:2b` Q8 en GPU (7,9 de 8,2 GB); 0 ms con un segundo modelo de 1,64 GB; decisor en CPU: 2,1 s · causa: VRAM al límite. Propuesto: `d3:2b` liviano (E15); CPU descartada.
- 2026-11-13 · Arranque en frío · 7,3 s el generativo y 5 s la decisión, sin modelos cargados tras 5 minutos · propuesto: calentar al arrancar y `keep_alive` largo (A1).
- 2026-11-13 · Contexto real · Ollama carga 8 192 (Qwen) y 4 096 (`d3:2b`); la configuración dice 16 384 · propuesto: alinear (A2).
- 2026-11-13 · Caché de prefijo · funciona (760 de 764 tokens), ahorra ~100 ms · reordenar prompts descartado.
- 2026-11-13 · Índice de 116 tareas · 72 `loop_blocked` y 46 `args_invalid` contra 6 `tool_error`; 21 canceladas · el modelo repite más de lo que la herramienta falla (A3).
- 2026-11-13 · T1, D0 · 109/122; 0 falsos `chat` en 189 de reserva; 3/10 preguntas de hechos entre 0,51 y 0,65 · implementable con umbral de `chat` en 0,7 (B1).
- 2026-11-13 · T3, D1 y D2 fusionadas · 87,8 % contra 90,8 % · descartado (recomparar con las básicas).
- 2026-11-13 · T4, decisión en paralelo · sin ganancia (28 ms por pregunta, también con `OLLAMA_NUM_PARALLEL=4`) · descartado.
- 2026-11-13 · T5, siete herramientas básicas · 55/58 en elección directa, 50/58 en dos etapas; terminal de 63/101 a 15 o 20/101 · implementable; falta medir argumentos (B4).
- 2026-11-13 · N1 (tamaño de modelos) · en pausa por decisión del usuario.

## 7. Resumen final

### Orden recomendado

| # | Mejora | Qué ataca | Ganancia estimada | Esfuerzo |
|---|---|---|---|---|
| — | D: los dos modelos con margen en la VRAM (**en pausa**) | 1 s por cambio de modelo | Unos 4 s por tarea de una acción | 🟢 🧪 |
| ★ | B4: herramientas básicas (probado) | PowerShell libre y confirmaciones | Terminal de ~62 % a 15–20 % del uso real | 🟡 |
| ★ | B1: D0 con `chat` ≥ 0,7 (probado) | `pending` en el 65 % de las tareas | 1 a 2 llamadas generativas y 1 cambio de modelo menos | 🟡 |
| 2 | A1: modelos siempre calientes | Arranque en frío | Unos 12 s en la primera tarea tras una pausa | 🟢 |
| 3 | A2: contexto configurado = real | Recorte silencioso del prompt | Corrección, no velocidad | 🟢 🧪 |
| 4 | C1: aprobación por niveles y lista de permitidos | Espera del usuario | 5 a 13 s por confirmación evitada | 🟡 |
| 5 | A3: cortar repeticiones y dar pistas | Tareas perdidas que siguen girando | De unos 30 s a unos 5 s | 🟢 |
| 6 | C2: verificación por código antes que D4 | Rechazos y aprobaciones falsas | Una vuelta de modelos por rechazo falso | 🟡 |
| 7 | B3: respuesta final en streaming o por plantilla | La única generativa cara | 1,2 a 2,5 s percibidos | 🟡 / 🟢 |
| 8 | B2 y recetas: literal directo y recetas | PowerShell reescrito por el 4B | Fiabilidad; 2 llamadas menos en B2 | 🟢 a 🔴 |
| 9 | B5: argumentos por candidatos y relleno declarado | `args_invalid` | Fiabilidad; unos 200 ms por llamada | 🟡 a 🔴 |
| 10 | A4, A5, A6, A7 y E | Idioma, progreso, medición, topes | Calidad percibida | 🟢 |

Con la VRAM en pausa, cada cambio de modelo evitado vale cerca de 1 s, lo que sube el valor de B1. Descartadas o en pausa: ver §3.

### Estado de cada mejora

| Mejora | Estado |
|---|---|
| A1 | [ ] calentamiento · [ ] `keep_alive` · [ ] E16 |
| A2 | [x] desajuste confirmado · [ ] corregir la configuración |
| A3 | [ ] contar consultas tras el primer bloqueo (E17) · [ ] integrar |
| A4, A5 | [ ] fijar idioma · [ ] etapa de las 21 cancelaciones (E20) · [ ] progreso |
| A6 | [x] línea base hecha · [ ] marcar cambio de modelo, márgenes y confirmaciones |
| A7 | [ ] probar `json_schema` en `args` |
| B1 | [x] probado · [ ] dataset en `eval/datasets/d0/` · [ ] integrar |
| B2 | [ ] medir extracción por regla · [ ] integrar |
| B3 | [ ] medir E6 · [ ] plantillas · [ ] streaming |
| B4 | [x] elección probada · [ ] argumentos con Qwen · [ ] dataset · [ ] proveedor |
| B5 | [ ] E13 y E19 · [ ] piloto con `edit_file` |
| C1 | [ ] medir E12 · [ ] definir niveles |
| C2 | [ ] E18 · [ ] poscondiciones |
| C3 | [ ] calibrar umbrales · [ ] E14 |
| D | [x] causa confirmada · [ ] E15 |
| E | [ ] sin empezar |

### Mejoras sobre lo actual
1. Modelos calientes y `keep_alive` (A1).
2. Contexto configurado igual al real (A2).
3. Cortar repeticiones por código y dar pistas de recuperación (A3).
4. Idioma de la respuesta final y progreso visible en esperas largas (A4, A5).
5. D0: charla / una acción / varias, con `chat` ≥ 0,7 (B1).
6. Literal de la solicitud directo al argumento (B2).
7. Respuesta final por plantilla o en streaming (B3).
8. Herramientas básicas en lugar de terminal (B4).
9. Argumentos por candidatos y relleno declarado (B5).
10. Aprobación por niveles y lista de permitidos (C1).
11. Verificación por código antes que D4 (C2).
12. Calibrar umbrales y márgenes (C3).
13. Liberar VRAM para que los dos modelos convivan (D, en pausa).
14. Medir primero (marcar cambios de modelo, márgenes y confirmaciones) y salida estructurada en `args` (A6, A7).
15. Recetas de terminal para lo que quede en `run_command` tras B4.
16. Menores: compactar contexto, distinguir timeouts, reescribir solo el ítem fallido, revisar constantes y actualizar la documentación (E).

### Puntos débiles actuales
1. La alternancia entre modelos con la VRAM al límite: ~1 s por cambio, 4 cambios por tarea de una acción.
2. Arranque en frío de ~12 s tras 5 minutos sin uso.
3. Contexto configurado (16 384) distinto del real (8 192 y 4 096): recorte silencioso.
4. El modelo repite llamadas bloqueadas (72 `loop_blocked`) y genera argumentos inválidos (46).
5. Confirmaciones al usuario costosas y repetidas (12,7 s en una); 21 de 116 tareas canceladas.
6. D4 se equivoca en hechos que el código puede comprobar; en `autoMode` la última barrera es un 2B.
7. El 4B escribe PowerShell libre y la seguridad depende de parsearlo.
8. Preguntas de hechos respondidas sin buscar; respuestas finales a veces en inglés.
9. Umbrales y topes sin calibración documentada.
10. Sin memoria entre tareas ni salida hacia agentes más capaces.
11. Dependencia de Windows y PowerShell.
12. Costo fijo por tarea: unas 3 llamadas generativas incluso para una acción simple.
13. Contexto con efectos no recortables: cierre brusco (`unrecoverable`) en tareas largas.
14. Un timeout se trata como caída y puede cerrar la tarea.
15. Documentación desactualizada (cuatro contra cinco decisiones).
16. Sin confirmar: orden de prompts para la caché (ahorra poco) y salida estructurada en `args`.