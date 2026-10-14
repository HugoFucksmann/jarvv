# Inconsistencias de JARVIS Core — Registro de Hallazgos y Estado de Resolución

> Última revisión: **2026-10-13** (v1.3 — Actualización de Auditoría y Preparación de Fase 6)  
> Fuente de verdad: **Código fuente y comportamiento verificable del sistema**.  
> Estado general: **1 hallazgo cerrado formalmente**, **5 hallazgos calendarizados para limpieza/calibración en Fase 6**, y **1 decisión pendiente de preferencia de configuración**.

---

## 1. Convenciones y Metodología

### Tipos de inconsistencia
- `SEGURIDAD`: Riesgo de contención, evasión de políticas o autorización no restrictiva.
- `CONTRADICCIÓN`: Conflicto de contratos, tipos o comportamientos opuestos entre módulos.
- `ESTADO_Y_CONCURRENCIA`: Comportamientos anómalos en el ciclo de vida, persistencia o recuperación ante caídas.
- `NOMBRE_VS_COMPORTAMIENTO`: Nombres de eventos, herramientas o funciones que no reflejan su efecto real.
- `SIN_REFERENCIAS`: Código, métodos o almacenes de datos declarados que no se consumen ni referencian (código muerto).
- `DUPLICACIÓN`: Lógica residual o redundante mantenida de versiones previas.

### Criterios de severidad
- **Alta:** Riesgo de seguridad, corrupción de flujo, abortos inesperados de tareas o comportamiento técnico incorrecto.
- **Media:** Incongruencias entre contratos y runtime, efectos secundarios ocultos o asimetrías de ejecución entre modos.
- **Baja:** Código o métodos residuales, discrepancias de nomenclatura frente a referencias upstream o archivos de pruebas obsoletos.

---

## 2. Matriz de Hallazgos y Estado Actual

| ID | Tipo | Severidad | Estado en v1.3 | Ubicación Principal | Resumen del Hallazgo | Tratamiento en Fase 6 |
|:---:|:---:|:---:|:---:|---|---|---|
| **#1** | `SEGURIDAD` | Media | Abierta (Decisión) | `jarvis-config.json` / `config.ts:46` / `desktopCommanderMcp.ts:25,56` | `allowedDirectories: []` vacío por defecto desactiva la contención en el adaptador MCP, delegando la seguridad a Guard. | P2-1: Configurar `[process.cwd()]` por defecto. |
| **#3** | `SIN_REFERENCIAS` | Baja | ✅ **SOLVENTADA** | `policyRegistry.ts` vs `manifest.ts` | Herramienta `download_document` redundante en `PolicyRegistry`. | **Cerrada:** En Fase 1 `PolicyRegistry` se pobló desde `SYSTEM_TOOL_MANIFEST`, eliminando la entrada obsoleta. |
| **#5** | `DUPLICACIÓN` | Baja | Programada | `src/core/decision.ts:143,214` | Campo residual `multiStep: false` deprecado en v2.1 mantenido en retorno de Decision #1. | P0-2: Retirar propiedad residual del tipo y retorno. |
| **#6** | `DUPLICACIÓN` | Baja | Programada | `src/core/reasoner/qwen.ts:188,809` | Wrappers legados (`generateChatResponse`, `synthesizeFinalResponse`) sin invocadores activos. | P0-2: Remover métodos huérfanos de `ILLMClient`. |
| **#7** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Mitigada | `WindowsMCP.md` vs `manifest.ts:20-220` | Divergencia de nombres upstream (`app` vs `launch_app`, etc.). | Mitigada en Fase 1 con el manifiesto tipado de 21 herramientas Windows. |
| **#9** | `NOMBRE_VS_COMPORTAMIENTO` | Media | Programada | `types.ts:380`, `callExecutor.ts:306,330`, `modeEngines.ts:439,640` | `STEP_COMPLETED` se emite cuando un paso entra en `WAITING_APPROVAL` o regresa a `RUNNING`. | P1-1: Introducir `STEP_STATE_CHANGED` y reservar `STEP_COMPLETED` para finalizados. |
| **#13** | `NOMBRE_VS_COMPORTAMIENTO` | Baja | Mitigada | `Desktop CommanderMCP.md` vs `manifest.ts:225-475` | Nombres de Desktop Commander upstream mapeados a claves locales. | Mitigada en Fase 1 con las 26 herramientas tipadas en `SYSTEM_TOOL_MANIFEST`. |
| **#14** | `SIN_REFERENCIAS` | Baja | Programada (Nueva) | `decision.ts:225-313`, `prompts.ts:455-485` | Código muerto de Decision #5 (`evaluateDecisionFive` y `buildDecisionFive`) sin invocadores. | P0-2: Retirar método y prompts asociados sustituidos por Eos `ok`/`cumple`. |
| **#15** | `SIN_REFERENCIAS` | Baja | Programada (Nueva) | `qwen.ts:156,528-560`, `prompts.ts:31,90-115` | Código muerto de escalación en Qwen (`qwenEngine.escalate` y `PROMPTS.ESCALATION`) sin invocadores. | P0-2: Retirar método residual migrado a `handleEscalation` en código y Eos. |

---

## 3. Fichas Detalladas de Hallazgos Pendientes y Soluciones

### Hallazgo #1 — `allowedDirectories` vacío por defecto en Desktop Commander
- **Estado:** Abierta (Pendiente de preferencia del usuario).
- **Tipo:** `SEGURIDAD`.
- **Severidad:** Media.
- **Detalle Técnico:** En `desktopCommanderMcp.ts:56`, la comprobación `if (this.allowedDirectories.length > 0 && typeof candidatePath === "string")` solo restringe rutas si el arreglo no está vacío. Si está vacío (`[]`), el transporte MCP permite acceder a cualquier ruta del disco local, delegando la contención exclusivamente a las reglas dinámicas de Guard.
- **Solución Propuesta para Fase 6:** Fijar `allowedDirectories: [process.cwd()]` en `DEFAULT_CONFIG` y exponer el campo en `SettingsModal.tsx`.

---

### Hallazgo #3 — Herramienta `download_document` redundante en PolicyRegistry
- **Estado:** ✅ **SOLVENTADA Y CERRADA**.
- **Tipo:** `SIN_REFERENCIAS`.
- **Evidencia de Cierre:** En la Fase 1, `PolicyRegistry` fue refactorizado para poblarse automáticamente desde `SYSTEM_TOOL_MANIFEST` (`src/core/tools/manifest.ts:1-645`). En `manifest.ts:553`, la única herramienta registrada para descargas en Free Search es `download`. La entrada obsoleta `download_document` ya no existe en el mapa estático del registro.

---

### Hallazgo #5 — Campo residual `multiStep: false` en Decision #1
- **Estado:** Programada para Fase 6 (Tarea P0-2).
- **Tipo:** `DUPLICACIÓN`.
- **Severidad:** Baja.
- **Detalle Técnico:** `src/core/decision.ts:143, 214` retorna `multiStep: false` exclusivamente por compatibilidad con firmas antiguas de la UI. Ningún componente activo consume este campo.
- **Solución Propuesta para Fase 6:** Retirar el campo del tipo de retorno una vez auditado que ningún componente dependa de él.

---

### Hallazgo #6 — Wrappers heredados en QwenEngine
- **Estado:** Programada para Fase 6 (Tarea P0-2).
- **Tipo:** `DUPLICACIÓN`.
- **Severidad:** Baja.
- **Detalle Técnico:** `src/core/reasoner/qwen.ts:188-195, 809-835` declara `generateChatResponse()` y `synthesizeFinalResponse()`. Ambos delegan en `generateFinalResponse()` y ningún bucle de ejecución autoritativo los utiliza.
- **Solución Propuesta para Fase 6:** Retirar de `ILLMClient` y de `QwenEngine`.

---

### Hallazgo #9 — Semántica distorsionada del evento `STEP_COMPLETED`
- **Estado:** Programada para Fase 6 (Tarea P1-1).
- **Tipo:** `NOMBRE_VS_COMPORTAMIENTO`.
- **Severidad:** Media.
- **Detalle Técnico:** En `src/core/callExecutor.ts:306, 330` y `src/core/modeEngines.ts:439, 640`, se emite `deps.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id)` cuando el paso entra en `WAITING_APPROVAL` (pausa para autorización) o cuando regresa a `RUNNING` tras la autorización del usuario.
- **Solución Propuesta para Fase 6:** Incorporar el evento `STEP_STATE_CHANGED` en `src/core/types.ts` y emitirlo durante transiciones intermedias, reservando `STEP_COMPLETED` únicamente para pasos finalizados (`COMPLETED`, `FAILED` o `BLOCKED`).

---

### Hallazgos #14 y #15 (Nuevos) — Código muerto de Decision #5 y Escalación en Qwen
- **Estado:** Programada para Fase 6 (Tarea P0-2).
- **Tipo:** `SIN_REFERENCIAS`.
- **Severidad:** Baja.
- **Detalle Técnico:**
  - `evaluateDecisionFive` (`decision.ts:225`) y `buildDecisionFive` (`prompts.ts:455`) fueron sustituidos por la verificación binaria Eos (`ok` y `cumple`) en `runStep`, quedando sin invocadores.
  - `qwenEngine.escalate` (`qwen.ts:528`) y `PROMPTS.ESCALATION` (`prompts.ts:31`) fueron sustituidos por `handleEscalation` en `modeEngines.ts:119-197`, quedando huérfanos.
- **Solución Propuesta para Fase 6:** Eliminar las firmas y cuerpos de estos métodos en la limpieza de código muerto.
