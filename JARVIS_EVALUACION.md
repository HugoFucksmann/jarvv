# JARVIS — Evaluación y banco de ideas

> Documento vivo. Base: `ARCHITECTURE.md`, `CORE_FLOW.md`, `CONTEXT_AND_MEMORY.md`.
> Primera evaluación: hecha solo sobre la documentación. Las estimaciones debían confirmarse con las trazas.
> **Segunda revisión (2026-11-13):** contrastada con el código, con las trazas guardadas (`jarvis-traces/`: 116 tareas en el índice, 35 con detalle) y con pruebas directas contra Ollama. Lo medido está en «Mediciones reales»; cada idea previa lleva una línea **Revisión** con el veredicto; las ideas nuevas están en «Ideas nuevas (segunda revisión)». No se editó código.

**Rol de JARVIS:** agente root coordinador. El usuario habla con JARVIS; JARVIS se mueve en la PC, ejecuta herramientas y, a futuro, llamará a agentes especializados. Esos agentes en sí no forman parte de este análisis.

**Alcance de este documento:** mejorar lo que JARVIS hace hoy (velocidad, eficiencia y autonomía con modelos chicos). Todo lo que sea **agregar** capacidades nuevas va aparte, en «Mejoras futuras».

## Criterio de priorización

Cada tarea se resuelve con lo más rápido y fiable que alcance:

1. **Código** (microsegundos a milisegundos): si se puede comprobar o derivar, va acá.
2. **Modelo de decisión** (30 a 60 ms): elegir entre opciones cerradas o responder sí/no.
3. **Modelo generativo** (Qwen 4B): solo lo que exige texto libre. Es el más lento y el menos fiable.

### Dónde se gasta hoy el tiempo (según la documentación)

| Etapa | Quién | Frecuencia |
|---|---|---|
| Lista de pendientes (primera vuelta, reactivo) | Generativo | Toda tarea reactiva |
| Decisión 1 (ruta) y Decisión 2 (herramienta) | Decisión | Cada llamada, salvo opción única |
| Generar argumentos | Generativo | Cada llamada |
| Pre-chequeo, lista negra, Guard, anti-bucle | Código | Cada llamada |
| Decisión 3 (revisar argumentos) | Decisión | Solo escrituras con `autoMode` encendido |
| Decisión 4 (verificación, 2 preguntas) | Decisión | Cada llamada ejecutada |
| Decisión 5 (cierre, `request_complete`) | Decisión | Al vaciarse la lista |
| Respuesta final | Generativo | Casi todo cierre |
| Pregunta al usuario, plan, replan, lista tras fallo | Generativo | Ocasional |

**Lectura original (solo documentación):** una tarea de una sola acción cuesta unas 3 llamadas al generativo (pendientes, argumentos, respuesta final) y unas 5 consultas de decisión (del orden de 0,2 a 0,3 s en total). El costo dominante es el generativo. Las consultas de decisión son baratas: no vale la pena optimizarlas, sí **sacar llamadas generativas del camino habitual** y usar mejor el margen de la decisión.

**Corrección tras medir:** esa lectura vale para el laboratorio, no para producción. En producción el costo dominante no es generar texto sino **alternar entre los dos modelos** y **arrancarlos en frío**. Ver la sección siguiente.

## Mediciones reales (2026-11-13)

Entorno: Ollama 0.40.13, RTX 3070 Ti de 8 GB, `qwen3.5:4b` (Q4_K_M, 3,36 GB en VRAM) y `d3:2b` (Q8_0, 3,08 GB en VRAM).

### Qué dicen las trazas (35 tareas con detalle)

| Etapa | Modelo | n | p50 | p90 |
|---|---|---|---|---|
| `pending` | Generativo | 55 | 1 242 ms | 4 500 ms |
| `route` (D1) | Decisión | 58 | 499 ms | 3 716 ms |
| `tool` (D2) | Decisión | 58 | 32 ms | 45 ms |
| `args` | Generativo | 58 | 1 688 ms | 2 305 ms |
| `verify` (D4) | Decisión | 37 | 410 ms | 1 073 ms |
| `completion` (D5) | Decisión | 18 | 57 ms | 78 ms |
| `final` | Generativo | 29 | 1 751 ms | 2 543 ms |

- La misma consulta de decisión tarda **37 ms** (p50) si la consulta anterior fue también de decisión, y **570 ms** (p50; p90 2,9 s) si la anterior fue generativa. Por eso D1 y D4 son lentas y D2 y D5 no: D1 y D4 son las que vienen después de una llamada generativa.
- El generativo tarda 1 683 ms (p50) cuando viene después de una decisión. `args` recibe 873 tokens y escribe 20 en promedio: esos 1,7 s no son generación.
- Tarea completada de una sola llamada (48 en el índice): mediana **10,7 s**, con 7 consultas a modelos.
- Sobre las 116 tareas del índice: 86 `completed`, 21 `cancelled`, 6 `failed`, 3 `partial`. Estados de llamada: 158 `ok`, **72 `loop_blocked`**, **46 `args_invalid`**, 10 `user_rejected`, 6 `tool_error`.
- En las tareas con `web_search`, la herramienta misma tarda de 6 a 16 s: ahí los modelos no son el cuello de botella.

### Qué dicen las pruebas directas (repitiendo consultas reales de una traza)

| Prueba | Generativo (`args`, 764 tokens, 15 de salida) | Decisión (`route`) |
|---|---|---|
| Arranque en frío | 7,3 s | 5,0 a 5,2 s |
| Misma consulta, mismo modelo que la anterior | 170 a 210 ms | 32 a 51 ms |
| Después de usar el otro modelo (ambos en GPU) | 1,0 a 1,3 s | 1,0 a 1,05 s |
| Alternando con `d3:2b-cpu` (decisión en CPU) | 185 a 210 ms | 2,1 s (D4: 3,0 s) |
| Alternando con un segundo modelo de 1,64 GB en GPU | 170 a 200 ms | 21 a 29 ms (modelo sustituto) |

1. **La alternancia cuesta cerca de 1 s por cambio, y la causa es la VRAM.** Con ambos modelos cargados la GPU queda en 7,9 de 8,2 GB (unos 1,7 GB son del escritorio y otras apps). El registro de Ollama muestra, tras cada cambio, 1 114 ms para evaluar 4 tokens (3,6 tokens/s) contra 45 ms cuando el modelo viene de usarse. Con un segundo modelo más chico (7,4 GB en total) la penalización desaparece por completo. Con el decisor en CPU también desaparece para el generativo, pero la decisión pasa a 2 s: no sirve.
2. **Una tarea de una acción hace 4 cambios de modelo** (`pending` → D1, D2 → `args` → D4, D5 → `final`): unos 4 s de los 7 a 10 s son cambio de modelo.
3. **Arranque en frío: unos 12 s entre los dos.** Ollama descarga los modelos a los 5 minutos sin uso (no había ninguno cargado al empezar la prueba). `server.ts` precalienta los servidores MCP, no los modelos, y el código no envía `keep_alive`.
4. **El contexto real no es el configurado.** `jarvis-config.json` declara 16 384 tokens para ambos; Ollama carga `qwen3.5:4b` con 8 192 (hay un `OLLAMA_CONTEXT_LENGTH=8192` en el entorno) y `d3:2b` con 4 096. La guarda de contexto calcula contra 16 384, así que no protege: un prompt de entre 8k y 16k se recortaría en silencio. El máximo visto en las trazas: 1 497 tokens en `args` y **2 721 en `verify`** (66 % del contexto real del decisor).
5. **El costo propio del generativo es bajo salvo en la respuesta final.** Sin penalización, `pending` y `args` cuestan 200 a 300 ms (la generación va a unos 105 tokens/s y la lectura del prompt es rápida). `final` escribe 128 tokens en promedio: 1,2 a 1,7 s. Es la única llamada generativa cara por sí misma.
6. **La caché de prefijo funciona** (760 de 764 tokens reutilizados al repetir el prompt), pero ahorra unos 100 ms.

**Consecuencia para las prioridades:** sin la penalización de cambio, una tarea de una acción gastaría unos 2 s en modelos en vez de 6 a 7 s, y casi todo sería la respuesta final. Entonces: primero el runtime (ideas N1 a N3), después las esperas del usuario y los bucles perdidos (5, N4, 6), después la respuesta final (N6 y 4). Sacar llamadas generativas de `pending` y `args` (ideas 1, 2 y 2b) sigue valiendo, pero por **fiabilidad**, no por latencia: ahorran 200 a 300 ms cada una.

## Leyenda

**Esfuerzo:** 🟢 pequeño · 🟡 medio · 🔴 mayor
**¿Se puede probar sin tocar código?** 🧪 sí (modelo, configuración, análisis de trazas o el laboratorio de evaluación, que ya existe) · 🔧 requiere código

## Lo que ya está bien

- D1 a D5 son preguntas de clasificación (`choice`/`noul`), no texto libre: encajan con un modelo chico.
- D5 ya cierra tareas sin llamar al generativo; es el patrón correcto (decisión en lugar de generativo) y conviene replicarlo.
- La lista de pendientes la mantiene el código; el modelo solo la genera al empezar, tras un fallo y al vaciarse.
- Pre-chequeo, `readOnly`, anti-bucle y topes son deterministas.
- Resultados voluminosos fuera del contexto (refs).
- Contratos entre modelos y motor, y una traza completa que sirve de base de evaluación.

## Mejoras sobre lo que JARVIS hace hoy

### 0. Medir primero
- **Qué:** con la traza y el laboratorio de evaluación, medir por tarea: cantidad de llamadas generativas y de decisión, latencia por etapa, margen (probabilidad) de cada decisión, confirmaciones al usuario y cierres por causa. Confirmar que la traza registra el tiempo por etapa.
- **Por qué:** todas las demás mejoras se ordenan con estos números, y las estimaciones de este documento son de lectura de documentación.
- **Esfuerzo:** 🟢 · **Sin código:** 🧪
- **Estado:** [x] línea base hecha (ver «Mediciones reales») · [ ] márgenes y confirmaciones por tarea
- **Revisión:** ✅ válida y hecha en parte. La traza sí registra duración, tokens y probabilidades por consulta. Falta que el resumen de la traza marque si cada consulta vino después de un cambio de modelo, porque es lo que más explica la latencia. Ojo con el laboratorio: mide cada etapa con el mismo modelo seguido (por ejemplo `pending` p50 290 ms, D3 45 ms), así que sus latencias no representan producción (`pending` p50 1 242 ms).

### 1. Atajo inicial con una decisión D0 (sin lista de pendientes generativa)
- **Qué:** una pregunta `choice` sobre la solicitud antes de arrancar: `chat` (no necesita herramientas), `single` (una acción) o `multi` (varias o dependientes). Opcionalmente `plan` (larga o riesgosa → modo deliberativo con confirmación).
  - `single`: el código crea la lista con la solicitud como único ítem y se salta la llamada generativa. El paso corre igual y D5 cierra.
  - `chat`: va directo a la respuesta final.
  - `multi`: flujo reactivo actual.
- **Por qué:** hoy la primera vuelta del reactivo siempre llama al generativo, incluso para una acción. Una solicitud sin herramientas paga dos llamadas (lista vacía + respuesta). Además, en `single` el primer pendiente es la solicitud tal cual, lo que elimina la pérdida de restricciones que hoy se parcha con la línea `Request:` en D1.
- **Salvaguarda ya existente:** si D0 se equivoca con `single`, D5 (umbral 0,75, ve la solicitud completa) no cierra y el reactivo consulta al generativo como hoy: el costo del error es un paso extra. Para `chat` y `single` usar umbral estricto y caer en `multi` por defecto.
- **No es un tercer flujo:** es un atajo dentro del reactivo. Se descarta agregar un flujo «Directo» aparte (más tests y casos borde sin ganancia extra).
- **Corta vs larga:** `multi` y `plan` son las largas. Se pueden promover durante la ejecución con señales que el motor ya tiene (lista con más de N ítems, escalaciones).
- **Beneficio:** una llamada generativa menos en la mayoría de las tareas, y menos información perdida entre solicitud y paso.
- **Esfuerzo:** 🟡 · **Sin código:** 🧪 para calibrar D0 offline (etiqueta: pasos realmente usados en las trazas); 🔧 para integrarlo
- **Estado:** [ ] medir distribución · [ ] D0 offline · [ ] integrar
- **Revisión:** ⚠️ válida con tres correcciones.
  1. **El ahorro de latencia es menor al estimado:** `pending` cuesta unos 250 ms propios; lo que sí ahorra es un cambio de modelo (aprox. 1 s mientras no se resuelva N1). El argumento fuerte es la **fidelidad**: en la traza de «ejecutá en la terminal: Write-Output hola», `pending` lo reescribió como «Escribir 'hola' en el archivo de salida estándar usando PowerShell» y el comando ejecutado fue `echo hola`.
  2. **La clase `chat` es riesgosa.** En dos trazas, «Cuando se estrena avengers doomsday ?» devolvió lista vacía y se respondió sin buscar («No changes were made to the system. Based on the available data…»). Un 4B no tiene conocimiento fiable: `chat` debería limitarse a saludos y preguntas sobre JARVIS mismo, y toda pregunta de hechos debería ir a `single` con ruta `web`. Conviene medir D0 con ese criterio.
  3. **Dato corregido:** una solicitud sin herramientas paga hoy **tres** llamadas generativas, no dos (`pending`, `pending` de confirmación y `final`); la segunda es barata (unos 100 ms).
  - Distribución real (116 tareas): 14 sin pasos, 61 de un paso, 41 de dos o más. El 65 % de las tareas entraría en `chat` o `single`.

### 2. Argumentos: código y decisión antes que generativo
- **Qué:** para argumentos que son una elección entre valores conocidos (ruta, URL, `pid`, id de ref, carpeta):
  1. El código arma los candidatos: rutas y URLs de la solicitud y de la instrucción, carpetas conocidas del entorno, resultados de lecturas previas y refs.
  2. La decisión (`choice`) elige el candidato.
  3. El generativo queda solo para texto libre (contenido de un archivo, consulta de búsqueda, comando sin receta) o si ningún candidato sirve.
- **Cómo funciona:**
  1. D2 elige la herramienta (por ejemplo `read_file`).
  2. Para el argumento `path`, el código junta candidatos: rutas de la solicitud y de la instrucción, carpetas conocidas del entorno más el nombre mencionado, rutas vistas en resultados anteriores (listados, búsquedas) y la última ruta usada.
  3. Descarta los que no existen (consulta al disco).
  4. Si queda **un** candidato, se usa sin llamar a ningún modelo. Si quedan **varios**, una pregunta `choice` a la decisión (30 a 60 ms) elige. Si no queda ninguno, cae al generativo como hoy.
  - Ejemplo: «leé el README del proyecto». Un paso previo listó la carpeta, el candidato único es `C:\proy\README.md` y el argumento se resuelve con cero llamadas a modelos.
  - Refs, anti-bucle, Guard y pre-chequeo corren igual; si falla, el camino actual sigue disponible.
- **Por qué:** la generación de argumentos es la llamada generativa más frecuente (cada llamada). Y la causa de muchos `args_invalid` es que el modelo inventa valores; el pre-chequeo hoy los rechaza después («rutas y URLs que no aparecen en nada de lo que la tarea sabe»). Con candidatos, eso se vuelve estructural.
- **Beneficio:** menos latencia en lecturas y navegación, menos argumentos inventados y menos reintentos.
- **Esfuerzo:** 🟡 · **Sin código:** 🧪 reproduciendo llamadas pasadas de las trazas: ¿la decisión elige el argumento real entre los candidatos?
- **Estado:** [ ] prueba offline · [ ] integrar para lecturas
- **Revisión:** ⚠️ válida, pero cambia el motivo y baja de prioridad. Generar argumentos cuesta unos 200 ms propios (20 tokens de salida): el beneficio no es velocidad sino menos `args_invalid` (46 en 116 tareas) y menos repeticiones. Límite a tener en cuenta: el decisor trabaja con 4 096 tokens reales, así que la lista de candidatos tiene que ser corta. Empezar por el caso más simple y más frecuente en las trazas: el literal que ya viene en la solicitud (idea N7).

### 2b. Relleno declarado de todos los argumentos (generativo solo para texto nuevo)
- **Qué:** generalizar el punto 2: cada herramienta o receta declara cómo se llena **cada** argumento, del método más barato al más caro. El generativo queda solo para texto que todavía no existe.

| Tipo de argumento | Cómo se llena |
|---|---|
| Ruta existente (p. ej. `edit_file.path`) | Candidatos + decisión (punto 2) |
| Ruta nueva | Carpeta conocida + nombre extraído por código (entre comillas, o «llamada X»). Si no se puede extraer, el generativo genera solo el nombre |
| Enum y booleanos (`mode`, `recursive`) | Del esquema: decisión `choice`/`noul`, o valor por defecto |
| Números, `offset`, `pid` | Código: siguiente tramo a leer, `pid` del hecho `process`, valores por defecto |
| Texto que ya existe (`old_string` de una edición) | El código ofrece las líneas del archivo ya leído que contienen los literales de la instrucción, y la decisión elige |
| Texto nuevo (contenido, `new_string`, consulta) | Generativo, **solo ese campo** |

  - Ejemplo con `edit_file`: «cambiá el puerto 3000 por 8080 en config.json» → `path` por candidato, `old_string` la línea que contiene «3000», el número de reemplazos esperados lo cuenta el código, y `new_string` es esa línea con «8080». Cero llamadas generativas.
  - Cuando sí hace falta generativo, recibe los campos ya fijados y escribe solo lo que falta: salida más corta y sin poder inventar la ruta.
  - **Generativo como reintento:** p. ej. en `web_search` el primer intento usa la instrucción como consulta; solo si D4 rechaza el resultado, el generativo reformula.
  - **Incremental:** lo que no declare métodos de relleno sigue usando el generativo como hoy. Empezar por las 8 a 10 herramientas más usadas.
- **Beneficio:** la llamada generativa más frecuente desaparece en la mayoría de las herramientas simples, y el generativo, cuando entra, es más rápido y más fiable.
- **Esfuerzo:** 🟡 a 🔴 (incremental) · **Sin código:** 🧪 para medir en las trazas qué proporción de los argumentos es de cada tipo
- **Estado:** [ ] medir tipos de argumento por herramienta · [ ] piloto con `edit_file`
- **Revisión:** ⚠️ misma lectura que el punto 2: vale por fiabilidad. Es el cambio más grande de la lista y el de menor retorno en latencia; no lo haría antes de N1 a N5. Dos reparos: (a) en las trazas casi todas las llamadas son `run_command` y `web_search`, cuyo argumento es texto libre, así que la cobertura real del relleno declarado puede ser baja: medir E13 antes de diseñar nada; (b) «`web_search` usa la instrucción como consulta en el primer intento» es barato de probar en el laboratorio y, si funciona, saca una llamada generativa y un cambio de modelo de la tarea más frecuente.

### 3. Recetas para los comandos de terminal más frecuentes
- **Qué:** un catálogo corto (10 a 15) de recetas parametrizadas para lo que hoy se resuelve con PowerShell libre (listar y buscar archivos, tamaño de carpeta, procesos, información del sistema, red, abrir app o URL, crear carpeta, copiar y mover). La decisión elige la receta, el código llena los huecos (puntos 2 y 2b) y renderiza el comando. Cada receta declara si es lectura o escritura. `run_command` libre queda como último recurso.
- **Por qué:** un 4B escribiendo PowerShell es la mayor fuente de fallos, y la seguridad depende de parsear comandos (`commandRules`, `readOnly`, sintaxis), con límites que la propia documentación admite (concatenación, tuberías, variables). Una receta no necesita parseo, y su clasificación lectura/escritura es exacta.
- **Beneficio:** menos fallos de argumentos, menos revisiones y menos confirmaciones (las recetas de lectura nunca piden aprobación), y se apoya en el punto de extensión que ya existe (una línea en el catálogo, `ToolHost`).
- **Elegir cuáles:** por frecuencia real en las trazas.
- **Esfuerzo:** 🟡 a 🔴 (incremental, una receta por vez) · **Sin código:** 🧪 para medir qué % de los comandos de las trazas cubren las N recetas más frecuentes
- **Estado:** [ ] medir cobertura · [ ] primera receta piloto
- **Revisión:** ✅ válida. Las trazas la respaldan: «los N procesos que más RAM consumen» aparece 4 veces en 35 trazas y «abrí la calculadora» terminó en `Start-Process calc`, tratado como escritura con confirmación (12,7 s de espera). Una receta «abrir aplicación» y otra «procesos por memoria» cubren esos casos, sin PowerShell libre y sin pregunta. Además `docs/limitaciones/d3-2b.md` muestra que D1 manda a `files` pedidos que necesitan terminal («los 5 archivos más grandes»): una receta con descripción propia le da a D2 una opción que hoy no existe.

### 4. Respuesta final sin generativo cuando no hace falta redactar
- **Qué:** si la tarea terminó `completed` y todas sus llamadas son escrituras (crear carpeta, mover archivo), la respuesta se arma por código con una plantilla por herramienta («Listo: creé la carpeta X»). El generativo solo redacta cuando hay contenido que interpretar (lecturas, búsquedas) o la tarea no terminó bien.
- **Cómo funciona:** cada herramienta o receta declara una frase de «hecho» y el código arma la respuesta con los efectos de la tarea:
  - `create_directory` → «Listo: creé la carpeta {path}.»
  - `move_file` → «Listo: moví {source} a {destination}.»
  - Varias acciones se unen en orden: «Listo: creé Proyectos y moví notas.txt dentro.»
  - Se usa solo con `completed` y todas las llamadas aprobadas siendo escrituras. En cualquier otro caso redacta el generativo, como hoy.
- **Por qué:** hoy todo cierre salvo `cancelled` llama al generativo, aunque el fallback sin modelo y el encabezado por código (`renderStatusNote`) ya existen. Es la última llamada que el usuario espera. Además, la respuesta por plantilla sale de los efectos reales y no puede afirmar algo falso (hoy el prompt final debe advertir, por ejemplo, que `read`/`write` es el tipo de la herramienta, no lo que hizo).
- **Segunda fase (opcional):** mostrar directo los listados simples usando lo que ya condensan los extractores.
- **Beneficio:** las tareas de acción terminan sin llamada generativa final; sumado a los puntos 1 a 3, una tarea simple puede resolverse sin ninguna.
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 para medir qué % de tareas completadas son solo escrituras
- **Estado:** [ ] medir · [ ] plantillas por herramienta
- **Revisión:** ✅ válida y sube de prioridad: `final` es la única llamada generativa cara por sí misma (p50 1,75 s). Pero el alcance es chico: en las trazas casi todas las tareas completadas son lecturas o búsquedas, donde hay que redactar. Por eso se complementa con N6 (mostrar la respuesta mientras se genera), que cubre el resto. La plantilla resuelve además un defecto visto: en 5 de 28 respuestas el modelo contestó en inglés a un pedido en español (N8).

### 5. Aprobación escalonada por riesgo (en lugar de `autoMode` binario)
- **Qué:** hoy o se pregunta al usuario en toda escritura del catálogo (`autoMode` apagado) o no se pregunta nunca y la última barrera es D3, un 2B (`autoMode` encendido). Propuesta de tres niveles decididos por código:
  - **Verde** (reversible y sin sobrescribir: crear una carpeta o archivo nuevo en carpetas del usuario, abrir apps): sin confirmación.
  - **Amarillo:** D3, con umbral estricto.
  - **Rojo** (borrar, sobrescribir, rutas sensibles, reglas `sensitive`): siempre confirma el humano, nunca solo D3.
- **Qué cambia respecto a hoy:** con `autoMode` apagado se pregunta en casi toda escritura del catálogo; con `autoMode` encendido no se pregunta nunca y D3 decide solo, incluso en reglas `sensitive` (Defender, firewall, tareas programadas). Solo las rutas sensibles y la salida de datos con claves (`egress.ts`) piden confirmación siempre. Con la propuesta, el ajuste del usuario pasa de un booleano a un **nivel de autonomía**, y el código decide el nivel de cada llamada. No requiere modelos nuevos.
- **Por qué:** la espera de confirmación es el mayor tiempo muerto de una tarea y no depende de ningún modelo, y con `autoMode` encendido un 2B decide cosas que debería decidir una regla o el usuario.
- **Beneficio:** menos preguntas triviales (más velocidad y autonomía) y más protección donde importa.
- **A verificar en el código:** cuánta información tiene Guard para clasificar (por ejemplo, si el destino ya existe).
- **Esfuerzo:** 🟡 · **Sin código:** 🧪 para contar en las trazas cuántas confirmaciones por tarea eran «verdes»
- **Estado:** [ ] medir · [ ] definir niveles
- **Revisión:** ✅ válida y de las más rentables: una sola confirmación (12,7 s en «abrí la calculadora») pesa más que todos los modelos de la tarea juntos, y 21 de 116 tareas terminaron canceladas por el usuario. Dos agregados:
  - **Lista de permitidos del usuario**, simétrica a `blacklist`: al aprobar, ofrecer «aprobar siempre este comando». La próxima vez no se pregunta. Es código y configuración, sin modelos.
  - **No volver a preguntar lo mismo:** en esa traza el usuario rechazó `Start-Process calc`, el modelo generó los mismos argumentos y se le preguntó de nuevo. Tras un rechazo sin instrucción, una llamada idéntica debería fallar el paso o pedir qué cambiar, no repetir la confirmación (ver N4).

### 6. Pistas deterministas para recuperarse de fallos
- **Qué:** cuando una llamada falla por algo que el código puede diagnosticar, agregar una pista calculada a `LAST ERROR`/`FAIL`: ruta inexistente → entradas más parecidas del directorio padre; comando inexistente → comandos parecidos (hoy el pre-chequeo ya sabe que no existe); búsqueda sin resultados → alternativa de ampliar.
- **Por qué:** un 4B corrige mal a ciegas. Cada paso fallido arrastra una escalación (llamada generativa de pendientes más un paso nuevo) y, si se repite, un cierre `partial`.
- **Beneficio:** menos reintentos, menos escalaciones y menos cierres parciales.
- **Esfuerzo:** 🟢 a 🟡 · **Sin código:** 🔧
- **Estado:** [ ]
- **Revisión:** ✅ válida, y los datos piden ir más lejos: el estado no exitoso más frecuente no es un error de herramienta sino `loop_blocked` (72, contra 6 `tool_error`). El modelo no necesita solo una pista: vuelve a generar exactamente lo mismo. Eso se corta por código (N4).

### 7. Runtime de los modelos: arranque, caché y salida estructurada (a verificar)
- **Qué:** la documentación no lo menciona, así que primero hay que confirmarlo en el código:
  - Calentar ambos modelos al arrancar y evitar que se descarguen (`keep_alive`). El servidor ya precalienta los servidores MCP por la misma razón.
  - Salida estructurada conforme al esquema de la herramienta (reduce reintentos por salida inválida).
  - Ordenar los prompts con lo estable al principio y lo variable al final, para reutilizar la caché de prefijo (la fecha, que cambia, no debería quedar al comienzo).
- **Por qué:** la primera llamada tras un reposo puede cargar el modelo (un timeout hoy se registra como servicio no disponible y cierra la tarea).
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 mayormente configuración y medición (arranque en frío vs caliente)
- **Estado:** [x] verificado en el código y medido
- **Revisión:** ✅ confirmada, y es lo más importante del documento. Se desarrolla en N1 a N3. Resultado por sub-punto:
  - **Calentamiento:** no existe (solo MCP). Arranque en frío medido: 7,3 s + 5 s. → N2.
  - **Salida estructurada:** ya se usa. `pending` y el plan van con `json_schema`; `args` va con `json_object` porque el esquema es dinámico. Se puede probar pasar el esquema de la herramienta como `json_schema` también en `args`.
  - **Orden del prompt para la caché:** la caché funciona pero ahorra unos 100 ms, y como las etapas se intercalan (cada una con su SYSTEM) casi nunca hay prefijo común. ❌ No vale el esfuerzo.
  - **Lo que la idea no vio:** la penalización por alternar modelos (N1) y el contexto real distinto del configurado (N3).

### 8. Calibrar y aprovechar el margen de las decisiones
- **Qué:**
  - Calibrar con trazas los umbrales (0,6 / 0,65 / 0,75), por pregunta y herramienta. La documentación no dice cómo se eligieron.
  - Con 30 a 60 ms hay margen para **gastar más decisión donde hoy hay riesgo**: probar un decisor más grande para D3 y D4, o varias preguntas `noul` específicas por decisión, o exigir acuerdo entre dos formulaciones en escrituras sensibles. Sigue siendo mucho más barato que una llamada generativa.
  - Registrar márgenes en la traza para ver dónde D1 y D2 dudan.
- **Usos concretos del margen:**
  - **Dividir D3 en preguntas específicas.** Hoy es una sola elección (`approved` / `args_invalid` / `info_missing`). Mejor varias `noul`, como D4 con `VERIFY_CHECKS`: «¿la ruta es la que pidió el usuario?», «¿el contenido corresponde a lo pedido?», «¿sobrescribe algo no mencionado?». Los modelos chicos responden mejor a preguntas específicas que a una amplia, y cuatro preguntas cuestan menos de 0,2 s.
  - **Acuerdo en escrituras sensibles:** preguntar con dos formulaciones o con el orden de las opciones barajado (reduce el sesgo de posición). Si discrepan, se pregunta al usuario, no al generativo.
  - **Decisor más grande para D3 y D4:** si el 2B tarda 40 ms, uno mayor que tarde 150 ms sigue siendo mucho más barato que Qwen.
  - **Margen como señal:** si D2 duda entre dos herramientas en una escritura, preguntar al usuario «¿X o Y?» con una plantilla armada por código.
  - **Preguntas al usuario sin generativo:** cuando falta información, la decisión elige qué argumento falta y una plantilla arma la pregunta («¿Qué archivo querés editar?»). Hoy la redacta el generativo.
- **Beneficio:** más fiabilidad en la barrera de `autoMode` sin pagar latencia generativa.
- **Esfuerzo:** 🟢 a 🟡 · **Sin código:** 🧪
- **Estado:** [ ] calibrar · [ ] probar decisor mayor para D3/D4
- **Revisión:** ⚠️ parte válida, parte a corregir.
  - ❌ **Decisor más grande:** va en contra de lo medido. La GPU ya está al límite y cada GB extra agrava la penalización de cambio (N1). La dirección a probar es la contraria: un `d3:2b` más liviano.
  - ⚠️ **Dividir D3 en varias `noul`:** ya hay evidencia en contra para D1 y D2 (`docs/limitaciones/d3-2b.md`): una `noul` por opción fue peor (20/22 contra 22/22) y 3 veces más lenta. Para D3 no está medido; vale el experimento E14, sin darlo por ganado.
  - ⚠️ **Más preguntas a D4:** D4 ya es el punto débil (sigue un `Expected` malo, confunde copiar con mover, rechaza movimientos correctos). Antes que más preguntas al 2B, sacar del modelo lo que el código puede comprobar (N5).
  - ✅ Calibrar umbrales, registrar márgenes y armar por plantilla las preguntas al usuario: válidas.

### 9. Menores
- **Contexto:** con 16k y efectos que nunca se recortan (reserva de 12 000 caracteres), una tarea larga cierra `unrecoverable`. Compactar efectos viejos a una línea (herramienta, argumentos, estado, ref) conservando la invariante de no ocultar efectos. 🟡
- **Timeouts:** distinguir timeout de caída (limitación ya documentada) y no cerrar la tarea por un único timeout transitorio. 🟢
- **Lista tras un fallo:** pedir al modelo solo el ítem reescrito (salida más corta); el código ya conserva el resto con `reconcileList`. 🟢
- **Constantes duras** (20 pasos, 6 llamadas por paso, 10 intentos, etc.): revisarlas con datos de las trazas. 🧪
- **Documentación:** `ARCHITECTURE.md` (§3 y §6) habla de cuatro decisiones y `CORE_FLOW.md` describe una quinta (D5). Actualizar.
- **Revisión:** ✅ válidos, con una corrección en **Contexto**: no son 16k sino 8 192 tokens reales en el generativo y 4 096 en el decisor (N3). La reserva de efectos (12 000 caracteres, unos 4 000 tokens) ocupa entonces la mitad del contexto real, no un cuarto. El experimento E10 (16k contra 32k) pierde sentido: subir el contexto consume más VRAM y empeora N1. Lo medido (prompt máximo de 1 497 tokens) dice que 8 192 alcanza para las tareas actuales.

## Ideas nuevas (segunda revisión)

Ordenadas por retorno esperado. Las tres primeras son de configuración o de muy poco código y explican la mayor parte de la latencia medida.

### N1. Que los dos modelos entren en la VRAM con margen
- **Qué:** hoy `qwen3.5:4b` (3,36 GB) + `d3:2b` en Q8 (3,08 GB) + el escritorio (1,7 GB) llenan los 8 GB, y cada cambio de modelo cuesta cerca de 1 s. Opciones, de menor a mayor esfuerzo:
  1. Probar `d3:2b` en una cuantización más liviana (Q4_K_M ocuparía cerca de la mitad) y medir su precisión en el laboratorio contra la Q8.
  2. Liberar VRAM ajena mientras JARVIS corre (superposición de NVIDIA, apps con aceleración) y comprobar si el servidor de voz usa la GPU.
  3. Mantener los contextos en el mínimo necesario (N3): más contexto es más VRAM.
- **Evidencia:** con un segundo modelo de 1,64 GB en GPU la alternancia no cuesta nada (generativo 170 a 200 ms, el otro 21 a 29 ms). Con `d3:2b-cpu` el decisor tarda 2,1 s: la CPU no es salida.
- **Beneficio:** unos 4 s menos en una tarea de una acción (de 7 a 10 s), sin tocar el flujo. Es la mejora más grande disponible.
- **Riesgo:** que la cuantización liviana pierda precisión en D3 y D4, que ya están justos. Por eso se mide antes (E15).
- **Mientras no se resuelva:** cada cambio de modelo evitado vale 1 s. Eso le da valor extra a las ideas que sacan una llamada generativa de en medio de dos decisiones (1, N7, 4).
- **Esfuerzo:** 🟢 · **Sin código:** 🧪
- **Estado:** [x] causa confirmada · [ ] E15: `d3:2b` liviano, precisión y latencia

### N2. Modelos siempre calientes
- **Qué:** una consulta mínima a cada modelo al arrancar el servidor (junto al precalentado de MCP que ya existe) y `keep_alive` largo o permanente, por petición o en la configuración de Ollama. Segundo paso: calentar cuando el usuario empieza a escribir o a hablar, si se prefiere no retener la VRAM siempre.
- **Evidencia:** arranque en frío de 7,3 s (generativo) y 5 s (decisión). Ollama descarga a los 5 minutos: la primera tarea tras una pausa paga unos 12 s. En las trazas, `pending` p90 4,5 s y `route` p90 3,7 s.
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 (variable `OLLAMA_KEEP_ALIVE`); 🔧 mínimo para el calentamiento al arrancar
- **Estado:** [ ]

### N3. Alinear el contexto configurado con el real
- **Qué:** `qwenNumCtx` y `decisionMaxContext` dicen 16 384; Ollama usa 8 192 y 4 096. La propia documentación exige que coincidan. Lo barato es bajar la configuración a los valores reales; subir el contexto real cuesta VRAM (N1).
- **Por qué:** la guarda de contexto hoy no protege. Un prompt que supere el contexto real se recorta en silencio y puede perder el SYSTEM (lo advierte el comentario de `qwen.ts`). `verify` ya llegó a 2 721 tokens de 4 096, y lleva las llamadas previas completas.
- **Esfuerzo:** 🟢 · **Sin código:** 🧪
- **Estado:** [x] desajuste confirmado · [ ] corregir configuración

### N4. Cortar por código las repeticiones que el modelo no corrige
- **Qué:** tres cortes deterministas, todos con datos que el motor ya tiene:
  1. **Misma huella tras un bloqueo:** si el generador devuelve los mismos argumentos que acaban de bloquearse, no gastar otra vuelta de D1 y D2. Fallar el paso en ese momento, o dejar de ofrecer esa herramienta en el paso.
  2. **Ítem reescrito idéntico:** si tras un fallo `pending` devuelve el mismo texto del ítem que falló, no hay información nueva. Tratarlo como abandonado en lugar de correr otro paso igual.
  3. **Mismos argumentos tras un rechazo del usuario sin instrucción:** no volver a pedir la misma confirmación.
- **Evidencia:** `loop_blocked` es el segundo estado más frecuente (72 de 295 llamadas). En la traza de «Get-ChildItem C:\Windows…» el modelo generó 6 veces seguidas `list_directory {depth: 2}`, a lo largo de 3 pasos con la misma instrucción: 30 consultas y 28,7 s para una tarea que estaba perdida desde la segunda llamada.
- **Beneficio:** las tareas que van a fallar fallan en 5 s en lugar de 30, y el usuario recibe antes la pregunta o el aviso.
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 para contar en las trazas cuántas consultas se gastan después del primer bloqueo; 🔧 para integrarlo
- **Estado:** [ ]

### N5. Verificación por código antes que D4
- **Qué:** el criterio del documento (código, después decisión) aplicado a la verificación:
  - La pregunta `ok` la responde el código cuando el estado ya es concluyente (`ok` con código de salida 0, o `no_data`).
  - Las escrituras del catálogo llevan una **poscondición** que el código comprueba en el disco: `create_directory` → la carpeta existe; `move_file` → el origen ya no está y el destino sí; `write_file` → el archivo existe y tiene el tamaño esperado.
  - D4 queda para lo que el código no puede saber: si lo leído responde a lo pedido (`cumple` en lecturas y búsquedas).
- **Evidencia** (`docs/limitaciones/d3-2b.md`): D4 aprueba una copia donde se pidió mover (`cumple` 0,97 a 0,99), rechaza movimientos correctos (`ok` 0,51 con `Move-Item` y `Test-Path`) y sigue un `Expected` mal escrito (3/18). Las tres fallas son sobre hechos comprobables en el disco.
- **Beneficio:** menos rechazos falsos (cada uno es una vuelta completa de modelos), menos aprobaciones falsas en escrituras, y una barrera real para `autoMode`, donde hoy D4 llega tarde y no deshace nada.
- **Esfuerzo:** 🟡 · **Sin código:** 🧪 con los datasets `verify_copy_move` y `d4_verify`: cuántos casos decide el código solo
- **Estado:** [ ]

### N6. Mostrar la respuesta final mientras se genera
- **Qué:** la respuesta final se pide con `stream: false` y el usuario ve todo junto tras 1,2 a 2,5 s. Con streaming hacia el canal SSE que ya existe, el primer texto aparece en menos de 200 ms. En voz, sintetizar por oración a medida que llega.
- **Por qué:** es la única llamada generativa cara por sí misma y no se puede sacar cuando hay algo que redactar (lecturas y búsquedas, la mayoría de las tareas reales). No baja el tiempo total, baja la espera percibida. El estado terminal ya se escribe antes de la respuesta, así que no cambia ninguna invariante.
- **Esfuerzo:** 🟡 · **Sin código:** 🔧
- **Estado:** [ ]

### N7. Literal de la solicitud directo al argumento
- **Qué:** cuando la solicitud trae el valor exacto (un comando tras «ejecutá en la terminal:», una ruta completa, una URL), el código lo copia tal cual al argumento. Es el primer piloto natural de los puntos 2 y 2b.
- **Evidencia:** «ejecutá en la terminal: Write-Output hola» se ejecutó como `echo hola`. Acá no cambió el resultado; con `robocopy` o `ren` (los casos de `route_terminal_explicit`) sí importa. `docs/limitaciones/qwen-3.5-4b.md` muestra que `pending` además cambia de idioma con comandos en inglés.
- **Beneficio:** el comando que corre es el que escribió el usuario, sin `pending` ni `args` generativos (dos llamadas y dos cambios de modelo menos). Guard, lista negra y pre-chequeo corren igual.
- **Esfuerzo:** 🟢 a 🟡 · **Sin código:** 🧪 para medir sobre `route_terminal_explicit` qué porcentaje se extrae con una regla
- **Estado:** [ ]

### N8. Idioma y relleno de la respuesta final, por código
- **Qué:** el código detecta el idioma de la solicitud y lo fija en el prompt («Answer in Spanish») en vez de la regla «in the language of REQUEST». Y quita por código la frase de relleno cuando no hubo efectos.
- **Evidencia:** 5 de 28 respuestas finales salieron en inglés ante pedidos en español («The calculator application has been launched successfully…»), y dos empiezan con «No changes were made to the system».
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 (laboratorio, etapa `final`)
- **Estado:** [ ]

### N9. Progreso visible por código durante las esperas largas
- **Qué:** cuando una herramienta tarda (`web_search`: 6 a 16 s), emitir por el canal de eventos una línea armada por código («Buscando: …», «Leyendo 3 páginas…») con los datos que el proveedor ya tiene.
- **Por qué:** en las tareas web el tiempo es de la herramienta, no de los modelos; no se puede bajar desde el coordinador, pero sí hacer que la espera se entienda. Es probable que parte de las 21 cancelaciones venga de no saber si avanza (a confirmar mirando en qué etapa se cancelaron).
- **Esfuerzo:** 🟢 · **Sin código:** 🧪 para ver en las trazas en qué etapa se cancela; 🔧 para integrarlo
- **Estado:** [ ]

## Mejoras futuras (agregar capacidades)

Ideas que suman capacidades nuevas; no son prioridad frente a lo anterior.

1. **Delegación a agentes especializados:** un destino `agent` en el catálogo. JARVIS solo decide a quién delegar (D1), entrega un encargo acotado y recibe el resultado como ref; el progreso llega por eventos, con el mismo Guard y aprobaciones. Incluye, si hace falta, escalar a un modelo de frontera ante las señales de fracaso que ya existen (`replans_exhausted`, `review_rejected`, `not_accomplished` ×2, tercera escalación). Extender `egress.ts` a todo lo que salga hacia la nube.
2. **Memoria entre tareas:** hoy cada tarea nace de cero y el backend nunca lee la traza. Sin romper el principio: un archivo de playbooks y hechos del usuario en config, generado fuera de línea desde trazas aprobadas o confirmado por el usuario. Usos: ejemplos para generar argumentos, y atajos que se ejecutan sin generativo tras N éxitos. Habilita continuidad («abrí lo de ayer»).
3. **Contexto vivo de la PC, inyectado por código:** ventana activa, portapapeles, carpeta de trabajo, archivos recientes, apps abiertas. Resuelve «este archivo» sin llamada generativa.
4. **Aprobaciones y respuestas en lenguaje natural** (Telegram y voz), clasificadas por el modelo de decisión (`aprobar` / `rechazar` / `modificar`).
5. **Modelo generativo distinto por etapa** (argumentos, plan, respuesta final).
6. **Lecturas independientes en paralelo** dentro de una tarea larga.
7. **Deshacer:** copia de seguridad antes de sobrescribir y papelera en lugar de borrar. Reduce el riesgo de `autoMode`.
8. **Herramientas nuevas** (apps, ventanas, portapapeles, calendario…): cada una es una línea en el catálogo.
9. **Tareas programadas o recurrentes** y avisos proactivos.
10. **Reanudar tareas tras reiniciar** (existe el snapshot `v1` pero no la restauración) y una cola con prioridad cuando Telegram, voz y la interfaz compiten por los mismos modelos.
11. **Afinar el modelo de decisión** con trazas etiquetadas (por un modelo mayor o por correcciones del usuario).

## Decisiones de diseño (opinión)

### LangChain / LangGraph: no para el núcleo
- **Qué aportarían:** grafo de estados, interrupciones para intervención humana, checkpoints y streaming. JARVIS ya tiene todo eso, hecho a medida y con garantías que un framework no da: `apply` atómico, estado terminal cerrado, Guard antes de todo despacho, saneamiento de prompts y traza.
- **Por qué no:** LangChain asume que un LLM elige herramientas, y JARVIS lo invierte (un clasificador por logits decide, el generativo solo genera). La complejidad real del código viene de las políticas que compensan a los modelos chicos (anti-bucle, topes, estados de llamada), no de la plomería de orquestación, y un framework no las elimina. Además el stack es TypeScript y las versiones JS suelen ir detrás de las de Python.
- **Dónde sí podría servir:** dentro de un agente especializado futuro, como caja negra detrás del catálogo.
- **Estado:** descartado para el núcleo.

### No agregar un tercer flujo
El atajo D0 (punto 1) logra lo mismo que un flujo «Directo» sin sumar una estrategia: es el reactivo con la lista ya resuelta por código.

## Experimentos (sin tocar código)

Mismo conjunto de tareas, una variable por vez. Medir: éxito, latencia total y por fase, llamadas generativas y de decisión, cierres `unrecoverable`.

| # | Experimento | Qué responde |
|---|---|---|
| E1 | Línea base desde trazas: latencia por etapa y llamadas por tarea | Dónde se va el tiempo realmente |
| E2 | Distribución de pasos por tarea y % `chat`/`single`/`multi` | Valor del atajo D0 |
| E3 | Precisión de D0 offline contra pasos realmente usados | Umbral seguro para `single` y `chat` |
| E4 | Slot-filling: reproducir lecturas pasadas con candidatos por código | ¿La decisión elige el argumento real? |
| E5 | Cobertura de recetas sobre los comandos de `run_command` | Cuáles construir primero |
| E6 | % de tareas completadas con solo escrituras | Alcance de la plantilla final |
| E7 | Decisor mayor para D3 y D4: precisión vs latencia | Si el margen de decisión alcanza para un modelo más grande |
| E8 | Generativo más chico para argumentos y pendientes | Hasta dónde se puede bajar sin perder éxito |
| E9 | Calibración de umbrales y distribución de márgenes | Mejores umbrales por pregunta y herramienta |
| E10 | Contexto 16k vs 32k y tasa de `unrecoverable` | Cuántos cierres por contexto desaparecen y su costo |
| E11 | Arranque en frío vs caliente, y salida estructurada activada o no | Peso de la carga del modelo y de los reintentos por salida inválida |
| E12 | Confirmaciones al usuario por tarea y cuántas serían «verdes» | Valor de la aprobación escalonada |
| E13 | Tipo de cada argumento por herramienta en las trazas (ruta existente, nueva, enum, número, texto) | Qué parte del relleno de argumentos se puede sacar del generativo |
| E14 | D3 dividido en preguntas `noul` específicas vs una sola elección | Si mejora la precisión sin costo apreciable de latencia |
| E15 | `d3:2b` en cuantización liviana contra Q8: precisión en D1 a D5 (laboratorio) y latencia alternando con Qwen | Si N1 se resuelve solo con configuración |
| E16 | Repetir la prueba de alternancia con `keep_alive` permanente y tras 10 minutos sin uso | Que N2 elimina el arranque en frío |
| E17 | Consultas gastadas después del primer `loop_blocked` de cada paso, en todas las trazas | Ahorro de N4 |
| E18 | Casos de `verify_copy_move` y `d4_verify` que una poscondición por código decide sola | Alcance de N5 |
| E19 | `web_search` con la instrucción como consulta contra la consulta generada | Si se puede sacar `args` de la tarea más frecuente |
| E20 | Etapa en la que se cancelaron las 21 tareas `cancelled` | Si las cancelaciones son por espera (N9) o por confirmaciones (5) |

**Estado de los experimentos:** E1 hecho (ver «Mediciones reales»). E2 hecho en parte (distribución de pasos en la revisión del punto 1). E10 descartado (ver revisión del punto 9). E11 hecho en la parte de arranque en frío. E7 pierde prioridad: un decisor mayor agrava N1.

## Registro de notas

> Anotar acá ideas nuevas, resultados de experimentos y decisiones. Formato sugerido: fecha · idea o experimento · resultado · decisión.

- 2026-11-13 · E1, línea base desde 35 trazas · la decisión tarda 37 ms tras otra decisión y 570 ms (p50) tras una generativa; tarea de una llamada: mediana 10,7 s · la latencia la explica la alternancia de modelos, no la cantidad de llamadas generativas.
- 2026-11-13 · Prueba de alternancia contra Ollama (consultas reales de una traza) · unos 1 000 ms por cambio con Qwen + `d3:2b` Q8 en GPU (7,9 de 8,2 GB); 0 ms de penalización con un segundo modelo de 1,64 GB; decisor en CPU: 2,1 s por consulta · causa: VRAM al límite. Decisión propuesta: probar `d3:2b` liviano (E15). La CPU queda descartada.
- 2026-11-13 · Arranque en frío · 7,3 s el generativo y 5 s la decisión; sin modelos cargados tras 5 minutos · decisión propuesta: calentar al arrancar y `keep_alive` largo (N2).
- 2026-11-13 · Contexto real · Ollama carga 8 192 (Qwen) y 4 096 (`d3:2b`); la configuración dice 16 384 · decisión propuesta: alinear la configuración (N3).
- 2026-11-13 · Caché de prefijo · funciona (760 de 764 tokens), ahorra unos 100 ms · reordenar prompts para la caché queda descartado.
- 2026-11-13 · Índice de 116 tareas · 72 `loop_blocked` y 46 `args_invalid` contra 6 `tool_error`; 21 canceladas · el modelo repite más de lo que la herramienta falla (N4).
- **Límites de estas mediciones:** una sola máquina y una sola sesión; las 35 trazas con detalle son sobre todo búsquedas web y comandos de terminal, con pocas escrituras de archivos; el modelo sustituto de la prueba de VRAM no es `d3:2b` (prueba que el problema es el espacio, no que un `d3:2b` liviano mantenga la precisión).

## Resumen final

### Orden recomendado tras la segunda revisión

| # | Idea | Qué ataca | Ganancia estimada | Esfuerzo |
|---|---|---|---|---|
| 1 | N1: los dos modelos con margen en la VRAM | 1 s por cambio de modelo | Unos 4 s por tarea de una acción | 🟢 🧪 |
| 2 | N2: modelos siempre calientes | Arranque en frío | Unos 12 s en la primera tarea tras una pausa | 🟢 |
| 3 | N3: contexto configurado = contexto real | Recorte silencioso del prompt | Corrección, no velocidad | 🟢 🧪 |
| 4 | 5: aprobación por niveles y lista de permitidos | Espera del usuario | 5 a 13 s por confirmación evitada | 🟡 |
| 5 | N4 y 6: cortar repeticiones y dar pistas | Tareas perdidas que siguen girando | De unos 30 s a unos 5 s en esos casos | 🟢 |
| 6 | N5: verificación por código antes que D4 | Rechazos y aprobaciones falsas | Una vuelta de modelos por rechazo falso | 🟡 |
| 7 | N6 y 4: respuesta final en streaming o por plantilla | La única generativa cara | 1,2 a 2,5 s percibidos | 🟡 / 🟢 |
| 8 | N7 y 3: literal directo y recetas | PowerShell reescrito por el 4B | Fiabilidad; 2 llamadas menos en N7 | 🟢 a 🔴 |
| 9 | 1: atajo D0, con `chat` restringido | `pending` en tareas simples | Unos 250 ms y fidelidad | 🟡 |
| 10 | 2 y 2b: argumentos por candidatos | `args_invalid` | Fiabilidad; unos 200 ms por llamada | 🟡 a 🔴 |
| 11 | N8, N9 y menores | Idioma, progreso, topes | Calidad percibida | 🟢 |

Descartadas o en pausa: reordenar prompts para la caché (ahorra unos 100 ms), decisor más grande (agrava N1), subir el contexto a 32k (ídem).

### Mejoras sobre lo actual (lista original)
1. Medir primero: llamadas, latencia por etapa y márgenes de decisión.
2. Decisión D0 al inicio (`chat` / `single` / `multi`): salta la lista de pendientes generativa.
3. Argumentos por candidatos del código y elección por decisión.
4. Relleno declarado de todos los argumentos por herramienta: generativo solo para texto nuevo y como reintento.
5. Recetas parametrizadas para los comandos de terminal frecuentes.
6. Respuesta final por plantilla cuando la tarea fue solo escrituras.
7. Aprobación escalonada por riesgo (verde / amarillo / rojo) con nivel de autonomía en lugar de `autoMode` binario.
8. Pistas deterministas de recuperación (rutas, comandos parecidos).
9. Calentamiento de modelos, salida estructurada y orden de prompt para caché (a verificar).
10. Calibrar umbrales y usar el margen de la decisión: D3 en preguntas específicas, acuerdo en escrituras sensibles, decisor mayor, preguntas al usuario por plantilla.
11. Menores: compactar contexto, distinguir timeouts, reescribir solo el ítem fallido, revisar constantes y actualizar la documentación.

### Mejoras futuras
1. Delegación a agentes especializados y escalada a modelos de frontera.
2. Memoria entre tareas (playbooks y hechos del usuario).
3. Contexto vivo de la PC.
4. Aprobaciones y respuestas en lenguaje natural.
5. Modelo generativo por etapa.
6. Lecturas en paralelo.
7. Deshacer (backup y papelera).
8. Herramientas nuevas.
9. Tareas programadas y avisos proactivos.
10. Reanudar tareas y cola con prioridad.
11. Afinar el modelo de decisión con trazas.

### Puntos débiles actuales
0. (Segunda revisión, medidos) La VRAM al límite hace que cada cambio de modelo cueste cerca de 1 s; los modelos arrancan en frío tras 5 minutos; el contexto real (8 192 y 4 096) es menor que el configurado (16 384); el modelo repite llamadas bloqueadas (`loop_blocked` es el segundo estado más frecuente); D4 falla sobre hechos que el código puede comprobar.
1. Costo fijo por tarea: unas 3 llamadas generativas incluso para una acción simple.
2. El modelo chico escribe PowerShell libre; la seguridad depende de parsearlo.
3. `autoMode` binario: o se pregunta todo o la última barrera es un 2B.
4. Umbrales y topes sin calibración documentada.
5. Contexto de 16k con efectos no recortables: cierre brusco en tareas largas.
6. Un timeout se trata como caída y puede cerrar la tarea.
7. Sin recuperación guiada por código: el modelo corrige a ciegas tras un fallo.
8. Cada tarea empieza de cero, sin memoria ni continuidad.
9. Sin salida hacia modelos o agentes más capaces cuando la tarea excede al 4B.
10. Dependencia de Windows y PowerShell.
11. Documentación desactualizada (cuatro vs cinco decisiones).
12. Sin confirmar: arranque de modelos, salida estructurada y caché de prefijo.
