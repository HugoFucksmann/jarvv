# JARVIS — Plan de mejoras

> Documento consolidado (2026-11-13). Base: la documentación, 116 tareas de trazas (35 con detalle) y pruebas directas contra Ollama. No se editó código.

**Rol:** JARVIS es un agente root coordinador local. El usuario habla con él y él se mueve en la PC, ejecuta herramientas y, a futuro, llama a agentes especializados (fuera de este análisis).
**Criterio:** código determinista > modelo de decisión (30 a 60 ms) > modelo generativo (Qwen 4B, solo para texto libre).
**Alcance:** mejorar lo que JARVIS hace hoy. Lo que agrega capacidades va en «Mejoras futuras».
**Leyenda:** 🟢 pequeño · 🟡 medio · 🔴 mayor · 🧪 se prueba sin tocar código · 🔧 requiere código

## 1. Qué se midió

Entorno: Ollama 0.40.13, RTX 3070 Ti de 8 GB, `qwen3.5:4b` (Q4_K_M, 3,36 GB) y `d3:2b` (Q8_0, 3,08 GB).

| Hallazgo | Dato |
|---|---|
| Alternar entre los dos modelos cuesta ~1 s por cambio | VRAM al límite (7,9 de 8,2 GB). Una decisión tarda 37 ms tras otra decisión y 570 ms (p50) tras una llamada generativa. Una tarea de una acción hace 4 cambios |
| Arranque en frío | 7,3 s el generativo + 5 s el decisor. Ollama los descarga a los 5 minutos; no hay calentamiento de modelos ni `keep_alive` |
| Contexto desalineado | Configurado 16 384; real 8 192 (Qwen) y 4 096 (`d3:2b`). La guarda de contexto no protege: un prompt largo se recorta en silencio. `verify` llegó a 2 721 tokens |
| Costo propio del generativo | `pending` y `args`: 200 a 300 ms. `final`: 1,2 a 1,7 s (la única cara) |
| Tarea de una acción | Mediana 10,7 s, 7 consultas a modelos |
| Fallos (295 llamadas) | 72 `loop_blocked`, 46 `args_invalid`, 6 `tool_error`. De 116 tareas, 21 canceladas por el usuario |
| Esperas del usuario | Una confirmación («abrí la calculadora») tardó 12,7 s: más que todos los modelos juntos |
| Herramientas lentas | `web_search` tarda 6 a 16 s; ahí los modelos no son el cuello |
| D4 (verificación) | Falla en hechos que el código puede comprobar: aprueba una copia donde se pidió mover, rechaza movimientos correctos |
| Respuesta final | 5 de 28 salieron en inglés ante pedidos en español |

**Cómo leer las prioridades:** mientras la VRAM siga al límite (N1, en pausa), cada llamada generativa entre dos decisiones cuesta ~1,5 a 2 s. Si N1 se resuelve, baja a ~200 ms y esas mejoras valen sobre todo por fiabilidad. El laboratorio mide cada etapa con el mismo modelo seguido, así que sus latencias no representan producción.

**Límites de las mediciones:** una sola máquina y sesión; las 35 trazas con detalle son sobre todo búsquedas web y terminal; los casos de D0 (122) y de herramientas básicas (58) se etiquetaron a mano y los umbrales se ajustaron sobre el mismo conjunto; algunas de las 116 tareas (p. ej. ~25 de «procesos por memoria») pueden ser pruebas repetidas y no uso diverso (a confirmar).

## 2. Plan priorizado

### A. Rápido y barato (hacer primero)

| # | Mejora | Ganancia | Esfuerzo |
|---|---|---|---|
| A1 | **Modelos calientes:** consulta mínima a cada modelo al arrancar (como ya se hace con MCP) y `keep_alive` largo (`OLLAMA_KEEP_ALIVE`) | ~12 s en la primera tarea tras una pausa | 🟢 🧪🔧 |
| A2 | **Contexto configurado = real** (8 192 y 4 096) en `qwenNumCtx` y `decisionMaxContext` | Corrección: hoy la guarda de contexto no funciona | 🟢 🧪 |
| A3 | **Cortar por código las repeticiones** que el modelo no corrige (ver abajo) | Tareas perdidas: de ~30 s a ~5 s | 🟢 🔧 |
| A4 | **Idioma de la respuesta final fijado por código** («Answer in Spanish») y sin frase de relleno cuando no hubo efectos | Calidad percibida | 🟢 🧪 |
| A5 | **Entender las 21 cancelaciones** (¿en qué etapa?) y emitir progreso por código en esperas largas («Buscando: …») | Menos cancelaciones | 🟢 |

**A3, los tres cortes:**
1. Si el generador devuelve los mismos argumentos que acaban de bloquearse, fallar el paso o dejar de ofrecer esa herramienta, sin otra vuelta de D1 y D2.
2. Si tras un fallo `pending` devuelve el mismo ítem, tratarlo como abandonado.
3. Tras un rechazo del usuario sin instrucción, no repetir la misma confirmación.

Ejemplo real: 6 veces seguidas `list_directory {depth: 2}`, 30 consultas y 28,7 s para una tarea perdida desde la segunda llamada. A esto se suman **pistas calculadas por código** en `LAST ERROR` (ruta inexistente → entradas parecidas del directorio; comando inexistente → comandos parecidos).

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
- Resultado: 109/122 (89,3 %), 0 falsos `chat` en 189 casos de reserva. Un solo `choice` con tres opciones (70 a 78 %) y una `noul` «¿necesita herramientas?» (34 %) no funcionaron.
- **`chat` debe limitarse a saludos y preguntas sobre JARVIS.** Las preguntas de hechos van a búsqueda web: hoy «¿cuándo se estrena avengers doomsday?» se respondió sin buscar. Por eso el umbral de `chat` es 0,7.
- Una acción: el código crea la lista con la solicitud como único ítem, el paso corre igual y D5 cierra. Si D0 se equivoca y era «varias», D5 no cierra y se consulta `pending` como hoy (error barato).
- Efecto: charla 3 → 1 llamadas generativas; una acción 3 → 2. De las 116 tareas, 14 son charla y 61 de un paso. Además el paso recibe la solicitud literal, sin la reescritura de `pending` (que hoy convirtió «ejecutá: Write-Output hola» en `echo hola`).
- No es un flujo nuevo: son entradas distintas al reactivo.
- **Tarea larga:** se detecta por código, no por modelo. Una primera lista de 3 o más ítems es tarea larga (la decisión no las separa: 0,08 a 0,46). Sirve para avisar, mostrar la lista como plan o pedir confirmación según el nivel de autonomía.
- Pendiente: convertir los casos en dataset del laboratorio (`eval/datasets/d0/`) e integrar.

**B3, respuesta final.** Plantilla armada por código («Listo: creé la carpeta X») cuando la tarea terminó `completed` y todas sus llamadas son escrituras; no puede afirmar algo falso porque sale de los efectos reales. Con lecturas o búsquedas (la mayoría de las tareas reales) sigue redactando el generativo, pero con **streaming** por el canal SSE: el primer texto aparece en menos de 200 ms (en voz, sintetizar por oración). No cambia el tiempo total, sí la espera percibida.

**B4, herramientas básicas (T5).**
- Siete herramientas con descripción escrita una sola vez: `top_processes`, `system_info`, `disk_usage` (lecturas); `open_app`, `open_url` (acciones reversibles); `copy_file`, `delete_file` (escrituras; `delete_file` a la papelera y siempre con confirmación).
- Elección directa entre 18 herramientas: 55/58 (94,8 %). En dos etapas con una ruta nueva `system`: 50/58 (86,2 %), sin regresión relevante en los datasets de D1 (175/196 contra 178/196).
- Ganancia: argumentos de lista cerrada en lugar de PowerShell, sin confirmación ni D3 ni parseo de comandos para las lecturas, `open_app`/`open_url` en nivel verde, y resultado de formato fijo que habilita la plantilla de B3.
- Fallos vistos: pedidos sin herramienta básica («bajá https://…», «comprimí…») no siempre vuelven a `run_command`; servicios y puertos van a `list_processes` (conviene unificarla con `top_processes`); «abrí el bloc de notas» cae en `write_file`.
- Requisito: «ejecutá en la terminal: X» se resuelve por código antes de D2 (B2).
- **Falta medir:** generación de argumentos con Qwen y ejecución real.

**B5, argumentos.**
- **Por candidatos:** el código arma los candidatos (rutas y URLs de la solicitud, carpetas conocidas, resultados previos, refs), descarta los que no existen en el disco, y con uno solo no consulta a ningún modelo; con varios, la decisión (`choice`) elige. La lista debe ser corta (el decisor trabaja con 4 096 tokens).
- **Relleno declarado:** cada herramienta declara cómo se llena cada argumento: ruta existente → candidatos; ruta nueva → carpeta conocida + nombre por código; enum, booleano o número → esquema, valor por defecto o código; texto existente (`old_string`) → líneas candidatas del archivo ya leído; texto nuevo → generativo, solo ese campo; `web_search` → la instrucción como consulta primero, y el generativo reformula solo si D4 rechaza.
- Cautela: casi todas las llamadas reales son `run_command` y `web_search`, de texto libre, así que la cobertura puede ser baja. Medir E13 y E19 antes de diseñar.

### C. Menos esperas y más fiabilidad en la seguridad

| # | Mejora | Ganancia | Esfuerzo |
|---|---|---|---|
| C1 | **Aprobación por niveles** en lugar de `autoMode` binario | 5 a 13 s por confirmación evitada | 🟡 |
| C2 | **Verificación por código antes que D4** | Menos rechazos y aprobaciones falsas | 🟡 |
| C3 | **Calibrar las decisiones** | Fiabilidad | 🟢 🧪 |

**C1.** Hoy o se pregunta en casi toda escritura (`autoMode` apagado) o no se pregunta nunca y la última barrera es D3, un 2B. Propuesta, decidida por código: **verde** (lecturas, abrir apps o URLs, crear algo nuevo sin sobrescribir) sin confirmación; **amarillo** con D3 en umbral estricto o con pregunta según el nivel de autonomía; **rojo** (borrar, sobrescribir, rutas sensibles, reglas `sensitive`) siempre confirma el humano. Agregados: una **lista de permitidos** del usuario (al aprobar, «aprobar siempre este comando»), simétrica a `blacklist`; y no repetir la misma pregunta tras un rechazo (A3). A verificar: si Guard puede saber que el destino ya existe.

**C2.** La pregunta `ok` la responde el código cuando el estado ya es concluyente. Las escrituras llevan una **poscondición** comprobada en el disco (`create_directory` → la carpeta existe; `move_file` → el origen ya no está y el destino sí; `write_file` → existe con el tamaño esperado). D4 queda para lo que el código no puede saber: si lo leído responde a lo pedido (`cumple` en lecturas y búsquedas). Evidencia: D4 aprueba una copia donde se pidió mover (0,97 a 0,99), rechaza movimientos correctos y sigue un `Expected` mal escrito (3/18). Es además una barrera real para `autoMode`.

**C3.** Calibrar los umbrales (0,6 / 0,65 / 0,75) por pregunta y herramienta con las trazas, registrar los márgenes, y armar por plantilla las preguntas al usuario (la decisión elige qué argumento falta). Dividir D3 en varias `noul` no está probado: en D1 y D2 fue peor (20/22 contra 22/22) y 3 veces más lento; vale el experimento E14, sin darlo por ganado.

### D. VRAM al límite (N1, en pausa por decisión del usuario)

Es la mejora más grande disponible (~4 s por tarea de una acción), y con un segundo modelo de 1,64 GB la penalización desaparece. Opciones: probar `d3:2b` en una cuantización más liviana (Q4_K_M, cerca de la mitad) y medir su precisión (E15); liberar VRAM ajena (el escritorio usa ~1,7 GB); mantener los contextos en el mínimo (A2). Hipótesis, no verificada, para liberar espacio sin tocar la cuantización: limitar las ranuras paralelas (el decisor carga con 16 y T4 mostró que no ayudan) y probar KV cuantizada o flash attention. El decisor en CPU queda descartado (2,1 s por consulta).

## 3. Descartado

| Idea | Motivo |
|---|---|
| Reordenar prompts para la caché de prefijo | La caché funciona pero ahorra ~100 ms, y las etapas se intercalan |
| Decisor más grande | Agrava la VRAM (en esta GPU) |
| Subir el contexto a 32 k | Más VRAM; el máximo visto es 1 497 tokens en `args` |
| Fusionar D1 y D2 en una consulta | 87,8 % contra 90,8 % y ahorra solo ~32 ms (con las herramientas básicas conviene recomparar) |
| Paralelizar consultas de decisión | Unos 28 ms por pregunta sin importar cómo lleguen, también con `OLLAMA_NUM_PARALLEL=4` |
| Detectar tareas largas con el modelo | No las separa; se usa el largo de la lista |
| Más preguntas a D4 | Primero C2 |
| Decisor en CPU | 2,1 s por consulta |

## 4. Mejoras futuras (agregar capacidades)

1. **Delegación a agentes especializados:** destino `agent` en el catálogo (JARVIS decide a quién delegar, entrega un encargo acotado y recibe el resultado como ref, con el mismo Guard). Incluye escalar a un modelo de frontera ante las señales de fracaso existentes.
2. **Memoria entre tareas:** playbooks y hechos del usuario en config, generados fuera de línea desde las trazas (el backend sigue sin leerlas). Habilita continuidad («abrí lo de ayer»).
3. **Contexto vivo de la PC:** ventana activa, portapapeles, carpeta de trabajo, archivos recientes.
4. **Aprobaciones y respuestas en lenguaje natural** (Telegram y voz), clasificadas por la decisión.
5. **Modelo generativo distinto por etapa.**
6. **Lecturas independientes en paralelo** dentro de una tarea larga.
7. **Deshacer:** copia de seguridad antes de sobrescribir y papelera en lugar de borrar.
8. **Herramientas nuevas:** pedidos reales sin herramienta hoy («bajá el volumen un 10 %», «sacá una captura de pantalla», «reproducí … en YouTube»). Las básicas de B4 no entran acá: reemplazan lo que se hace por terminal.
9. **Tareas programadas o recurrentes** y avisos proactivos.
10. **Reanudar tareas tras reiniciar** y cola con prioridad cuando Telegram, voz y la interfaz compiten por los modelos.
11. **Afinar el modelo de decisión** con trazas etiquetadas.
12. **Descartar LangChain/LangGraph para el núcleo** (JARVIS ya tiene lo que aportarían y la complejidad real está en las políticas para modelos chicos); reevaluar solo dentro de un agente especializado.

## 5. Experimentos pendientes

Hechos: línea base de trazas, alternancia de modelos, arranque en frío, contexto real, caché, T1 a T5.

| # | Experimento | Qué responde |
|---|---|---|
| E3 | D0 como dataset del laboratorio y con casos nuevos | Si el 89 % se sostiene fuera del conjunto de ajuste |
| E13 | Tipo de cada argumento por herramienta en las trazas | Cobertura real del relleno declarado (B5) |
| E19 | `web_search` con la instrucción como consulta contra la generada | Si se puede sacar `args` de la tarea más frecuente |
| E14 | D3 dividido en `noul` contra una sola elección | Si mejora sin costo de latencia |
| E15 | `d3:2b` liviano contra Q8: precisión en D1 a D5 y latencia alternando con Qwen | Si N1 se resuelve con configuración |
| E16 | `keep_alive` permanente y tras 10 minutos sin uso | Que A1 elimina el arranque en frío |
| E17 | Consultas gastadas después del primer `loop_blocked` | Ahorro de A3 |
| E18 | Casos de `verify_copy_move` y `d4_verify` que decide una poscondición | Alcance de C2 |
| E20 | Etapa en que se cancelaron las 21 tareas | Si pesan las esperas o las confirmaciones |
| — | Argumentos de las herramientas básicas con Qwen y ejecución real | Cierra la prueba de B4 |

## 6. Registro de notas

> Anotar acá ideas nuevas, resultados de experimentos y decisiones. Formato: fecha · idea o experimento · resultado · decisión.

- 2026-11-13 · N1 (tamaño de modelos) · en pausa por decisión del usuario.

## 7. Resumen final

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