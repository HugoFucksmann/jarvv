# Contexto y memoria

> Última revisión: **2026-10-11**

JARVIS Core administra la información contextual que reciben los modelos diferenciando dos canales: el modelo clasificador estructurado Decision 2.0 y el razonador LLM Qwen 3.5 9B. Para Decision 2.0 (`src/core/decision.ts`), el contexto se condensa en un objeto `state` sintético que agrega la meta actual, las últimas líneas de historial LOG/FAIL, las acciones previas ejecutadas (`attempts`) y la última observación, evaluado junto a preguntas estructuradas (`questions`). Para Qwen 3.5 9B (`src/core/reasoner/qwen.ts`), el contexto se ensambla jerárquicamente a partir de system prompts por etapa y un bloque de usuario compuesto por la meta (GOAL), el historial colapsado de ejecución (LOG), el plan activo (PLAN), fallos recientes (FAIL), hechos extraídos (FACTS), la definición de la herramienta seleccionada con su esquema JSON limpio (SCHEMA), y la última observación compacta delimitada con etiquetas `<obs>...</obs>` previamente sanitizada con `safe()`.

## Construcción del contexto

Orden y fuentes de cada bloque que compone la petición al modelo (ilustrado para la generación de argumentos en `PROMPTS.ARGUMENTS.buildUserPrompt`):

| Orden | Bloque | Fuente | Ejemplo |
|-------|--------|--------|---------|
| 1 | System prompt | `PROMPTS.ARGUMENTS.SYSTEM` (`src/core/reasoner/prompts.ts`) | Directivas de respuesta exclusiva en JSON, adherencia al SCHEMA y aviso `DATA_NOTICE` |
| 2 | Meta (`GOAL`) | `task.message` (`src/core/types.ts`) | `"Busca en la web el precio de Bitcoin y guárdalo en archivo"` |
| 3 | Contexto de charla (`CHAT`) | `chatContext` (opcional en prompts) | Mensajes conversacionales previos si aplica |
| 4 | Historial de ejecución (`LOG`) | `task.memory.log` (`src/core/context.ts`) | `1\|search\|ok\|5 resultados web, primero: Bitcoin USD` (colapsado si > 12 entradas) |
| 5 | Plan activo (`PLAN`) | `buildPlanLines(task)` (`src/core/context.ts`) | `[x] s1 Buscar precio -> ok\n[>] s2 Guardar archivo \| éxito: archivo creado` |
| 6 | Registro de fallos (`FAIL`) | `task.memory.fail` (`src/core/context.ts`) | `write_file -> DENY: Operación rechazada por Guard` (máx. 5 entradas) |
| 7 | Hechos estructurados (`FACTS`) | `task.memory.facts` (`src/core/context.ts`) | `url=https://coinmarketcap.com/currencies/bitcoin/ \npath=btc.txt` |
| 8 | Definición de herramienta (`TOOL`) | `tool.name` y descripción recortada (`shortDesc`) | `desktop_commander:write_file: Escribe contenido en un archivo local.` |
| 9 | Esquema limpio (`SCHEMA`) | `cleanInputSchema(tool.inputSchema)` | `{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}` |
| 10 | Última observación (`LAST`) | `context.lastCallCompactObs` delimitado por `<obs>` | `<obs>Bitcoin cotiza a $68,450 USD...</obs>` (sanitizado con `safe()`) |
| 11 | Error previo de schema | `promptData.previousError` (en reintentos de Qwen) | `ERROR_PREVIO: los argumentos anteriores no pasaron el schema: Faltan campos requeridos: path. Corrígelos.` |
| 12 | Instrucción del paso (`TASK`) | `step.instruction` (`src/core/types.ts`) | `"Escribir el precio obtenido en el archivo btc.txt"` |

## Prompts

Prompts existentes en el sistema, centralizados como funciones y constantes tipadas en `src/core/reasoner/prompts.ts`:

| Prompt | Ruta | Propósito |
|--------|------|-----------|
| `PROMPTS.ARGUMENTS` | `src/core/reasoner/prompts.ts` | Instruye a Qwen 3.5 9B a generar únicamente el objeto JSON con los parámetros de la tool conforme a su SCHEMA (Etapa 3) |
| `PROMPTS.ESCALATION` | `src/core/reasoner/prompts.ts` | Solicita a Qwen 3.5 9B analizar por qué falló una acción y decidir si conmuta de subsistema (`switch_mcp`) o aborta (`abort`) (Etapa 5B) |
| `PROMPTS.FINAL_RESPONSE` | `src/core/reasoner/prompts.ts` | Instruye a Qwen 3.5 9B a responder al usuario en español basándose de forma estricta en LOG, FACTS y EVID (Etapa 6) |
| `PROMPTS.PLAN` | `src/core/reasoner/prompts.ts` | Solicita a Qwen 3.5 9B descomponer el objetivo en una lista ordenada de hasta 15 pasos con `suggested_mcp` y `expected_outcome` (Modo PLAN) |
| `PROMPTS.REPLAN` | `src/core/reasoner/prompts.ts` | Solicita a Qwen 3.5 9B reformular el plan restante tras el fallo de un paso intermedio o abortar si la meta es inalcanzable |
| `DECISION_PROMPTS.buildDecisionOne` | `src/core/reasoner/prompts.ts` | Construye el `state` y la pregunta de enrutamiento de subsistema `route` (choice) y `needs_context` (noul) para Decision 2.0 |
| `DECISION_PROMPTS.buildDecisionTwo` | `src/core/reasoner/prompts.ts` | Construye el `state` y la pregunta `selected_tool` (choice entre 2-255 herramientas descubiertas con advertencias anti-repetición) |
| `DECISION_PROMPTS.buildDecisionFive` | `src/core/reasoner/prompts.ts` | Construye el `state` con errores técnicos, hallazgos y resultado resumido para evaluar `evaluation` (`correcta` vs `incorrecta`) |
| `DECISION_PROMPTS.buildDecisionJudgement` | `src/core/reasoner/prompts.ts` | Construye el `state` comparando `expectedOutcome` con lo obtenido para juzgar el cumplimiento de criterios en modo PLAN (`cumple` vs `no_cumple`) |

## Historial

- **Almacenamiento:**
  - En memoria activa: las tareas se mantienen en el mapa en memoria `taskContexts` (`Map<string, TaskExecutionContext>`) en `JarvisCore` (`src/core/core.ts`). En sesión del orquestador, se guarda un array de strings `sessionHistory`.
  - En disco: persistencia automática en el archivo local `jarvis-tasks.json` tras cada cambio de estado, conservando las últimas 20 tareas en total (`serialized.slice(-20)`). La escritura se realiza sincrónicamente mediante `fs.writeFileSync` (sin archivo temporal intermedio ni escritura atómica basada en rename; los datos, argumentos y observaciones se persisten en texto claro sin cifrado).
- **Estrategia de recorte:**
  - **LOG de pasos (`task.memory.log`):** Cuando la lista supera 12 líneas, las líneas previas a las últimas 6 se colapsan estadísticamente en una sola entrada de resumen `1-N: X ok, Y err`, preservando intactas las 6 más recientes (`context.task.memory.log = [summaryLine, ...log.slice(-6)]`).
  - **Cola de fallos (`task.memory.fail`):** Mantiene únicamente las 5 entradas más recientes (`fail.slice(-5)`).
  - **Historial enviado a Decision 2.0:** `buildHistoryContext` toma las últimas 3 líneas de LOG y 2 de FAIL. En `buildDecisionOne`, este historial se recorta adicionalmente con `clipTail` a un máximo de 4.000 caracteres (`MAX_HISTORY_CHARS = 4000`), descartando el texto antiguo y conservando el más reciente.
  - **Historial de intentos (`attempts`):** Formateado por `fmtAttempts` para Decision 2.0, limitado a un máximo de 8 intentos (`MAX_ATTEMPTS = 8`) con notas truncadas a 60 caracteres (`MAX_NOTE_CHARS = 60`).

## Memoria

Tipos de memoria y estructuras administradas en el ciclo de vida de la tarea:

| Tipo | Qué guarda | Persistencia | Ejemplo |
|------|-----------|--------------|---------|
| Línea de tiempo (`TaskMemory.log`) | Entradas estructuradas de cada acción ejecutada: `stepSeq\|tool\|status\|finding` | Por tarea, persistido en `jarvis-tasks.json` (colapsado si > 12) | `1\|search_files\|ok\|3 coincidencias, primera: C:/repo/notes.txt` |
| Hechos estructurados (`TaskMemory.facts`) | Pares clave-valor extraídos deterministamente por `ResultProcessor` (`path`, `win`, `el`, `pid`, `url`, `cand`) | Por tarea, persistido en `jarvis-tasks.json` | `url=https://docs.rs \npath=src/main.rs \npid=4512` |
| Registro de fallos (`TaskMemory.fail`) | Causas de error técnico, denegaciones de Guard o rechazos del usuario (máx. 5) | Por tarea, persistido en `jarvis-tasks.json` | `write_file -> RECHAZADO por usuario` |
| Espacio de trabajo (`Scratchpad`) | Variables de estado operativo (`search_results`, `selected_result`, `url`, `path`, `process_id`, `window_handle`, `element_id`). Nota: aunque conceptualmente actúa como pizarra de trabajo de la tarea, se serializa y persiste en `task.scratchpad` dentro de `jarvis-tasks.json`. Mantiene claves funcionalmente duplicadas con `TaskMemory.facts` bajo distinta nomenclatura (`path` vs `path`, `win` vs `window_handle`, `el` vs `element_id`, `pid` vs `process_id`), donde `facts.path` y `facts.url` adoptan de forma determinista el primer resultado hallado. | Por tarea, persistido en `task.scratchpad` en `jarvis-tasks.json` | `window_handle="0x102A4", path="C:/app/log.txt"` |
| Almacén de referencias (`RefStore`) | Contenido textual íntegro sin truncar devuelto por las herramientas, indexado por clave `r1`, `r2`... | En memoria volátil de Node.js, aislado por `taskId` | `r1` -> 50.000 caracteres de salida de terminal |

> **Nota sobre persistencia entre sesiones:** No existe un subsistema de memoria a largo plazo permanente de usuario (como bases de datos vectoriales entre reinicios independientes). La memoria opera estrictamente en el ámbito de cada tarea y su historial persistido en `jarvis-tasks.json`.

## Evidencias

- **Estructura:** Cada resultado de herramienta procesado genera un objeto `Evidence` (`src/core/types.ts`) compuesto por:
  - `ok`: booleano que valida si la tool concluyó con éxito, sin errores, sin salidas vacías inesperadas (`signals.empty_output`), sin recurso no encontrado (`signals.not_found`) y sin elemento obsoleto (`signals.stale_element`).
  - `summary`: hallazgo sintético (`finding`) generado por los extractores de `ResultProcessor`, sanitizado a una sola línea (`sanitizeForMemory`, máx. 120 caracteres).
  - `obs`: observación compacta (`compactObs`) formateada específicamente según la naturaleza de la herramienta (primeras 30 líneas de árbol de interfaz, primeros 10 archivos, primeras 15 y últimas 15 líneas de un archivo leído, o top 5 resultados de búsqueda web), truncada a un máximo de 1.500 caracteres (`obs.slice(0, 1500)`).
  - `ref`: clave formateada `${mcp}:${tool}:${refKey}` (ej. `desktop_commander:read_file:r1`) que vincula la evidencia con el contenido completo guardado en `RefStore`.
  - `flags`: banderas de estado especial (`PENDING_OBSERVATION`, `STALE_ELEMENT`, `IMAGE_CONTENT_ATTACHED`, `RESOURCE_REF:...`).
- **Incorporación en contexto:**
  - En llamadas a Qwen (Etapa 3 y Etapa 5B), la observación inmediata previa se inyecta en el bloque `LAST (paso N, tool):\n<obs>${safe(obsText)}</obs>`.
  - En la respuesta final de Qwen (Etapa 6), las evidencias de las últimas 3 llamadas se inyectan en el bloque `EVID:` separadas por delimitadores `---`.
  - La función `safe()` neutraliza cualquier etiqueta de cierre o apertura `</?obs>` presente en datos de herramientas reemplazándola por `[obs]`, previniendo inyecciones de contexto.

## Datos enviados a los modelos

| Se envía | Se filtra / nunca se envía |
|----------|---------------------------|
| Instrucción de la meta (`GOAL`), prompt del paso actual (`TASK`), historial colapsado (`LOG`), hechos (`FACTS`), fallos recientes (`FAIL`) y plan (`PLAN`) | El texto bruto masivo devuelto por herramientas que supere límites (se almacena en `RefStore` y en el prompt se reemplaza por `[... omitido, ref:rX]`) |
| Definición de la herramienta seleccionada (`tool.name`) y primera oración de su descripción (recortada a 80 caracteres en D2) | Metadatos redundantes del JSON schema de herramientas: se eliminan `$schema`, `title`, `additionalProperties` y `examples` mediante `cleanInputSchema` |
| Esquema JSON limpio de parámetros (`cleanedSchema`) para que Qwen genere argumentos válidos | Saltos de línea y caracteres de control ASCII (`[\x00-\x1F\x7F]`) en líneas de memoria, filtrados mediante `sanitizeForMemory` |
| Observación compacta del último resultado delimitada por `<obs>...</obs>` (máx. 1.500 caracteres) | Etiquetas delimitadoras `<obs>` y `</obs>` en datos externos, neutralizadas a `[obs]` con `safe()` |
| Señales booleanas y códigos de salida (`exit_code`, `not_found`, `denied`, `empty_output`, `timeout`, `stale_element`) hacia Decision #5 | Nombres de bloques reservados prefijados (`GOAL:`, `FACTS:`, `LOG:`, `FAIL:`, etc.), transformados a `$1_` para evitar inyecciones |
| Resúmenes estructurados prefijados (`[ÉXITO]`, `[FALLO]`, `[VACÍO]`, `[STALE]`) hacia Decision 2.0 (recortados a 400 caracteres) | Claves de API secretas o tokens de autenticación privados (las comunicaciones con Qwen en Ollama y Decision 2.0 van a endpoints HTTP locales o tunelizados sin credenciales). *Nota de privacidad:* Los argumentos pasados a herramientas (incluyendo cadenas tipeadas con `ui_type_text` o contenidos de archivos) se almacenan sin enmascarar en el objeto `StepCall` persistido en disco, y los prompts con el estado completo se emiten a la consola estándar de depuración del servidor Node.js. |

## Límites y presupuesto de tokens

- **Límites de contexto del modelo:**
  - `QWEN_CTX = 8192` tokens: ventana máxima de contexto configurada para Qwen 3.5 9B (`num_ctx`).
  - Presupuesto operativo de Decision 2.0: `8192` tokens (techo asignado por el orquestador en runtime; aunque la especificación de referencia de Decision 2.0 Eos admite hasta 16.384 tokens, el sistema restringe el consumo a este límite). En `Decision20Engine.systemOne` se estima el consumo previo (`Math.ceil(stateStr.length / 3.5) + questions * 40`); si supera 8.192 tokens, se aborta la llamada con `DecisionValidationError` controlado.
- **Límites de salida (`max_tokens` / `num_predict` en Qwen):**
  - Generación de argumentos (Etapa 3): `1024` tokens.
  - Escalación (Etapa 5B): `500` tokens.
  - Respuesta final (Etapa 6): `1500` tokens (`1000` en fallback rápido sin pensamiento).
  - Plan y Replan (Modo PLAN): `1500` tokens.
- **Límites por bloque de texto:**
  - `MAX_HISTORY_CHARS = 4000`: Historial recortado en Decision #1.
  - `MAX_SCRATCHPAD_CHARS = 2000`: Contexto de scratchpad en Decision #2.
  - `MAX_RESULT_CHARS = 400`: Resumen de resultado en Decision #1 y Decision #5.
  - `MAX_TOOL_DESC_CHARS = 80`: Descripción de herramientas en Decision #2.
  - `MAX_ATTEMPTS = 8`: Intentos previos conservados en Decision #1 y Decision #2.
  - `MAX_NOTE_CHARS = 60`: Notas de intentos truncadas.
  - `compactObs`: Truncado a 1.500 caracteres.
  - `sanitizeForMemory`: Truncado a 120 caracteres por línea de hallazgo.
- **Orden de descarte:**
  - En LOG: se colapsan primero las entradas más antiguas (anteriores a las últimas 6) en un conteo estadístico `1-N: X ok, Y err`.
  - En FAIL: se descartan las entradas que excedan las 5 más recientes.
  - En History/Scratchpad: se descarta el inicio mediante `clipTail`, preservando el contenido más reciente.
  - En archivos leídos (`read_file`): si superan 30 líneas, se conservan los primeros 15 renglones y los últimos 15, descartando el bloque intermedio con un puntero a `refKey`.

## Archivos relacionados

| Ruta | Rol |
|------|-----|
| `src/core/reasoner/prompts.ts` | Centralización de plantillas de sistema, constructores de prompts para Qwen y builders de Decision 2.0 |
| `src/core/context.ts` | Contexto de ejecución `TaskExecutionContext`, colapso de LOG, cola FAIL, FACTS y formateo de intentos previos |
| `src/core/processor/resultProcessor.ts` | Procesamiento determinista de salidas de herramientas, extracción de señales, deltas y almacén `RefStore` |
| `src/core/decision.ts` | Adaptador HTTP de Decision 2.0 y validación estricta de la ventana de contexto de 8.192 tokens |
| `src/core/reasoner/qwen.ts` | Adaptador HTTP de Qwen 3.5 9B, configuración de `QWEN_CTX`, reintentos de schema y dispatch de prompts |
| `src/core/mcp/discovery.ts` | Función `cleanInputSchema` para limpieza de esquemas de herramientas y eliminación de metadatos redundantes |
| `src/core/types.ts` | Definición de tipos fundamentales de memoria (`TaskMemory`, `Scratchpad`, `Evidence`) y límites globales |