# Inconsistencias de JARVIS Core — Informe de Auditoría Integral

> Última revisión: **2026-10-11**  
> Fuente de verdad: **Código fuente y comportamiento verificable del sistema**.  
> Estado general: **7 hallazgos previos auditados y confirmados · 7 nuevos hallazgos demostrados · 4 inconsistencias resueltas/cerradas**.

---

## 1. Convenciones y Metodología

### Tipos de inconsistencia
- `SEGURIDAD`: Riesgo de contención, evasión de políticas o autorización no restrictiva.
- `CONTRADICCIÓN`: Conflicto de contratos, tipos o comportamientos opuestos entre módulos.
- `ESTADO_Y_CONCURRENCIA`: Comportamientos anómalos en el ciclo de vida, persistencia o recuperación ante caídas.
- `NOMBRE_VS_COMPORTAMIENTO`: Nombres de eventos, herramientas o funciones que no reflejan su efecto real.
- `SIN_REFERENCIAS`: Código, métodos o almacenes de datos declarados que no se consumen ni referencian.
- `DUPLICACIÓN`: Lógica residual o redundante mantenida de versiones previas.

### Criterios de severidad
- **Alta:** Riesgo de seguridad, corrupción de flujo, abortos inesperados de tareas o comportamiento técnico incorrecto.
- **Media:** Incongruencias entre contratos y runtime, efectos secundarios ocultos o asimetrías de ejecución entre modos.
- **Baja:** Código o métodos residuales, discrepancias de nomenclatura frente a referencias upstream o archivos de pruebas obsoletos.

### Estados de verificación
- **Confirmada:** Evidencia directa e irrefutable en el código y flujos.
- **Parcialmente confirmada:** El problema existe pero su alcance o impacto difería de la hipótesis original.
- **Refutada / Cerrada:** El problema no existe, fue refutado por el código o ya fue corregido integralmente.
- **No verificable:** Falta de entorno o componentes externos para reproducir de forma concluyente.

---

## 2. Matriz General de Hallazgos

| ID | Tipo | Severidad | Estado | Ubicación Principal | Resumen del Hallazgo |
|---|------|-----------|--------|---------------------|----------------------|
| **#1** | `SEGURIDAD` | Media | Confirmada | `jarvis-config.json` / `config.ts:46` / `desktopCommanderMcp.ts:25,56` | `allowedDirectories` vacío por defecto desactiva la contención de rutas en el adaptador MCP. |
| **#2** | `CONTRADICCIÓN` | Media | Confirmada | `types.ts:27` vs `qwen.ts:38` vs `callExecutor.ts:82` | `StepRoute` incluye `"chat"`, excluido por `VALID_STEP_ROUTES` y redirigido a terminal local. |
| **#3** | `SIN_REFERENCIAS` | Baja | Confirmada | `policyRegistry.ts:64` vs `free-search-mcp.md:26` | Política estática registrada para `download_document` (inexistente en servidor upstream). |
| **#4** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Confirmada | `config.ts:97-99` / `qwen.ts:248-249` | Migración de `qwenModel === "qwen2.5:7b"` resetea a vacío omitiendo el modelo en el payload. |
| **#5** | `DUPLICACIÓN` | Baja | Confirmada | `decision.ts:146,228` | Retorno residual `{ multiStep: false }` deprecado en v2.1 mantenido en la firma de Decision #1. |
| **#6** | `DUPLICACIÓN` | Baja | Confirmada | `qwen.ts:142-152,618-644` | Wrappers legados (`generateChatResponse`, `synthesizeFinalResponse`) sin uso en el flujo activo. |
| **#7** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Confirmada | `WindowsMCP.md:44-57` vs `policyRegistry.ts:18-29` | Nombres de herramientas en `PolicyRegistry` (`ui_get_window_tree`, etc.) divergen de la referencia upstream (`ui_snapshot`, etc.). |
| **#8** | `CONTRADICCIÓN` | **Alta** | **Confirmada (Nueva)** | `modeEngines.ts:336-340` vs `modeEngines.ts:496-512` | Acciones `UNVERIFIED` son continuadas en FAST pero provocan fallo inmediato (`FAILED`) y replan en PLAN. |
| **#9** | `NOMBRE_VS_COMPORTAMIENTO` | Media | **Confirmada (Nueva)** | `types.ts:315-330` / `modeEngines.ts:305,451` / `callExecutor.ts:214,232` | El evento `STEP_COMPLETED` se emite cuando un paso entra a `RUNNING` o `WAITING_APPROVAL`. |
| **#10** | `SIN_REFERENCIAS` | Media | **Confirmada (Nueva)** | `resultProcessor.ts:29-66,189` / `server.ts` | `RefStore` almacena texto íntegro pero carece de método de consulta o endpoint de desreferenciación. |
| **#11** | `ESTADO_Y_CONCURRENCIA` | Media | **Confirmada (Nueva)** | `core.ts:224-261` / `useJarvis.ts:300` | Tareas en estado `RUNNING` persisten huérfanas tras reinicio del servidor sin reanudarse ni cerrarse. |
| **#12** | `CONTRADICCIÓN` | Media | **Confirmada (Nueva)** | `modeEngines.ts:433-526` vs `217-221` / `types.ts:189` | Modo PLAN no comprueba `MAX_TOOL_CALLS_TASK` a nivel de bucle y cae en replanificación ante el tope global. |
| **#13** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | **Confirmada (Nueva)** | `Desktop CommanderMCP.md:18-59` vs `policyRegistry.ts:34-46` | Herramientas de Desktop Commander (`edit_block`, `interact_with_process`) difieren de las registradas en código. |
| **#14** | `SIN_REFERENCIAS` | Baja | **Confirmada (Nueva)** | `/test-schema.ts:1-45` | Script de prueba con modelo y rutas obsoletas (`"chat"`) desacoplado de la arquitectura v2.1. |

---

## 3. Fichas Detalladas de Hallazgos

### Hallazgo #1 — `allowedDirectories` vacío por defecto en Desktop Commander
- **Estado de verificación:** Confirmada.
- **Tipo:** `SEGURIDAD`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `jarvis-config.json`: bloque `desktopCommanderMcp` no declara la propiedad.
  - `src/core/config.ts`: línea 46 (`allowedDirectories: []`).
  - `src/core/mcp/desktopCommanderMcp.ts`: líneas 25 y 56 (`if (this.allowedDirectories.length > 0 && typeof candidatePath === "string")`).
- **Condiciones necesarias:** Iniciar el sistema con la configuración predeterminada sin rutas autorizadas explícitas.
- **Consecuencias observables:** La validación de contención de rutas en el adaptador MCP queda inactiva, permitiendo interactuar con cualquier ruta del sistema de archivos a nivel de transporte MCP y delegando toda la barrera de seguridad a Guard. Además, `SettingsModal.tsx` no expone ningún campo para configurar este parámetro desde la UI.
- **Relación con otros hallazgos:** Se vincula con el Hallazgo #7 y #13 sobre configuración de MCPs.
- **Corrección recomendada:** Definir rutas iniciales seguras en `DEFAULT_CONFIG` (ej. `[process.cwd()]`) o requerir configuración explícita, y añadir el campo en `SettingsModal`.

---

### Hallazgo #2 — Tipo `StepRoute` incluye `"chat"` con redirección implícita a terminal
- **Estado de verificación:** Confirmada.
- **Tipo:** `CONTRADICCIÓN`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `src/core/types.ts`: línea 27 (`StepRoute = "fin" | "windows" | "desktop_commander" | "free_search" | "chat"`).
  - `src/core/reasoner/qwen.ts`: líneas 38-42 (`VALID_STEP_ROUTES = ["windows", "desktop_commander", "free_search"]`).
  - `src/core/callExecutor.ts`: líneas 82-84 (`if (serverName === "fin" || serverName === "chat") { serverName = "desktop_commander"; }`).
- **Condiciones necesarias:** Tipar o despachar una instrucción con ruta `"chat"`.
- **Consecuencias observables:** Divergencia formal de tipos entre `types.ts` y el runtime. Si un componente asigna la ruta `"chat"`, en lugar de activar un flujo conversacional, `callExecutor` redirige la petición al servidor de terminal y sistema de archivos local (`desktop_commander`).
- **Relación con otros hallazgos:** Relacionado con el script legado `test-schema.ts` (Hallazgo #14).
- **Corrección recomendada:** Remover `"chat"` del tipo `StepRoute` en `types.ts` y eliminar la redirección en `callExecutor.ts`.

---

### Hallazgo #3 — Herramienta `download_document` redundante en PolicyRegistry
- **Estado de verificación:** Confirmada.
- **Tipo:** `SIN_REFERENCIAS`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `src/core/policy/policyRegistry.ts`: línea 64 (`["free_search:download_document", { capability: "DOWNLOAD", requiresApproval: true ... }]`).
  - `free-search-mcp.md`: líneas 26-40 (la herramienta expuesta por el servidor oficial es únicamente `download`).
- **Condiciones necesarias:** Consulta de políticas de Free Search en `PolicyRegistry`.
- **Consecuencias observables:** Entrada estática en el mapa de políticas que no corresponde a ninguna herramienta real expuesta por el servidor upstream `sweetcornna/free-search-mcp`.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Eliminar la entrada `download_document` de `policyRegistry.ts` o mantenerla únicamente como alias documentado.

---

### Hallazgo #4 — Reseteo de `qwenModel` a cadena vacía ante `"qwen2.5:7b"`
- **Estado de verificación:** Confirmada.
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `src/core/config.ts`: líneas 97-99 y 105-107.
  - `src/core/reasoner/qwen.ts`: líneas 241, 248-249 (`...(modelName ? { model: modelName } : {})`).
- **Condiciones necesarias:** Cargar un archivo `jarvis-config.json` que contenga `"qwenModel": "qwen2.5:7b"`.
- **Consecuencias observables:** `loadConfig()` setea `parsed.qwenModel = ""` en lugar del nuevo valor por defecto (`"qwen3.5:9b"`). Al expandir `...parsed`, sobrescribe el default y queda como cadena vacía. En `qwen.ts`, al estar vacío, se omite el campo `model` en la petición a Ollama.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Migrar explícitamente `parsed.qwenModel = DEFAULT_CONFIG.qwenModel` en lugar de asignarle `""`.

---

### Hallazgo #5 — Campo `multiStep: false` deprecado en Decision #1
- **Estado de verificación:** Confirmada.
- **Tipo:** `DUPLICACIÓN`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `src/core/decision.ts`: líneas 146 y 228 (`multiStep: false, // multi_step query deprecated in v2.1 (§14)`).
- **Condiciones necesarias:** Invocación de `evaluateDecisionOne()`.
- **Consecuencias observables:** Retorno de una propiedad residual fija en el objeto resultante que no refleja ninguna consulta real realizada a Decision 2.0.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Retirar el campo del tipo de retorno una vez que ningún componente visual dependa de él.

---

### Hallazgo #6 — Wrappers heredados en QwenEngine
- **Estado de verificación:** Confirmada.
- **Tipo:** `DUPLICACIÓN`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `src/core/reasoner/qwen.ts`: interfaz `ILLMClient` (líneas 142-152) y métodos (líneas 618-644).
- **Condiciones necesarias:** Inspección de la clase `QwenEngine`.
- **Consecuencias observables:** Los métodos `generateChatResponse()` y `synthesizeFinalResponse()` están marcados como heredados y delegan directamente en `generateFinalResponse()`. Ningún bucle de ejecución autoritativo (`core.ts`, `modeEngines.ts`, `callExecutor.ts`) los utiliza.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Deprecar formalmente y remover de la interfaz `ILLMClient`.

---

### Hallazgo #7 — Divergencia de nomenclatura entre Windows MCP upstream y PolicyRegistry
- **Estado de verificación:** Confirmada (ampliada respecto al registro original).
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `WindowsMCP.md`: líneas 44-57 (`app`, `ui_snapshot`, `ui_find`, `ui_type`, `process`).
  - `src/core/policy/policyRegistry.ts`: líneas 18-29 (`ui_get_window_tree`, `launch_app`, `close_window`, `ui_search_elements`, `ui_type_text`).
  - `src/core/callExecutor.ts`: línea 264 (heurística regex `/tree|snapshot|window.*tree/i`).
- **Condiciones necesarias:** Conexión con una versión de Windows MCP que exponga nombres upstream como `ui_snapshot` o `app`.
- **Consecuencias observables:** Las herramientas no coinciden con las claves de `policyRegistry.ts`, por lo que el sistema debe recurrir a la heurística de herramientas desconocidas en `PolicyRegistry.getPolicy()` o a regex ad-hoc en `callExecutor.ts`.
- **Relación con otros hallazgos:** Hallazgo #13 (misma situación en Desktop Commander).
- **Corrección recomendada:** Incorporar alias bidireccionales en `PolicyRegistry` para cubrir tanto las versiones con prefijo como la especificación upstream.

---

### Hallazgo #8 — Manejo contradictorio de acciones `UNVERIFIED` entre modo FAST y modo PLAN
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `CONTRADICCIÓN`.
- **Severidad:** **Alta**.
- **Archivos y líneas:**
  - `src/core/callExecutor.ts`: líneas 362-369 (`if (processed.verification === "UNVERIFIED") return { status: "unverified", step }`).
  - `src/core/modeEngines.ts`:
    - FAST (`runFastLoop`, líneas 336-340): asigna `step.state = "UNVERIFIED"` y continúa la siguiente iteración.
    - PLAN (`runPlanLoop`, líneas 496-512): interrumpe el bucle (`break`) e inmediatamente ejecuta:
      ```ts
      if (!stepCompleted && !context.isCancelled) {
          step.state = "FAILED";
          step.error = step.error || "Paso falló o agotó calls sin cumplir criterio.";
          ...
          const replanSuccess = await handleReplan(context, stepIndex, deps);
      ```
- **Condiciones necesarias:** Ejecutar en modo PLAN una acción que despache un evento sin comprobación inmediata (ej. `ui_click` o `launch_app` en Windows).
- **Consecuencias observables:** Mientras que en modo FAST el estado `UNVERIFIED` es tolerado para permitir observaciones posteriores, en modo PLAN se sobrescribe inmediatamente como `FAILED`, provocando que el orquestador considere fallido el paso y fuerce una replanificación completa no deseada (`handleReplan`).
- **Relación con otros hallazgos:** Afecta directamente al flujo documentado en `CORE_FLOW.md`.
- **Corrección recomendada:** En `runPlanLoop`, distinguir `status === "unverified"` para permitir continuar la observación o evaluar juicio antes de marcar el paso como `FAILED`.

---

### Hallazgo #9 — Evento `STEP_COMPLETED` emitido en transiciones de inicio, pausa y ejecución
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `src/core/types.ts`: líneas 315-330 (`CoreEventType`).
  - `src/core/modeEngines.ts`:
    - FAST: línea 305 (emite `STEP_COMPLETED` apenas se crea el paso en `RUNNING`).
    - PLAN: línea 451 (emite `STEP_COMPLETED` cuando el paso pasa a `RUNNING`).
  - `src/core/callExecutor.ts`:
    - Línea 214: emite `STEP_COMPLETED` cuando el paso entra a `WAITING_APPROVAL`.
    - Línea 232: emite `STEP_COMPLETED` cuando el usuario aprueba y el paso vuelve a `RUNNING`.
- **Condiciones necesarias:** Suscripción al stream de eventos SSE (`/api/jarvis/events`).
- **Consecuencias observables:** Inconsistencia semántica grave: el evento denominado `"STEP_COMPLETED"` no representa la finalización de un paso, sino cualquier cambio de estado del mismo (iniciado, en espera de aprobación, aprobado, fallido o completado). Clientes externos no pueden interpretar el evento sin examinar el campo interno `data.step.state`.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Introducir los eventos `STEP_STARTED` y `STEP_STATE_CHANGED` en `CoreEventType` y reservar `STEP_COMPLETED` exclusivamente para pasos finalizados.

---

### Hallazgo #10 — `RefStore` almacena datos en memoria pero carece de método de recuperación
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `SIN_REFERENCIAS`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `src/core/processor/resultProcessor.ts`: líneas 29-66 (`RefStore`), línea 189 (`RefStore.put(fullText, taskId)`).
  - `src/core/core.ts` y `src/core/modeEngines.ts`: llamadas a `RefStore.clear(taskId)`.
  - `server.ts`: no expone ningún endpoint para consultar referencias.
- **Condiciones necesarias:** Ejecución de cualquier herramienta cuya salida genere una clave de referencia (ej. `r1`, `r2`).
- **Consecuencias observables:** `ResultProcessor` almacena texto íntegro en `RefStore` y produce identificadores `ref:rX` que se inyectan en los prompts (ej. `[... omitido, ref:r1]`). Sin embargo, el método `RefStore.get()` no se invoca en ningún punto del código, ni existe API REST ni herramienta que permita al modelo o al usuario consultar el contenido almacenado bajo dicha referencia.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Exponer un endpoint `/api/jarvis/task/:taskId/ref/:refKey` y permitir que el razonador solicite expansión de referencias si lo requiere.

---

### Hallazgo #11 — Tareas en estado `RUNNING` persisten huérfanas tras reinicio del servidor
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `ESTADO_Y_CONCURRENCIA`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `src/core/core.ts`: líneas 224-261 (`loadPersistedTasks()`).
  - `src/hooks/useJarvis.ts`: línea 300 (`isExecuting: task?.state === "RUNNING"`).
- **Condiciones necesarias:** Reiniciar el proceso del servidor mientras una tarea se encuentra en ejecución (`RUNNING`).
- **Consecuencias observables:** `loadPersistedTasks()` restaura la tarea tal como estaba guardada en `jarvis-tasks.json`, manteniendo su estado como `RUNNING`. Dado que el bucle de ejecución no se reanuda automáticamente tras el reinicio, la tarea queda en un estado zombi infinito en la UI, requiriendo intervención manual de cancelación.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Al cargar tareas en `loadPersistedTasks()`, actualizar cualquier tarea en estado `RUNNING` a `FAILED` o `CANCELLED` con el motivo `"Servidor reiniciado durante la ejecución"`.

---

### Hallazgo #12 — Modo PLAN no comprueba `MAX_TOOL_CALLS_TASK` a nivel de bucle
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `CONTRADICCIÓN`.
- **Severidad:** Media.
- **Archivos y líneas:**
  - `src/core/modeEngines.ts`: líneas 433-526 (`runPlanLoop`) vs líneas 217-221 (`runFastLoop`).
  - `src/core/callExecutor.ts`: líneas 236-245.
  - `src/core/types.ts`: línea 189 (`MAX_TOOL_CALLS_TASK = 30`).
- **Condiciones necesarias:** Alcanzar 30 llamadas a herramientas acumuladas dentro de una tarea en modo PLAN.
- **Consecuencias observables:** A diferencia de `runFastLoop`, que comprueba el límite antes de cada iteración y concluye la tarea limpiamente en `PARTIAL`, `runPlanLoop` no verifica este tope. La llamada es bloqueada en `callExecutor` retornando `status: "logical_error"`, lo que provoca que `runPlanLoop` interprete la detención como un error del paso y active una replanificación innecesaria (`handleReplan`) que también fallará.
- **Relación con otros hallazgos:** Se vincula con el Hallazgo #8 sobre asimetrías entre FAST y PLAN.
- **Corrección recomendada:** Añadir la comprobación `if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK)` al inicio de `runPlanLoop` para detener en `PARTIAL`.

---

### Hallazgo #13 — Discrepancia en nomenclatura de herramientas en `Desktop CommanderMCP.md` vs `PolicyRegistry`
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `Desktop CommanderMCP.md`: líneas 18-59 (`interact_with_process`, `edit_block`, `start_search`, `get_more_search_results`, `get_config`).
  - `src/core/policy/policyRegistry.ts`: líneas 34-46 (`interact_process`, `edit_file`, `search_files`, `set_config`, `run_command`, `delete_file`).
- **Condiciones necesarias:** Conexión con un servidor Desktop Commander que reporte los nombres oficiales de su documentación.
- **Consecuencias observables:** Las herramientas documentadas como `edit_block` o `interact_with_process` no están en el mapa estático de políticas, cayendo en la heurística dinámica de nombres en `PolicyRegistry.getPolicy()`. Además, `run_command` y `delete_file` no figuran en la documentación de referencia pero sí en el código.
- **Relación con otros hallazgos:** Hallazgo #7.
- **Corrección recomendada:** Sincronizar el catálogo documentado en `Desktop CommanderMCP.md` con las herramientas reales manejadas por el adaptador.

---

### Hallazgo #14 — Script `test-schema.ts` utiliza contratos obsoletos
- **Estado de verificación:** Confirmada (Nueva).
- **Tipo:** `SIN_REFERENCIAS`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `/test-schema.ts`: líneas 1-45.
- **Condiciones necesarias:** Inspección o ejecución del script de prueba en la raíz del proyecto.
- **Consecuencias observables:** El script prueba una llamada a `/v1/chat/completions` de Qwen forzando un esquema de rutas con `ROUTES = ["chat", "windows", "desktop_commander", "free_search"]`. En la arquitectura actual v2.1, Qwen no realiza enrutamiento categórico (tarea delegada a Decision 2.0 en Decision #1), ni existe la ruta `"chat"`.
- **Relación con otros hallazgos:** Hallazgo #2.
- **Corrección recomendada:** Actualizar el script para probar la generación de argumentos o planes, o eliminarlo si fue una prueba puntual fuera del pipeline.

---

## 4. Inconsistencias Resueltas / Cerradas

Las siguientes inconsistencias señaladas en revisiones previas fueron investigadas exhaustivamente y se encuentran formalmente cerradas:

1. **Discrepancia de modelo Decision 2.0 (Kai-0.6B vs Eos-0.8B):**
   - *Estado:* **Cerrada / Resuelta.**
   - *Evidencia:* Se eliminó toda mención a Kai en el código (`src/core/types.ts`, `src/core/decision.ts`), en los componentes de interfaz (`DecisionStream`, `DecisionOneView`, `SystemStatus`, `SettingsModal`) y en toda la documentación técnica de `docs/`. El sistema utiliza de manera estandarizada y exclusiva `Decision-2.0-Eos-0.8B`.
2. **Límite de ventana de Decision 2.0 (16.384 en doc vs 8.192 en código):**
   - *Estado:* **Cerrada / Resuelta.**
   - *Evidencia:* Se armonizó en `ARCHITECTURE.md` y `CONTEXT_AND_MEMORY.md` la distinción técnica: 16.384 tokens es la capacidad teórica máxima de la arquitectura nativa del modelo Eos, mientras que 8.192 tokens es el presupuesto operativo de runtime impuesto por el orquestador para prevenir desbordamientos y mantener latencias predecibles.
3. **Mocks ilustrativos de prompts y memoria:**
   - *Estado:* **Cerrada / Resuelta.**
   - *Evidencia:* Se verificó que en todos los archivos `.md` de `docs/` las rutas y módulos corresponden exactamente a archivos reales existentes en el repositorio (`src/core/reasoner/prompts.ts`, `src/core/context.ts`, etc.), sin rutas ficticias.
4. **Generación de gráfico de dependencias SVG:**
   - *Estado:* **Cerrada / Resuelta.**
   - *Evidencia:* Se retiró la dependencia de generación de SVG mediante Graphviz y se sustituyó por la validación formal de dependencias circulares mediante `madge` (0 ciclos circulares comprobados), documentada en `ARCHITECTURE.md`.