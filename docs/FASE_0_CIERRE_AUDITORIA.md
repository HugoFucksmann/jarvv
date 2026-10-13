# JARVIS Core — Cierre Formal de Fase 0: Auditoría de Contratos, Responsabilidades y Versiones de MCP

**Fecha:** 13 de octubre de 2026  
**Documento de Referencia:** `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md` (Fase 0)  
**Estado:** Fase 0 COMPLETADA Y VALIDADA  

---

## 1. Mapeo Formal de Responsabilidades de `runPlanLoop`

Conforme a la Sección 3.1 y los Criterios de Aceptación del Plan Maestro, se formaliza la división estricta de las responsabilidades que residían en `runPlanLoop` (`src/core/modeEngines.ts:452–555`):

### A. Responsabilidades de Ejecución (Absorbidas por `runStep` en Fase 3)
Estas responsabilidades pertenecen exclusivamente al ciclo de vida atómico del paso y no deben duplicarse en la capa PLAN:
1. **Selección de Herramienta y Validación de Catálogo:**
   - Selección determinista o delegada a Decision 2.0 Eos (`choice`).
   - Validación estricta contra herramientas descubiertas en runtime (`DiscoveryEngine`).
2. **Generación y Validación de Argumentos:**
   - Llamada a Qwen 3.5 9B para resolver argumentos complejos según el schema de la herramienta.
   - Validación estricta de schema y reintentos locales acotados (`MAX_ARG_RETRIES = 2`).
3. **Control Determinista de Políticas y Seguridad (Guard):**
   - Inspección de argumentos reales tras resolución de referencias.
   - Evaluación contra `PolicyRegistry` (`ALLOW`, `APPROVAL`, `DENY`).
   - Gestión de aprobación interactiva del usuario sin temporizador de expiración (`requestUserApproval`).
4. **Despacho Físico y Comunicación MCP:**
   - Envío por stdio al servidor correspondiente (`windows`, `desktop_commander`, `free_search`) o despacho a handlers locales.
   - Captura de errores de transporte y recuperación de elementos obsoletos (`stale_element` en UI).
5. **Detección de Bucles Infinitos (Anti-Loop):**
   - Rastreo de firmas con `nonReadCounter`. Bloqueo determinista de llamadas idénticas consecutivas.
6. **Procesamiento de Resultados y Extracción Factual:**
   - Digestión estructurada vía `ResultProcessor`.
   - Gestión de referencias volátiles en memoria (`RefStore`).
   - Actualización de `task.scratchpad` y `task.memory.facts`.
7. **Verificación Factual a Nivel de Paso:**
   - Veredictos técnicos limpios (`CLEAN`) vs errores (`exit_code !== 0`, `not_found`, etc.).
   - Veredictos semánticos `ok` y `cumple` evaluados por Eos mediante argmax sin umbrales arbitrarios.

---

### B. Responsabilidades de Coordinación (Permanecen en la Capa PLAN en Fase 3B)
Estas responsabilidades corresponden a la supervisión de alto nivel y no ejecutan herramientas directamente:
1. **Planificación Inicial en Etapas Operativas:**
   - Descomposición del objetivo del usuario en etapas secuenciales y verificables con Qwen.
   - Cada etapa define: `id`, `goal` operativo, `suggested_mcp` (opcional), dependencias y `expected_outcome` (criterio de éxito observable).
   - Inyección de catálogo compacto de capacidades sin sobrecargar la ventana de contexto (`QWEN_CTX = 8192`).
2. **Aprobación e Interacción con el Usuario:**
   - Presentación del plan antes de iniciar cualquier ejecución.
   - Estado `WAITING_INPUT` (`waitingReason: "plan_confirmation"`) sin timers de caducidad.
   - Soporte para: aceptación, solicitud de modificaciones (actualización del plan por Qwen y re-presentación), o rechazo (espera de nuevas instrucciones o cancelación).
3. **Entrega Secuencial y Supervisión de Etapas:**
   - Entrega de cada etapa al flujo unificado de ejecución `runStep`.
   - Recepción del `StepExecutionResult` y preservación de la invarianza de estados.
4. **Verificación Factual por Etapa con Qwen:**
   - Evaluación cualitativa del cumplimiento del objetivo de la etapa a partir de la evidencia observable generada por `runStep`.
   - Clasificación en las 4 situaciones normativas: (1) Etapa cumplida, (2) Desviación recuperable, (3) Información insuficiente, (4) Bloqueo o error no recuperable.
5. **Replanificación Acotada a Etapas Pendientes:**
   - Reformulación con Qwen de las etapas pendientes ante desviaciones recuperables (`MAX_REPLAN = 2`).
   - Preservación estricta del objetivo original y de las etapas previamente completadas.
6. **Evaluación de Cambio Material:**
   - Detección determinista de cambios de alto impacto que exigen nueva aprobación del usuario.

---

## 2. Auditoría y Confirmación de Contratos MCP

Contrastado directamente con `docs/MCP_TOOLS_SNAPSHOT.md`, los adaptadores de transporte y el runtime:

| Servidor MCP | Herramientas Documentadas Inicialmente | Herramientas Reales en Runtime | Variación y Estado |
| :--- | :---: | :---: | :--- |
| **Windows MCP (`windows`)** | 12 | **21** | +9 herramientas observadas en runtime (`Snapshot`, `Click`, `Type`, `Scroll`, `Move`, `Shortcut`, `Wait`, `WaitFor`, `Scrape`, `MultiSelect`, `MultiEdit`, `Clipboard`, `Process`, `Notification`, `Registry`, `PowerShell`, `FileSystem`, etc.). Requieren mapeo explícito en `PolicyRegistry` para evitar dependencia en heurísticas. |
| **Desktop Commander (`desktop_commander`)** | 12 | **26** | +14 herramientas en runtime (`read_multiple_files`, `write_pdf`, `create_directory`, `move_file`, `start_search`, `get_more_search_results`, `stop_search`, `list_searches`, `get_file_info`, `edit_block`, `start_process`, `force_terminate`, `list_sessions`, `list_processes`, etc.). |
| **Free Search (`free_search`)** | 14 | **11** | −3 herramientas. Se confirma fehacientemente que **`fetch_page`** y **`read_cached_resource` no existen upstream** en la versión `0.13.1`. Deben eliminarse de `PolicyRegistry`. |
| **Herramientas Locales Internas** | 0 | **3** | Se confirman las 3 herramientas locales (`recall`, `compose`, `ask_user`) que se integran al catálogo tipado sin requerir transporte stdio. |

---

## 3. Certificación de Criterio de Salida (Fase 0)

- [x] Mapeo de responsabilidades de `runPlanLoop` formalizado y dividido entre ejecución (`runStep`) y coordinación (`PLAN`).
- [x] Contratos MCP auditados contra el runtime real (21 Windows, 26 Desktop Commander, 11 Free Search, 3 Locales).
- [x] Ausencia de `fetch_page` y `read_cached_resource` confirmada.
- [x] Criterio de salida cumplido. Autorizado el paso a la **Fase 1**.
