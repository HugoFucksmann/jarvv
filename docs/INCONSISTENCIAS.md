# Inconsistencias de JARVIS Core — Hallazgos Pendientes

> Última revisión: **2026-10-11**  
> Fuente de verdad: **Código fuente y comportamiento verificable del sistema**.  
> Estado general: **7 inconsistencias pendientes por resolver** (todas las inconsistencias previamente solventadas han sido retiradas de este informe).

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

---

## 2. Matriz de Hallazgos Pendientes

| ID | Tipo | Severidad | Estado | Ubicación Principal | Resumen del Hallazgo |
|---|------|-----------|--------|---------------------|----------------------|
| **#1** | `SEGURIDAD` | Media | Confirmada | `jarvis-config.json` / `config.ts:46` / `desktopCommanderMcp.ts:25,56` | `allowedDirectories` vacío por defecto desactiva la contención de rutas en el adaptador MCP. |
| **#3** | `SIN_REFERENCIAS` | Baja | Confirmada | `policyRegistry.ts:64` vs `free-search-mcp.md:26` | Política estática registrada para `download_document` (alias de `download`). |
| **#5** | `DUPLICACIÓN` | Baja | Confirmada | `decision.ts:146,228` | Retorno residual `{ multiStep: false }` deprecado en v2.1 mantenido en la firma de Decision #1. |
| **#6** | `DUPLICACIÓN` | Baja | Confirmada | `qwen.ts:141-152,618-644` | Wrappers legados (`generateChatResponse`, `synthesizeFinalResponse`) sin uso en el flujo activo. |
| **#7** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Confirmada | `WindowsMCP.md:44-57` vs `policyRegistry.ts:18-29` | Nombres de herramientas en `PolicyRegistry` divergen de la referencia upstream (mapeo documentado). |
| **#9** | `NOMBRE_VS_COMPORTAMIENTO` | Media | Confirmada | `types.ts:315-330` / `modeEngines.ts:305,451` / `callExecutor.ts:214,232` | El evento `STEP_COMPLETED` se emite cuando un paso entra a `RUNNING` o `WAITING_APPROVAL`. |
| **#13** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Confirmada | `Desktop CommanderMCP.md:18-59` vs `policyRegistry.ts:34-46` | Herramientas de Desktop Commander upstream mapeadas a claves locales en la documentación. |

---

## 3. Fichas Detalladas de Hallazgos Pendientes

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
  - `src/core/reasoner/qwen.ts`: interfaz `ILLMClient` (líneas 141-152) y métodos (líneas 618-644).
- **Condiciones necesarias:** Inspección de la clase `QwenEngine`.
- **Consecuencias observables:** Los métodos `generateChatResponse()` y `synthesizeFinalResponse()` están marcados como heredados y delegan directamente en `generateFinalResponse()`. Ningún bucle de ejecución autoritativo (`core.ts`, `modeEngines.ts`, `callExecutor.ts`) los utiliza.
- **Relación con otros hallazgos:** Independiente.
- **Corrección recomendada:** Deprecar formalmente y remover de la interfaz `ILLMClient`.

---

### Hallazgo #7 — Divergencia de nomenclatura entre Windows MCP upstream y PolicyRegistry
- **Estado de verificación:** Confirmada.
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

### Hallazgo #9 — Evento `STEP_COMPLETED` emitido en transiciones de inicio, pausa y ejecución
- **Estado de verificación:** Confirmada.
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

### Hallazgo #13 — Discrepancia en nomenclatura de herramientas en `Desktop CommanderMCP.md` vs `PolicyRegistry`
- **Estado de verificación:** Confirmada.
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Baja.
- **Archivos y líneas:**
  - `Desktop CommanderMCP.md`: líneas 18-59 (`interact_with_process`, `edit_block`, `start_search`, `get_more_search_results`, `get_config`).
  - `src/core/policy/policyRegistry.ts`: líneas 34-46 (`interact_process`, `edit_file`, `search_files`, `set_config`, `run_command`, `delete_file`).
- **Condiciones necesarias:** Conexión con un servidor Desktop Commander que reporte los nombres oficiales de su documentación.
- **Consecuencias observables:** Las herramientas documentadas como `edit_block` o `interact_with_process` no están en el mapa estático de políticas, cayendo en la heurística dinámica de nombres en `PolicyRegistry.getPolicy()`. Además, `run_command` y `delete_file` no figuran en la documentación de referencia pero sí en el código.
- **Relación con otros hallazgos:** Hallazgo #7.
- **Corrección recomendada:** Sincronizar el catálogo documentado en `Desktop CommanderMCP.md` con las herramientas reales manejadas por el adaptador.