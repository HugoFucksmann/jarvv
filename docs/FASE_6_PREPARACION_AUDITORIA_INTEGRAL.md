# JARVIS Core — Informe Integral de Auditoría Técnica y Preparación de Fase 6

**Documento:** `docs/FASE_6_PREPARACION_AUDITORIA_INTEGRAL.md`  
**Fecha de Inspección:** 13 de octubre de 2026  
**Tipo de Documento:** Auditoría técnica, arquitectónica, funcional, documental y matriz de preparación de Fase 6  
**Ámbito Auditado:** Repositorio completo de JARVIS (`src/`, `server.ts`, `docs/`, suites de pruebas, configuración, contratos MCP y runtime)  
**Estado General:** ✅ **SISTEMA ESTABLE Y OPERATIVO EN RUNTIME — APTO PARA FASE 6 CON PLAN DE CALIBRACIÓN Y DOCUMENTACIÓN**

---

## 1. Resumen Ejecutivo

### 1.1 Estado Real del Proyecto
El proyecto **JARVIS** es un asistente local orquestado con arquitectura desacoplada full-stack. El backend en Node.js/TypeScript (`server.ts`, `src/core/`) actúa como autoridad única de ejecución, coordinando modelos probabilísticos especializados (**Decision 2.0 / Eos-0.8B** para enrutamiento y verificación binaria por mayor probabilidad; **Qwen 3.5 9B** para generación de texto abierto, schemas JSON complejos, planificación estructurada y verificación semántica de etapas), compuertas deterministas (**Guard**, **Anti-Loop**, **ResultProcessor**, **RefResolver**) y servidores externos de herramientas mediante el protocolo **Model Context Protocol (MCP)** sobre transporte `stdio` (`windows-mcp`, `desktop-commander`, `free-search-mcp`), además de 3 herramientas locales (`recall`, `compose`, `ask_user`). La interfaz web está construida con **React 19** y **Vite 8**, sincronizada en tiempo real mediante **Server-Sent Events (SSE)** y polling reactivo de respaldo.

### 1.2 Contrastación de Antecedentes Declarados vs Evidencia en Código
En la auditoría técnica empírica se verificaron los resultados antecedentes reportados por las fases previas:
- **Compilación TypeScript (`tsc --noEmit` / `npm run lint`):** 0 errores de tipado.
- **Compilación de la aplicación (`vite build` / `compile_applet`):** Exitosa sin errores bloqueantes.
- **Dependencias circulares (`madge --circular src/`):** 53 archivos analizados, **0 dependencias circulares detectadas**.
- **Suite Fase 4 (`test-phase4.ts`):** 18/18 aserciones aprobadas en ejecución real.
- **Suite Fase 5 (`test-phase5.ts`):** 10/10 aserciones aprobadas en ejecución real.
- **Pruebas manuales de usuario:** Confirmadas como satisfactorias en escenarios de operación habitual.

### 1.3 Nivel de Preparación para la Fase 6
El sistema se encuentra en un estado funcional robusto y no presenta bloqueantes que impidan la preparación o ejecución de la Fase 6. Sin embargo, la auditoría ha identificado brechas técnicas críticas en cuatro áreas que deben subsanarse en Fase 6:
1. **Desactualización documental severa:** La totalidad de los documentos vivos de arquitectura en `docs/` (`ARCHITECTURE.md`, `CORE_FLOW.md`, `CONTEXT_AND_MEMORY.md`, `TOOLS_AND_SECURITY.md`, `CODEBASE_MAP.md`) se encuentran congelados en revisiones del **2026-10-11** (previas a la migración v1.3). Describen componentes ya eliminados (como Decision #5, mini-bucles de 4 llamadas por paso, límite global de 30 llamadas, colapso estadístico de `LOG` a `1-N`, herramientas MCP extintas como `fetch_page` y escalación por Qwen).
2. **Código muerto y remanentes legados:** Existen métodos y prompts deprecados que carecen de llamadas activas en el runtime (`evaluateDecisionFive`, `DECISION_PROMPTS.buildDecisionFive`, `qwenEngine.escalate`, `PROMPTS.ESCALATION`, `generateChatResponse`, `synthesizeFinalResponse`, y el campo residual `multiStep: false` en Decision #1).
3. **Calidad de la cobertura de pruebas:** Mientras que `test-phase4.ts` evalúa lógica runtime de forma sustantiva, 7 de las 10 pruebas de `test-phase5.ts` son aserciones tautológicas sobre literales declarados en memoria dentro del propio script, sin cubrir el flujo HTTP/SSE o renderizado de componentes reales.
4. **Inconsistencias semánticas:** El evento SSE `STEP_COMPLETED` se emite indebidamente en transiciones intermedias (`WAITING_APPROVAL` o regreso a `RUNNING`), desvirtuando su significado como evento de finalización.

---

## 2. Mapa de Arquitectura Basado en Código Real

```
                             ┌───────────────────────────────────────────────┐
                             │              CAPA DE PRESENTACIÓN             │
                             │       (React 19 / Vite 8 / Tailwind CSS)      │
                             └───────┬───────────────────────────────▲───────┘
                                     │ HTTP REST                     │ SSE
                                     │ (/api/jarvis/*, /api/mcp/*)   │ (/api/jarvis/events)
                                     ▼                               │
                             ┌───────────────────────────────────────┴───────┐
                             │            HOST AUTORITATIVO BACKEND          │
                             │             (Express 4 / server.ts)           │
                             └───────────────────────┬───────────────────────┘
                                                     │
                                                     ▼
                             ┌───────────────────────────────────────────────┐
                             │                  JARVIS CORE                  │
                             │       (JarvisCore en src/core/core.ts)        │
                             │  • Aislamiento por taskId                     │
                             │  • Invarianza de estados terminales           │
                             │  • Persistencia mínima (jarvis-tasks.json)    │
                             │  • Cancelación simple y canal de eventos SSE │
                             └───────┬───────────────────────────────┬───────┘
                                     │                               │
                      Modo FAST      ▼                               ▼  Modo PLAN
                 ┌───────────────────────────────┐   ┌───────────────────────────────┐
                 │      runFastLoop (Motor)      │   │     runPlanLoop (Coordinador) │
                 │ • Bucle de iteración de pasos │   │ • Planificación estructurada  │
                 │ • Selección de ruta (Eos D1)  │   │ • Aprobación WAITING_INPUT    │
                 │ • Escalación acotada (Eos/cód)│   │ • Verif. de etapa (verifyStage)│
                 │ • Parada en MAX_STEPS = 15    │   │ • Replan material (<= 2)      │
                 └───────────────┬───────────────┘   └───────────────┬───────────────┘
                                 │                                   │ Entrega cada etapa
                                 │       CANALIZACIÓN UNIFICADA      │ al flujo FAST
                                 └───────────────────┬───────────────┘
                                                     ▼
                             ┌───────────────────────────────────────────────┐
                             │             MOTOR UNIFICADO runStep           │
                             │          (src/core/callExecutor.ts)           │
                             ├───────────────────────────────────────────────┤
                             │ 1. Selección tool: Catálogo activo / Eos D2   │
                             │ 2. Generación args: Qwen 3.5 9B (schema puro) │
                             │ 3. Sustitución ref: RefResolver ({{ref:rX}})  │
                             │ 4. Anti-Loop: Firma binaria + nonReadCounter  │
                             │ 5. Seguridad: Guard (ALLOW / APPROVAL / DENY) │
                             │ 6. Despacho físico: stdio a servidores MCP    │
                             │ 7. Recuperación: Stale element en Windows     │
                             │ 8. Extracción: ResultProcessor & RefStore     │
                             │ 9. Verificación: Eos ok / cumple (argmax)     │
                             └───────┬───────────────┬───────────────┬───────┘
                                     │               │               │
            ┌────────────────────────┘               │               └────────────────────────┐
            ▼                                        ▼                                        ▼
┌───────────────────────┐        ┌───────────────────────┐        ┌───────────────────────┐
│     DECISION 2.0      │        │       QWEN 3.5        │        │     SERVIDORES MCP    │
│      (Eos-0.8B)       │        │         (9B)          │        │      (Transporte)     │
├───────────────────────┤        ├───────────────────────┤        ├───────────────────────┤
│ • D1: Sub-sistema     │        │ • Generación args     │        │ • Windows MCP (21 t.) │
│   (windows/dc/fs/fin) │        │ • Planificación PLAN  │        │ • Desktop Cmd (26 t.) │
│ • D2: Selección tool  │        │ • Verif. verifyStage  │        │ • Free Search (11 t.) │
│ • Verif. ok / cumple  │        │ • Replanificación     │        │ • Herramientas locales│
│   ($p \ge 0.5$, argmax│        │ • Herramienta compose │        │   (recall, compose,   │
│ • Arbitraje escalación│        │ • Respuesta final     │        │    ask_user)          │
└───────────────────────┘        └───────────────────────┘        └───────────────────────┘
```

### 2.1 Subsistemas y Responsabilidades

| Subsistema | Archivos Clave | Responsabilidad Primaria | Relación con otros Subsistemas |
|---|---|---|---|
| **Host HTTP & API** | `server.ts` | Expone endpoints REST (`/api/jarvis/*`, `/api/mcp/*`), canal SSE (`/api/jarvis/events`), shutdown ordenado (`SIGINT`/`SIGTERM`) cerrando subprocesos hijos. | Recibe peticiones de React, delega a `JarvisCore` y transmite eventos reactivos. |
| **Orquestador Central** | `src/core/core.ts` | Coordina ciclo de vida de tareas, concurrencia aislada por `taskId`, invarianza de estados terminales, persistencia en `jarvis-tasks.json` y despacho de eventos. | Inicializa y administra contextos de ejecución (`TaskExecutionContext`); invoca `runFastLoop` o `runPlanLoop`. |
| **Motor Unificado de Paso** | `src/core/callExecutor.ts` (`runStep`) | Bucle atómico canónico: resuelve herramientas, genera argumentos, sustituye referencias temporales, verifica anti-loop, evalúa políticas Guard, despacha al MCP, procesa resultados y verifica con Eos (`ok` / `cumple`). | Invocado directamente por `runFastLoop` y por `runPlanLoop` para cada etapa. |
| **Coordinación de Modos** | `src/core/modeEngines.ts` | `runFastLoop`: orquesta iteraciones de pasos, escalación y finalización. `initiatePlanMode` / `runPlanLoop`: coordina planificación, suspensión en `WAITING_INPUT`, supervisión de etapas, verificación con Qwen (`verifyStage`) y replanificación acotada (`handleReplan`). | Conecta la intención del usuario con `runStep`. Respeta `MAX_STEPS = 15` y `MAX_REPLAN = 2`. |
| **Modelos de Decisión** | `src/core/decision.ts` | Cliente HTTP hacia Decision 2.0 (Eos-0.8B). Resuelve Decision #1 (rutas), Decision #2 (herramienta) y verificación binaria (`ok`, `cumple`) por argmax sin umbrales arbitrarios. | Consumido por `runStep` y `handleEscalation`. |
| **Razonador LLM** | `src/core/reasoner/qwen.ts`, `prompts.ts` | Cliente HTTP hacia Ollama (Qwen 3.5 9B). Genera argumentos JSON estrictos, planes estructurados, replanteos, verificación semántica de etapas y síntesis de respuesta final. | Consumido por `runStep`, `modeEngines.ts` y `core.ts`. |
| **Seguridad y Políticas** | `src/core/policy/guard.ts`, `policyRegistry.ts`, `manifest.ts` | `PolicyRegistry` asigna capacidades deterministas desde `SYSTEM_TOOL_MANIFEST`. `Guard` evalúa `ALLOW`, `APPROVAL` (suspensión ilimitada en `WAITING_INPUT`) o `DENY` sobre argumentos reales post-resolución. | Barrera obligatoria previa a cualquier despacho stdio en `runStep`. |
| **Manejo Factual y Referencias** | `src/core/processor/resultProcessor.ts`, `refResolver.ts` | `ResultProcessor` extrae hechos, señales y observaciones compactas. `RefStore` almacena textos completos en memoria volátil aislada por `taskId`. `RefResolver` sustituye tokens `{{ref:rX}}` de forma recursiva. | Alimenta la memoria continua, hechos deterministas y handoffs entre etapas. |
| **Capa de Transporte MCP** | `src/core/mcp/*` (`transport.ts`, `discovery.ts`, adaptadores) | Controla procesos persistentes `stdio` con JSON-RPC 2.0, descubrimiento dinámico de herramientas y normalización de esquemas. | Ejecuta comandos reales sobre el sistema operativo y la red. |
| **Capa UI y Estado Reactivo** | `src/App.tsx`, `src/components/*`, `useJarvis.ts` | Renderiza `CommandSection`, `GuardBanner`, `DecisionStream`, `ProcessFlow`, `ContextInspector` y `SettingsModal`. Consume SSE y polling de respaldo. | Refleja el estado unificado del backend y emite acciones del operador. |

---

## 3. Matriz de Cumplimiento del Plan de Migración (Fases 0 a 5)

La siguiente matriz contrasta los requisitos establecidos en `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md` con la implementación real comprobada en el repositorio:

| Fase | Objetivo Original | Implementación Real en Código | Evidencia Comprobada | Estado | Brechas Detectadas | Acción Necesaria |
|---|---|---|---|:---:|---|---|
| **Fase 0: Auditoría de Contratos y MCP** | Auditar componentes, dividir responsabilidades de `runPlanLoop` (ejecución vs coordinación) y contrastar catálogo MCP real. | Responsabilidades formalmente divididas: ejecución en `runStep` y coordinación en `PLAN`. Catálogo contrastado (21 Windows, 26 DC, 11 FS, 3 locales). | `docs/FASE_0_CIERRE_AUDITORIA.md`, `src/core/modeEngines.ts`, `src/core/tools/manifest.ts`. | **VERIFICADO** | Ninguna brecha funcional en código. `docs/TOOLS_AND_SECURITY.md` retuvo conteos desactualizados. | Sincronizar documentación viva en Fase 6. |
| **Fase 1: Manifiesto de Herramientas** | Establecer fuente única tipada de herramientas, sincronizar `PolicyRegistry` y crear catálogo compacto para Qwen. | Manifiesto `SYSTEM_TOOL_MANIFEST` creado (61 herramientas tipadas). `PolicyRegistry` poblado desde el manifiesto. Extractor `buildCompactCatalog` activo. | `src/core/tools/manifest.ts:1-645`, `src/core/policy/policyRegistry.ts:14-21`. | **VERIFICADO** | En `INCONSISTENCIAS.md`, el Hallazgo #3 figuraba erróneamente como pendiente. | Cerrar Hallazgo #3 en `docs/INCONSISTENCIAS.md`. |
| **Fase 2: Erradicación de Límites y Memoria Progresiva** | Suprimir límites artificiales (30 calls/tarea, 4 calls/paso, mini-bucles), cancelar simple e implementar memoria progresiva (2→5→10). | `MAX_TOOL_CALLS_TASK` y `MAX_TOOL_CALLS_PER_STEP` eliminados. Parada gobernada por `MAX_STEPS = 15`. Memoria progresiva conectada a `needsContext`. Invarianza de estados terminales implementada. | `src/core/types.ts:186-215`, `src/core/context.ts:135-165`, `src/core/core.ts:167-192`, `docs/FASE_2_CIERRE_AUDITORIA.md`. | **VERIFICADO** | Textos residuales en UI fueron corregidos en Fase 5. Ninguna brecha funcional. | Ninguna acción técnica; documentar en cierre. |
| **Fase 3: Motor Unificado (`runStep`) e Integración Eos** | Unificar ejecución atómica en `runStep`, suprimir Decision #5, resolver por mayor probabilidad (argmax) sin umbrales y migrar escalación a código/Eos. | `runStep` centraliza selección, args, Guard, anti-loop, despacho y veredicto. Eos opera por argmax binario ($p \ge 0.5$). `handleEscalation` opera en código y Eos. `WAITING_INPUT` sin timers. | `src/core/callExecutor.ts:112-550`, `src/core/decision.ts:180-218, 320-368`, `src/core/modeEngines.ts:119-197`. | **VERIFICADO** | `evaluateDecisionFive`, `buildDecisionFive` y `qwenEngine.escalate` quedaron como código muerto residual. | Retirar formalmente código muerto en Fase 6. |
| **Fase 3B: Capa de Coordinación del Modo PLAN** | Implementar PLAN como coordinador sobre `runStep`. Soportar confirmación/rechazo/modificación en `WAITING_INPUT`, verificación con Qwen (`verifyStage`) y replan por materialidad. | PLAN descompone en etapas y entrega cada una a `runStep`. Endpoints `/confirm-plan`, `/reject-plan`, `/modify-plan`, `/user-answer` operativos. Verificación de 4 situaciones y regla `isMaterialReplan`. | `src/core/modeEngines.ts:205-300, 593-765`, `src/core/core.ts:194-285`, `server.ts:150-215`. | **VERIFICADO** | Ninguna brecha funcional en el runtime. | Documentar formalmente el flujo de PLAN en `CORE_FLOW.md`. |
| **Fase 4: Manejo Factual y Referencias Temporales** | Sustituir referencias `{{ref:rX}}` antes de Guard, consolidar LOG continuo (30 líneas), registrar `effects`, handoff determinista y dependencias. | `resolveReferences` resuelve tokens antes de Guard. LOG preserva hasta 30 entradas sin resumen `1-N`. `effects` acumulados en memoria. `applyStepHandoff` inyecta hechos y refs en pasos dependientes. | `src/core/processor/refResolver.ts:1-124`, `src/core/context.ts:60-70, 182-211`, `test-phase4.ts:1-131` (18/18). | **VERIFICADO** | Ninguna brecha en runtime ni en pruebas unitarias de Fase 4. | Ninguna acción técnica. |
| **Fase 5: UI y Sincronización en Tiempo Real** | Visualizar veredictos Eos (`ok`/`cumple`), exponer `effects`, handoffs, facts y `RefStore` en inspector, banner sin timeout y ciclo interactivo PLAN. | `DecisionVerificationView` renderiza veredictos Eos. `MemoryView` inspecciona `RefStore` vía `/api/jarvis/ref/:refKey`. `GuardBanner` soporta `user_answer`. `PlanReview` soporta confirm/reject/modify. | `src/components/DecisionStream/components/DecisionVerificationView.tsx`, `MemoryView.tsx`, `GuardBanner.tsx`, `PlanReview.tsx`. | **VERIFICADO** | La suite `test-phase5.ts` contiene pruebas superficiales sobre mocks locales y no sobre componentes o endpoints reales. | Diseñar e incorporar pruebas de integración rigurosas en Fase 6. |

---

## 4. Auditoría del Sistema Operativo de JARVIS

### 4.1 Ciclo de Vida del Modo FAST vs Modo PLAN
1. **Modo FAST:**
   - Orquestado por `runFastLoop` (`src/core/modeEngines.ts:375-495`).
   - Para cada paso, consulta Decision #1 (`evaluateDecisionOne`) para determinar la ruta (`windows`, `desktop_commander`, `free_search` o `fin`).
   - Si la ruta es una herramienta, invoca de manera atómica a `runStep`.
   - Si `runStep` concluye con éxito, avanza. Si falla, invoca `handleEscalation` (máx. `MAX_ESCALATIONS = 2`).
   - Si `Guard` emite `DENY` o el usuario deniega, la tarea se detiene de forma inmediata (`signals.denied === true`) sin conmutar ni reintentar.
   - Si Eos emite `fin`, valida condiciones de completitud y genera la respuesta final con Qwen (`generateFinalResponse`).
   - Límite estructural verificado: `task.stepSeq >= MAX_STEPS (15)` transiciona la tarea a `PARTIAL`.

2. **Modo PLAN:**
   - Orquestado por `initiatePlanMode` y `runPlanLoop` (`src/core/modeEngines.ts:500-765`).
   - Qwen genera un plan estructurado de hasta 15 etapas basándose en el catálogo compacto (`buildCompactCatalog`).
   - La tarea entra en `WAITING_INPUT` (`waitingReason: "plan_confirmation"`), sin temporizadores.
   - Tras la aprobación del operador (`confirmPlan`), `runPlanLoop` itera secuencialmente sobre las etapas no sustituidas (`superseded === false`).
   - **Validación de dependencias:** Antes de despachar una etapa, verifica que sus `dependencies` previas estén en `COMPLETED`. Si alguna falló o fue omitida, activa la replanificación acotada (`handleReplan`).
   - Cada etapa se delega limpia y atómicamente a `runStep`.
   - **Verificación semántica (`verifyStage`):** Tras la ejecución técnica, Qwen evalúa la evidencia observable del paso contra `step.expectedOutcome`, clasificando el resultado en una de 4 situaciones normativas:
     - `completed`: avanza a la siguiente etapa.
     - `recoverable_deviation`: activa `handleReplan` (acotado por `MAX_REPLAN = 2`).
     - `insufficient_info`: suspende la tarea en `WAITING_INPUT` (`waitingReason: "user_answer"`).
     - `unrecoverable_blocked`: marca el paso como `BLOCKED` y concluye la tarea como `PARTIAL` o `FAILED`.
   - **Regla determinista de cambio material (`isMaterialReplan`):** Si la replanificación incluye herramientas sensibles que requieren autorización en Guard, agrega más de 3 pasos o altera el objetivo, suspende la tarea en `WAITING_INPUT` para nueva aprobación humana. De lo contrario, continúa de forma autónoma.
   - **Inviolabilidad de Guard:** Si una etapa es denegada (`signals.denied || step.state === "BLOCKED"`), la tarea concluye de inmediato y queda estrictamente prohibido replanificar.

### 4.2 Verificación de Límites Operativos
| Límite | Valor Documentado | Valor en Código | Archivo y Línea | Comportamiento Comprobado |
|---|:---:|:---:|---|---|
| `MAX_STEPS` | 15 | 15 | `src/core/types.ts:186` | FAST y PLAN detienen la ejecución cuando `task.stepSeq >= 15` marcando la tarea como `PARTIAL`. |
| `MAX_REPLAN` | 2 | 2 | `src/core/types.ts:192` | `handleReplan` aborta y concluye como `PARTIAL` si `task.replans >= 2`. |
| `MAX_ARG_RETRIES` | 2 | 2 | `src/core/types.ts:193` | `generateArguments` reintenta hasta 2 veces ante fallos de formato o validación de schema. |
| `MAX_ESCALATIONS` | 2 | 2 | `src/core/types.ts:194` | `handleEscalation` detiene la tarea como `PARTIAL` si se agotan 2 conmutaciones de ruta en FAST. |
| `PROG_MEM` | 2 → 5 → 10 | 2, 5, 10 | `src/core/types.ts:200` | Nivel inicial en 2; ampliado a 5 ante `needsContext`; techo absoluto en 10 elementos relevantes. |
| `MAX_TOOL_CALLS_TASK` | Erradicado | — | `src/core/types.ts` | Eliminado en Fase 2. Solo se conserva `context.totalToolCalls++` como contador métrico de telemetría. |
| `MAX_TOOL_CALLS_PER_STEP` | Erradicado | — | `src/core/types.ts` | Eliminado en Fase 2. Mini-bucles de llamadas por paso suprimidos. |

---

## 5. Auditoría de la Interfaz y Sincronización en Tiempo Real

### 5.1 Componentes e Integración con Backend
1. **`DecisionVerificationView`:**
   - Renderiza fielmente los veredictos de Eos (`ok` y `cumple`), el estado de las señales físicas (`Limpias (CLEAN)` vs `Con anomalías`), las probabilidades porcentuales calculadas y el texto de hallazgo procesado (`processed.finding`).
   - Ubicación: `src/components/DecisionStream/components/DecisionVerificationView.tsx`.
2. **`ContextInspector` y `MemoryView`:**
   - Expone las 4 dimensiones de la memoria operativa:
     - `LOG` continuo con hasta 30 líneas completas.
     - `FACTS` con pares clave-valor extraídos deterministamente (`path`, `win`, `pid`, `url`, `cand`).
     - `EFFECTS` con el historial de mutaciones confirmadas sobre el entorno.
     - `FAIL` con las causas de error o denegaciones.
   - **Inspección de `RefStore`:** Enlace directo interactivo a través de `jarvisApi.getRef(refKey, taskId)`, permitiendo visualizar en un modal el contenido textual completo (logs, outputs masivos) sin sobrecargar la UI principal.
3. **`GuardBanner` y `ApprovalAction`:**
   - Suspensión indefinida en `WAITING_INPUT` sin timers de expiración.
   - Atajos seguros de teclado (`Y` para aprobar, `N` para denegar) con protección frente a inputs de texto enfocados.
   - Formulario interactivo integrado para `user_answer`, permitiendo al usuario responder preguntas de JARVIS y reanudar el flujo.
4. **`ProcessFlow`, `PlanReview` y `StepItem`:**
   - Visualización uniforme de la línea de tiempo.
   - Cada etapa expone dependencias (`deps: [s1]`), herramientas sugeridas/candidatas, criterios observables (`Esperado: ...`), bloques de `Handoff` determinista y etapas descartadas con etiqueta `SUPERSEDED (rev X)`.
   - `PlanReview` ofrece los controles interactivos para Confirmar, Rechazar (con motivo) y Solicitar Modificación (con feedback a Qwen).

### 5.2 Canal de Comunicación y Eventos
- El backend emite eventos mediante `deps.emitEvent(taskId, type, data, stepId)`.
- En `server.ts:270-305`, el endpoint `/api/jarvis/events` transmite eventos vía SSE encapsulando `{ event, task: updatedTask, pendingApproval: rawPending }`.
- En el cliente (`useJarvis.ts`), la suscripción SSE actualiza el estado reactivo inmediatamente, respaldado por un polling de contingencia cada 5000 ms si la conexión SSE se interrumpe.
- **Discrepancia detectada:** El evento `STEP_COMPLETED` se dispara en múltiples ocasiones durante el ciclo de vida de un mismo paso (cuando pasa a `WAITING_APPROVAL`, cuando regresa a `RUNNING` tras la aprobación y cuando finaliza). Aunque la UI actual maneja esto actualizando el objeto `step`, la semántica del evento está distorsionada (ver Hallazgo #9).

---

## 6. Auditoría de Calidad Técnica y Arquitectura

### 6.1 Clasificación de Hallazgos Técnicos

```
                                 HALLAZGOS TÉCNICOS AUDITADOS
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               ▼                               ▼                               ▼
       DEFECTOS COMPROBADOS            RIESGOS PLAUSIBLES               MEJORAS OPCIONALES
       • Código muerto (D5,            • allowedDirectories vacío       • Nomenclatura de
         qwen.escalate, wrappers)        por defecto en adapter           herramientas upstream
       • Evento STEP_COMPLETED         • Cobertura superficial en       • SettingsModal para
         con semántica errónea           test-phase5.ts                   allowedDirectories
       • Documentación viva            • Persistencia de RefStore       • Refactorización de
         desactualizada (11-Oct)         volátil ante reinicios           tipos multiStep
```

### 6.2 Detalle de Hallazgos Comprobados (Defectos Reales)

#### D-01: Código Muerto de Decision #5 y Prompts Asociados
- **Ubicación:** `src/core/decision.ts:225-313` (`evaluateDecisionFive`), `src/core/reasoner/prompts.ts:455-485` (`DECISION_PROMPTS.buildDecisionFive`).
- **Evidencia:** Una búsqueda exhaustiva en todo el repositorio (`grep -rn "evaluateDecisionFive" src/`) demostró que **no existe ningún invocador activo** en el código. Decision #5 fue formalmente sustituida en Fase 3 por `evaluateStepVerification` (`ok` / `cumple`), pero el código residual no fue retirado.
- **Riesgo:** Confusión para futuros mantenedores, aumento innecesario del tamaño del bundle y contradicción con los principios de código limpio.

#### D-02: Código Muerto de Escalación en QwenEngine
- **Ubicación:** `src/core/reasoner/qwen.ts:156, 528-560` (`qwenEngine.escalate`), `src/core/reasoner/prompts.ts:31-33, 90-115` (`PROMPTS.ESCALATION`).
- **Evidencia:** `grep -rn "escalate" src/` confirma que `deps.qwenEngine.escalate` solo existe en su propia declaración y prueba residual. Toda la escalación operativa del sistema fue migrada en Fase 3 a `handleEscalation` en `src/core/modeEngines.ts:119-197` utilizando lógica determinista y Decision #1 de Eos.
- **Riesgo:** Mantenimiento de llamadas HTTP y esquemas JSON en desuso.

#### D-03: Métodos Envoltorios Huérfanos en QwenEngine
- **Ubicación:** `src/core/reasoner/qwen.ts:188-195, 809-835` (`generateChatResponse`, `synthesizeFinalResponse`).
- **Evidencia:** Métodos declarados en `ILLMClient` y `QwenEngine` que simplemente delegan en `generateFinalResponse`. Ningún componente del orquestador los consume.

#### D-04: Semántica Distorsionada de `STEP_COMPLETED` (Hallazgo #9 de Inconsistencias)
- **Ubicación:** `src/core/callExecutor.ts:306, 330` y `src/core/modeEngines.ts:439, 640`.
- **Evidencia:** El evento denominado `"STEP_COMPLETED"` se emite cuando un paso pasa al estado `WAITING_APPROVAL` (pausa) o cuando regresa a `RUNNING` tras la autorización del usuario.
- **Riesgo:** Clientes externos o consumidores de SSE no pueden confiar en el nombre del evento para saber si un paso realmente concluyó sin inspeccionar propiedades internas del payload.

#### D-05: Documentación Viva Desactualizada Pre-Migración
- **Ubicación:** `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md`, `docs/CONTEXT_AND_MEMORY.md`, `docs/TOOLS_AND_SECURITY.md`, `docs/CODEBASE_MAP.md`.
- **Evidencia:** Todos los archivos tienen fecha de última revisión **2026-10-11**. Describen:
  - Presencia activa de Decision #5.
  - Mini-bucles de `while (calls < 4)` en PLAN (eliminados en Fase 2).
  - Límite global de 30 llamadas (eliminado en Fase 2).
  - Colapso de `LOG` en resúmenes estadísticos `1-N: X ok, Y err` (eliminado en Fase 4).
  - Catálogo MCP con `fetch_page` y `read_cached_resource` (eliminados en Fase 1).
  - Ausencia de `SYSTEM_TOOL_MANIFEST`, `RefResolver`, `DecisionVerificationView` y suites de prueba en el mapa de código.

---

### 6.3 Detalle de Riesgos Plausibles

#### R-01: `allowedDirectories` Vacío por Defecto en Adaptador Desktop Commander
- **Ubicación:** `jarvis-config.json`, `src/core/config.ts:46`, `src/core/mcp/desktopCommanderMcp.ts:25, 56-64`.
- **Análisis:** En `desktopCommanderMcp.ts:56`, la comprobación de contención de ruta se ejecuta condicionalmente: `if (this.allowedDirectories.length > 0 && typeof candidatePath === "string")`. Al iniciarse con `allowedDirectories: []`, el adaptador MCP no restringe las rutas en la capa de transporte, delegando la contención exclusivamente a Guard. Aunque Guard bloquea patrones de comandos destructivos y exige aprobación para mutaciones, no existe una barrera de directorio de trabajo por defecto.
- **Mitigación recomendada para Fase 6:** Configurar por defecto `[process.cwd()]` en `DEFAULT_CONFIG` y permitir su personalización en `SettingsModal`.

#### R-02: Pruebas de Fase 5 No Integradas (Cobertura Superficial)
- **Ubicación:** `test-phase5.ts`.
- **Análisis:** Como se demostró empíricamente, las aserciones de `test-phase5.ts` evalúan principalmente que objetos y arreglos construidos localmente en el script de prueba conserven las propiedades con las que fueron creados. No validan la comunicación HTTP real con `/api/jarvis/confirm-plan`, `/reject-plan`, `/modify-plan`, `/user-answer`, ni el renderizado de componentes React ante eventos SSE.
- **Mitigación recomendada para Fase 6:** Implementar pruebas de integración de API sobre `server.ts` que validen el ciclo de peticiones y respuestas HTTP.

#### R-03: Volatilidad de `RefStore` ante Reinicios del Servidor
- **Ubicación:** `src/core/processor/resultProcessor.ts:29-75`.
- **Análisis:** `RefStore` reside en memoria volátil de Node.js. Si el servidor se reinicia mientras existen tareas con referencias `ref:rX`, las tareas cargadas desde `jarvis-tasks.json` mantendrán los tokens pero `RefStore` estará vacío. Esto está documentado en la Sección 13.2 (Punto 11), pero requiere verificación explícita de que las tareas huérfanas transicionen a `CANCELLED` sin fallar al consultar referencias ausentes.

---

## 7. Auditoría de Pruebas y Validación Técnica

### 7.1 Estado de Ejecución de Pruebas

| Comando / Script | Tipo de Prueba | Aserciones / Resultado | Estado Real | Comentario Técnico |
|---|---|:---:|:---:|---|
| `npm run lint` (`tsc --noEmit`) | Verificación estática de tipos | 0 errores | ✅ **PASÓ** | Tipado estricto en TypeScript v7.0.2 sobre todo el código fuente. |
| `compile_applet` (`vite build`) | Compilación de producción | Bundle generado exitosamente | ✅ **PASÓ** | Sin errores de resolución de módulos ni fallos de sintaxis JSX. |
| `madge --circular src/` | Análisis de dependencias | 53 archivos, 0 ciclos | ✅ **PASÓ** | Arquitectura modular limpia sin referencias circulares. |
| `npx tsx test-phase4.ts` | Suite automatizada Fase 4 | 18/18 aprobadas | ✅ **PASÓ** | Evalúa sustitución de `{{ref:rX}}`, Guard sobre argumentos resueltos, `LOG` continuo, `effects` y handoff. |
| `npx tsx test-phase5.ts` | Suite automatizada Fase 5 | 10/10 aprobadas | ⚠️ **SUPERFICIAL** | Pasa formalmente, pero 7/10 pruebas validan literales locales en lugar de contratos integrados. |
| `test-schema.ts` | Prueba ad-hoc de LLM | Requiere Ollama local | ⏸️ **OMITIDA** | Script para validar JSON schema contra Ollama externo en `localhost:11434`. Depende de servicio externo. |

### 7.2 Brechas de Cobertura Identificadas
1. **Sin pruebas de integración HTTP:** No existen pruebas automatizadas que ejecuten peticiones reales contra los endpoints de `server.ts` (`/api/jarvis/process`, `/cancel`, `/confirm-plan`, `/reject-plan`, `/modify-plan`, `/user-answer`, `/approve`, `/deny`).
2. **Sin pruebas de recuperación de transporte MCP:** No hay validación automatizada de desconexión o timeouts de procesos hijos de `StdioMcpTransport`.
3. **Sin pruebas de concurrencia:** No se valida qué ocurre cuando dos tareas intentan ejecutarse en simultáneo (aislamiento de contextos).

---

## 8. Auditoría Documental Completa

### 8.1 Inventario de Documentación y Diagnóstico de Estado

| Documento | Estado | Problemas Detectados | Acción Requerida en Fase 6 |
|---|:---:|---|---|
| `PLAN_IMPLEMENTACION_MIGRACION_V1.3.md` | ✅ Cerrado (Normativo) | Especificación exhaustiva v1.3. Fases 0 a 5 registradas como completadas. Fase 6 definida pero pendiente de ejecución. | Mantener intacto como marco de referencia histórico y normativo. |
| `docs/ARCHITECTURE.md` | ❌ Desactualizado | Revisión del 2026-10-11. Diagrama y tablas mencionan Decision #5, `executeCall` en lugar de `runStep`, y escalación por Qwen. | Actualizar diagramas Mermaid, tablas de responsabilidades y flujo unificado `runStep`. |
| `docs/CORE_FLOW.md` | ❌ Desactualizado | Revisión del 2026-10-11. Diagrama Mermaid incluye Decision #5, mini-bucles de 4 llamadas, y evaluación por confianza < 0.60. | Reescribir diagramas reflejando `runStep`, veredictos Eos (`ok`/`cumple`), y coordinación de PLAN. |
| `docs/CONTEXT_AND_MEMORY.md` | ❌ Desactualizado | Revisión del 2026-10-11. Afirma que el `LOG` se colapsa a `1-N` al superar 12 entradas; lista `buildDecisionFive` y `PROMPTS.ESCALATION`. | Actualizar a LOG continuo (30 líneas), registrar `effects`, handoff y memoria progresiva (2→5→10). |
| `docs/TOOLS_AND_SECURITY.md` | ❌ Desactualizado | Revisión del 2026-10-11. Lista herramientas inexistentes (`fetch_page`, `read_cached_resource`), conteos de 12/12/14 MCP tools y evaluación con D5. | Sincronizar catálogo con `SYSTEM_TOOL_MANIFEST` (21 Windows, 26 DC, 11 FS, 3 locales). |
| `docs/CODEBASE_MAP.md` | ❌ Desactualizado | Árbol de archivos y relaciones carecen de `manifest.ts`, `refResolver.ts`, `DecisionVerificationView.tsx` y pruebas. | Regenerar árbol de código completo y mapa de dependencias actualizado. |
| `docs/INCONSISTENCIAS.md` | ⚠️ Desactualizado | Lista el Hallazgo #3 como pendiente (ya resuelto en `manifest.ts`). Mantiene 7 hallazgos sin registrar el estado de la migración v1.3. | Actualizar matriz de inconsistencias: cerrar #3, reclasificar #5, #6, #7, #9, #13. |
| `docs/MCP_TOOLS_SNAPSHOT.md` | ✅ Vigente | Snapshot de herramientas reales en runtime. Coincide con `SYSTEM_TOOL_MANIFEST`. | Mantener como fuente técnica de referencia. |
| `docs/FASE_*_CIERRE_AUDITORIA.md` | ✅ Completos | Reportes de cierre de Fases 0, 2, 3, 3B, 4 y 5 debidamente estructurados y archivados en `docs/`. | Servirán de insumo probatorio para el cierre general. |

---

## 9. Registro de Riesgos para el Cierre de la Migración

| ID | Riesgo Identificado | Impacto | Probabilidad | Estrategia de Mitigación en Fase 6 |
|---|---|:---:|:---:|---|
| **RSK-01** | Regresión funcional al retirar código muerto (`evaluateDecisionFive`, `qwen.escalate`) | Medio | Baja | Retirar primero las firmas no utilizadas y validar con `tsc --noEmit` y `test-phase4.ts`. |
| **RSK-02** | Discrepancias entre documentación y comportamiento en auditorías externas | Alto | Alta | Reescribir integralmente los 5 documentos vivos de `docs/` asegurando consistencia 1:1 con el código real. |
| **RSK-03** | Rutas de archivos no autorizadas por `allowedDirectories` vacío en Desktop Commander | Medio | Media | Definir contención predeterminada en `process.cwd()` y exponer selector en `SettingsModal`. |
| **RSK-04** | Rotura de consumidores de eventos al corregir la semántica de `STEP_COMPLETED` | Medio | Media | Mantener compatibilidad emitiendo `STEP_STATE_CHANGED` además de `STEP_COMPLETED` para no romper el cliente React actual. |
| **RSK-05** | Falsos positivos de cobertura por pruebas superficiales en `test-phase5.ts` | Alto | Media | Crear suite complementaria `test-integration-phase6.ts` con pruebas de endpoints reales de `server.ts`. |

---

## 10. Plan Propuesto para la Ejecución de la Fase 6

La Fase 6 (Calibración, Documentación y Cierre) debe estructurarse en tareas rigurosamente priorizadas:

### Tareas P0 — Bloqueantes de Cierre
*Problemas e inconsistencias que impiden cerrar formalmente la migración con honestidad técnica.*

- **P0-1: Sincronización Integral de Documentación Viva de Arquitectura**
  - **Origen:** Hallazgo D-05 (Documentos congelados en 2026-10-11).
  - **Objetivo:** Actualizar `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md`, `docs/CONTEXT_AND_MEMORY.md`, `docs/TOOLS_AND_SECURITY.md` y `docs/CODEBASE_MAP.md`.
  - **Acción:** Reemplazar diagramas obsoletos por la arquitectura real v1.3: bucle unificado `runStep`, veredictos Eos (`ok`/`cumple`), coordinación en PLAN, `RefResolver`, `effects`, handoff determinista, memoria continua y catálogo tipado de 61 herramientas.
  - **Criterio de Aceptación:** Ningún documento menciona Decision #5, mini-bucles de 4 llamadas, límites de 30 llamadas, colapso `1-N`, ni herramientas eliminadas (`fetch_page`).

- **P0-2: Limpieza de Código Muerto y Remanentes de Migración**
  - **Origen:** Hallazgos D-01, D-02, D-03 y Hallazgos #5 y #6 de Inconsistencias.
  - **Objetivo:** Retirar implementaciones huérfanas sin invocadores activos.
  - **Archivos:** `src/core/decision.ts` (`evaluateDecisionFive`, `multiStep`), `src/core/reasoner/prompts.ts` (`buildDecisionFive`, `PROMPTS.ESCALATION`), `src/core/reasoner/qwen.ts` (`escalate`, `generateChatResponse`, `synthesizeFinalResponse`).
  - **Acción:** Remover métodos residuales de las clases e interfaces, asegurando que ningún import o llamada quede colgando.
  - **Criterio de Aceptación:** `tsc --noEmit` y `compile_applet` pasan con 0 errores; bundle final más limpio sin código muerto.

- **P0-3: Actualización y Cierre de la Matriz de Inconsistencias**
  - **Origen:** `docs/INCONSISTENCIAS.md`.
  - **Objetivo:** Alinear el registro de inconsistencias con el estado real post-Fase 5.
  - **Acción:** Cerrar formalmente el Hallazgo #3 (resuelto en Fase 1 con `manifest.ts`), registrar resolución de #5 y #6 (tras P0-2), y actualizar el estado de #1, #7, #9 y #13.
  - **Criterio de Aceptación:** `docs/INCONSISTENCIAS.md` refleja fielmente el código actual.

---

### Tareas P1 — Necesarias para Calidad y Validación
*Validaciones y ajustes necesarios para certificar la estabilidad operativa.*

- **P1-1: Calibración Semántica del Evento SSE `STEP_COMPLETED`**
  - **Origen:** Hallazgo D-04 / Inconsistencia #9.
  - **Objetivo:** Corregir la emisión errónea de `STEP_COMPLETED` durante pausas o inicios de paso.
  - **Archivos:** `src/core/types.ts`, `src/core/callExecutor.ts`, `src/core/modeEngines.ts`, `src/hooks/useJarvis.ts`.
  - **Acción:** Introducir el evento `STEP_STATE_CHANGED` en `CoreEventType` para transiciones a `WAITING_APPROVAL` o `RUNNING`. Reservar `STEP_COMPLETED` exclusivamente para pasos terminados (`COMPLETED`, `FAILED` o `BLOCKED`). Mantener compatibilidad en `useJarvis.ts`.
  - **Criterio de Aceptación:** `STEP_COMPLETED` solo se emite cuando el paso llega a un estado final.

- **P1-2: Suite de Pruebas de Integración de Endpoints y Contratos (Fase 6)**
  - **Origen:** Riesgo R-02 (Pruebas superficiales en Fase 5).
  - **Objetivo:** Validar contratos reales de API sobre el backend de JARVIS.
  - **Archivos:** Crear `test-integration-phase6.ts`.
  - **Acción:** Implementar pruebas automatizadas que levanten o consulten el router de `server.ts` simulando peticiones a `/api/jarvis/process`, `/confirm-plan`, `/reject-plan`, `/modify-plan`, `/user-answer`, `/approve`, `/deny` y `/ref/:refKey`.
  - **Criterio de Aceptación:** Suite automatizada ejecutable con `npx tsx test-integration-phase6.ts` con 100% de aserciones aprobadas.

- **P1-3: Generación del Reporte Formal de Cierre de Migración**
  - **Origen:** Criterio de salida del Plan Maestro v1.3.
  - **Objetivo:** Formalizar la culminación de la migración de JARVIS a v1.3.
  - **Archivo:** Crear `docs/FASE_6_CIERRE_AUDITORIA.md`.
  - **Criterio de Aceptación:** Documento con matriz de cierre 100% satisfecha, evidencias y certificación final.

---

### Tareas P2 — Opcionales (Mejoras de Robustez)
- **P2-1: Configuración de Directorios Autorizados (`allowedDirectories`)**
  - **Origen:** Inconsistencia #1 / Riesgo R-01.
  - **Acción:** Fijar `allowedDirectories: [process.cwd()]` en `src/core/config.ts` y exponer el campo en `SettingsModal.tsx`.
- **P2-2: Alias Bidireccionales para Herramientas MCP Upstream**
  - **Origen:** Inconsistencias #7 y #13.
  - **Acción:** Incorporar mapeo explícito de herramientas con formato alternativo en `PolicyRegistry`.

---

### Tareas Fuera de Alcance (Post-Migración)
- Reestructuración de la base de datos o almacenamiento relacional (Cloud SQL / SQLite).
- Memoria persistente vectorial a largo plazo entre reinicios independientes.
- Soporte para nuevos servidores MCP ajenos a Windows, Desktop Commander y Free Search.

---

## 11. Criterios Objetivos de Cierre de la Migración

La migración se considerará 100% completada y lista para producción cuando se cumplan las siguientes condiciones medibles:

1. **Compilación y Tipado:** `npm run lint` (`tsc --noEmit`) y `npm run build` completan con 0 errores y 0 advertencias bloqueantes.
2. **Dependencias Circulares:** `npx madge --circular src/` certifica 0 dependencias circulares.
3. **Pruebas Automatizadas:** Todas las suites (`test-phase4.ts`, `test-phase5.ts` y la nueva `test-integration-phase6.ts`) pasan al 100% de aserciones.
4. **Código Muerto Erradicado:** Ausencia total de `evaluateDecisionFive`, wrappers legados y `qwenEngine.escalate`.
5. **Documentación Sincronizada:** Los 5 documentos vivos de `docs/` y el registro de inconsistencias reflejan con exactitud el código fuente real v1.3.
6. **Reporte Formal Archivada:** `docs/FASE_6_CIERRE_AUDITORIA.md` redactado, validado y archivado en el repositorio.

---

## 12. Preguntas y Decisiones Pendientes que Requieren Intervención Humana

Durante esta auditoría técnica se resolvieron empíricamente la totalidad de las incógnitas de implementación mediante inspección del código fuente y del runtime. Únicamente se eleva a consideración del usuario la siguiente decisión de preferencia operativa previa a la ejecución de Fase 6:

- **Contención de Rutas en Desktop Commander (P2-1 / Inconsistencia #1):**
  - *Opción A (Recomendada):* Fijar `allowedDirectories: [process.cwd()]` por defecto en la configuración para garantizar que las herramientas de lectura y edición de archivos no puedan acceder a rutas fuera del proyecto sin configuración explícita.
  - *Opción B (Comportamiento actual):* Mantener `allowedDirectories: []` desactivado por defecto, confiando exclusivamente en la compuerta de seguridad `Guard` para bloquear comandos destructivos o requerir aprobación interactiva.
