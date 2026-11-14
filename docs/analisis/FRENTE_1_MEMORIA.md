# Frente 1 — Memoria entre tareas

> 2026-11-13. Diseño propuesto, con pruebas contra `qwen3.5:4b` y `d3:2b` reales (pensamiento apagado).
> **2026-11-14: implementado en parte.** Mirá «Estado de implementación»; el resto del documento es el diseño y las mediciones originales y no se reescribió.

## Estado de implementación (2026-11-14)

Leyenda: ✅ hecho · ⚠ parcial · ⏸ pendiente · ❌ descartado o revertido.

| # | Decisión | Estado | Dónde está |
|---|---|---|---|
| DN-1.1 | Qué capas construir | ⚠ hechos ✅ e hilo ✅; recetas ⏸ | — |
| DN-1.2 | Dónde persiste | ✅ `data/memory.json` (junto a `refsDir`; está en `.gitignore`) | `src/core/memory.ts` |
| DN-1.3 | Quién escribe hechos | ⚠ solo el usuario, editando el archivo a mano. Respuestas del usuario como hechos ⏸; rutas encontradas ⏸ | — |
| DN-1.4 | Cómo dicta un hecho | ⏸ frase «recordá que…» y pantalla para ver y borrar (se eligió el primer corte «solo archivo editable») | — |
| DN-1.5 | Duración del hilo | ✅ 1 tarea y 10 minutos | `engine/thread.ts` (`THREAD_TTL_MS`), `tasks.ts` |
| DN-1.6 | Umbral de continuación | ✅ 0,3. Con el prompt de producción: 28/28 seguimientos y 0/28 falsos | `engine/thread.ts` (`CONTINUATION_APPROVE`) |
| DN-1.7 | Condición de recetas | ⏸ | — |
| DN-1.8 | Hechos en consultas web | ✅ ya cubierto por `egress.ts` para rutas de usuario (pide confirmación); un hecho que no es ruta sale tal cual | `policy/egress.ts` |
| DN-1.9 | Tope de hechos por prompt | ✅ 3 | `memory.ts` (`MAX_FACTS_PER_PROMPT`) |
| DN-1.10 | Pre-chequeo ante rutas de memoria | ✅ los valores de los hechos (y la tarea anterior) son fuente | `engine/precheck.ts` (`collectSources(ctx, extra)`) |

**Cómo funciona hoy**
- **Hechos:** el archivo es `[{ "key": "carpeta jarvis", "value": "C:\\…" }]`. Un hecho entra si todas las palabras de su clave aparecen en el pedido o en el paso (prefijo de 5 letras); sin coincidencia, cero tokens. Va como bloque `MEMORY` a la generación de argumentos y como fuente del pre-chequeo.
- **Hilo:** `TaskManager` guarda en RAM la última tarea `completed` con respuesta del modelo (pedido y 500 caracteres de la respuesta). Al empezar una tarea reactiva, una consulta `noul` a `d3` (`follow`, etapa `continuation`) decide si el pedido la continúa; si sí, la tarea anterior entra a `pending`, a los argumentos (líneas `previous request/answer` del bloque `MEMORY`), a la respuesta final y a las fuentes del pre-chequeo.
- **Decisiones propias al implementar el hilo (no estaban en este documento):** con hilo, una acción no toma el atajo de D0 (`pending` reescribe el pedido con la tarea anterior a la vista); una charla con hilo cierra directo pero la respuesta final recibe la tarea anterior; solo se guardan tareas completadas con respuesta del modelo (no con la de respaldo).
- **Sin probar de punta a punta:** el hilo con herramientas reales encadenadas. Probado con pruebas del motor, del `TaskManager` y de los prompts, y la detección contra el modelo real.

## Resumen

Hoy cada tarea nace de cero: el contexto vive en RAM por tarea, la traza no se vuelve a leer y lo único compartido son las carpetas del usuario (`environment.ts`).

**Recomendación: tres capas chicas, todas recuperadas por código, sin modelos nuevos ni base de datos.**

| Capa | Qué guarda | Dónde | Cómo se recupera | A quién se le pasa |
|---|---|---|---|---|
| 1. Hechos | Pares clave → valor que el usuario dijo o confirmó («carpeta jarvis» → ruta) | Un archivo JSON | Coincidencia de palabras, por código | Solo a la generación de argumentos, y solo los que coinciden |
| 2. Hilo | La tarea anterior: pedido, respuesta y rutas tocadas | RAM | Una pregunta `noul` al decisor: ¿el pedido nuevo continúa el anterior? | A la entrada de la tarea (D0 y `pending`), solo si continúa |
| 3. Recetas | Pedido → llamada que lo resolvió, con contadores | El mismo archivo | Igualdad del pedido normalizado, por código | A nadie: el código repite la llamada y se saltan los modelos |

Lo medido:

- Con el hecho correcto en el prompt, el generativo pasa de **0 de 6 a 6 de 6** en pedidos que dependen de algo que el usuario ya dijo.
- Pasar todos los hechos contamina 1 de 8 pedidos ajenos y suma 105 tokens. Pasar solo los que coinciden por código: 0 de 8, sin costo cuando no hay coincidencia.
- Elegir el hecho por código acierta 14 de 14 en 0 ms; con el decisor, 13 de 14 y una pregunta por hecho.
- Detectar que un pedido continúa el anterior: con umbral 0,3, **28 de 28** seguimientos y **0 de 28** falsos en 56 pedidos, en 25 ms (con 0,5, 19 de 28).
- En el uso real, 44 de 116 tareas repiten textualmente un pedido anterior y 52 tienen un antecedente ya resuelto.

## 1. Alternativas comparadas

| Alternativa | Idea | Por qué sí o por qué no en JARVIS |
|---|---|---|
| **A. Hechos con clave, elegidos por código** | Archivo de pares; se inyecta el que coincide con el pedido | ✅ 0 ms, sin modelos, depurable leyendo un archivo. Medido |
| **B. Hilo de la tarea anterior** | Guardar la última tarea y pasarla si el pedido la continúa | ✅ Resuelve «guardalo en un md», «¿y el de Gemini?» con una consulta de 25 ms |
| **C. Recetas por pedido repetido** | Reutilizar la llamada que ya funcionó | ✅ 38 % de las tareas reales son repeticiones exactas. Encaja con «primero código» |
| D. Embeddings y búsqueda semántica | Vector por recuerdo, similitud por coseno | ❌ Un tercer modelo en una GPU que ya está al límite, una dependencia nueva, y resultados que no se explican leyendo un archivo. Con decenas de hechos, la coincidencia de palabras alcanza |
| E. Resumen de cada tarea escrito por el 4B | «Memoria episódica» en prosa | ❌ Una llamada generativa más por tarea y prosa de modelo como fuente de verdad: rompe «sin prosa de modelos en el contexto» y acumula errores |
| F. Leer las trazas en caliente | Buscar en `jarvis-traces/` | ❌ Rompe el principio de que la traza es accesoria y nunca se lee. Formato pesado |
| G. Elegir los recuerdos con el decisor | Una `noul` por hecho | ⚠️ Funciona (13 de 14) pero cuesta 28 ms por hecho y no supera al código. Queda como segundo filtro si la lista crece |

## 2. Diseño

### 2.1 Qué se guarda

Regla única: **solo entra lo que escribió el usuario o lo que el código comprobó.** Nunca texto generado por un modelo.

**Hechos**
```jsonc
{ "key": "proyecto de facturación", "value": "D:\\trabajo\\facturas-app",
  "kind": "path",            // path | app | name | pref
  "source": "user",          // user | answer | located
  "uses": 3, "lastUsed": "2026-11-13" }
```
Orígenes permitidos:
- `user`: el usuario lo dicta («recordá que mi carpeta de reportes es …»).
- `answer`: respuesta del usuario a una pregunta de JARVIS. El motor ya la guarda como hecho `answer_<paso>_<n>` con forma «pregunta -> respuesta»; hoy se pierde al cerrar la tarea.
- `located`: un nombre que no estaba donde se buscó y que `locate` encontró después; el código verifica que la ruta existe antes de guardar.

**Hilo** (RAM, una sola entrada, vence a los 10 minutos)
```jsonc
{ "request": "...", "answer": "primeros 500 caracteres de la respuesta final",
  "paths": ["rutas leídas o escritas"], "refs": ["ruta del resultado completo"], "at": 0 }
```

**Recetas**
```jsonc
{ "request": "decime los 5 procesos que mas ram esten consumiendo",   // normalizado
  "calls": [{ "tool": "list_processes", "args": { "all": true } }],
  "ok": 3, "fail": 0, "lastOk": "2026-11-13" }
```
Solo de tareas `completed`, de un paso, con la llamada aprobada por la verificación.

### 2.2 Dónde

- `data/memory.json`: un archivo, cargado en RAM al arrancar, escrito de forma atómica al cambiar. Tope de entradas, con descarte de las menos usadas.
- El hilo vive en `TaskManager`.
- **El contexto de tarea no cambia ni se entera.** La memoria entra al motor como ya entra el entorno de la PC (`EngineServices`), y se escribe después del cierre, como la traza. Se mantienen «el contexto no conoce a nadie» y «la traza es accesoria».

### 2.3 Cómo se recupera

- **Hechos:** texto normalizado (minúsculas, sin acentos, sin palabras vacías) y comparación por raíz. Un hecho coincide si todas las palabras de su clave están en el pedido o en el ítem del paso. Ya existe una comparación por raíz en `core/text.ts`.
- **Hilo:** una pregunta `noul` al decisor con el pedido anterior, su respuesta y el pedido nuevo. Puede ir en la misma consulta que D0.
- **Recetas:** igualdad exacta del pedido normalizado. Sin parecidos: «los 5 procesos» y «los 10 procesos» son recetas distintas.

### 2.4 Cuándo se le pasa a cada modelo

| Consulta | Qué recibe de la memoria | Por qué |
|---|---|---|
| D0 / `pending` | El hilo (pedido y respuesta anteriores), solo si el decisor dice que continúa | Sin eso «guardalo en un md» no tiene referente |
| D1, D2 | Nada | Elegir ruta y herramienta no depende de hechos del usuario |
| Argumentos | Bloque `MEMORY` con los hechos que coinciden (hasta 3 líneas) y, en una continuación, las rutas del hilo | Es donde se inventan valores. Medido |
| D3 | Nada | Medido: no hace falta (ver §3, D3). Con o sin hechos aprueba las rutas de memoria (0,94 a 0,99) |
| Pre-chequeo (código) | Los hechos, como fuente de «lo que la tarea sabe» | **Obligatorio**: sin esto rechaza las rutas de memoria (ver §2.6) |
| D4, D5 | Nada | Juzgan resultado contra pedido |
| Respuesta final | Preferencias (`pref`: idioma, formato), una línea | Resuelve por código el idioma de la respuesta |

Costo cuando no hay coincidencia: cero tokens y cero consultas (salvo la `noul` del hilo, 25 ms, y solo si hay una tarea reciente).

### 2.5 Recetas: cuándo se repite sin modelos

1. El pedido normalizado coincide con una receta con `ok ≥ 2` y `fail = 0`.
2. La herramienta es de lectura, o entra en el nivel sin confirmación de la aprobación por niveles.
3. El código crea el paso con esa llamada y la ejecuta por el camino de siempre: Guard, lista negra, pre-chequeo y verificación corren igual.
4. Si la verificación rechaza, `fail` sube, la receta deja de usarse y la tarea sigue por el flujo normal.

Se saltan `pending`, D1, D2 y la generación de argumentos: dos llamadas generativas y dos cambios de modelo.

### 2.6 El pre-chequeo tiene que conocer la memoria

`precheck.ts` rechaza las rutas de lectura y las URLs que «no aparecen en nada de lo que la tarea sabe». `collectSources` arma ese «nada» con el pedido, los pasos, las respuestas del usuario y las llamadas con sus refs; **no incluye ninguna memoria**. Con el diseño de arriba, el generativo escribiría `D:\trabajo\facturas-app` (valor del hecho) y el pre-chequeo lo rechazaría como inventado: `args_invalid` y un reintento perdido.

Cambio mínimo: `collectSources` agrega a `parts` los valores de los hechos que se pasaron a esa generación (los mismos 3 como máximo). Es código determinista y no pasa por ningún modelo.

## 3. Pruebas

### Uso de hechos por el generativo (6 pedidos que los necesitan)

| Pedido | Sin memoria | Con el hecho |
|---|---|---|
| Listar el contenido de la carpeta jarvis | `C:\Users\hugof\jarvis` (inventado) | `C:\Users\hugof\Desktop\jarvis` |
| Listar los archivos de mi proyecto de facturación | `C:\Users\hugof\Documents` | `D:\trabajo\facturas-app` |
| Mostrar qué hay en mi carpeta de reportes | `C:\Users\hugof\Documents` | `…\Documents\Reportes 2026` |
| Buscar las últimas noticias de mi equipo de fútbol | Repite la frase | «…Rosario Central» |
| Abrir mi editor de código | `Start-Process notepad.exe` | `code` |
| Crear una carpeta backup dentro del proyecto de facturación | `…\Documents\backup` | `D:\trabajo\facturas-app\backup` |

Sin memoria 0 de 6; con los 5 hechos 6 de 6; con solo los elegidos por código 6 de 6. Sin memoria el modelo no pregunta: inventa.

### Contaminación (8 pedidos que no la necesitan)

- Con los 5 hechos siempre presentes: 7 de 8. «Listar la carpeta proyectos de Documents» devolvió `…\Documents\Reportes 2026`. Entrada de 295 a 400 tokens.
- Con selección por código: no se inyecta nada en 8 de 8.

### Selección del hecho (14 pedidos)

- Código: 14 de 14, 0 ms.
- Decisor, una `noul` por hecho: 13 de 14 (no vio «mi equipo de fútbol»).

### D3: ¿hay que pasarle los hechos? (10 llamadas)

Se probó el formato de producción de D3 (`Target`, `Call`, `Args`) con y sin un bloque `Known values (saved by the user earlier)`.

| Grupo | Esperado | Sin hechos | Con hechos |
|---|---|---|---|
| Rutas que vienen de un hecho (3) | aprobar | 3/3 (0,94 a 0,97) | 3/3 (0,98 a 0,99) |
| Pedidos sin memoria (2) | aprobar | 2/2 | 2/2 |
| Rutas inventadas (5) | rechazar | **0/5** (0,93 a 0,95 de `approved`) | 1/5 |

Conclusión: **no hace falta pasarle los hechos a D3**, porque ya aprueba las rutas de memoria. Y aparece un hallazgo aparte: D3 aprueba rutas inventadas con 0,93 a 0,95, así que no es una barrera contra valores fabricados; esa función la cumple solo el pre-chequeo de código, y solo para lecturas (ver `FUERA_DE_FRENTES.md`).

### Continuación del pedido anterior (56 pedidos: 28 seguimientos y 28 independientes, 5 tareas previas)

Pregunta `noul` al decisor: «¿el pedido nuevo depende de la tarea anterior: la menciona («eso», «el primero», «también», «ahora») o necesita su resultado para entenderse?».

| Umbral | Seguimientos detectados | Falsos seguimientos |
|---|---|---|
| 0,3 | 28/28 | 0/28 |
| 0,4 | 26/28 | 0/28 |
| 0,5 | 19/28 | 0/28 |
| 0,6 | 14/28 | 0/28 |
| 0,7 | 7/28 | 0/28 |

- Los seguimientos con probabilidad baja son los más cortos: «traducilo al inglés» (0,36), «abrí la primera» (0,34), «y de brasil?» (0,43). Ningún independiente llegó a 0,3.
- Otras dos redacciones probadas: una invertida («¿se entiende sin la tarea anterior?») no sirve (todo da falso seguimiento); una con ejemplos detecta 25/28 a 0,4 con 1 falso de 28 (peor que la original).
- No detectar una continuación equivale al comportamiento de hoy.
- Con el umbral en 0,3 un falso positivo significa pasarle el hilo a un pedido independiente; el costo es la contaminación medida arriba (1 de 8 con los 5 hechos), no un error de ruta.

### Repetición en el uso real (116 tareas)

- 44 repiten textualmente un pedido anterior; 27 más son casi iguales.
- 52 tienen un antecedente completado con llamadas.
- Aclaración: buena parte son pruebas de desarrollo. En uso normal la proporción será menor.

## DECISIONES NUEVAS

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| DN-1.1 | Qué capas construir | Solo hechos · hechos + hilo · las tres | **Hechos e hilo primero**; recetas después de la aprobación por niveles |
| DN-1.2 | Dónde persiste | `data/memory.json` · dentro de `jarvis-config.json` · SQLite | **`data/memory.json`**: no mezcla configuración con datos y no agrega dependencias |
| DN-1.3 | Quién puede escribir hechos | Solo el usuario de forma explícita · también respuestas a preguntas · también rutas encontradas | **Explícitos y respuestas**; rutas encontradas más adelante |
| DN-1.4 | Cómo dicta un hecho el usuario | Frase reconocida por código («recordá que …») · una opción más de D0 · solo desde la interfaz | **Frase por código + pantalla en la interfaz** para ver y borrar |
| DN-1.5 | Cuánto dura el hilo | 1 tarea y 10 minutos · N tareas · toda la sesión | **1 tarea y 10 minutos** |
| DN-1.6 | Umbral de continuación | 0,5 (19/28) · 0,4 (26/28) · 0,3 (28/28, 0 falsos) | **0,3**, medido en 56 pedidos; revisarlo cuando haya pedidos reales con hilo |
| DN-1.7 | Condición para repetir una receta | `ok ≥ 1` · `ok ≥ 2` y `fail = 0` | **`ok ≥ 2` y `fail = 0`**, solo lecturas al principio |
| DN-1.8 | Hechos en consultas web | Dejarlos pasar · pasarlos por `egress.ts` como hoy las rutas y claves | **Por `egress.ts`** |
| DN-1.9 | Tope de hechos por prompt | 3 · 5 · sin tope | **3** |
| DN-1.10 | Pre-chequeo ante rutas de memoria | A sin cambios (rechaza las rutas de memoria) · B agregar los hechos usados a `collectSources` | **B**, obligatorio si se implementan los hechos |

## Orden de implementación

1. **Hechos explícitos + bloque `MEMORY` en argumentos + los hechos como fuente del pre-chequeo (DN-1.10).** Lo más simple y con el efecto medido más claro; sin la tercera parte, la primera no funciona.
2. **Respuestas del usuario como hechos.** El dato ya existe en el contexto; solo falta no tirarlo al cerrar.
3. **Hilo con detección de continuación.**
4. **Recetas**, cuando exista la aprobación por niveles.

## Límites

- Los casos los escribí yo y son pocos (6, 8, 14 y 24).
- No probé el hilo dentro de `pending` ni la ejecución de recetas (ambos requieren cambios en `src`).
- La prueba de D3 usa 10 llamadas que escribí yo.
- La selección por código se probó con 5 hechos; con cientos habría que medir falsas coincidencias.

## Validación pendiente en laboratorio (V) y bloqueados (C)
- **[V]** Probar hilo y hechos de punta a punta con tareas reales encadenadas y modelos vivos (`qwen3.5:4b` + `d3:2b`), especialmente `CONTINUATION_APPROVE` (0,3) en sesiones largas.
- **[C]** DN-1.3 / DN-1.4 / DN-1.7: guardar respuestas del usuario o rutas de `locate` como hechos persistentes, comando «recordá que…», interfaz para editar hechos y recetas (`ok ≥ 2, fail = 0`) requieren decisión de producto/UX y aprobación por niveles.
