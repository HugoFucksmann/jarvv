# Plan de Alineación Documental — JARVIS Core (Backend)

Confirmación de alcance: El análisis se limitó estrictamente a `src/` (backend) y a los entry points del host. No se leyó ni analizó `lab/` ni el código del frontend.

---

## 1. Mapa del Sistema

### Componentes Reales y Responsabilidades

| Componente | Responsabilidad | Qué NO hace |
|---|---|---|
| **Host HTTP & Rutas** (`server.ts`, `src/server/jarvisRouter.ts`, `src/server/mcpRouter.ts`) | Expone endpoints REST y stream SSE (`/events`). Serializa estado y gestiona señales del sistema operativo (`SIGINT`/`SIGTERM`) para cierre ordenado de procesos MCP. | No implementa lógica de inferencia, no arbitra herramientas ni manipula memoria interna. |
| **Núcleo Orquestador** (`src/core/core.ts`) | Fachada de control del ciclo de vida de tareas en memoria (`taskContexts`), retención (`MAX_RETAINED_TASKS = 20`), emisión de eventos (`CoreEvent`), despacho asíncrono seguro (`runDetached`) y coordinación de interacción humana (confirmación/rechazo/modificación de plan, respuestas a preguntas). | No ejecuta llamadas de red a herramientas MCP directamente ni implementa los algoritmos de bucle paso a paso. |
| **Motores de Ejecución** (`src/core/modeEngines.ts`) | Implementa las dos estrategias sobre el motor unificado: bucle reactivo (**FAST**) con escalación y compuerta de fin; y ciclo supervisado (**PLAN**) con generación, doble verificación, preguntas al usuario y replanificación autónoma. Concluye tareas (`concludeTask`, `failTask`). | No genera argumentos de herramientas ni evalúa políticas de seguridad de bajo nivel. |
| **Ejecutor Atómico de Pasos** (`src/core/callExecutor.ts`) | Pipeline de ejecución indivisible (`runStep`): descubrimiento acotado a la ruta, selección D2, generación de argumentos con Qwen, sustitución determinista de referencias, anti-bucle, compuerta Guard, despacho MCP, procesamiento de resultados, verificación factual Eos y consolidación de memoria/handoff. | No decide la estrategia de la tarea global ni planifica secuencias de pasos. |
| **Motor de Decisión 2.0** (`src/core/decision.ts`) | Cliente HTTP del modelo clasificador Eos-0.8B (`/v1/decide`). Resuelve Decision #1 (ruta ejecutable o fin), Decision #2 (herramienta del destino) y verificación factual (`ok`, `cumple` con umbral > 0.5). | No genera texto libre, planes ni argumentos JSON complejos. |
| **Motor de Razonamiento Qwen** (`src/core/reasoner/qwen.ts`) | Cliente HTTP OpenAI-compatible (`/v1/chat/completions`). Genera argumentos estructurados de herramientas, planes iniciales, replanificaciones, síntesis de respuestas finales y verificación semántica de etapa (`verifyStage`). | No ejecuta comandos en el sistema ni tiene acceso directo a los servidores MCP. |
| **Compuerta de Seguridad** (`src/core/policy/guard.ts`) | Validador determinista fail-closed basado en las políticas del manifest. Examina argumentos normalizados contra patrones destructivos (`DENY`), permisos sensibles (`APPROVAL`) o lecturas seguras (`ALLOW`). | No altera argumentos ni dialoga con modelos de lenguaje. |
| **Catálogo de Herramientas** (`src/core/tools/manifest.ts`) | Fuente única de verdad de herramientas autorizadas (11 en `desktop_commander` divididas en `files`, `locate`, `terminal`; 3 en `free_search` bajo `web`), sus capacidades, destinos y requisitos de aprobación. | No ejecuta herramientas ni mantiene estado mutable. |
| **Procesador de Resultados y Almacén de Referencias** (`src/core/processor/resultProcessor.ts`) | Parsea resultados MCP crudos, genera observaciones compactas (`compactObs` <= 2500 chars), extrae deltas para scratchpad y facts, y aisla salidas masivas en memoria por tarea (`RefStore`). | No evalúa la veracidad de los datos ni interactúa con el sistema de archivos para persistencia. |
| **Resolutor de Referencias** (`src/core/processor/refResolver.ts`) | Sustituye deterministamente tokens `{{ref:rX}}` o `ref:rX` por los contenidos reales almacenados en `RefStore` dentro del payload de argumentos antes de Guard y el despacho MCP. | No genera nuevas referencias ni ejecuta llamadas a herramientas. |
| **Gestor de Contexto y Memoria** (`src/core/context.ts`) | Ensambla bloques contextuales deterministas (`log`, `facts`, `effects`, `fail`, `dataObs`, `handoff`, `attempts`) con orden optimizado para prefix-caching y poda por antigüedad. | No almacena datos en disco ni interactúa con la red. |
| **Trazabilidad** (`src/core/taskTrace.ts`) | Escribe una línea JSONL al finalizar una tarea si `traceEnabled` está activo para auditoría y evaluación externa. | No constituye un mecanismo de base de datos ni persistencia de estado para reanudación. |

### Dirección de Dependencias
- **Permitida:**
  `Host / Router` ──► `JarvisCore` ──► `ModeEngines` ──► `CallExecutor` ──► `[Guard, ResultProcessor, RefResolver, Decision20Engine, QwenEngine, DiscoveryEngine]`
  `CallExecutor` y `ModeEngines` consultan libremente `Manifest`, `Context` y `Types`.
- **Prohibida:**
  Ningún módulo de bajo nivel (`Guard`, `ResultProcessor`, `RefResolver`, `Decision`, `Qwen`, `Manifest`) conoce ni importa a `JarvisCore`, `ModeEngines` ni `CallExecutor`.
  Ningún módulo del backend importa ni interactúa con `lab/` ni componentes de la interfaz de usuario.

---

## 2. Inconsistencias Doc vs. Código

### 1. Inexistencia de Persistencia de Tareas en Disco (`TaskStore`)
- **Archivos y líneas:** `src/core/persistence.ts` (líneas 1–195), `src/core/core.ts` (líneas 38, 122, 178, 347–375), `server.ts` (líneas 1–184).
- **Qué dice la doc:** `ARCHITECTURE.md` (líneas 48, 81, 90, 101) y `CONTEXT_AND_MEMORY.md` (líneas 119–142) describen `TaskStore` como el sistema de persistencia activo que almacena tareas en `.jarvis/tasks.json` con debounce, escritura atómica en `.tmp`, copias de respaldo `.bak` y cuarentena `.corrupt`.
- **Qué hace el código:** `TaskStore` está huérfano: ninguna clase del núcleo ni del host importa o instancia `persistence.ts`. `JarvisCore` almacena todas las tareas activas y terminadas en memoria volátil (`private taskContexts: Map<string, TaskExecutionContext>`) y las expulsa al superar `MAX_RETAINED_TASKS = 20`. Al reiniciar el proceso, el estado no se recupera de disco.
- **Por qué es una inconsistencia:** La documentación describe una arquitectura de base de datos persistente en disco inexistente en el runtime.
- **Alcance:** Afecta a `ARCHITECTURE.md` (§2 diagrama, §3 tabla) y `CONTEXT_AND_MEMORY.md` (§1 tabla, §5 persistencia).

### 2. Ciclo de Vida y Almacenamiento de `RefStore`
- **Archivos y líneas:** `src/core/processor/resultProcessor.ts` (líneas 37–98), `src/core/core.ts` (líneas 367–375).
- **Qué dice la doc:** `CONTEXT_AND_MEMORY.md` (líneas 112–115) afirma que las referencias se descargan a un archivo de almacenamiento secundario en disco al concluir la tarea y se purgan al borrarla.
- **Qué hace el código:** `RefStore` es 100% en memoria RAM (`Map<string, Map<string, string>>`). No hay código de volcado a disco secundario. Las referencias se liberan exclusivamente en memoria mediante `RefStore.clear(taskId)` cuando la tarea se expulsa del `Map` de `JarvisCore`.
- **Por qué es una inconsistencia:** Se inventa un mecanismo de swap o persistencia secundaria en disco que el código no implementa.
- **Alcance:** Afecta a `CONTEXT_AND_MEMORY.md` (§4 gestión de referencias).

### 3. Método Inexistente `provideApproval` y Coordinación con Persistencia en `core.ts`
- **Archivos y líneas:** `src/core/core.ts` (líneas 34–376), `src/server/jarvisRouter.ts` (líneas 126–147).
- **Qué dice la doc:** `ARCHITECTURE.md` (línea 90) lista en las responsabilidades de `core.ts` la "aprobación humana de Guard (provideApproval)... y coordinación con la persistencia".
- **Qué hace el código:** `provideApproval` no existe en `core.ts`. El router obtiene la aprobación pendiente vía `getPendingApproval` y llama directamente a los callbacks `onApprove()` o `onDeny(reason)` provistos en el objeto `PendingApproval`. Tampoco hay código de persistencia en `core.ts`.
- **Por qué es una inconsistencia:** Atribuye firmas y contratos falsos a la fachada principal del núcleo.
- **Alcance:** Afecta a `ARCHITECTURE.md` (§3 tabla de componentes).

### 4. Política ante Herramientas No Catalogadas en `Guard`
- **Archivos y líneas:** `src/core/policy/guard.ts` (líneas 9, 43–49), `src/core/tools/manifest.ts` (líneas 13–14), `src/core/callExecutor.ts` (líneas 161–167).
- **Qué dice la doc:** `ARCHITECTURE.md` (líneas 15, 100) declara que si una herramienta no está catalogada en el manifest se bloquea por defecto (`DENY`).
- **Qué hace el código:** `Guard.evaluate` retorna `APPROVAL` (pide confirmación humana), no `DENY`. Sin embargo, en el pipeline real (`callExecutor.ts`), las herramientas devueltas por los servidores MCP son filtradas previamente por `applyDestination`; cualquier herramienta no catalogada en el manifest es descartada antes de llegar a la selección o a Guard.
- **Por qué es una inconsistencia:** Se confunde el veredicto de fallback de `Guard` (`APPROVAL`) con un bloqueo terminal, ignorando el filtrado determinista previo en `applyDestination`.
- **Alcance:** Afecta a `ARCHITECTURE.md` (§1 principios) y `CORE_FLOW.md` (§4 pipeline).

### 5. Parámetros Numéricos Desalineados (Observaciones y Persistencia)
- **Archivos y líneas:** `src/core/types.ts` (línea 328), `src/core/persistence.ts` (línea 17).
- **Qué dice la doc:** Se mencionan límites de 1.500 caracteres para `compactObs` y debounce de 500 ms en persistencia.
- **Qué hace el código:** `MAX_EVIDENCE_OBS_CHARS = 2500` en `types.ts`; el debounce por defecto en `persistence.ts` es de 250 ms.
- **Por qué es una inconsistencia:** Desfase de constantes operativas entre la especificación y el código.
- **Alcance:** Afecta a `ARCHITECTURE.md` y `CONTEXT_AND_MEMORY.md`.

### 6. Resolución de Pasos `UNVERIFIED` y Cierre de Tarea
- **Archivos y líneas:** `src/core/modeEngines.ts` (líneas 87–94, 450–456, 632–642), `src/core/context.ts` (líneas 227–239).
- **Qué dice la doc:** `CORE_FLOW.md` (línea 179) señala genéricamente que la tarea no concluye si persisten pasos no verificados que no hayan sido observados por una lectura posterior.
- **Qué hace el código:** La regla difiere formalmente por modo:
  - En **FAST**: `hasUnresolvedUnverified` comprueba si existe una llamada exitosa posterior de tipo `READ` (`kind === "READ"`). Si no existe, `fin` es rechazado y se obliga a continuar la exploración.
  - En **PLAN**: Si el plan se queda sin pasos pendientes y existen pasos vigentes en estado `UNVERIFIED`, la tarea concluye controladamente como `PARTIAL`, nunca como `COMPLETED`.
- **Por qué es una inconsistencia:** Falta precisión sobre cómo cada modo gestiona la incertidumbre para determinar el cierre.
- **Alcance:** Afecta a `CORE_FLOW.md` (§2 estados, §3 dualidad).

---

## 3. Faltantes (Invariantes y Flujos No Documentados)

1. **Suspensión Interactiva por Preguntas al Usuario en Modo PLAN (`user_answer`):**
   - Cuando la verificación semántica de Qwen dictamina `insufficient_info`, si no se superó el límite (`MAX_USER_QUESTIONS_PER_STEP = 2`), la tarea se suspende en `WAITING_INPUT` con motivo `user_answer`. Al recibir la respuesta (`provideUserAnswer`), esta se almacena en `facts` (`answer_<stepId>`), se concatena a la instrucción del paso, el paso regresa a `PENDING` y se invalida el anti-bucle (`nonReadCounter++`).
2. **Atajo Determinista de Herramienta Única en Decision #2:**
   - Si un destino MCP contiene una sola herramienta catalogada (o si tras una exclusión queda una sola opción), se omite la llamada HTTP al modelo discriminativo y se despacha directamente con latencia 0 y marcador `single_tool_shortcut`.
3. **Mecanismo de Doble Juez en Modo PLAN:**
   - Eos actúa como primer juez sobre señales limpias. Si Eos rechaza o no está disponible, Qwen interviene como segundo juez semántico (`verifyStage`). El paso solo fracasa si ambos jueces fallan. En modo FAST solo juzga Eos.
4. **Almacenamiento Temporal de Observaciones de Lectura (`dataObs`):**
   - Se retienen hasta 3 observaciones de lecturas con datos útiles (`search`, `fetch`, `read_file`) en `context.dataObs`. Esto garantiza que llamadas intermedias posteriores (crear un directorio, ejecutar un proceso) no destruyan la información que un paso posterior necesita.
5. **Invariante de Mutaciones Consolidadas (`effects`):**
   - Toda mutación física confirmada en el entorno se registra en `effects` y nunca se descarta durante una replanificación, y sus hechos asociados en `facts` no sufren retracción.
6. **Compuerta de Validación de Fin en FAST:**
   - Decision #1 no puede cerrar una tarea arbitrariamente; `fin` solo se acepta si es la primera acción (consulta conversacional pura) o si existe al menos una llamada a herramienta exitosa previa y ninguna llamada `UNVERIFIED` pendiente.

---

## 4. Sobrantes (A Eliminar)

1. **Capas y Tecnologías de Frontend:** Eliminar del diagrama y del texto cualquier referencia a React 19, Tailwind CSS, Vite, componentes de UI y EventSource de navegador. La doc describe con exclusividad el backend.
2. **Persistencia Activa en Disco de Tareas:** Eliminar la afirmación de que el sistema guarda y recupera tareas desde `.jarvis/tasks.json` en tiempo de ejecución.
3. **Descarga a Disco de Referencias:** Eliminar la descripción de volcado de referencias a almacenamiento secundario y su purga en disco.
4. **Snippets de Código y Números de Línea:** Eliminar código embebido, firmas detalladas de funciones y justificaciones históricas.

---

## 5. Archivos Base Propuestos

Solo archivos estables y centrales del backend que actúan como contratos:
- `ARCHITECTURE.md`: `src/core/core.ts`, `src/core/modeEngines.ts`, `src/core/callExecutor.ts`, `src/core/decision.ts`, `src/core/reasoner/qwen.ts`, `src/core/tools/manifest.ts`, `src/core/policy/guard.ts`, `src/core/processor/resultProcessor.ts`, `src/core/processor/refResolver.ts`, `src/core/types.ts`, `src/server/jarvisRouter.ts`, `server.ts`.
- `CORE_FLOW.md`: `src/core/core.ts`, `src/core/modeEngines.ts`, `src/core/callExecutor.ts`, `src/core/decision.ts`, `src/core/reasoner/qwen.ts`, `src/core/policy/guard.ts`, `src/core/types.ts`.
- `CONTEXT_AND_MEMORY.md`: `src/core/context.ts`, `src/core/processor/resultProcessor.ts`, `src/core/processor/refResolver.ts`, `src/core/reasoner/prompts.ts`, `src/core/taskTrace.ts`, `src/core/types.ts`.

---

## 6. Cambios Propuestos por Documento

### `docs/ARCHITECTURE.md`
- **§1 Propósito:** Redactar en 2-3 líneas el rol del backend: sistema de asistencia y automatización local desacoplado, determinista y supervisado.
- **§2 Principios Invariantes:** Un solo núcleo de ejecución; plan como orquestador; desacoplamiento estricto entre clasificación factual (Eos), razonamiento (Qwen) y ejecución; seguridad fail-closed; aislamiento determinista de datos.
- **§3 Componentes:** Tabla completa `Componente | Responsabilidad | Qué NO hace` con los 12 módulos reales del backend.
- **§4 Dependencias entre Capas:** Definición formal de direcciones permitidas y prohibidas.
- **§5 Puntos de Extensión:** Protocolo para incorporar nuevas herramientas al manifest, nuevos destinos y adaptadores MCP respetando las invariantes.
- **§6 Archivos Base:** Lista canónica de rutas en `src/`.

### `docs/CORE_FLOW.md`
- **§1 Ciclo de Vida:** Secuencia numerada de pasos desde la llegada del HTTP POST al host hasta la emisión de eventos y cierre.
- **§2 Bucle Principal:** Mecánica iterativa, compuerta de `fin` en FAST, y condiciones de corte (`MAX_STEPS = 15`, bloqueos repetidos de bucle).
- **§3 Rol del Plan en el Flujo:** Generación inicial, suspensión para confirmación (`plan_confirmation`), ejecución paso a paso, doble verificación (Eos/Qwen), suspensión por información insuficiente (`user_answer`) y replanificación autónoma localizada.
- **§4 Estados y Transiciones:** Tabla canónica `Estado | Transición | Condición` cubriendo `RUNNING`, `WAITING_INPUT` (con sus 3 razones), `COMPLETED`, `PARTIAL`, `FAILED` y `CANCELLED`.
- **§5 Errores y Límites:** Políticas de reintento (transporte y schema), escalación en FAST con exclusión de herramientas, replanificación en PLAN y cotas numéricas.
- **§6 Invariantes del Flujo:** Invarianza de pasos completados, efectos acumulativos y degradación ante incertidumbre.
- **§7 Archivos Base:** Rutas estables correspondientes.

### `docs/CONTEXT_AND_MEMORY.md`
- **§1 Tipos de Contexto y Memoria:** Tabla `Tipo | Contenido | Alcance | Vida útil` detallando `Scratchpad`, `TaskMemory` (`log`, `facts`, `effects`, `fail`), `DataObservations`, `StepHandoff` y `RefStore`.
- **§2 Construcción del Contexto:** Orden determinista optimizado para prefix-caching, barrera de sanitización de etiquetas `<obs>` y selección de información activa.
- **§3 Límites y Política de Recorte:** Límites de caracteres (`MAX_EVIDENCE_OBS_CHARS = 2500`), política de preservación de cola (*tail preservation*), ventana de plan y expansión progresiva de memoria (tiers 2, 5, 10).
- **§4 Persistencia:** Especificación rigurosa de la realidad técnica: gestión de estado en memoria volátil acotada a 20 tareas en RAM; trazabilidad append-only en JSONL para auditoría externa sin reanudación de estado.
- **§5 Relación con el Núcleo y el Plan:** Matriz de lectura y escritura entre `JarvisCore`, `ModeEngines`, `CallExecutor` y los modelos.
- **§6 Invariantes:** Aislamiento ontológico, no re-ejecución destructiva, referencias deterministas e inmunidad de inyecciones.
- **§7 Archivos Base:** Rutas estables de memoria y contexto.

---

## 7. Preguntas Abiertas

Ninguna. La totalidad del comportamiento, contratos e invariantes del sistema quedó resuelta mediante el análisis exhaustivo del código fuente en `src/`.
