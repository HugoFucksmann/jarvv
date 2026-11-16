# Plan: memoria del usuario

> **Solo planificación. No hay nada implementado de lo que se propone aquí.** Las decisiones de diseño siguen abiertas.

## 1. Estado actual (verificado en `src/core/memory.ts`, `engine/services.ts`, `engine/callRunner.ts`)

- **Almacén**: `data/memory.json` (junto a `refsDir`, ignorado por git). Formato `[{ "key": "...", "value": "..." }]` o `{ "facts": [...] }`. Se edita **a mano**; no hay CRUD en HTTP, UI ni Telegram.
- **Lectura**: `createMemoryReader` relee el archivo solo si cambia su fecha de modificación (`mtimeMs`). Archivo ausente o inválido = memoria vacía, nunca un error de la tarea. Topes: 200 entradas, clave ≤ 80 caracteres, valor ≤ 300.
- **Matching** (`selectFacts`): por *stems* (`stemsOf` de `text.ts`: prefijo de 5 letras, sin palabras vacías). Un hecho coincide si **todas** las palabras que distinguen de su clave aparecen en el texto. Orden del archivo, hasta `MAX_FACTS_PER_PROMPT = 3`. Una clave solo con palabras vacías nunca coincide. Sin modelos.
- **Inyección**: solo en `callRunner.ts` (paso 3): el texto buscado es `request + instrucción del paso`; los hechos elegidos entran (a) como líneas `clave: valor` al prompt de **argumentos** y (b) como fuentes válidas del pre-chequeo (`collectSources`). **No** entran a `pending`, `plan`, D3 ni a la respuesta final.
- **Hilo** (`engine/thread.ts`) es otra memoria, de RAM y 10 minutos; no se toca aquí.
- **Medido** (`docs/evaluacion/analisis/FRENTE_1_MEMORIA.md`): con el hecho en el prompt, argumentos 0/6 → 6/6; elegir por código acierta 14/14 y no contamina pedidos ajenos.

### Límites conocidos
1. Sin forma cómoda de crear/ver/borrar hechos (editar JSON a mano).
2. Matching estricto: sinónimos, plurales irregulares o una clave de una palabra con otra raíz no coinciden («mi repo» vs «el repositorio»: stems `repo`/`repos`… depende del prefijo).
3. Claves que comparten palabras (`carpeta jarvis`, `carpeta jarvis backup`) pueden competir por los 3 cupos; no hay prioridad por especificidad.
4. No llega a `pending`/`plan`: si el pedido dice «guárdalo en mi carpeta de proyectos» y D0 divide en pasos, la ruta solo se resuelve cuando se generan los argumentos.
5. Nada se aprende solo (a propósito: regla «solo entra lo que escribió el usuario»).

## 2. Criterio de decisión

1. **Latencia mínima**: preferir diseños **sin modelos extra** (el presupuesto de 8 GB de VRAM ya lo ocupan `d3` y el generativo). Lo determinista cuesta microsegundos.
2. **Cero tokens sin coincidencia** (se conserva).
3. **Nunca texto generado por un modelo** guardado como hecho, salvo confirmación explícita del usuario.
4. Compatible con los invariantes de `CONTEXT_AND_MEMORY.md` §7: la memoria entra por el motor, no por `apply`.

## 3. Opciones

### A. Gestión de hechos (CRUD) sobre el mismo archivo
Endpoints `GET/PUT/DELETE /memory`, pantalla en la UI y comando de Telegram; el JSON sigue siendo la fuente.
- **Pros**: 0 ms de inferencia; resuelve el límite 1; reversible (el usuario ve y borra).
- **Contras**: hay que decidir escritura concurrente con la edición manual (hoy se relee por `mtime`) y validar con los mismos topes; superficie nueva en la API sin autenticación (cualquier proceso local escribiría hechos que luego se usan como fuente del pre-chequeo).

### B. Captura conversacional («recordá que X es Y») por patrón
Una regla léxica en `routeRequest`/D0 detecta la frase y guarda `clave → valor` tras confirmación del usuario.
- **Pros**: sin modelo si el patrón es estricto; natural para el usuario.
- **Contras**: falsos positivos del patrón; extraer clave/valor sin modelo es frágil con frases libres; si se delega al LLM, añade una llamada y riesgo de texto inventado. Cambia el flujo (nuevo tipo de pedido) → requiere definirlo antes de implementar.

### C. Mejor matching sin modelos
Añadir alias por hecho (`"aliases": ["mi repo", "proyecto"]`), prioridad por cantidad de stems de la clave (más específica primero) y *stemming* mínimo para plurales.
- **Pros**: 0 ms, determinista, resuelve los límites 2 y 3; ampliable con casos medidos.
- **Contras**: sigue dependiendo de que el usuario escriba alias; riesgo de contaminar pedidos ajenos (el eval midió 0/8 hoy; hay que re-medir).

### D. Inyección también en `pending`/`plan`
Pasar los mismos hechos elegidos a la construcción de `pending` y del plan.
- **Pros**: la ruta correcta se usa desde el primer paso (límite 4).
- **Contras**: más tokens en prompts de 2B, con regresiones previas en `pending` (ver `PENDING_FACTS_LOOKUP`); requiere recalibrar en `eval/`.

### E. Recuperación semántica (embeddings)
- **Pros**: tolera sinónimos.
- **Contras**: modelo extra (VRAM y latencia), contradice el criterio 1. **Descartada** salvo que el matching léxico demuestre ser insuficiente con datos reales.

## 4. Recomendación

Orden sugerido, de menor a mayor riesgo: **C** (matching) → **A** (CRUD, con límite de tamaño y escritura atómica) → **D** (solo si las trazas muestran fallos por ruta en pasos intermedios) → **B** (requiere definir el flujo). **E** no.

## 5. Preguntas abiertas para el usuario

- ¿El CRUD debe poder borrar/editar hechos desde Telegram o solo desde la UI?
- ¿Se acepta que un hecho de la memoria sea fuente válida del pre-chequeo si lo escribe otra entrada local (sin autenticación)?
- ¿«Recordá que…» debe pedir confirmación siempre?
